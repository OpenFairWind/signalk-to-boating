'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const nmea = require('../nmea')
const ais = require('../ais')

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

function validChecksum(line) {
  const marker = line.lastIndexOf('*')
  return marker > 0 && nmea.checksum(line.slice(1, marker)) === line.slice(marker + 1)
}

test('RMC has checksum and contains coordinates', () => {
  const s = nmea.rmc({ position: { latitude: 40.75, longitude: 14.25 }, sog: 5, cog: Math.PI/2, timestamp: new Date('2026-08-08T05:00:00Z'), valid: true })
  assert.match(s, /^\$GPRMC,050000\.00,A,4045\.00000,N,01415\.00000,E,/)
  assert.match(s, /\*[0-9A-F]{2}$/)
})

test('Depth sentences are valid NMEA framed strings', () => {
  assert.match(nmea.dbt(10), /^\$SDDBT,32\.8,f,10\.0,M,5\.5,F\*[0-9A-F]{2}$/)
  assert.match(nmea.dpt(10, 0.5), /^\$SDDPT,10\.0,0\.5\*[0-9A-F]{2}$/)
})

test('GGA leaves unavailable fix details empty instead of fabricating values', () => {
  const s = nmea.gga({ position: { latitude: 40.75, longitude: 14.25 }, timestamp: new Date('2026-08-08T05:00:00Z') })
  assert.match(s, /^\$GPGGA,050000\.00,4045\.00000,N,01415\.00000,E,0,,,,M,,M,,\*[0-9A-F]{2}$/)
  assert.doesNotMatch(s, /,08,1\.0,0\.0,M,/)
})

test('AIS class A dynamic creates a one-fragment VDM sentence', () => {
  const vessel = {
    mmsi: { value: '247123456' },
    navigation: {
      position: { value: { latitude: 40.8, longitude: 14.2 } },
      speedOverGround: { value: 4 },
      courseOverGroundTrue: { value: 1.2 },
      headingTrue: { value: 1.1 }
    },
    sensors: { ais: { class: { value: 'A' } } }
  }
  const d = ais.dynamic(vessel, 'urn:mrn:imo:mmsi:247123456', new Date('2026-08-08T05:00:10Z'))
  assert.equal(d.cls, 'A')
  const lines = ais.toVdm(d.payload, d.fill)
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^!AIVDM,1,1,,A,[0-9:;<=>?@A-W`a-w]+,[0-5]\*[0-9A-F]{2}$/)
  const bits = payloadBits(d.payload, d.fill)
  assert.equal(bits.length, 168)
  assert.equal(unsigned(bits, 0, 6), 1)
  assert.equal(unsigned(bits, 8, 30), 247123456)
  assert.equal(unsigned(bits, 38, 4), 15)
  assert.equal(unsigned(bits, 50, 10), Math.round(nmea.msToKnots(4) * 10))
  assert.equal(signed(bits, 61, 28), Math.round(14.2 * 600000))
  assert.equal(signed(bits, 89, 27), Math.round(40.8 * 600000))
  assert.equal(unsigned(bits, 116, 12), Math.round(nmea.radToDeg(1.2) * 10))
  assert.equal(unsigned(bits, 128, 9), Math.round(nmea.radToDeg(1.1)))
  assert.equal(validChecksum(lines[0]), true)
})

test('AIS class B creates type 18 and type 24 parts', () => {
  const vessel = {
    mmsi: { value: '247654321' }, name: { value: 'TEST BOAT' },
    navigation: { position: { value: { latitude: 41, longitude: 14 } } },
    sensors: { ais: { class: { value: 'B' } } }
  }
  const d = ais.dynamic(vessel, '', new Date())
  assert.equal(d.cls, 'B')
  assert.equal(d.payload.length * 6 - d.fill, 168)
  const dynamicBits = payloadBits(d.payload, d.fill)
  assert.equal(unsigned(dynamicBits, 0, 6), 18)
  assert.equal(unsigned(dynamicBits, 8, 30), 247654321)
  assert.equal(signed(dynamicBits, 57, 28), 14 * 600000)
  assert.equal(signed(dynamicBits, 85, 27), 41 * 600000)
  const messages = ais.staticMessages(vessel, '')
  assert.equal(messages.length, 2)
  const [partA, partB] = messages.map(message => payloadBits(message.payload, message.fill))
  assert.equal(partA.length, 160)
  assert.equal(partB.length, 168)
  assert.equal(unsigned(partA, 0, 6), 24)
  assert.equal(unsigned(partA, 38, 2), 0)
  assert.equal(unsigned(partB, 0, 6), 24)
  assert.equal(unsigned(partB, 38, 2), 1)
  assert.equal(unsigned(partA, 8, 30), 247654321)
  assert.equal(unsigned(partB, 8, 30), 247654321)
  assert.equal(aisText(partA, 40, 20), 'TEST BOAT')
  assert.equal(partA.length % 6, 4)
  assert.equal(messages[0].fill, 2)
  assert.equal(messages[1].fill, 0)
})

test('AIS type 5 static fields have standard length and semantic values', () => {
  const vessel = {
    mmsi: { value: '247123456' }, name: { value: 'TEST SHIP' },
    communication: { callsignVhf: { value: 'IZ1234' } },
    design: {
      aisShipType: { value: { id: 70 } },
      length: { overall: { value: 30 } },
      beam: { value: 8 },
      draft: { value: { current: 2.4 } }
    },
    navigation: { destination: { value: 'NAPLES' } },
    sensors: { ais: { class: { value: 'A' } } }
  }
  const message = ais.staticMessages(vessel, '')[0]
  const bits = payloadBits(message.payload, message.fill)
  assert.equal(bits.length, 424)
  assert.equal(unsigned(bits, 0, 6), 5)
  assert.equal(unsigned(bits, 8, 30), 247123456)
  assert.equal(aisText(bits, 70, 7), 'IZ1234')
  assert.equal(aisText(bits, 112, 20), 'TEST SHIP')
  assert.equal(unsigned(bits, 232, 8), 70)
  assert.equal(unsigned(bits, 240, 9) + unsigned(bits, 249, 9), 30)
  assert.equal(unsigned(bits, 258, 6) + unsigned(bits, 264, 6), 8)
  assert.equal(unsigned(bits, 294, 8), 24)
  assert.equal(aisText(bits, 302, 20), 'NAPLES')
  assert.equal(message.fill, 2)
})

test('AIS type 24 text fields truncate and pad according to field widths', () => {
  const vessel = {
    mmsi: { value: '247654321' },
    name: { value: 'A NAME LONGER THAN TWENTY CHARS' },
    communication: { callsignVhf: { value: 'CALLSIGN9' } },
    sensors: { ais: { class: { value: 'B' } } }
  }
  const [a, b] = ais.staticMessages(vessel, '')
  const aBits = payloadBits(a.payload, a.fill)
  const bBits = payloadBits(b.payload, b.fill)
  assert.equal(aisText(aBits, 40, 20), 'A NAME LONGER THAN T')
  assert.equal(aisText(bBits, 90, 7), 'CALLSIG')
  for (const message of [a, b]) {
    for (const line of ais.toVdm(message.payload, message.fill)) assert.equal(validChecksum(line), true)
  }
})

test('AIVDM fragmentation preserves ordering, sequence metadata, fill bits, and payload', () => {
  const vessel = {
    mmsi: { value: '247123456' }, name: { value: 'FRAGMENT TEST' },
    communication: { callsignVhf: { value: 'IZ1234' } },
    sensors: { ais: { class: { value: 'A' } } }
  }
  const message = ais.staticMessages(vessel, '')[0]
  const lines = ais.toVdm(message.payload, message.fill)
  assert.equal(lines.length, 2)
  const fields = lines.map(line => line.slice(1, line.indexOf('*')).split(','))
  assert.deepEqual(fields.map(field => field.slice(1, 4)), [['2', '1', fields[0][3]], ['2', '2', fields[0][3]]])
  assert.notEqual(fields[0][3], '')
  assert.equal(fields[0][6], '0')
  assert.equal(Number(fields[1][6]), message.fill)
  assert.equal(fields.map(field => field[5]).join(''), message.payload)
  assert.ok(lines.every(validChecksum))
})

test('coordinate formatting carries rounded minutes and rejects invalid ranges', () => {
  assert.deepEqual(nmea.degreesToNmea(0, true), ['0000.00000', 'N'])
  assert.deepEqual(nmea.degreesToNmea(-12.5, true), ['1230.00000', 'S'])
  assert.deepEqual(nmea.degreesToNmea(12.999999999, true), ['1300.00000', 'N'])
  assert.deepEqual(nmea.degreesToNmea(89.999999999, true), ['9000.00000', 'N'])
  assert.deepEqual(nmea.degreesToNmea(179.999999999, false), ['18000.00000', 'E'])
  assert.deepEqual(nmea.degreesToNmea(90, true), ['9000.00000', 'N'])
  assert.deepEqual(nmea.degreesToNmea(180, false), ['18000.00000', 'E'])
  assert.deepEqual(nmea.degreesToNmea(-90.000001, true), ['', ''])
  assert.deepEqual(nmea.degreesToNmea(180.000001, false), ['', ''])
})

test('protocol helper invariants hold across representative coordinate values', () => {
  for (let i = 0; i <= 2000; i++) {
    const latitude = -90 + i * 180 / 2000
    const longitude = -180 + i * 360 / 2000
    for (const [value, isLat] of [[latitude, true], [longitude, false]]) {
      const [encoded] = nmea.degreesToNmea(value, isLat)
      const degreeWidth = isLat ? 2 : 3
      assert.ok(Number(encoded.slice(degreeWidth)) < 60)
    }
    const line = nmea.rmc({ position: { latitude, longitude }, timestamp: new Date(0) })
    assert.equal(validChecksum(line), true)
    assert.doesNotMatch(line, /NaN|Infinity/)
  }
})

test('AIS rejects out-of-range target coordinates instead of wrapping them', () => {
  const vessel = {
    mmsi: { value: '247654321' },
    navigation: { position: { value: { latitude: 91, longitude: 14 } } }
  }
  assert.equal(ais.dynamic(vessel, '', new Date()), null)
})
