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
  const limit = isLat ? 90 : 180
  if (!Number.isFinite(value) || value < -limit || value > limit) return ['', '']
  const hemi = value < 0 ? (isLat ? 'S' : 'W') : (isLat ? 'N' : 'E')
  const a = Math.abs(value)
  let deg = Math.floor(a)
  let minutes = Math.round((a - deg) * 60 * 1e5) / 1e5
  if (minutes >= 60) {
    deg += 1
    minutes = 0
  }
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

// Speed over ground cannot be negative; treat such input as unavailable.
function validSpeed(ms) {
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

// Format a 0..360 degree angle so rounding never yields 360.00.
function formatAngle(deg, digits = 2) {
  if (deg == null) return ''
  const scale = 10 ** digits
  let rounded = Math.round(deg * scale) / scale
  if (rounded >= 360) rounded -= 360
  return rounded.toFixed(digits)
}

function rmc({ position, sog, cog, timestamp = new Date(), valid = false, mode }) {
  const [lat, ns] = degreesToNmea(position && position.latitude, true)
  const [lon, ew] = degreesToNmea(position && position.longitude, false)
  const t = timeParts(timestamp)
  const sogKn = msToKnots(validSpeed(sog))
  return sentence('GPRMC', [
    t.time, valid ? 'A' : 'V', lat, ns, lon, ew,
    sogKn == null ? '' : sogKn.toFixed(2),
    formatAngle(radToDeg(cog)),
    t.date, '', '', mode || (valid ? 'A' : 'N')
  ])
}

function gga({ position, altitude, timestamp = new Date(), satellites, hdop, fixQuality = 0 }) {
  const [lat, ns] = degreesToNmea(position && position.latitude, true)
  const [lon, ew] = degreesToNmea(position && position.longitude, false)
  const t = timeParts(timestamp)
  return sentence('GPGGA', [
    t.time, lat, ns, lon, ew, String(fixQuality),
    Number.isFinite(satellites) ? String(Math.max(0, Math.round(satellites))).padStart(2, '0') : '',
    Number.isFinite(hdop) ? hdop.toFixed(1) : '',
    Number.isFinite(altitude) ? altitude.toFixed(1) : '', 'M', '', 'M', '', ''
  ])
}

function vtg({ sog, cog, mode = 'N' }) {
  const speed = validSpeed(sog)
  const sogKn = msToKnots(speed)
  const kmh = speed == null ? null : speed * 3.6
  return sentence('GPVTG', [
    formatAngle(radToDeg(cog)), 'T', '', 'M',
    sogKn == null ? '' : sogKn.toFixed(2), 'N',
    kmh == null ? '' : kmh.toFixed(2), 'K', mode
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

module.exports = { checksum, sentence, bangSentence, degreesToNmea, rmc, gga, vtg, dbt, dpt, radToDeg, msToKnots, validSpeed, formatAngle }
