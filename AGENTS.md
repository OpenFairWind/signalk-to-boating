# AGENTS.md

## Purpose

This repository contains **Signal K to Boating**, a Signal K Node Server plugin that reads Signal K own-vessel navigation/depth data and remote vessel data and emits standards-based NMEA 0183 over UDP for Garmin/Navionics Boating and compatible marine applications.

Treat this file as the repository-wide implementation and release contract for human contributors and coding agents.

## Product requirements

The plugin must preserve these user-visible behaviors unless a release explicitly documents a breaking change:

- Export own-vessel GPS using `GPRMC`, `GPGGA`, and `GPVTG`.
- Export depth using `SDDBT` and `SDDPT`.
- Export Signal K AIS targets using genuine `!AIVDM` payloads.
- Preserve AIS Class A/Class B behavior when `sensors.ais.class` is available.
- Allow UDP broadcast and UDP unicast to a specific IP independently or simultaneously.
- Default the UDP port to **2000** everywhere: runtime options, JSON schema, tests, examples, screenshots, and documentation.
- Default broadcast address to `255.255.255.255`.
- Do not fabricate navigation/depth/AIS values when required Signal K inputs are absent.
- Do not write data back into the Signal K data model.

## Repository layout

- `index.js` — Signal K plugin lifecycle, configuration schema, data access, scheduling, and UDP transport.
- `nmea.js` — NMEA 0183 GPS/depth sentence encoding and checksum logic.
- `ais.js` — AIS extraction, bit-field encoding, six-bit armoring, and AIVDM fragmentation.
- `test` — Node test runner unit/lifecycle/App Store metadata tests.
- `assets/icon.svg` — Signal K App Store icon.
- `docs/architecture.md` — architecture and design constraints.
- `docs/getting_started.md` — installation, configuration, validation, and troubleshooting.
- `docs/screenshots` — App Store screenshots referenced by `package.json`.
- `.github/workflows/plugin-ci.yml` — caller for Signal K's canonical reusable plugin CI.
- `.github/workflows/ci.yml` — repository quality gate (Node 20/22/24 tests, coverage, package verification, audit).
- `.github/workflows/release.yml` — tag-driven npm publication via trusted publishing with provenance.
- `scripts/verify-package.js` — tarball-content and version-agreement check (`npm run verify:package`); not published.
- `CHANGELOG.md` — per-version user-visible release notes.
- `README.md` — npm and Signal K App Store landing documentation.

## Runtime and language

- Use CommonJS JavaScript compatible with the declared `engines.node` range.
- Current supported baseline is Node.js `>=20`, matching Signal K plugin guidance and the canonical CI armv7/Cerbo GX compatibility job.
- Prefer Node built-ins. Do not add runtime dependencies unless the functionality cannot reasonably be implemented with Node/Signal K APIs.
- Never add native addons without a documented need and cross-platform CI coverage.
- Do not bundle `baconjs`; Signal K provides its own compatible instance.

## Signal K plugin contract

The package entry point must export a constructor function receiving the Signal K `app` object and returning a plugin object with:

- `id: "signalk-to-boating"`
- `name: "Signal K to Boating"`
- a meaningful `description`
- `schema`
- `start(options)`
- `stop()`

Use public Signal K plugin APIs only. In particular:

- use `setPluginStatus()` / `setPluginError()` rather than deprecated provider status APIs;
- do not depend on internal properties such as `app.server`, `app.deltaCache`, or `app.pluginsMap`;
- if HTTP routes are ever added, use the supported router registration mechanism rather than direct `app.get()`/`app.post()` calls;
- if persistent files are ever added, store them under `app.getDataDirPath()`, never `__dirname`, the package directory, or `process.cwd()`.

The plugin must support `start() -> stop() -> start()` without leaking sockets, timers, listeners, or stale state. Asynchronous socket callbacks must not revive a stopped plugin instance.

## Signal K data assumptions

Own-vessel paths currently used:

- `navigation.position`
- `navigation.speedOverGround`
- `navigation.courseOverGroundTrue`, with `navigation.courseOverGround` fallback
- `navigation.gnss.altitude`
- `navigation.gnss.satellites`
- `navigation.gnss.horizontalDilution`
- `navigation.gnss.methodQuality`
- configurable depth path, default `environment.depth.belowTransducer`
- configurable depth offset path, default `environment.depth.transducerToKeel`

Remote targets are read from `vessels.*`. AIS encoding may use MMSI, AIS class, position and its timestamp, SOG, COG, heading, rate of turn, navigation state, name, callsign, IMO number, ship type, dimensions and AIS antenna position, draft, and destination/ETA when present.

Own-vessel values older than `ownDataMaxAgeSeconds` and AIS targets older than `aisMaxAgeSeconds` must not be emitted; values without a timestamp are accepted.

Signal K navigation angles are radians; NMEA courses/headings are degrees. Signal K speeds are SI metres/second; convert explicitly for NMEA fields.

## NMEA 0183 rules

- Always emit a correct XOR checksum over the sentence body.
- Terminate UDP batches with CRLF (`\r\n`).
- Keep emitted NMEA lines ASCII-safe.
- Do not replace `!AIVDM` with proprietary JSON or vendor-specific pseudo-sentences.
- Preserve correct AIS fill-bit counts and fragmentation metadata.
- Avoid inventing values merely to make a sentence look complete. Only protocol-safe defaults that do not misrepresent vessel state are acceptable.

## UDP transport rules

- UDP port default: `2000`.
- Broadcast and unicast must be independent configuration switches.
- If both are enabled, send the same generated payload to both destinations.
- Suppress duplicate sends when the broadcast and unicast destination strings are identical.
- UDP send failures must be reported through Signal K logging/status APIs and must not crash the server.
- `stop()` must cancel all periodic work and close the active socket.

## Configuration schema

Every runtime default must match the corresponding JSON schema default. When changing a default, update all of the following in the same change:

1. runtime defaults in `index.js`;
2. schema defaults in `index.js`;
3. tests;
4. `README.md`;
5. `docs/getting_started.md` and `docs/architecture.md` where applicable;
6. screenshots if the visible configuration changes;
7. `CHANGELOG.md`.

Keep labels clear for non-developer boat users. Bounds for ports and intervals must prevent obviously invalid values.

## Testing requirements

Before packaging or publishing, run:

```sh
npm test
npm run coverage
npm run verify:package
npm pack --dry-run
npm audit --omit=dev
```

Tests must cover at least:

- NMEA checksums and representative GPS/depth sentences;
- AIS Class A dynamic output;
- AIS Class B dynamic/static output;
- App Store metadata and declared asset existence;
- absence of install-time lifecycle scripts;
- absence of unintended runtime/native dependencies;
- plugin constructor/lifecycle/schema shape;
- default UDP port 2000;
- broadcast + unicast configuration;
- clean `start() -> stop() -> start()` behavior;
- stale-data suppression and crash-safe periodic output.

When fixing a protocol or lifecycle bug, add a regression test that fails before the fix and passes after it.

## Signal K App Store / CI requirements

The package is intended for the Signal K App Store. Keep these invariants:

- `keywords` contains `signalk-node-server-plugin` and relevant category keywords.
- `signalk.displayName`, `signalk.appIcon`, and at least one `signalk.screenshots` entry are valid and package-relative.
- `appIcon` is a square SVG/PNG suitable for App Store rendering.
- `CHANGELOG.md` remains present and has a heading for every published version.
- the published tarball contains every file referenced by `main`, `exports`, icon/screenshots metadata, README, docs required by users, license, changelog, and this `AGENTS.md`.
- no `preinstall`, `install`, or `postinstall` script is required; Signal K App Store installation uses `--ignore-scripts`.
- `.github/workflows/plugin-ci.yml` should call the current reusable workflow from `SignalK/signalk-server`; consult the upstream workflow before changing its inputs.

A local test result does **not** prove a 100% remote Signal K registry score. The authoritative score is produced after repository/npm publication by Signal K infrastructure.

## npm publishing contract

The package is intended to be published on npmjs.com as the unscoped package:

```text
signalk-to-boating
```

The npm publishing account is:

```text
uniparthenope
```

Do not rename or scope the package (for example `@uniparthenope/signalk-to-boating`) unless the maintainer explicitly requests a breaking package-name migration.

Before publication:

```sh
npm whoami
```

must report `uniparthenope` in the maintainer's publishing environment. Then verify the packed content and publish only from a clean, reviewed tree:

```sh
npm test
npm run coverage
npm audit --omit=dev
npm pack --dry-run
npm publish
```

Never commit npm tokens, automation tokens, passwords, `.npmrc` credentials, or other secrets. Prefer npm trusted publishing/OIDC in hosted release automation when configured by maintainers.

## Versioning and release notes

Use semantic versioning. Any behavior or metadata change destined for npm must bump `package.json` and `package-lock.json` together and add a matching `CHANGELOG.md` section.

Before release, search the repository for stale old-version tarball names, stale default ports, and outdated installation commands.

## Documentation rules

- Keep `README.md` concise and npm/App Store friendly.
- Put detailed operational instructions in `docs/getting_started.md`.
- Put implementation rationale and module/data-flow information in `docs/architecture.md`.
- State clearly that Garmin/Navionics interoperability is based on standards-based NMEA 0183 over Wi-Fi/UDP; do not claim undocumented proprietary compatibility guarantees.
- When vendor behavior or Signal K App Store requirements are described as current facts, verify the live official documentation before materially changing those statements.

## Security and privacy

- The plugin should transmit only the navigation/depth/AIS information necessary for its purpose.
- Do not add telemetry, analytics, cloud callbacks, or remote logging without explicit maintainer approval and documentation.
- Treat destination IPs as local configuration data; do not exfiltrate them.
- Validate externally derived values before binary/string encoding to avoid malformed output or process crashes.
- Network failures must degrade gracefully.

## Code style

- Use `'use strict'` and CommonJS conventions already present in the repository.
- Keep functions small and protocol-specific logic in `nmea.js` / `ais.js` rather than growing `index.js` unnecessarily.
- Prefer pure encoder functions that are straightforward to unit test.
- Use descriptive names and avoid clever bit manipulation when a clearer helper can express the same AIS operation.
- Do not reformat unrelated code in focused changes.

## Definition of done

A change is complete only when code, tests, metadata, documentation, changelog, and package contents agree. At minimum, the full local validation commands must pass, and the resulting npm tarball must contain all declared App Store assets and documentation.
