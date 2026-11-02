import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULTS, resolveConfig } from '../lib/config.js';

test('resolveConfig returns defaults for a missing config', () => {
  const config = resolveConfig(undefined);
  assert.deepEqual({ ...config }, { ...DEFAULTS });
  assert.ok(Object.isFrozen(config));
});

test('resolveConfig ignores malformed values', () => {
  const config = resolveConfig({
    binary: '   ',
    repoPath: 42,
    allowWrites: 'yes',
    allowAdmin: null,
    timeoutMs: 1,
    maxOutputChars: 999_999,
    promptSection: 'yes'
  });
  assert.equal(config.binary, DEFAULTS.binary);
  assert.equal(config.repoPath, DEFAULTS.repoPath);
  assert.equal(config.allowWrites, false);
  assert.equal(config.allowAdmin, false);
  assert.equal(config.timeoutMs, DEFAULTS.timeoutMs);
  assert.equal(config.maxOutputChars, DEFAULTS.maxOutputChars);
  assert.equal(config.promptSection, true);
});

test('resolveConfig accepts valid overrides and clamps to the allowed range', () => {
  const config = resolveConfig({
    binary: '/opt/entire/bin/entire',
    repoPath: '  /repos/app  ',
    allowWrites: true,
    allowAdmin: true,
    timeoutMs: 30_000,
    maxOutputChars: 8_000,
    promptSection: false
  });
  assert.equal(config.binary, '/opt/entire/bin/entire');
  assert.equal(config.repoPath, '/repos/app');
  assert.equal(config.allowWrites, true);
  assert.equal(config.allowAdmin, true);
  assert.equal(config.timeoutMs, 30_000);
  assert.equal(config.maxOutputChars, 8_000);
  assert.equal(config.promptSection, false);
});
