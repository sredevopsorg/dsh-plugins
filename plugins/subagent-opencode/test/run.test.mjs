/**
 * Runner tests: the one-shot ACP lifecycle against a scripted agent.
 *
 * Each test spawns `node test/fixtures/fake-opencode-agent.mjs`, a stand-in for
 * `opencode acp` that speaks the same newline-delimited JSON-RPC. No OpenCode
 * installation, credentials, or network are required.
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { acpArgs, mapStopReason, permissionOutcome, startOpenCodeRun, taskText } from '../acp.js'
import { loadAcpSdk } from '../sdk.js'

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-opencode-agent.mjs', import.meta.url))

/**
 * Spawn the fixture through a seam-shaped handle.
 * @param {object} scenario - fixture script.
 * @param {object} [overrides] - run spec overrides.
 * @returns {object} run spec.
 */
async function specFor(scenario, overrides = {}) {
  const sdk = await loadAcpSdk()
  return {
    cwd: process.cwd(),
    args: ['acp'],
    permission: 'reject',
    disposeGraceMs: 300,
    env: {},
    configOptions: {},
    sdk,
    resolveCommand: async () => process.execPath,
    spawn: () => {
      const child = spawn(process.execPath, [FIXTURE, JSON.stringify(scenario)], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const done = new Promise((resolve, reject) => {
        child.on('exit', (exitCode, signal) => resolve({ exitCode, signal }))
        child.on('error', reject)
      })
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        done,
        terminate: () => { child.kill('SIGTERM') },
        waitForExit: async () => true,
      }
    },
    ...overrides,
  }
}

/** A start request carrying one text task. */
function request(signal) {
  return {
    prompt: [{ type: 'text', text: 'Say hello' }],
    signal: signal ?? new AbortController().signal,
    cwd: process.cwd(),
  }
}

test('argv normalization adds acp once and keeps operator flags', () => {
  assert.deepEqual(acpArgs([]), ['acp'])
  assert.deepEqual(acpArgs(['acp']), ['acp'])
  assert.deepEqual(acpArgs(['--print-logs']), ['acp', '--print-logs'])
  assert.deepEqual(acpArgs(['--print-logs', 'acp']), ['--print-logs', 'acp'])
  assert.equal(acpArgs(['acp']).filter(a => a === 'acp').length, 1)
})

test('stop reasons map onto the shared vocabulary', () => {
  assert.equal(mapStopReason('end_turn'), 'completed')
  assert.equal(mapStopReason('max_tokens'), 'max-tokens')
  assert.equal(mapStopReason('refusal'), 'refusal')
  assert.equal(mapStopReason('cancelled'), 'aborted')
  assert.equal(mapStopReason('something-new'), 'error')
})

test('the permission policy picks the configured option kind', () => {
  const params = {
    options: [
      { optionId: 'once', kind: 'allow_once' },
      { optionId: 'always', kind: 'allow_always' },
      { optionId: 'no', kind: 'reject_once' },
    ],
  }
  assert.deepEqual(permissionOutcome(params, 'allow'), { outcome: { outcome: 'selected', optionId: 'once' } })
  assert.deepEqual(permissionOutcome(params, 'reject'), { outcome: { outcome: 'selected', optionId: 'no' } })
  assert.deepEqual(permissionOutcome({ options: [] }, 'allow'), { outcome: { outcome: 'cancelled' } })
})

test('a task must contain non-empty text blocks', () => {
  assert.deepEqual(taskText([{ type: 'text', text: 'hi' }]), [{ type: 'text', text: 'hi' }])
  for (const bad of [[], [{ type: 'image', data: 'x' }], [{ type: 'text', text: '   ' }]]) {
    assert.throws(() => taskText(bad), /one-shot task/)
  }
})

test('a completed run returns the final text and no diagnostic', async () => {
  const run = await startOpenCodeRun(request(), await specFor({}))
  const result = await run.result
  assert.equal(result.stopReason, 'completed')
  assert.deepEqual(result.output, [{ type: 'text', text: 'Hello from fake OpenCode.' }])
  assert.equal(result.diagnostic, undefined)
  await run.dispose()
})

test('required configurations are applied before the prompt runs', async () => {
  const seen = []
  const spec = await specFor({}, { configOptions: { model: 'openai/gpt-5-codex', effort: 'high', mode: 'build' } })
  const spawnRun = spec.spawn
  spec.spawn = (spawnSpec) => {
    seen.push(...spawnSpec.argv)
    return spawnRun(spawnSpec)
  }
  const run = await startOpenCodeRun(request(), spec)
  assert.equal((await run.result).stopReason, 'completed')
  // The configured model and mode are always sent, and effort when present.
  assert.ok(spec.configOptions.model)
  assert.ok(spec.configOptions.mode)
  await run.dispose()
})

test('a rejected session option fails the start before publication', async () => {
  await assert.rejects(
    startOpenCodeRun(
      request(),
      await specFor({ rejectConfigOption: true }, { configOptions: { model: 'openai/gpt-5-codex', mode: 'build' } }),
    ),
    (error) => {
      assert.match(error.message, /stage: configure/)
      return true
    },
  )
})

test('authentication failure is classified and keeps the payload out', async () => {
  await assert.rejects(
    startOpenCodeRun(request(), await specFor({
      failSessionNew: { code: -32000, message: 'provider authentication required' },
    })),
    (error) => {
      assert.match(error.message, /stage: session-new; category: auth-required/)
      assert.doesNotMatch(error.message, /provider authentication required/)
      return true
    },
  )
})

test('an unresolvable executable reports the install stage', async () => {
  await assert.rejects(
    startOpenCodeRun(request(), await specFor({}, {
      resolveCommand: async () => {
        throw Object.assign(new Error('not found'), { code: 'SUBPROCESS_EXECUTABLE_NOT_FOUND' })
      },
    })),
    (error) => {
      assert.match(error.message, /stage: install/)
      return true
    },
  )
})

test('a non-completed stop reason keeps partial text and a bounded diagnostic', async () => {
  const run = await startOpenCodeRun(
    request(),
    await specFor({ askPermission: true, stopReason: 'max_tokens' }),
  )
  const result = await run.result
  assert.equal(result.stopReason, 'max-tokens')
  assert.deepEqual(result.output, [{ type: 'text', text: 'Hello from fake OpenCode.' }])
  assert.match(result.diagnostic, /stage: prompt; category: max-tokens; permissions requested: 1/)
  assert.doesNotMatch(result.diagnostic, /Read src\/index\.js/)
  await run.dispose()
})

test('a child that dies mid-prompt settles as an error with its facts', async () => {
  const run = await startOpenCodeRun(request(), await specFor({ exitDuringPrompt: true }))
  const result = await run.result
  assert.equal(result.stopReason, 'error')
  assert.deepEqual(result.output, [{ type: 'text', text: 'Hello from fake OpenCode.' }])
  assert.match(result.diagnostic, /product: OpenCode/)
  await run.dispose()
})

test('cancellation after publication settles as aborted and reaps the child', async () => {
  const controller = new AbortController()
  const run = await startOpenCodeRun(
    request(controller.signal),
    await specFor({ holdPrompt: true }, { disposeGraceMs: 200 }),
  )
  setTimeout(() => controller.abort(), 100)
  const result = await run.result
  assert.equal(result.stopReason, 'aborted')
  await run.dispose()
})

test('dispose is idempotent', async () => {
  const run = await startOpenCodeRun(request(), await specFor({ holdPrompt: true }, { disposeGraceMs: 200 }))
  const first = run.dispose()
  const second = run.dispose()
  assert.equal(first, second)
  await first
  assert.equal((await run.result).stopReason, 'aborted')
})

test('an already-aborted request never spawns a child', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    startOpenCodeRun(request(controller.signal), await specFor({})),
    /Subagent failure/,
  )
})

test('a failed initialize names the stage and disposes the child', async () => {
  let terminated = false
  const spec = await specFor({ failInitialize: true })
  const spawnRun = spec.spawn
  spec.spawn = (spawnSpec) => {
    const handle = spawnRun(spawnSpec)
    const terminate = handle.terminate
    handle.terminate = () => { terminated = true; terminate() }
    return handle
  }
  await assert.rejects(startOpenCodeRun(request(), spec), /stage: initialize/)
  assert.equal(terminated, true)
})

test('a refusal maps through and keeps its category in the diagnostic', async () => {
  const run = await startOpenCodeRun(request(), await specFor({ stopReason: 'refusal' }))
  const result = await run.result
  assert.equal(result.stopReason, 'refusal')
  assert.match(result.diagnostic, /category: refusal/)
  await run.dispose()
})
