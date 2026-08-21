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
    const s = String(value || '').toUpperCase().replace(/[^@ A-Z0-9!"#$%&'()*+,-./:;<=>?\\[\]^_]/g, ' ')
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

function navStatus(vessel) {
  const v = dig(vessel, 'navigation.state')
  if (Number.isFinite(v)) return Math.max(0, Math.min(15, Math.round(v)))
  return 15
}

function rotCode(radSec) {
  if (!Number.isFinite(radSec)) return -128
  const degMin = radSec * 180 / Math.PI * 60
  if (Math.abs(degMin) < 1e-9) return 0
  const encoded = Math.round(4.733 * Math.sqrt(Math.abs(degMin))) * Math.sign(degMin)
  return Math.max(-127, Math.min(127, encoded))
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
  const sec = now.getUTCSeconds()
  const b = new Bits()
  if (cls === 'B') {
    b.u(18,6).u(0,2).u(mmsi,30).u(0,8)
      .u(sog == null ? 1023 : Math.min(1022, Math.round(sog*10)),10)
      .u(0,1).s(lon,28).s(lat,27)
      .u(cog == null ? 3600 : Math.min(3599, Math.round(cog*10)),12)
      .u(heading == null ? 511 : Math.min(359, Math.round(heading)),9)
      .u(sec > 59 ? 60 : sec,6).u(0,2).u(0,1).u(0,1).u(0,1).u(0,1).u(0,1).u(0,1).u(0,1).u(0,20)
  } else {
    b.u(1,6).u(0,2).u(mmsi,30).u(navStatus(vessel),4)
      .s(rotCode(dig(vessel, 'navigation.rateOfTurn')),8)
      .u(sog == null ? 1023 : Math.min(1022, Math.round(sog*10)),10)
      .u(0,1).s(lon,28).s(lat,27)
      .u(cog == null ? 3600 : Math.min(3599, Math.round(cog*10)),12)
      .u(heading == null ? 511 : Math.min(359, Math.round(heading)),9)
      .u(sec > 59 ? 60 : sec,6).u(0,2).u(0,3).u(0,1).u(0,19)
  }
  return { mmsi, cls, ...b.armored() }
}

function staticMessages(vessel, key) {
  const mmsi = mmsiOf(vessel, key)
  if (!mmsi) return []
  const cls = aisClass(vessel)
  const name = dig(vessel, 'name') || ''
  const callsign = dig(vessel, 'communication.callsignVhf') || dig(vessel, 'communication.callsign') || ''
  const shipTypeObj = dig(vessel, 'design.aisShipType')
  const rawShipType = Number(valueOf(shipTypeObj && shipTypeObj.id) ?? (shipTypeObj && shipTypeObj.id) ?? 0)
  const shipType = Number.isFinite(rawShipType) ? Math.max(0, Math.min(255, Math.round(rawShipType))) : 0
  const length = Number(dig(vessel, 'design.length.overall')) || 0
  const beam = Number(dig(vessel, 'design.beam')) || 0
  const draftObj = dig(vessel, 'design.draft')
  const rawDraft = Number((draftObj && draftObj.current) ?? (draftObj && draftObj.maximum) ?? draftObj)
  const draft = Number.isFinite(rawDraft) ? Math.max(0, rawDraft) : 0
  if (cls === 'B') {
    const a = new Bits().u(24,6).u(0,2).u(mmsi,30).u(0,2).text(name,20).armored()
    const toBow = Math.max(0, Math.min(511, Math.round(length * 0.5)))
    const toStern = Math.max(0, Math.min(511, Math.round(length - toBow)))
    const toPort = Math.max(0, Math.min(63, Math.round(beam * 0.5)))
    const toStar = Math.max(0, Math.min(63, Math.round(beam - toPort)))
    const b = new Bits().u(24,6).u(0,2).u(mmsi,30).u(1,2).u(shipType,8).text('',7).text(callsign,7)
      .u(toBow,9).u(toStern,9).u(toPort,6).u(toStar,6).u(0,6).armored()
    return [a,b]
  }
  const toBow = Math.max(0, Math.min(511, Math.round(length * 0.5)))
  const toStern = Math.max(0, Math.min(511, Math.round(length - toBow)))
  const toPort = Math.max(0, Math.min(63, Math.round(beam * 0.5)))
  const toStar = Math.max(0, Math.min(63, Math.round(beam - toPort)))
  const x = new Bits().u(5,6).u(0,2).u(mmsi,30).u(0,2).u(0,30).text(callsign,7).text(name,20)
    .u(shipType,8).u(toBow,9).u(toStern,9).u(toPort,6).u(toStar,6).u(0,4)
    .u(0,4).u(0,5).u(0,5).u(0,6).u(Math.min(255, Math.round(draft*10)),8)
    .text(dig(vessel,'navigation.destination') || '',20).u(0,1).u(0,1).armored()
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

module.exports = { Bits, valueOf, dig, mmsiOf, aisClass, dynamic, staticMessages, toVdm }
