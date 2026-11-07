import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8'))
const client = readFileSync(path.join(PACKAGE_DIR, 'client.js'), 'utf8')
const patch = readFileSync(path.join(PACKAGE_DIR, 'cordis.patch.yml'), 'utf8')

test('the package manifest follows the repository plugin contract', () => {
  assert.equal(manifest.name, '@sredevopsorg/dsh-code-editor')
  assert.equal(manifest.version, '0.1.0')
  assert.equal(manifest.private, undefined)
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.dsh?.manifestVersion, 1)
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(typeof manifest.engines?.dsh, 'string')
  assert.notEqual(manifest.engines.dsh, '')
  assert.ok(Array.isArray(manifest.keywords) && manifest.keywords.length > 0)
})

test('the bundle registration ids match the package name', () => {
  const escaped = manifest.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  assert.match(client, new RegExp(`id:\\s*['"]${escaped}['"]`))
  assert.match(client, new RegExp(`const ID = ['"]${escaped}['"]`))
  assert.match(patch, new RegExp(`name:\\s*['"]${escaped}['"]`))
})

test('every static export target exists', () => {
  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    if (typeof target !== 'string') {
      assert.fail(`export ${subpath} must be a string`)
    }
    if (target.includes('*')) continue
    assert.ok(existsSync(path.resolve(PACKAGE_DIR, target)), `export ${subpath} target is missing: ${target}`)
  }
  assert.ok(existsSync(path.resolve(PACKAGE_DIR, manifest.icon)))
})

test('the client declaration injects the services the tab body uses', () => {
  const inject = manifest.dsh?.client?.inject ?? []
  for (const packageName of [
    '@deepseek-ai/dsh-client-ui-sidebar-right',
    '@deepseek-ai/dsh-api-workspace-files',
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-client-ui-session',
    '@deepseek-ai/dsh-client-locale',
  ]) {
    assert.ok(inject.includes(packageName), `missing dsh.client.inject entry: ${packageName}`)
  }
})
