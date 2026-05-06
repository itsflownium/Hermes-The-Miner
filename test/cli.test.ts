import test from 'node:test';
import assert from 'node:assert/strict';
import { formatStatusLines } from '../src/cli.js';

test('cli status reports an external bridge when the API is up without a daemon pid file', () => {
  const lines = formatStatusLines(
    false,
    { connected: true, uptime: 42, agentRunning: true },
    { success: true, display: 'Test Model', provider: 'fake-provider' },
    { success: true, data: { behaviorMode: 'HELPER', activeGoal: null } },
  );

  assert.equal(lines[0], 'Bridge: running (external)');
  assert.ok(lines.some(line => /Connected:\s+true/.test(line)));
  assert.ok(lines.some(line => /Agent:\s+running/.test(line)));
  assert.ok(lines.some(line => /Model:\s+Test Model/.test(line)));
  assert.ok(lines.some(line => /Mode:\s+HELPER/.test(line)));
});

test('cli status reports not running when the bridge API is unavailable', () => {
  assert.deepEqual(formatStatusLines(false, null, null, null), ['Bridge: not running']);
});
