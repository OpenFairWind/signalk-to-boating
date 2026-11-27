'use strict'

const { bangSentence, radToDeg, msToKnots } = require('./nmea')

class Bits {
  constructor() { this.bits = [] }
  u(value, width) {
    let v = BigInt(Math.max(0, Math.trunc(Number(value) || 0)))
    for (let i = width - 1; i >= 0; i--) this.bits.push(Number((v >> BigInt(i)) & 1n))
    return this
  }
  s(value, width) {
    let v = BigInt(Math.trunc(Number(value) || 0))
    const mod = 1n << BigInt(width)
    if (v < 0) v = mod + v
    for (let i = width - 1; i >= 0; i--) this.bits.push(Number((v >> BigInt(i)) & 1n))
    return this
  }
  text(value, chars) {
    const s = (typeof value === 'string' || typeof value === 'number' ? String(value) : '').toUpperCase().replace(/[^@ A-Z0-9!"#$%&'()*+,-./:;<=>?\\[\]^_]/g, ' ')
    for (let i = 0; i < chars; i++) {
      const c = i < s.length ? s[i] : '@'
      let v = c.charCodeAt(0)
      if (v >= 64 && v <= 95) v -= 64
      else if (v >= 32 && v <= 63) v = v
      else v = 32
      this.u(v, 6)
    }
    return this
  }
  armored() {
    const fill = (6 - (this.bits.length % 6)) % 6
    for (let i = 0; i < fill; i++) this.bits.push(0)
    let payload = ''
    for (let i = 0; i < this.bits.length; i += 6) {
      let v = 0
      for (let j = 0; j < 6; j++) v = (v << 1) | this.bits[i + j]
      payload += String.fromCharCode(v < 40 ? v + 48 : v + 56)
    }
    return { payload, fill }
  }
}

function mmsiOf(vessel, key) {
  const raw = valueOf(vessel && vessel.mmsi)
  if (raw != null && /^\d{9}$/.test(String(raw))) return Number(raw)
  const match = String(key || '').match(/mmsi:(\d{9})/)
  return match ? Number(match[1]) : null
}

function valueOf(node) {
  if (node == null) return node
  if (typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, 'value')) return node.value
  return node
}

function dig(obj, path) {
  let cur = obj
  for (const p of path.split('.')) {
    cur = valueOf(cur)
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[p]
  }
  return valueOf(cur)
}

function aisClass(vessel) {
  const direct = dig(vessel, 'sensors.ais.class')
  if (direct === 'B' || direct === 'A') return direct
  const sensors = valueOf(vessel && vessel.sensors)
  if (sensors && typeof sensors === 'object') {
    for (const sensor of Object.values(sensors)) {
      const c = dig(sensor, 'class')
      if (c === 'B' || c === 'A') return c
    }
  }
  return 'A'
}

// Signal K navigation.state strings (specification enum) mapped to the
// ITU-R M.1371 navigational status codes. Unknown states stay "not defined".
const NAV_STATUS = Object.freeze({
  motoring: 0,
  anchored: 1,
  'not under command': 2,
  'restricted manouverability': 3,
  'restricted manouverability towing < 200m': 3,
  'restricted manouverability towing > 200m': 3,
  'restricted manouverability underwater operations': 3,
  'constrained by draft': 4,
  moored: 5,
  aground: 6,
  fishing: 7,
  'fishing-hampered': 7,
  trawling: 7,
  'trawling-shooting': 7,
  'trawling-hauling': 7,
  sailing: 8,
  'hazardous material high speed': 9,
  'hazardous material wing in ground': 10,
  'towing astern': 11,
  'pushing ahead or towing alongside': 12,
  'ais-sart': 14,
  default: 15
})

function navStatus(vessel) {
  const v = dig(vessel, 'navigation.state')
  if (Number.isFinite(v)) return Math.max(0, Math.min(15, Math.round(v)))
  if (typeof v === 'string') {
    const code = NAV_STATUS[v.trim().toLowerCase().replace(/maneuverability/g, 'manouverability')]
    if (code !== undefined) return code
  }
  return 15
}

function rotCode(radSec) {
  if (!Number.isFinite(radSec)) return -128
  const degMin = radSec * 180 / Math.PI * 60
  if (Math.abs(degMin) < 1e-9) return 0
  const encoded = Math.round(4.733 * Math.sqrt(Math.abs(degMin))) * Math.sign(degMin)
  // +/-127 is reserved for "turning, no turn indicator"; sensor values cap at +/-126.
  return Math.max(-126, Math.min(126, encoded))
}

// Raw Signal K node at path, without unwrapping the final { value, timestamp }.
function nodeAt(obj, path) {
  let cur = obj
  for (const p of path.split('.')) {
    cur = valueOf(cur)
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[p]
  }
  return cur
}

function timestampMs(obj, path) {
  const node = nodeAt(obj, path)
  if (!node || typeof node !== 'object' || node.timestamp == null) return null
  const ms = Date.parse(node.timestamp)
  return Number.isFinite(ms) ? ms : null
}

// AIS COG in 1/10 degree (3600 = not available) and heading in degrees (511 = not available).
function cogTenths(deg) {
  return deg == null ? 3600 : Math.round(deg * 10) % 3600
}

function headingDegrees(deg) {
  return deg == null ? 511 : Math.round(deg) % 360
}

function finiteOrNull(value) {
  const n = Number(value)
  return value != null && value !== '' && Number.isFinite(n) ? n : null
}

function clampInt(value, max) {
  return Math.max(0, Math.min(max, Math.round(value)))
}

// Ship dimensions relative to the AIS position reference point (A,B,C,D).
// When the reference point is unknown, ITU-R M.1371 specifies A = C = 0 with
// B = length and D = beam, so no antenna location is invented.
function dimensions(vessel) {
  const length = Math.max(0, finiteOrNull(dig(vessel, 'design.length.overall')) || 0)
  const beam = Math.max(0, finiteOrNull(dig(vessel, 'design.beam')) || 0)
  const fromBow = finiteOrNull(dig(vessel, 'sensors.ais.fromBow') ?? dig(vessel, 'sensors.gps.fromBow'))
  const fromCenter = finiteOrNull(dig(vessel, 'sensors.ais.fromCenter') ?? dig(vessel, 'sensors.gps.fromCenter'))
  let toBow = 0
  let toStern = length
  if (length > 0 && fromBow != null && fromBow >= 0 && fromBow <= length) {
    toBow = fromBow
    toStern = length - fromBow
  }
  let toPort = 0
  let toStarboard = beam
  if (beam > 0 && fromCenter != null && Math.abs(fromCenter) <= beam / 2) {
    // Signal K fromCenter is positive to starboard.
    toPort = beam / 2 + fromCenter
    toStarboard = beam / 2 - fromCenter
  }
  return {
    toBow: clampInt(toBow, 511),
    toStern: clampInt(toStern, 511),
    toPort: clampInt(toPort, 63),
    toStarboard: clampInt(toStarboard, 63)
  }
}

function destinationOf(vessel) {
  const common = dig(vessel, 'navigation.destination.commonName')
  if (typeof common === 'string') return common
  const legacy = dig(vessel, 'navigation.destination')
  return typeof legacy === 'string' ? legacy : ''
}

// ETA as AIS month/day/hour/minute; 0/0/24/60 means not available.
function etaOf(vessel) {
  const raw = dig(vessel, 'navigation.destination.eta')
  const ms = typeof raw === 'string' ? Date.parse(raw) : NaN
  if (!Number.isFinite(ms)) return { month: 0, day: 0, hour: 24, minute: 60 }
  const d = new Date(ms)
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}

function imoOf(vessel) {
  const raw = dig(vessel, 'registrations.imo')
  const match = String(raw == null ? '' : raw).match(/(\d{7})/)
  return match ? Number(match[1]) : 0
}

// Age in milliseconds of a target's last position report, or null when the
// Signal K model carries no usable timestamp for it.
function positionAgeMs(vessel, nowMs = Date.now()) {
  const ts = timestampMs(vessel, 'navigation.position')
  return ts == null ? null : nowMs - ts
}

function dynamic(vessel, key, now = new Date()) {
  const mmsi = mmsiOf(vessel, key)
  const pos = dig(vessel, 'navigation.position')
  if (!mmsi || !pos || !Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude) ||
      pos.latitude < -90 || pos.latitude > 90 || pos.longitude < -180 || pos.longitude > 180) return null
  const speed = dig(vessel, 'navigation.speedOverGround')
  const sog = Number.isFinite(speed) && speed >= 0 ? msToKnots(speed) : null
  const cog = radToDeg(dig(vessel, 'navigation.courseOverGroundTrue') ?? dig(vessel, 'navigation.courseOverGround'))
  const heading = radToDeg(dig(vessel, 'navigation.headingTrue'))
  const cls = aisClass(vessel)
  const lon = Math.round(pos.longitude * 600000)
  const lat = Math.round(pos.latitude * 600000)
  // UTC second of the original position report; 60 = time stamp not available.
  const reportMs = timestampMs(vessel, 'navigation.position')
  const sec = reportMs == null ? 60 : new Date(reportMs).getUTCSeconds()
  const sogField = sog == null ? 1023 : Math.min(1022, Math.round(sog * 10))
  const b = new Bits()
  if (cls === 'B') {
    b.u(18, 6).u(0, 2).u(mmsi, 30).u(0, 8)
      .u(sogField, 10)
      .u(0, 1).s(lon, 28).s(lat, 27)
      .u(cogTenths(cog), 12)
      .u(headingDegrees(heading), 9)
      .u(sec, 6).u(0, 2).u(0, 1).u(0, 1).u(0, 1).u(0, 1).u(0, 1).u(0, 1).u(0, 1).u(0, 20)
  } else {
    b.u(1, 6).u(0, 2).u(mmsi, 30).u(navStatus(vessel), 4)
      .s(rotCode(dig(vessel, 'navigation.rateOfTurn')), 8)
      .u(sogField, 10)
      .u(0, 1).s(lon, 28).s(lat, 27)
      .u(cogTenths(cog), 12)
      .u(headingDegrees(heading), 9)
      .u(sec, 6).u(0, 2).u(0, 3).u(0, 1).u(0, 19)
  }
  return { mmsi, cls, ...b.armored() }
}

function staticMessages(vessel, key) {
  const mmsi = mmsiOf(vessel, key)
  if (!mmsi) return []
  const cls = aisClass(vessel)
  const name = dig(vessel, 'name')
  const callsign = dig(vessel, 'communication.callsignVhf') || dig(vessel, 'communication.callsign')
  const shipTypeObj = dig(vessel, 'design.aisShipType')
  const rawShipType = Number(valueOf(shipTypeObj && shipTypeObj.id) ?? 0)
  const shipType = Number.isFinite(rawShipType) ? clampInt(rawShipType, 255) : 0
  const draftObj = dig(vessel, 'design.draft')
  const rawDraft = Number((draftObj && draftObj.current) ?? (draftObj && draftObj.maximum) ?? draftObj)
  const draft = Number.isFinite(rawDraft) ? Math.max(0, rawDraft) : 0
  const dim = dimensions(vessel)
  if (cls === 'B') {
    const a = new Bits().u(24, 6).u(0, 2).u(mmsi, 30).u(0, 2).text(name, 20).armored()
    const b = new Bits().u(24, 6).u(0, 2).u(mmsi, 30).u(1, 2).u(shipType, 8).text('', 7).text(callsign, 7)
      .u(dim.toBow, 9).u(dim.toStern, 9).u(dim.toPort, 6).u(dim.toStarboard, 6).u(0, 6).armored()
    return [a, b]
  }
  const eta = etaOf(vessel)
  const x = new Bits().u(5, 6).u(0, 2).u(mmsi, 30).u(0, 2).u(imoOf(vessel), 30).text(callsign, 7).text(name, 20)
    .u(shipType, 8).u(dim.toBow, 9).u(dim.toStern, 9).u(dim.toPort, 6).u(dim.toStarboard, 6).u(0, 4)
    .u(eta.month, 4).u(eta.day, 5).u(eta.hour, 5).u(eta.minute, 6).u(Math.min(255, Math.round(draft * 10)), 8)
    .text(destinationOf(vessel), 20).u(0, 1).u(0, 1).armored()
  return [x]
}

let sequence = 0
function toVdm(payload, fill, channel = 'A') {
  const maxPayload = 56
  const chunks = []
  for (let i = 0; i < payload.length; i += maxPayload) chunks.push(payload.slice(i, i + maxPayload))
  const total = chunks.length
  const seq = total > 1 ? String((sequence++ % 10)) : ''
  return chunks.map((chunk, i) => bangSentence('AIVDM', [
    String(total), String(i + 1), seq, channel, chunk, String(i === total - 1 ? fill : 0)
  ]))
}

module.exports = {
  Bits, valueOf, dig, mmsiOf, aisClass, navStatus, rotCode, dimensions, positionAgeMs,
  dynamic, staticMessages, toVdm
}
