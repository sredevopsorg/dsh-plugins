/**
 * DSH session capture bridge.
 *
 * Entire only records agent work that reaches it through hooks. DSH has no
 * repository-local hook file, so this plugin forwards the host's session
 * lifecycle events to the Entire CLI:
 *
 *     entire hooks dsh <hook>        (JSON payload on stdin)
 *
 * The external agent binary \`entire-agent-dsh\` (Agent Integration Protocol)
 * normalizes the payload into an Entire Event and Entire writes session state,
 * transcripts and per-turn checkpoints. Commits then carry an
 * \`Entire-Checkpoint\` trailer and everything Entire exposes (checkpoint
 * list/explain, blame, why, search, recap) has data for DSH work.
 *
 * Activation is repository-scoped: \`entire agent add dsh\` runs
 * \`entire-agent-dsh install-hooks\`, which writes the marker file. Sessions
 * whose repository lacks the marker are ignored, so one profile-wide plugin can
 * serve every repository.
 *
 * Hook calls are serialized per repository so session-start lands before the
 * turn events that reference it.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HUMAN_SOURCE_KINDS = new Set(['human', 'user', 'prompt']);

/** Concatenate the text blocks of a user message. */
export function promptText(data) {
  const content = Array.isArray(data?.content) ? data.content : [];
  return content
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text')
    .map((block) => block.text)
    .filter((value) => typeof value === 'string' && value !== '')
    .join('\n');
}

/** The repository a session belongs to, or undefined. */
export function repoRootOf(session) {
  const candidate = session?.header?.cwd ?? session?.meta?.cwd ?? session?.cwd;
  return typeof candidate === 'string' && candidate !== '' ? candidate : undefined;
}

/**
 * Map one DSH session event to an Entire hook call, or null when the event has
 * no lifecycle significance.
 *
 * @returns {{ hook: string, fields: Record<string, unknown> } | null}
 */
export function hookForEvent(event) {
  if (event === null || typeof event !== 'object') return null;
  const data = event.data ?? {};
  switch (event.type) {
    case 'user/message': {
      if (!HUMAN_SOURCE_KINDS.has(data.source?.kind)) return null;
      const prompt = promptText(data);
      if (prompt === '') return null;
      return { hook: 'turn-start', fields: { user_prompt: prompt, raw: { turn: data.turn ?? null } } };
    }
    case 'turn/end':
      return { hook: 'turn-end', fields: { raw: { turn: data.turn, reason: data.reason } } };
    case 'compaction/end':
      return { hook: 'compaction', fields: { raw: { turn: data.turn ?? null } } };
    default:
      return null;
  }
}

/**
 * Subscribe the bridge to the host's session events.
 *
 * @param ctx - the plugin context; only \`on\` and \`logger\` are used.
 * @param settings - resolved plugin settings (binary, captureMarker, captureTimeoutMs).
 * @returns {{ dispose: () => void, flush: () => Promise<unknown> }}
 */
export function createSessionBridge(ctx, settings) {
  const binary = typeof settings.binary === 'string' && settings.binary !== '' ? settings.binary : 'entire';
  const marker = typeof settings.captureMarker === 'string' ? settings.captureMarker : '';
  const timeoutMs = typeof settings.captureTimeoutMs === 'number' ? settings.captureTimeoutMs : 10_000;
  const queues = new Map();
  const warned = new Set();

  function repoEnabled(repoRoot) {
    if (marker === '') return true;
    try {
      return fs.existsSync(path.join(repoRoot, marker));
    } catch {
      return false;
    }
  }

  function warnOnce(repoRoot, message) {
    if (warned.has(repoRoot)) return;
    warned.add(repoRoot);
    ctx.logger?.warn?.(message);
  }

  function fire(repoRoot, hook, payload) {
    const previous = queues.get(repoRoot) ?? Promise.resolve();
    const next = previous.then(
      () =>
        new Promise((resolve) => {
          let child;
          try {
            child = execFile(
              binary,
              ['hooks', 'dsh', hook],
              { cwd: repoRoot, timeout: timeoutMs, windowsHide: true, maxBuffer: Infinity },
              (error) => {
                if (error) warnOnce(repoRoot, 'entire: hook ' + hook + ' failed: ' + error.message);
                resolve(undefined);
              }
            );
          } catch (error) {
            warnOnce(repoRoot, 'entire: cannot start ' + binary + ': ' + error.message);
            resolve(undefined);
            return;
          }
          try {
            child.stdin?.end(JSON.stringify(payload) + '\n');
          } catch {
            resolve(undefined);
          }
        })
    );
    queues.set(repoRoot, next);
    return next;
  }

  function emit(session, hook, fields = {}) {
    const repoRoot = repoRootOf(session);
    const sessionId = typeof session?.id === 'string' ? session.id : String(session?.id ?? '');
    if (repoRoot === undefined || sessionId === '' || !repoEnabled(repoRoot)) return Promise.resolve(undefined);
    const raw = fields.raw ?? {};
    const rest = { ...fields };
    delete rest.raw;
    const payload = {
      hook_type: hook.replace(/-/g, '_'),
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      raw_data: { dsh: raw },
      ...rest
    };
    return fire(repoRoot, hook, payload);
  }

  function onEvent(session, event) {
    const mapped = hookForEvent(event);
    if (mapped === null) return Promise.resolve(undefined);
    return emit(session, mapped.hook, mapped.fields);
  }

  const disposers = [
    ctx.on('session/created', (session) => {
      void emit(session, 'session-start', { raw: { origin: session?.header?.origin ?? null } });
    }),
    ctx.on('session/event', (session, event) => {
      void onEvent(session, event);
    }),
    ctx.on('session/disposed', (session) => {
      void emit(session, 'session-end', {});
    })
  ];

  return {
    dispose() {
      for (const dispose of disposers) {
        try {
          dispose?.();
        } catch {
          // Teardown must not mask the first failure with a later one.
        }
      }
      queues.clear();
    },
    flush() {
      return Promise.all([...queues.values()]);
    }
  };
}
