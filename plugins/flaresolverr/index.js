/**
 * flaresolverr — a DSH Host plugin that gives the model a disposable
 * FlareSolverr workspace: a short-lived, loopback-only container it can start,
 * query, and tear down.
 *
 * The plugin registers one model-facing tool, `flaresolverr`, with four
 * actions — `start`, `status`, `request`, `stop`. Policy lives here: what a
 * workspace is, who owns it, and when it dies. The two adapters stay ignorant
 * of it — `docker.js` knows Docker's argv, `flare.js` knows the wire protocol.
 *
 * Lifecycle is expressed as a `ctx.jobs` registration owned by the calling
 * session, which is what makes "disposable" enforceable rather than
 * aspirational: killing the job or destroying the session stops and removes
 * the container and its network through the same teardown path.
 *
 * Deliberately dependency-free. A workspace-linked plugin cannot resolve bare
 * `@deepseek-ai/*` specifiers unless its manifest declares them as
 * peerDependencies, so this package imports only its own modules and `node:`
 * builtins, and registers a raw tool definition rather than using `defineTool`.
 * That keeps `dsh plugin add` free of both a toolchain and install-script
 * approval.
 */

import {
  CONTAINER_PORT,
  DockerError,
  LABEL_NETWORK,
  LABEL_OWNER,
  LABEL_PLUGIN,
  LABEL_PLUGIN_VALUE,
  LABEL_WORKSPACE,
  containerLogs,
  createNetwork,
  dockerVersion,
  inspectContainer,
  listContainers,
  publishedEndpoint,
  removeContainer,
  removeNetwork,
  runContainer
} from './docker.js';
import { FlareError, USER_AGENT_TRAP, health, index, run, summarize } from './flare.js';

/** The two services this plugin cannot work without. */
export const inject = ['tools', 'jobs'];

const TOOL_NAME = 'flaresolverr';
const ACTIONS = ['start', 'status', 'request', 'stop'];

const DEFAULTS = Object.freeze({
  image: 'ghcr.io/flaresolverr/flaresolverr:latest',
  defaultMaxTimeoutMs: 60_000,
  startupTimeoutMs: 60_000,
  healthIntervalMs: 1_000,
  pullTimeoutMs: 600_000,
  shmSize: '2g',
  memory: '1g',
  cpus: '2',
  requestTimeoutSlackMs: 15_000,
  maxOutputChars: 12_000,
  stopGraceSeconds: 10,
  logTailLines: 40,
  logLevel: 'info',
  promptSection: true
});

const MIN_STARTUP_TIMEOUT_MS = 5_000;
const MAX_STARTUP_TIMEOUT_MS = 1_800_000;
const MIN_HEALTH_INTERVAL_MS = 100;
const MAX_HEALTH_INTERVAL_MS = 30_000;
const MAX_OUTPUT_FLOOR = 1_000;
const MAX_OUTPUT_CEILING = 200_000;
const MAX_BODY_ON_OPT_IN = 400_000;

/** Docker's own size grammar: a number optionally followed by b/k/m/g (and the long spellings). */
const SIZE_PATTERN = /^\d+(?:\.\d+)?\s?(?:b|k|kb|m|mb|g|gb|t|tb)?$/i;
/** Docker's own CPU grammar: a positive decimal. */
const CPUS_PATTERN = /^\d+(?:\.\d+)?$/;
/** POSIX environment names — the injection boundary, since these become argv entries. */
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error) {
  if (error instanceof Error && typeof error.message === 'string') return error.message;
  return String(error);
}

/** A workspace name is derived from the owner, so it is sanitized rather than trusted. */
function sanitizeNamePart(value) {
  const cleaned = String(value ?? '').toLowerCase().replace(/[^a-z0-9_.-]/g, '-').replace(/^[-.]+/, '');
  return cleaned.slice(0, 40) === '' ? 'anon' : cleaned.slice(0, 40);
}

/**
 * Resolve the row config, ignoring malformed values instead of failing
 * activation. Every key is optional; a wrong-typed or out-of-range value falls
 * back to its default, which is the same posture `suggest-resources` takes and
 * the reason a typo in a profile patch cannot break boot.
 *
 * @param raw - the row's `config` object.
 * @returns a complete, frozen settings object.
 */
export function resolveConfig(raw) {
  const config = { ...DEFAULTS };
  if (!isRecord(raw)) return Object.freeze(config);

  const stringKeys = ['image', 'shmSize', 'memory', 'cpus', 'logLevel'];
  for (const key of stringKeys) {
    if (typeof raw[key] === 'string' && raw[key].trim() !== '') config[key] = raw[key].trim();
  }

  const boundedIntegers = {
    defaultMaxTimeoutMs: [1_000, 600_000],
    startupTimeoutMs: [MIN_STARTUP_TIMEOUT_MS, MAX_STARTUP_TIMEOUT_MS],
    healthIntervalMs: [MIN_HEALTH_INTERVAL_MS, MAX_HEALTH_INTERVAL_MS],
    pullTimeoutMs: [10_000, 3_600_000],
    requestTimeoutSlackMs: [1_000, 300_000],
    maxOutputChars: [MAX_OUTPUT_FLOOR, MAX_OUTPUT_CEILING],
    stopGraceSeconds: [1, 300],
    logTailLines: [1, 1_000]
  };
  for (const [key, [min, max]] of Object.entries(boundedIntegers)) {
    if (Number.isInteger(raw[key]) && raw[key] >= min && raw[key] <= max) config[key] = raw[key];
  }

  if (typeof raw.promptSection === 'boolean') config.promptSection = raw.promptSection;

  return Object.freeze(config);
}

/** Validate a caller-supplied resource value against Docker's own grammar. */
function validateDockerValue(kind, value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value.trim())) {
    throw new Error(
      `invalid ${kind}: expected Docker's own ${kind} grammar, got ${JSON.stringify(value)}`
    );
  }
  return value.trim();
}

/**
 * Validate the caller's `env` map.
 *
 * This is the injection boundary: these entries reach the container as
 * `-e KEY=VALUE` argv entries. Keys are constrained to POSIX environment
 * names; values are never shell-interpreted at any point, because every
 * command runs through `execFile` with an explicit argv.
 *
 * @param env - the caller's env map.
 * @returns a sanitized copy.
 */
function validateEnv(env) {
  if (env === undefined) return {};
  if (!isRecord(env)) throw new Error('invalid env: expected an object of name/value pairs');

  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new Error(`invalid env name ${JSON.stringify(key)}: expected a POSIX environment name`);
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(`invalid env value for ${key}: expected a string, number, or boolean`);
    }
    out[key] = String(value);
  }
  return out;
}

/** Bound a serialized result to the caller's configured budget, cutting from the middle. */
function boundOutput(value, maxChars, note) {
  const full = JSON.stringify(value);
  if (maxChars === undefined || full.length <= maxChars) return full;

  const omitted = `…[${note}; ${full.length - maxChars} characters omitted — retry with full=true or a narrower request]…`;
  const budget = Math.max(2, (maxChars - omitted.length) / 2);
  return `${full.slice(0, Math.floor(budget))}${omitted}${full.slice(-Math.ceil(budget))}`;
}

/**
 * The workspace registry for one process.
 *
 * State is per-owner and lives in memory only, because the durable source of
 * truth is the container's own labels — `status --all` reconstructs everything
 * from Docker, so a plugin reload loses nothing that matters.
 */
class WorkspaceRegistry {
  constructor(ctx, settings) {
    this.ctx = ctx;
    this.settings = settings;
    /** @type {Map<string, {containerName: string, networkName: string, endpoint: string, jobId?: string, image: string, startedAt: number}>} */
    this.byOwner = new Map();
    /** In-flight starts, so two concurrent `start` calls join one `docker run`. */
    this.pending = new Map();
  }

  static key(ownerId) {
    return typeof ownerId === 'string' && ownerId !== '' ? ownerId : 'unowned';
  }

  get(ownerId) {
    return this.byOwner.get(WorkspaceRegistry.key(ownerId));
  }

  set(ownerId, workspace) {
    this.byOwner.set(WorkspaceRegistry.key(ownerId), workspace);
  }

  delete(ownerId) {
    this.byOwner.delete(WorkspaceRegistry.key(ownerId));
  }

  /**
   * Start (or reuse) the caller's workspace.
   *
   * @param ownerId - the owning session id.
   * @param options - `image`, `env`, `memory`, `cpus` overrides.
   * @param signal - caller cancellation.
   * @param onProgress - narration callback for the startup poll.
   * @returns the live workspace record.
   */
  async start(ownerId, options, signal, onProgress) {
    const key = WorkspaceRegistry.key(ownerId);

    const existing = this.byOwner.get(key);
    if (existing !== undefined) {
      const state = await inspectContainer(existing.containerName, signal);
      if (state !== undefined && state.running) return existing;
      // A workspace that died underneath us is reaped before being replaced,
      // so a stale container cannot hold its name or network hostage.
      await this.teardown(ownerId, signal).catch(() => undefined);
    }

    const inFlight = this.pending.get(key);
    if (inFlight !== undefined) return inFlight;

    const promise = this.#provision(ownerId, key, options, signal, onProgress).finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, promise);
    return promise;
  }

  async #provision(ownerId, key, options, signal, onProgress) {
    const settings = this.settings;

    // Precondition check first: "Docker CLI not found" must not surface as a
    // confusing container failure three steps later.
    await dockerVersion(signal);

    const image = options.image ?? settings.image;
    const suffix = sanitizeNamePart(key).slice(0, 20);
    const containerName = `dsh-flaresolverr-${suffix}-${Date.now().toString(36)}`;
    const networkName = `${containerName}-net`;

    const labels = {
      [LABEL_PLUGIN]: LABEL_PLUGIN_VALUE,
      [LABEL_WORKSPACE]: containerName,
      [LABEL_OWNER]: key,
      [LABEL_NETWORK]: networkName
    };

    const env = {
      LOG_LEVEL: settings.logLevel,
      ...validateEnv(options.env)
    };

    const memory = options.memory === undefined
      ? settings.memory
      : validateDockerValue('memory', options.memory, SIZE_PATTERN);
    const cpus = options.cpus === undefined
      ? settings.cpus
      : validateDockerValue('cpus', options.cpus, CPUS_PATTERN);

    await createNetwork(networkName, labels, signal);

    let containerId;
    try {
      containerId = await runContainer(
        {
          name: containerName,
          image,
          network: networkName,
          env,
          memory,
          cpus,
          shmSize: settings.shmSize,
          containerPort: CONTAINER_PORT,
          labels,
          pullTimeoutMs: settings.pullTimeoutMs
        },
        signal
      );
    } catch (error) {
      // A failed run must not leave its network behind.
      await removeNetwork(networkName, undefined).catch(() => undefined);
      throw error;
    }

    const workspace = {
      containerName,
      containerId,
      networkName,
      image,
      envNames: Object.keys(env),
      startedAt: Date.now(),
      endpoint: undefined
    };

    await this.#awaitReady(workspace, signal, onProgress);

    this.byOwner.set(key, workspace);
    return workspace;
  }

  /**
   * Poll `/health` until the container answers, the budget expires, or the
   * container exits.
   *
   * A pull-based probe rather than a log screen-scrape: the API's own readiness
   * signal is the only thing that actually means "ready", and a container that
   * exits during the window is detected immediately instead of after the full
   * timeout.
   */
  async #awaitReady(workspace, signal, onProgress) {
    const settings = this.settings;
    const deadline = Date.now() + settings.startupTimeoutMs;
    let attempt = 0;

    for (;;) {
      if (signal?.aborted === true) throw new Error('the start was cancelled');

      attempt += 1;
      const state = await inspectContainer(workspace.containerName, signal);

      if (state === undefined) {
        throw new Error(
          `container ${workspace.containerName} disappeared during startup — it may have been removed externally`
        );
      }
      if (!state.running) {
        const logs = await containerLogs(workspace.containerName, settings.logTailLines, undefined);
        await this.#discard(workspace, undefined);
        throw new Error(
          `container exited during startup (exit code: ${state.exitCode ?? 'unknown'}). Last log lines:\n${logs}`
        );
      }

      const endpoint = state.hostPort === undefined ? undefined : `${state.hostIp ?? '127.0.0.1'}:${state.hostPort}`;
      if (endpoint === undefined) {
        const published = await publishedEndpoint(workspace.containerName, CONTAINER_PORT, signal);
        if (published !== undefined) workspace.endpoint = published;
      } else {
        workspace.endpoint = endpoint;
      }

      if (workspace.endpoint !== undefined) {
        const probe = await health(workspace.endpoint, settings.healthIntervalMs * 2, signal);
        if (probe !== undefined && probe.status === 'ok') {
          workspace.readyAttempts = attempt;
          onProgress?.(`ready after ${attempt} probe(s)`);
          return workspace.endpoint;
        }
      }

      if (Date.now() >= deadline) {
        const logs = await containerLogs(workspace.containerName, settings.logTailLines, undefined);
        // The container is deliberately left running for inspection, and the
        // message says so, so the model does not assume it was cleaned up.
        throw new Error(
          `the workspace did not become healthy within ${settings.startupTimeoutMs}ms. ` +
            `The container was left running for inspection as ${workspace.containerName}. ` +
            `Last log lines:\n${logs}`
        );
      }

      onProgress?.(`waiting for FlareSolverr (attempt ${attempt})`);
      await new Promise((resolve) => setTimeout(resolve, settings.healthIntervalMs));
    }
  }

  /** Container-and-network removal that never throws; used where failure must not mask a cause. */
  async #discard(workspace, signal) {
    await removeContainer(workspace.containerName, this.settings.stopGraceSeconds, signal).catch(() => undefined);
    await removeNetwork(workspace.networkName, signal).catch(() => undefined);
  }

  /**
   * Stop and remove one owner's workspace. Idempotent: a workspace that is
   * already gone is success, because teardown runs from cancellation paths that
   * cannot retry.
   */
  async teardown(ownerId, signal) {
    const key = WorkspaceRegistry.key(ownerId);
    const workspace = this.byOwner.get(key);
    this.byOwner.delete(key);
    if (workspace === undefined) return { removed: false };

    await removeContainer(workspace.containerName, this.settings.stopGraceSeconds, signal);
    await removeNetwork(workspace.networkName, signal);
    return { removed: true, containerName: workspace.containerName };
  }

  /**
   * List this plugin's containers, split into the caller's live workspace and
   * everything else.
   *
   * The "everything else" set is the orphan case: containers whose owner
   * session is gone. Labels make them visible, which is the whole reason
   * ownership is recorded as a label rather than only in memory.
   */
  async survey(ownerId, signal) {
    const containers = await listContainers(signal);
    const key = WorkspaceRegistry.key(ownerId);

    const mine = [];
    const orphans = [];
    for (const container of containers) {
      if (container.labelOwner === key) mine.push(container);
      else orphans.push(container);
    }
    return { mine, orphans };
  } 

  /** Stop one container by name, whatever its owner label says. */
  async reap(containerName, signal) {
    const state = await inspectContainer(containerName, signal);
    const networkName = state?.labels?.[LABEL_NETWORK];
    await removeContainer(containerName, this.settings.stopGraceSeconds, signal);
    if (typeof networkName === 'string' && networkName !== '') {
      await removeNetwork(networkName, signal);
    }
  }
}

/** Build the live endpoint description the model reads, including the solver's own User-Agent. */
async function describeEndpoint(workspace) {
  const agent = await index(workspace.endpoint, undefined);
  return {
    endpoint: workspace.endpoint,
    url: `http://${workspace.endpoint}/v1`,
    userAgent: typeof agent?.userAgent === 'string' ? agent.userAgent : undefined,
    version: typeof agent?.version === 'string' ? agent.version : undefined
  };
}

/** Register the tool and its optional system-prompt section. */
export function apply(ctx, config) {
  const settings = resolveConfig(config);
  const registry = new WorkspaceRegistry(ctx, settings);
  const disposers = [];
  /** Job ids this plugin started, so a kill can be attributed rather than blanket-applied. */
  const ownedJobs = new Map();

  const tool = {
    name: TOOL_NAME,
    description:
      'Manage a disposable local FlareSolverr workspace — a loopback-only Docker container that solves Cloudflare and DDoS-Guard challenges and returns the page plus its cookies. ' +
      'Actions: "start" brings up the container, "request" runs one v1 command against it (starting it if needed), "status" reports the workspace, "stop" removes the container and its network. ' +
      'FlareSolverr is an unauthenticated open proxy: this plugin only ever publishes it on 127.0.0.1. ' +
      'Load the flaresolverr-workspace skill for the API contract and the failure playbook before doing anything non-trivial with it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ACTIONS,
          description: 'What to do: start the workspace, run a request, report status, or stop it.'
        },
        cmd: {
          type: 'string',
          enum: ['sessions.create', 'sessions.list', 'sessions.destroy', 'request.get', 'request.post'],
          description: 'action=request only: the FlareSolverr v1 command to run.'
        },
        url: {
          type: 'string',
          description: 'action=request only: the target URL. Required for request.get and request.post.'
        },
        session: {
          type: 'string',
          description: 'action=request only: an existing browser session id to reuse, avoiding a browser launch per call.'
        },
        maxTimeout: {
          type: 'number',
          description: `action=request only: milliseconds to solve the challenge. Defaults to ${DEFAULTS.defaultMaxTimeoutMs}.`
        },
        cookies: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: { name: { type: 'string' }, value: { type: 'string' } },
            required: ['name', 'value']
          },
          description: 'action=request only: cookies to load into the browser before navigating.'
        },
        postData: {
          type: 'string',
          description: 'action=request only: application/x-www-form-urlencoded body. Required for request.post, rejected for request.get.'
        },
        returnOnlyCookies: {
          type: 'boolean',
          description: 'action=request only: return cookies without page data or headers.'
        },
        returnScreenshot: {
          type: 'boolean',
          description: 'action=request only: include a base64 PNG screenshot of the final rendered page.'
        },
        disableMedia: {
          type: 'boolean',
          description: 'action=request only: block images, CSS, and fonts. Faster and lighter; use it unless you need the rendered assets.'
        },
        waitInSeconds: {
          type: 'number',
          description: 'action=request only: seconds to wait after solving, for JavaScript-rendered content to settle.'
        },
        session_ttl_minutes: {
          type: 'integer',
          description: 'action=request only: rotate an expired session automatically after this many minutes.'
        },
        tabs_till_verify: {
          type: 'integer',
          description: 'action=request only: Tab presses needed to reach a Cloudflare Turnstile widget; the token is returned as turnstile_token. GET only.'
        },
        image: {
          type: 'string',
          description: `action=start only: container image to run. Defaults to ${DEFAULTS.image}.`
        },
        env: {
          type: 'object',
          additionalProperties: true,
          description:
            'action=start only: extra environment variables for the container, e.g. PROXY_URL, LOG_LEVEL, TEST_URL. ' +
            'Values are never echoed back in results.'
        },
        memory: {
          type: 'string',
          description: `action=start only: container memory limit, e.g. "512m". Defaults to ${DEFAULTS.memory}.`
        },
        cpus: {
          type: 'string',
          description: `action=start only: container CPU limit, e.g. "1.5". Defaults to ${DEFAULTS.cpus}.`
        },
        full: {
          type: 'boolean',
          description: 'action=request only: return the raw response body and headers instead of a summary. Large; use deliberately.'
        },
        all: {
          type: 'boolean',
          description:
            'action=status only: also list containers owned by sessions that are gone. action=stop only: remove those orphans too.'
        }
      },
      required: ['action']
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [
        { type: 'text', text: typeof value === 'string' ? value : String(value) }
      ]
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `FlareSolverr ${isRecord(args) && typeof args.action === 'string' ? args.action : ''}`.trim(),
      kind: isRecord(args) && (args.action === 'start' || args.action === 'stop') ? 'execute' : 'read',
      rawInput: args
    }),
    async execute(args, exec) {
      const input = isRecord(args) ? args : {};
      const action = typeof input.action === 'string' ? input.action : '';
      if (!ACTIONS.includes(action)) {
        throw new Error(`invalid action: expected one of ${ACTIONS.join(', ')}`);
      }

      const ownerId = exec?.agent?.id;
      const signal = exec?.signal;

      switch (action) {
        case 'start':
          return executeStart(input, ownerId, signal);
        case 'status':
          return executeStatus(input, ownerId, signal);
        case 'request':
          return executeRequest(input, ownerId, signal);
        case 'stop':
          return executeStop(input, ownerId, signal);
        default:
          throw new Error(`unsupported action: ${action}`);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Action handlers
  // ---------------------------------------------------------------------------

  async function executeStart(input, ownerId, signal) {
    const env = validateEnv(input.env);
    if (input.image !== undefined && typeof input.image !== 'string') {
      throw new Error('invalid image: expected a string');
    }

    const existing = registry.get(ownerId);
    if (existing !== undefined) {
      const state = await inspectContainer(existing.containerName, signal);
      if (state?.running === true) {
        const live = await describeEndpoint(existing);
        return boundOutput(
          {
            action: 'start',
            reused: true,
            workspace: existing.containerName,
            ...live,
            userAgentTrap: USER_AGENT_TRAP,
            note: 'This session already has a running workspace.'
          },
          settings.maxOutputChars,
          'start output truncated'
        );
      }
    }

    // The registration makes the workspace session-owned: cancelling the job or
    // destroying the session runs the same teardown as action=stop.
    const jobId = ctx.jobs.start({
      kind: 'bash',
      label: `flaresolverr workspace for ${sanitizeNamePart(ownerId)}`,
      owner: ownerId,
      run(job) {
        const controller = new AbortController();
        const forward = () => controller.abort();
        if (signal !== undefined) signal.addEventListener('abort', forward, { once: true });

        let workspace;

        const done = (async () => {
          try {
            job.updateProgress('pulling image and starting container');
            workspace = await registry.start(
              ownerId,
              { image: input.image, env, memory: input.memory, cpus: input.cpus },
              controller.signal,
              (line) => job.updateProgress(line)
            );
            job.append(`workspace ${workspace.containerName} ready at http://${workspace.endpoint}\n`);
            // Stay registered for the workspace's whole life: this job IS the
            // ownership record, so it settles only at teardown.
            await new Promise((resolve) => {
              controller.signal.addEventListener('abort', resolve, { once: true });
            });
            return { status: 'killed', detail: 'workspace torn down' };
          } catch (error) {
            return { status: 'failed', detail: errorMessage(error) };
          } finally {
            if (signal !== undefined) signal.removeEventListener('abort', forward);
            await registry.teardown(ownerId, undefined).catch(() => undefined);
          }
        })();

        return {
          cancel: (reason) => {
            if (controller.signal.aborted) return;
            controller.abort(reason ?? 'cancelled');
          },
          done
        };
      }
    });

    ownedJobs.set(jobId, ownerId);

    // Wait for readiness so `start` can answer with a live endpoint. The job
    // keeps running afterwards as the ownership record.
    //
    // The budget covers a cold pull (which dominates) plus the readiness window
    // the job itself enforces, with headroom for the probe cadence — so this
    // loop never expires before the job it is observing can legitimately finish.
    const deadline = Date.now() + settings.pullTimeoutMs + settings.startupTimeoutMs + 5_000;
    for (;;) {
      if (signal?.aborted === true) throw new Error('the start was cancelled');

      const workspace = registry.get(ownerId);
      if (workspace?.endpoint !== undefined) {
        const state = await inspectContainer(workspace.containerName, signal);
        if (state?.running === true && (await health(workspace.endpoint, 2_000, signal)) !== undefined) break;
      }
      const job = ctx.jobs.get(jobId, ownerId);
      if (job.status === 'failed' || job.status === 'killed') {
        throw new Error(`the workspace failed to start: ${job.detail ?? job.status}`);
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `the workspace did not become ready within the startup budget. It is still starting as background job ${jobId}; check it with ${TOOL_NAME} action=status, or job_output ${jobId}.`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, settings.healthIntervalMs));
    }

    const workspace = registry.get(ownerId);
    workspace.jobId = jobId;
    const live = await describeEndpoint(workspace);

    return boundOutput(
      {
        action: 'start',
        reused: false,
        jobId,
        workspace: workspace.containerName,
        network: workspace.networkName,
        image: workspace.image,
        ...live,
        userAgentTrap: USER_AGENT_TRAP,
        envNames: workspace.envNames,
        note: `The workspace is owned by this session. It is removed when the session ends or job ${jobId} is killed; remove it sooner with action=stop.`
      },
      settings.maxOutputChars,
      'start output truncated'
    );
  }

  async function executeStatus(input, ownerId, signal) {
    const workspace = registry.get(ownerId);
    const survey = await registry.survey(ownerId, signal);

    let live;
    if (workspace !== undefined) {
      const state = await inspectContainer(workspace.containerName, signal);
      live = {
        container: workspace.containerName,
        jobId: workspace.jobId,
        image: workspace.image,
        running: state?.running ?? false,
        status: state?.status ?? 'absent',
        startedAt: state?.startedAt,
        endpoint: workspace.endpoint,
        url: workspace.endpoint === undefined ? undefined : `http://${workspace.endpoint}/v1`,
        healthy: workspace.endpoint === undefined ? false : (await health(workspace.endpoint, 2_000, signal)) !== undefined
      };
    }

    const result = {
      action: 'status',
      workspace: live ?? null,
      containers: survey.mine.map((c) => ({ name: c.name, running: c.running, status: c.status })),
      orphanCount: survey.orphans.length
    };
    if (input.all === true) {
      result.orphans = survey.orphans.map((c) => ({
        name: c.name,
        running: c.running,
        status: c.status,
        owner: c.labelOwner
      }));
    }
    if (live === undefined && survey.mine.length === 0) {
      result.note = 'No workspace for this session. Call action=start to create one.';
    }

    return boundOutput(result, settings.maxOutputChars, 'status output truncated');
  }

  async function executeRequest(input, ownerId, signal) {
    const cmd = typeof input.cmd === 'string' ? input.cmd : '';
    if (!['sessions.create', 'sessions.list', 'sessions.destroy', 'request.get', 'request.post'].includes(cmd)) {
      throw new Error(
        'invalid cmd: expected one of sessions.create, sessions.list, sessions.destroy, request.get, request.post'
      );
    }

    const body = { cmd };

    if (cmd === 'request.get' || cmd === 'request.post') {
      if (typeof input.url !== 'string' || input.url.trim() === '') {
        throw new Error(`invalid url: required for ${cmd}`);
      }
      let parsed;
      try {
        parsed = new URL(input.url);
      } catch {
        throw new Error(`invalid url: ${JSON.stringify(input.url)} is not an absolute URL`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`invalid url: expected an http or https URL, got ${parsed.protocol}`);
      }
      body.url = input.url;
    }

    // These two rules are the API's own, reported in its own terms so the model
    // is not left guessing which of the pair it violated.
    if (cmd === 'request.get' && input.postData !== undefined) {
      throw new Error("Cannot use 'postData' when sending a GET request.");
    }
    if (cmd === 'request.post') {
      if (typeof input.postData !== 'string') {
        throw new Error("Request parameter 'postData' is mandatory in 'request.post' command.");
      }
      body.postData = input.postData;
    }

    if (cmd === 'sessions.destroy' && (typeof input.session !== 'string' || input.session === '')) {
      throw new Error("invalid session: 'sessions.destroy' requires a session id");
    }

    const maxTimeout = input.maxTimeout === undefined ? settings.defaultMaxTimeoutMs : input.maxTimeout;
    if (!Number.isFinite(maxTimeout) || maxTimeout < 1 || maxTimeout > 600_000) {
      throw new Error(`invalid maxTimeout: expected 1-600000 milliseconds, got ${JSON.stringify(input.maxTimeout)}`);
    }
    body.maxTimeout = Math.floor(maxTimeout);

    for (const key of ['session', 'session_ttl_minutes', 'tabs_till_verify', 'waitInSeconds']) {
      if (input[key] !== undefined) body[key] = input[key];
    }
    for (const key of ['returnOnlyCookies', 'returnScreenshot', 'disableMedia']) {
      if (typeof input[key] === 'boolean') body[key] = input[key];
    }
    if (input.cookies !== undefined) {
      if (!Array.isArray(input.cookies)) throw new Error('invalid cookies: expected an array of {name, value}');
      body.cookies = input.cookies;
    }

    // Auto-start: a request against a stopped workspace is a normal thing to
    // want, and failing it would just make the model call start first.
    let workspace = registry.get(ownerId);
    if (workspace === undefined || (await inspectContainer(workspace.containerName, signal))?.running !== true) {
      await executeStart({}, ownerId, signal);
      workspace = registry.get(ownerId);
    }
    if (workspace === undefined || workspace.endpoint === undefined) {
      throw new Error('no live workspace; call action=start first');
    }

    // The transport deadline must outlast the solve, or the tool would abort a
    // request FlareSolverr is still working on.
    const transportBudget = body.maxTimeout + settings.requestTimeoutSlackMs;

    try {
      const envelope = await run(workspace.endpoint, body, transportBudget, signal);
      const includeBody = input.full === true;
      const summary = summarize(envelope, includeBody);

      if (includeBody === false && typeof summary.solution?.response === 'string') {
        summary.solution.response = undefined;
      }
      if (includeBody === false && summary.solution !== undefined) {
        summary.solution.responseOmitted = true;
        summary.solution.responseHint = 'Rerun with full=true to include the HTML body.';
      }

      const result = { action: 'request', cmd, ...summary };
      const bound = includeBody ? Math.max(settings.maxOutputChars, MAX_BODY_ON_OPT_IN) : settings.maxOutputChars;
      return boundOutput(result, bound, 'response truncated');
    } catch (error) {
      if (error instanceof FlareError) {
        const detail = error.hint === '' ? error.message : `${error.message}\n${error.hint}`;
        throw new Error(`${error.message.startsWith('Error solving') ? '' : `${cmd} failed: `}${detail}`);
      }
      if (error instanceof DockerError) {
        throw new Error(error.hint === '' ? error.message : `${error.message}\n${error.hint}`);
      }
      throw error;
    }
  }

  async function executeStop(input, ownerId, signal) {
    const workspace = registry.get(ownerId);

    // Killing the ownership job is the other half of teardown: it aborts the
    // job's controller, whose finally block removes the container and network.
    if (workspace?.jobId !== undefined) {
      try {
        ctx.jobs.kill(workspace.jobId, ownerId, 'workspace stopped by the model');
      } catch {
        // A job that already settled is not an error here.
      }
      ownedJobs.delete(workspace.jobId);
    }

    const result = await registry.teardown(ownerId, signal);

    if (input.all === true) {
      const survey = await registry.survey(ownerId, signal);
      const reaped = [];
      for (const orphan of survey.orphans) {
        try {
          await registry.reap(orphan.name, signal);
          reaped.push(orphan.name);
        } catch (error) {
          reaped.push(`${orphan.name} (failed: ${errorMessage(error)})`);
        }
      }
      result.orphansRemoved = reaped;
    }

    return boundOutput(
      {
        action: 'stop',
        removed: result.removed,
        container: result.containerName,
        orphansRemoved: result.orphansRemoved,
        note: result.removed ? undefined : 'There was no workspace for this session.'
      },
      settings.maxOutputChars,
      'stop output truncated'
    );
  }

  disposers.push(ctx.tools.register(tool));

  if (settings.promptSection) {
    const systemPrompt = ctx.get('systemPrompt');
    if (systemPrompt !== undefined) {
      disposers.push(
        systemPrompt.section({
          name: 'flaresolverr',
          order: 2460,
          text: ({ scope }) =>
            ctx.tools.get(TOOL_NAME, scope) === undefined
              ? ''
              : `A FlareSolverr workspace is a disposable, loopback-only container. Start one with ${TOOL_NAME} action=start only when a target actually presents a Cloudflare or DDoS-Guard challenge, and remove it with action=stop when the task is done — it holds a browser and a gigabyte of image on disk.`
        })
      );
    }
  }

  // The workspace's whole life is tied to this fiber: unloading the plugin must
  // not leave a container running with no way to reach it. `ctx.on('dispose')`
  // is the last event a fiber emits, and its listener registration itself lives
  // on this fiber, so this runs exactly once, on unload.
  disposers.push(
    ctx.on('dispose', () => {
      for (const ownerId of [...registry.byOwner.keys()]) {
        void registry.teardown(ownerId === 'unowned' ? undefined : ownerId, undefined).catch(() => undefined);
      }
    })
  );

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // Teardown must not mask the first failure with a later one.
      }
    }
  };
}

export { TOOL_NAME, ACTIONS, DEFAULTS };
