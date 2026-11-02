/**
 * Which Entire calls may run, and what consent they need.
 *
 * Two independent gates:
 *   allowWrites — repository-scoped mutations (stop a session, delete a
 *                 checkpoint, write trail state, run a review, build a graph).
 *   allowAdmin  — machine/account/control-plane calls (enable, plugins, auth,
 *                 organizations, repositories, non-GET API). It implies writes.
 *
 * Read calls never prompt. Gated calls ask through the Harness approval
 * pipeline; when approval support is missing, `ask` becomes a denial.
 */

import { adminAllowed, writesAllowed } from './config.js';

export const TOOL_NAMES = Object.freeze([
  'entire_status',
  'entire_sessions',
  'entire_checkpoints',
  'entire_search',
  'entire_history',
  'entire_trails',
  'entire_review',
  'entire_graph',
  'entire_run'
]);

const TOOL_SET = new Set(TOOL_NAMES);

const WRITE_ACTIONS = Object.freeze({
  entire_status: new Set(['doctor']),
  entire_sessions: new Set(['stop', 'attach', 'adopt', 'resume']),
  entire_checkpoints: new Set(['delete']),
  entire_search: new Set(),
  entire_history: new Set(),
  entire_trails: new Set([
    'create',
    'update',
    'comment',
    'approve',
    'link',
    'unlink',
    'checkout',
    'resume',
    'merge'
  ]),
  entire_review: new Set(['run', 'configure']),
  entire_graph: new Set(['setup', 'index', 'verify'])
});

/** Read-only top-level commands accepted by the passthrough. */
const RUN_READ = new Set([
  'activity',
  'agent-help',
  'blame',
  'help',
  'labs',
  'recap',
  'search',
  'status',
  'tokens',
  'version',
  'why'
]);

/** Task-driven commands accepted by the passthrough after allowWrites. */
const RUN_WRITE = new Set([
  'checkpoint',
  'dispatch',
  'doctor',
  'graph',
  'import',
  'review',
  'runner',
  'session',
  'trail'
]);

/** User-owned commands accepted by the passthrough only after allowAdmin. */
const RUN_ADMIN = new Set([
  'agent',
  'auth',
  'clean',
  'cluster',
  'configure',
  'disable',
  'enable',
  'login',
  'logout',
  'org',
  'plugin',
  'project',
  'repo'
]);

/** Commands that start a server or need a shell and are never exposed. */
const RUN_REFUSED = new Map([
  ['mcp', '`entire mcp` starts a long-lived MCP server; it is not an agent tool.'],
  ['completion', 'Shell completion generation is user setup, not an agent action.']
]);

/** Commands that require the user's own terminal. */
const RUN_USER_ONLY = new Map([
  ['login', '`entire login` runs an interactive device flow. Ask the user to run it.'],
  ['logout', '`entire logout` is account management. Ask the user to run it.']
]);

/** True when the value is a non-null, non-array object. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function flagValue(tokens, name) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === name) return tokens[index + 1];
    if (token.startsWith(`${name}=`)) return token.slice(name.length + 1);
  }
  return undefined;
}

function hasFlag(tokens, name) {
  return tokens.some((token) => token === name || token.startsWith(`${name}=`));
}

function hasPositional(tokens, fromIndex = 1) {
  return tokens.slice(fromIndex).some((token) => !token.startsWith('-'));
}

/**
 * Classify one typed-tool call.
 *
 * `dryRun` defaults are honoured: checkpoint delete and trail merge are read
 * calls until the caller explicitly asks to mutate.
 */
export function actionPolicy(tool, action, args) {
  if (!TOOL_SET.has(tool)) return 'read';
  const input = isRecord(args) ? args : {};

  if (tool === 'entire_status' && action === 'doctor') {
    return input.fix === true ? 'write' : 'read';
  }
  if (tool === 'entire_checkpoints' && action === 'delete') {
    return input.dryRun === false ? 'write' : 'read';
  }
  if (tool === 'entire_trails' && action === 'merge') {
    return input.dryRun === false ? 'write' : 'read';
  }

  const writeActions = WRITE_ACTIONS[tool];
  return writeActions !== undefined && writeActions.has(action) ? 'write' : 'read';
}

/**
 * Classify one `entire_run` argv.
 *
 * Unknown commands fail closed as admin: a future CLI addition cannot become an
 * ungated write path by accident.
 */
export function classifyRun(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { kind: 'deny', reason: 'argv must be a non-empty array of command-line entries.' };
  }
  if (!argv.every((token) => typeof token === 'string')) {
    return { kind: 'deny', reason: 'Every argv entry must be a string.' };
  }

  const tokens = argv;
  const command = tokens[0];

  if (
    tokens.includes('--help') ||
    tokens.includes('-h') ||
    command === 'help' ||
    command === 'agent-help'
  ) {
    return { kind: 'read' };
  }

  const refused = RUN_REFUSED.get(command);
  if (refused !== undefined) return { kind: 'deny', reason: refused };

  const userOnly = RUN_USER_ONLY.get(command);
  if (userOnly !== undefined) return { kind: 'deny', reason: userOnly };
  if (command === 'auth' && (tokens[1] === 'login' || tokens[1] === 'logout')) {
    return { kind: 'deny', reason: 'Interactive authentication is user-only; ask the user to run it.' };
  }

  const interactive = detectInteractive(tokens);
  if (interactive !== undefined) return { kind: 'deny', reason: interactive };

  if (command === 'api') {
    const method = apiMethod(tokens);
    return method === 'GET'
      ? { kind: 'write', reason: '`entire api` reaches the control plane even for a GET.' }
      : { kind: 'admin', reason: 'A non-GET `entire api` call mutates the control plane.' };
  }

  if (RUN_READ.has(command)) return { kind: 'read' };
  if (RUN_WRITE.has(command)) return { kind: 'write' };
  if (RUN_ADMIN.has(command)) return { kind: 'admin' };

  return { kind: 'admin', reason: `Unrecognized Entire command ${JSON.stringify(command)}; treating it as administrative.` };
}

function detectInteractive(tokens) {
  const command = tokens[0];
  const subcommand = tokens[1];

  if (command === 'recap' && !hasFlag(tokens, '--static')) {
    return '`entire recap` opens an interactive view; pass --static, or use the entire_history tool.';
  }
  if (command === 'search' && !hasPositional(tokens)) {
    return '`entire search` without a query opens the interactive table; provide a query.';
  }
  if (command === 'trail' && subcommand === 'watch' && !hasFlag(tokens, '--once')) {
    return '`entire trail watch` streams until interrupted; use the entire_trails read actions instead.';
  }
  if (command === 'session' && subcommand === 'resume' && !hasPositional(tokens, 2)) {
    return '`entire session resume` without a branch opens a picker; provide a branch.';
  }
  if (command === 'session' && subcommand === 'stop' && !hasPositional(tokens, 2) && !hasFlag(tokens, '--all')) {
    return '`entire session stop` without an id or --all opens a picker; provide one.';
  }
  if (
    command === 'checkpoint' &&
    subcommand === 'explain' &&
    !hasPositional(tokens, 2) &&
    flagValue(tokens, '--checkpoint') === undefined &&
    flagValue(tokens, '--commit') === undefined &&
    !hasFlag(tokens, '--json')
  ) {
    return '`entire checkpoint explain` without a target opens the interactive list; provide an id/commit or --json.';
  }
  if (command === 'review') {
    const readSelector =
      hasFlag(tokens, '--list') ||
      hasFlag(tokens, '--agents') ||
      hasFlag(tokens, '--models') ||
      hasFlag(tokens, '--findings') ||
      hasFlag(tokens, '--show-config');
    if (hasFlag(tokens, '--configure') && !hasFlag(tokens, '--set-agents')) {
      return '`entire review --configure` without --set-agents opens the wizard; pass the non-interactive --set-* flags or use the entire_review tool.';
    }
    if (!readSelector && tokens.length === 1) {
      return '`entire review` with no profile or selector can open guided setup; configure a profile first or use the entire_review tool.';
    }
  }

  return undefined;
}

/** Best-effort HTTP method resolution for the `entire api` passthrough. */
export function apiMethod(tokens) {
  let method;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-X' || token === '--method') {
      method = tokens[index + 1];
    } else if (token.startsWith('--method=')) {
      method = token.slice('--method='.length);
    } else if (token.startsWith('-X') && token.length > 2) {
      method = token.slice(2);
    }
  }
  if (method !== undefined && method !== '') return method.toUpperCase();
  const hasBody =
    tokens.some((token) => token === '-F' || token.startsWith('-F')) ||
    hasFlag(tokens, '--field') ||
    hasFlag(tokens, '--input');
  return hasBody ? 'POST' : 'GET';
}

/**
 * The effective policy for one tool call.
 *
 * @returns `{ kind: 'read' | 'write' | 'admin' | 'deny', reason?: string }`
 */
export function policyForCall(tool, args) {
  const input = isRecord(args) ? args : {};
  if (tool === 'entire_run') return classifyRun(input.argv);
  return { kind: actionPolicy(tool, input.action, input) };
}

/**
 * Convert a policy into the pre-execute decision.
 *
 * `allow` keeps the existing decision; `ask` requests user approval; `deny`
 * returns an actionable message that names the config key.
 */
export function permissionFor(policy, settings, label) {
  if (policy.kind === 'read') return { kind: 'allow' };
  if (policy.kind === 'deny') {
    return { kind: 'deny', reason: policy.reason ?? 'This Entire command is not available to the agent.' };
  }
  if (policy.kind === 'write') {
    if (!writesAllowed(settings)) {
      return {
        kind: 'deny',
        reason:
          `${label} changes repository session state, and writes are disabled. ` +
          'Set `allowWrites: true` in the plugin configuration, then approve the prompt.'
      };
    }
    return { kind: 'ask', reason: `${label} changes repository session state. Approve to continue.` };
  }
  if (policy.kind === 'admin') {
    if (!adminAllowed(settings)) {
      return {
        kind: 'deny',
        reason:
          `${label} changes machine, account, or control-plane state, and admin actions are disabled. ` +
          'Set `allowAdmin: true` in the plugin configuration, then approve the prompt.'
      };
    }
    return { kind: 'ask', reason: `${label} changes machine, account, or control-plane state. Approve to continue.` };
  }
  return { kind: 'deny', reason: 'Unknown Entire policy.' };
}

/** A bounded human label for a call, used in approval and denial reasons. */
export function describeCall(tool, args) {
  const input = isRecord(args) ? args : {};
  if (tool === 'entire_run') {
    const argv = Array.isArray(input.argv) ? input.argv.map(String).join(' ') : '';
    return `entire ${argv}`.trim().slice(0, 240);
  }
  const action = typeof input.action === 'string' ? input.action : 'call';
  return `entire ${tool.replace(/^entire_/u, '')} ${action}`;
}
