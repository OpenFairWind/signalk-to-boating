'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const dgram = require('node:dgram')
const pkg = require('../package.json')
const pluginFactory = require('../index')
const root = path.resolve(__dirname, '..')

function appMock() {
  return {
    selfId: 'urn:mrn:signalk:uuid:self',
    getSelfPath: () => undefined,
    getPath: () => ({}),
    getFullSignalK: () => ({ vessels: {} }),
    setPluginStatus: () => {},
    setPluginError: () => {},
    debug: () => {},
    error: () => {}
  }
}

function packagePathExists(item) {
  return fs.existsSync(path.join(root, String(item).replace(/^\.\//, '')))
}

async function capturePluginSends(values, opts) {
  const sends = []
  const originalCreateSocket = dgram.createSocket
  dgram.createSocket = () => ({
    on: () => {},
    bind: (_port, callback) => callback(),
    setBroadcast: () => {},
    close: () => {},
    send: (payload, port, destination, callback) => {
      sends.push({ text: payload.toString('ascii'), port, destination, length: payload.length })
      if (callback) callback()
    }
  })
  const app = appMock()
  app.getSelfPath = key => values[key]
  app.getPath = key => key === 'vessels' ? values.vessels : undefined
  const plugin = pluginFactory(app)
  try {
    plugin.start(Object.assign({
      enableBroadcast: true,
      enableUnicast: false,
      enableGps: false,
      enableDepth: false,
      enableAis: false
    }, opts))
    await new Promise(resolve => setImmediate(resolve))
    plugin.stop()
    return sends
  } finally {
    dgram.createSocket = originalCreateSocket
  }
}

test('App Store package metadata is complete', () => {
  assert.equal(pkg.name, 'signalk-to-boating')
  assert.ok(pkg.keywords.includes('signalk-node-server-plugin'))
  assert.ok(pkg.keywords.includes('signalk-category-nmea-0183'))
  assert.ok(pkg.keywords.includes('signalk-category-ais'))
  assert.ok(pkg.keywords.includes('signalk-category-instruments'))
  assert.equal(pkg.signalk.displayName, 'Signal K to Boating')
  assert.ok(pkg.description.length > 20)
  assert.ok(pkg.author)
  assert.match(pkg.engines.node, /20/)
  assert.equal(pkg.main, 'index.js')
  assert.equal(pkg.exports, './index.js')
  assert.ok(packagePathExists(pkg.signalk.appIcon))
  assert.ok(pkg.signalk.screenshots.length > 0)
  for (const item of pkg.signalk.screenshots) assert.ok(packagePathExists(item))
  assert.ok(packagePathExists('CHANGELOG.md'))
  assert.ok(packagePathExists('AGENTS.md'))
})

test('repository exposes the canonical Signal K plugin test signal', () => {
  const workflowPath = path.join(root, '.github', 'workflows', 'plugin-ci.yml')
  assert.ok(fs.existsSync(workflowPath), 'canonical plugin CI caller must be committed')

  // Git may check text files out with CRLF on Windows. Normalize line endings
  // so this content check does not depend on the runner's checkout settings.
  const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n')
  assert.match(workflow, /^name: Signal K Plugin CI$/m)
  assert.match(workflow, /uses: SignalK\/signalk-server\/\.github\/workflows\/plugin-ci\.yml@master/)
  assert.match(workflow, /test-command: npm run test:ci/)
  assert.match(workflow, /coverage-command: npm run coverage/)
  assert.match(workflow, /enable-armv7: true/)
  assert.match(workflow, /enable-signalk-integration: true/)
  assert.match(workflow, /permissions:\n  contents: read/)
})

test('repository CI and release workflows run the full validation and publish via trusted publishing', () => {
  const read = name => fs.readFileSync(path.join(root, '.github', 'workflows', name), 'utf8').replace(/\r\n/g, '\n')
  const ci = read('ci.yml')
  for (const command of ['npm run lint', 'npm test', 'npm run coverage', 'npm run verify:package', 'npm audit --omit=dev', 'npm pack --dry-run']) {
    assert.ok(ci.includes(command), `ci.yml must run ${command}`)
  }
  assert.match(ci, /node: \['20', '22', '24'\]/)
  const release = read('release.yml')
  assert.match(release, /tags: \['v\*\.\*\.\*'\]/)
  assert.match(release, /id-token: write/)
  assert.match(release, /npm publish --provenance --access public/)
  assert.match(release, /npm run verify:package/)
  assert.doesNotMatch(release, /NPM_TOKEN|NODE_AUTH_TOKEN/)
  assert.equal(pkg.scripts['verify:package'], 'node scripts/verify-package.js')
  assert.equal(pkg.files.includes('scripts/'), false)
})

test('npm publication metadata targets a public unscoped package', () => {
  assert.equal(pkg.name.startsWith('@'), false)
  assert.equal(pkg.publishConfig.access, 'public')
  assert.match(pkg.repository.url, /signalk-to-boating/)
  assert.match(pkg.homepage, /signalk-to-boating/)
  assert.match(pkg.bugs.url, /signalk-to-boating/)
})

test('published files include App Store assets and release documentation', () => {
  const included = pkg.files
  for (const required of ['index.js', 'nmea.js', 'ais.js', 'assets/', 'docs/', 'README.md', 'CHANGELOG.md', 'AGENTS.md', 'LICENSE']) {
    assert.ok(included.includes(required), `package files must include ${required}`)
  }
})

test('App Store install has no lifecycle scripts or native runtime dependencies', () => {
  for (const name of ['preinstall', 'install', 'postinstall']) assert.equal(pkg.scripts?.[name], undefined)
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.optionalDependencies, undefined)
})

test('plugin loads with required Signal K lifecycle surface', () => {
  const plugin = pluginFactory(appMock())
  assert.equal(plugin.id, 'signalk-to-boating')
  assert.equal(plugin.name, 'Signal K to Boating')
  assert.match(plugin.description, /GPS, depth and AIS/)
  assert.equal(typeof plugin.start, 'function')
  assert.equal(typeof plugin.stop, 'function')
  assert.equal(typeof plugin.schema, 'function')
  assert.doesNotThrow(() => JSON.stringify(plugin.schema()))
})

test('schema defaults UDP to port 2000 and supports broadcast plus unicast', () => {
  const schema = pluginFactory(appMock()).schema()
  assert.equal(schema.properties.port.type, 'integer')
  assert.equal(schema.properties.port.default, 2000)
  assert.equal(schema.properties.enableBroadcast.default, true)
  assert.equal(schema.properties.enableUnicast.default, false)
  assert.equal(schema.properties.broadcastAddress.default, '255.255.255.255')
  assert.equal(schema.properties.destination.default, '')
})

test('release metadata version is represented in changelog', () => {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
  assert.match(changelog, new RegExp(`^## ${pkg.version.replace(/\./g, '\\.')}$`, 'm'))
})

test('plugin start-stop-start lifecycle works with empty network output', async () => {
  const plugin = pluginFactory(appMock())
  const opts = { enableBroadcast: false, enableUnicast: false, enableGps: false, enableDepth: false, enableAis: false }
  plugin.start(opts)
  await new Promise(resolve => setTimeout(resolve, 25))
  plugin.stop()
  plugin.start(opts)
  await new Promise(resolve => setTimeout(resolve, 25))
  plugin.stop()
})

test('immediate stop does not allow a stale bind callback to report active output', async () => {
  let statusCalls = 0
  const app = appMock()
  app.setPluginStatus = () => { statusCalls += 1 }
  const plugin = pluginFactory(app)
  plugin.start({ enableGps: false, enableDepth: false, enableAis: false })
  plugin.stop()
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(statusCalls, 0)
})

test('depth emission preserves reference semantics and negates transducer-to-keel offset', async () => {
  const base = { enableDepth: true }
  let sends = await capturePluginSends({
    'environment.depth.belowTransducer': 10,
    'environment.depth.transducerToKeel': 0.7
  }, base)
  assert.equal(sends.length, 1)
  assert.match(sends[0].text, /\$SDDBT,/)
  assert.match(sends[0].text, /\$SDDPT,10\.0,-0\.7\*/)

  sends = await capturePluginSends({
    'environment.depth.belowTransducer': 10,
    'environment.depth.transducerToKeel': 0
  }, base)
  assert.match(sends[0].text, /\$SDDPT,10\.0,0\.0\*/)

  sends = await capturePluginSends({ 'environment.depth.belowTransducer': 10 }, base)
  assert.match(sends[0].text, /\$SDDPT,10\.0,\*/)

  sends = await capturePluginSends({
    'environment.depth.belowTransducer': 10,
    'environment.depth.transducerToKeel': Infinity
  }, base)
  assert.match(sends[0].text, /\$SDDPT,10\.0,\*/)

  sends = await capturePluginSends({ 'environment.depth.belowSurface': 10 }, base)
  assert.equal(sends.length, 0)
})

test('GNSS status is conservative unless method quality supports a fix', async () => {
  const position = { latitude: 40.75, longitude: 14.25 }
  let sends = await capturePluginSends({ 'navigation.position': position }, { enableGps: true })
  assert.match(sends[0].text, /\$GPRMC,[^\r]+,V,[^\r]+,N\*/)
  assert.match(sends[0].text, /\$GPGGA,[^\r]+,0,/)
  assert.match(sends[0].text, /\$GPVTG,[^\r]+,N\*/)

  sends = await capturePluginSends({
    'navigation.position': position,
    'navigation.gnss.methodQuality': 'GNSS Fix'
  }, { enableGps: true })
  assert.match(sends[0].text, /\$GPRMC,[^\r]+,A,[^\r]+,A\*/)
  assert.match(sends[0].text, /\$GPGGA,[^\r]+,1,/)
  assert.match(sends[0].text, /\$GPVTG,[^\r]+,A\*/)

  sends = await capturePluginSends({
    'navigation.position': position,
    'navigation.gnss.methodQuality': 'No fix'
  }, { enableGps: true })
  assert.match(sends[0].text, /\$GPRMC,[^\r]+,V,[^\r]+,N\*/)
  assert.doesNotMatch(sends[0].text, /,08,1\.0,0\.0,M,/)
})

test('AIS uses one complete CRLF-terminated sentence per bounded UDP datagram and fans out equally', async () => {
  const vessels = {}
  for (let i = 0; i < 75; i++) {
    const mmsi = String(247000000 + i)
    vessels[`urn:mrn:imo:mmsi:${mmsi}`] = {
      mmsi: { value: mmsi },
      name: { value: `TARGET ${i}` },
      navigation: { position: { value: { latitude: 40 + i / 1000, longitude: 14 } } },
      sensors: { ais: { class: { value: i % 2 ? 'A' : 'B' } } }
    }
  }
  const sends = await capturePluginSends({ vessels }, {
    enableAis: true,
    enableBroadcast: true,
    enableUnicast: true,
    destination: '192.0.2.10'
  })
  assert.ok(sends.length > 150)
  assert.ok(sends.every(send => send.length < 1400))
  assert.ok(sends.every(send => send.text.endsWith('\r\n')))
  assert.ok(sends.every(send => send.text.slice(0, -2).indexOf('\r\n') === -1))
  const broadcast = sends.filter(send => send.destination === '255.255.255.255').map(send => send.text)
  const unicast = sends.filter(send => send.destination === '192.0.2.10').map(send => send.text)
  assert.deepEqual(unicast, broadcast)

  const duplicate = await capturePluginSends({ vessels }, {
    enableAis: true,
    enableBroadcast: true,
    enableUnicast: true,
    destination: '255.255.255.255'
  })
  assert.ok(duplicate.every(send => send.destination === '255.255.255.255'))
  assert.equal(duplicate.length, broadcast.length)
})
