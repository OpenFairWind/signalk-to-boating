# Signal K to Boating

[![Signal K Plugin CI](https://github.com/OpenFairWind/signalk-to-boating/actions/workflows/plugin-ci.yml/badge.svg)](https://github.com/OpenFairWind/signalk-to-boating/actions/workflows/plugin-ci.yml)
[![npm version](https://img.shields.io/npm/v/signalk-to-boating.svg)](https://www.npmjs.com/package/signalk-to-boating)
[![npm downloads](https://img.shields.io/npm/dw/signalk-to-boating.svg)](https://www.npmjs.com/package/signalk-to-boating)
[![license](https://img.shields.io/npm/l/signalk-to-boating.svg)](LICENSE)

Signal K Node Server plugin that bridges the boat's GPS, depth, and Signal K AIS target data to standards-based NMEA 0183 over UDP for Garmin/Navionics **Boating** and compatible marine applications.

Version **1.0.0** is the first stable release. It preserves a one-way data flow: the plugin reads current Signal K values and never writes navigation, depth, or AIS data back into the Signal K model.

## Output

- Own-vessel GPS: `GPRMC`, `GPGGA`, `GPVTG`
- Depth: `SDDBT`, `SDDPT`
- AIS targets: `!AIVDM`
  - Class A: AIS message 1 plus periodic message 5
  - Class B: AIS message 18 plus periodic message 24A/24B

The default UDP port is **2000**. UDP broadcast and unicast to a specific IP can be enabled independently or at the same time.

## Install

Install the stable package from npm on the Signal K host with:

```sh
cd ~/.signalk
npm install signalk-to-boating
```

For development or pre-release testing, install a local checkout or packed `.tgz` instead.

To require this stable major version explicitly, use `npm install signalk-to-boating@1`.

Restart Signal K Server, then open **Server -> Plugin Config -> Signal K to Boating**, enable the plugin, and configure its UDP output.

## Recommended UDP configuration

For a normal onboard LAN, start with broadcast enabled:

- **Send UDP broadcast:** enabled
- **Broadcast address:** `255.255.255.255`
- **Send to a specific IP:** disabled
- **UDP port:** `2000`

If Wi-Fi client isolation or broadcast filtering prevents reception, enable unicast and set **Specific destination IP** to the phone/tablet running Boating. Broadcast and unicast can remain enabled simultaneously for maximum practical compatibility.

## Boating setup

1. Put the phone/tablet running Boating on the same Wi-Fi/LAN as Signal K Server.
2. Enable this plugin.
3. In Boating, open the supported paired-device / NMEA Wi-Fi connection workflow.
4. If broadcast is not received, enable unicast to the device's Wi-Fi IP.
5. Verify that Boating receives GPS and depth. AIS targets should appear when AIS display is enabled and the application/account supports that feature.

## Signal K data paths used

Own vessel:

- `navigation.position`
- `navigation.speedOverGround`
- `navigation.courseOverGroundTrue` or `navigation.courseOverGround`
- `navigation.gnss.altitude`
- `navigation.gnss.satellites`
- `navigation.gnss.horizontalDilution`
- `environment.depth.belowTransducer` by default
- `environment.depth.transducerToKeel` by default

AIS targets are read from `vessels.*`, using MMSI, position, SOG/COG/heading, `sensors.ais.class`, name, callsign, AIS ship type, dimensions, and draft when available.

## Compatibility scope

The plugin emits genuine NMEA 0183 GPS/depth sentences and AIS `!AIVDM` messages. Garmin documents NMEA 0183 over Wi-Fi support for compatible Boating integrations, but a complete proprietary interoperability specification for arbitrary third-party UDP bridges is not public. For that reason this project targets standards-based interoperability and does not claim undocumented vendor guarantees.

## Documentation

- [Getting started](docs/getting_started.md)
- [Architecture](docs/architecture.md)
- [Contributor and coding-agent instructions](AGENTS.md)
- [Changelog](CHANGELOG.md)

## Development

Requires Node.js 20 or newer.

```sh
npm test
npm run coverage
npm pack --dry-run
npm audit --omit=dev
```

The repository calls Signal K's canonical reusable plugin CI workflow on every push and pull request. It runs the unit and coverage suites on Linux x64/arm64, macOS, and Windows with Node.js 22 and 24, checks armv7/Node.js 20 for Cerbo GX compatibility, and performs a Signal K integration install. The CI badge above links to the authoritative run history.

### App Store indicators

Signal K's App Store indicators are heuristic signals assembled by the Signal K Plugin Registry. This repository supplies machine-detectable tests, current release notes, substantial documentation, and packaged visual assets. GitHub stars, open-issue activity, contributor count, and npm download totals are external activity metrics; they can remain unavailable or at zero for a correct, newly published plugin and must not be manufactured.

After a CI run or npm release, allow the registry cache to refresh before expecting the App Store detail page to change. A local test run proves the package itself, while the App Store indicator reflects the latest data the remote registry has collected.

## npm publication

The package is intended to be published on npm as the unscoped package `signalk-to-boating` by the npm account **`uniparthenope`**.

Before a release, the publisher should verify:

```sh
npm whoami
# expected: uniparthenope

npm test
npm run coverage
npm audit --omit=dev
npm pack --dry-run
npm publish
```

No runtime npm dependencies or install-time lifecycle scripts are required.

## License

Apache-2.0.
