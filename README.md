# Signal K to Boating

Signal K Node Server plugin that bridges the boat's GPS, depth, and Signal K AIS target data to standards-based NMEA 0183 over UDP for Garmin/Navionics **Boating** and compatible marine applications.

## Output

- Own-vessel GPS: `GPRMC`, `GPGGA`, `GPVTG`
- Depth: `SDDBT`, `SDDPT`
- AIS targets: `!AIVDM`
  - Class A: AIS message 1 plus periodic message 5
  - Class B: AIS message 18 plus periodic message 24A/24B

The default UDP port is **2000**. UDP broadcast and unicast to a specific IP can be enabled independently or at the same time.

## Install

After publication to npm, install from the Signal K host with:

```sh
cd ~/.signalk
npm install signalk-to-boating
```

For development or pre-release testing, install a local checkout or packed `.tgz` instead.

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

The repository also calls Signal K's canonical reusable plugin CI workflow across its supported platform matrix.

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
