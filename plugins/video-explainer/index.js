/**
 * `@sredevopsorg/dsh-video-explainer` — the Video Explainer skill for DeepSeek
 * Harness, packaged as one installable bundle.
 *
 * Ported from https://github.com/petergyang/video-explainer (MIT) at commit
 * `be2f729`. The skill writes the script; the packaged Python pipeline fetches
 * media, synthesizes voice, compiles HyperFrames, renders the MP4, runs the QA
 * checks, and serves the frame-pinned review page. See `docs/UPSTREAM.md` for
 * every adaptation this port makes and `README.md` for the security notes.
 *
 * What `apply()` adds to the host:
 *
 *   1. a skill provider on `ctx.skills` that serves the packaged
 *      `skills/video-explainer/` directory model- and user-invocably;
 *   2. `video_explainer_setup` — a read-only preflight that reports what is
 *      missing with the exact command for it, and installs nothing;
 *   3. `video_explainer_render` — runs ONE documented pipeline step inside a
 *      project folder that already lives in this session's workspace.
 *
 * The package is dependency-free plain ESM: no build step, no install script,
 * and no npm dependency. `schemastery` and `dsh-tools` are loaded from the
 * running DSH installation, which every bundle already shares.
 *
 * @module @sredevopsorg/dsh-video-explainer
 */

import { spawn } from 'node:child_process'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis plugin name (the row id in `cordis.patch.yml`). */
export const name = 'video-explainer'

/** Services this plugin needs. */
export const inject = ['skills', 'tools', 'workingDirectory']

/** Provider name used in the `ctx.skills` registry. */
export const PROVIDER_NAME = 'dsh-video-explainer'

/**
 * Literal value of `BUNDLED_SKILL_RANK` from `@deepseek-ai/dsh-skill`.
 *
 * Duplicated on purpose, exactly like `@sredevopsorg/dsh-skills`: a plugin
 * installed from Git must not import `@deepseek-ai/*` runtime packages, so the
 * standard bundled rank is restated here instead of imported.
 */
const BUNDLED_SKILL_RANK = 600

/** Packaged skill root: `./skills/` next to this module. */
const DEFAULT_SKILLS_DIR = fileURLToPath(new URL('./skills/', import.meta.url))

/** Packaged skill directory whose `scripts/` the tools run. */
const SKILL_NAME = 'video-explainer'

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const TRUE_WORDS = new Set(['true', 'yes', 'on', '1'])
const FALSE_WORDS = new Set(['false', 'no', 'off', '0'])

/** Every step `video_explainer_render` accepts, and the script each one runs. */
export const STEPS = Object.freeze([
  'preflight',
  'narrate',
  'preview',
  'draft',
  'final',
  'qa',
  'review',
  'review-poll',
  'review-ack',
])

// ── Frontmatter ─────────────────────────────────────────────────────────────
// The same small YAML subset the filesystem provider accepts: `key: scalar`,
// folded/literal block scalars, and indented mappings (`metadata`).

function parseScalar(raw) {
  const value = raw.trim()
  if (value === '') return ''
  if (value.startsWith('"')) {
    if (value.length < 2 || !value.endsWith('"')) {
      throw new Error(`unterminated double-quoted scalar: ${value}`)
    }
    try {
      return JSON.parse(value)
    } catch {
      return value.slice(1, -1).replaceAll('\\"', '"').replaceAll('\\\\', '\\')
    }
  }
  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'")) {
      throw new Error(`unterminated single-quoted scalar: ${value}`)
    }
    return value.slice(1, -1).replaceAll("''", "'")
  }
  return value
}

function isBlockIndicator(inline) {
  return /^[>|][+-]?$/.test(inline)
}

function readBlockScalar(lines, startIndex, indicator) {
  const collected = []
  let index = startIndex
  while (index < lines.length) {
    const line = lines[index]
    if (line.trim() === '') {
      collected.push('')
      index += 1
      continue
    }
    if (!/^\s/.test(line)) break
    collected.push(line.trim())
    index += 1
  }
  const value = indicator.startsWith('|')
    ? collected.join('\n').trim()
    : collected
        .join(' ')
        .split(/\s+/)
        .filter(part => part !== '')
        .join(' ')
  return { value, nextIndex: index }
}

function readIndentedLines(lines, startIndex) {
  const block = []
  let index = startIndex
  while (index < lines.length) {
    const line = lines[index]
    if (line.trim() === '') {
      block.push('')
      index += 1
      continue
    }
    if (!/^\s/.test(line)) break
    block.push(line)
    index += 1
  }
  return { block, nextIndex: index }
}

function minimumIndent(lines) {
  let indent = Number.POSITIVE_INFINITY
  for (const line of lines) {
    if (line.trim() === '') continue
    indent = Math.min(indent, /^\s*/.exec(line)[0].length)
  }
  return Number.isFinite(indent) ? indent : 0
}

/**
 * A `key: value` line matched at a sticky offset; no `$` anchor, so the tail is
 * not re-tried at every position (CodeQL js/polynomial-redos).
 */
const KEY_LINE = /([A-Za-z0-9_.-]{1,128}):[ \t]*(.*)/y

function parseMapping(lines) {
  const indent = minimumIndent(lines)
  const data = {}
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (line.trim() === '' || /^\s*#/.test(line)) {
      index += 1
      continue
    }
    if (/^\s*/.exec(line)[0].length !== indent) {
      index += 1
      continue
    }
    KEY_LINE.lastIndex = indent
    const match = KEY_LINE.exec(line)
    if (match === null) {
      throw new Error(`invalid YAML frontmatter line: ${JSON.stringify(line.trim())}`)
    }
    const [, key, inline] = match
    index += 1
    if (isBlockIndicator(inline)) {
      const block = readBlockScalar(lines, index, inline)
      data[key] = block.value
      index = block.nextIndex
      continue
    }
    if (inline !== '') {
      data[key] = parseScalar(inline)
      continue
    }
    const nested = readIndentedLines(lines, index)
    if (nested.block.some(candidate => candidate.trim() !== '')) {
      data[key] = parseMapping(nested.block)
      index = nested.nextIndex
    } else {
      data[key] = ''
    }
  }
  return data
}

/**
 * Split a Markdown skill file into its frontmatter mapping and body.
 * @param {string} raw - complete file contents.
 * @returns {{ data: Record<string, unknown>, body: string } | undefined} `undefined` when
 *   the file has no leading `---` fenced block.
 */
export function parseSkillDocument(raw) {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw)
  if (match === null) return undefined
  return { data: parseMapping(match[1].split(/\r?\n/)), body: raw.slice(match[0].length) }
}

function stringField(data, key) {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalString(data, key) {
  const value = stringField(data, key)
  return value === undefined ? {} : { [key]: value }
}

function objectField(data, key) {
  const value = data[key]
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function frontmatterBoolean(data, key) {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    const normalized = value.toLowerCase()
    if (TRUE_WORDS.has(normalized)) return true
    if (FALSE_WORDS.has(normalized)) return false
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

/**
 * Resolve the invocation policy exactly like the filesystem provider.
 * @param {Record<string, unknown>} data - parsed frontmatter.
 * @returns {{ modelInvocable: boolean, userInvocable: boolean }} resolved policy.
 * @throws {TypeError} when an invocation field is not an accepted boolean spelling.
 */
export function parseInvocationPolicy(data) {
  for (const [legacy, canonical] of [
    ['disableModelInvocation', 'disable-model-invocation'],
    ['modelInvocable', 'disable-model-invocation'],
    ['userInvocable', 'user-invocable'],
  ]) {
    if (Object.hasOwn(data, legacy)) {
      throw new TypeError(`frontmatter field "${legacy}" is unsupported; use "${canonical}"`)
    }
  }
  return {
    modelInvocable: frontmatterBoolean(data, 'disable-model-invocation') !== true,
    userInvocable: frontmatterBoolean(data, 'user-invocable') !== false,
  }
}

/**
 * Parse and validate one skill file.
 * @param {string} raw - complete file contents.
 * @returns {{ name: string, description: string, whenToUse?: string,
 *   invocation: { modelInvocable: boolean, userInvocable: boolean },
 *   metadata?: Record<string, unknown>, content: string } | undefined} parsed skill.
 */
export function parseSkillFile(raw) {
  let parsed
  try {
    parsed = parseSkillDocument(raw)
  } catch {
    return undefined
  }
  if (parsed === undefined) return undefined

  const skillName = stringField(parsed.data, 'name')
  const description = stringField(parsed.data, 'description')
  if (skillName === undefined || description === undefined) return undefined
  if (!KEBAB_CASE.test(skillName)) return undefined

  let invocation
  try {
    invocation = parseInvocationPolicy(parsed.data)
  } catch {
    return undefined
  }

  const metadata = objectField(parsed.data, 'metadata')
  return {
    name: skillName,
    description,
    ...optionalString(parsed.data, 'whenToUse'),
    invocation,
    ...(metadata === undefined ? {} : { metadata }),
    content: parsed.body.trim(),
  }
}

// ── Discovery and provider ──────────────────────────────────────────────────

async function discoverSkillLocators(skillsDir) {
  const entries = await readdir(skillsDir, { withFileTypes: true })
  const locators = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
    if (entry.isDirectory()) {
      locators.push({
        name: entry.name,
        file: join(skillsDir, entry.name, 'SKILL.md'),
        directory: join(skillsDir, entry.name),
      })
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      locators.push({
        name: entry.name.replace(/\.md$/, ''),
        file: join(skillsDir, entry.name),
        directory: skillsDir,
      })
    }
  }
  return locators
}

/**
 * Create the packaged skill provider.
 * @param {object} [options] - provider options.
 * @param {string} [options.skillsDir] - skills root; defaults to the packaged `./skills/`.
 * @param {string} [options.providerName] - registry name; defaults to `dsh-video-explainer`.
 * @param {{ warn?: (message: string) => void }} [options.logger] - host logger for dropped files.
 * @returns {{ name: string, list: Function, get: Function }} skill provider.
 */
export function createProvider(options = {}) {
  const skillsDir = options.skillsDir ?? DEFAULT_SKILLS_DIR
  const providerName = options.providerName ?? PROVIDER_NAME
  const warn = message => options.logger?.warn?.(message)

  return {
    name: providerName,

    async list(lookup = {}) {
      lookup.signal?.throwIfAborted()
      let locators
      try {
        locators = await discoverSkillLocators(skillsDir)
      } catch (error) {
        if (error?.code === 'ENOENT') return []
        throw error
      }

      const candidates = []
      for (const locator of locators) {
        lookup.signal?.throwIfAborted()
        let raw
        try {
          raw = await readFile(locator.file, 'utf8')
        } catch (error) {
          if (error?.code === 'ENOENT') continue
          warn(`skill file ${locator.file} ignored: ${String(error)}`)
          continue
        }
        const parsed = parseSkillFile(raw)
        if (parsed === undefined) {
          warn(`skill file ${locator.file} ignored: missing or invalid frontmatter (name and description are required)`)
          continue
        }
        candidates.push({
          name: parsed.name,
          description: parsed.description,
          ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
          invocation: parsed.invocation,
          provider: providerName,
          source: 'bundled',
          rank: BUNDLED_SKILL_RANK,
          locator: { file: locator.file, directory: locator.directory },
          resourceBase: { kind: 'directory', path: locator.directory },
          path: locator.file,
          ...(parsed.metadata === undefined ? {} : { metadata: parsed.metadata }),
        })
      }
      return candidates
    },

    async get(candidate, lookup = {}) {
      lookup.signal?.throwIfAborted()
      const locator = candidate?.locator
      if (locator === undefined || typeof locator.file !== 'string') return undefined
      let raw
      try {
        raw = await readFile(locator.file, 'utf8')
      } catch (error) {
        if (error?.code === 'ENOENT') return undefined
        throw error
      }
      lookup.signal?.throwIfAborted()
      const parsed = parseSkillFile(raw)
      if (parsed === undefined) return undefined
      return {
        name: parsed.name,
        description: parsed.description,
        ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
        invocation: parsed.invocation,
        provider: candidate.provider,
        source: candidate.source,
        resourceBase: candidate.resourceBase,
        path: candidate.path,
        ...(parsed.metadata === undefined ? {} : { metadata: parsed.metadata }),
        content: parsed.content,
      }
    },
  }
}

// ── Project confinement ─────────────────────────────────────────────────────

/**
 * Resolve a user-supplied project folder and prove it is inside a workspace root.
 *
 * Both sides are canonicalized with `realpath` first, so neither `..` segments
 * nor a symlink can escape the workspace the session may write to.
 *
 * @param {string} project - candidate project folder from the tool call.
 * @param {string} workspaceRoot - canonical absolute workspace root.
 * @returns {Promise<string>} canonical absolute project folder.
 * @throws {Error} when the path is relative, missing, not a directory, or outside the root.
 */
export async function resolveProjectDir(project, workspaceRoot) {
  if (typeof project !== 'string' || project.trim() === '') {
    throw new ToolArgsError(['project is required: pass the explainer project folder'])
  }
  if (!project.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(project)) {
    throw new ToolArgsError([`project must be an absolute path inside the workspace: ${project}`])
  }
  if (typeof workspaceRoot !== 'string' || workspaceRoot.trim() === '') {
    throw new ToolContextUnavailableError(
      'this session has no working directory, so no project folder can be served',
    )
  }
  const canonicalRoot = await realpath(workspaceRoot)
  let canonicalProject
  try {
    canonicalProject = await realpath(resolve(project))
  } catch (error) {
    throw new ToolArgsError([`project folder does not exist: ${project} (${error.code ?? 'error'})`])
  }
  const info = await stat(canonicalProject)
  if (!info.isDirectory()) throw new ToolArgsError([`project must be a directory: ${project}`])
  const inside = relative(canonicalRoot, canonicalProject)
  if (inside === '..' || inside.startsWith(`..${sep}`) || resolve(canonicalRoot, inside) !== canonicalProject) {
    throw new ToolArgsError([
      `project must stay inside the session workspace ${canonicalRoot}: ${canonicalProject}`,
    ])
  }
  return canonicalProject
}

// ── Process runner ──────────────────────────────────────────────────────────

/**
 * Run a command, capturing output and enforcing a timeout without a shell.
 *
 * `argv` is always an argument list and the child is spawned with `shell:
 * false`, so no user-supplied value is ever parsed by a shell.
 *
 * @param {string[]} argv - executable followed by its arguments.
 * @param {object} [options] - run options.
 * @param {number} [options.timeoutMs] - kill the child after this long.
 * @param {AbortSignal} [options.signal] - cancel the child.
 * @returns {Promise<{ exitCode: number | null, stdout: string, stderr: string, timedOut: boolean }>} result.
 */
export function runProcess(argv, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 120_000
  return new Promise(resolveRun => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      resolveRun(value)
    }
    let child
    try {
      child = spawn(argv[0], argv.slice(1), {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...(options.env ?? {}) },
      })
    } catch (error) {
      finish({ exitCode: null, stdout: '', stderr: String(error), timedOut: false })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    timer.unref?.()
    const onAbort = () => {
      timedOut = true
      child.kill('SIGKILL')
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', chunk => {
      stdout += chunk
      if (stdout.length > 1_000_000) stdout = stdout.slice(-500_000)
    })
    child.stderr?.on('data', chunk => {
      stderr += chunk
      if (stderr.length > 1_000_000) stderr = stderr.slice(-500_000)
    })
    child.on('error', error => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      finish({ exitCode: null, stdout, stderr: `${stderr}${error.message}`, timedOut: false })
    })
    child.on('close', code => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      finish({ exitCode: code, stdout, stderr, timedOut })
    })
  })
}

// ── Tool handlers (pure, testable) ──────────────────────────────────────────

/**
 * Read the JSON report `setup.sh --json` prints on its last line.
 * @param {string} stdout - captured standard output.
 * @returns {Record<string, unknown> | undefined} parsed report, when present.
 */
export function parseSetupReport(stdout) {
  for (const line of String(stdout ?? '').trim().split('\n').reverse()) {
    const text = line.trim()
    if (!text.startsWith('{')) continue
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.missing)) return parsed
    } catch {
      // Keep looking; setup.sh may print human-readable lines first.
    }
  }
  return undefined
}

/**
 * Run the read-only preflight.
 * @param {object} options - handler dependencies.
 * @param {string} options.scriptsDir - packaged `scripts/` directory.
 * @param {(argv: string[], options: object) => Promise<object>} options.run - process runner.
 * @param {number} options.timeoutMs - preflight timeout.
 * @param {object} [input] - tool arguments.
 * @param {boolean} [input.voice] - also check the local narration stack.
 * @param {AbortSignal} [signal] - execution cancellation.
 * @returns {Promise<object>} canonical preflight result.
 */
export async function runSetup({ scriptsDir, run, timeoutMs }, input = {}, signal) {
  const argv = [join(scriptsDir, 'setup.sh'), '--json']
  if (input.voice === true) argv.push('--voice')
  const result = await run(argv, { timeoutMs, signal })
  const report = parseSetupReport(result.stdout)
  const missing = report?.missing ?? []
  const ok = result.exitCode === 0 && report?.ok !== false
  return {
    ok,
    installed: false,
    voice: input.voice === true,
    missing,
    optional: report?.optional ?? [],
    bootstrap: report?.bootstrap ?? [],
    notes: report?.notes ?? [],
    message: ok
      ? 'Every required tool is present. Nothing was installed; this preflight is read-only.'
      : `Missing ${missing.length} required item(s). Ask the user before running any of these commands; ` +
        'nothing has been installed.',
    stdoutTail: report === undefined ? String(result.stdout ?? '').slice(-2000) : '',
  }
}

/**
 * Run one pipeline step for a project folder.
 * @param {object} options - handler dependencies.
 * @param {string} options.scriptsDir - packaged `scripts/` directory.
 * @param {(argv: string[], options: object) => Promise<object>} options.run - process runner.
 * @param {string} options.workspaceRoot - canonical session workspace root.
 * @param {number} options.timeoutMs - per-step timeout.
 * @param {object} input - tool arguments.
 * @param {AbortSignal} [signal] - execution cancellation.
 * @returns {Promise<object>} canonical step result.
 */
export async function runStep({ scriptsDir, run, workspaceRoot, timeoutMs }, input = {}, signal) {
  const step = typeof input.step === 'string' ? input.step.trim() : ''
  if (!STEPS.includes(step)) {
    throw new ToolArgsError([`step must be one of ${STEPS.join(', ')}; got ${JSON.stringify(input.step)}`])
  }
  if (step === 'review-ack' && (typeof input.batchId !== 'string' || !/^\d+-[a-f0-9]{8}$/.test(input.batchId))) {
    throw new ToolArgsError(['step review-ack needs the batchId returned by step review-poll'])
  }
  const project = await resolveProjectDir(input.project, workspaceRoot)

  const argv = [
    join(scriptsDir, 'py'),
    join(scriptsDir, 'dsh_run.py'),
    '--project',
    project,
    '--step',
    step,
  ]
  if (input.voice === true) argv.push('--voice')
  if (input.share === true) argv.push('--share')
  if (typeof input.batchId === 'string') argv.push('--batch', input.batchId)
  if (Number.isInteger(input.port) && input.port > 0 && input.port < 65_536) {
    argv.push('--port', String(input.port))
  } else if (step === 'review') {
    throw new ToolArgsError(['step review needs a port between 1 and 65535'])
  }

  const result = await run(argv, { timeoutMs, signal })
  const lastLine = String(result.stdout ?? '').trim().split('\n').filter(Boolean).at(-1) ?? ''
  let payload = {}
  try {
    const parsed = JSON.parse(lastLine)
    if (typeof parsed === 'object' && parsed !== null) payload = parsed
  } catch {
    payload = {}
  }
  const exitCode = result.exitCode ?? Number(payload.exitCode ?? 0)
  return {
    ok: exitCode === 0,
    step,
    project,
    exitCode: Number.isFinite(exitCode) ? exitCode : null,
    outputs: Array.isArray(payload.outputs) ? payload.outputs.filter(p => typeof p === 'string') : [],
    remarks: Array.isArray(payload.remarks) ? payload.remarks.filter(r => typeof r === 'string') : [],
    logTail: String(payload.logTail ?? result.stderr ?? '').slice(-4000),
  }
}

// ── DSH installation modules ────────────────────────────────────────────────

/**
 * Resolve and import a package through the running DSH installation.
 *
 * A bundle installed from Git lives in the profile's `node_modules`, where the
 * Node resolver cannot see the DSH installation's own dependencies. Anchoring
 * on the DSH manifest (or `DSH_INSTALL_DIR`) reuses exactly the resolution
 * `@sredevopsorg/dsh-subagent-opencode` already validates.
 *
 * @param {string} specifier - bare package specifier.
 * @returns {Promise<object>} the module namespace.
 * @throws {Error} when the installation cannot resolve it.
 */
export async function loadFromDsh(specifier) {
  try {
    return await import(specifier)
  } catch {
    // Fall through to the installation's own resolution.
  }
  const [{ createRequire }, { pathToFileURL }, { existsSync }] = await Promise.all([
    import('node:module'),
    import('node:url'),
    import('node:fs'),
  ])
  const anchors = []
  if (typeof process.env.DSH_INSTALL_DIR === 'string' && process.env.DSH_INSTALL_DIR !== '') {
    anchors.push(process.env.DSH_INSTALL_DIR)
  }
  for (const anchor of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-acp']) {
    try {
      anchors.push(createRequire(import.meta.url).resolve(anchor))
    } catch {
      // Try the next anchor.
    }
  }
  const globalCandidate = join(
    process.execPath,
    '..',
    '..',
    'lib',
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'package.json',
  )
  if (existsSync(globalCandidate)) anchors.push(globalCandidate)
  for (const anchor of anchors) {
    try {
      const requireFrom = createRequire(anchor)
      return await import(pathToFileURL(requireFrom.resolve(specifier)).href)
    } catch {
      // Try the next anchor.
    }
  }
  throw new Error(`video-explainer: cannot resolve ${specifier} from the DSH installation`)
}

const toolRuntime = await loadFromDsh('@deepseek-ai/dsh-tools')
const z = (await loadFromDsh('@deepseek-ai/schemastery')).default

/** Raised for invalid tool arguments; the executor renders it as a model-facing error. */
export const ToolArgsError = toolRuntime.ToolArgsError

/** Raised when a tool needs session state it does not have. */
export const ToolContextUnavailableError = toolRuntime.ToolContextUnavailableError

/** Build a registered tool with the shared output contract. */
const defineTool = toolRuntime.defineTool

/** Deployment-owned timeouts and the review server's default port. */
export const Config = z.object({
  /** Timeout for the read-only `setup.sh --json` preflight. */
  setupScriptTimeoutMs: z.natural().default(120_000),
  /** Timeout for one pipeline step (`narrate`, `render`, `qa`). */
  renderTimeoutMs: z.natural().default(3_600_000),
  /** Default port for `step: "review"`; the tool accepts a per-call `port`. */
  reviewPort: z.natural().default(8791),
})

const PROBE_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    command: { type: 'string', required: true },
    why: { type: 'string', required: true },
  },
}

const PREFLIGHT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    installed: { type: 'boolean', required: true, description: 'Always false: the preflight installs nothing.' },
    voice: { type: 'boolean', required: true },
    message: { type: 'string', required: true },
    missing: { type: 'array', required: true, items: PROBE_OUTPUT },
    optional: { type: 'array', required: true, items: PROBE_OUTPUT },
    bootstrap: { type: 'array', required: true, items: PROBE_OUTPUT },
    notes: { type: 'array', required: true, items: { type: 'string' } },
    stdoutTail: { type: 'string', required: true },
  },
}

const STEP_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    step: { type: 'string', required: true },
    project: { type: 'string', required: true },
    exitCode: { type: 'integer', required: true },
    outputs: { type: 'array', required: true, items: { type: 'string' } },
    remarks: { type: 'array', required: true, items: { type: 'string' } },
    logTail: { type: 'string', required: true },
  },
}

// ── Plugin ──────────────────────────────────────────────────────────────────

/**
 * Register the packaged skill provider and the two Video Explainer tools.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} [config] - resolved {@link Config}.
 * @param {object} [deps] - injectable collaborators, for tests.
 * @param {(argv: string[], options: object) => Promise<object>} [deps.run] - process runner.
 */
export function apply(ctx, config = {}, deps = {}) {
  const settings = {
    setupScriptTimeoutMs: config?.setupScriptTimeoutMs ?? 120_000,
    renderTimeoutMs: config?.renderTimeoutMs ?? 3_600_000,
    reviewPort: config?.reviewPort ?? 8791,
  }
  const scriptsDir = join(DEFAULT_SKILLS_DIR, SKILL_NAME, 'scripts')
  const run = deps.run ?? runProcess

  /** Resolve this call's workspace root through the session working directory. */
  const workspaceFor = async call => {
    if (call?.agent === undefined) return undefined
    return ctx.workingDirectory.ensure(call.agent, call.signal)
  }

  ctx.skills.registerProvider(() => createProvider({ logger: ctx.logger }))

  ctx.tools.register(
    defineTool({
      name: 'video_explainer_setup',
      description:
        'Check the local toolchain Video Explainer needs (ffmpeg, Python, Node, the pipeline venv, ' +
        'HyperFrames, and optionally the local narration stack). Read-only: it reports every missing ' +
        'item with the exact command that prepares it and NEVER installs, downloads, or unpacks ' +
        'anything. Ask the user before running any reported command, including the one-time ' +
        'HyperFrames headless Chrome download.',
      parameters: {
        voice: {
          type: 'boolean',
          description: 'Also check the optional local Kokoro TTS + Parakeet narration stack.',
        },
      },
      output: {
        schema: PREFLIGHT_OUTPUT_SCHEMA,
        render: (_args, value) => [
          {
            type: 'text',
            text: `${value.message}\n\n${
              value.missing.length === 0
                ? 'Required tools: all present.'
                : value.missing.map(item => `- ${item.name}: ${item.why}\n    ${item.command}`).join('\n')
            }`,
          },
        ],
      },
      async execute(args, call) {
        return runSetup(
          {
            scriptsDir,
            run,
            timeoutMs: settings.setupScriptTimeoutMs,
          },
          args ?? {},
          call.signal,
        )
      },
      presentCall: args => ({
        card: 'generic',
        title: 'Video Explainer preflight',
        kind: 'other',
        rawInput: args ?? {},
      }),
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'video_explainer_render',
      description:
        'Run ONE Video Explainer pipeline step in a project folder that lives in this session\'s ' +
        'workspace. Steps: preflight, narrate, preview (contact sheet), draft, final, qa, review ' +
        '(starts the local review page), review-poll, review-ack. Long steps can take minutes; ' +
        'the result lists the produced files and the tail of the log. It never installs tools.',
      parameters: {
        project: {
          type: 'string',
          required: true,
          description: 'Absolute path of the explainer project folder inside the session workspace.',
        },
        step: {
          type: 'string',
          required: true,
          enum: [...STEPS],
          description: 'Pipeline step to run.',
        },
        voice: {
          type: 'boolean',
          description: 'For preflight: also check the local narration stack.',
        },
        share: {
          type: 'boolean',
          description: 'For final: also write the small 720p copy under renders/share/.',
        },
        batchId: {
          type: 'string',
          description: 'For review-ack: the batch id returned by review-poll.',
        },
        port: {
          type: 'integer',
          description: 'For review: local review server port on 127.0.0.1.',
        },
      },
      output: {
        schema: STEP_OUTPUT_SCHEMA,
        render: (_args, value) => [
          {
            type: 'text',
            text:
              `${value.step}: ${value.ok ? 'ok' : `failed (exit ${value.exitCode})`} in ${value.project}` +
              (value.outputs.length === 0 ? '' : `\n${value.outputs.map(p => `- ${p}`).join('\n')}`),
          },
        ],
      },
      async execute(args, call) {
        const workspaceRoot = await workspaceFor(call)
        return runStep(
          {
            scriptsDir,
            run,
            workspaceRoot,
            timeoutMs: settings.renderTimeoutMs,
          },
          args ?? {},
          call.signal,
        )
      },
      presentCall: args => ({
        card: 'generic',
        title: 'Video Explainer step',
        kind: 'other',
        rawInput: args ?? {},
      }),
    }),
  )
}
