/**
 * Provider tests: configuration defaults, load-time enforcement, and the
 * start-time contract the subagent service depends on.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { apply, Config } from '../index.js'
import { hostPlatformPackage, knownInstall } from '../install.js'
import { assertLoadTimeRequirements } from '../requirements.js'

/** A context stub that records the provider it is handed. */
function fakeContext({ provide } = {}) {
  const registered = []
  const warnings = []
  return {
    registered,
    warnings,
    logger: { warn(message) { warnings.push(message) }, info() {} },
    subagents: { registerProvider: (provider) => { registered.push(provider) } },
    subprocess: {
      spawn() { throw new Error('spawn should not be reached in these tests') },
      // `provide: false` makes every lookup fail, which is how a host without
      // OpenCode answers. The default must reject, not answer, so a test that
      // installs is not silently treated as resolving.
      async resolveExecutable() {
        if (provide === false) throw Object.assign(new Error('not found'), { code: 'SUBPROCESS_EXECUTABLE_NOT_FOUND' })
        return process.execPath
      },
    },
  }
}

/** Resolve Config the way the loader does, then apply it. */
function mount(overrides = {}, context) {
  const ctx = fakeContext(context)
  const config = Config(overrides)
  apply(ctx, config)
  return { ctx, provider: ctx.registered[0] }
}

/** A temporary directory removed when the test ends. */
function tempDir(t, prefix = 'dsh-subagent-opencode-provider-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A start request for a provider test. */
function request() {
  return { prompt: [{ type: 'text', text: 'hi' }], cwd: process.cwd(), signal: new AbortController().signal }
}

test('the default configuration registers the opencode provider', () => {
  const { ctx, provider } = mount()
  assert.equal(ctx.registered.length, 1)
  assert.equal(provider.name, 'opencode')
})

test('the provider advertises no start-time capabilities', () => {
  const { provider } = mount()
  assert.deepEqual(provider.capabilities, {
    agentOptions: false,
    agentPreset: false,
    outputSchema: false,
    depthLimit: false,
  })
  assert.equal(provider.inheritsParentContext, false)
})

test('providerName renames the registry entry', () => {
  const { provider } = mount({ providerName: 'oc' })
  assert.equal(provider.name, 'oc')
})

test('an empty require list mounts without any OpenCode configuration', () => {
  assert.doesNotThrow(() => mount({ requirements: { require: [] } }))
})

test('a required credential missing at load fails the plugin mount', () => {
  assert.throws(
    () => mount({ requirements: { require: ['credentials'], credentials: ['DSH_TEST_ABSENT_KEY'] } }),
    /required configuration is missing: DSH_TEST_ABSENT_KEY is not set/,
  )
})

test('a required model that is malformed fails the plugin mount', () => {
  assert.throws(
    () => mount({ requirements: { require: ['model'], model: 'not-a-model' } }),
    /must look like "provider\/model"/,
  )
})

test('a required auth gate fails when the configured home has no store', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-subagent-opencode-mount-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  assert.throws(
    () => mount({ requirements: { require: ['auth'], home } }),
    /OpenCode has no stored credentials/,
  )
})

test('an unknown gate is rejected by the schema before the plugin loads', () => {
  // schemastery narrows `require` to the known gates, so a typo never reaches
  // assertRequirements; that helper still guards direct callers.
  assert.throws(
    () => mount({ requirements: { require: ['nope'] } }),
    /expected "auth" \| "credentials" \| "model"/,
  )
})

test('a non-positive process grace is rejected at load', () => {
  assert.throws(() => mount({ disposeGraceMs: 0 }), /disposeGraceMs must be a positive finite number/)
  assert.throws(() => mount({ disposeGraceMs: Number.POSITIVE_INFINITY }), /disposeGraceMs/)
})

test('start rejects before spawning when a credential disappears after load', async () => {
  const name = 'DSH_TEST_LATE_KEY'
  process.env[name] = 'set-at-mount'
  const { provider } = mount({ requirements: { require: ['credentials'], credentials: [name] } })
  delete process.env[name]
  await assert.rejects(
    provider.start({
      prompt: [{ type: 'text', text: 'hi' }],
      cwd: process.cwd(),
      signal: new AbortController().signal,
    }),
    new RegExp(`required configuration is missing: ${name}`),
  )
})

test('the required install gate is part of the schema', () => {
  assert.doesNotThrow(() => mount({ requirements: { require: ['install'] } }))
  assert.throws(
    () => mount({ requirements: { require: ['instal'] } }),
    /expected "auth" \| "credentials" \| "model" \| "install"/,
  )
  assert.throws(
    () => assertLoadTimeRequirements({ require: ['nope'] }, process.env),
    /requirements.require accepts install, credentials, auth, model; found "nope"/,
  )
})

test('an install path must be absolute before the plugin mounts', () => {
  assert.throws(
    () => mount({ requirements: { installDir: 'relative/opencode' } }),
    /requirements.installDir must be an absolute path/,
  )
  assert.throws(
    () => mount({ requirements: { installBinDir: './bin' } }),
    /requirements.installBinDir must be an absolute path/,
  )
})

test('an install policy the provider cannot honor fails the plugin mount', () => {
  assert.throws(
    () => mount({ requirements: { installManager: 'yarn' } }),
    /expected "pnpm" \| "npm" \| "none"/,
  )
})

test('a command that does not resolve fails the run with the install stage', async (t) => {
  const { provider, ctx } = mount({ requirements: { installDir: tempDir(t) } }, { provide: false })
  await assert.rejects(provider.start(request()), /stage: install/)
  assert.equal(ctx.warnings.length, 0, 'nothing is installed and nothing is logged')
})

test('the install gate names the manual command, and the opt-in', async (t) => {
  const { provider } = mount(
    { requirements: { require: ['install'], installDir: tempDir(t) } },
    { provide: false },
  )
  await assert.rejects(
    provider.start(request()),
    /the OpenCode command does not resolve; run `pnpm add -g --allow-build=@opencode\/cli @opencode\/cli`, or set requirements.install/,
  )
})

test('a command that is not OpenCode is never installed over', async (t) => {
  const { provider, ctx } = mount(
    { command: 'opencode-beta', requirements: { install: true, installDir: tempDir(t) } },
    { provide: false },
  )
  await assert.rejects(provider.start(request()), /stage: install/)
  assert.equal(ctx.warnings.length, 0, 'installing would not make this command resolvable')
})

test('an empty install directory is not read as an install', (t) => {
  assert.equal(knownInstall(tempDir(t)), undefined)
})

test('the agent preset settings resolve an install directory through apply', () => {
  // cordis.patch.yml in agent-opencode declares exactly this requirements block.
  const { provider } = mount({ requirements: { require: [], install: false } })
  const resolved = provider.config.requirements
  assert.equal(typeof resolved.installDir, 'string')
  assert.notEqual(resolved.installDir, '')
  assert.equal(provider.config.installDir, undefined, 'the dead top-level key is gone')
})

test('an explicitly configured install directory survives resolution', (t) => {
  const dir = tempDir(t)
  const { provider } = mount({ requirements: { install: false, installDir: dir } })
  assert.equal(provider.config.requirements.installDir, dir)
})

test('an opt-in install in a configured directory is still reused', async (t) => {
  const dir = tempDir(t)
  const platform = hostPlatformPackage()
  assert.ok(platform, 'the host has an OpenCode platform package')
  const executable = join(dir, 'node_modules', ...platform.split('/'), 'bin', 'opencode')
  mkdirSync(dirname(executable), { recursive: true })
  writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const { provider } = mount({ requirements: { install: true, installDir: dir } }, { provide: false })
  assert.deepEqual(await provider.resolveExecutable(), { executable, install: true })
})

test('a missing install directory and no OpenCode on PATH fail with a plugin diagnostic', async () => {
  const { provider, ctx } = mount({ requirements: { require: [], install: false } }, { provide: false })
  await assert.rejects(
    provider.start(request()),
    (error) => {
      assert.doesNotMatch(error.message, /ERR_INVALID_ARG_TYPE|The "path" argument must be of type string/)
      assert.match(error.message, /subagent-opencode: Subagent failure/)
      assert.match(error.message, /stage: install/)
      return true
    },
  )
  assert.equal(ctx.warnings.length, 0, 'nothing is installed and nothing is logged')
})

test('an aborted request starts nothing', async (t) => {
  const { provider } = mount({ requirements: { install: true, installDir: tempDir(t) } })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    provider.start({ ...request(), signal: controller.signal }),
    /the run was aborted/,
  )
})
