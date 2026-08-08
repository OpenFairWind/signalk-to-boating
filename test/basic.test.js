'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const nmea = require('../nmea')
const ais = require('../ais')

test('RMC has checksum and contains coordinates', () => {
  const s = nmea.rmc({ position: { latitude: 40.75, longitude: 14.25 }, sog: 5, cog: Math.PI/2, timestamp: new Date('2026-08-08T05:00:00Z') })
  assert.match(s, /^\$GPRMC,050000\.00,A,4045\.00000,N,01415\.00000,E,/)
  assert.match(s, /\*[0-9A-F]{2}$/)
})

test('Depth sentences are valid NMEA framed strings', () => {
  assert.match(nmea.dbt(10), /^\$SDDBT,32\.8,f,10\.0,M,5\.5,F\*[0-9A-F]{2}$/)
  assert.match(nmea.dpt(10, 0.5), /^\$SDDPT,10\.0,0\.5\*[0-9A-F]{2}$/)
})

test('GGA leaves unavailable fix details empty instead of fabricating values', () => {
  const s = nmea.gga({ position: { latitude: 40.75, longitude: 14.25 }, timestamp: new Date('2026-08-08T05:00:00Z') })
  assert.match(s, /^\$GPGGA,050000\.00,4045\.00000,N,01415\.00000,E,1,,,,M,,M,,\*[0-9A-F]{2}$/)
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
  assert.equal(ais.staticMessages(vessel, '').length, 2)
})

test('AIS rejects out-of-range target coordinates instead of wrapping them', () => {
  const vessel = {
    mmsi: { value: '247654321' },
    navigation: { position: { value: { latitude: 91, longitude: 14 } } }
  }
  assert.equal(ais.dynamic(vessel, '', new Date()), null)
})
