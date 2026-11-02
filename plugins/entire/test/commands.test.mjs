import assert from 'node:assert/strict';
import test from 'node:test';

import { ACTIONS, buildInvocation } from '../lib/commands.js';
import { resolveConfig } from '../lib/config.js';

const settings = resolveConfig({});

function args(tool, action, input, overrides) {
  return buildInvocation(tool, action, input, overrides ?? settings).args;
}

test('every tool exposes a non-empty action list except the passthrough', () => {
  for (const [tool, list] of Object.entries(ACTIONS)) {
    if (tool === 'entire_run') assert.equal(list.length, 0);
    else assert.ok(list.length > 0, `${tool} has actions`);
  }
});

test('status uses JSON unless detail is requested', () => {
  assert.deepEqual(args('entire_status', 'status', {}), ['status', '--json']);
  assert.deepEqual(args('entire_status', 'status', { detailed: true }), ['status', '--detailed']);
  assert.deepEqual(args('entire_status', 'doctor', {}), ['doctor']);
  assert.deepEqual(args('entire_status', 'doctor', { fix: true }), ['doctor', '--force']);
  assert.deepEqual(args('entire_status', 'help', { command: 'checkpoint list' }), [
    'agent-help',
    'checkpoint',
    'list',
    '--json'
  ]);
});

test('help rejects a command path that is not a lowercase command name', () => {
  assert.throws(() => args('entire_status', 'help', { command: '--force' }), /lowercase/u);
});

test('sessions builds reads and gated writes', () => {
  assert.deepEqual(args('entire_sessions', 'list', {}), ['session', 'list', '--json']);
  assert.deepEqual(args('entire_sessions', 'info', { sessionId: 's1' }), ['session', 'info', 's1', '--json']);
  assert.deepEqual(args('entire_sessions', 'stop', { sessionId: 's1' }), [
    'session',
    'stop',
    's1',
    '--force'
  ]);
  assert.deepEqual(args('entire_sessions', 'stop', { all: true }), ['session', 'stop', '--all', '--force']);
  assert.throws(() => args('entire_sessions', 'stop', {}), /sessionId or all/u);
  assert.throws(() => args('entire_sessions', 'stop', { sessionId: 's1', all: true }), /mutually exclusive/u);
  assert.deepEqual(
    args('entire_sessions', 'attach', { sessionId: 's1', commit: 'HEAD~1', review: true }),
    ['session', 'attach', 's1', '--force', '--commit', 'HEAD~1', '--review']
  );
  assert.deepEqual(args('entire_sessions', 'adopt', { sessionId: 's1', from: '../old' }), [
    'session',
    'adopt',
    's1',
    '--from',
    '../old',
    '--yes'
  ]);
  assert.throws(() => args('entire_sessions', 'resume', {}), /branch is required/u);
  assert.deepEqual(args('entire_sessions', 'resume', { branch: 'main' }), ['session', 'resume', 'main']);
});

test('sessions rejects a positional that looks like a flag', () => {
  assert.throws(() => args('entire_sessions', 'info', { sessionId: '--all' }), /must not start/u);
});

test('checkpoint delete defaults to a dry run and validates full IDs', () => {
  assert.deepEqual(args('entire_checkpoints', 'delete', { target: 'abcdef123456' }), [
    'checkpoint',
    'delete',
    'abcdef123456',
    '--dry-run'
  ]);
  assert.deepEqual(args('entire_checkpoints', 'delete', { target: 'abcdef123456', dryRun: false }), [
    'checkpoint',
    'delete',
    'abcdef123456',
    '--force'
  ]);
  assert.deepEqual(args('entire_checkpoints', 'delete', { target: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }), [
    'checkpoint',
    'delete',
    '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    '--dry-run'
  ]);
  assert.throws(() => args('entire_checkpoints', 'delete', { target: 'abcdef' }), /full checkpoint ID/u);
});

test('checkpoint list and explain keep mutually exclusive shapes', () => {
  assert.deepEqual(args('entire_checkpoints', 'list', { pending: true }), [
    'checkpoint',
    'list',
    '--json',
    '--pending'
  ]);
  assert.throws(() => args('entire_checkpoints', 'list', { pending: true, outgoing: true }), /mutually exclusive/u);
  assert.deepEqual(args('entire_checkpoints', 'explain', { target: 'abc', full: true }), [
    'checkpoint',
    'explain',
    'abc',
    '--full'
  ]);
  assert.deepEqual(args('entire_checkpoints', 'explain', { target: 'abc', short: true }), [
    'checkpoint',
    'explain',
    'abc',
    '--short',
    '--json'
  ]);
  assert.throws(() => args('entire_checkpoints', 'explain', { target: 'a', commit: 'b' }), /mutually exclusive/u);
  assert.throws(() => args('entire_checkpoints', 'profile', { all: true, limit: 2 }), /mutually exclusive/u);
});

test('search requires a query and supports both shapes', () => {
  assert.deepEqual(args('entire_search', 'work', { query: 'retry backoff' }), [
    'search',
    'retry backoff',
    '--json',
    '--compact'
  ]);
  assert.deepEqual(args('entire_search', 'work', { query: 'q', compact: false }), [
    'search',
    'q',
    '--json'
  ]);
  assert.deepEqual(args('entire_search', 'code', { query: 'parseToken', caseSensitive: true }), [
    'search',
    '--code',
    'parseToken',
    '--json',
    '--case-sensitive'
  ]);
  assert.throws(() => args('entire_search', 'work', {}), /query is required/u);
  assert.throws(() => args('entire_search', 'work', { query: '--all-repos' }), /must not start/u);
  assert.throws(() => args('entire_search', 'work', { query: 'q', date: 'year' }), /date must be one of/u);
});

test('history forces non-interactive recap and validates dispatch', () => {
  assert.deepEqual(args('entire_history', 'recap', { period: 'week' }), [
    'recap',
    '--static',
    '--week'
  ]);
  assert.throws(
    () => args('entire_history', 'dispatch', { allBranches: true }),
    /allBranches requires local/u
  );
  assert.deepEqual(args('entire_history', 'blame', { file: 'src/a.go', line: '12' }), [
    'blame',
    'src/a.go',
    '--json',
    '--line',
    '12'
  ]);
  assert.deepEqual(args('entire_history', 'why', { file: 'src/a.go' }), ['why', 'src/a.go']);
  assert.deepEqual(args('entire_history', 'why', { file: 'src/a.go', line: '12' }), [
    'why',
    'src/a.go',
    '--line',
    '12',
    '--json'
  ]);
  assert.deepEqual(args('entire_history', 'experts', { staged: true }), [
    'experts',
    '--staged',
    '--json'
  ]);
});

test('trails require a project for list and default merge to a dry run', () => {
  assert.throws(() => args('entire_trails', 'list', {}), /project is required/u);
  assert.deepEqual(args('entire_trails', 'list', { project: 'gh/acme' }), [
    'trail',
    'list',
    '--project',
    'gh/acme',
    '--json'
  ]);
  assert.deepEqual(args('entire_trails', 'findings', { trail: '7', findingStatus: 'open' }), [
    'trail',
    'finding',
    'list',
    '7',
    '--status',
    'open',
    '--json'
  ]);
  assert.throws(() => args('entire_trails', 'create', {}), /title is required/u);
  assert.throws(() => args('entire_trails', 'update', {}), /trail is required/u);

  const mergeDry = args('entire_trails', 'merge', { trail: '7' });
  assert.ok(mergeDry.includes('--dry-run'));
  assert.ok(!mergeDry.includes('--yes'));

  const mergeReal = args('entire_trails', 'merge', { trail: '7', dryRun: false });
  assert.ok(mergeReal.includes('--yes'));
  assert.ok(!mergeReal.includes('--dry-run'));
});

test('review configure is non-interactive and requires the set flags', () => {
  assert.throws(() => args('entire_review', 'configure', {}), /setAgents is required/u);
  assert.deepEqual(
    args('entire_review', 'configure', { setAgents: 'codex,claude-code', setJudge: 'codex' }),
    [
      'review',
      '--configure',
      '--set-agents',
      'codex,claude-code',
      '--set-judge',
      'codex'
    ]
  );
  assert.deepEqual(args('entire_review', 'list', {}), ['review', '--list']);
  assert.deepEqual(args('entire_review', 'run', { profile: 'p' }), ['review', '--profile', 'p']);
});

test('graph builds typed code-graph calls and passes repoPath only when pinned', () => {
  assert.deepEqual(args('entire_graph', 'neighbors', { symbol: 'Foo', depth: 2 }), [
    'graph',
    'neighbors',
    '--symbol',
    'Foo',
    '--depth',
    '2'
  ]);
  assert.deepEqual(args('entire_graph', 'verify', { test: 'go test ./...' }), [
    'graph',
    'verify',
    '--test',
    'go test ./...'
  ]);
  assert.throws(() => args('entire_graph', 'verify', {}), /test is required/u);

  const explain = buildInvocation('entire_graph', 'explain', { input: 'boom' }, settings);
  assert.equal(explain.stdin, 'boom');
  assert.ok(explain.args.includes('--format'));

  const pinned = buildInvocation(
    'entire_graph',
    'query',
    { query: 'where is auth' },
    resolveConfig({ repoPath: '/repo' })
  );
  assert.deepEqual(pinned.args, ['graph', 'query', '--query', 'where is auth', '--repo', '/repo']);
});

test('entire_run passes argv through with a bounded timeout', () => {
  const built = buildInvocation('entire_run', undefined, { argv: ['status', '--json'] }, settings);
  assert.deepEqual(built.args, ['status', '--json']);
  assert.equal(built.timeoutMs, 600_000);

  const custom = buildInvocation('entire_run', undefined, { argv: ['status'], timeoutMs: 20_000 }, settings);
  assert.equal(custom.timeoutMs, 20_000);

  assert.throws(() => buildInvocation('entire_run', undefined, { argv: [] }, settings), /at least one/u);
  assert.throws(
    () => buildInvocation('entire_run', undefined, { argv: ['status'], timeoutMs: 1 }, settings),
    /between 5000/u
  );
});

test('action timeouts are capped by the configured budget', () => {
  assert.equal(buildInvocation('entire_status', 'status', {}, settings).timeoutMs, 120_000);
  assert.equal(buildInvocation('entire_search', 'work', { query: 'q' }, settings).timeoutMs, 180_000);
  assert.equal(buildInvocation('entire_graph', 'query', { query: 'q' }, settings).timeoutMs, 300_000);
  assert.equal(buildInvocation('entire_review', 'run', {}, settings).timeoutMs, 600_000);

  const tight = resolveConfig({ timeoutMs: 30_000 });
  assert.equal(buildInvocation('entire_status', 'status', {}, tight).timeoutMs, 30_000);
});
