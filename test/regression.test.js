'use strict'

// Regression tests for defects fixed in 1.1.0. Each test failed against 1.0.1.

const test = require('node:test')
const assert = require('node:assert/strict')
const dgram = require('node:dgram')
const nmea = require('../nmea')
const ais = require('../ais')
const pluginFactory = require('../index')

function payloadBits(payload, fill = 0) {
  const bits = []
  for (const char of payload) {
    const code = char.charCodeAt(0)
    const value = code - (code < 88 ? 48 : 56)
    for (let bit = 5; bit >= 0; bit--) bits.push((value >> bit) & 1)
  }
  return bits.slice(0, bits.length - fill)
}

function unsigned(bits, start, width) {
  let value = 0
  for (let i = start; i < start + width; i++) value = value * 2 + bits[i]
  return value
}

function signed(bits, start, width) {
  const value = unsigned(bits, start, width)
  return value >= 2 ** (width - 1) ? value - 2 ** width : value
}

function aisText(bits, start, chars) {
  let text = ''
  for (let i = 0; i < chars; i++) {
    const value = unsigned(bits, start + i * 6, 6)
    text += String.fromCharCode(value < 32 ? value + 64 : value)
  }
  return text.replace(/@+$/, '').trimEnd()
}

function decodeVdmLines(lines) {
  const fields = lines.map(line => line.slice(1, line.indexOf('*')).split(','))
  const payload = fields.map(f => f[5]).join('')
  return payloadBits(payload, Number(fields[fields.length - 1][6]))
}

function appMock(overrides = {}) {
  return Object.assign({
    selfId: 'urn:mrn:signalk:uuid:self',
    getSelfPath: () => undefined,
    getPath: () => undefined,
    setPluginStatus: () => {},
    setPluginError: () => {},
    debug: () => {},
    error: () => {}
  }, overrides)
}

function withMockSocket(sendImpl, fn) {
  const original = dgram.createSocket
  dgram.createSocket = () => ({
    on: () => {},
    bind: (_port, callback) => callback(),
    setBroadcast: () => {},
    close: () => {},
    send: sendImpl
  })
  try { return fn() } finally { dgram.createSocket = original }
}

const OFF = { enableBroadcast: true, enableUnicast: false, enableGps: false, enableDepth: false, enableAis: false }

// Start the plugin once with a synchronous mock socket and return the datagrams
// produced by the first emission cycle.
function capture(app, opts) {
  const sends = []
  withMockSocket((payload, port, destination, cb) => {
    sends.push({ text: payload.toString('ascii'), port, destination })
    if (cb) cb()
  }, () => {
    const plugin = pluginFactory(app)
    plugin.start(Object.assign({}, OFF, opts))
    plugin.stop()
  })
  return sends
}

function node(value, ageMs) {
  return ageMs == null ? { value } : { value, timestamp: new Date(Date.now() - ageMs).toISOString() }
}

const POSITION = { latitude: 40.75, longitude: 14.25 }

test('Signal K "no GPS" and "Error" method quality are not reported as a valid fix', () => {
  for (const quality of ['no GPS', 'Error', 'no GNSS']) {
    const app = appMock({ getSelfPath: p => ({ 'navigation.position': POSITION, 'navigation.gnss.methodQuality': quality })[p] })
    const [send] = capture(app, { enableGps: true })
    assert.match(send.text, /\$GPRMC,[^\r]+,V,[^\r]+,N\*/, quality)
    assert.match(send.text, /\$GPGGA,[^,]+,[^,]+,N,[^,]+,E,0,/, quality)
  }
  assert.deepEqual(pluginFactory.gnssQualityFrom('RTK fixed integer'), { valid: true, mode: 'R', fixQuality: 4 })
  assert.deepEqual(pluginFactory.gnssQualityFrom('Simulator mode'), { valid: true, mode: 'S', fixQuality: 8 })
  assert.deepEqual(pluginFactory.gnssQualityFrom('Estimated (DR) mode'), { valid: true, mode: 'E', fixQuality: 6 })
  assert.deepEqual(pluginFactory.gnssQualityFrom('DGNSS fix'), { valid: true, mode: 'D', fixQuality: 2 })
})

test('stale own-vessel position and depth are not re-broadcast as current data', () => {
  const values = {
    'navigation.position': node(POSITION, 120000),
    'navigation.gnss.methodQuality': node('GNSS Fix', 120000),
    'environment.depth.belowTransducer': node(10, 120000)
  }
  const app = appMock({ getSelfPath: p => values[p] })
  assert.equal(capture(app, { enableGps: true, enableDepth: true }).length, 0)

  // A limit of 0 disables the freshness check.
  assert.equal(capture(app, { enableGps: true, enableDepth: true, ownDataMaxAgeSeconds: 0 }).length, 2)

  // Fresh timestamps are sent normally.
  values['navigation.position'] = node(POSITION, 500)
  values['navigation.gnss.methodQuality'] = node('GNSS Fix', 500)
  values['environment.depth.belowTransducer'] = node(10, 500)
  const sends = capture(app, { enableGps: true, enableDepth: true })
  assert.equal(sends.length, 2)
  assert.match(sends[0].text, /\$GPRMC,[^\r]+,A,/)
})

test('stale auxiliary GNSS fields are omitted while a fresh position is still sent', () => {
  const values = {
    'navigation.position': node(POSITION, 100),
    'navigation.gnss.methodQuality': node('GNSS Fix', 100),
    'navigation.speedOverGround': node(5, 600000)
  }
  const [send] = capture(appMock({ getSelfPath: p => values[p] }), { enableGps: true })
  assert.match(send.text, /\$GPRMC,[^,]+,A,[^,]+,N,[^,]+,E,,/)
})

test('AIS targets not heard within the configured age are dropped', () => {
  const vessel = (mmsi, ageMs) => ({
    mmsi: { value: mmsi },
    navigation: { position: node({ latitude: 40.8, longitude: 14.2 }, ageMs) }
  })
  const vessels = {
    'urn:mrn:imo:mmsi:247000001': vessel('247000001', 1000),
    'urn:mrn:imo:mmsi:247000002': vessel('247000002', 3600 * 1000),
    'urn:mrn:imo:mmsi:247000003': vessel('247000003', undefined)
  }
  const app = appMock({ getPath: p => p === 'vessels' ? vessels : undefined })
  const mmsis = sends => new Set(sends
    .map(s => s.text.trim())
    .filter(line => line.startsWith('!AIVDM,1,1'))
    .map(line => unsigned(decodeVdmLines([line]), 8, 30)))
  assert.deepEqual(mmsis(capture(app, { enableAis: true })), new Set([247000001, 247000003]))
  assert.deepEqual(mmsis(capture(app, { enableAis: true, aisMaxAgeSeconds: 0 })), new Set([247000001, 247000002, 247000003]))
})

test('AIS time stamp field uses the report second, or 60 when unknown', () => {
  const position = { latitude: 40.8, longitude: 14.2 }
  const withTs = { mmsi: '247000001', navigation: { position: { value: position, timestamp: '2026-11-26T10:11:37.000Z' } } }
  const withoutTs = { mmsi: '247000001', navigation: { position: { value: position } } }
  const at = new Date('2026-11-26T10:11:42Z')
  assert.equal(unsigned(payloadBits(ais.dynamic(withTs, '', at).payload, 0), 137, 6), 37)
  assert.equal(unsigned(payloadBits(ais.dynamic(withoutTs, '', at).payload, 0), 137, 6), 60)
  const classB = { ...withoutTs, sensors: { ais: { class: 'B' } } }
  assert.equal(unsigned(payloadBits(ais.dynamic(classB, '', at).payload, 0), 133, 6), 60)
})

test('Signal K navigation.state strings map to AIS navigational status', () => {
  const cases = { motoring: 0, anchored: 1, 'not under command': 2, 'restricted manouverability': 3,
    'constrained by draft': 4, moored: 5, aground: 6, fishing: 7, sailing: 8, 'ais-sart': 14, default: 15, 'not-under-way': 15 }
  for (const [state, code] of Object.entries(cases)) {
    const vessel = { mmsi: '247000001', navigation: { state: { value: state }, position: { value: POSITION } } }
    assert.equal(ais.navStatus(vessel), code, state)
    assert.equal(unsigned(payloadBits(ais.dynamic(vessel, '').payload, 0), 38, 4), code, state)
  }
})

test('AIS rate of turn never encodes the reserved +/-127 "no turn indicator" value', () => {
  assert.equal(ais.rotCode(10), 126)
  assert.equal(ais.rotCode(-10), -126)
  assert.equal(ais.rotCode(undefined), -128)
})

test('course and heading rounding wraps to 0 instead of 360', () => {
  const almostNorth = 2 * Math.PI - 1e-6
  const rmc = nmea.rmc({ position: POSITION, sog: 1, cog: almostNorth, valid: true })
  assert.match(rmc, /,0\.00,\d{6},/)
  assert.doesNotMatch(rmc, /360\.00/)
  assert.match(nmea.vtg({ sog: 1, cog: almostNorth }), /^\$GPVTG,0\.00,T,/)
  const vessel = { mmsi: '247000001', navigation: {
    position: { value: POSITION }, courseOverGroundTrue: { value: almostNorth }, headingTrue: { value: almostNorth } } }
  const bits = payloadBits(ais.dynamic(vessel, '').payload, 0)
  assert.equal(unsigned(bits, 116, 12), 0)
  assert.equal(unsigned(bits, 128, 9), 0)
})

test('negative speed over ground is treated as unavailable in NMEA output', () => {
  assert.match(nmea.rmc({ position: POSITION, sog: -1, valid: true }), /,E,,,/)
  assert.match(nmea.vtg({ sog: -1 }), /^\$GPVTG,,T,,M,,N,,K,N\*/)
})

test('AIS type 5 encodes the Signal K destination object, ETA, and IMO number', () => {
  const vessel = {
    mmsi: { value: '247123456' }, name: 'TEST SHIP',
    registrations: { imo: { value: 'IMO 9074729' } },
    navigation: { destination: { commonName: { value: 'NAPLES' }, eta: { value: '2026-12-03T14:25:00Z' } } }
  }
  const [message] = ais.staticMessages(vessel, '')
  const bits = payloadBits(message.payload, message.fill)
  assert.equal(unsigned(bits, 40, 30), 9074729)
  assert.equal(unsigned(bits, 274, 4), 12)
  assert.equal(unsigned(bits, 278, 5), 3)
  assert.equal(unsigned(bits, 283, 5), 14)
  assert.equal(unsigned(bits, 288, 6), 25)
  assert.equal(aisText(bits, 302, 20), 'NAPLES')
})

test('AIS type 5 marks missing ETA and destination as not available', () => {
  const [message] = ais.staticMessages({ mmsi: '247123456' }, '')
  const bits = payloadBits(message.payload, message.fill)
  assert.equal(unsigned(bits, 40, 30), 0)
  assert.deepEqual([unsigned(bits, 274, 4), unsigned(bits, 278, 5), unsigned(bits, 283, 5), unsigned(bits, 288, 6)], [0, 0, 24, 60])
  assert.equal(aisText(bits, 302, 20), '')
})

test('AIS dimensions use the Signal K AIS reference point, or A=C=0 when unknown', () => {
  const base = { mmsi: '247123456', design: { length: { value: { overall: 30 } }, beam: { value: 8 } } }
  assert.deepEqual(ais.dimensions(base), { toBow: 0, toStern: 30, toPort: 0, toStarboard: 8 })
  const located = { ...base, sensors: { ais: { fromBow: { value: 10 }, fromCenter: { value: 1 } } } }
  // fromCenter is positive to starboard: 1 m starboard of the centreline.
  assert.deepEqual(ais.dimensions(located), { toBow: 10, toStern: 20, toPort: 5, toStarboard: 3 })
  const [message] = ais.staticMessages(located, '')
  const bits = payloadBits(message.payload, message.fill)
  assert.deepEqual([unsigned(bits, 240, 9), unsigned(bits, 249, 9), unsigned(bits, 258, 6), unsigned(bits, 264, 6)], [10, 20, 5, 3])
})

test('an exception while building output is reported instead of escaping the timer', () => {
  const errors = []
  const vessels = {}
  Object.defineProperty(vessels, 'urn:mrn:imo:mmsi:247000001', { enumerable: true, get() { throw new Error('boom') } })
  const app = appMock({ getPath: p => p === 'vessels' ? vessels : undefined, setPluginError: m => errors.push(m) })
  assert.doesNotThrow(() => capture(app, { enableAis: true }))
  assert.equal(errors.length, 1)
  assert.match(errors[0], /AIS output failed: boom/)
})

test('a synchronous socket.send exception is reported instead of crashing', () => {
  const errors = []
  const app = appMock({
    getSelfPath: p => ({ 'environment.depth.belowTransducer': 5 })[p],
    setPluginError: m => errors.push(m)
  })
  withMockSocket(() => { throw new RangeError('Port should be > 0') }, () => {
    const plugin = pluginFactory(app)
    assert.doesNotThrow(() => plugin.start(Object.assign({}, OFF, { enableDepth: true })))
    plugin.stop()
  })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /UDP send error to 255\.255\.255\.255: Port should be > 0/)
})

test('repeated identical UDP errors are throttled and status recovers after a successful send', () => {
  const errors = []
  const statuses = []
  const vessels = {}
  for (let i = 0; i < 20; i++) vessels[`urn:mrn:imo:mmsi:2470000${String(i).padStart(2, '0')}`] = { navigation: { position: { value: POSITION } } }
  const app = appMock({
    getPath: p => p === 'vessels' ? vessels : undefined,
    getSelfPath: p => ({ 'environment.depth.belowTransducer': 5 })[p],
    setPluginError: m => errors.push(m),
    setPluginStatus: m => statuses.push(m)
  })
  let fail = true
  withMockSocket((_payload, _port, _destination, cb) => cb(fail ? new Error('EHOSTUNREACH') : null), () => {
    const plugin = pluginFactory(app)
    plugin.start(Object.assign({}, OFF, { enableAis: true }))
    assert.equal(errors.length, 1, 'identical errors for many datagrams are logged once')
    assert.equal(statuses.length, 1)
    fail = false
    plugin.start(Object.assign({}, OFF, { enableAis: true, enableDepth: true }))
    plugin.stop()
  })
  // Restart resets status; a later successful send re-asserts the running status after an error.
  const recovering = []
  const recoveryApp = appMock({
    getSelfPath: p => ({ 'environment.depth.belowTransducer': 5 })[p],
    setPluginError: () => {},
    setPluginStatus: m => recovering.push(m)
  })
  let calls = 0
  withMockSocket((_payload, _port, _destination, cb) => cb(calls++ === 0 ? new Error('ENETDOWN') : null), () => {
    const plugin = pluginFactory(recoveryApp)
    plugin.start(Object.assign({}, OFF, { enableDepth: true, enableUnicast: true, destination: '192.0.2.10' }))
    plugin.stop()
  })
  assert.equal(recovering.length, 2)
  assert.equal(recovering[0], recovering[1])
})

test('AIS static reports are re-sent promptly when a target disappears and returns', t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const target = {
    mmsi: { value: '247000001' }, name: { value: 'RETURNING' },
    navigation: { position: { value: POSITION } }
  }
  const vessels = { 'urn:mrn:imo:mmsi:247000001': target }
  const app = appMock({ getPath: p => p === 'vessels' ? vessels : undefined })
  const cycles = []
  let current = []
  withMockSocket((payload, _port, _destination, cb) => { current.push(payload.toString('ascii')); cb() }, () => {
    const plugin = pluginFactory(app)
    plugin.start(Object.assign({}, OFF, { enableAis: true, aisIntervalMs: 500 }))
    cycles.push(current); current = []
    delete vessels['urn:mrn:imo:mmsi:247000001']
    t.mock.timers.tick(500)
    cycles.push(current); current = []
    vessels['urn:mrn:imo:mmsi:247000001'] = target
    t.mock.timers.tick(500)
    cycles.push(current); current = []
    plugin.stop()
  })
  const hasStatic = lines => lines.some(line => line.startsWith('!AIVDM,2,'))
  assert.equal(hasStatic(cycles[0]), true)
  assert.equal(cycles[1].length, 0)
  assert.equal(hasStatic(cycles[2]), true)
})

test('configuration is normalized so invalid stored values cannot break output', () => {
  const n = pluginFactory.normalizeOptions
  assert.equal(n({ port: null }).port, 2000)
  assert.equal(n({ port: '2001' }).port, 2001)
  assert.equal(n({ port: 70000 }).port, 2000)
  assert.equal(n({ port: 0 }).port, 2000)
  assert.equal(n({ gpsIntervalMs: 0 }).gpsIntervalMs, 200)
  assert.equal(n({ aisIntervalMs: null }).aisIntervalMs, 2000)
  assert.equal(n({ destination: ' 192.0.2.10 ' }).destination, '192.0.2.10')
  assert.equal(n({ broadcastAddress: '' }).broadcastAddress, '255.255.255.255')
  assert.equal(n({ enableBroadcast: 'yes' }).enableBroadcast, true)
  assert.equal(n({ ownDataMaxAgeSeconds: -5 }).ownDataMaxAgeSeconds, 0)
  assert.deepEqual(n(undefined), { ...pluginFactory.DEFAULT_OPTIONS })
})

test('every schema default matches the runtime default', () => {
  const schema = pluginFactory(appMock()).schema()
  assert.deepEqual(Object.keys(schema.properties).sort(), Object.keys(pluginFactory.DEFAULT_OPTIONS).sort())
  for (const [key, prop] of Object.entries(schema.properties)) {
    assert.equal(prop.default, pluginFactory.DEFAULT_OPTIONS[key], key)
  }
  assert.equal(schema.properties.ownDataMaxAgeSeconds.default, 30)
  assert.equal(schema.properties.aisMaxAgeSeconds.default, 600)
})

test('a custom transducer-to-keel offset path is also converted to a negative DPT offset', () => {
  const values = { 'environment.depth.belowTransducer': 10, 'custom.depth.transducerToKeel': 0.7, 'environment.depth.surfaceToTransducer': 0.4 }
  const app = appMock({ getSelfPath: p => values[p] })
  assert.match(capture(app, { enableDepth: true, depthOffsetPath: 'custom.depth.transducerToKeel' })[0].text, /\$SDDPT,10\.0,-0\.7\*/)
  assert.match(capture(app, { enableDepth: true, depthOffsetPath: 'environment.depth.surfaceToTransducer' })[0].text, /\$SDDPT,10\.0,0\.4\*/)
})

test('the own vessel is excluded from AIS output when identified by selfContext only', () => {
  const vessels = { 'urn:mrn:imo:mmsi:247999999': { mmsi: '247999999', navigation: { position: { value: POSITION } } } }
  const app = appMock({ selfId: undefined, selfContext: 'vessels.urn:mrn:imo:mmsi:247999999', getPath: p => p === 'vessels' ? vessels : undefined })
  assert.equal(capture(app, { enableAis: true }).length, 0)
})

test('signed AIS coordinates survive the regression helpers', () => {
  const d = ais.dynamic({ mmsi: '247000001', navigation: { position: { value: { latitude: -33.5, longitude: -70.25 } } } }, '')
  const bits = payloadBits(d.payload, d.fill)
  assert.equal(signed(bits, 61, 28), Math.round(-70.25 * 600000))
  assert.equal(signed(bits, 89, 27), Math.round(-33.5 * 600000))
})
