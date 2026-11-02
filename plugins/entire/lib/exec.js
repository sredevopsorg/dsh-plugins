/**
 * Process execution for the Entire CLI.
 *
 * Everything goes through `execFile` with an explicit argv: user values never
 * become shell syntax. The child is bounded by a timeout, by the caller's
 * AbortSignal, and by `maxBuffer`; stdin is always closed so a command that
 * would wait for a terminal prompt fails instead of hanging.
 */

import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { describeArgv, tailText } from './text.js';

const MAX_BUFFER = 4 * 1024 * 1024;

/** A failure with enough context for the model to act on. */
export class EntireError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'EntireError';
    this.exitCode = options.exitCode;
    this.signal = options.signal;
    this.command = options.command;
    this.stderr = options.stderr;
    this.stdout = options.stdout;
    this.cancelled = options.cancelled === true;
    this.timedOut = options.timedOut === true;
  }
}

/**
 * Resolve the directory Entire runs in.
 *
 * `repoPath` wins so a profile can pin one repository. Otherwise the Session's
 * current directory is used, which is what makes the existing working-directory
 * tool control which repository is inspected. `ensure()` can restore a vanished
 * directory; a failure there falls back rather than breaking the call.
 */
export async function resolveCwd(ctx, agent, signal, settings) {
  if (settings.repoPath !== '') {
    const resolved = path.resolve(settings.repoPath);
    const info = await stat(resolved).catch(() => undefined);
    if (info === undefined || !info.isDirectory()) {
      throw new EntireError(`repoPath is not a directory: ${resolved}`);
    }
    return resolved;
  }

  if (agent !== undefined) {
    const workingDirectory = ctx.get('workingDirectory');
    if (workingDirectory !== undefined) {
      try {
        return await workingDirectory.ensure(agent, signal);
      } catch {
        // Fall through to the host process directory.
      }
    }
  }

  return process.cwd();
}

/**
 * Run one Entire command.
 *
 * @param options.binary - executable name or absolute path.
 * @param options.args - argv entries after the executable.
 * @param options.cwd - working directory.
 * @param options.timeoutMs - hard wall-clock budget.
 * @param options.signal - caller cancellation.
 * @param options.stdin - optional stdin payload.
 * @returns `{ stdout, stderr }` on exit 0.
 * @throws {EntireError} on spawn failure, timeout, cancellation, or nonzero exit.
 */
export function runEntireCommand({ binary, args, cwd, timeoutMs, signal, stdin }) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const child = execFile(
      binary,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
        signal,
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' }
      },
      (error, stdout, stderr) => {
        if (settled) return;
        settled = true;

        const result = {
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : ''
        };
        if (error === null) {
          resolve(result);
          return;
        }
        reject(mapExecError(error, { binary, args, cwd, timeoutMs, signal, result }));
      }
    );

    if (child.stdin !== null && child.stdin !== undefined) {
      // An EPIPE here is expected when the child exits before reading stdin.
      child.stdin.on('error', () => undefined);
      try {
        child.stdin.end(stdin === undefined ? '' : stdin);
      } catch {
        // The close callback owns the outcome.
      }
    }
  });
}

function mapExecError(error, context) {
  const label = describeArgv(context.binary, context.args);
  const stdout = context.result?.stdout ?? '';
  const stderr = context.result?.stderr ?? '';
  const details = tailText(stderr !== '' ? stderr : stdout, 4_000);
  const base = {
    command: label,
    stderr,
    stdout
  };

  if (error?.code === 'ENOENT') {
    return new EntireError(
      `Entire CLI not found: could not execute ${JSON.stringify(context.binary)}. ` +
        'Install Entire from https://docs.entire.com/installation, put it on PATH, or set the plugin\'s `binary` config.',
      { ...base, exitCode: undefined }
    );
  }

  if (
    error?.name === 'AbortError' ||
    error?.code === 'ABORT_ERR' ||
    (context.signal?.aborted === true && error?.killed === true)
  ) {
    return new EntireError(`Entire command was cancelled: ${label}`, {
      ...base,
      cancelled: true,
      signal: error?.signal
    });
  }

  if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return new EntireError(
      `Entire command produced more than ${Math.floor(MAX_BUFFER / (1024 * 1024))} MB: ${label}. ` +
        'Narrow the request (for example with --short, --compact, --limit, or a smaller graph scope).',
      { ...base }
    );
  }

  if (error?.code === 'ETIMEDOUT' || (error?.killed === true && context.signal?.aborted !== true)) {
    return new EntireError(
      `Entire command timed out after ${context.timeoutMs} ms: ${label}. ` +
        'Narrow the request or raise the plugin\'s `timeoutMs` config.' +
        (details === '' ? '' : `\n${details}`),
      { ...base, timedOut: true, signal: error?.signal }
    );
  }

  const hint = hintFor(details);
  return new EntireError(
    `Entire command failed: ${label} (exit ${error?.code ?? 'unknown'})` +
      (details === '' ? '' : `\n${details}`) +
      (hint === undefined ? '' : `\n${hint}`),
    { ...base, exitCode: typeof error?.code === 'number' ? error.code : undefined, signal: error?.signal }
  );
}

function hintFor(details) {
  if (details === '') return undefined;
  if (/not a git repository|not in a git repository|outside a git repository/i.test(details)) {
    return 'Hint: Entire needs a git repository. Change the Session working directory or set the plugin\'s `repoPath` config.';
  }
  if (/not logged in|requires authentication|authentication required|unauthenticated|please (?:run|log in)|entire login|401 unauthorized/i.test(details)) {
    return 'Hint: This Entire feature needs an authenticated account. Ask the user to run `entire login` in a terminal; this plugin does not run interactive logins.';
  }
  if (/keychain|freedesktop\.secrets|secret service|dbus|network is not allowed|sandbox|permission denied.*network/i.test(details)) {
    return 'Hint: Entire\'s keyring or network access appears to be blocked. Re-run this in an unsandboxed environment; do not assume the user is logged out.';
  }
  if (/is not installed|not installed; run|plugin .* not found/i.test(details)) {
    return 'Hint: This command needs an Entire CLI plugin that is not installed. Ask the user before running `entire plugin install ...`.';
  }
  if (/cannot prompt|requires a terminal|not a terminal|no tty|interactive/i.test(details)) {
    return 'Hint: This command needs an interactive terminal. Ask the user to run it themselves.';
  }
  if (/unknown command|unknown flag|unrecognized/i.test(details)) {
    return 'Hint: The installed Entire CLI may not match the documentation. Run `entire agent-help <command> --json` to read the installed command surface.';
  }
  return undefined;
}
