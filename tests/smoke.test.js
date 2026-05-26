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
  for (const k of ['install', 'start', 'connect', 'doctor', 'SUPPORTED_IDES', 'mcpEntry',
                   'dashboard', 'installServices', 'uninstallServices', 'serviceStatus',
                   'controlService', 'probeDashboardHealth']) {
    assert.ok(k in lib, `missing export: ${k}`);
  }
  assert.ok(Array.isArray(lib.SUPPORTED_IDES) && lib.SUPPORTED_IDES.includes('claude-code'));
});

t('services: defs include all four with sane shape', () => {
  const { serviceDefs } = require('../lib/services');
  const svcs = serviceDefs({});
  const names = svcs.map((s) => s.name).sort();
  assert.deepStrictEqual(names, ['check-updates', 'dashboard', 'orphan-backfill', 'reflection']);
  const dash = svcs.find((s) => s.name === 'dashboard');
  assert.strictEqual(dash.module, 'src.dashboard');
  assert.strictEqual(dash.keepAlive, true);
  assert.strictEqual(dash.healthcheck, '/api/stats');
  assert.strictEqual(dash.port, 37737);
  const refl = svcs.find((s) => s.name === 'reflection');
  assert.strictEqual(refl.module, 'src.tools.run_reflection');
  assert.strictEqual(refl.keepAlive, false);
  assert.ok(refl.watchPath && refl.watchPath.endsWith('.reflect-pending'));
  const ob = svcs.find((s) => s.name === 'orphan-backfill');
  assert.deepStrictEqual(ob.calendarHours, [0, 6, 12, 18]);
  assert.ok(Array.isArray(ob.moduleArgs) && ob.moduleArgs.includes('--trigger-now'));
  const cu = svcs.find((s) => s.name === 'check-updates');
  assert.strictEqual(cu.calendarWeekly.Weekday, 0);
  assert.strictEqual(cu.calendarWeekly.Hour, 3);
});

t('services: plist renders StartCalendarInterval array for orphan-backfill', () => {
  const { serviceDefs, renderPlist } = require('../lib/services');
  const svc = serviceDefs({}).find((s) => s.name === 'orphan-backfill');
  const xml = renderPlist(svc, '/x/python');
  assert.match(xml, /<key>StartCalendarInterval<\/key>\s*<array>/);
  for (const h of [0, 6, 12, 18]) {
    assert.match(xml, new RegExp(`<key>Hour</key><integer>${h}</integer>`));
  }
  assert.match(xml, /<string>--trigger-now<\/string>/);
  assert.match(xml, /<key>KeepAlive<\/key><false\/>/);
});

t('services: plist renders StartCalendarInterval dict for check-updates (weekly)', () => {
  const { serviceDefs, renderPlist } = require('../lib/services');
  const svc = serviceDefs({}).find((s) => s.name === 'check-updates');
  const xml = renderPlist(svc, '/x/python');
  assert.match(xml, /<key>StartCalendarInterval<\/key>\s*<dict>/);
  assert.match(xml, /<key>Weekday<\/key><integer>0<\/integer>/);
  assert.match(xml, /<key>Hour<\/key><integer>3<\/integer>/);
});

t('services: systemd calendar timer rendered for cron jobs', () => {
  const { serviceDefs, renderSystemdCalendarTimer } = require('../lib/services');
  const ob = serviceDefs({}).find((s) => s.name === 'orphan-backfill');
  const t1 = renderSystemdCalendarTimer(ob);
  assert.match(t1, /\[Timer\]/);
  assert.match(t1, /OnCalendar=00,06,12,18:00:00/);
  assert.match(t1, /Unit=tam-orphan-backfill\.service/);
  const cu = serviceDefs({}).find((s) => s.name === 'check-updates');
  const t2 = renderSystemdCalendarTimer(cu);
  assert.match(t2, /OnCalendar=Sun \*-\*-\* 03:00:00/);
});

t('services: plist renders valid XML for dashboard (keepalive=true)', () => {
  const { serviceDefs, renderPlist } = require('../lib/services');
  const svc = serviceDefs({}).find((s) => s.name === 'dashboard');
  const xml = renderPlist(svc, '/Users/x/.tam/.venv/bin/python');
  assert.match(xml, /<plist version="1\.0">/);
  assert.match(xml, /<key>Label<\/key><string>com\.total-agent-memory\.dashboard<\/string>/);
  assert.match(xml, /<string>\/Users\/x\/\.tam\/\.venv\/bin\/python<\/string>/);
  assert.match(xml, /<string>-m<\/string>\s*<string>src\.dashboard<\/string>/);
  assert.match(xml, /<key>DASHBOARD_PORT<\/key><string>37737<\/string>/);
  assert.match(xml, /<key>KeepAlive<\/key><true\/>/);
  assert.match(xml, /<key>RunAtLoad<\/key><true\/>/);
  // No WatchPaths block for dashboard.
  assert.ok(!xml.includes('<key>WatchPaths</key>'));
});

t('services: plist renders WatchPaths for reflection (keepalive=false)', () => {
  const { serviceDefs, renderPlist } = require('../lib/services');
  const svc = serviceDefs({}).find((s) => s.name === 'reflection');
  const xml = renderPlist(svc, '/x/python');
  assert.match(xml, /<key>WatchPaths<\/key>/);
  assert.match(xml, /\.reflect-pending<\/string>/);
  assert.match(xml, /<key>ThrottleInterval<\/key><integer>5<\/integer>/);
  assert.match(xml, /<key>StartInterval<\/key><integer>3600<\/integer>/);
  assert.match(xml, /<key>KeepAlive<\/key><false\/>/);
});

t('services: systemd unit renders with Restart=always for dashboard', () => {
  const { serviceDefs, renderSystemdService } = require('../lib/services');
  const svc = serviceDefs({}).find((s) => s.name === 'dashboard');
  const unit = renderSystemdService(svc, '/x/python');
  assert.match(unit, /ExecStart=\/x\/python -m src\.dashboard/);
  assert.match(unit, /Restart=always/);
  assert.match(unit, /Environment=DASHBOARD_PORT=37737/);
  assert.match(unit, /WantedBy=default\.target/);
});

t('services: systemd .path unit references the .service unit', () => {
  const { serviceDefs, renderSystemdPath } = require('../lib/services');
  const svc = serviceDefs({}).find((s) => s.name === 'reflection');
  const u = renderSystemdPath(svc);
  assert.match(u, /\[Path\]/);
  assert.match(u, /PathChanged=.*\.reflect-pending/);
  assert.match(u, /Unit=tam-reflection\.service/);
});

t('services: XML escaping protects against injection in env values', () => {
  const { renderPlist } = require('../lib/services');
  const svc = {
    name: 'evil', module: 'src.x', env: { K: 'a"<&>b' },
    keepAlive: true, logFile: '/l', errFile: '/e',
  };
  const xml = renderPlist(svc, '/p');
  assert.ok(!xml.includes('a"<&>b'), 'unescaped payload leaked into XML');
  assert.match(xml, /a&quot;&lt;&amp;&gt;b/);
});

t('dashboard subcommand exists and shows help on bad subcommand', () => {
  const r = exec(['dashboard', 'not-a-real-subcommand', '--memory-dir', '/tmp/tam-smoke-nonexistent']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /unknown dashboard subcommand/);
});

t('dashboard status runs (probes localhost — no server required)', () => {
  const r = exec(['dashboard', 'status', '--memory-dir', '/tmp/tam-smoke-nonexistent']);
  assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /Services/);
  assert.match(r.stdout, /dashboard/);
  assert.match(r.stdout, /reflection/);
});

if (failed === 0) {
  process.stdout.write('\n\x1b[32mall smoke tests passed\x1b[0m\n');
  process.exit(0);
} else {
  process.stdout.write(`\n\x1b[31m${failed} test(s) failed\x1b[0m\n`);
  process.exit(1);
}
