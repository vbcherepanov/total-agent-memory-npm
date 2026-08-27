'use strict';

const fs = require('fs');
const path = require('path');
const { runOrThrow, run, which } = require('./sh');
const { memoryDir, venvDir, venvBin, ensureDir, exists } = require('./paths');
const { diagnose, pickInstaller, printReport, printRemediation } = require('./doctor');
const { installServices } = require('./services');
const { c, bold, ok, fail, warn, info, step } = require('./style');

const PYPI_PACKAGE = 'total-agent-memory';
// Pinned to the latest stable release at the time of the wrapper release.
// Override via `--server-version` or env TAM_SERVER_VERSION.
const DEFAULT_SERVER_VERSION = '13.0.0';
const GIT_URL = 'https://github.com/vbcherepanov/total-agent-memory.git';

function pinned(flags) {
  return (
    (flags && flags['server-version']) ||
    process.env.TAM_SERVER_VERSION ||
    DEFAULT_SERVER_VERSION
  );
}

function specPyPI(flags) {
  const v = pinned(flags);
  return v && v !== 'latest' ? `${PYPI_PACKAGE}==${v}` : PYPI_PACKAGE;
}

function specGit(flags) {
  const v = pinned(flags);
  const tag = v && v !== 'latest' ? `@v${v}` : '';
  return `git+${GIT_URL}${tag}`;
}

async function pypiHas(version) {
  // We can't import https here cheaply — use built-in for HEAD.
  return await new Promise((resolve) => {
    const https = require('https');
    const url = version
      ? `https://pypi.org/pypi/${PYPI_PACKAGE}/${version}/json`
      : `https://pypi.org/pypi/${PYPI_PACKAGE}/json`;
    const req = https.get(url, (res) => {
      // Drain.
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(4000, () => { req.destroy(); resolve(false); });
  });
}

async function pickSource(flags) {
  const explicit = flags && flags.source;
  if (explicit === 'pypi' || explicit === 'git') return explicit;
  // Auto: try PyPI first, fall back to git.
  if (await pypiHas(pinned(flags))) return 'pypi';
  return 'git';
}

async function createVenv(flags, env) {
  const venv = venvDir(flags);
  if (exists(path.join(venv, process.platform === 'win32' ? 'Scripts' : 'bin'))) {
    return;
  }
  ensureDir(memoryDir(flags));

  if (env.uv) {
    await runOrThrow('uv', ['venv', venv, '--python', '3.12'], { silent: true });
    return;
  }
  await runOrThrow('python3', ['-m', 'venv', venv], { silent: true });
}

async function pipInstall(flags, env, source) {
  const spec = source === 'pypi' ? specPyPI(flags) : specGit(flags);
  process.stdout.write(`${info(`Installing ${c.bold(spec)} (source: ${source})…`)}\n`);

  // Dev-only: skip the actual pip step so CI / smoke tests can validate the
  // wrapper end-to-end without downloading ~1.5GB of ML deps.
  if (process.env.TAM_INSTALL_DRY === '1') {
    process.stdout.write(`  ${warn('TAM_INSTALL_DRY=1 — skipping real pip install')}\n`);
    // Drop a marker file so subsequent steps don't barf on missing bin.
    const fs = require('fs');
    const markerDir = path.dirname(venvBin(flags, 'total-agent-memory'));
    fs.mkdirSync(markerDir, { recursive: true });
    fs.writeFileSync(venvBin(flags, 'total-agent-memory'), '#!/bin/sh\necho "dry-run shim"\n');
    fs.chmodSync(venvBin(flags, 'total-agent-memory'), 0o755);
    return;
  }

  if (env.uv) {
    // uv pip is dramatically faster.
    const pyExe = venvBin(flags, 'python');
    await runOrThrow('uv', ['pip', 'install', '--python', pyExe, '--upgrade', spec]);
    return;
  }
  const pipExe = venvBin(flags, 'pip');
  await runOrThrow(pipExe, ['install', '--upgrade', '--disable-pip-version-check', spec]);
}

async function install(ctx) {
  const flags = ctx.flags;
  const env = await diagnose();
  printReport(env);

  const picker = pickInstaller(env);
  if (!picker) {
    process.stderr.write(`\n${fail('cannot proceed: missing python3 ≥ 3.10')}\n`);
    printRemediation(env);
    return 1;
  }

  const totalSteps = flags['no-services'] ? 3 : 4;
  process.stdout.write(`\n${bold('Installing server…')}\n`);
  process.stdout.write(`  ${step(1, totalSteps, `venv  → ${c.dim(venvDir(flags))}`)}\n`);
  await createVenv(flags, env);
  process.stdout.write(`  ${ok('venv ready')}\n`);

  process.stdout.write(`  ${step(2, totalSteps, 'resolving source (PyPI → GitHub fallback)…')}\n`);
  const source = await pickSource(flags);

  process.stdout.write(`  ${step(3, totalSteps, 'pip install…')}\n`);
  await pipInstall(flags, env, source);

  // Verify entry-point present.
  const bin = venvBin(flags, 'total-agent-memory');
  if (!exists(bin)) {
    process.stderr.write(`\n${fail(`entry-point ${bin} not found after install`)}\n`);
    return 1;
  }

  // Step 4 — register background services (dashboard + reflection) unless
  // explicitly opted out. Failure here is non-fatal: the server itself is
  // installed, the user can re-run `npx total-agent-memory dashboard install`.
  if (!flags['no-services']) {
    process.stdout.write(`  ${step(4, totalSteps, 'background services (dashboard + reflection)…')}\n`);
    try {
      await installServices(flags, { dryRun: process.env.TAM_INSTALL_DRY === '1' });
    } catch (e) {
      process.stdout.write(`  ${warn(`services install failed: ${e.message}`)}\n`);
      process.stdout.write(`  ${info(`Retry later with: ${c.cyan('npx total-agent-memory dashboard install')}`)}\n`);
    }
  } else {
    process.stdout.write(`  ${info('--no-services set — skipping dashboard/reflection autostart')}\n`);
  }

  process.stdout.write(`\n${ok(c.bold('Installation complete.'))}\n`);
  process.stdout.write(`${info(`Binary:    ${c.dim(bin)}`)}\n`);
  if (!flags['no-services']) {
    process.stdout.write(`${info(`Dashboard: ${c.cyan('http://127.0.0.1:37737')}`)}\n`);
  }
  return 0;
}

module.exports = { install, venvBin, pinned, DEFAULT_SERVER_VERSION, PYPI_PACKAGE };
