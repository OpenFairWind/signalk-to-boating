'use strict'

function checksum(body) {
  let cs = 0
  for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i)
  return cs.toString(16).toUpperCase().padStart(2, '0')
}

function sentence(prefix, fields) {
  const body = prefix + ',' + fields.join(',')
  return `$${body}*${checksum(body)}`
}

function bangSentence(prefix, fields) {
  const body = prefix + ',' + fields.join(',')
  return `!${body}*${checksum(body)}`
}

function degreesToNmea(value, isLat) {
  if (!Number.isFinite(value)) return ['', '']
  const hemi = value < 0 ? (isLat ? 'S' : 'W') : (isLat ? 'N' : 'E')
  const a = Math.abs(value)
  const deg = Math.floor(a)
  const minutes = (a - deg) * 60
  const width = isLat ? 2 : 3
  return [`${String(deg).padStart(width, '0')}${minutes.toFixed(5).padStart(8, '0')}`, hemi]
}

function timeParts(date) {
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  const ss = String(date.getUTCSeconds()).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0')
  const yy = String(date.getUTCFullYear() % 100).padStart(2, '0')
  return { time: `${hh}${mm}${ss}.00`, date: `${dd}${mo}${yy}` }
}

function radToDeg(rad) {
  if (!Number.isFinite(rad)) return null
  let d = rad * 180 / Math.PI
  d %= 360
  if (d < 0) d += 360
  return d
}

function msToKnots(ms) {
  return Number.isFinite(ms) ? ms * 1.9438444924406 : null
}

function rmc({ position, sog, cog, timestamp = new Date(), valid = true }) {
  const [lat, ns] = degreesToNmea(position && position.latitude, true)
  const [lon, ew] = degreesToNmea(position && position.longitude, false)
  const t = timeParts(timestamp)
  const sogKn = msToKnots(sog)
  const cogDeg = radToDeg(cog)
  return sentence('GPRMC', [
    t.time, valid ? 'A' : 'V', lat, ns, lon, ew,
    sogKn == null ? '' : sogKn.toFixed(2),
    cogDeg == null ? '' : cogDeg.toFixed(2),
    t.date, '', '', 'A'
  ])
}

function gga({ position, altitude, timestamp = new Date(), satellites, hdop }) {
  const [lat, ns] = degreesToNmea(position && position.latitude, true)
  const [lon, ew] = degreesToNmea(position && position.longitude, false)
  const t = timeParts(timestamp)
  return sentence('GPGGA', [
    t.time, lat, ns, lon, ew, '1',
    Number.isFinite(satellites) ? String(Math.max(0, Math.round(satellites))).padStart(2, '0') : '',
    Number.isFinite(hdop) ? hdop.toFixed(1) : '',
    Number.isFinite(altitude) ? altitude.toFixed(1) : '', 'M', '', 'M', '', ''
  ])
}

function vtg({ sog, cog }) {
  const sogKn = msToKnots(sog)
  const cogDeg = radToDeg(cog)
  const kmh = Number.isFinite(sog) ? sog * 3.6 : null
  return sentence('GPVTG', [
    cogDeg == null ? '' : cogDeg.toFixed(2), 'T', '', 'M',
    sogKn == null ? '' : sogKn.toFixed(2), 'N',
    kmh == null ? '' : kmh.toFixed(2), 'K', 'A'
  ])
}

function dbt(depthM) {
  const feet = depthM * 3.280839895
  const fathoms = depthM / 1.8288
  return sentence('SDDBT', [feet.toFixed(1), 'f', depthM.toFixed(1), 'M', fathoms.toFixed(1), 'F'])
}

function dpt(depthM, offsetM) {
  return sentence('SDDPT', [depthM.toFixed(1), Number.isFinite(offsetM) ? offsetM.toFixed(1) : ''])
}

module.exports = { checksum, sentence, bangSentence, rmc, gga, vtg, dbt, dpt, radToDeg, msToKnots }
