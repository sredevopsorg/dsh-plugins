import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
const patch = await readFile(join(packageRoot, 'cordis.patch.yml'), 'utf8')

test('the package declares the repository packaging contract', () => {
  assert.equal(manifest.name, '@sredevopsorg/dsh-video-explainer')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.private, undefined)
  assert.equal(manifest.engines.dsh, '^0.2.1-rc.2')
  assert.equal(manifest.dsh.manifestVersion, 1)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.repository.type, 'git')
  assert.equal(manifest.repository.url, 'git+https://github.com/sredevopsorg/dsh-plugins.git')
  assert.equal(manifest.repository.directory, 'plugins/video-explainer')
  assert.equal(manifest.homepage, 'https://github.com/sredevopsorg/dsh-plugins/tree/main/plugins/video-explainer#readme')
  assert.equal(manifest.bugs.url, 'https://github.com/sredevopsorg/dsh-plugins/issues')
})

test('the package ships every file a Git install needs', () => {
  for (const entry of [
    'index.js',
    'README.md',
    'LICENSE',
    'cordis.patch.yml',
    'icon.svg',
    'locale/*.json',
    'docs',
    'skills',
    'test/*.test.mjs',
  ]) {
    assert.ok(manifest.files.includes(entry), `files must ship ${entry}`)
  }
})

test('the package has no dependency, peer dependency, or install script', () => {
  // A Git-installed bundle must be self-contained; the host modules are resolved
  // from the running DSH installation instead (see docs/UPSTREAM.md).
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    assert.equal(manifest[field], undefined, `${field} must not be declared`)
  }
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublishOnly']) {
    assert.equal(manifest.scripts?.[hook], undefined, `scripts.${hook} must not run on install`)
  }
  assert.equal(manifest.scripts.test, 'node --test test/*.test.mjs')
})

test('the bundle patch inserts one host row and one opt-in preset', () => {
  assert.match(patch, /- id: video-explainer\s*\n\s*name: '@sredevopsorg\/dsh-video-explainer'/)
  assert.match(patch, /- id: preset-video-explainer\s*\n\s*name: '@deepseek-ai\/dsh-agent-preset'/)
  // A preset must not depend on a subagent provider the profile has to supply.
  const rows = patch
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n')
  assert.doesNotMatch(rows, /dsh-tool-subagent/, 'no row may bind a subagent provider')
  assert.match(patch, /id: video-explainer\n\s+name: Video Explainer\n\s+description:/)
  for (const row of ['tool-bash', 'tool-jobs', 'tool-web', 'tool-fs', 'tool-skill', 'tool-ask-user', 'tool-todo']) {
    assert.ok(patch.includes(`@deepseek-ai/dsh-${row}`), `the preset needs ${row}`)
  }
})

test('the packaged scripts, skill, and font ship in the npm tarball', async () => {
  // A file on disk that npm pack drops is not installed, no matter what the
  // provider scans. This is the regression test for the font that
  // styles/*.json references.
  let packed
  let parsed
  try {
    // A private cache: npm's default cache may be outside the sandbox.
    const cache = join(tmpdir(), 'dsh-video-explainer-npm-cache')
    const stdout = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: packageRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_cache: cache,
        npm_config_logs_dir: cache,
        npm_config_loglevel: 'silent',
        npm_config_update_notifier: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // npm 10/11 print an array; npm 12 prints an object keyed by package name.
    const first = stdout.indexOf('[') !== -1 && stdout.indexOf('{') === -1 ? stdout.indexOf('[') : stdout.indexOf('{')
    const json = stdout.slice(first)
    const shape = JSON.parse(json.endsWith(']') ? json.slice(0, json.lastIndexOf(']') + 1) : json)
    const entry = Array.isArray(shape) ? shape[0] : Object.values(shape)[0]
    packed = new Set(entry.files.map(file => file.path))
  } catch (error) {
    if (error.code === 'ENOENT') {
      // No npm on PATH: fall back to the file system contract below.
      packed = undefined
    } else {
      throw error
    }
  }
  const expected = [
    'index.js',
    'LICENSE',
    'cordis.patch.yml',
    'icon.svg',
    'locale/en.json',
    'locale/es.json',
    'docs/UPSTREAM.md',
    'skills/video-explainer/SKILL.md',
    'skills/video-explainer/reference.md',
    'skills/video-explainer/eval.md',
    'skills/video-explainer/requirements.txt',
    'skills/video-explainer/requirements-voice.txt',
    'skills/video-explainer/fonts/InterVariable.woff2',
    'skills/video-explainer/fonts/OFL.txt',
    'skills/video-explainer/scripts/py',
    'skills/video-explainer/scripts/setup.sh',
    'skills/video-explainer/scripts/dsh_run.py',
    'skills/video-explainer/assets/stage.js',
    'skills/video-explainer/assets/stage.css',
    'skills/video-explainer/assets/illustrated.js',
    'skills/video-explainer/assets/studio3d.js',
    'skills/video-explainer/styles/default.json',
    'skills/video-explainer/styles/paper.json',
    'skills/video-explainer/styles/blueprint.json',
  ]
  for (const file of expected) {
    const info = await stat(join(packageRoot, file))
    assert.ok(info.size > 0, `${file} must exist and be non-empty`)
    if (packed !== undefined) assert.ok(packed.has(file), `npm pack must ship ${file}`)
  }
})

test('the launcher scripts stay executable', async () => {
  for (const script of ['py', 'setup.sh']) {
    const info = await stat(join(packageRoot, 'skills', 'video-explainer', 'scripts', script))
    assert.ok((info.mode & 0o111) !== 0, `${script} must be executable`)
  }
})

test('docs and locale files are present and parseable', async () => {
  const en = JSON.parse(await readFile(join(packageRoot, 'locale', 'en.json'), 'utf8'))
  const es = JSON.parse(await readFile(join(packageRoot, 'locale', 'es.json'), 'utf8'))
  for (const locale of [en, es]) {
    assert.equal(typeof locale.meta.title, 'string')
    assert.equal(typeof locale.meta.description, 'string')
  }
  const upstream = await readFile(join(packageRoot, 'docs', 'UPSTREAM.md'), 'utf8')
  assert.match(upstream, /be2f729/, 'docs/UPSTREAM.md must name the upstream commit')
  assert.match(upstream, /petergyang\/video-explainer/)
  const license = await readFile(join(packageRoot, 'LICENSE'), 'utf8')
  assert.match(license, /MIT License/)
  assert.match(license, /Peter Yang|petergyang/)
})

test('the plugin module exposes the Cordis surface', async () => {
  const module = await import(new URL('../index.js', import.meta.url).href)
  assert.equal(module.name, 'video-explainer')
  assert.deepEqual([...module.inject], ['skills', 'tools', 'workingDirectory'])
  assert.equal(module.PROVIDER_NAME, 'dsh-video-explainer')
  assert.equal(typeof module.apply, 'function')
  assert.equal(typeof module.Config, 'function')
  for (const step of ['preflight', 'narrate', 'preview', 'draft', 'final', 'qa', 'review', 'review-poll', 'review-ack']) {
    assert.ok(module.STEPS.includes(step), `STEPS must include ${step}`)
  }
  // Config({}) resolves every field, which is what validate-bundles.mjs runs.
  const resolved = module.Config({})
  assert.equal(resolved.setupScriptTimeoutMs, 120_000)
  assert.equal(resolved.renderTimeoutMs, 3_600_000)
  assert.equal(resolved.reviewPort, 8791)
})
