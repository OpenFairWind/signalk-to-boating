# Changelog

## 1.0.0
- Publish the first stable release of the Signal K GPS, depth, and AIS to NMEA 0183 UDP bridge.
- Document the stable 1.x npm installation path and the one-way Signal K data-flow guarantee.
- Preserve UDP port 2000, independent broadcast/unicast output, genuine AIVDM encoding, and restart-safe plugin lifecycle behavior.

## 0.4.3
- Make the App Store CI workflow metadata test portable across LF and CRLF checkouts.
- Refresh release documentation and package metadata for version 0.4.3.

## 0.4.2
- Add the canonical Signal K reusable CI caller to the published repository so the plugin registry can observe automated test results.
- Run unit, coverage, armv7/Cerbo GX, and Signal K integration checks in hosted CI.
- Add visible CI, npm release/download, and license indicators to the README.
- Document how App Store indicators differ from local validation and external popularity metrics.

## 0.4.1
- Stop fabricating GGA satellite count, HDOP, and altitude fields when Signal K does not provide them.
- Correct AIS Class B type 18 output from 169 bits to the standard 168-bit message length.
- Reject out-of-range AIS and own-vessel coordinates instead of encoding malformed or wrapped positions.
- Treat invalid negative AIS speeds as unavailable and clamp externally supplied static fields to their protocol ranges.
- Report UDP send and socket errors through both the Signal K plugin error status and server logging APIs.
- Add regression coverage for missing GGA data and invalid AIS positions.

## 0.4.0
- Add repository-wide `AGENTS.md` with implementation, testing, security, documentation, and npm release requirements.
- Prepare npm publication under the `uniparthenope` account while keeping the unscoped package name `signalk-to-boating`.
- Add explicit public `publishConfig`, package `exports`, homepage, and issue metadata.
- Centralize runtime/configuration defaults to prevent schema drift.
- Harden socket restart behavior so a delayed bind callback cannot revive timers after stop/restart.
- Align Node.js compatibility with Signal K's current Node 20+ guidance and canonical armv7 CI target.
- Refresh README and docs for npm installation, port 2000, release validation, and App Store/CI behavior.

## 0.3.0
- Change the default UDP port to 2000.
- Add Signal K App Store metadata, categories, icon and screenshot.
- Require Node.js 22 or newer to match current Signal K Server requirements.
- Add App Store/CI quality tests and reusable Signal K plugin CI workflow.
- Keep simultaneous UDP broadcast and unicast support.

## 0.2.0
- Added independent and simultaneous broadcast/unicast UDP output.
- Added architecture and getting-started documentation.

## 0.1.0
- Initial GPS, depth and AIS NMEA 0183 UDP output.
