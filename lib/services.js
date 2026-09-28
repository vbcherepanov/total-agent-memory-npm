'use strict';

// Manage background services (dashboard + reflection) per OS.
//
// macOS  → ~/Library/LaunchAgents/com.total-agent-memory.<name>.plist
// Linux  → ~/.config/systemd/user/tam-<name>.service (+ .path for reflection)
// Windows → schtasks /Create (best-effort) or printed instructions
//
// All services point at the existing entry points inside the installed
// venv (no new server code needed):
//   dashboard  → python -m src.dashboard
//   reflection → python -m src.tools.run_reflection
//
// Why not bundle a supervisor? Each OS has a battle-tested supervisor
// already (launchd / systemd). Re-implementing one inside the venv would
// be a downgrade on restart-on-crash, log rotation, and boot-order.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { run, runOrThrow, which, probe } = require('./sh');
const { memoryDir, venvBin, ensureDir, exists, home } = require('./paths');
const { c, ok, fail, warn, info } = require('./style');

// ────────────────────────────────────────────────────────────────────────
// Service definitions (OS-independent shape)
// ────────────────────────────────────────────────────────────────────────

function serviceDefs(flags) {
  const md = memoryDir(flags);
  const logDir = path.join(md, 'logs');
  return [
    {
      name: 'dashboard',
      title: 'Web dashboard',
      module: 'src.dashboard',
      env: {
        DASHBOARD_PORT: process.env.DASHBOARD_PORT || '37737',
        DASHBOARD_BIND: process.env.DASHBOARD_BIND || '127.0.0.1',
        TAM_MEMORY_DIR: md,
      },
      port: parseInt(process.env.DASHBOARD_PORT || '37737', 10),
      healthcheck: '/api/stats',
      keepAlive: true, // long-running HTTP server
      logFile: path.join(logDir, 'dashboard.log'),
      errFile: path.join(logDir, 'dashboard.err'),
    },
    {
      name: 'reflection',
      title: 'Reflection drain (file-watch)',
      module: 'src.tools.run_reflection',
      env: {
        REFLECT_DEBOUNCE_SEC: process.env.REFLECT_DEBOUNCE_SEC || '10',
        TAM_MEMORY_DIR: md,
      },
      // File-watch trigger: server touches this on every save.
      watchPath: path.join(md, '.reflect-pending'),
      keepAlive: false, // re-spawned by file-watch, exits when drain done
      throttleSec: 5,
      // Safety net periodic run every hour even if no trigger fires.
      startIntervalSec: 3600,
      logFile: path.join(logDir, 'reflection.log'),
      errFile: path.join(logDir, 'reflection.err'),
    },
    {
      // Cron-style: backfill orphan graph edges 4× per day. Keeps the
      // knowledge graph fresh as new saves accumulate.
      name: 'orphan-backfill',
      title: 'Orphan-edge backfill (4×/day)',
      module: 'src.tools.backfill_orphan_edges',
      moduleArgs: ['--min-mentions=1', '--limit=500', '--trigger-now'],
      env: { TAM_MEMORY_DIR: md },
      keepAlive: false,
      // launchd StartCalendarInterval — fires at 00, 06, 12, 18 daily.
      calendarHours: [0, 6, 12, 18],
      // systemd timer OnCalendar equivalent.
      systemdOnCalendar: '00,06,12,18:00:00',
      logFile: path.join(logDir, 'orphan-backfill.log'),
      errFile: path.join(logDir, 'orphan-backfill.err'),
    },
    {
      // Weekly check for new releases — non-critical, informational.
      name: 'check-updates',
      title: 'Check for new releases (weekly)',
      module: 'src.tools.check_updates',
      env: { TAM_MEMORY_DIR: md },
      keepAlive: false,
      // launchd StartCalendarInterval — Sunday 03:00.
      calendarWeekly: { Weekday: 0, Hour: 3, Minute: 0 },
      // systemd timer — Sun *-*-* 03:00:00.
      systemdOnCalendar: 'Sun *-*-* 03:00:00',
      logFile: path.join(logDir, 'check-updates.log'),
      errFile: path.join(logDir, 'check-updates.err'),
    },
  ];
}

// ────────────────────────────────────────────────────────────────────────
// macOS — LaunchAgent
// ────────────────────────────────────────────────────────────────────────

function plistLabel(name) {
  return `com.total-agent-memory.${name}`;
}

function plistPath(name) {
  return path.join(home(), 'Library', 'LaunchAgents', `${plistLabel(name)}.plist`);
}

function renderPlist(svc, pyPath) {
  const envEntries = Object.entries(svc.env)
    .map(([k, v]) => `    <key>${escapeXml(k)}</key><string>${escapeXml(String(v))}</string>`)
    .join('\n');
  const cmdArgs = ['-m', svc.module, ...(svc.moduleArgs || [])];
  const args = cmdArgs
    .map((a) => `    <string>${escapeXml(a)}</string>`)
    .join('\n');
  const watchBlock = svc.watchPath
    ? `  <key>WatchPaths</key>\n  <array>\n    <string>${escapeXml(svc.watchPath)}</string>\n  </array>\n`
    : '';
  const throttleBlock = svc.throttleSec
    ? `  <key>ThrottleInterval</key><integer>${svc.throttleSec}</integer>\n`
    : '';
  const intervalBlock = svc.startIntervalSec
    ? `  <key>StartInterval</key><integer>${svc.startIntervalSec}</integer>\n`
    : '';
  // StartCalendarInterval — for cron-style daily/weekly jobs.
  let calendarBlock = '';
  if (Array.isArray(svc.calendarHours) && svc.calendarHours.length) {
    const dicts = svc.calendarHours
      .map((h) => `    <dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>0</integer></dict>`)
      .join('\n');
    calendarBlock = `  <key>StartCalendarInterval</key>\n  <array>\n${dicts}\n  </array>\n`;
  } else if (svc.calendarWeekly) {
    const w = svc.calendarWeekly;
    const keys = ['Weekday', 'Hour', 'Minute']
      .filter((k) => k in w)
      .map((k) => `    <key>${k}</key><integer>${w[k]}</integer>`)
      .join('\n');
    calendarBlock = `  <key>StartCalendarInterval</key>\n  <dict>\n${keys}\n  </dict>\n`;
  }
  // keepAlive=true → HTTP server (always running). false → triggered by
  // file-watch or calendar.
  const runAtLoad = svc.keepAlive ? '<true/>' : '<false/>';
  const keepAlive = svc.keepAlive ? '<true/>' : '<false/>';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${plistLabel(svc.name)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(pyPath)}</string>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envEntries}
  </dict>
  <key>RunAtLoad</key>${runAtLoad}
  <key>KeepAlive</key>${keepAlive}
${watchBlock}${throttleBlock}${intervalBlock}${calendarBlock}  <key>StandardOutPath</key><string>${escapeXml(svc.logFile)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(svc.errFile)}</string>
</dict>
</plist>
`;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function macInstall(svcs, pyPath, opts) {
  ensureDir(path.dirname(plistPath('x')));
  for (const svc of svcs) {
    ensureDir(path.dirname(svc.logFile));
    if (svc.watchPath) ensureDir(path.dirname(svc.watchPath));
    const p = plistPath(svc.name);
    fs.writeFileSync(p, renderPlist(svc, pyPath));
    if (opts.dryRun) continue;
    const label = plistLabel(svc.name);
    const target = `gui/${process.getuid()}/${label}`;
    // Bootout previous version (if any). launchd is async — give it a
    // beat before bootstrapping the replacement, otherwise we hit
    // "Input/output error" on rapid replace.
    await run('launchctl', ['bootout', target], { silent: true });
    await _sleep(150);
    const r = await run('launchctl', ['bootstrap', `gui/${process.getuid()}`, p], { silent: true });
    if (r.code !== 0) {
      // Retry once after a longer pause (launchd was likely still
      // tearing down the old job).
      await _sleep(500);
      const r2 = await run('launchctl', ['bootstrap', `gui/${process.getuid()}`, p], { silent: true });
      if (r2.code !== 0) {
        // Fall back to legacy load (older macOS / sandbox issues).
        await run('launchctl', ['load', '-w', p], { silent: true });
      }
    }
    if (svc.keepAlive) {
      // Kickstart so the long-running service runs *now*.
      await run('launchctl', ['kickstart', '-k', target], { silent: true });
    }
  }
}

function _sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function macUninstall(svcs, opts) {
  for (const svc of svcs) {
    const p = plistPath(svc.name);
    if (!opts.dryRun) {
      await run('launchctl', ['bootout', `gui/${process.getuid()}/${plistLabel(svc.name)}`], { silent: true });
      await run('launchctl', ['unload', '-w', p], { silent: true });
    }
    if (exists(p)) fs.unlinkSync(p);
  }
}

async function macStatus(svcs) {
  const out = [];
  for (const svc of svcs) {
    const r = await run('launchctl', ['print', `gui/${process.getuid()}/${plistLabel(svc.name)}`], { silent: true });
    const installed = exists(plistPath(svc.name));
    const loaded = r.code === 0;
    const running = loaded && /state\s*=\s*running/i.test(r.stdout);
    // Cron-style services with calendar/interval triggers are healthy
    // when loaded — they just sit until their next fire. File-watch
    // services likewise: "watching" means ready, not stopped.
    let mode;
    if (running) mode = 'running';
    else if (loaded && (svc.calendarHours || svc.calendarWeekly)) mode = 'scheduled';
    else if (loaded && svc.watchPath) mode = 'watching';
    else if (installed) mode = 'idle';
    else mode = 'absent';
    out.push({ name: svc.name, installed, running, mode });
  }
  return out;
}

async function macControl(action, name) {
  const target = `gui/${process.getuid()}/${plistLabel(name)}`;
  if (action === 'start') {
    return await run('launchctl', ['kickstart', '-k', target], { silent: true });
  }
  if (action === 'stop') {
    return await run('launchctl', ['kill', 'SIGTERM', target], { silent: true });
  }
  if (action === 'restart') {
    return await run('launchctl', ['kickstart', '-k', target], { silent: true });
  }
  throw new Error(`unknown action: ${action}`);
}

// ────────────────────────────────────────────────────────────────────────
// Linux — systemd --user
// ────────────────────────────────────────────────────────────────────────

function systemdDir() {
  return path.join(home(), '.config', 'systemd', 'user');
}

function systemdUnitName(name, type = 'service') {
  return `tam-${name}.${type}`;
}

function renderSystemdService(svc, pyPath) {
  const envLines = Object.entries(svc.env)
    .map(([k, v]) => `Environment=${k}=${v}`)
    .join('\n');
  // `Type=exec` lets systemd consider the unit started as soon as the
  // binary is exec'd (good for short jobs).
  const type = svc.keepAlive ? 'simple' : 'exec';
  const restart = svc.keepAlive ? 'always' : 'no';
  const restartSec = svc.keepAlive ? 'RestartSec=5\n' : '';
  const moduleArgs = (svc.moduleArgs || []).join(' ');
  const execStart = `${pyPath} -m ${svc.module}${moduleArgs ? ' ' + moduleArgs : ''}`;
  return `[Unit]
Description=Total Agent Memory — ${svc.title}
After=default.target

[Service]
Type=${type}
ExecStart=${execStart}
Restart=${restart}
${restartSec}${envLines}
StandardOutput=append:${svc.logFile}
StandardError=append:${svc.errFile}

[Install]
WantedBy=default.target
`;
}

function renderSystemdCalendarTimer(svc) {
  if (!svc.systemdOnCalendar) return null;
  return `[Unit]
Description=Total Agent Memory — schedule for ${svc.title}

[Timer]
OnCalendar=${svc.systemdOnCalendar}
Persistent=true
Unit=${systemdUnitName(svc.name, 'service')}

[Install]
WantedBy=timers.target
`;
}

function renderSystemdPath(svc) {
  return `[Unit]
Description=Total Agent Memory — watch ${path.basename(svc.watchPath)}

[Path]
PathChanged=${svc.watchPath}
Unit=${systemdUnitName(svc.name, 'service')}

[Install]
WantedBy=default.target
`;
}

function renderSystemdTimer(svc) {
  return `[Unit]
Description=Total Agent Memory — periodic safety run for ${svc.title}

[Timer]
OnUnitActiveSec=${svc.startIntervalSec}s
OnBootSec=60s
Unit=${systemdUnitName(svc.name, 'service')}

[Install]
WantedBy=timers.target
`;
}

function systemctlAvailable() {
  if (!which('systemctl')) return false;
  // `systemctl --user show-environment` returns 0 only when the user bus
  // is reachable (i.e. lingering enabled, or interactive login session).
  const r = probe('systemctl', ['--user', 'show-environment']);
  return r.ok;
}

async function linuxInstall(svcs, pyPath, opts) {
  ensureDir(systemdDir());
  for (const svc of svcs) {
    ensureDir(path.dirname(svc.logFile));
    if (svc.watchPath) ensureDir(path.dirname(svc.watchPath));
    const svcFile = path.join(systemdDir(), systemdUnitName(svc.name, 'service'));
    fs.writeFileSync(svcFile, renderSystemdService(svc, pyPath));
    if (svc.watchPath) {
      const pathFile = path.join(systemdDir(), systemdUnitName(svc.name, 'path'));
      fs.writeFileSync(pathFile, renderSystemdPath(svc));
    }
    if (svc.startIntervalSec && !svc.keepAlive) {
      const timerFile = path.join(systemdDir(), systemdUnitName(svc.name, 'timer'));
      fs.writeFileSync(timerFile, renderSystemdTimer(svc));
    }
    if (svc.systemdOnCalendar) {
      const timerFile = path.join(systemdDir(), systemdUnitName(svc.name, 'timer'));
      fs.writeFileSync(timerFile, renderSystemdCalendarTimer(svc));
    }
  }
  if (opts.dryRun) return;
  if (!systemctlAvailable()) {
    process.stdout.write(`  ${warn('systemctl --user bus not reachable — unit files written. Enable later with:')}\n`);
    process.stdout.write(`    ${c.cyan('systemctl --user daemon-reload')}\n`);
    for (const svc of svcs) {
      const unit = primaryUnitFor(svc);
      process.stdout.write(`    ${c.cyan(`systemctl --user enable --now ${unit}`)}\n`);
    }
    return;
  }
  await run('systemctl', ['--user', 'daemon-reload'], { silent: true });
  for (const svc of svcs) {
    // For file-watch services we enable the `.path` unit which triggers
    // the `.service` unit on change. For calendar/interval jobs we
    // enable the `.timer`. For HTTP servers, enable the `.service`.
    const unit = primaryUnitFor(svc);
    await run('systemctl', ['--user', 'enable', '--now', unit], { silent: true });
  }
}

function primaryUnitFor(svc) {
  if (svc.watchPath) return systemdUnitName(svc.name, 'path');
  if (svc.systemdOnCalendar || svc.startIntervalSec) return systemdUnitName(svc.name, 'timer');
  return systemdUnitName(svc.name, 'service');
}

async function linuxUninstall(svcs, opts) {
  for (const svc of svcs) {
    const units = [
      systemdUnitName(svc.name, 'service'),
      svc.watchPath ? systemdUnitName(svc.name, 'path') : null,
      (svc.startIntervalSec && !svc.keepAlive) || svc.systemdOnCalendar
        ? systemdUnitName(svc.name, 'timer') : null,
    ].filter(Boolean);
    if (!opts.dryRun && systemctlAvailable()) {
      for (const unit of units) {
        await run('systemctl', ['--user', 'disable', '--now', unit], { silent: true });
      }
    }
    for (const unit of units) {
      const f = path.join(systemdDir(), unit);
      if (exists(f)) fs.unlinkSync(f);
    }
  }
  if (!opts.dryRun && systemctlAvailable()) {
    await run('systemctl', ['--user', 'daemon-reload'], { silent: true });
  }
}

async function linuxStatus(svcs) {
  const out = [];
  for (const svc of svcs) {
    const unit = systemdUnitName(svc.name, 'service');
    const pathUnit = svc.watchPath ? systemdUnitName(svc.name, 'path') : null;
    const timerUnit = (svc.systemdOnCalendar || svc.startIntervalSec) ? systemdUnitName(svc.name, 'timer') : null;
    const installed = exists(path.join(systemdDir(), unit));
    let running = false, watching = false, scheduled = false;
    if (systemctlAvailable()) {
      const r = await run('systemctl', ['--user', 'is-active', unit], { silent: true });
      running = r.code === 0 && r.stdout.trim() === 'active';
      if (pathUnit) {
        const r2 = await run('systemctl', ['--user', 'is-active', pathUnit], { silent: true });
        watching = r2.code === 0 && r2.stdout.trim() === 'active';
      }
      if (timerUnit) {
        const r3 = await run('systemctl', ['--user', 'is-active', timerUnit], { silent: true });
        scheduled = r3.code === 0 && r3.stdout.trim() === 'active';
      }
    }
    let mode;
    if (running) mode = 'running';
    else if (scheduled) mode = 'scheduled';
    else if (watching) mode = 'watching';
    else if (installed) mode = 'idle';
    else mode = 'absent';
    out.push({ name: svc.name, installed, running, mode });
  }
  return out;
}

async function linuxControl(action, name) {
  const unit = systemdUnitName(name, 'service');
  if (!systemctlAvailable()) {
    throw new Error('systemctl --user bus not reachable');
  }
  if (action === 'start') return await run('systemctl', ['--user', 'start', unit], { silent: true });
  if (action === 'stop') return await run('systemctl', ['--user', 'stop', unit], { silent: true });
  if (action === 'restart') return await run('systemctl', ['--user', 'restart', unit], { silent: true });
  throw new Error(`unknown action: ${action}`);
}

// ────────────────────────────────────────────────────────────────────────
// Windows — schtasks (best-effort) or printed instructions
// ────────────────────────────────────────────────────────────────────────

async function winInstall(svcs, pyPath, opts) {
  if (opts.dryRun) {
    process.stdout.write(`  ${info('Windows service install is a dry-run only in v1.2.0. Use Task Scheduler manually.')}\n`);
    return;
  }
  // Best-effort: create onLogon scheduled task for the dashboard.
  // Reflection (file-watch) is not supported via schtasks; instruct user.
  process.stdout.write(`  ${warn('Windows auto-service install is limited in v1.2.0:')}\n`);
  process.stdout.write(`    ${info('Dashboard: registering schtasks onLogon trigger…')}\n`);
  for (const svc of svcs) {
    if (svc.name !== 'dashboard') {
      process.stdout.write(`    ${warn(`${svc.name}: not auto-installed on Windows. Run manually when needed:`)}\n`);
      process.stdout.write(`      ${c.cyan(`"${pyPath}" -m ${svc.module}`)}\n`);
      continue;
    }
    const taskName = `TotalAgentMemory-${svc.name}`;
    const cmd = `"${pyPath}" -m ${svc.module}`;
    await run('schtasks', [
      '/Create', '/F',
      '/SC', 'ONLOGON',
      '/TN', taskName,
      '/TR', cmd,
      '/RL', 'LIMITED',
    ], { silent: true });
    // And run it once now.
    await run('schtasks', ['/Run', '/TN', taskName], { silent: true });
  }
}

async function winUninstall(svcs, opts) {
  for (const svc of svcs) {
    if (svc.name !== 'dashboard') continue;
    const taskName = `TotalAgentMemory-${svc.name}`;
    if (!opts.dryRun) await run('schtasks', ['/Delete', '/F', '/TN', taskName], { silent: true });
  }
}

async function winStatus(svcs) {
  const out = [];
  for (const svc of svcs) {
    if (svc.name !== 'dashboard') {
      out.push({ name: svc.name, installed: false, running: false, mode: 'absent', note: 'manual on Windows' });
      continue;
    }
    const taskName = `TotalAgentMemory-${svc.name}`;
    const r = await run('schtasks', ['/Query', '/TN', taskName, '/FO', 'CSV', '/NH'], { silent: true });
    const installed = r.code === 0;
    const running = installed && /Running/i.test(r.stdout);
    const mode = running ? 'running' : (installed ? 'idle' : 'absent');
    out.push({ name: svc.name, installed, running, mode });
  }
  return out;
}

async function winControl(action, name) {
  const taskName = `TotalAgentMemory-${name}`;
  if (action === 'start') return await run('schtasks', ['/Run', '/TN', taskName], { silent: true });
  if (action === 'stop') return await run('schtasks', ['/End', '/TN', taskName], { silent: true });
  if (action === 'restart') {
    await run('schtasks', ['/End', '/TN', taskName], { silent: true });
    return await run('schtasks', ['/Run', '/TN', taskName], { silent: true });
  }
  throw new Error(`unknown action: ${action}`);
}

// ────────────────────────────────────────────────────────────────────────
// Public API (OS dispatch)
// ────────────────────────────────────────────────────────────────────────

function osDispatch() {
  if (process.platform === 'darwin') return { install: macInstall, uninstall: macUninstall, status: macStatus, control: macControl, name: 'macOS' };
  if (process.platform === 'linux') return { install: linuxInstall, uninstall: linuxUninstall, status: linuxStatus, control: linuxControl, name: 'Linux' };
  if (process.platform === 'win32') return { install: winInstall, uninstall: winUninstall, status: winStatus, control: winControl, name: 'Windows' };
  return null;
}

// Background services are machine-wide (fixed labels), so services for a
// throwaway memory dir would replace the real ones. Temp dirs need an explicit flag.
const ALLOW_TEMP_FLAG = 'allow-temp-services';

function realOrResolved(p) {
  try { return fs.realpathSync(p); } catch (_) { return path.resolve(p); }
}

function underTempDir(dir) {
  const target = realOrResolved(dir);
  const roots = new Set([os.tmpdir(), realOrResolved(os.tmpdir()), '/tmp', realOrResolved('/tmp')]);
  return [...roots].some((root) => target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep));
}

function assertServicesAllowed(flags) {
  const dir = memoryDir(flags);
  if (underTempDir(dir) && !(flags && flags[ALLOW_TEMP_FLAG])) {
    throw new Error(`refusing to change background services for a memory dir under the system temp dir (${dir}); ` +
      `they are machine-wide and would replace the real ones. Pass --${ALLOW_TEMP_FLAG} to do it anyway.`);
  }
}

async function installServices(flags, opts = {}) {
  assertServicesAllowed(flags);
  const d = osDispatch();
  if (!d) {
    process.stdout.write(`  ${warn(`OS ${process.platform} not supported for auto-service install`)}\n`);
    return false;
  }
  const py = venvBin(flags, 'python');
  if (!exists(py)) {
    process.stdout.write(`  ${fail(`venv python not found: ${py}`)}\n`);
    return false;
  }
  const svcs = serviceDefs(flags);
  process.stdout.write(`  ${info(`Installing ${svcs.length} background services (${d.name})…`)}\n`);
  await d.install(svcs, py, opts);
  // Print quick verification hint.
  process.stdout.write(`  ${ok(`Services installed. Dashboard: ${c.cyan('http://127.0.0.1:37737')}`)}\n`);
  return true;
}

async function uninstallServices(flags, opts = {}) {
  assertServicesAllowed(flags);
  const d = osDispatch();
  if (!d) return false;
  const svcs = serviceDefs(flags);
  process.stdout.write(`  ${info(`Removing background services (${d.name})…`)}\n`);
  await d.uninstall(svcs, opts);
  process.stdout.write(`  ${ok('Services removed.')}\n`);
  return true;
}

async function serviceStatus(flags) {
  const d = osDispatch();
  if (!d) return [];
  return await d.status(serviceDefs(flags));
}

async function controlService(action, name, flags) {
  const d = osDispatch();
  if (!d) throw new Error(`OS ${process.platform} not supported`);
  return await d.control(action, name);
}

function logsPath(name, flags, which = 'stdout') {
  const svc = serviceDefs(flags).find((s) => s.name === name);
  if (!svc) return null;
  return which === 'stderr' ? svc.errFile : svc.logFile;
}

// Probe dashboard HTTP endpoint. Returns true if /api/stats answers 200.
async function probeDashboardHealth(flags, timeoutMs = 2000) {
  const port = process.env.DASHBOARD_PORT || '37737';
  return await new Promise((resolve) => {
    const http = require('http');
    const req = http.get(`http://127.0.0.1:${port}/api/stats`, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
  });
}

module.exports = {
  serviceDefs,
  installServices,
  uninstallServices,
  serviceStatus,
  controlService,
  logsPath,
  probeDashboardHealth,
  // Exposed for tests:
  renderPlist,
  renderSystemdService,
  renderSystemdPath,
  renderSystemdTimer,
  renderSystemdCalendarTimer,
  plistPath,
  assertServicesAllowed,
  underTempDir,
  plistLabel,
  systemdDir,
  systemdUnitName,
};
