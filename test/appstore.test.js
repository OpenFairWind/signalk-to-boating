'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
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

  const workflow = fs.readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /^name: Signal K Plugin CI$/m)
  assert.match(workflow, /uses: SignalK\/signalk-server\/\.github\/workflows\/plugin-ci\.yml@master/)
  assert.match(workflow, /test-command: npm run test:ci/)
  assert.match(workflow, /coverage-command: npm run coverage/)
  assert.match(workflow, /enable-armv7: true/)
  assert.match(workflow, /enable-signalk-integration: true/)
  assert.match(workflow, /permissions:\n  contents: read/)
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
