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
  depthOffsetPath: 'environment.depth.transducerToKeel'
})

module.exports = function (app) {
  let socket = null
  let timers = []
  let options = {}
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
        gpsIntervalMs: { type: 'integer', title: 'GPS transmit interval (ms)', default: DEFAULT_OPTIONS.gpsIntervalMs, minimum: 200 },
        depthIntervalMs: { type: 'integer', title: 'Depth transmit interval (ms)', default: DEFAULT_OPTIONS.depthIntervalMs, minimum: 200 },
        aisIntervalMs: { type: 'integer', title: 'AIS dynamic interval (ms)', default: DEFAULT_OPTIONS.aisIntervalMs, minimum: 500 },
        aisStaticIntervalMs: { type: 'integer', title: 'AIS static repeat interval (ms)', default: DEFAULT_OPTIONS.aisStaticIntervalMs, minimum: 10000 },
        enableGps: { type: 'boolean', title: 'Send external GPS', default: DEFAULT_OPTIONS.enableGps },
        enableDepth: { type: 'boolean', title: 'Send depth', default: DEFAULT_OPTIONS.enableDepth },
        enableAis: { type: 'boolean', title: 'Send AIS targets', default: DEFAULT_OPTIONS.enableAis },
        depthPath: { type: 'string', title: 'Primary depth path', default: DEFAULT_OPTIONS.depthPath, minLength: 1 },
        depthOffsetPath: { type: 'string', title: 'Transducer offset path', default: DEFAULT_OPTIONS.depthOffsetPath, minLength: 1 },
      }
    }),
    start,
    stop
  }

  function getSelf(path) {
    try { return ais.valueOf(app.getSelfPath(path)) } catch (_) { return undefined }
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

  function send(lines) {
    if (!socket) return
    const arr = Array.isArray(lines) ? lines : [lines]
    const valid = arr.filter(Boolean)
    if (!valid.length) return
    const payload = Buffer.from(valid.join('\r\n') + '\r\n', 'ascii')
    const destinations = []
    if (options.enableBroadcast && options.broadcastAddress) destinations.push(options.broadcastAddress)
    if (options.enableUnicast && options.destination && !destinations.includes(options.destination)) destinations.push(options.destination)
    for (const destination of destinations) {
      socket.send(payload, options.port, destination, err => {
        if (err) reportError(`UDP send error to ${destination}: ${err.message}`)
      })
    }
  }

  function reportError(message) {
    if (typeof app.setPluginError === 'function') app.setPluginError(message)
    if (typeof app.error === 'function') app.error(message)
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
    const now = new Date()
    send([rmc({ position, sog, cog, timestamp: now }), gga({ position, altitude, timestamp: now, satellites: sats, hdop }), vtg({ sog, cog })])
  }

  function emitDepth() {
    let depth = getSelf(options.depthPath)
    if (!Number.isFinite(depth)) depth = getSelf('environment.depth.belowSurface')
    if (!Number.isFinite(depth) || depth < 0) return
    let offset = getSelf(options.depthOffsetPath)
    if (!Number.isFinite(offset)) offset = getSelf('environment.depth.transducerToKeel')
    send([dbt(depth), dpt(depth, offset)])
  }

  function emitAis() {
    const vessels = getRootBranch('vessels')
    if (!vessels || typeof vessels !== 'object') return
    const selfId = app.selfId || (app.signalk && app.signalk.selfId)
    const now = new Date()
    const nowMs = Date.now()
    const out = []
    for (const [key, vessel0] of Object.entries(vessels)) {
      if (key === selfId || key === 'self') continue
      const vessel = ais.valueOf(vessel0)
      if (!vessel || typeof vessel !== 'object') continue
      const dyn = ais.dynamic(vessel, key, now)
      if (!dyn) continue
      out.push(...ais.toVdm(dyn.payload, dyn.fill, 'A'))
      const last = lastStatic.get(dyn.mmsi) || 0
      if (nowMs - last >= options.aisStaticIntervalMs) {
        for (const st of ais.staticMessages(vessel, key)) out.push(...ais.toVdm(st.payload, st.fill, 'A'))
        lastStatic.set(dyn.mmsi, nowMs)
      }
    }
    send(out)
  }

  function schedule(fn, ms) {
    fn()
    const t = setInterval(fn, ms)
    timers.push(t)
  }

  function start(opts) {
    stop()
    options = Object.assign({}, DEFAULT_OPTIONS, opts || {})
    const activeSocket = dgram.createSocket('udp4')
    socket = activeSocket
    activeSocket.on('error', err => reportError(`Signal K to Boating UDP error: ${err.message}`))
    activeSocket.bind(0, () => {
      if (socket !== activeSocket) return
      try { activeSocket.setBroadcast(Boolean(options.enableBroadcast)) } catch (_) {}
      const targets = []
      if (options.enableBroadcast) targets.push(`broadcast ${options.broadcastAddress}:${options.port}`)
      if (options.enableUnicast && options.destination) targets.push(`unicast ${options.destination}:${options.port}`)
      app.setPluginStatus(targets.length ? `Sending NMEA 0183 GPS/depth/AIS via ${targets.join(' + ')}` : 'NMEA 0183 output enabled but no UDP destination selected')
      if (options.enableGps) schedule(emitGps, options.gpsIntervalMs)
      if (options.enableDepth) schedule(emitDepth, options.depthIntervalMs)
      if (options.enableAis) schedule(emitAis, options.aisIntervalMs)
    })
  }

  function stop() {
    for (const t of timers) clearInterval(t)
    timers = []
    lastStatic.clear()
    if (socket) {
      try { socket.close() } catch (_) {}
      socket = null
    }
  }

  return plugin
}
