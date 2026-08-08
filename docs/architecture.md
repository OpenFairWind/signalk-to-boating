# Signal K to Boating — Architecture

## Objective

Signal K to Boating is a one-way protocol bridge from the Signal K data model to NMEA 0183 over UDP. Its primary interoperability target is Garmin/Navionics Boating, while keeping the output usable by other standards-compliant marine NMEA 0183 consumers.

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

## NMEA 0183 output

### GPS

The plugin generates:

- `GPRMC` — position, UTC time, speed over ground, and course over ground;
- `GPGGA` — position, fix information, satellite count, HDOP, and altitude where available;
- `GPVTG` — course and speed over ground.

Signal K coordinates remain decimal degrees internally. Signal K angles are radians and are converted to degrees; speeds are converted from metres/second into the NMEA-required units.

### Depth

The plugin generates:

- `SDDBT` — depth below transducer;
- `SDDPT` — depth and transducer offset.

The primary Signal K path is configurable and defaults to `environment.depth.belowTransducer`. If unavailable, `environment.depth.belowSurface` is used as a fallback.

### AIS

AIS targets are obtained from the Signal K `vessels` branch. The encoder produces genuine `!AIVDM` payloads rather than proprietary JSON messages.

Class A targets use dynamic AIS position report type 1 and static/voyage message type 5 where required information is available. Class B targets use type 18 and type 24 static reports. Multi-fragment AIS messages are emitted as standard AIVDM fragments.

## UDP transport

Broadcast and unicast are independent outputs and can be enabled at the same time.

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
- `test/appstore.test.js` — plugin lifecycle, metadata, package, and App Store invariants.
- `AGENTS.md` — repository-wide engineering and release contract.

## Failure behavior

Missing Signal K values do not generate fabricated navigation data. A sentence family is skipped until the minimum required values are available. UDP transmission errors are reported through Signal K logging facilities and do not terminate the server.

## App Store and package architecture

`package.json` declares the package as `signalk-to-boating`, includes the `signalk-node-server-plugin` keyword and relevant categories, references a package-relative icon and screenshot, and has no install-time lifecycle scripts or runtime dependencies.

The package is intended to be published publicly to npm by the account `uniparthenope`. npm account ownership is registry state rather than a package.json ownership field, so release instructions verify it with `npm whoami` before publication.

The repository calls the canonical reusable Signal K plugin CI workflow from `.github/workflows/plugin-ci.yml`. Current upstream CI validates package metadata, entry point, schema, restart lifecycle, API usage, npm packing/App Store installation behavior, multiple operating-system/Node targets, armv7 compatibility, and a Signal K integration install. A repository test protects the caller's presence and critical inputs so the registry's machine-detectable test signal cannot silently disappear.

Local tests mirror critical invariants, but only successful CI in the published GitHub repository can provide the hosted test signal. The Signal K Plugin Registry combines that signal with documentation, release, visual-asset, GitHub activity, and npm activity metrics. Its result is cached and heuristic; popularity metrics are intentionally not treated as runtime correctness evidence.
