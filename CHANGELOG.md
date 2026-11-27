# Changelog

## 1.1.0
- Stop re-broadcasting stale data: own-vessel GPS/depth values older than **Stop sending own GPS/depth values older than** (default 30 s) and AIS targets not heard for **Stop sending AIS targets not heard for** (default 600 s) are no longer sent. Values without a Signal K timestamp are still sent; `0` disables either check.
- Treat the Signal K `navigation.gnss.methodQuality` values `no GPS` and `Error` as no fix; 1.0.1 reported `no GPS` as a valid autonomous fix.
- Map Signal K `navigation.state` strings (`motoring`, `anchored`, `moored`, `sailing`, ...) to AIS navigational status; 1.0.1 always sent "not defined".
- Encode the AIS type 5 destination from `navigation.destination.commonName` (1.0.1 sent `[OBJECT OBJECT]`), the ETA from `navigation.destination.eta`, and the IMO number from `registrations.imo`; unknown ETA is now the standard 0/0/24/60.
- Encode AIS dimensions from `sensors.ais.fromBow`/`fromCenter` when present; otherwise use the ITU "reference point unknown" form (A = C = 0) instead of assuming a mid-ship antenna.
- Use the target's real report second in the AIS time stamp field, or 60 (not available) when unknown, instead of the current second.
- Wrap rounded course/heading at 360 to 0 in RMC, VTG and AIS; omit negative speed over ground; cap AIS rate of turn at +/-126.
- Never let an exception or synchronous `socket.send` error escape a timer and crash Signal K Server; report it through the plugin status instead.
- Throttle identical UDP error messages to one per minute and restore the running status after sends succeed again.
- Normalize stored configuration (missing/invalid port, intervals, booleans, padded IP addresses) to safe values.
- Convert any `*.transducerToKeel` offset path, not only the default, to a negative DPT offset; exclude the own vessel when it is identified only by `app.selfContext`; forget AIS static-report state for departed targets.
- Add repository CI (Node 20/22/24 tests, coverage, package verification, audit), a tag-driven npm release workflow using trusted publishing with provenance, Dependabot for GitHub Actions, and `npm run verify:package`.
- Add regression tests for every fix above.

## 1.0.1
- Correct AIS Class B type 24A and 24B static reports to their standard 160-bit and 168-bit lengths, including the full 42-bit type 24B vendor field.
- Convert the default positive Signal K transducer-to-keel distance to a negative NMEA DPT keel offset and stop relabeling below-surface depth as below-transducer depth.
- Carry coordinate minute rounding into the next degree and reject coordinates outside valid latitude/longitude ranges.
- Send AIS output as one complete CRLF-terminated sentence per UDP datagram while preserving fragment order and broadcast/unicast fan-out.
- Derive conservative RMC/VTG modes and GGA validity from Signal K GNSS method quality instead of claiming a fix from position alone.
- Add independent AIS bit decoding, coordinate/property checks, depth/GNSS integration coverage, transport stress coverage, and a dependency-free syntax-check command.

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
