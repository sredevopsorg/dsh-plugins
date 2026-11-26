import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  STEPS,
  ToolArgsError,
  apply,
  parseSetupReport,
  resolveProjectDir,
  runProcess,
  runSetup,
  runStep,
} from '../index.js'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const scriptsDir = join(packageRoot, 'skills', 'video-explainer', 'scripts')

/** A runner seam that records the argv it was asked to run and returns a canned result. */
function recorder(response = { exitCode: 0, stdout: '', stderr: '' }) {
  const calls = []
  const run = async (argv, options) => {
    calls.push({ argv, options })
    return { stdout: '', stderr: '', ...response }
  }
  return { calls, run }
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-video-explainer-'))
  return { root, canonical: await realpath(root) }
}

test('Config resolves without any argument', async () => {
  const module = await import('../index.js')
  const resolved = module.Config({})
  assert.equal(resolved.setupScriptTimeoutMs, 120_000)
  assert.equal(resolved.renderTimeoutMs, 3_600_000)
  assert.equal(resolved.reviewPort, 8791)
})

test('the preflight parses setup.sh --json and reports that nothing was installed', async () => {
  const report = {
    ok: false,
    voice: false,
    missing: [{ name: 'ffmpeg', command: 'sudo apt install ffmpeg', why: 'mix audio' }],
    optional: [],
    bootstrap: [{ command: 'npx -y hyperframes@0.9.79 browser ensure', why: 'chrome' }],
    notes: ['hyperframes: pinned'],
    installed: false,
  }
  const { calls, run } = recorder({ exitCode: 1, stdout: `preflight\n${JSON.stringify(report)}\n` })
  const result = await runSetup({ scriptsDir, run, timeoutMs: 1000 }, {})
  assert.equal(result.ok, false)
  assert.equal(result.installed, false)
  assert.equal(result.missing.length, 1)
  assert.equal(result.bootstrap[0].command, 'npx -y hyperframes@0.9.79 browser ensure')
  assert.match(result.message, /Ask the user/)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].argv.slice(1), ['--json'])
  assert.equal(calls[0].options.timeoutMs, 1000)

  const voice = await runSetup({ scriptsDir, run, timeoutMs: 1000 }, { voice: true })
  assert.equal(voice.voice, true)
  assert.deepEqual(calls[1].argv.slice(1), ['--json', '--voice'])
})

test('parseSetupReport ignores human-readable noise and finds the JSON line', () => {
  assert.deepEqual(parseSetupReport('line\n{"missing":[],"ok":true}\n'), { missing: [], ok: true })
  assert.equal(parseSetupReport('no json here'), undefined)
  assert.equal(parseSetupReport('{"not":"a report"}'), undefined)
})

test('a step rejects an unknown step name before running anything', async () => {
  const { root, canonical } = await workspace()
  try {
    const { calls, run } = recorder()
    await assert.rejects(
      runStep({ scriptsDir, run, workspaceRoot: canonical, timeoutMs: 1000 }, { project: root, step: 'deploy' }),
      ToolArgsError,
    )
    assert.equal(calls.length, 0, 'nothing may be spawned for an invalid step')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a step rejects a project outside the session workspace', async () => {
  const { root, canonical } = await workspace()
  const outside = await workspace()
  try {
    const { calls, run } = recorder()
    await assert.rejects(
      runStep({ scriptsDir, run, workspaceRoot: canonical, timeoutMs: 1000 }, { project: outside.root, step: 'qa' }),
      ToolArgsError,
    )
    assert.equal(calls.length, 0)
    // A traversal that resolves back inside is fine; one that escapes is not.
    await assert.rejects(
      runStep(
        { scriptsDir, run, workspaceRoot: canonical, timeoutMs: 1000 },
        { project: `${canonical}/../${outside.root.split('/').at(-1)}`, step: 'qa' },
      ),
      ToolArgsError,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside.root, { recursive: true, force: true })
  }
})

test('a relative project path is rejected', async () => {
  const { root, canonical } = await workspace()
  try {
    const { run } = recorder()
    await assert.rejects(
      runStep({ scriptsDir, run, workspaceRoot: canonical, timeoutMs: 1000 }, { project: 'projects/demo', step: 'qa' }),
      /absolute path/,
    )
    await assert.rejects(resolveProjectDir('', canonical), ToolArgsError)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a symlink cannot smuggle a project outside the workspace', async () => {
  const { root, canonical } = await workspace()
  const outside = await workspace()
  try {
    await symlink(outside.root, join(root, 'escape'))
    {
      const { run } = recorder()
      await assert.rejects(
        runStep({ scriptsDir, run, workspaceRoot: canonical, timeoutMs: 1000 }, { project: join(root, 'escape'), step: 'qa' }),
        /session workspace/,
      )
    }
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside.root, { recursive: true, force: true })
  }
})

test('a valid step runs dsh_run.py with the documented arguments', async () => {
  const { root, canonical } = await workspace()
  try {
    await mkdir(join(root, 'demo'))
    const payload = { ok: true, step: 'draft', exitCode: 0, outputs: [join(root, 'demo', 'renders', 'demo-v1.mp4')], remarks: [] }
    const { calls, run } = recorder({ exitCode: 0, stdout: `noise\n${JSON.stringify(payload)}\n` })
    const result = await runStep(
      { scriptsDir, run, workspaceRoot: canonical, timeoutMs: 5000 },
      { project: join(root, 'demo'), step: 'draft' },
    )
    assert.equal(result.ok, true)
    assert.equal(result.step, 'draft')
    assert.equal(result.project, join(canonical, 'demo'))
    assert.deepEqual(result.outputs, payload.outputs)
    const argv = calls[0].argv
    assert.equal(argv[0], join(scriptsDir, 'py'))
    assert.equal(argv[1], join(scriptsDir, 'dsh_run.py'))
    assert.deepEqual(argv.slice(2), ['--project', join(canonical, 'demo'), '--step', 'draft'])
    assert.equal(calls[0].options.timeoutMs, 5000)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('review-ack requires the batch id from review-poll', async () => {
  const { root, canonical } = await workspace()
  try {
    const { calls, run } = recorder()
    await assert.rejects(
      runStep({ scriptsDir, run, workspaceRoot: canonical, timeoutMs: 1000 }, { project: root, step: 'review-ack' }),
      /batchId/,
    )
    await assert.rejects(
      runStep(
        { scriptsDir, run, workspaceRoot: canonical, timeoutMs: 1000 },
        { project: root, step: 'review-ack', batchId: '../../etc/passwd' },
      ),
      /batchId/,
    )
    assert.equal(calls.length, 0)
    const ok = await runStep(
      { scriptsDir, run, workspaceRoot: canonical, timeoutMs: 1000 },
      { project: root, step: 'review-ack', batchId: '1764000000000000000-a1b2c3d4' },
    )
    assert.equal(ok.ok, true)
    assert.deepEqual(calls[0].argv.slice(-2), ['--batch', '1764000000000000000-a1b2c3d4'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a review step must carry a usable port', async () => {
  const { root, canonical } = await workspace()
  try {
    const { run } = recorder()
    await assert.rejects(
      runStep(
        { scriptsDir, run, workspaceRoot: canonical, timeoutMs: 1000 },
        { project: root, step: 'review', port: 70_000 },
      ),
      /port/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a failing step surfaces the log tail instead of claiming success', async () => {
  const { root, canonical } = await workspace()
  try {
    const payload = { ok: false, step: 'final', exitCode: 1, outputs: [], remarks: [], logTail: 'ffmpeg failed' }
    const { run } = recorder({ exitCode: 1, stdout: `${JSON.stringify(payload)}\n` })
    const result = await runStep(
      { scriptsDir, run, workspaceRoot: canonical, timeoutMs: 1000 },
      { project: root, step: 'final' },
    )
    assert.equal(result.ok, false)
    assert.equal(result.exitCode, 1)
    assert.match(result.logTail, /ffmpeg failed/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('every documented step is accepted by the schema', () => {
  assert.equal(STEPS.length, 9)
  for (const step of STEPS) assert.equal(typeof step, 'string')
})

test('runProcess never uses a shell and enforces its timeout', async () => {
  const quoted = await runProcess([process.execPath, '-e', 'process.stdout.write(process.argv[1])', '$(echo injected); `x`'], {
    timeoutMs: 5000,
  })
  assert.equal(quoted.exitCode, 0)
  assert.equal(quoted.stdout, '$(echo injected); `x`', 'arguments must reach the child verbatim')

  const slow = await runProcess([process.execPath, '-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 200 })
  assert.equal(slow.timedOut, true)
  assert.equal(slow.exitCode, null)

  const missing = await runProcess([join(tmpdir(), 'definitely-not-a-binary-xyz')], { timeoutMs: 1000 })
  assert.equal(missing.exitCode, null)
  assert.ok((missing.stderr ?? '').length > 0)
})

test('apply registers the skill provider and both tools without touching the disk', async () => {
  const registered = { providers: [], tools: [] }
  const ctx = {
    logger: { warn() {} },
    skills: { registerProvider(factory) { registered.providers.push(factory) } },
    tools: { register(definition) { registered.tools.push(definition); return () => {} } },
    workingDirectory: { async ensure() { return '/tmp' } },
  }
  const run = async () => ({ exitCode: 0, stdout: '{"ok":true,"missing":[]}', stderr: '' })
  apply(ctx, {}, { run })

  assert.equal(registered.providers.length, 1)
  const provider = registered.providers[0]()
  assert.equal(provider.name, 'dsh-video-explainer')
  assert.equal((await provider.list({})).length, 1)

  assert.deepEqual(registered.tools.map(tool => tool.name).sort(), [
    'video_explainer_render',
    'video_explainer_setup',
  ])
  for (const tool of registered.tools) {
    assert.equal(typeof tool.execute, 'function')
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(typeof tool.parameters, 'object')
  }

  const setup = registered.tools.find(tool => tool.name === 'video_explainer_setup')
  const setupResult = await setup.execute({ voice: false }, { signal: undefined })
  assert.equal(setupResult.ok, true)
  assert.equal(setupResult.installed, false)
  assert.ok(setup.output.render({}, setupResult)[0].text.length > 0)

  const render = registered.tools.find(tool => tool.name === 'video_explainer_render')
  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-ve-apply-'))
  try {
    await writeFile(join(tempRoot, 'script.md'), '# t\n')
    ctx.workingDirectory.ensure = async () => await realpath(tempRoot)
    // render needs the agent so the workspace can be resolved for this call.
    const stepResult = await render.execute({ project: tempRoot, step: 'preflight' }, { agent: {}, signal: undefined })
    assert.equal(stepResult.step, 'preflight')
    assert.ok(render.output.render({}, stepResult)[0].text.includes('preflight'))
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('apply refuses to spawn anything when the session has no working directory', async () => {
  const tools = []
  const ctx = {
    logger: { warn() {} },
    skills: { registerProvider() {} },
    tools: { register(definition) { tools.push(definition) } },
    workingDirectory: { async ensure() { return undefined } },
  }
  let spawned = 0
  apply(ctx, {}, { run: async () => { spawned += 1; return { exitCode: 0, stdout: '', stderr: '' } } })
  const render = tools.find(tool => tool.name === 'video_explainer_render')
  await assert.rejects(render.execute({ project: '/tmp', step: 'qa' }, {}), /working directory/)
  assert.equal(spawned, 0)
})
