/**
 * Argument builders for every Entire tool action.
 *
 * This module is deliberately the only place that knows CLI flags. Each
 * builder validates its inputs, keeps user values as separate argv entries,
 * and rejects a value that would be mistaken for a flag where a positional is
 * expected. The tool executor never builds a shell string.
 */

export const ACTIONS = Object.freeze({
  entire_status: Object.freeze(['status', 'version', 'doctor', 'activity', 'help']),
  entire_sessions: Object.freeze(['list', 'current', 'info', 'tokens', 'stop', 'attach', 'adopt', 'resume']),
  entire_checkpoints: Object.freeze(['list', 'explain', 'tokens', 'profile', 'delete']),
  entire_search: Object.freeze(['work', 'code']),
  entire_history: Object.freeze(['blame', 'why', 'experts', 'recap', 'dispatch']),
  entire_trails: Object.freeze([
    'list',
    'show',
    'approvals',
    'findings',
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
  entire_review: Object.freeze(['list', 'agents', 'models', 'findings', 'run', 'configure']),
  entire_graph: Object.freeze([
    'query',
    'neighbors',
    'impact',
    'def',
    'explain',
    'context',
    'commit',
    'diff',
    'checkpoint',
    'capabilities',
    'health',
    'agent-guide',
    'setup',
    'index',
    'verify'
  ]),
  entire_run: Object.freeze([])
});

const ULID_OR_HEX = /^(?:[0-9a-f]{12}|[0-9A-HJKMNP-TV-Z]{26})$/iu;

/* ------------------------------------------------------------------------- */
/* Validation helpers                                                        */
/* ------------------------------------------------------------------------- */

function fail(message) {
  throw new Error(message);
}

function record(input) {
  return input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function optionalString(input, key, label = key) {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') fail(`${label} must be a string`);
  if (value.includes('\u0000')) fail(`${label} must not contain a NUL byte`);
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function requiredString(input, key, label = key) {
  const value = optionalString(input, key, label);
  if (value === undefined) fail(`${label} is required`);
  return value;
}

function positional(value, label) {
  if (typeof value !== 'string') fail(`${label} must be a string`);
  if (value.includes('\u0000')) fail(`${label} must not contain a NUL byte`);
  const trimmed = value.trim();
  if (trimmed === '') fail(`${label} must not be empty`);
  if (trimmed.startsWith('-')) fail(`${label} must not start with "-"`);
  return trimmed;
}

function optionalPositional(input, key, label = key) {
  const value = optionalString(input, key, label);
  return value === undefined ? undefined : positional(value, label);
}

function optionalBoolean(input, key, label = key) {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') fail(`${label} must be a boolean`);
  return value;
}

function optionalInteger(input, key, label, min, max) {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value)) fail(`${label} must be an integer`);
  if (value < min || value > max) fail(`${label} must be between ${min} and ${max}`);
  return value;
}

function optionalEnum(input, key, label, values) {
  const value = optionalString(input, key, label);
  if (value === undefined) return undefined;
  if (!values.includes(value)) fail(`${label} must be one of ${values.join(', ')}`);
  return value;
}

function stringArray(input, key, label = key) {
  const value = input[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${label} must be an array of strings`);
  return value.map((entry) => {
    if (typeof entry !== 'string') fail(`${label} entries must be strings`);
    const trimmed = entry.trim();
    if (trimmed === '') fail(`${label} entries must not be empty`);
    if (trimmed.includes('\u0000')) fail(`${label} entries must not contain a NUL byte`);
    return trimmed;
  });
}

/** Push `--flag value` when the value is defined. */
function flag(args, name, value) {
  if (value !== undefined) args.push(name, String(value));
}

/** Push `--flag` when the condition is true. */
function push(args, name, condition) {
  if (condition === true) args.push(name);
}

/** Push a repeatable flag once per entry. */
function repeat(args, name, values) {
  for (const value of values) args.push(name, value);
}

/* ------------------------------------------------------------------------- */
/* Timeouts                                                                  */
/* ------------------------------------------------------------------------- */

function timeoutFor(tool, action, settings) {
  let cap = 120_000;
  if (tool === 'entire_search') cap = 180_000;
  else if (tool === 'entire_graph') cap = 300_000;
  else if (tool === 'entire_checkpoints' && action === 'explain') cap = 180_000;
  else if (tool === 'entire_review') cap = action === 'run' ? 1_800_000 : 300_000;
  else if (tool === 'entire_trails' && ['merge', 'checkout', 'resume'].includes(action)) cap = 300_000;

  const configured = Number.isFinite(settings?.timeoutMs) ? settings.timeoutMs : 600_000;
  return Math.min(configured, cap);
}

/* ------------------------------------------------------------------------- */
/* Builders                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Build one CLI invocation.
 *
 * @param tool - one of the `entire_*` tool names.
 * @param action - the action to build (ignored for `entire_run`).
 * @param rawInput - the model's raw arguments.
 * @param settings - resolved plugin settings.
 * @returns `{ args, timeoutMs, stdin }`.
 */
export function buildInvocation(tool, action, rawInput, settings) {
  const input = record(rawInput);

  if (tool === 'entire_run') return buildRun(input, settings);

  const allowed = ACTIONS[tool];
  if (allowed === undefined) fail(`unknown Entire tool: ${tool}`);
  if (typeof action !== 'string' || !allowed.includes(action)) {
    fail(`action must be one of ${allowed.join(', ')}`);
  }

  let args;
  let stdin;
  switch (tool) {
    case 'entire_status':
      args = buildStatus(action, input);
      break;
    case 'entire_sessions':
      args = buildSessions(action, input);
      break;
    case 'entire_checkpoints':
      args = buildCheckpoints(action, input);
      break;
    case 'entire_search':
      args = buildSearch(action, input);
      break;
    case 'entire_history':
      args = buildHistory(action, input);
      break;
    case 'entire_trails':
      args = buildTrails(action, input);
      break;
    case 'entire_review':
      args = buildReview(action, input);
      break;
    case 'entire_graph': {
      const built = buildGraph(action, input, settings);
      if (Array.isArray(built)) {
        args = built;
      } else {
        args = built.args;
        stdin = built.stdin;
      }
      break;
    }
    default:
      fail(`unknown Entire tool: ${tool}`);
  }

  return { args, timeoutMs: timeoutFor(tool, action, settings), stdin };
}

function buildRun(input, settings) {
  const argv = stringArray(input, 'argv', 'argv');
  if (argv.length === 0) fail('argv must contain at least one entry');
  const stdin = input.stdin === undefined || input.stdin === null ? undefined : String(input.stdin);
  const requested = optionalInteger(input, 'timeoutMs', 'timeoutMs', 5_000, 3_600_000);
  const configured = Number.isFinite(settings?.timeoutMs) ? settings.timeoutMs : 600_000;
  return {
    args: argv,
    timeoutMs: Math.min(requested ?? configured, 3_600_000),
    stdin
  };
}

function buildStatus(action, input) {
  switch (action) {
    case 'status': {
      if (optionalBoolean(input, 'detailed') === true) return ['status', '--detailed'];
      return ['status', '--json'];
    }
    case 'version':
      return ['version'];
    case 'doctor':
      return optionalBoolean(input, 'fix') === true ? ['doctor', '--force'] : ['doctor'];
    case 'activity':
      return optionalBoolean(input, 'commits') === true ? ['activity', '--commits'] : ['activity'];
    case 'help': {
      const command = optionalString(input, 'command');
      const tokens = command === undefined ? [] : command.split(/\s+/u);
      for (const token of tokens) {
        if (!/^[a-z0-9][a-z0-9-]*$/u.test(token)) {
          fail('command must be a space-separated path of lowercase command names');
        }
      }
      return ['agent-help', ...tokens, '--json'];
    }
    default:
      fail(`unsupported status action: ${action}`);
  }
}

function buildSessions(action, input) {
  switch (action) {
    case 'list':
      return ['session', 'list', '--json'];
    case 'current': {
      const args = ['session', 'current'];
      if (optionalBoolean(input, 'transcript') === true) args.push('--transcript');
      else args.push('--json');
      return args;
    }
    case 'info': {
      const sessionId = positional(requiredString(input, 'sessionId'), 'sessionId');
      const args = ['session', 'info', sessionId];
      if (optionalBoolean(input, 'transcript') === true) args.push('--transcript');
      else args.push('--json');
      return args;
    }
    case 'tokens': {
      const sessionId = optionalPositional(input, 'sessionId');
      const args = ['session', 'tokens'];
      if (sessionId !== undefined) args.push(sessionId);
      push(args, '--current', optionalBoolean(input, 'current') === true);
      if (optionalBoolean(input, 'agentBrief') === true) args.push('--agent-brief');
      else args.push('--json');
      return args;
    }
    case 'stop': {
      const sessionId = optionalPositional(input, 'sessionId');
      const all = optionalBoolean(input, 'all') === true;
      if (sessionId === undefined && !all) fail('sessionId or all=true is required');
      if (sessionId !== undefined && all) fail('sessionId and all=true are mutually exclusive');
      const args = ['session', 'stop'];
      if (sessionId !== undefined) args.push(sessionId);
      push(args, '--all', all);
      // The DSH approval prompt is the confirmation; the CLI must not prompt again.
      args.push('--force');
      return args;
    }
    case 'attach': {
      const sessionId = positional(requiredString(input, 'sessionId'), 'sessionId');
      const args = ['session', 'attach', sessionId, '--force'];
      flag(args, '--commit', optionalString(input, 'commit'));
      push(args, '--review', optionalBoolean(input, 'review') === true);
      return args;
    }
    case 'adopt': {
      const from = requiredString(input, 'from');
      const sessionId = optionalPositional(input, 'sessionId');
      const args = ['session', 'adopt'];
      if (sessionId !== undefined) args.push(sessionId);
      args.push('--from', from, '--yes');
      push(args, '--force', optionalBoolean(input, 'force') === true);
      return args;
    }
    case 'resume': {
      // The picker is interactive; a typed call must name its branch.
      const branch = positional(requiredString(input, 'branch'), 'branch');
      const args = ['session', 'resume', branch];
      push(args, '--force', optionalBoolean(input, 'force') === true);
      return args;
    }
    default:
      fail(`unsupported sessions action: ${action}`);
  }
}

function buildCheckpoints(action, input) {
  switch (action) {
    case 'list': {
      const pending = optionalBoolean(input, 'pending') === true;
      const outgoing = optionalBoolean(input, 'outgoing') === true;
      if (pending && outgoing) fail('pending and outgoing are mutually exclusive');
      const args = ['checkpoint', 'list', '--json'];
      push(args, '--pending', pending);
      push(args, '--outgoing', outgoing);
      flag(args, '--session', optionalString(input, 'session'));
      return args;
    }
    case 'explain': {
      const target = optionalPositional(input, 'target');
      const checkpoint = optionalString(input, 'checkpoint');
      const commit = optionalString(input, 'commit');
      const targets = [target, checkpoint, commit].filter((value) => value !== undefined);
      if (targets.length > 1) fail('target, checkpoint, and commit are mutually exclusive');
      const full = optionalBoolean(input, 'full') === true;
      const args = ['checkpoint', 'explain'];
      if (target !== undefined) args.push(target);
      flag(args, '--checkpoint', checkpoint);
      flag(args, '--commit', commit);
      flag(args, '--session', optionalString(input, 'session'));
      push(args, '--short', optionalBoolean(input, 'short') === true);
      push(args, '--full', full);
      if (!full) {
        args.push('--json');
        flag(args, '--limit', optionalInteger(input, 'limit', 'limit', 1, 1_000));
      }
      return args;
    }
    case 'tokens': {
      const id = positional(requiredString(input, 'target'), 'target');
      const args = ['checkpoint', 'tokens', id];
      if (optionalBoolean(input, 'agentBrief') === true) args.push('--agent-brief');
      else args.push('--json');
      flag(args, '--compare', optionalString(input, 'compare'));
      return args;
    }
    case 'profile': {
      const all = optionalBoolean(input, 'all') === true;
      const limit = optionalInteger(input, 'limit', 'limit', 1, 10_000);
      if (all && limit !== undefined) fail('all and limit are mutually exclusive');
      const args = ['tokens', 'profile', '--json'];
      push(args, '--all', all);
      flag(args, '--limit', limit);
      return args;
    }
    case 'delete': {
      const id = requiredString(input, 'target');
      if (!ULID_OR_HEX.test(id)) {
        fail('target must be a full checkpoint ID (12-character hex or 26-character ULID); prefixes are not accepted');
      }
      const dryRun = optionalBoolean(input, 'dryRun') !== false;
      const localOnly = optionalBoolean(input, 'localOnly') === true;
      const remote = optionalString(input, 'remote');
      if (localOnly && remote !== undefined) fail('localOnly and remote are mutually exclusive');
      const args = ['checkpoint', 'delete', id];
      if (dryRun) args.push('--dry-run');
      else args.push('--force');
      push(args, '--local-only', localOnly);
      flag(args, '--remote', remote);
      return args;
    }
    default:
      fail(`unsupported checkpoints action: ${action}`);
  }
}

function buildSearch(action, input) {
  const query = positional(requiredString(input, 'query'), 'query');
  const repos = stringArray(input, 'repo', 'repo');
  const limit = optionalInteger(input, 'limit', 'limit', 1, 100);
  const date = optionalEnum(input, 'date', 'date', ['week', 'month']);

  if (action === 'code') {
    const args = ['search', '--code', query, '--json'];
    push(args, '--case-sensitive', optionalBoolean(input, 'caseSensitive') === true);
    flag(args, '--limit', limit);
    repeat(args, '--repo', repos);
    return args;
  }

  const args = ['search', query, '--json'];
  if (optionalBoolean(input, 'compact') !== false) args.push('--compact');
  push(args, '--all-repos', optionalBoolean(input, 'allRepos') === true);
  flag(args, '--author', optionalString(input, 'author'));
  flag(args, '--branch', optionalString(input, 'branch'));
  flag(args, '--date', date);
  flag(args, '--limit', limit);
  flag(args, '--page', optionalInteger(input, 'page', 'page', 1, 1_000));
  repeat(args, '--repo', repos);
  return args;
}

function buildHistory(action, input) {
  switch (action) {
    case 'blame': {
      const file = positional(requiredString(input, 'file'), 'file');
      const args = ['blame', file, '--json'];
      flag(args, '--line', optionalString(input, 'line'));
      push(args, '--long', optionalBoolean(input, 'long') === true);
      return args;
    }
    case 'why': {
      const file = positional(requiredString(input, 'file'), 'file');
      const line = optionalString(input, 'line');
      // A file-level `why` is a concise summary; a line-level `why` is the
      // structured explanation. JSON on the file-level form would be the whole
      // blame table and is rarely what "why" is asked for.
      if (line === undefined) return ['why', file];
      return ['why', file, '--line', line, '--json'];
    }
    case 'experts': {
      const scope = optionalPositional(input, 'scope');
      const staged = optionalBoolean(input, 'staged') === true;
      if (scope === undefined && !staged) fail('scope or staged=true is required');
      const args = ['experts'];
      if (scope !== undefined) args.push(scope);
      push(args, '--staged', staged);
      flag(args, '--branch', optionalString(input, 'branch'));
      flag(args, '--limit', optionalInteger(input, 'limit', 'limit', 1, 20));
      flag(args, '--repo', optionalString(input, 'repo'));
      args.push('--json');
      return args;
    }
    case 'recap': {
      const period = optionalEnum(input, 'period', 'period', ['day', 'week', 'month', '90']);
      const args = ['recap', '--static'];
      if (period !== undefined) args.push(`--${period}`);
      flag(args, '--view', optionalEnum(input, 'view', 'view', ['you', 'team', 'both']));
      flag(args, '--agent', optionalString(input, 'agent'));
      return args;
    }
    case 'dispatch': {
      const local = optionalBoolean(input, 'local') === true;
      const allBranches = optionalBoolean(input, 'allBranches') === true;
      if (allBranches && !local) fail('allBranches requires local=true');
      const repos = stringArray(input, 'repos', 'repos');
      if (repos.length > 5) fail('repos accepts at most 5 repositories');
      const args = ['dispatch'];
      push(args, '--local', local);
      push(args, '--all-branches', allBranches);
      if (repos.length > 0) args.push('--repos', repos.join(','));
      flag(args, '--since', optionalString(input, 'since'));
      flag(args, '--until', optionalString(input, 'until'));
      flag(args, '--voice', optionalString(input, 'voice'));
      flag(args, '--jurisdiction', optionalString(input, 'jurisdiction'));
      if (optionalString(input, 'agent') !== undefined) {
        if (!local) fail('agent requires local=true');
        flag(args, '--agent', optionalString(input, 'agent'));
      }
      return args;
    }
    default:
      fail(`unsupported history action: ${action}`);
  }
}

function trailScope(args, input) {
  flag(args, '--project', optionalString(input, 'project'));
  flag(args, '--repo', optionalString(input, 'repo'));
  return args;
}

function buildTrails(action, input) {
  switch (action) {
    case 'list': {
      const project = requiredString(input, 'project');
      const args = ['trail', 'list', '--project', project, '--json'];
      flag(args, '--status', optionalEnum(input, 'status', 'status', ['open', 'closed']));
      flag(args, '--limit', optionalInteger(input, 'limit', 'limit', 1, 100));
      flag(args, '--page-token', optionalString(input, 'pageToken'));
      return args;
    }
    case 'show': {
      const args = trailScope(['trail', 'show'], input);
      const trail = optionalPositional(input, 'trail');
      if (trail !== undefined) args.push(trail);
      flag(args, '--branch', optionalString(input, 'branch'));
      args.push('--json');
      return args;
    }
    case 'approvals': {
      const args = trailScope(['trail', 'approvals'], input);
      const trail = optionalPositional(input, 'trail');
      if (trail !== undefined) args.push(trail);
      flag(args, '--branch', optionalString(input, 'branch'));
      args.push('--json');
      return args;
    }
    case 'findings': {
      const args = trailScope(['trail', 'finding', 'list'], input);
      const trail = optionalPositional(input, 'trail');
      if (trail !== undefined) args.push(trail);
      flag(args, '--branch', optionalString(input, 'branch'));
      flag(args, '--status', optionalString(input, 'findingStatus'));
      flag(args, '--severity', optionalString(input, 'severity'));
      flag(args, '--freshness', optionalEnum(input, 'freshness', 'freshness', ['current', 'stale', 'any']));
      push(args, '--include-dismissed', optionalBoolean(input, 'includeDismissed') === true);
      flag(args, '--limit', optionalInteger(input, 'limit', 'limit', 1, 1_000));
      flag(args, '--cursor', optionalString(input, 'cursor'));
      args.push('--json');
      return args;
    }
    case 'create': {
      const title = requiredString(input, 'title');
      const args = trailScope(['trail', 'create', '--title', title, '--json'], input);
      flag(args, '--body', optionalString(input, 'body'));
      flag(args, '--type', optionalEnum(input, 'type', 'type', ['bug', 'feature', 'task']));
      flag(args, '--priority', optionalEnum(input, 'priority', 'priority', ['urgent', 'high', 'medium', 'low', 'none']));
      flag(args, '--base', optionalString(input, 'base'));
      flag(args, '--branch', optionalString(input, 'branch'));
      flag(args, '--branch-action', optionalEnum(input, 'branchAction', 'branchAction', ['link', 'create']));
      push(args, '--no-branch', optionalBoolean(input, 'noBranch') === true);
      return args;
    }
    case 'update': {
      const trail = positional(requiredString(input, 'trail'), 'trail');
      const args = trailScope(['trail', 'update', trail, '--json'], input);
      flag(args, '--title', optionalString(input, 'title'));
      flag(args, '--body', optionalString(input, 'body'));
      flag(args, '--status', optionalEnum(input, 'status', 'status', ['open', 'closed']));
      flag(args, '--priority', optionalEnum(input, 'priority', 'priority', ['urgent', 'high', 'medium', 'low', 'none']));
      flag(args, '--type', optionalEnum(input, 'type', 'type', ['bug', 'feature', 'task']));
      repeat(args, '--assignee', stringArray(input, 'assignees', 'assignees'));
      repeat(args, '--add-assignee', stringArray(input, 'addAssignees', 'addAssignees'));
      repeat(args, '--remove-assignee', stringArray(input, 'removeAssignees', 'removeAssignees'));
      flag(args, '--branch', optionalString(input, 'branch'));
      return args;
    }
    case 'comment': {
      const message = requiredString(input, 'message');
      const args = trailScope(['trail', 'comment', 'add', '--body', message], input);
      flag(args, '--title', optionalString(input, 'title'));
      flag(args, '--trail', optionalString(input, 'trail'));
      flag(args, '--branch', optionalString(input, 'branch'));
      args.push('--json');
      return args;
    }
    case 'approve': {
      const args = trailScope(['trail', 'approve'], input);
      const trail = optionalPositional(input, 'trail');
      if (trail !== undefined) args.push(trail);
      flag(args, '--branch', optionalString(input, 'branch'));
      flag(args, '-m', optionalString(input, 'message'));
      return args;
    }
    case 'link': {
      const trail = positional(requiredString(input, 'trail'), 'trail');
      const args = trailScope(['trail', 'link', trail, '--json'], input);
      flag(args, '--base', optionalString(input, 'base'));
      flag(args, '--branch', optionalString(input, 'branch'));
      flag(args, '--branch-action', optionalEnum(input, 'branchAction', 'branchAction', ['link', 'create']));
      flag(args, '--status', optionalEnum(input, 'status', 'status', ['open', 'closed']));
      flag(args, '--idempotency-key', optionalString(input, 'idempotencyKey'));
      return args;
    }
    case 'unlink': {
      const args = trailScope(['trail', 'unlink'], input);
      const trail = optionalPositional(input, 'trail');
      if (trail !== undefined) args.push(trail);
      flag(args, '--branch', optionalString(input, 'branch'));
      return args;
    }
    case 'checkout': {
      const args = trailScope(['trail', 'checkout'], input);
      const trail = optionalPositional(input, 'trail');
      if (trail !== undefined) args.push(trail);
      flag(args, '--branch', optionalString(input, 'branch'));
      push(args, '--worktree', optionalBoolean(input, 'worktree') === true);
      push(args, '-f', optionalBoolean(input, 'force') === true);
      return args;
    }
    case 'resume': {
      const args = trailScope(['trail', 'resume'], input);
      const trail = optionalPositional(input, 'trail');
      if (trail !== undefined) args.push(trail);
      flag(args, '--branch', optionalString(input, 'branch'));
      flag(args, '--checkpoint', optionalString(input, 'checkpoint'));
      flag(args, '--session', optionalString(input, 'session'));
      push(args, '--no-resume', optionalBoolean(input, 'noResume') === true);
      args.push('--json');
      return args;
    }
    case 'merge': {
      const dryRun = optionalBoolean(input, 'dryRun') !== false;
      const args = trailScope(['trail', 'merge'], input);
      const trail = optionalPositional(input, 'trail');
      if (trail !== undefined) args.push(trail);
      flag(args, '--branch', optionalString(input, 'branch'));
      args.push('--json');
      if (dryRun) args.push('--dry-run');
      else args.push('--yes');
      push(args, '--force', optionalBoolean(input, 'force') === true);
      const deleteBranch = optionalBoolean(input, 'deleteBranch');
      if (deleteBranch === true) args.push('--delete-branch');
      if (deleteBranch === false) args.push('--no-delete-branch');
      return args;
    }
    default:
      fail(`unsupported trails action: ${action}`);
  }
}

function buildReview(action, input) {
  switch (action) {
    case 'list':
      return ['review', '--list'];
    case 'agents': {
      const args = ['review', '--agents'];
      flag(args, '--profile', optionalString(input, 'profile'));
      return args;
    }
    case 'models': {
      const args = ['review', '--models'];
      flag(args, '--agent', optionalString(input, 'agent'));
      return args;
    }
    case 'findings': {
      const args = ['review', '--findings'];
      const handle = optionalString(input, 'handle');
      if (handle !== undefined) args.push(handle);
      return args;
    }
    case 'run': {
      const args = ['review'];
      flag(args, '--profile', optionalString(input, 'profile'));
      flag(args, '--agent', optionalString(input, 'agent'));
      flag(args, '--model', optionalString(input, 'model'));
      flag(args, '--base', optionalString(input, 'base'));
      flag(args, '--target', optionalString(input, 'target'));
      flag(args, '--prompt', optionalString(input, 'prompt'));
      flag(args, '--timeout', optionalString(input, 'timeout'));
      return args;
    }
    case 'configure': {
      const setAgents = requiredString(input, 'setAgents');
      const setJudge = requiredString(input, 'setJudge');
      const args = ['review', '--configure', '--set-agents', setAgents, '--set-judge', setJudge];
      flag(args, '--profile', optionalString(input, 'profile'));
      flag(args, '--set-output', optionalEnum(input, 'setOutput', 'setOutput', ['local', 'trail']));
      push(args, '--local', optionalBoolean(input, 'local') === true);
      flag(args, '--set-task', optionalString(input, 'setTask'));
      repeat(args, '--set-model', stringArray(input, 'setModel', 'setModel'));
      repeat(args, '--set-slot', stringArray(input, 'setSlot', 'setSlot'));
      return args;
    }
    default:
      fail(`unsupported review action: ${action}`);
  }
}

function graphRepo(args, settings) {
  if (typeof settings?.repoPath === 'string' && settings.repoPath !== '') {
    args.push('--repo', settings.repoPath);
  }
  return args;
}

function graphFormat(action, value) {
  if (value === undefined) return undefined;
  const allowed =
    action === 'query'
      ? ['text', 'json', 'ndjson', 'agent']
      : action === 'explain'
        ? ['text', 'json', 'agent']
        : ['text', 'json'];
  if (!allowed.includes(value)) fail(`format must be one of ${allowed.join(', ')} for graph ${action}`);
  return value;
}

function buildGraph(action, input, settings) {
  const format = graphFormat(action, optionalEnum(input, 'format', 'format', ['text', 'json', 'ndjson', 'agent']));

  switch (action) {
    case 'query': {
      const query = requiredString(input, 'query');
      const args = graphRepo(['graph', 'query', '--query', query], settings);
      flag(args, '--top-k', optionalInteger(input, 'topK', 'topK', 1, 50));
      flag(args, '--format', format);
      push(args, '--deep', optionalBoolean(input, 'deep') === true);
      return args;
    }
    case 'neighbors': {
      const symbol = positional(requiredString(input, 'symbol'), 'symbol');
      const args = graphRepo(['graph', 'neighbors', '--symbol', symbol], settings);
      flag(args, '--relation', optionalString(input, 'relation'));
      flag(args, '--direction', optionalEnum(input, 'direction', 'direction', ['both', 'in', 'out']));
      flag(args, '--depth', optionalInteger(input, 'depth', 'depth', 1, 2));
      flag(args, '--limit', optionalInteger(input, 'limit', 'limit', 1, 100));
      flag(args, '--file', optionalString(input, 'file'));
      flag(args, '--line', optionalString(input, 'line'));
      flag(args, '--kind', optionalString(input, 'kind'));
      return args;
    }
    case 'impact': {
      const symbol = positional(requiredString(input, 'symbol'), 'symbol');
      const args = graphRepo(['graph', 'impact', '--symbol', symbol], settings);
      flag(args, '--depth', optionalInteger(input, 'depth', 'depth', 1, 2));
      flag(args, '--limit', optionalInteger(input, 'limit', 'limit', 1, 100));
      flag(args, '--format', format);
      flag(args, '--file', optionalString(input, 'file'));
      flag(args, '--line', optionalString(input, 'line'));
      flag(args, '--kind', optionalString(input, 'kind'));
      return args;
    }
    case 'def': {
      const symbol = positional(requiredString(input, 'symbol'), 'symbol');
      const args = graphRepo(['graph', 'def', symbol], settings);
      flag(args, '--members', optionalInteger(input, 'members', 'members', 1, 100));
      flag(args, '--format', format);
      flag(args, '--file', optionalString(input, 'file'));
      flag(args, '--line', optionalString(input, 'line'));
      flag(args, '--kind', optionalString(input, 'kind'));
      return args;
    }
    case 'explain': {
      const args = graphRepo(['graph', 'explain', '--format', format ?? 'json'], settings);
      const stdin = input.input === undefined || input.input === null ? undefined : String(input.input);
      return { args, stdin };
    }
    case 'context': {
      const task = requiredString(input, 'task');
      const args = graphRepo(['graph', 'context', '--task', task], settings);
      flag(args, '--limit', optionalInteger(input, 'limit', 'limit', 1, 100));
      flag(args, '--tests-limit', optionalInteger(input, 'testsLimit', 'testsLimit', 1, 100));
      return args;
    }
    case 'commit': {
      const args = graphRepo(['graph', 'commit'], settings);
      const rev = optionalPositional(input, 'rev');
      if (rev !== undefined) args.push(rev);
      args.push('--json');
      flag(args, '--max-seconds', optionalInteger(input, 'maxSeconds', 'maxSeconds', 0, 3_600));
      return args;
    }
    case 'diff': {
      const args = graphRepo(['graph', 'diff', '--json'], settings);
      flag(args, '--base', optionalString(input, 'base'));
      flag(args, '--head', optionalString(input, 'head'));
      flag(args, '--max-seconds', optionalInteger(input, 'maxSeconds', 'maxSeconds', 0, 3_600));
      return args;
    }
    case 'checkpoint': {
      const id = positional(requiredString(input, 'checkpoint'), 'checkpoint');
      return graphRepo(['graph', 'checkpoint', id, '--json'], settings);
    }
    case 'capabilities':
      return graphRepo(['graph', 'capabilities', '--json'], settings);
    case 'health':
      return graphRepo(['graph', 'health', '--json'], settings);
    case 'agent-guide': {
      const args = graphRepo(['graph', 'agent-guide'], settings);
      if (optionalBoolean(input, 'strict') === true) args.push('--strict');
      else push(args, '--normal', optionalBoolean(input, 'normal') === true);
      return args;
    }
    case 'setup': {
      const args = graphRepo(['graph', 'setup'], settings);
      if (optionalBoolean(input, 'strict') === true) args.push('--strict');
      else push(args, '--normal', optionalBoolean(input, 'normal') === true);
      return args;
    }
    case 'index': {
      const args = graphRepo(['graph', 'index', '--head', '--format', 'json'], settings);
      push(args, '--force', optionalBoolean(input, 'force') === true);
      return args;
    }
    case 'verify': {
      const test = requiredString(input, 'test');
      const args = graphRepo(['graph', 'verify', '--test', test], settings);
      flag(args, '--setup', optionalString(input, 'setup'));
      flag(args, '--record-baseline', optionalString(input, 'recordBaseline'));
      flag(args, '--pre-edit-baseline', optionalString(input, 'preEditBaseline'));
      return args;
    }
    default:
      fail(`unsupported graph action: ${action}`);
  }
}
