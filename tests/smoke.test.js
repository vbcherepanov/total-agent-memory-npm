'use strict';

// Smoke tests — run with `node tests/smoke.test.js`.
// These never touch the real Python install; they validate that the
// wrapper boots, parses args, and prints help/version cleanly.

const { spawnSync } = require('child_process');
const path = require('path');
const assert = require('assert');

const cli = path.join(__dirname, '..', 'bin', 'cli.js');
const node = process.execPath;
let failed = 0;

function t(name, fn) {
  try {
    fn();
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
  } catch (e) {
    failed += 1;
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n    ${e.message}\n`);
  }
}

function exec(args, env) {
  return spawnSync(node, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env, NO_COLOR: '1', TAM_DEBUG: '0' },
  });
}

process.stdout.write('smoke tests\n');

t('--version prints semver', () => {
  const r = exec(['--version']);
  assert.strictEqual(r.status, 0, `exit: ${r.status}, stderr: ${r.stderr}`);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
});

t('help command prints usage', () => {
  const r = exec(['help']);
  assert.strictEqual(r.status, 0, `exit: ${r.status}`);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /connect/);
});

t('unknown command exits 2', () => {
  const r = exec(['this-command-does-not-exist']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /unknown command/);
});

t('connect without IDE exits 2', () => {
  const r = exec(['connect']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /requires an IDE name/);
});

t('doctor runs and reports node version', () => {
  const r = exec(['doctor']);
  assert.strictEqual(r.status, 0, `exit: ${r.status}, stderr: ${r.stderr}`);
  assert.match(r.stdout, /Environment/);
  assert.match(r.stdout, /node/);
});

t('status runs with non-existing memory-dir', () => {
  const r = exec(['status', '--memory-dir', '/tmp/tam-smoke-nonexistent']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /memory dir/);
});

t('args parser handles --key=value and --key value', () => {
  const { parseArgs } = require('../lib/args');
  let p = parseArgs(['install', '--server-version=11.2.2']);
  assert.strictEqual(p.command, 'install');
  assert.strictEqual(p.flags['server-version'], '11.2.2');
  p = parseArgs(['install', '--server-version', '11.2.0']);
  assert.strictEqual(p.flags['server-version'], '11.2.0');
  p = parseArgs(['install', '--yes']);
  assert.strictEqual(p.flags.yes, true);
});

t('lib facade exports surface', () => {
  const lib = require('..');
  for (const k of ['install', 'start', 'connect', 'doctor', 'SUPPORTED_IDES', 'mcpEntry']) {
    assert.ok(k in lib, `missing export: ${k}`);
  }
  assert.ok(Array.isArray(lib.SUPPORTED_IDES) && lib.SUPPORTED_IDES.includes('claude-code'));
});

if (failed === 0) {
  process.stdout.write('\n\x1b[32mall smoke tests passed\x1b[0m\n');
  process.exit(0);
} else {
  process.stdout.write(`\n\x1b[31m${failed} test(s) failed\x1b[0m\n`);
  process.exit(1);
}
