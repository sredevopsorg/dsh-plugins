import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveConfig } from '../lib/config.js';
import { EntireError, resolveCwd, runEntireCommand } from '../lib/exec.js';

const cwd = process.cwd();

test('runEntireCommand captures stdout and closes stdin', async () => {
  const result = await runEntireCommand({
    binary: process.execPath,
    args: ['-e', 'process.stdout.write("hello")'],
    cwd,
    timeoutMs: 5_000
  });
  assert.equal(result.stdout, 'hello');
  assert.equal(result.stderr, '');
});

test('runEntireCommand reports a missing binary with install guidance', async () => {
  await assert.rejects(
    runEntireCommand({
      binary: 'definitely-not-an-entire-binary-for-tests',
      args: ['status'],
      cwd,
      timeoutMs: 5_000
    }),
    (error) => {
      assert.ok(error instanceof EntireError);
      assert.match(error.message, /Entire CLI not found/u);
      assert.match(error.message, /docs\.entire\.com\/installation/u);
      return true;
    }
  );
});

test('runEntireCommand times out and names the budget', async () => {
  await assert.rejects(
    runEntireCommand({
      binary: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 10_000)'],
      cwd,
      timeoutMs: 150
    }),
    (error) => {
      assert.ok(error instanceof EntireError);
      assert.equal(error.timedOut, true);
      assert.match(error.message, /timed out after 150 ms/u);
      return true;
    }
  );
});

test('runEntireCommand honours cancellation', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50);
  try {
    await assert.rejects(
      runEntireCommand({
        binary: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 10_000)'],
        cwd,
        timeoutMs: 5_000,
        signal: controller.signal
      }),
      (error) => {
        assert.ok(error instanceof EntireError);
        assert.equal(error.cancelled, true);
        return true;
      }
    );
  } finally {
    clearTimeout(timer);
  }
});

test('resolveCwd uses repoPath and rejects a non-directory', async () => {
  const ctx = { get: () => undefined };
  const pinned = await resolveCwd(ctx, undefined, undefined, resolveConfig({ repoPath: cwd }));
  assert.equal(pinned, cwd);

  await assert.rejects(
    resolveCwd(ctx, undefined, undefined, resolveConfig({ repoPath: '/definitely/not/a/directory' })),
    /repoPath is not a directory/u
  );
});
