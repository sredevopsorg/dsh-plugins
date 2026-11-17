/**
 * Install and locate the OpenCode CLI the provider delegates to.
 *
 * The npm launcher `@opencode/cli` ships only a stub `bin/opencode.exe`; its
 * `postinstall` links the real binary out of the matching platform package. That
 * makes a global install depend on a build script pnpm refuses by default, and
 * the postinstall re-downloads the binary with `npm` when the link fails.
 *
 * The platform package alone avoids both: it has no install scripts, and its
 * `bin` is the real executable. Installing it needs no build approval and no
 * network beyond the registry.
 *
 * Installation is opt-in and explicit: the provider installs only when
 * `requirements.install` is true and the configured command does not resolve.
 * No message here ever includes child output — it can carry proxy credentials —
 * and none includes a task.
 *
 * @module @sredevopsorg/dsh-subagent-opencode/install
 */

import { accessSync, constants, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const PREFIX = 'subagent-opencode'

/** The npm launcher users install globally. */
export const PACKAGE = '@opencode/cli'

/** The executable every install layout provides. */
const EXECUTABLE = 'opencode'

/**
 * Platforms OpenCode publishes a binary for, keyed by `process.platform`. Its
 * package names spell Windows in full, so a triple is never built from the raw
 * `process.platform` value alone.
 */
const PLATFORM_NAMES = Object.freeze({ darwin: 'darwin', linux: 'linux', win32: 'windows' })

/** Architectures OpenCode publishes a binary for. */
const ARCHITECTURES = Object.freeze(['arm64', 'x64'])

/**
 * The launcher packages that wrap a platform package. pnpm is told to deny them
 * their install scripts, so a profile's earlier `allowBuilds` approval cannot
 * make a delegation link or copy anything. npm is told to skip every script.
 */
const LAUNCHERS = Object.freeze([PACKAGE, '@opencode/cli-core'])

/** Package managers the installer drives, and whether it drives any at all. */
const MANAGERS = Object.freeze(['pnpm', 'npm', 'none'])

/** The npm arguments that make an install reproducible and silent about advisories. */
const NPM_ARGS = Object.freeze(['--ignore-scripts', '--no-audit', '--no-fund'])

/** The host's `PATH` separator. */
const PATH_DELIMITER = process.platform === 'win32' ? ';' : ':'

/**
 * The bin links a manager writes inside its own package directory. pnpm links
 * the real file, npm writes a `cmd-shim` script beside it.
 */
const LINKED = Object.freeze(['bin/opencode', 'bin/opencode.exe'])

/**
 * The package that holds the real binary for one platform and architecture.
 *
 * Linux x64 also publishes a musl build; asking for the wrong libc leaves a
 * binary whose loader is missing on the host.
 * @param {NodeJS.Platform | string} platform - `process.platform` value.
 * @param {string} arch - `process.arch` value.
 * @param {boolean} musl - whether the host uses the musl C library.
 * @returns {string | undefined} the platform package, or undefined when none is published.
 */
export function platformPackage(platform = process.platform, arch = process.arch, musl = false) {
  const name = PLATFORM_NAMES[platform]
  if (name === undefined || !ARCHITECTURES.includes(arch)) return undefined
  if (name === 'linux' && musl) return `${PACKAGE}-linux-${arch}-musl`
  return `${PACKAGE}-${name}-${arch}`
}

/**
 * Whether a Node diagnostic report describes a musl host.
 *
 * A report names the runtime libc directly: `glibcVersionRuntime` is set on
 * glibc and the loader appears in `sharedObjects` on musl. Reading it is a fact
 * about the running build rather than a guess from file names.
 * @param {object} [report] - `process.report.getReport()` output.
 * @returns {boolean} whether the host uses musl.
 */
export function usesMusl(report) {
  try {
    if (typeof report?.header?.glibcVersionRuntime === 'string') return false
    const shared = report?.sharedObjects
    return Array.isArray(shared) && shared.some(object => typeof object === 'string' && /(?:^|[/\\])ld-musl-/.test(object))
  } catch {
    return false
  }
}

/**
 * Detect the C library once, only for the platform that has two of them.
 * @returns {boolean} whether the host uses musl.
 */
export function detectMusl() {
  if (process.platform !== 'linux') return false
  try {
    return usesMusl(process.report?.getReport?.())
  } catch {
    return false
  }
}

/**
 * The platform package for this Node process.
 * @returns {string | undefined} the package, or undefined when OpenCode has none for this host.
 */
export function hostPlatformPackage() {
  return platformPackage(process.platform, process.arch, detectMusl())
}

/**
 * Whether a path names a file the current process may execute.
 * @param {string} path - candidate executable.
 * @returns {boolean} whether it is executable.
 */
export function isExecutable(path) {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Where an install puts one package's tree.
 * @param {string} dir - install directory.
 * @param {string} packageName - a package name such as `@opencode/cli-linux-x64`.
 * @returns {string} the package directory.
 */
export function packageDir(dir, packageName) {
  return join(dir, 'node_modules', ...packageName.split('/'))
}

/**
 * The executable an install provides.
 *
 * Only the platform package is consulted. The launcher's `bin` is a stub before
 * its postinstall runs and a copy afterwards, and this installer never runs that
 * postinstall, so the launcher is never read as the executable.
 * @param {string} dir - install directory.
 * @param {string | undefined} platform - the platform package.
 * @returns {string | undefined} the executable path, or undefined when no platform was identified.
 */
export function installedExecutable(dir, platform = hostPlatformPackage()) {
  if (platform === undefined) return undefined
  return join(packageDir(dir, platform), 'bin', EXECUTABLE)
}

/**
 * The executable a previous explicit install left behind, when it left one.
 * @param {string} dir - install directory.
 * @returns {string | undefined} the executable, or undefined when nothing was installed there.
 */
export function knownInstall(dir) {
  const executable = installedExecutable(dir)
  return executable !== undefined && isExecutable(executable) ? executable : undefined
}

/**
 * Read the version of a package installed in an install directory.
 * @param {string} dir - install directory.
 * @param {string} packageName - package to read.
 * @returns {string | undefined} the version, when the package is there.
 */
export function installedVersion(dir, packageName = PACKAGE) {
  try {
    const manifest = JSON.parse(readFileSync(join(packageDir(dir, packageName), 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

/**
 * The Node permission flags a package-manager run gets.
 *
 * A manager is a large program from the network, so it runs under Node's
 * permission model. It may write into the install directory — where it also
 * unpacks packages and where a newly created `package.json` anchors the tree —
 * the user's npm cache, and the system temporary directory it downloads
 * through. It may read everywhere, and it may not write anywhere else.
 * @param {string} dir - install directory.
 * @param {Record<string, string>} writable - additional directories the manager needs.
 * @returns {string[]} the flags.
 */
function permissionFlags(dir, { cache, temporary }) {
  const writes = [dir, cache, temporary].filter(path => path !== undefined && path !== '')
  return ['--permission', ...writes.map(path => `--allow-fs-write=${path}`), '--allow-fs-read=*']
}

/**
 * The directories one manager writes to besides its install directory.
 *
 * npm reports its cache, and the temporary directory is whatever `TMPDIR`
 * names, so neither is guessed here.
 * @param {string} manager - `pnpm` or `npm`.
 * @param {Record<string, string | undefined>} env - manager environment.
 * @returns {{cache: string, temporary: string}} the writable directories.
 */
function managerWrites(manager, env) {
  const temporary = env.TMPDIR ?? env.TMP ?? env.TEMP ?? (process.platform === 'win32' ? undefined : '/tmp')
  if (manager === 'npm') {
    const configured = env.npm_config_cache
    const cache = configured ?? (env.HOME === undefined ? undefined : join(env.HOME, '.npm'))
    return { cache, temporary }
  }
  return { cache: undefined, temporary }
}

/**
 * The npm CLI bundled with the running Node.
 *
 * `npm` on `PATH` would run as a child of the manager rather than as the
 * manager, escaping the permission flags; the bundled CLI does not.
 * @returns {string} absolute path to `npm-cli.js`.
 */
export function bundledNpmCli() {
  return join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
}

/**
 * The packages an install names.
 *
 * Both managers install the platform package. Only pnpm also takes the
 * launchers, so it can record `name=-` denials for them: npm reads that syntax
 * as a directory path, and its `--ignore-scripts` already covers every script.
 * @param {string} manager - `pnpm` or `npm`.
 * @param {string} platform - the platform package.
 * @returns {string[]} package arguments.
 */
export function installPackages(manager, platform) {
  if (manager !== 'pnpm') return [platform]
  return [...LAUNCHERS.map(launcher => `${launcher}=-`), platform]
}

/**
 * The command an install runs, executable first.
 * @param {string} manager - `pnpm` or `npm`.
 * @param {string} platform - the platform package.
 * @param {readonly string[]} args - extra arguments before the packages.
 * @param {string} dir - install directory.
 * @param {{cache?: string, temporary?: string}} [writable] - directories the manager also writes to.
 * @returns {string[]} argv.
 */
export function installArgv(manager, platform, args, dir, writable = {}) {
  const packages = installPackages(manager, platform)
  if (manager === 'pnpm') {
    return ['pnpm', ...args, '--dir', dir, ...packages]
  }
  return [process.execPath, ...permissionFlags(dir, writable), bundledNpmCli(), 'install', '--prefix', dir, ...NPM_ARGS, ...args, ...packages]
}

/**
 * The environment a package-manager run gets.
 *
 * npm exports its own CLI options to the processes it starts and then treats
 * those exports as CLI input, which it refuses in a project install. A DSH
 * launched by `npx` therefore carries settings that make every `npm install`
 * fail with `EALLOWSCRIPTS`. The run needs none of them: it names its manager
 * explicitly, and its directory comes from `--prefix` or `--dir`.
 * @param {Record<string, string | undefined>} env - environment to copy.
 * @returns {Record<string, string | undefined>} the copied environment, minus inherited npm CLI options.
 */
export function managerEnv(env) {
  const copied = {}
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue
    const lower = name.toLowerCase()
    if (lower === 'npm_config_argv' || lower === 'npm_package_json') continue
    if (lower.startsWith('npm_config_') && INHERITED_NPM_OPTIONS.has(lower.slice('npm_config_'.length).replaceAll('_', '-'))) continue
    copied[name] = value
  }
  return copied
}

/**
 * The npm CLI options that arrive with the environment rather than with the
 * command line, and that a project install refuses.
 */
const INHERITED_NPM_OPTIONS = new Set(['allow-scripts', 'allow-script'])

/**
 * Fail with one fixed message, so a child's output never reaches a Session.
 * @param {string} message - the fixed message.
 * @returns {never} never returns.
 */
function fail(message) {
  throw new Error(`${PREFIX}: ${message}`)
}

/**
 * Install OpenCode's platform package and return the executable it provides.
 *
 * The install runs in the install directory with no inherited session, so an
 * interrupted run cannot leave a manager hanging.
 * @param {object} options - install inputs.
 * @param {string} options.manager - `pnpm`, `npm`, or `none`.
 * @param {string | undefined} options.platform - the platform package.
 * @param {readonly string[]} options.args - extra manager arguments.
 * @param {string} options.dir - install directory.
 * @param {number} options.timeoutMs - bound on the whole install.
 * @param {Function} [options.spawn] - `spawnSync`-compatible runner, for tests.
 * @param {Record<string, string | undefined>} [options.env] - manager environment.
 * @returns {string} the installed executable.
 */
export function installOpenCode({ manager, platform, args, dir, timeoutMs, spawn = spawnSync, env = process.env }) {
  if (manager === 'none') {
    fail(`explicit install is disabled; install ${PACKAGE} yourself with \`pnpm add -g --allow-build=${PACKAGE} ${PACKAGE}\` and set \`command\` to its executable`)
  }
  if (platform === undefined) {
    fail(`OpenCode publishes no binary for ${process.platform}-${process.arch}`)
  }
  try {
    mkdirSync(dir, { recursive: true })
  } catch (error) {
    fail(`cannot create the install directory ${dir}: ${error.code ?? 'unknown error'}`)
  }
  const environment = managerEnv(env)
  const argv = installArgv(manager, platform, args, dir, managerWrites(manager, environment))
  const run = spawn(argv[0], argv.slice(1), {
    cwd: dir,
    env: environment,
    timeout: timeoutMs,
    stdio: 'ignore',
    windowsHide: true,
  })
  if (run.error !== undefined) {
    fail(`${manager} could not run in ${dir}: ${run.error.code ?? 'unknown error'}; install ${PACKAGE} yourself with \`pnpm add -g --allow-build=${PACKAGE} ${PACKAGE}\` and set \`command\``)
  }
  if (run.status !== 0) {
    fail(`${manager} failed in ${dir} with ${run.status === null ? `signal ${String(run.signal)}` : `exit code ${run.status}`}; fix network or registry settings, then retry`)
  }
  const executable = installedExecutable(dir, platform)
  if (executable === undefined || !isExecutable(executable)) {
    fail(`${manager} reported success but installed no executable for ${platform} in ${dir}`)
  }
  return executable
}

/**
 * Assert the install policy a profile configured.
 * @param {object} policy - resolved install configuration.
 */
export function assertInstallPolicy(policy) {
  if (!MANAGERS.includes(policy.manager)) {
    fail(`requirements.installManager accepts ${MANAGERS.join(', ')}; found ${JSON.stringify(policy.manager)}`)
  }
  if (!Number.isFinite(policy.timeoutMs) || policy.timeoutMs <= 0) {
    fail('requirements.installTimeoutMs must be a positive number')
  }
}

/**
 * The directory an explicit install uses when the profile names none.
 *
 * It lives beside the profile rather than inside it, so a profile reinstall
 * keeps the download, and inside the workspace the profile already owns rather
 * than in a home directory the installer would have to write to.
 * @param {string | undefined} configured - `requirements.installDir`.
 * @param {string} profileDir - the profile directory DSH runs from.
 * @returns {string} absolute install directory.
 */
export function defaultInstallDir(configured, profileDir) {
  return configured ?? join(profileDir, 'opencode')
}

/**
 * The child environment an installed executable runs in.
 *
 * The platform package ships its executable inside its own tree, which is not
 * on `PATH`. OpenCode's subcommands resolve helpers beside the executable, so
 * its directory goes first; one the profile already put on `PATH` keeps its
 * position, and an environment that already leads with it is returned as is.
 * @param {Record<string, string | undefined>} env - child environment.
 * @param {string} executable - resolved executable.
 * @returns {Record<string, string | undefined>} environment with the executable's directory first.
 */
export function withExecutableOnPath(env, executable) {
  const directory = dirname(executable)
  const current = env.PATH ?? ''
  const entries = current === '' ? [] : current.split(PATH_DELIMITER)
  if (entries[0] === directory) return env
  const rest = entries.filter(entry => entry !== directory && entry !== '')
  return { ...env, PATH: [directory, ...rest].join(PATH_DELIMITER) }
}

export { MANAGERS }
