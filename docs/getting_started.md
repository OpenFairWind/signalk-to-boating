# Signal K to Boating — Getting Started

## Requirements

- Signal K Node Server
- Node.js 20 or newer
- Phone/tablet running Garmin/Navionics Boating or another compatible NMEA 0183 Wi-Fi consumer
- Signal K and the mobile device connected to a network that permits the required UDP traffic

## Installation from npm

Install the current stable release from npm:

```sh
cd ~/.signalk
npm install signalk-to-boating
```

To remain on the stable 1.x release line, install `signalk-to-boating@1`.

Restart Signal K after installation.

## Installation from a local package

For development or pre-release testing:

```sh
cd ~/.signalk
npm install /path/to/signalk-to-boating-1.0.1.tgz
```

## Enable the plugin

Open the Signal K administration interface and select **Server -> Plugin Config -> Signal K to Boating**. Enable the plugin and save its configuration.

## Recommended configuration

The plugin can send NMEA 0183 using broadcast, a specific destination IP, or both simultaneously.

### Broadcast only

Use this first on a normal onboard Wi-Fi LAN:

- **Send UDP broadcast:** enabled
- **Broadcast address:** `255.255.255.255`
- **Send to a specific IP:** disabled
- **UDP port:** `2000`

Broadcast avoids depending on the phone/tablet retaining the same IP address.

### Specific IP only

Use this when the access point filters broadcast traffic:

- **Send UDP broadcast:** disabled
- **Send to a specific IP:** enabled
- **Specific destination IP:** IP address of the phone/tablet running Boating
- **UDP port:** `2000`

A DHCP reservation is recommended if the destination should remain stable.

### Broadcast and specific IP together

For maximum practical reliability, enable both:

- **Send UDP broadcast:** enabled
- **Broadcast address:** `255.255.255.255`
- **Send to a specific IP:** enabled
- **Specific destination IP:** phone/tablet address
- **UDP port:** `2000`

The plugin sends each generated NMEA payload to both destinations. If the two destination strings are identical, the duplicate is suppressed.

## Data switches

Normally keep all three enabled:

- **Send external GPS**
- **Send depth**
- **Send AIS targets**

Default update intervals are 1 second for GPS, 1 second for depth, 2 seconds for AIS dynamic data, and 60 seconds for AIS static data.

## Depth configuration

The default depth source is:

```text
environment.depth.belowTransducer
```

The default offset source is:

```text
environment.depth.transducerToKeel
```

The plugin does not substitute `environment.depth.belowSurface` when the configured below-transducer value is absent because those paths use different physical references. In that case no depth sentence is emitted. With the default offset path, a positive Signal K transducer-to-keel distance is converted to a negative NMEA DPT keel offset.

## GNSS validity

The plugin uses `navigation.gnss.methodQuality` to determine RMC validity/mode, VTG mode, and GGA fix quality. Missing, unknown, or explicit no-fix quality is reported conservatively as invalid/no-mode GPS output and GGA quality zero; a position alone is not treated as proof of a current autonomous fix. Satellite count, HDOP, and altitude fields remain empty when Signal K does not provide them.

## Network setup

The Signal K server and phone/tablet should normally be on the same onboard Wi-Fi network. Client isolation on the access point must be disabled if it prevents traffic between wireless clients and the Signal K host.

For broadcast mode, the operating system and network must permit UDP broadcast. For unicast mode, verify that the configured destination is the mobile device's current Wi-Fi IP address.

## Verify output

From another computer on the same network, a UDP listener can be used to inspect the stream. Where netcat supports UDP listening:

```sh
nc -u -l 2000
```

Expected traffic includes lines similar to:

```text
$GPRMC,...*hh
$GPGGA,...*hh
$GPVTG,...*hh
$SDDBT,...*hh
$SDDPT,...*hh
!AIVDM,...*hh
```

The exact values and AIS fragmentation depend on current Signal K data.

## Boating/Navionics setup

Connect the phone or tablet to the same Wi-Fi network as Signal K. Enable the application's supported NMEA/Wi-Fi device connection or synchronization feature. Keep Signal K to Boating running while testing so GPS, depth, and AIS traffic remains available.

If Boating does not receive broadcast traffic, enable **Send to a specific IP** and enter the mobile device's current Wi-Fi address. Both transport modes may remain enabled.

## Troubleshooting

If GPS is missing, verify `navigation.position` in Signal K and check that latitude and longitude are numeric. Speed/course sentences become richer when `navigation.speedOverGround` and `navigation.courseOverGroundTrue` are present.

If depth is missing, inspect the configured depth path in the Signal K Data Browser and select the path populated by the onboard depth instrument.

If AIS targets are missing, confirm that remote vessels are visible under `vessels.*` in Signal K. The plugin cannot export targets that the Signal K server has not received.

If nothing arrives over UDP, check port `2000`, firewall rules, Wi-Fi client isolation, subnet topology, and the phone/tablet IP. Trying broadcast and unicast simultaneously is a useful diagnostic configuration.

## Development validation

From the plugin directory:

```sh
npm test
npm run lint
npm run coverage
npm pack --dry-run
npm audit --omit=dev
```

The repository also contains `.github/workflows/plugin-ci.yml`, which invokes Signal K's canonical reusable plugin CI on every push and pull request. It performs package validation, schema/lifecycle checks, API-use scans, package/install checks, cross-platform unit and coverage testing, armv7/Cerbo GX testing, and a Signal K integration install.

### Interpreting App Store indicators

The App Store's **Indicators** tab is populated by the remote Signal K Plugin Registry, not by the locally installed package. A successful hosted CI run gives the registry a machine-detectable plugin-test signal. README coverage, changelog entries, and packaged screenshots provide the documentation and visual-asset signals.

GitHub stars, contributor activity, open issues, and npm downloads are external metrics. A new or lightly used plugin may legitimately show zero or **N/A** for them. Do not add artificial activity to change these values. Registry data can also lag behind a GitHub run or npm publication because it is cached.

## npm release

Version 1.0.1 is prepared as the unscoped package `signalk-to-boating` for publication by the npm account `uniparthenope`.

Before publishing:

```sh
npm whoami
```

must return:

```text
uniparthenope
```

Then run the full validation commands above, inspect the dry-run tarball contents, and publish with `npm publish`. Do not store npm credentials or tokens in the repository.
