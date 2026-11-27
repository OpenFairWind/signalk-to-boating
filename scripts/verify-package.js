'use strict'

// Release-readiness check used by CI and the release workflow.
//
// Verifies that the npm tarball contains every file referenced by package
// metadata, that package.json/package-lock.json/CHANGELOG.md agree on the
// version, and (when RELEASE_TAG is set) that the Git tag matches it.
// Not shipped in the npm package.

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
const failures = []

function check(condition, message) {
  if (!condition) failures.push(message)
}

const strip = p => String(p).replace(/^\.\//, '')

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const packed = JSON.parse(execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: root,
  encoding: 'utf8',
  shell: process.platform === 'win32'
}))[0]
const tarballFiles = new Set(packed.files.map(f => f.path))

const required = [
  pkg.main,
  pkg.exports,
  pkg.signalk.appIcon,
  ...pkg.signalk.screenshots,
  'README.md',
  'CHANGELOG.md',
  'AGENTS.md',
  'LICENSE',
  'docs/getting_started.md',
  'docs/architecture.md',
  'nmea.js',
  'ais.js'
].map(strip)

for (const file of required) check(tarballFiles.has(file), `tarball is missing ${file}`)
for (const file of tarballFiles) {
  check(!/^(test|scripts|\.github|\.idea)\//.test(file), `tarball unexpectedly contains ${file}`)
}

check(lock.version === pkg.version, `package-lock.json version ${lock.version} != package.json ${pkg.version}`)
check(lock.packages && lock.packages[''] && lock.packages[''].version === pkg.version,
  'package-lock.json root package version does not match package.json')
check(new RegExp(`^## ${pkg.version.replace(/\./g, '\\.')}$`, 'm').test(changelog),
  `CHANGELOG.md has no "## ${pkg.version}" heading`)

for (const name of ['preinstall', 'install', 'postinstall']) {
  check(!(pkg.scripts && pkg.scripts[name]), `package.json must not define a ${name} script`)
}

const tag = process.env.RELEASE_TAG
if (tag) check(tag === `v${pkg.version}`, `release tag ${tag} does not match package version v${pkg.version}`)

if (failures.length) {
  for (const f of failures) console.error(`verify-package: ${f}`)
  process.exit(1)
}
console.log(`verify-package: ${packed.filename} OK (${tarballFiles.size} files, ${packed.size} bytes)`)
