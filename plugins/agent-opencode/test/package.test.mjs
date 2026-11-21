/**
 * Package-contract tests: the GitHub-installable manifest, the browser-half
 * declaration, and the row the client module system attaches to.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8'))
const client = readFileSync(path.join(PACKAGE_DIR, 'client.js'), 'utf8')
const patch = readFileSync(path.join(PACKAGE_DIR, 'cordis.patch.yml'), 'utf8')

test('the package manifest follows the repository plugin contract', () => {
  assert.equal(manifest.name, '@sredevopsorg/dsh-agent-opencode')
  assert.equal(manifest.version, '0.4.0')
  assert.equal(manifest.private, undefined)
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.dsh?.manifestVersion, 1)
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(typeof manifest.engines?.dsh, 'string')
  assert.notEqual(manifest.engines.dsh, '')
  assert.ok(Array.isArray(manifest.keywords) && manifest.keywords.length > 0)
})

test('every export target and browser-half file exists', () => {
  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    if (typeof target !== 'string') assert.fail(`export ${subpath} must be a string`)
    if (target.includes('*')) continue
    assert.ok(existsSync(path.resolve(PACKAGE_DIR, target)), `export ${subpath} target is missing: ${target}`)
  }
  for (const file of ['client.js', 'settings.js', 'auto-continue.js', 'cordis.patch.yml', 'README.md', 'icon.svg']) {
    assert.ok(manifest.files.includes(file), `files must ship ${file}`)
  }
  assert.ok(existsSync(path.resolve(PACKAGE_DIR, manifest.icon)))
})

test('the browser half is declared for the Web and ordered after its hosts', () => {
  assert.equal(manifest.exports?.['./client'], './client.js')
  assert.equal(manifest.dsh?.client?.platform, 'web')
  assert.equal(manifest.dsh?.client?.immediately, true)
  for (const packageName of ['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-plugin-manager']) {
    assert.ok(manifest.dsh.client.inject.includes(packageName), `missing dsh.client.inject entry: ${packageName}`)
  }
})

test('the client registers both Plugins-page slots under the package identity', () => {
  assert.match(client, /id: '@sredevopsorg\/dsh-agent-opencode'/)
  assert.match(client, /name: 'plugins\.bundle\.config'/)
  assert.match(client, /name: 'plugins\.row\.config'/)
  assert.match(client, /const ROW_ID = 'auto-continue-opencode'/)
  assert.match(client, /key: ROW_KEY/)
})

test('the patch carries the bare-package row the client attaches to', () => {
  assert.match(patch, /^ {4}- id: agent-opencode$/m)
  assert.match(patch, /^ {6}name: '@sredevopsorg\/dsh-agent-opencode'$/m)
})
