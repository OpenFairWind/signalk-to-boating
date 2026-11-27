# Signal K to Boating — Architecture

## Objective

Signal K to Boating is a one-way protocol bridge from the Signal K data model to NMEA 0183 over UDP. Its primary interoperability target is Garmin/Navionics Boating, while keeping the output usable by other standards-compliant marine NMEA 0183 consumers.

The 1.0 release establishes this one-way bridge, its standards-based sentence families, and its UDP defaults as the stable public contract. Future incompatible configuration or output changes require a new major version.

The plugin has three functional goals:

1. make Signal K own-vessel navigation visible as an external GPS source;
2. expose depth information;
3. expose available Signal K AIS targets.

## Data flow

```text
Signal K data model
       |
       +-- self.navigation.* ------------------+
       |                                       |
       +-- self.environment.depth.* -----------+--> NMEA 0183 encoder --> UDP fan-out
       |                                       |                         |-- broadcast
       +-- vessels.* / AIS target data --------+                         +-- specific IP
```

The plugin reads the current Signal K model using public server plugin APIs. It does not create a second Signal K data source and does not write values back into Signal K.

## Runtime defaults

Runtime defaults are centralized in `index.js` and reused by the configuration schema to prevent drift. The network defaults are:

- broadcast enabled;
- broadcast address `255.255.255.255`;
- unicast disabled until a specific destination is configured;
- UDP port **2000**.

Interval defaults are 1000 ms for GPS, 1000 ms for depth, 2000 ms for AIS dynamic data, and 60000 ms for AIS static data.

Freshness defaults are 30 s for own-vessel values (`ownDataMaxAgeSeconds`) and 600 s for AIS targets (`aisMaxAgeSeconds`); `0` disables either check.

`normalizeOptions()` merges stored configuration with these defaults and coerces every value into a safe range (an invalid port falls back to 2000, intervals are raised to their schema minimum, strings are trimmed), so a stale or hand-edited configuration cannot crash the server. A test asserts that every schema default equals the runtime default.

## NMEA 0183 output

### GPS

The plugin generates:

- `GPRMC` — position, UTC time, speed over ground, and course over ground;
- `GPGGA` — position, fix information, satellite count, HDOP, and altitude where available;
- `GPVTG` — course and speed over ground.

Signal K coordinates remain decimal degrees internally. Coordinate formatting carries rounded `60.00000` minutes into the next degree and rejects values outside the latitude/longitude ranges. Signal K angles are radians and are converted to degrees; speeds are converted from metres/second into the NMEA-required units.

RMC status/mode, VTG mode, and GGA fix quality are derived conservatively from `navigation.gnss.methodQuality`. The Signal K specification values `no GPS` and `Error` are treated as no fix. Recognized GNSS, differential, RTK, precise, estimated, manual, and simulated values map to their NMEA status/mode and GGA quality equivalents. Missing, unrecognized, or explicit no-fix quality produces RMC invalid/mode `N`, VTG mode `N`, and GGA quality `0`. Satellite count, HDOP, and altitude remain empty when absent. Negative speed over ground is treated as unavailable, and rounded courses wrap from 360 to 0.

### Depth

The plugin generates:

- `SDDBT` — depth below transducer;
- `SDDPT` — depth and transducer offset.

The primary Signal K path is configurable and defaults to `environment.depth.belowTransducer`. A missing configured value suppresses depth output; `belowSurface` is not silently relabeled as below-transducer depth. For any offset path ending in `transducerToKeel`, Signal K's positive downward distance is converted to the negative keel-offset convention required by DPT.

### AIS

AIS targets are obtained from the Signal K `vessels` branch. The encoder produces genuine `!AIVDM` payloads rather than proprietary JSON messages.

Class A targets use dynamic AIS position report type 1 and static/voyage message type 5 where required information is available. Class B targets use type 18 and standards-sized type 24A/24B static reports. Multi-fragment AIS messages are emitted as standard AIVDM fragments.

Field sources and "not available" handling:

- navigational status: Signal K `navigation.state` strings are mapped to ITU-R M.1371 codes (`motoring` 0, `anchored` 1, `not under command` 2, `restricted manouverability` 3, `constrained by draft` 4, `moored` 5, `aground` 6, fishing/trawling 7, `sailing` 8, ..., `ais-sart` 14); anything else is 15;
- time stamp: UTC second of the target's `navigation.position` timestamp, or 60 when unknown;
- rate of turn: encoded with the standard 4.733·√(°/min) law, capped at ±126 (±127 is reserved), −128 when unknown;
- dimensions: from `design.length.overall`, `design.beam` and `sensors.ais.fromBow`/`fromCenter` (positive to starboard); if the antenna position is unknown, the ITU form A = C = 0, B = length, D = beam is used;
- type 5 voyage data: IMO number from `registrations.imo`, destination from `navigation.destination.commonName`, ETA from `navigation.destination.eta` (0/0/24/60 when unknown), draught from `design.draft`.

Targets whose last position timestamp is older than `aisMaxAgeSeconds` are skipped. AIS static-report bookkeeping is pruned each cycle for targets no longer present.

## UDP transport

Broadcast and unicast are independent outputs and can be enabled at the same time. GPS and depth sentence families are batched by emission cycle; AIS uses one complete, CRLF-terminated NMEA sentence per UDP datagram so a large target set cannot create an unbounded datagram. A multi-fragment AIS message retains fragment order and sequence metadata.

### Broadcast

When **Send UDP broadcast** is enabled, every generated NMEA datagram is sent to `broadcastAddress`, which defaults to `255.255.255.255`.

Broadcast is useful when the IP address of the phone/tablet is dynamic or when multiple consumers need the same feed.

### Specific IP

When **Send to a specific IP** is enabled, the same NMEA datagram is sent directly to the configured destination.

This is useful on Wi-Fi networks that block or filter broadcast traffic. A DHCP reservation is recommended for permanently configured unicast destinations.

### Simultaneous mode

With both outputs enabled, one generated NMEA payload is transmitted to broadcast and unicast. Duplicate destinations are suppressed when the configured strings are identical.

Both outputs use UDP port **2000** by default.

## Lifecycle and race safety

Each periodic producer runs inside a guard: an exception while reading Signal K or encoding a sentence is reported through `setPluginError()` and never escapes the timer, where it would terminate the Signal K Server process.

`start()` first calls `stop()` so reconfiguration begins from a clean state. A fresh UDP socket is then created and bound. The bind callback captures that exact socket and checks that it is still the active socket before enabling broadcast or starting periodic producers. This prevents a delayed callback from an old/stopped socket from re-creating timers after a rapid disable/restart.

`stop()` clears all timers, clears AIS static-repeat state, closes the active socket, and removes the active socket reference.

## Scheduling

GPS, depth, and AIS dynamic reports have independent transmission intervals. AIS static reports use a slower repeat interval to reduce unnecessary traffic.

Periodic work begins only after the active UDP socket has bound successfully.

## Modules

- `index.js` — Signal K plugin lifecycle, shared runtime defaults, configuration schema, Signal K data access, scheduling, and UDP fan-out.
- `nmea.js` — NMEA 0183 GPS/depth sentence construction and checksums.
- `ais.js` — AIS field extraction, binary encoding, six-bit armoring, and AIVDM fragmentation.
- `test/basic.test.js` — sentence and AIS encoder tests.
- `test/appstore.test.js` — plugin lifecycle, metadata, package, workflow, and App Store invariants.
- `test/regression.test.js` — regression tests for defects fixed in 1.1.0.
- `scripts/verify-package.js` — CI/release check of tarball contents and version agreement (not published).
- `AGENTS.md` — repository-wide engineering and release contract.

## Failure behavior

Missing Signal K values do not generate fabricated navigation data. A sentence family is skipped until the minimum required values are available. Own-vessel values carrying a Signal K timestamp older than `ownDataMaxAgeSeconds` are treated as missing, so a failed sensor is not repeated as live data; values without a timestamp are accepted.

UDP transmission errors, including synchronous `socket.send` exceptions, are reported through `setPluginError()` and server logging and do not terminate the server. Identical error messages are logged at most once per minute so a large AIS batch cannot flood the log, and the normal running status is restored after the next successful send.

## App Store and package architecture

`package.json` declares the package as `signalk-to-boating`, includes the `signalk-node-server-plugin` keyword and relevant categories, references a package-relative icon and screenshot, and has no install-time lifecycle scripts or runtime dependencies.

The package is intended to be published publicly to npm by the account `uniparthenope`. npm account ownership is registry state rather than a package.json ownership field, so release instructions verify it with `npm whoami` before publication.

The repository calls the canonical reusable Signal K plugin CI workflow from `.github/workflows/plugin-ci.yml`. Current upstream CI validates package metadata, entry point, schema, restart lifecycle, API usage, npm packing/App Store installation behavior, multiple operating-system/Node targets, armv7 compatibility, and a Signal K integration install. A repository test protects the caller's presence and critical inputs so the registry's machine-detectable test signal cannot silently disappear.

The repository also owns `.github/workflows/ci.yml` (lint, tests and coverage on Node.js 20/22/24, then package verification, audit and pack) and `.github/workflows/release.yml`, which publishes tagged versions to npm through npm trusted publishing (OIDC) with provenance, after re-running validation and checking that the tag matches `package.json`. The workflow is idempotent: it skips publishing a version already on npm and creating a GitHub release that already exists. No npm token is stored in the repository.

Local tests mirror critical invariants, but only successful CI in the published GitHub repository can provide the hosted test signal. The Signal K Plugin Registry combines that signal with documentation, release, visual-asset, GitHub activity, and npm activity metrics. Its result is cached and heuristic; popularity metrics are intentionally not treated as runtime correctness evidence.
