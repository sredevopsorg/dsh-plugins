/**
 * docker.js — the Docker CLI adapter.
 *
 * The only module in this plugin that executes anything. Every call is
 * `execFile('docker', argv)` with an explicit argument vector: no shell, no
 * string interpolation, no `eval`. That removes the argument-injection class
 * entirely rather than trying to escape around it.
 *
 * The adapter knows Docker's argv and its error strings; it does not know what
 * a workspace is or when it should die. Policy lives in index.js, so this file
 * stays swappable (a remote daemon or a different runtime would be another
 * implementation of the same six verbs).
 *
 * Deliberately dependency-free: `node:` imports only.
 */

import { execFile } from 'node:child_process';

/** Label namespace that makes this plugin's containers findable and attributable. */
export const LABEL_PLUGIN = 'dsh.plugin';
export const LABEL_PLUGIN_VALUE = 'flaresolverr';
export const LABEL_WORKSPACE = 'dsh.workspace';
export const LABEL_OWNER = 'dsh.owner';
export const LABEL_NETWORK = 'dsh.network';

/** The API port inside the container. FlareSolverr's own `PORT` default. */
export const CONTAINER_PORT = 8191;

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMED_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * One failed Docker invocation, classified into something the model can act on.
 *
 * The classification exists because "docker exited 125" is useless to an agent
 * while "the Docker daemon is not running" names the next step. Codes are a
 * closed set so callers switch exhaustively instead of string-matching.
 *
 * @typedef {'docker-missing'|'daemon-unreachable'|'permission-denied'|'not-found'|'timeout'|'conflict'|'failed'} DockerErrorCode
 */

/** Docker CLI error taxonomy, with the message shown to the model per code. */
const CODES = Object.freeze({
  'docker-missing': 'Docker CLI not found on PATH',
  'daemon-unreachable': 'the Docker daemon is not reachable',
  'permission-denied': 'permission denied talking to the Docker daemon',
  'not-found': 'the named container or image does not exist',
  timeout: 'the Docker command exceeded its deadline',
  conflict: 'a container with that name already exists',
  failed: 'the Docker command failed'
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error) {
  if (error instanceof Error && typeof error.message === 'string') return error.message;
  return String(error);
}

/**
 * Classify a failed `docker` invocation.
 *
 * Matching on stderr is unavoidable here: the CLI reports distinct conditions
 * with distinct exit codes only sometimes, and the daemon's own wording is the
 * most reliable signal available. The order matters — a missing binary and a
 * refused socket produce overlapping text.
 *
 * @param error - the rejection from `execFile`.
 * @param stderr - captured stderr.
 * @returns the closed-set code.
 */
export function classifyError(error, stderr) {
  if (isRecord(error) && error.code === 'ENOENT') return 'docker-missing';
  const text = `${stderr}\n${errorMessage(error)}`.toLowerCase();

  if (text.includes('command not found') || text.includes('no such file or directory')) {
    return 'docker-missing';
  }
  if (
    text.includes('permission denied') ||
    text.includes('got permission denied') ||
    text.includes('is the docker daemon running')
  ) {
    return text.includes('permission denied') ? 'permission-denied' : 'daemon-unreachable';
  }
  if (
    text.includes('cannot connect to the docker daemon') ||
    text.includes('dial unix') ||
    text.includes('connection refused') ||
    text.includes('error during connect')
  ) {
    return 'daemon-unreachable';
  }
  // Docker words this both ways — `No such container: x` and `network x not
  // found` — so both orders are matched rather than one being assumed.
  if (
    text.includes('no such container') ||
    text.includes('no such image') ||
    text.includes('no such network') ||
    text.includes('no such object') ||
    text.includes('no such volume') ||
    /\b(?:container|network|image|volume|object)\b[^\n]*\bnot found\b/.test(text)
  ) {
    return 'not-found';
  }
  if (text.includes('is already in use by container') || text.includes('already exists')) return 'conflict';
  if (isRecord(error) && error.killed === true) return 'timeout';
  return 'failed';
}

/**
 * Actionable remediation per code — the part of an error an agent can act on.
 * @param code - a code from {@link classifyError}.
 * @returns one imperative sentence, or an empty string when nothing helps.
 */
export function remediationFor(code) {
  switch (code) {
    case 'docker-missing':
      return 'Install Docker (https://docs.docker.com/engine/install/) and confirm `docker version` works, then retry.';
    case 'daemon-unreachable':
      return 'Start the Docker daemon (`sudo systemctl start docker`) and confirm `docker info` succeeds, then retry.';
    case 'permission-denied':
      return 'The current user cannot access the Docker socket. Add them to the `docker` group (`sudo usermod -aG docker "$USER"`) and start a new login session, then retry.';
    case 'not-found':
      return 'The container may already have been removed; call action=status to see the current workspace state.';
    case 'timeout':
      return 'The operation may still be running. Call action=status before retrying so you do not start a second container.';
    case 'conflict':
      return 'Call action=stop, then action=start, to replace the conflicting container.';
    case 'failed':
      return '';
    default:
      return '';
  }
}

/** Raised for a Docker invocation the caller must handle; carries the classified code. */
export class DockerError extends Error {
  /**
   * @param code - classified failure code.
   * @param detail - the daemon's own message, unmodified.
   * @param options - optional cause and hint.
   */
  constructor(code, detail, options = {}) {
    const label = CODES[code] ?? CODES.failed;
    super(`${label}: ${detail}`);
    this.name = 'DockerError';
    this.code = code;
    this.detail = detail;
    this.hint = options.hint ?? remediationFor(code);
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * Run one `docker` invocation and return its stdout.
 *
 * Never rejects with a raw child-process error: callers get a {@link DockerError}
 * carrying a classified code, the daemon's message, and a remediation hint, so
 * the tool layer never has to interpret stderr.
 *
 * @param argv - arguments after `docker`; passed through verbatim.
 * @param options - `signal` to cancel, `timeoutMs` to bound.
 * @returns trimmed stdout.
 * @throws {DockerError} for any non-zero exit, spawn failure, or timeout.
 */
export async function docker(argv, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    execFile(
      'docker',
      argv,
      {
        signal: options.signal,
        timeout: timeoutMs,
        maxBuffer: MAX_TIMED_OUTPUT_BYTES,
        encoding: 'utf8',
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error !== null && error !== undefined) {
          const code = classifyError(error, typeof stderr === 'string' ? stderr : '');
          const detail = (typeof stderr === 'string' ? stderr : '').trim() || errorMessage(error);
          reject(new DockerError(code, detail, { cause: error }));
          return;
        }
        resolve(typeof stdout === 'string' ? stdout.trim() : '');
      }
    );
  });
}

/** Docker CLI availability, for a precondition check that names the real problem. */
export async function dockerVersion(signal) {
  const out = await docker(['version', '--format', '{{.Server.Version}}'], { signal, timeoutMs: 20_000 });
  return out;
}

/**
 * Create a dedicated bridge network for one workspace.
 * @param name - network name.
 * @param labels - extra `--label` entries.
 * @param signal - cancellation.
 * @returns the network name.
 */
export async function createNetwork(name, labels, signal) {
  const argv = ['network', 'create'];
  for (const [key, value] of Object.entries(labels)) argv.push('--label', `${key}=${value}`);
  argv.push(name);
  await docker(argv, { signal });
  return name;
}

/** Remove a network; already-absent is success, because teardown must be idempotent. */
export async function removeNetwork(name, signal) {
  try {
    await docker(['network', 'rm', name], { signal, timeoutMs: 30_000 });
  } catch (error) {
    if (error instanceof DockerError && error.code === 'not-found') return;
    // A network still holding a container cannot be removed; the container
    // removal is retried first by the caller, so a residual failure here is
    // reported rather than hidden.
    if (error instanceof DockerError && /has active endpoints|in use/i.test(error.detail)) return;
    throw error;
  }
}

/**
 * Start one detached container.
 *
 * Port publishing uses `127.0.0.1::8191` — an ephemeral host port assigned by
 * the kernel and bound to the loopback interface only. That is both the
 * collision-free answer and the non-exposed answer, and it is why a caller
 * never supplies a host port.
 *
 * @param spec - container name, image, network, env, resource caps, labels.
 * @param signal - cancellation.
 * @returns the container id.
 */
export async function runContainer(spec, signal) {
  const argv = ['run', '-d', '--name', spec.name];

  for (const [key, value] of Object.entries(spec.labels)) argv.push('--label', `${key}=${value}`);

  argv.push('--network', spec.network);
  argv.push('-p', `127.0.0.1::${spec.containerPort}`);

  // Headless Chromium deadlocks on the default 64 MB /dev/shm. This is the
  // single most common cause of a FlareSolverr container that starts and
  // then never answers.
  argv.push('--shm-size', spec.shmSize);
  argv.push('--security-opt', 'no-new-privileges');
  if (spec.memory !== undefined) argv.push('--memory', spec.memory);
  if (spec.cpus !== undefined) argv.push('--cpus', spec.cpus);
  argv.push('--restart', 'no');

  for (const [key, value] of Object.entries(spec.env)) argv.push('-e', `${key}=${value}`);

  argv.push(spec.image);

  return docker(argv, { signal, timeoutMs: spec.pullTimeoutMs });
}

/**
 * Read one container's state, or `undefined` when it does not exist.
 * @param name - container name.
 * @param signal - cancellation.
 * @returns the parsed `docker inspect` state plus the resolved image digest.
 */
export async function inspectContainer(name, signal) {
  let raw;
  try {
    raw = await docker(['inspect', name], { signal, timeoutMs: 30_000 });
  } catch (error) {
    if (error instanceof DockerError && error.code === 'not-found') return undefined;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const entry = Array.isArray(parsed) ? parsed[0] : undefined;
  if (!isRecord(entry)) return undefined;

  const state = isRecord(entry.State) ? entry.State : {};
  const network = isRecord(entry.NetworkSettings) ? entry.NetworkSettings : {};
  const ports = isRecord(network.Ports) ? network.Ports : {};
  const binding = ports[`${CONTAINER_PORT}/tcp`];
  const firstBinding = Array.isArray(binding) && isRecord(binding[0]) ? binding[0] : undefined;

  const config = isRecord(entry.Config) ? entry.Config : {};
  const containerLabels = isRecord(config.Labels) ? config.Labels : {};

  return {
    id: typeof entry.Id === 'string' ? entry.Id.slice(0, 12) : undefined,
    name: typeof entry.Name === 'string' ? entry.Name.replace(/^\//, '') : name,
    status: typeof state.Status === 'string' ? state.Status : 'unknown',
    running: state.Running === true,
    exitCode: typeof state.ExitCode === 'number' ? state.ExitCode : undefined,
    startedAt: typeof state.StartedAt === 'string' ? state.StartedAt : undefined,
    finishedAt: typeof state.FinishedAt === 'string' ? state.FinishedAt : undefined,
    health: isRecord(state.Health) && typeof state.Health.Status === 'string' ? state.Health.Status : undefined,
    hostIp: firstBinding !== undefined && typeof firstBinding.HostIp === 'string' ? firstBinding.HostIp : undefined,
    hostPort: firstBinding !== undefined && typeof firstBinding.HostPort === 'string' ? firstBinding.HostPort : undefined,
    image: typeof config.Image === 'string' ? config.Image : undefined,
    labels: containerLabels
  };
}

/** Tail a container's logs — where Chromium and sandbox startup errors actually appear. */
export async function containerLogs(name, tail = 40, signal) {
  try {
    return await docker(['logs', '--tail', String(tail), name], { signal, timeoutMs: 30_000 });
  } catch (error) {
    if (error instanceof DockerError) return `(logs unavailable: ${error.message})`;
    throw error;
  }
}

/** Stop a container, then remove it. Idempotent: already-gone is success. */
export async function removeContainer(name, graceSeconds, signal) {
  try {
    await docker(['stop', '--time', String(graceSeconds), name], {
      signal,
      timeoutMs: (graceSeconds + 30) * 1000
    });
  } catch (error) {
    if (!(error instanceof DockerError) || error.code !== 'not-found') {
      // A container that is already stopped exits 0; anything else here is
      // reported, but removal below still gets its chance.
      if (!(error instanceof DockerError) || !/is not running/i.test(error.detail)) throw error;
    }
  }
  try {
    await docker(['rm', '--force', name], { signal, timeoutMs: 60_000 });
  } catch (error) {
    if (error instanceof DockerError && error.code === 'not-found') return;
    throw error;
  }
}

/**
 * List containers carrying this plugin's label, running or not.
 *
 * Labels — not a local registry file — are the source of truth, so a plugin
 * reload or a crashed harness process cannot orphan a container invisibly.
 *
 * @param signal - cancellation.
 * @returns one entry per container: name, state, labels.
 */
export async function listContainers(signal) {
  const raw = await docker(
    ['ps', '-a', '--filter', `label=${LABEL_PLUGIN}=${LABEL_PLUGIN_VALUE}`, '--format', '{{json .}}'],
    { signal, timeoutMs: 30_000 }
  );
  if (raw === '') return [];

  const entries = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // A malformed row must not hide the healthy ones.
    }
  }

  const names = entries.map((entry) => (isRecord(entry) ? entry.Names : undefined)).filter((n) => typeof n === 'string');
  if (names.length === 0) return [];

  let details = [];
  try {
    const inspected = await docker(['inspect', ...names], { signal, timeoutMs: 60_000 });
    const parsed = JSON.parse(inspected);
    if (Array.isArray(parsed)) details = parsed.filter(isRecord);
  } catch {
    // Fall back to the summary rows when the detailed inspect fails.
  }

  const byName = new Map();
  for (const detail of details) {
    const name = typeof detail.Name === 'string' ? detail.Name.replace(/^\//, '') : '';
    if (name !== '') byName.set(name, detail);
  }

  return entries
    .filter(isRecord)
    .map((entry) => {
      const name = typeof entry.Names === 'string' ? entry.Names.split(',')[0].trim() : '';
      const detail = byName.get(name);
      const state = isRecord(detail?.State) ? detail.State : {};
      const labels = isRecord(detail?.Config?.Labels) ? detail.Config.Labels : {};
      return {
        name,
        status: typeof entry.Status === 'string' ? entry.Status : 'unknown',
        running: typeof state.Running === 'boolean' ? state.Running : String(entry.State) === 'running',
        labelWorkspace: typeof labels[LABEL_WORKSPACE] === 'string' ? labels[LABEL_WORKSPACE] : undefined,
        labelOwner: typeof labels[LABEL_OWNER] === 'string' ? labels[LABEL_OWNER] : undefined,
        labelNetwork: typeof labels[LABEL_NETWORK] === 'string' ? labels[LABEL_NETWORK] : undefined
      };
    });
}

/**
 * Resolve the loopback host port published for a container's API port.
 * @param name - container name.
 * @param containerPort - the container-side port.
 * @param signal - cancellation.
 * @returns `host:port` on the loopback interface, or undefined when unpublished.
 */
export async function publishedEndpoint(name, containerPort, signal) {
  let raw;
  try {
    raw = await docker(['port', name, `${containerPort}/tcp`], { signal, timeoutMs: 30_000 });
  } catch (error) {
    if (error instanceof DockerError && (error.code === 'not-found' || error.code === 'failed')) return undefined;
    throw error;
  }
  // One line per binding, e.g. `127.0.0.1:32768`.
  const first = raw.split('\n').map((line) => line.trim()).find((line) => line !== '');
  return first === undefined ? undefined : first;
}
