import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSessionBridge, hookForEvent, promptText, repoRootOf } from '../lib/bridge.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-entire-bridge-'));
}

function stubBinary(dir) {
  const file = path.join(dir, 'stub-entire');
  const log = path.join(dir, 'calls.log');
  fs.writeFileSync(
    file,
    [
      '#!/bin/sh',
      'payload=$(cat)',
      'printf \'%s|%s|%s|%s\\n\' "$1" "$2" "$3" "$payload" >> "$STUB_LOG"',
      ''
    ].join('\n')
  );
  fs.chmodSync(file, 0o755);
  return { file, log };
}

function fakeCtx() {
  const handlers = new Map();
  return {
    handlers,
    logger: { warn() {} },
    on(event, handler) {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    }
  };
}

function session(repo, id = 'session-1') {
  return { id, header: { cwd: repo } };
}

function wire(ctx, dir, marker) {
  return createSessionBridge(ctx, {
    binary: path.join(dir, 'stub-entire'),
    captureMarker: marker,
    captureTimeoutMs: 5000
  });
}

test('maps DSH events to Entire hooks', () => {
  assert.equal(hookForEvent({ type: 'turn/start', data: {} }), null);
  assert.deepEqual(hookForEvent({ type: 'turn/end', data: { turn: 1 } }), {
    hook: 'turn-end',
    fields: { raw: { turn: 1, reason: undefined } }
  });
  assert.equal(hookForEvent({ type: 'compaction/end', data: {} }).hook, 'compaction');
  assert.equal(
    hookForEvent({ type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }], source: { kind: 'human' } } }).hook,
    'turn-start'
  );
  assert.equal(
    hookForEvent({ type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }], source: { kind: 'working-directory' } } }),
    null
  );
});

test('promptText joins text blocks only', () => {
  assert.equal(promptText({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }), 'a\nb');
  assert.equal(promptText({}), '');
});

test('repoRootOf reads the session header cwd', () => {
  assert.equal(repoRootOf({ header: { cwd: '/repo' } }), '/repo');
  assert.equal(repoRootOf({}), undefined);
});

test('forwards a full session lifecycle when the marker exists', async () => {
  const dir = tempDir();
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, '.entire'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.entire', 'dsh-hooks.json'), '{}\n');
  const { log } = stubBinary(dir);
  const previous = process.env.STUB_LOG;
  process.env.STUB_LOG = log;
  try {
    const ctx = fakeCtx();
    const bridge = wire(ctx, dir, '.entire/dsh-hooks.json');
    const current = session(repo);
    ctx.handlers.get('session/created')(current);
    ctx.handlers.get('session/event')(current, {
      type: 'user/message',
      data: { content: [{ type: 'text', text: 'hello' }], source: { kind: 'human' } }
    });
    ctx.handlers.get('session/event')(current, { type: 'turn/end', data: { turn: 1 } });
    ctx.handlers.get('session/event')(current, { type: 'compaction/end', data: { turn: 1 } });
    ctx.handlers.get('session/disposed')(current);
    await bridge.flush();
    bridge.dispose();

    const calls = fs
      .readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const parts = line.split('|');
        return { argv: parts.slice(0, 3), payload: JSON.parse(parts.slice(3).join('|')) };
      });
    assert.deepEqual(
      calls.map((call) => call.argv[2]),
      ['session-start', 'turn-start', 'turn-end', 'compaction', 'session-end']
    );
    assert.equal(calls[0].argv[0], 'hooks');
    assert.equal(calls[0].argv[1], 'dsh');
    assert.equal(calls[1].payload.user_prompt, 'hello');
    assert.equal(calls[1].payload.session_id, 'session-1');
  } finally {
    if (previous === undefined) delete process.env.STUB_LOG;
    else process.env.STUB_LOG = previous;
  }
});

test('stays inert in a repository without the marker', async () => {
  const dir = tempDir();
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const { log } = stubBinary(dir);
  const previous = process.env.STUB_LOG;
  process.env.STUB_LOG = log;
  try {
    const ctx = fakeCtx();
    const bridge = wire(ctx, dir, '.entire/dsh-hooks.json');
    const current = session(repo);
    ctx.handlers.get('session/created')(current);
    ctx.handlers.get('session/event')(current, {
      type: 'user/message',
      data: { content: [{ type: 'text', text: 'hello' }], source: { kind: 'human' } }
    });
    await bridge.flush();
    bridge.dispose();
    assert.equal(fs.existsSync(log), false);
  } finally {
    if (previous === undefined) delete process.env.STUB_LOG;
    else process.env.STUB_LOG = previous;
  }
});
