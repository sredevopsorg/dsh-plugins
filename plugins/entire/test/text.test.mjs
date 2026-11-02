import assert from 'node:assert/strict';
import test from 'node:test';

import { formatResult, tailText, truncateOutput } from '../lib/text.js';

test('truncateOutput leaves small values untouched', () => {
  assert.equal(truncateOutput('hello', 100), 'hello');
  assert.equal(truncateOutput('', 100), '');
});

test('truncateOutput keeps head and tail and marks the omission', () => {
  const value = `HEAD-${'x'.repeat(500)}-TAIL`;
  const result = truncateOutput(value, 120);
  assert.ok(result.length <= 120 + 160, 'bounded with a marker');
  assert.ok(result.startsWith('HEAD-'));
  assert.ok(result.endsWith('-TAIL'));
  assert.match(result, /characters omitted/u);
});

test('tailText keeps only the end of long diagnostics', () => {
  const result = tailText(`start-${'y'.repeat(50)}-end`, 20);
  assert.ok(result.endsWith('-end'));
  assert.match(result, /characters omitted/u);
});

test('formatResult adds stderr only when present', () => {
  assert.equal(formatResult({ stdout: 'ok\n', stderr: '' }, 1_000), 'ok');
  assert.equal(formatResult({ stdout: '', stderr: '' }, 1_000), '(no output)');
  assert.match(formatResult({ stdout: 'ok', stderr: 'warn' }, 1_000), /\[stderr\]\nwarn/u);
});

test('formatResult truncates the combined output', () => {
  const result = formatResult({ stdout: 'a'.repeat(300), stderr: '' }, 50);
  assert.match(result, /characters omitted/u);
  assert.ok(result.length < 300);
});
