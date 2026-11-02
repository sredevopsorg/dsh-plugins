/**
 * Entire toolkit — a Host-only DSH bundle.
 *
 * The plugin gives the model a typed, gated view of the Entire CLI: sessions,
 * checkpoints, search, code history, trails, reviews, the code graph, and a
 * classified passthrough for the remaining commands and the authenticated API.
 *
 * Reads never prompt. Repository-scoped mutations require `allowWrites`;
 * machine/account/control-plane calls require `allowAdmin`. Gated calls ask
 * through the Harness approval pipeline, so an approval-free deployment denies
 * them instead of silently writing.
 */

import { createSessionBridge } from './lib/bridge.js';
import { resolveConfig } from './lib/config.js';
import { buildInvocation } from './lib/commands.js';
import { EntireError, resolveCwd, runEntireCommand } from './lib/exec.js';
import { TOOL_NAMES, describeCall, permissionFor, policyForCall } from './lib/policy.js';
import { formatResult } from './lib/text.js';
import { createTools } from './lib/tools.js';

export const inject = ['tools'];

const PROMPT_TEXT =
  'Entire records agent sessions as checkpoints linked to commits. Before rewriting unfamiliar code, use entire_history (why/blame/experts) and entire_search to recover intent; use entire_sessions and entire_checkpoints to inspect prior work. ' +
  'This plugin reads Entire’s data and, where a repository carries .entire/dsh-hooks.json, forwards DSH session events to `entire hooks dsh` so DSH sessions become Entire sessions and checkpoints.';

function argumentRecord(value) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function apply(ctx, rawConfig) {
  const settings = resolveConfig(rawConfig);
  const activeRuns = new Set();
  const disposers = [];

  const invoke = async (tool, args, exec) => {
    const input = argumentRecord(args);
    const invocation = buildInvocation(tool, input.action, input, settings);
    const cwd = await resolveCwd(ctx, exec?.agent, exec?.signal, settings);

    const controller = new AbortController();
    const forwardAbort = () => controller.abort('tool call cancelled');
    if (exec?.signal !== undefined) {
      if (exec.signal.aborted === true) controller.abort('tool call cancelled');
      else exec.signal.addEventListener('abort', forwardAbort, { once: true });
    }

    activeRuns.add(controller);
    try {
      const result = await runEntireCommand({
        binary: settings.binary,
        args: invocation.args,
        cwd,
        timeoutMs: invocation.timeoutMs,
        signal: controller.signal,
        stdin: invocation.stdin
      });
      return formatResult(result, settings.maxOutputChars);
    } catch (error) {
      if (error instanceof EntireError) throw new Error(error.message);
      throw error;
    } finally {
      activeRuns.delete(controller);
      if (exec?.signal !== undefined) {
        exec.signal.removeEventListener('abort', forwardAbort);
      }
    }
  };

  for (const definition of createTools(invoke)) {
    disposers.push(ctx.tools.register(definition));
  }

  disposers.push(
    ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = await next();
      if (!TOOL_NAMES.includes(exec.name)) return decision;
      if (decision.kind !== 'allow') return decision;

      const args = argumentRecord(exec.arguments);
      const policy = policyForCall(exec.name, args);
      const verdict = permissionFor(policy, settings, describeCall(exec.name, args));

      if (verdict.kind === 'deny') {
        return {
          kind: 'deny',
          reason: verdict.reason,
          info: { name: 'EntirePolicy', code: 'ENTIRE_PERMISSION_DENIED' }
        };
      }
      if (verdict.kind === 'ask') {
        return { kind: 'ask', reason: verdict.reason };
      }
      return decision;
    })
  );

  if (settings.capture) {
    const bridge = createSessionBridge(ctx, settings);
    disposers.push(() => bridge.dispose());
  }

  if (settings.promptSection) {
    const systemPrompt = ctx.get('systemPrompt');
    if (systemPrompt !== undefined) {
      disposers.push(
        systemPrompt.section({
          name: 'entire',
          order: 2470,
          text: ({ scope }) =>
            ctx.tools.get('entire_status', scope) === undefined ? '' : PROMPT_TEXT
        })
      );
    }
  }

  disposers.push(
    ctx.on('dispose', () => {
      for (const controller of activeRuns) {
        try {
          controller.abort('plugin unloaded');
        } catch {
          // Best effort; the child close handler owns the outcome.
        }
      }
      activeRuns.clear();
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
