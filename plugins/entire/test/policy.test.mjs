import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveConfig } from '../lib/config.js';
import {
  actionPolicy,
  apiMethod,
  classifyRun,
  describeCall,
  permissionFor,
  policyForCall
} from '../lib/policy.js';

test('typed reads and writes are classified', () => {
  assert.equal(actionPolicy('entire_status', 'status'), 'read');
  assert.equal(actionPolicy('entire_status', 'doctor', {}), 'read');
  assert.equal(actionPolicy('entire_status', 'doctor', { fix: true }), 'write');
  assert.equal(actionPolicy('entire_sessions', 'stop'), 'write');
  assert.equal(actionPolicy('entire_sessions', 'list'), 'read');
  assert.equal(actionPolicy('entire_checkpoints', 'delete', {}), 'read');
  assert.equal(actionPolicy('entire_checkpoints', 'delete', { dryRun: false }), 'write');
  assert.equal(actionPolicy('entire_trails', 'merge', {}), 'read');
  assert.equal(actionPolicy('entire_trails', 'merge', { dryRun: false }), 'write');
  assert.equal(actionPolicy('entire_review', 'run'), 'write');
  assert.equal(actionPolicy('entire_graph', 'verify'), 'write');
  assert.equal(actionPolicy('entire_history', 'blame'), 'read');
});

test('entire_run classifies by command, help, and API method', () => {
  assert.equal(classifyRun(['status']).kind, 'read');
  assert.equal(classifyRun(['blame', 'src/a.go']).kind, 'read');
  assert.equal(classifyRun(['session', 'list']).kind, 'write');
  assert.equal(classifyRun(['enable']).kind, 'admin');
  assert.equal(classifyRun(['plugin', 'list']).kind, 'admin');
  assert.equal(classifyRun(['unknown-future-command']).kind, 'admin');
  assert.equal(classifyRun(['--help']).kind, 'read');
  assert.equal(classifyRun(['enable', '--help']).kind, 'read');
  assert.equal(classifyRun(['agent-help', 'session']).kind, 'read');
});

test('entire_run refuses servers, shells, and interactive flows', () => {
  assert.equal(classifyRun(['mcp']).kind, 'deny');
  assert.equal(classifyRun(['completion', 'bash']).kind, 'deny');
  assert.equal(classifyRun(['login']).kind, 'deny');
  assert.equal(classifyRun(['logout']).kind, 'deny');
  assert.equal(classifyRun(['auth', 'login']).kind, 'deny');
  assert.equal(classifyRun(['recap']).kind, 'deny');
  assert.equal(classifyRun(['recap', '--static']).kind, 'read');
  assert.equal(classifyRun(['search']).kind, 'deny');
  assert.equal(classifyRun(['search', 'needle']).kind, 'read');
  assert.equal(classifyRun(['trail', 'watch']).kind, 'deny');
  assert.equal(classifyRun(['trail', 'watch', '--once']).kind, 'write');
  assert.equal(classifyRun(['session', 'resume']).kind, 'deny');
  assert.equal(classifyRun(['session', 'resume', 'main']).kind, 'write');
  assert.equal(classifyRun(['session', 'stop']).kind, 'deny');
  assert.equal(classifyRun(['session', 'stop', '--all']).kind, 'write');
  assert.equal(classifyRun(['checkpoint', 'explain']).kind, 'deny');
  assert.equal(classifyRun(['checkpoint', 'explain', '--json']).kind, 'write');
  assert.equal(classifyRun(['review', '--configure']).kind, 'deny');
  assert.equal(classifyRun(['review', '--list']).kind, 'write');
  assert.equal(classifyRun(['review']).kind, 'deny');
});

test('api method detection covers flags and implicit POST', () => {
  assert.equal(apiMethod(['api', '/api/v1/clusters']), 'GET');
  assert.equal(apiMethod(['api', '-X', 'POST', '/api/v1/projects']), 'POST');
  assert.equal(apiMethod(['api', '--method=DELETE', '/x']), 'DELETE');
  assert.equal(apiMethod(['api', '-F', 'name=demo', '/x']), 'POST');
  assert.equal(apiMethod(['api', '--input', 'body.json', '/x']), 'POST');
  assert.equal(classifyRun(['api', '/api/v1/clusters']).kind, 'write');
  assert.equal(classifyRun(['api', '-X', 'POST', '/api/v1/projects']).kind, 'admin');
});

test('permissionFor names the exact config gate', () => {
  const closed = resolveConfig({});
  const writes = resolveConfig({ allowWrites: true });
  const admin = resolveConfig({ allowAdmin: true });

  assert.equal(permissionFor({ kind: 'read' }, closed, 'x').kind, 'allow');

  const writeDenied = permissionFor({ kind: 'write' }, closed, 'entire sessions stop');
  assert.equal(writeDenied.kind, 'deny');
  assert.match(writeDenied.reason, /allowWrites/u);

  assert.equal(permissionFor({ kind: 'write' }, writes, 'x').kind, 'ask');
  assert.equal(permissionFor({ kind: 'write' }, admin, 'x').kind, 'ask');

  const adminDenied = permissionFor({ kind: 'admin' }, writes, 'entire plugin install');
  assert.equal(adminDenied.kind, 'deny');
  assert.match(adminDenied.reason, /allowAdmin/u);
  assert.equal(permissionFor({ kind: 'admin' }, admin, 'x').kind, 'ask');
});

test('policyForCall and describeCall agree for typed and passthrough calls', () => {
  assert.equal(policyForCall('entire_sessions', { action: 'stop' }).kind, 'write');
  assert.equal(policyForCall('entire_run', { argv: ['enable'] }).kind, 'admin');
  assert.equal(describeCall('entire_run', { argv: ['plugin', 'list'] }), 'entire plugin list');
  assert.equal(describeCall('entire_sessions', { action: 'stop' }), 'entire sessions stop');
});

test('invalid passthrough argv fails closed', () => {
  assert.equal(classifyRun([]).kind, 'deny');
  assert.equal(classifyRun('status').kind, 'deny');
  assert.equal(classifyRun([42]).kind, 'deny');
});
