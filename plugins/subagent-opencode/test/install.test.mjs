/**
 * Installer tests: platform naming, executables, argument construction, and
 * the fixed failure messages.
 *
 * Every install runs through a fake `spawn`: nothing here needs network, a
 * package manager, a real OpenCode download, or root.
 */

import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  assertInstallPolicy,
  defaultInstallDir,
  installArgv,
  installOpenCode,
  installedExecutable,
  installedVersion,
  isExecutable,
  knownInstall,
  platformPackage,
  usesMusl,
  withExecutableOnPath,
} from '../install.js'

/** The host's `PATH` separator, so the test asserts entries rather than a joined string. */
const PATH_DELIMITER = process.platform === 'win32' ? ';' : ':'

/** A temporary install directory removed when the test ends. */
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-opencode-install-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Write an executable file at `path` with `contents`. */
function writeExecutable(path, contents = '#!/bin/sh\nexit 0\n') {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents, { mode: 0o755 })
}

/** Write a package manifest inside an install directory. */
function writeManifest(dir, name, version = '2.3.0') {
  const packageDir = join(dir, 'node_modules', ...name.split('/'))
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name, version }))
}

/** A spawn that reports success and plants the executable the install promises. */
function plantingSpawn(dir, platform, calls = []) {
  return (command, args, options) => {
    calls.push({ command, args, options })
    writeExecutable(join(dir, 'node_modules', ...platform.split('/'), 'bin', 'opencode'))
    return { status: 0, signal: null }
  }
}

test('the platform package names the host triple, and musl only for linux', () => {
  assert.equal(platformPackage('linux', 'x64'), '@opencode/cli-linux-x64')
  assert.equal(platformPackage('linux', 'arm64'), '@opencode/cli-linux-arm64')
  assert.equal(platformPackage('darwin', 'arm64'), '@opencode/cli-darwin-arm64')
  assert.equal(platformPackage('win32', 'x64'), '@opencode/cli-windows-x64')
  assert.equal(platformPackage('linux', 'x64', true), '@opencode/cli-linux-x64-musl')
  assert.equal(platformPackage('darwin', 'x64', true), '@opencode/cli-darwin-x64')
})

test('a host OpenCode does not build for has no platform package', () => {
  assert.equal(platformPackage('linux', 'arm'), undefined)
  assert.equal(platformPackage('freebsd', 'x64'), undefined)
})

test('a musl host is recognized by its loader, never by glibc symbols', () => {
  assert.equal(usesMusl({ header: { glibcVersionRuntime: '2.41' }, sharedObjects: [] }), false)
  assert.equal(usesMusl({ header: {}, sharedObjects: ['/lib/ld-musl-x86_64.so.1'] }), true)
  assert.equal(usesMusl({ header: {}, sharedObjects: ['/usr/lib/libc.so.6'] }), false)
  assert.equal(usesMusl(undefined), false)
  assert.equal(usesMusl({ get sharedObjects() { throw new Error('no report') } }), false)
})

test('only an executable regular file counts as installed', (t) => {
  const dir = tempDir(t)
  const file = join(dir, 'opencode')
  writeFileSync(file, 'not executable', { mode: 0o644 })
  // Windows decides executability by extension, not by a permission bit.
  assert.equal(isExecutable(file), process.platform === 'win32')
  // Rewriting an existing file keeps its mode, so set it explicitly.
  chmodSync(file, 0o755)
  assert.equal(isExecutable(file), true)
  assert.equal(isExecutable(dir), false, 'a directory is not the command')
  assert.equal(isExecutable(join(dir, 'absent')), false)
  assert.equal(isExecutable(undefined), false)
})

test('an install is found inside the platform package, not the launcher', (t) => {
  const dir = tempDir(t)
  const platform = '@opencode/cli-linux-x64'
  assert.equal(knownInstall(dir), undefined, 'an empty directory holds no install')
  writeExecutable(join(dir, 'node_modules', ...platform.split('/'), 'bin', 'opencode'))
  assert.equal(knownInstall(dir, platform), join(dir, 'node_modules', ...platform.split('/'), 'bin', 'opencode'))
  assert.equal(installedExecutable(dir, platform), knownInstall(dir, platform))
})

test('a launcher stub is never mistaken for the executable', (t) => {
  const dir = tempDir(t)
  // A real launcher install before its postinstall: the stub exists and only
  // prints that the script did not run, so it must not count as OpenCode.
  writeManifest(dir, '@opencode/cli')
  writeExecutable(
    join(dir, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe'),
    '#!/bin/sh\necho "postinstall script was not run" >&2\nexit 1\n',
  )
  assert.equal(knownInstall(dir), undefined, 'only the platform package provides the executable')
  assert.equal(installedVersion(dir), '2.3.0', 'the version is still readable for diagnostics')
  assert.equal(installedVersion(dir, '@opencode/cli-linux-x64'), undefined)
})

test('pnpm installs into the directory and denies the launcher its scripts', () => {
  const argv = installArgv('pnpm', '@opencode/cli-linux-x64', ['--reporter=silent'], '/home/u/opencode')
  assert.deepEqual(argv, [
    'pnpm',
    '--reporter=silent',
    '--dir',
    '/home/u/opencode',
    '@opencode/cli=-',
    '@opencode/cli-core=-',
    '@opencode/cli-linux-x64',
  ])
})

test('npm runs the bundled CLI under the permission model, never the PATH npm', () => {
  const argv = installArgv('npm', '@opencode/cli-darwin-arm64', [], '/home/u/opencode')
  assert.equal(argv[0], process.execPath)
  assert.deepEqual(argv.slice(1, 4), ['--permission', '--allow-fs-write=/home/u/opencode', '--allow-fs-read=*'])
  assert.match(argv[4], /npm-cli\.js$/, 'the manager is the npm CLI, not a shell lookup')
  // npm has no `name=-` deny syntax: it reads that as a path. Its
  // --ignore-scripts skips every script, so only the platform package is named.
  assert.deepEqual(argv.slice(5), [
    'install',
    '--prefix',
    '/home/u/opencode',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '@opencode/cli-darwin-arm64',
  ])
})

test('an install returns the executable it planted', (t) => {
  const dir = tempDir(t)
  const calls = []
  const platform = '@opencode/cli-linux-x64'
  const executable = installOpenCode({
    manager: 'pnpm',
    platform,
    args: [],
    dir,
    timeoutMs: 5_000,
    spawn: plantingSpawn(dir, platform, calls),
  })
  assert.equal(executable, join(dir, 'node_modules', ...platform.split('/'), 'bin', 'opencode'))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.cwd, dir, 'the manager runs inside the install directory')
  assert.equal(calls[0].options.timeout, 5_000)
})

test('a failed install reports the manager and exit code, never its output', (t) => {
  const dir = tempDir(t)
  assert.throws(
    () => installOpenCode({
      manager: 'pnpm',
      platform: '@opencode/cli-linux-x64',
      args: [],
      dir,
      timeoutMs: 1_000,
      spawn: () => ({
        status: 1,
        signal: null,
        stdout: 'proxy https://user:hunter2@proxy.internal',
        stderr: 'ERR_PNPM_FETCH_403 ...token=abc123',
      }),
    }),
    (error) => {
      assert.match(error.message, /pnpm failed in .* with exit code 1/)
      assert.doesNotMatch(error.message, /hunter2|abc123/, 'child output never reaches a message')
      return true
    },
  )
})

test('a manager that could not start names the reason and the global fallback', () => {
  assert.throws(
    () => installOpenCode({
      manager: 'pnpm',
      platform: '@opencode/cli-linux-x64',
      args: [],
      dir: join(tmpdir(), 'dsh-opencode-missing-manager'),
      timeoutMs: 1_000,
      spawn: () => ({ status: null, signal: null, error: Object.assign(new Error('spawn pnpm ENOENT'), { code: 'ENOENT' }) }),
    }),
    (error) => {
      assert.match(error.message, /pnpm could not run/)
      assert.match(error.message, /ENOENT/)
      assert.match(error.message, /pnpm add -g --allow-build=@opencode\/cli/)
      return true
    },
  )
})

test('a timed-out install reports its signal', (t) => {
  const dir = tempDir(t)
  assert.throws(
    () => installOpenCode({
      manager: 'npm',
      platform: '@opencode/cli-linux-x64',
      args: [],
      dir,
      timeoutMs: 10,
      spawn: () => ({ status: null, signal: 'SIGTERM' }),
    }),
    /npm failed in .* with signal SIGTERM/,
  )
})

test('a manager that claims success without an executable is reported', (t) => {
  const dir = tempDir(t)
  assert.throws(
    () => installOpenCode({
      manager: 'pnpm',
      platform: '@opencode/cli-linux-x64',
      args: [],
      dir,
      timeoutMs: 1_000,
      spawn: () => ({ status: 0, signal: null }),
    }),
    /reported success but installed no executable for @opencode\/cli-linux-x64/,
  )
})

test('install is refused outright when the policy names none', () => {
  assert.throws(
    () => installOpenCode({ manager: 'none', platform: '@opencode/cli-linux-x64', args: [], dir: tmpdir(), timeoutMs: 1_000 }),
    /explicit install is disabled/,
  )
})

test('a host without a binary fails before any manager runs', (t) => {
  const calls = []
  assert.throws(
    () => installOpenCode({
      manager: 'pnpm',
      platform: undefined,
      args: [],
      dir: tempDir(t),
      timeoutMs: 1_000,
      spawn: (...args) => { calls.push(args); return { status: 0 } },
    }),
    /publishes no binary for/,
  )
  assert.equal(calls.length, 0)
})

test('an install directory that cannot be created is reported plainly', (t) => {
  const file = join(tempDir(t), 'not-a-dir')
  writeFileSync(file, '')
  assert.throws(
    () => installOpenCode({ manager: 'pnpm', platform: '@opencode/cli-linux-x64', args: [], dir: join(file, 'nested'), timeoutMs: 1_000 }),
    /cannot create the install directory .*: (?:ENOTDIR|EEXIST)/,
  )
})

test('the install policy rejects an unknown manager, a bad timeout, and no paths', () => {
  assert.doesNotThrow(() => assertInstallPolicy({ manager: 'pnpm', timeoutMs: 1_000 }))
  assert.doesNotThrow(() => assertInstallPolicy({ manager: 'none', timeoutMs: 1_000 }))
  assert.throws(() => assertInstallPolicy({ manager: 'yarn', timeoutMs: 1_000 }), /accepts pnpm, npm, none/)
  for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => assertInstallPolicy({ manager: 'pnpm', timeoutMs }), /must be a positive number/)
  }
})

test('the default install directory sits beside the profile', () => {
  assert.equal(defaultInstallDir(undefined, '/profiles/web'), '/profiles/web/opencode')
  assert.equal(defaultInstallDir('/opt/opencode', '/profiles/web'), '/opt/opencode')
})

test('an installed executable leads PATH exactly once', () => {
  const executable = join('/opt', 'opencode', 'node_modules', '@opencode', 'cli-linux-x64', 'bin', 'opencode')
  const directory = dirname(executable)
  const env = withExecutableOnPath({ PATH: ['/usr/bin', directory, '/bin'].join(PATH_DELIMITER) }, executable)
  const entries = env.PATH.split(PATH_DELIMITER)
  assert.equal(entries[0], directory, 'the executable directory leads')
  assert.deepEqual(entries.slice(1), ['/usr/bin', '/bin'], 'the rest keeps its order and no duplicate remains')
  assert.equal(withExecutableOnPath(env, executable), env, 'an environment that already leads is returned as is')
  assert.equal(withExecutableOnPath({}, executable).PATH, directory, 'an unset PATH gets the directory alone')
})
