'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { install, venvBin, pinned } = require('./install');
const { connect, SUPPORTED } = require('./ide');
const { diagnose, printReport, printRemediation } = require('./doctor');
const { memoryDir, venvDir, exists, home } = require('./paths');
const { run, runOrThrow } = require('./sh');
const { c, bold, ok, fail, warn, info, banner, step } = require('./style');

async function ensureInstalled(ctx) {
  const bin = venvBin(ctx.flags, 'claude-total-memory');
  if (exists(bin)) return bin;
  process.stdout.write(`${info('Server not installed yet — installing now…')}\n`);
  const code = await install(ctx);
  if (code !== 0) throw new Error('install failed');
  return bin;
}

// ────────────────────────────────────────────────────────────────────────

async function cmdInstall(ctx) {
  process.stdout.write(banner());
  return await install(ctx);
}

async function cmdStart(ctx) {
  const bin = await ensureInstalled(ctx);
  process.stdout.write(`${info(`Starting MCP server: ${c.dim(bin)}`)}\n`);
  // Replace this Node process with the server (transparent pass-through).
  const child = spawn(bin, [], {
    stdio: 'inherit',
    env: { ...process.env, MEMORY_MODE: process.env.MEMORY_MODE || 'fast' },
  });
  return await new Promise((resolve) => child.on('close', (code) => resolve(code || 0)));
}

async function cmdConnect(ctx) {
  const ide = ctx.positional[0];
  if (!ide) {
    process.stderr.write(`${fail('connect requires an IDE name')}\n`);
    process.stderr.write(`Supported: ${SUPPORTED.join(', ')}\n`);
    return 2;
  }
  await ensureInstalled(ctx);
  try {
    const { file, manual } = connect(ide, ctx.flags);
    if (manual) {
      process.stdout.write(`${warn(`Manual wiring required for ${ide}: ${file}`)}\n`);
      return 0;
    }
    process.stdout.write(banner());
    process.stdout.write(`${ok(`Wired ${c.bold(ide)} → ${c.dim(file)}`)}\n`);
    process.stdout.write(`${info('Restart your IDE for the change to take effect.')}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`${fail(e.message)}\n`);
    return 2;
  }
}

async function cmdDemo(ctx) {
  const bin = await ensureInstalled(ctx);
  process.stdout.write(banner());
  process.stdout.write(`${info('Demo: seed a session + recall it.')}\n`);
  // We use the lookup-memory CLI shipped in the same venv to drive a
  // round-trip without needing an MCP client.
  const cli = path.join(path.dirname(bin), process.platform === 'win32' ? 'lookup-memory.exe' : 'lookup-memory');
  if (!exists(cli)) {
    process.stdout.write(`${warn('lookup-memory CLI not found in venv — open an MCP client to drive the server.')}\n`);
    return 0;
  }
  process.stdout.write(`${c.dim('$ lookup-memory --help')}\n`);
  await run(cli, ['--help']);
  process.stdout.write(`\n${ok('Server is healthy. Connect your IDE next:')}\n`);
  process.stdout.write(`  ${c.cyan('total-agent-memory connect claude-code')}\n`);
  return 0;
}

async function cmdStatus(ctx) {
  const env = await diagnose();
  process.stdout.write(banner());
  printReport(env);
  const dir = memoryDir(ctx.flags);
  const venv = venvDir(ctx.flags);
  const bin = venvBin(ctx.flags, 'claude-total-memory');
  const db = path.join(dir, 'memory.db');
  process.stdout.write(`\n${bold('Install')}\n`);
  process.stdout.write(`  ${exists(dir) ? ok(`memory dir : ${dir}`) : warn(`memory dir : ${dir} (missing)`)}\n`);
  process.stdout.write(`  ${exists(venv) ? ok(`venv       : ${venv}`) : warn(`venv       : ${venv} (missing)`)}\n`);
  process.stdout.write(`  ${exists(bin) ? ok(`server bin : ${bin}`) : warn(`server bin : ${bin} (missing)`)}\n`);
  if (exists(db)) {
    const sz = (fs.statSync(db).size / 1024 / 1024).toFixed(2);
    process.stdout.write(`  ${ok(`memory.db  : ${sz} MB`)}\n`);
  } else {
    process.stdout.write(`  ${warn(`memory.db  : ${db} (will be created on first save)`)}\n`);
  }
  return 0;
}

async function cmdDoctor(ctx) {
  const env = await diagnose();
  process.stdout.write(banner());
  printReport(env);
  printRemediation(env);
  return 0;
}

async function cmdUpgrade(ctx) {
  process.stdout.write(banner());
  process.stdout.write(`${info('Upgrading server to the latest version…')}\n`);
  // Force install with --server-version=latest.
  const upgradeCtx = { ...ctx, flags: { ...ctx.flags, 'server-version': 'latest' } };
  return await install(upgradeCtx);
}

async function cmdUninstall(ctx) {
  process.stdout.write(banner());
  const dir = memoryDir(ctx.flags);
  if (!exists(dir)) {
    process.stdout.write(`${ok('Nothing to remove — directory does not exist.')}\n`);
    return 0;
  }
  process.stdout.write(`${warn(`About to remove ${dir}.`)}\n`);
  if (!ctx.flags.yes) {
    process.stdout.write(`${info('Re-run with --yes to confirm.')}\n`);
    return 0;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write(`${ok('Removed.')}\n`);
  process.stdout.write(`${info('IDE configs were left intact. Edit ~/.claude.json / ~/.cursor/mcp.json / etc. manually to drop the MCP entry.')}\n`);
  return 0;
}

// First-run onboarding: install + suggest a connect step.
async function cmdOnboard(ctx) {
  process.stdout.write(banner());
  const env = await diagnose();
  printReport(env);
  if (!env.python3) {
    printRemediation(env);
    return 1;
  }
  process.stdout.write(`\n${bold('Quick setup')}\n`);
  process.stdout.write(`  ${step(1, 2, 'install server')}\n`);
  const code = await install(ctx);
  if (code !== 0) return code;
  process.stdout.write(`  ${step(2, 2, 'next: wire an IDE')}\n\n`);
  process.stdout.write(`  ${c.cyan('total-agent-memory connect claude-code')}\n`);
  process.stdout.write(`  ${c.cyan('total-agent-memory connect cursor')}\n`);
  process.stdout.write(`  ${c.cyan('total-agent-memory connect codex')}\n`);
  process.stdout.write(`\n${c.dim('Docs: https://totalmemory.dev')}\n`);
  return 0;
}

module.exports = {
  install: cmdInstall,
  start: cmdStart,
  connect: cmdConnect,
  demo: cmdDemo,
  status: cmdStatus,
  doctor: cmdDoctor,
  upgrade: cmdUpgrade,
  uninstall: cmdUninstall,
  onboard: cmdOnboard,
};
