/**
 * Preset contract tests: the declaration, the provider binding, and the one
 * property that gives this preset a reason to exist.
 *
 * The tests read `cordis.patch.yml` as data. They need no DSH runtime, no
 * OpenCode install, and no network.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const PATCH = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

/** The `insert` rows, parsed without a YAML dependency.
 *
 * This is not a general YAML parser: it reads the two-level shape this patch
 * uses (a list of `- id:` rows, each with `name` and an optional `config:`).
 * @returns {Array<{id: string, name: string, config?: object}>} the rows.
 */
function insertRows(text) {
  const rows = []
  const lines = text.split('\n')
  let current
  let inInsert = false
  let inConfig = false
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ')
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (trimmed === '- insert:') { inInsert = true; continue }
    if (!inInsert) continue
    if (line.startsWith('    - id:')) {
      current = { id: trimmed.slice(5).trim() }
      rows.push(current)
      inConfig = false
      continue
    }
    if (current === undefined) continue
    if (line.startsWith('      name:')) { current.name = trimmed.slice(5).trim().replace(/^['"]|['"]$/g, ''); continue }
    if (trimmed === 'config:') { inConfig = true; continue }
    if (inConfig && line.startsWith('        ')) continue
  }
  return rows
}

/** The preset declaration row. */
const preset = insertRows(PATCH).find(row => row.id === 'preset-opencode')

/** Collect every leaf entry of a preset's `plugins` list, flattening groups.
 * @param {string} text - the patch source.
 * @returns {string[]} plugin names in declaration order.
 */
function pluginNames(text) {
  const names = []
  let inPreset = false
  let inPlugins = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\t/g, '  ')
    const trimmed = line.trim()
    if (trimmed.startsWith('- id: preset-opencode')) { inPreset = true; continue }
    if (!inPreset) continue
    if (trimmed === 'plugins:') { inPlugins = true; continue }
    if (!inPlugins) continue
    const match = /^-\s*name:\s*(.+)$/.exec(trimmed) ?? /^-?\s*name:\s*(.+)$/.exec(trimmed)
    if (trimmed.startsWith('name:') || trimmed.startsWith('- name:')) {
      names.push(match?.[1]?.replace(/^['"]|['"]$/g, '') ?? '')
    }
  }
  return names
}

test('the patch inserts a provider row, the auto-continue watcher, and a preset row', () => {
  assert.deepEqual(
    insertRows(PATCH).map(row => row.id),
    ['subagent-opencode-provider', 'auto-continue-opencode', 'preset-opencode'],
  )
  assert.equal(insertRows(PATCH)[0].name, '@sredevopsorg/dsh-subagent-opencode')
  assert.equal(insertRows(PATCH)[1].name, '@sredevopsorg/dsh-agent-opencode/auto-continue')
  assert.equal(insertRows(PATCH)[2].name, '@deepseek-ai/dsh-agent-preset')
})

test('the auto-continue watcher is scoped to this preset with the documented guard', () => {
  assert.match(PATCH, /^ {8}presetId: opencode$/m)
  assert.match(PATCH, /^ {8}text: continue$/m)
  assert.match(PATCH, /^ {8}maxAttempts: 5$/m)
  assert.match(PATCH, /^ {8}windowMs: 180000$/m)
})

test('the package exports the auto-continue module the patch mounts', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.exports['./auto-continue'], './auto-continue.js')
  assert.ok(manifest.files.includes('auto-continue.js'), 'Git installs ship the mounted module')
})

test('the preset declares itself with an id, a name, and a roster order', () => {
  assert.ok(preset !== undefined, 'preset-opencode must be inserted')
  assert.match(PATCH, /^ {8}id: opencode$/m)
  assert.match(PATCH, /^ {8}name: OpenCode$/m)
  assert.match(PATCH, /^ {8}order: 30$/m)
})

test('the declared preset id is lowercase kebab-case', () => {
  const id = /^ {8}id: (.+)$/m.exec(PATCH)?.[1] ?? ''
  assert.match(id, /^[a-z][a-z0-9-]*$/)
  assert.equal(id, 'opencode')
})

test('the delegation tool is bound to the opencode provider', () => {
  assert.match(PATCH, /^ {18}provider: opencode$/m)
  assert.match(PATCH, /^ {18}toolName: subagent_opencode$/m)
})

test('maxDepth is provider-managed, because the child is out-of-process', () => {
  assert.match(PATCH, /^ {18}maxDepth: provider-managed$/m)
  assert.doesNotMatch(PATCH, /^ {18}maxDepth: \d+$/m)
})

test('the preset carries no tool that could do the work itself', () => {
  const names = pluginNames(PATCH)
  assert.ok(names.length > 0, 'the preset must declare plugins')
  // These are the tools that would let the agent bypass the delegation and
  // inspect or change the workspace directly.
  const forbidden = [
    '@deepseek-ai/dsh-tool-fs',
    '@deepseek-ai/dsh-tool-fs-search',
    '@deepseek-ai/dsh-tool-bash',
    '@deepseek-ai/dsh-tool-pwsh',
    '@deepseek-ai/dsh-tool-bash-persistent',
    '@deepseek-ai/dsh-tool-jobs',
    '@deepseek-ai/dsh-tool-skill',
    '@deepseek-ai/dsh-skill-filesystem',
    '@deepseek-ai/dsh-workflow-ptc',
    '@deepseek-ai/dsh-tool-workflow',
  ]
  for (const name of forbidden) {
    assert.ok(!names.includes(name), `${name} would let the agent act without delegating`)
  }
})

test('the preset keeps the tools the orchestrator needs', () => {
  const names = pluginNames(PATCH)
  for (const required of [
    '@deepseek-ai/dsh-tool-subagent',
    '@deepseek-ai/dsh-tool-subagent-control',
    '@deepseek-ai/dsh-tool-ask-user',
    '@deepseek-ai/dsh-tool-todo',
    '@deepseek-ai/dsh-plan-mode',
    '@deepseek-ai/dsh-compaction-basic',
  ]) {
    assert.ok(names.includes(required), `${required} is part of the orchestrator's job`)
  }
})

test('the persona states that delegation is the only way to act', () => {
  assert.match(PATCH, /You have no file system, no shell, and no search tools/)
  assert.match(PATCH, /subagent_opencode/)
})

test('the provider defaults are the safe ones', () => {
  // `permission` sits directly under the provider config; the `requirements`
  // block nests one level deeper.
  assert.match(PATCH, /^ {8}permission: reject$/m, 'reject keeps an unattended child from editing')
  assert.match(PATCH, /^ {10}install: false$/m, 'a delegation must never download a program by default')
  assert.match(PATCH, /^ {10}require: \[\]$/m)
})

test('the locale files describe the preset for both languages', () => {
  for (const language of ['en', 'es']) {
    const locale = JSON.parse(readFileSync(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'))
    assert.equal(typeof locale.meta?.title, 'string')
    assert.ok(locale.meta.title.length > 0, `${language} title`)
    assert.ok(locale.meta.description.length > 40, `${language} description`)
  }
})
