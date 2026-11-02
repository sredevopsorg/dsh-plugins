/**
 * Model-facing tool definitions.
 *
 * Each tool is a thin, typed surface over one or more Entire CLI commands. The
 * executor provided by `index.js` owns cwd resolution, spawning, truncation,
 * and approval; this module owns only schemas, descriptions, and presentation.
 */

import { policyForCall } from './policy.js';

const OUTPUT = Object.freeze({
  schema: { type: 'string' },
  render: (_args, value) => [
    { type: 'text', text: typeof value === 'string' ? value : String(value) }
  ]
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function actionSchema(actions) {
  return {
    type: 'string',
    enum: actions,
    description: 'The action to run.'
  };
}

function callView(tool, args) {
  const input = isRecord(args) ? args : {};
  const policy = policyForCall(tool, input);
  const action = typeof input.action === 'string' ? input.action : 'run';
  const label = tool === 'entire_run'
    ? `run ${Array.isArray(input.argv) ? input.argv.slice(0, 3).join(' ') : ''}`.trim()
    : action;
  const view = {
    card: 'generic',
    title: `Entire: ${label}`,
    kind: policy.kind === 'read' ? 'read' : 'execute',
    rawInput: args
  };

  if (tool === 'entire_history' && (action === 'blame' || action === 'why')) {
    const file = typeof input.file === 'string' ? input.file : undefined;
    if (file !== undefined) {
      const rawLine = typeof input.line === 'string' ? input.line.split('-')[0] : undefined;
      const line = rawLine !== undefined && /^\d+$/u.test(rawLine) ? Number(rawLine) : undefined;
      view.locations = [line === undefined ? { path: file } : { path: file, line }];
    }
  }
  return view;
}

function safeForConcurrency(tool, args) {
  return policyForCall(tool, args).kind === 'read';
}

/**
 * Build the nine tool definitions.
 *
 * @param invoke - `(tool, args, exec) => Promise<string>` owned by `index.js`.
 */
export function createTools(invoke) {
  const definitions = [
    {
      name: 'entire_status',
      description:
        'Inspect Entire in the current repository: whether capture is enabled, the CLI version, diagnostics, account activity, and the installed CLI\'s live agent-facing help. ' +
        'Actions: status, version, doctor, activity, help. Reads only, except doctor with fix=true.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: actionSchema(['status', 'version', 'doctor', 'activity', 'help']),
          detailed: {
            type: 'boolean',
            description: 'status only: include per-settings detail. Uses text output and cannot be combined with JSON.'
          },
          fix: {
            type: 'boolean',
            description: 'doctor only: apply the fixes it finds. Requires allowWrites and approval.'
          },
          commits: {
            type: 'boolean',
            description: 'activity only: show recent commits instead of recent sessions.'
          },
          command: {
            type: 'string',
            description: 'help only: a space-separated command path such as "checkpoint list". Omit for the top-level map.'
          }
        }
      },
      output: OUTPUT,
      presentCall: (args) => callView('entire_status', args),
      isConcurrencySafe: (args) => safeForConcurrency('entire_status', args),
      execute: (args, exec) => invoke('entire_status', args, exec)
    },
    {
      name: 'entire_sessions',
      description:
        'List, inspect, resume, adopt, attach, or stop Entire agent sessions. ' +
        'Reads return metadata or transcript bytes; stop, attach, adopt, and resume require allowWrites and approval. ' +
        'Actions: list, current, info, tokens, stop, attach, adopt, resume.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: actionSchema(['list', 'current', 'info', 'tokens', 'stop', 'attach', 'adopt', 'resume']),
          sessionId: {
            type: 'string',
            description: 'Session ID. Required for info and attach; optional for tokens, adopt, and stop.'
          },
          transcript: {
            type: 'boolean',
            description: 'current/info only: return the raw transcript bytes instead of metadata. Large; output is truncated.'
          },
          current: {
            type: 'boolean',
            description: 'tokens only: prefer the current worktree\'s most recent session.'
          },
          agentBrief: {
            type: 'boolean',
            description: 'tokens only: return compact next-step guidance instead of JSON.'
          },
          all: {
            type: 'boolean',
            description: 'stop only: stop every active session. Mutually exclusive with sessionId.'
          },
          commit: {
            type: 'string',
            description: 'attach only: link the session to this commit ref instead of HEAD.'
          },
          review: {
            type: 'boolean',
            description: 'attach only: tag the session as an agent review.'
          },
          from: {
            type: 'string',
            description: 'adopt only: source worktree that already tracks the session. Required.'
          },
          branch: {
            type: 'string',
            description: 'resume only: branch to switch to and resume. Required.'
          },
          force: {
            type: 'boolean',
            description: 'adopt/resume only: replace existing session state or resume from an older checkpoint.'
          }
        }
      },
      output: OUTPUT,
      presentCall: (args) => callView('entire_sessions', args),
      isConcurrencySafe: (args) => safeForConcurrency('entire_sessions', args),
      execute: (args, exec) => invoke('entire_sessions', args, exec)
    },
    {
      name: 'entire_checkpoints',
      description:
        'List, explain, measure, or delete Entire checkpoints linked to commits. ' +
        'Reads return JSON metadata or the human explanation; delete defaults to a dry run and requires allowWrites when real. ' +
        'Actions: list, explain, tokens, profile, delete.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: actionSchema(['list', 'explain', 'tokens', 'profile', 'delete']),
          target: {
            type: 'string',
            description: 'explain: checkpoint ID or commit SHA to explain. tokens: checkpoint ID. delete: full checkpoint ID (12-hex or 26-char ULID).'
          },
          checkpoint: {
            type: 'string',
            description: 'explain only: force interpretation as a checkpoint ID.'
          },
          commit: {
            type: 'string',
            description: 'explain only: force interpretation as a commit ref.'
          },
          session: {
            type: 'string',
            description: 'list/explain only: filter by session ID or prefix.'
          },
          short: {
            type: 'boolean',
            description: 'explain only: summary without prompts and files.'
          },
          full: {
            type: 'boolean',
            description: 'explain only: include the full parsed transcript. Large and not JSON.'
          },
          pending: {
            type: 'boolean',
            description: 'list only: show pending work instead of condensed checkpoints.'
          },
          outgoing: {
            type: 'boolean',
            description: 'list only: show checkpoints the next push sends. Mutually exclusive with pending.'
          },
          compare: {
            type: 'string',
            description: 'tokens only: baseline checkpoint ID to compare against.'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 1000,
            description: 'explain list view or token profile: maximum entries.'
          },
          all: {
            type: 'boolean',
            description: 'profile only: analyze every committed checkpoint instead of the latest 50.'
          },
          dryRun: {
            type: 'boolean',
            default: true,
            description: 'delete only: report what would be deleted. Set false to delete, which requires allowWrites and approval.'
          },
          localOnly: {
            type: 'boolean',
            description: 'delete only: do not contact checkpoint remotes.'
          },
          remote: {
            type: 'string',
            description: 'delete only: restrict deletion to one checkpoint remote.'
          }
        }
      },
      output: OUTPUT,
      presentCall: (args) => callView('entire_checkpoints', args),
      isConcurrencySafe: (args) => safeForConcurrency('entire_checkpoints', args),
      execute: (args, exec) => invoke('entire_checkpoints', args, exec)
    },
    {
      name: 'entire_search',
      description:
        'Search Entire\'s indexed agent work (checkpoints, commits, sessions) or source code across repositories. ' +
        'Needs an authenticated Entire login; results are returned as agent-shaped JSON. ' +
        'Actions: work, code.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'query'],
        properties: {
          action: actionSchema(['work', 'code']),
          query: {
            type: 'string',
            description: 'Search text. Inline filters such as author:<name>, date:<week|month>, branch:<name>, and repo:<owner/name> are supported.'
          },
          allRepos: {
            type: 'boolean',
            description: 'work only: search every accessible repository.'
          },
          author: {
            type: 'string',
            description: 'work only: filter by author name.'
          },
          branch: {
            type: 'string',
            description: 'work only: filter by branch name.'
          },
          date: {
            type: 'string',
            enum: ['week', 'month'],
            description: 'work only: filter by time period.'
          },
          repo: {
            type: 'array',
            items: { type: 'string' },
            description: 'Repository filters such as gh/owner/repo or owner/repo. Repeatable.'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'Maximum results.'
          },
          page: {
            type: 'integer',
            minimum: 1,
            maximum: 1000,
            description: 'work only: result page (1-based).'
          },
          compact: {
            type: 'boolean',
            default: true,
            description: 'work only: request the trimmed agent result shape.'
          },
          caseSensitive: {
            type: 'boolean',
            description: 'code only: case-sensitive matching.'
          }
        }
      },
      output: OUTPUT,
      presentCall: (args) => callView('entire_search', args),
      isConcurrencySafe: (args) => safeForConcurrency('entire_search', args),
      execute: (args, exec) => invoke('entire_search', args, exec)
    },
    {
      name: 'entire_history',
      description:
        'Explain why code exists: line blame with checkpoint metadata, a focused why, provenance experts, activity recaps, and dispatches. ' +
        'Actions: blame, why, experts, recap, dispatch. Reads only.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: actionSchema(['blame', 'why', 'experts', 'recap', 'dispatch']),
          file: {
            type: 'string',
            description: 'blame/why: repository-relative file. Append :line or use line.'
          },
          line: {
            type: 'string',
            description: 'blame/why: a line or range such as "12" or "12-20". Omit for a file-level why summary.'
          },
          long: {
            type: 'boolean',
            description: 'blame only: show the full table with agent, model, author, and session columns.'
          },
          scope: {
            type: 'string',
            description: 'experts: file, directory, or natural-language query.'
          },
          staged: {
            type: 'boolean',
            description: 'experts: use the staged file paths as scopes.'
          },
          branch: {
            type: 'string',
            description: 'experts: branch to inspect.'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'experts only: maximum provenance profiles.'
          },
          repo: {
            type: 'string',
            description: 'experts only: repository as owner/repo.'
          },
          period: {
            type: 'string',
            enum: ['day', 'week', 'month', '90'],
            description: 'recap only: time window. Defaults to today.'
          },
          view: {
            type: 'string',
            enum: ['you', 'team', 'both'],
            description: 'recap only: which columns to show.'
          },
          agent: {
            type: 'string',
            description: 'recap: agent ID. dispatch: local text-generation agent; requires local=true.'
          },
          local: {
            type: 'boolean',
            description: 'dispatch only: generate with a locally installed agent instead of the Entire server.'
          },
          allBranches: {
            type: 'boolean',
            description: 'dispatch only: include every local branch. Requires local=true.'
          },
          repos: {
            type: 'array',
            items: { type: 'string' },
            description: 'dispatch only: up to five cloud repo slugs such as gh/owner/repo.'
          },
          since: {
            type: 'string',
            description: 'dispatch only: window start (Go duration, relative time, or ISO date). Defaults to 7d.'
          },
          until: {
            type: 'string',
            description: 'dispatch only: window end. Defaults to now.'
          },
          voice: {
            type: 'string',
            description: 'dispatch only: voice preset name or literal description.'
          },
          jurisdiction: {
            type: 'string',
            description: 'dispatch only: jurisdiction slug such as us or eu.'
          }
        }
      },
      output: OUTPUT,
      presentCall: (args) => callView('entire_history', args),
      isConcurrencySafe: (args) => safeForConcurrency('entire_history', args),
      execute: (args, exec) => invoke('entire_history', args, exec)
    },
    {
      name: 'entire_trails',
      description:
        'Read and manage Entire trails: project intent spanning repositories and branches. ' +
        'Reads return JSON; writes require allowWrites and approval. merge and dry-run defaults protect destructive work. ' +
        'Actions: list, show, approvals, findings, create, update, comment, approve, link, unlink, checkout, resume, merge.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: actionSchema(['list', 'show', 'approvals', 'findings', 'create', 'update', 'comment', 'approve', 'link', 'unlink', 'checkout', 'resume', 'merge']),
          trail: {
            type: 'string',
            description: 'Trail selector (project trail number/ID or <repo>/<number>). Required for update and link; optional elsewhere.'
          },
          project: {
            type: 'string',
            description: 'Project as gh/<owner> or et/<project>. Required for list.'
          },
          repo: {
            type: 'string',
            description: 'Repository selector as forge/owner/repo or a clone URL.'
          },
          branch: {
            type: 'string',
            description: 'Repository branch within the trail.'
          },
          status: {
            type: 'string',
            enum: ['open', 'closed'],
            description: 'list/update only: trail lifecycle status.'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 1000,
            description: 'list/findings: page size.'
          },
          pageToken: {
            type: 'string',
            description: 'list only: continue from this nextPageToken.'
          },
          cursor: {
            type: 'string',
            description: 'findings only: continue from a previous page cursor.'
          },
          findingStatus: {
            type: 'string',
            description: 'findings only: open, resolved, dismissed, or any (comma-separated allowed).'
          },
          severity: {
            type: 'string',
            description: 'findings only: comma-separated severities (high, medium, low).'
          },
          freshness: {
            type: 'string',
            enum: ['current', 'stale', 'any'],
            description: 'findings only: code-version freshness filter.'
          },
          includeDismissed: {
            type: 'boolean',
            description: 'findings only: include dismissed findings.'
          },
          title: {
            type: 'string',
            description: 'create/update/comment: title.'
          },
          body: {
            type: 'string',
            description: 'create/update: trail description.'
          },
          type: {
            type: 'string',
            enum: ['bug', 'feature', 'task'],
            description: 'create/update: trail type.'
          },
          priority: {
            type: 'string',
            enum: ['urgent', 'high', 'medium', 'low', 'none'],
            description: 'create/update: priority.'
          },
          base: {
            type: 'string',
            description: 'create/link only: base branch for new code work.'
          },
          branchAction: {
            type: 'string',
            enum: ['link', 'create'],
            description: 'create/link only: link existing remote work or create a branch.'
          },
          noBranch: {
            type: 'boolean',
            description: 'create only: create intent without a branch.'
          },
          message: {
            type: 'string',
            description: 'comment: discussion body. approve: approval comment.'
          },
          assignees: {
            type: 'array',
            items: { type: 'string' },
            description: 'update only: replacement assignee list.'
          },
          addAssignees: {
            type: 'array',
            items: { type: 'string' },
            description: 'update only: assignees to add.'
          },
          removeAssignees: {
            type: 'array',
            items: { type: 'string' },
            description: 'update only: assignees to remove.'
          },
          idempotencyKey: {
            type: 'string',
            description: 'link only: retry key for linking a branch.'
          },
          worktree: {
            type: 'boolean',
            description: 'checkout only: check out under .entire/worktrees instead of switching this checkout.'
          },
          force: {
            type: 'boolean',
            description: 'checkout/merge only: skip prompts. For merge, bypassing gates needs repository permission.'
          },
          checkpoint: {
            type: 'string',
            description: 'resume only: resume a specific checkpoint on the trail branch.'
          },
          session: {
            type: 'string',
            description: 'resume only: resume a specific known local session.'
          },
          noResume: {
            type: 'boolean',
            description: 'resume only: show resume context without restoring a session.'
          },
          deleteBranch: {
            type: 'boolean',
            description: 'merge only: delete the trail branch after merging (or keep it when false).'
          },
          dryRun: {
            type: 'boolean',
            default: true,
            description: 'merge only: only check whether the trail can merge. Set false to merge, which requires allowWrites and approval.'
          }
        }
      },
      output: OUTPUT,
      presentCall: (args) => callView('entire_trails', args),
      isConcurrencySafe: (args) => safeForConcurrency('entire_trails', args),
      execute: (args, exec) => invoke('entire_trails', args, exec)
    },
    {
      name: 'entire_review',
      description:
        'Run or inspect Entire\'s multi-agent branch reviews and saved review profiles. ' +
        'run launches reviewer agents and configure writes a profile; both require allowWrites and approval. ' +
        'Actions: list, agents, models, findings, run, configure.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: actionSchema(['list', 'agents', 'models', 'findings', 'run', 'configure']),
          profile: {
            type: 'string',
            description: 'agents/run: named review profile.'
          },
          agent: {
            type: 'string',
            description: 'models/run: reviewer agent name.'
          },
          model: {
            type: 'string',
            description: 'run only: override the model for the selected reviewer.'
          },
          base: {
            type: 'string',
            description: 'run only: scope against this ref instead of the default mainline.'
          },
          target: {
            type: 'string',
            description: 'run only: branch name, trail ID, or Entire trail URL to check out and review.'
          },
          prompt: {
            type: 'string',
            description: 'run only: one-off per-run instructions.'
          },
          timeout: {
            type: 'string',
            description: 'run only: hard cap per reviewer, such as "20m".'
          },
          handle: {
            type: 'string',
            description: 'findings only: saved-run handle to print.'
          },
          setAgents: {
            type: 'string',
            description: 'configure only: comma-separated reviewer agents. Required.'
          },
          setJudge: {
            type: 'string',
            description: 'configure only: consolidating judge as agent[=model]. Required.'
          },
          setOutput: {
            type: 'string',
            enum: ['local', 'trail'],
            description: 'configure only: where the verdict goes.'
          },
          setTask: {
            type: 'string',
            description: 'configure only: canonical task text.'
          },
          setModel: {
            type: 'array',
            items: { type: 'string' },
            description: 'configure only: per-reviewer model as agent=model. Repeatable.'
          },
          setSlot: {
            type: 'array',
            items: { type: 'string' },
            description: 'configure only: reviewer slot as agent[=model]. Repeatable.'
          },
          local: {
            type: 'boolean',
            description: 'configure only: save to .entire/settings.local.json instead of the shared settings.'
          }
        }
      },
      output: OUTPUT,
      presentCall: (args) => callView('entire_review', args),
      isConcurrencySafe: (args) => safeForConcurrency('entire_review', args),
      execute: (args, exec) => invoke('entire_review', args, exec)
    },
    {
      name: 'entire_graph',
      description:
        'Query Entire\'s deterministic code graph: task search, symbols, callers, impact, structural definitions, entity-level diffs, and test verification. ' +
        'setup, index, and verify write state; verify executes the test command you pass and requires allowWrites plus approval. ' +
        'Read actions: query, neighbors, impact, def, explain, context, commit, diff, checkpoint, capabilities, health, agent-guide.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: actionSchema(['query', 'neighbors', 'impact', 'def', 'explain', 'context', 'commit', 'diff', 'checkpoint', 'capabilities', 'health', 'agent-guide', 'setup', 'index', 'verify']),
          query: {
            type: 'string',
            description: 'query only: plain-language task or bug description.'
          },
          topK: {
            type: 'integer',
            minimum: 1,
            maximum: 50,
            description: 'query only: maximum normal results.'
          },
          deep: {
            type: 'boolean',
            description: 'query only: add the exhaustive sparse pass. Slower.'
          },
          symbol: {
            type: 'string',
            description: 'neighbors/impact/def: NAME or <file>:<line>.'
          },
          file: {
            type: 'string',
            description: 'Disambiguate an ambiguous symbol by file.'
          },
          line: {
            type: 'string',
            description: 'Disambiguate an ambiguous symbol by line.'
          },
          kind: {
            type: 'string',
            description: 'Disambiguate an ambiguous symbol by kind.'
          },
          relation: {
            type: 'string',
            description: 'neighbors only: relation family such as CALLS.'
          },
          direction: {
            type: 'string',
            enum: ['both', 'in', 'out'],
            description: 'neighbors only: caller vs callee direction.'
          },
          depth: {
            type: 'integer',
            enum: [1, 2],
            description: 'neighbors/impact: traversal depth.'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'Maximum entries per section.'
          },
          format: {
            type: 'string',
            enum: ['text', 'json', 'ndjson', 'agent'],
            description: 'Output format for graph reads.'
          },
          input: {
            type: 'string',
            description: 'explain only: build or test output whose symbols should be resolved.'
          },
          task: {
            type: 'string',
            description: 'context only: task text to find context for. Required.'
          },
          testsLimit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'context only: maximum test suggestions.'
          },
          rev: {
            type: 'string',
            description: 'commit only: commit to analyze. Defaults to HEAD.'
          },
          base: {
            type: 'string',
            description: 'diff only: base revision. Defaults to HEAD~1.'
          },
          head: {
            type: 'string',
            description: 'diff only: head revision. Defaults to HEAD.'
          },
          checkpoint: {
            type: 'string',
            description: 'checkpoint only: checkpoint ID whose commit should be analyzed. Required.'
          },
          maxSeconds: {
            type: 'integer',
            minimum: 0,
            maximum: 3600,
            description: 'commit/diff only: analysis budget in seconds; 0 means unlimited.'
          },
          members: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'def only: maximum members listed per group.'
          },
          strict: {
            type: 'boolean',
            description: 'setup/agent-guide only: use strict guidance instead of normal.'
          },
          normal: {
            type: 'boolean',
            description: 'setup/agent-guide only: use normal guidance.'
          },
          force: {
            type: 'boolean',
            description: 'index only: rebuild from scratch even when the tree is unchanged.'
          },
          test: {
            type: 'string',
            description: 'verify only: test command to run. Entire executes this command; only pass commands you intend to run.'
          },
          setup: {
            type: 'string',
            description: 'verify only: command run before the tests. Its output does not contribute test IDs.'
          },
          recordBaseline: {
            type: 'string',
            description: 'verify only: write the pristine-tree result to this path instead of adjudicating.'
          },
          preEditBaseline: {
            type: 'string',
            description: 'verify only: baseline file from the pristine tree to compare against.'
          }
        }
      },
      output: OUTPUT,
      presentCall: (args) => callView('entire_graph', args),
      isConcurrencySafe: (args) => safeForConcurrency('entire_graph', args),
      execute: (args, exec) => invoke('entire_graph', args, exec)
    },
    {
      name: 'entire_run',
      description:
        'Run an Entire CLI command that the typed tools do not cover, such as setup, plugins, auth status, organizations, projects, repositories, imports, or the authenticated API. ' +
        'Pass argv without the leading "entire". Read-only commands run by default; task-driven commands need allowWrites; machine/account/control-plane commands need allowAdmin. ' +
        'Interactive logins, the MCP server, and shell completion are refused. Use the typed tools for their actions instead of this passthrough.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['argv'],
        properties: {
          argv: {
            type: 'array',
            minItems: 1,
            items: { type: 'string' },
            description: 'Command and flags as separate entries, for example ["plugin","list"] or ["api","/api/v1/clusters"].'
          },
          stdin: {
            type: 'string',
            description: 'Optional stdin payload, for commands that read a body or build output.'
          },
          timeoutMs: {
            type: 'integer',
            minimum: 5000,
            maximum: 3600000,
            description: 'Optional timeout for this call. Defaults to the plugin timeout.'
          }
        }
      },
      output: OUTPUT,
      presentCall: (args) => callView('entire_run', args),
      isConcurrencySafe: (args) => safeForConcurrency('entire_run', args),
      execute: (args, exec) => invoke('entire_run', args, exec)
    }
  ];

  return definitions;
}
