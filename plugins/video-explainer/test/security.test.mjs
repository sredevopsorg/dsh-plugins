import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * These tests pin the security review recorded in docs/UPSTREAM.md. They fail if
 * an adaptation is reverted, so a future upstream sync cannot quietly bring back
 * an auto-installer, a shell call, or a project-wide review server.
 */

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const scriptsDir = join(packageRoot, 'skills', 'video-explainer', 'scripts')

async function scripts() {
  const entries = await readdir(scriptsDir, { withFileTypes: true })
  const names = entries.filter(entry => entry.isFile()).map(entry => entry.name).sort()
  const bodies = new Map()
  for (const name of names) bodies.set(name, await readFile(join(scriptsDir, name), 'utf8'))
  return bodies
}

const all = await scripts()

test('packaged scripts never invoke a shell, eval, or unpickling', () => {
  // Every subprocess call takes an argument list. `shell=True` would let a URL,
  // a caption, or a project path reach a shell; nothing in this pipeline needs it.
  const forbidden = [
    [/shell\s*=\s*True/, 'subprocess(shell=True)'],
    [/\bos\.system\s*\(/, 'os.system()'],
    [/\bos\.popen\s*\(/, 'os.popen()'],
    [/\bpickle\.loads?\s*\(/, 'pickle.load()'],
    [/(?<![.\w])eval\s*\(/, 'eval()'],
    [/(?<![.\w])exec\s*\(/, 'exec()'],
    [/yaml\.load\s*\(/, 'yaml.load()'],
  ]
  for (const [name, body] of all) {
    for (const [pattern, label] of forbidden) {
      assert.doesNotMatch(body, pattern, `${name} must not use ${label}`)
    }
  }
})

test('scripts/py never creates a venv and never installs a package', () => {
  const py = all.get('py')
  assert.ok(py, 'scripts/py must ship')
  for (const installer of [
    /\buv\s+pip\s+install\b/,
    /\bpip\s+install\b/,
    /\bpython3?\s+-m\s+venv\b/,
    /\buv\s+venv\b/,
  ]) {
    // The command may only appear inside an error message, never as an executed line.
    for (const line of py.split('\n')) {
      const code = line.replace(/^\s*#.*$/, '')
      if (installer.test(code)) {
        assert.match(
          code,
          /^\s*echo\s/,
          `scripts/py must only print an install command, found: ${line.trim()}`,
        )
      }
    }
  }
  assert.match(py, /exit 1/, 'scripts/py must fail loudly instead of installing')
  assert.match(py, /exec "\$V\/bin\/python"/, 'scripts/py still runs the script in the venv')
})

test('setup.sh is a read-only preflight', () => {
  const setup = all.get('setup.sh')
  assert.ok(setup, 'scripts/setup.sh must ship')
  const executed = setup
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n')
  // Nothing may execute these; they may only appear as items of the arrays the
  // preflight later prints.
  const installers = ['browser ensure', 'models install', 'pip install', 'uv pip', 'curl -fsSL https://cdn.jsdelivr']
  for (const installer of installers) {
    for (const line of executed.split('\n').filter(entry => entry.includes(installer))) {
      assert.ok(
        /^\s*(?:missing|optional|bootstrap)\+?=/.test(line),
        `setup.sh must print, not execute, "${installer}": ${line.trim()}`,
      )
    }
  }
  assert.match(executed, /bootstrap\+=/, 'setup.sh reports the one-time downloads instead of running them')
  assert.match(executed, /--json/, 'setup.sh must support the machine-readable report')
  assert.match(executed, /"installed":false/, 'the report must state that nothing was installed')
})

test('the review server is loopback-only, host-pinned, and scoped to its own root', () => {
  const page = all.get('review_page.py')
  assert.ok(page, 'scripts/review_page.py must ship')
  // Bound to loopback.
  assert.match(page, /ThreadingHTTPServer\(\("127\.0\.0\.1", port\)/)
  // Host allow-list, applied to reads as well as writes (closes DNS rebinding).
  assert.match(page, /def _host_allowed\(/)
  assert.match(page, /def host_ok\(/)
  const getBody = page.slice(page.indexOf('def do_GET(self):'))
  assert.match(getBody.slice(0, 200), /host_ok/, 'do_GET must check the Host header')
  const postBody = page.slice(page.indexOf('def do_POST(self):'))
  assert.match(postBody.slice(0, 200), /host_ok/, 'do_POST must check the Host header')
  // The served root is the dedicated copy, not the project directory.
  assert.match(page, /def publish_serve_root\(/)
  assert.match(page, /super\(\).__init__\(\*a, directory=serve_root, \*\*k\)/)
  assert.doesNotMatch(page, /directory=root, \*\*k/)
})

test('the Wikimedia hostname check rejects lookalike domains', async () => {
  // Matching the whole netloc would accept `en.wikipedia.org.evil.example` or
  // `wikipedia.org.attacker.tld` and send the request (and its User-Agent) there.
  // CodeQL reported this as py/incomplete-url-substring-sanitization.
  const media = all.get('media.py')
  assert.match(media, /urllib\.parse\.urlsplit\(url\)\.hostname/)
  assert.doesNotMatch(media, /netloc\.lower\(\)\s*\n?\s*return host\.endswith/)
  assert.match(media, /WIKI_HOSTS/)
})

test('review frames stay inside their own directory', async () => {
  // The frame path is built from the reviewer's timestamp; it must never carry
  // reviewer text and must be re-checked against the frames root
  // (py/path-injection).
  const page = all.get('review_page.py')
  const body = page.slice(page.indexOf('def save_frames('), page.indexOf('def notes_markdown('))
  assert.match(body, /os\.path\.realpath\(out_dir\)/, 'save_frames must canonicalize its output directory')
  assert.match(body, /os\.path\.dirname\(path\) != root/, 'save_frames must confine each path to that directory')
  assert.doesNotMatch(body, /c\['note'\]|c\["note"\]/, 'the frame name must not include reviewer text')
})

test('media.py keeps attribution out of the console line', () => {
  // CodeQL's py/clear-text-logging-sensitive-data flags any printed value that
  // derives from a source it models as sensitive, and a sanitizer does not
  // break that path (verified by running the query against this tree). The
  // credit is therefore written to the project manifest and the console line
  // only points at it, which keeps third-party attribution from being echoed.
  const media = all.get('media.py')
  assert.match(media, /def _name_for_display\(/)
  assert.match(media, /def _safe_credit\(/)
  assert.doesNotMatch(media, /lgtm\[/, 'no blanket suppression comments')
  assert.doesNotMatch(media, /print\(f"Saved (?:image|clip) \{out\}/, 'never print the raw path')
  const printed = media.split('\n').filter(entry => /print\(f"Saved/.test(entry))
  assert.equal(printed.length, 2, 'both save messages are checked')
  for (const line of printed) {
    assert.match(line, /_name_for_display\(out\)/, `print a sanitized path: ${line.trim()}`)
    assert.doesNotMatch(line, /credit_note/, `do not echo the credit: ${line.trim()}`)
  }
  // Attribution must still reach the manifest that the skill reads.
  assert.match(media, /record_media_source\(out, \{\n\s+"kind": "image",[\s\S]*?"credit": credit/)
  assert.match(media, /credit recorded in/)
})

test('the shell capture reports its pinned npx fallback instead of hiding it', () => {
  const capture = all.get('capture.py')
  assert.ok(capture, 'scripts/capture.py must ship')
  assert.match(capture, /using `npx -y hyperframes@0\.9\.79`/)
})

test('one pinned HyperFrames version everywhere', () => {
  const common = all.get('common.py')
  const pin = /HF_VERSION = "(\d+\.\d+\.\d+)"/.exec(common)
  assert.ok(pin, 'common.py must pin HF_VERSION')
  assert.equal(pin[1], '0.9.79')
  for (const [name, body] of all) {
    for (const match of body.matchAll(/hyperframes@(\d+\.\d+\.\d+)/g)) {
      assert.equal(match[1], pin[1], `${name} must use the pinned HyperFrames version`)
    }
  }
})

test('the new pipeline wrapper validates the project before running anything', () => {
  const runner = all.get('dsh_run.py')
  assert.ok(runner, 'scripts/dsh_run.py must ship')
  assert.match(runner, /--project/)
  assert.match(runner, /script\.md/, 'a project step needs a script.md')
  assert.doesNotMatch(runner, /shell\s*=\s*True/)
})

test('the requirements files pin every dependency', async () => {
  for (const file of ['requirements.txt', 'requirements-voice.txt']) {
    const body = await readFile(join(packageRoot, 'skills', 'video-explainer', file), 'utf8')
    const pins = body
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '' && !line.startsWith('#'))
    assert.ok(pins.length > 0, `${file} must pin at least one package`)
    for (const pin of pins) {
      assert.match(pin, /^[a-z0-9][a-z0-9._-]*==\d+\.\d+/, `${file} must pin an exact version: ${pin}`)
    }
  }
})
