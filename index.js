'use strict'

const dgram = require('node:dgram')
const { rmc, gga, vtg, dbt, dpt } = require('./nmea')
const ais = require('./ais')

const DEFAULT_OPTIONS = Object.freeze({
  enableBroadcast: true,
  broadcastAddress: '255.255.255.255',
  enableUnicast: false,
  destination: '',
  port: 2000,
  gpsIntervalMs: 1000,
  depthIntervalMs: 1000,
  aisIntervalMs: 2000,
  aisStaticIntervalMs: 60000,
  enableGps: true,
  enableDepth: true,
  enableAis: true,
  depthPath: 'environment.depth.belowTransducer',
  depthOffsetPath: 'environment.depth.transducerToKeel',
  ownDataMaxAgeSeconds: 30,
  aisMaxAgeSeconds: 600
})

// Lower bounds shared by the schema and runtime normalization.
const MIN_INTERVALS = Object.freeze({
  gpsIntervalMs: 200,
  depthIntervalMs: 200,
  aisIntervalMs: 500,
  aisStaticIntervalMs: 10000
})

// Minimum time between repeated identical error log lines.
const ERROR_LOG_INTERVAL_MS = 60000

function integerOption(value, fallback, min, max) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (!Number.isFinite(n)) return fallback
  const i = Math.round(n)
  if (i < min) return min
  if (max !== undefined && i > max) return max
  return i
}

function booleanOption(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function stringOption(value, fallback, allowEmpty = false) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed || allowEmpty ? trimmed : fallback
}

// Merge user configuration with defaults and coerce every value into a safe
// range, so a stale or hand-edited configuration cannot crash the server.
function normalizeOptions(opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const d = DEFAULT_OPTIONS
  // An out-of-range port is a configuration error, not a value to clamp.
  const rawPort = integerOption(o.port, d.port, -Infinity)
  const port = rawPort >= 1 && rawPort <= 65535 ? rawPort : d.port
  return {
    enableBroadcast: booleanOption(o.enableBroadcast, d.enableBroadcast),
    broadcastAddress: stringOption(o.broadcastAddress, d.broadcastAddress),
    enableUnicast: booleanOption(o.enableUnicast, d.enableUnicast),
    destination: stringOption(o.destination, d.destination, true),
    port,
    gpsIntervalMs: integerOption(o.gpsIntervalMs, d.gpsIntervalMs, MIN_INTERVALS.gpsIntervalMs),
    depthIntervalMs: integerOption(o.depthIntervalMs, d.depthIntervalMs, MIN_INTERVALS.depthIntervalMs),
    aisIntervalMs: integerOption(o.aisIntervalMs, d.aisIntervalMs, MIN_INTERVALS.aisIntervalMs),
    aisStaticIntervalMs: integerOption(o.aisStaticIntervalMs, d.aisStaticIntervalMs, MIN_INTERVALS.aisStaticIntervalMs),
    enableGps: booleanOption(o.enableGps, d.enableGps),
    enableDepth: booleanOption(o.enableDepth, d.enableDepth),
    enableAis: booleanOption(o.enableAis, d.enableAis),
    depthPath: stringOption(o.depthPath, d.depthPath),
    depthOffsetPath: stringOption(o.depthOffsetPath, d.depthOffsetPath),
    ownDataMaxAgeSeconds: integerOption(o.ownDataMaxAgeSeconds, d.ownDataMaxAgeSeconds, 0),
    aisMaxAgeSeconds: integerOption(o.aisMaxAgeSeconds, d.aisMaxAgeSeconds, 0)
  }
}

// Map Signal K navigation.gnss.methodQuality (specification enum:
// "no GPS", "GNSS Fix", "DGNSS fix", "Precise GNSS", "RTK fixed integer",
// "RTK float", "Estimated (DR) mode", "Manual input", "Simulator mode",
// "Error") to NMEA RMC/VTG mode and GGA fix quality.
function gnssQualityFrom(quality) {
  const none = { valid: false, mode: 'N', fixQuality: 0 }
  const normalized = typeof quality === 'string' ? quality.trim().toLowerCase() : ''
  if (!normalized || /^no\b/.test(normalized) || normalized.includes('error') || normalized.includes('invalid')) return none
  if (normalized.includes('rtk fixed')) return { valid: true, mode: 'R', fixQuality: 4 }
  if (normalized.includes('rtk float')) return { valid: true, mode: 'F', fixQuality: 5 }
  if (normalized.includes('dgnss') || normalized.includes('dgps')) return { valid: true, mode: 'D', fixQuality: 2 }
  if (normalized.includes('precise')) return { valid: true, mode: 'P', fixQuality: 3 }
  if (normalized.includes('estimated') || normalized.includes('dead reckoning')) return { valid: true, mode: 'E', fixQuality: 6 }
  if (normalized.includes('manual')) return { valid: true, mode: 'M', fixQuality: 7 }
  if (normalized.includes('simulat')) return { valid: true, mode: 'S', fixQuality: 8 }
  if (normalized.includes('gnss') || normalized.includes('gps')) return { valid: true, mode: 'A', fixQuality: 1 }
  return none
}

function nodeTimestampMs(node) {
  if (!node || typeof node !== 'object' || node.timestamp == null) return null
  const ms = Date.parse(node.timestamp)
  return Number.isFinite(ms) ? ms : null
}

module.exports = function (app) {
  let socket = null
  let timers = []
  let options = normalizeOptions()
  let statusMessage = ''
  let lastError = { message: '', at: 0 }
  let inError = false
  const lastStatic = new Map()

  const plugin = {
    id: 'signalk-to-boating',
    name: 'Signal K to Boating',
    description: 'Bridges Signal K GPS, depth and AIS target data to NMEA 0183 over UDP for Garmin/Navionics Boating.',
    schema: () => ({
      type: 'object',
      properties: {
        enableBroadcast: { type: 'boolean', title: 'Send UDP broadcast', default: DEFAULT_OPTIONS.enableBroadcast },
        broadcastAddress: { type: 'string', title: 'Broadcast address', default: DEFAULT_OPTIONS.broadcastAddress, minLength: 1 },
        enableUnicast: { type: 'boolean', title: 'Send to a specific IP', default: DEFAULT_OPTIONS.enableUnicast },
        destination: { type: 'string', title: 'Specific destination IP', default: DEFAULT_OPTIONS.destination },
        port: { type: 'integer', title: 'UDP port', default: DEFAULT_OPTIONS.port, minimum: 1, maximum: 65535 },
        gpsIntervalMs: { type: 'integer', title: 'GPS transmit interval (ms)', default: DEFAULT_OPTIONS.gpsIntervalMs, minimum: MIN_INTERVALS.gpsIntervalMs },
        depthIntervalMs: { type: 'integer', title: 'Depth transmit interval (ms)', default: DEFAULT_OPTIONS.depthIntervalMs, minimum: MIN_INTERVALS.depthIntervalMs },
        aisIntervalMs: { type: 'integer', title: 'AIS dynamic interval (ms)', default: DEFAULT_OPTIONS.aisIntervalMs, minimum: MIN_INTERVALS.aisIntervalMs },
        aisStaticIntervalMs: { type: 'integer', title: 'AIS static repeat interval (ms)', default: DEFAULT_OPTIONS.aisStaticIntervalMs, minimum: MIN_INTERVALS.aisStaticIntervalMs },
        enableGps: { type: 'boolean', title: 'Send external GPS', default: DEFAULT_OPTIONS.enableGps },
        enableDepth: { type: 'boolean', title: 'Send depth', default: DEFAULT_OPTIONS.enableDepth },
        enableAis: { type: 'boolean', title: 'Send AIS targets', default: DEFAULT_OPTIONS.enableAis },
        depthPath: { type: 'string', title: 'Primary depth path', default: DEFAULT_OPTIONS.depthPath, minLength: 1 },
        depthOffsetPath: { type: 'string', title: 'Transducer offset path', default: DEFAULT_OPTIONS.depthOffsetPath, minLength: 1 },
        ownDataMaxAgeSeconds: {
          type: 'integer',
          title: 'Stop sending own GPS/depth values older than (seconds, 0 = never)',
          default: DEFAULT_OPTIONS.ownDataMaxAgeSeconds,
          minimum: 0,
          maximum: 3600
        },
        aisMaxAgeSeconds: {
          type: 'integer',
          title: 'Stop sending AIS targets not heard for (seconds, 0 = never)',
          default: DEFAULT_OPTIONS.aisMaxAgeSeconds,
          minimum: 0,
          maximum: 86400
        }
      }
    }),
    start,
    stop
  }

  // Own-vessel value at path, or undefined when absent or older than the
  // configured freshness limit. Values without a timestamp are accepted.
  function getSelf(path) {
    let node
    try { node = app.getSelfPath(path) } catch (_) { return undefined }
    if (node == null) return undefined
    const maxAgeMs = options.ownDataMaxAgeSeconds * 1000
    if (maxAgeMs > 0) {
      const ts = nodeTimestampMs(node)
      if (ts != null && Date.now() - ts > maxAgeMs) return undefined
    }
    return ais.valueOf(node)
  }

  function getRootBranch(branch) {
    try {
      const v = app.getPath(branch)
      if (v && typeof v === 'object') return ais.valueOf(v)
    } catch (_) {}
    try {
      if (typeof app.getFullSignalK === 'function') {
        const full = app.getFullSignalK()
        return full && ais.valueOf(full[branch])
      }
    } catch (_) {}
    return undefined
  }

  function selfKeys() {
    const keys = new Set(['self'])
    if (app.selfId) keys.add(app.selfId)
    if (app.signalk && app.signalk.selfId) keys.add(app.signalk.selfId)
    if (typeof app.selfContext === 'string') keys.add(app.selfContext.replace(/^vessels\./, ''))
    return keys
  }

  function setStatus(message) {
    statusMessage = message
    if (typeof app.setPluginStatus === 'function') app.setPluginStatus(message)
  }

  // Report errors through Signal K without flooding the log: an identical
  // message is logged at most once per ERROR_LOG_INTERVAL_MS.
  function reportError(message) {
    inError = true
    const now = Date.now()
    if (message === lastError.message && now - lastError.at < ERROR_LOG_INTERVAL_MS) return
    lastError = { message, at: now }
    if (typeof app.setPluginError === 'function') app.setPluginError(message)
    if (typeof app.error === 'function') app.error(message)
  }

  function reportSendOk() {
    if (!inError) return
    inError = false
    lastError = { message: '', at: 0 }
    if (statusMessage) setStatus(statusMessage)
  }

  function send(lines, oneSentencePerDatagram = false) {
    if (!socket) return
    const activeSocket = socket
    const arr = Array.isArray(lines) ? lines : [lines]
    const valid = arr.filter(Boolean)
    if (!valid.length) return
    const payloads = oneSentencePerDatagram
      ? valid.map(line => Buffer.from(line + '\r\n', 'ascii'))
      : [Buffer.from(valid.join('\r\n') + '\r\n', 'ascii')]
    const destinations = []
    if (options.enableBroadcast && options.broadcastAddress) destinations.push(options.broadcastAddress)
    if (options.enableUnicast && options.destination && !destinations.includes(options.destination)) destinations.push(options.destination)
    for (const payload of payloads) {
      for (const destination of destinations) {
        try {
          activeSocket.send(payload, options.port, destination, err => {
            if (socket !== activeSocket) return
            if (err) reportError(`UDP send error to ${destination}: ${err.message}`)
            else reportSendOk()
          })
        } catch (err) {
          reportError(`UDP send error to ${destination}: ${err.message}`)
        }
      }
    }
  }

  function emitGps() {
    const position = getSelf('navigation.position')
    if (!position || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude) ||
        position.latitude < -90 || position.latitude > 90 ||
        position.longitude < -180 || position.longitude > 180) return
    const sog = getSelf('navigation.speedOverGround')
    const cog = getSelf('navigation.courseOverGroundTrue') ?? getSelf('navigation.courseOverGround')
    const altitude = position.altitude ?? getSelf('navigation.gnss.altitude')
    const sats = getSelf('navigation.gnss.satellites')
    const hdop = getSelf('navigation.gnss.horizontalDilution')
    const quality = gnssQualityFrom(getSelf('navigation.gnss.methodQuality'))
    const now = new Date()
    send([
      rmc({ position, sog, cog, timestamp: now, valid: quality.valid, mode: quality.mode }),
      gga({ position, altitude, timestamp: now, satellites: sats, hdop, fixQuality: quality.fixQuality }),
      vtg({ sog, cog, mode: quality.mode })
    ])
  }

  function emitDepth() {
    const depth = getSelf(options.depthPath)
    if (!Number.isFinite(depth) || depth < 0) return
    let offset = getSelf(options.depthOffsetPath)
    // Signal K transducerToKeel is a positive distance; NMEA DPT expresses a
    // transducer-to-keel offset as a negative value.
    if (/(^|\.)transducerToKeel$/.test(options.depthOffsetPath) && Number.isFinite(offset)) offset = -Math.abs(offset)
    send([dbt(depth), dpt(depth, offset)])
  }

  function emitAis() {
    const vessels = getRootBranch('vessels')
    if (!vessels || typeof vessels !== 'object') return
    const skip = selfKeys()
    const now = new Date()
    const nowMs = now.getTime()
    const maxAgeMs = options.aisMaxAgeSeconds * 1000
    const seen = new Set()
    const out = []
    for (const [key, vessel0] of Object.entries(vessels)) {
      if (skip.has(key)) continue
      const vessel = ais.valueOf(vessel0)
      if (!vessel || typeof vessel !== 'object') continue
      if (maxAgeMs > 0) {
        const age = ais.positionAgeMs(vessel, nowMs)
        if (age != null && age > maxAgeMs) continue
      }
      const dyn = ais.dynamic(vessel, key, now)
      if (!dyn) continue
      seen.add(dyn.mmsi)
      out.push(...ais.toVdm(dyn.payload, dyn.fill, 'A'))
      const last = lastStatic.get(dyn.mmsi) || 0
      if (nowMs - last >= options.aisStaticIntervalMs) {
        for (const st of ais.staticMessages(vessel, key)) out.push(...ais.toVdm(st.payload, st.fill, 'A'))
        lastStatic.set(dyn.mmsi, nowMs)
      }
    }
    // Forget targets that have disappeared so the map cannot grow without bound.
    for (const mmsi of lastStatic.keys()) if (!seen.has(mmsi)) lastStatic.delete(mmsi)
    send(out, true)
  }

  // Run fn now and periodically; an exception in one cycle is reported and
  // never escapes into the timer, where it would crash the server process.
  function schedule(name, fn, ms) {
    const guarded = () => {
      try { fn() } catch (err) { reportError(`Signal K to Boating ${name} output failed: ${err && err.message}`) }
    }
    guarded()
    timers.push(setInterval(guarded, ms))
  }

  function start(opts) {
    stop()
    options = normalizeOptions(opts)
    const activeSocket = dgram.createSocket('udp4')
    socket = activeSocket
    activeSocket.on('error', err => {
      if (socket === activeSocket) reportError(`Signal K to Boating UDP error: ${err.message}`)
    })
    activeSocket.bind(0, () => {
      if (socket !== activeSocket) return
      try { activeSocket.setBroadcast(Boolean(options.enableBroadcast)) } catch (_) {}
      const targets = []
      if (options.enableBroadcast) targets.push(`broadcast ${options.broadcastAddress}:${options.port}`)
      if (options.enableUnicast && options.destination) targets.push(`unicast ${options.destination}:${options.port}`)
      setStatus(targets.length ? `Sending NMEA 0183 GPS/depth/AIS via ${targets.join(' + ')}` : 'NMEA 0183 output enabled but no UDP destination selected')
      if (options.enableGps) schedule('GPS', emitGps, options.gpsIntervalMs)
      if (options.enableDepth) schedule('depth', emitDepth, options.depthIntervalMs)
      if (options.enableAis) schedule('AIS', emitAis, options.aisIntervalMs)
    })
  }

  function stop() {
    for (const t of timers) clearInterval(t)
    timers = []
    lastStatic.clear()
    statusMessage = ''
    lastError = { message: '', at: 0 }
    inError = false
    if (socket) {
      try { socket.close() } catch (_) {}
      socket = null
    }
  }

  return plugin
}

module.exports.DEFAULT_OPTIONS = DEFAULT_OPTIONS
module.exports.normalizeOptions = normalizeOptions
module.exports.gnssQualityFrom = gnssQualityFrom
