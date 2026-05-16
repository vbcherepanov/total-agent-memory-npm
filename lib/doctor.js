'use strict';

const { probe, which } = require('./sh');
const { exists } = require('./paths');
const { c, bold, ok, fail, warn, info } = require('./style');

// Returns environment summary.
async function diagnose() {
  const env = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    python: null,
    python3: null,
    uv: null,
    pip: null,
    pipx: null,
    git: null,
  };

  for (const bin of ['python3', 'python', 'uv', 'pipx', 'git']) {
    const r = probe(bin, ['--version']);
    if (r.ok) {
      env[bin] = { path: r.path, version: r.out };
    }
  }
  if (env.python3 && env.python3.version) {
    const m = env.python3.version.match(/(\d+)\.(\d+)\.(\d+)/);
    if (m) {
      env.pythonMajor = +m[1];
      env.pythonMinor = +m[2];
      env.pythonPatch = +m[3];
    }
  }
  return env;
}

function pickInstaller(env) {
  // Prefer uv (fastest, most reliable). Fall back to venv+pip.
  if (env.uv) return 'uv';
  if (env.python3 && env.pythonMajor >= 3 && env.pythonMinor >= 10) return 'venv-pip';
  return null;
}

function printReport(env) {
  process.stdout.write(`\n${bold('Environment')}\n`);
  process.stdout.write(`  ${info(`platform : ${env.platform}/${env.arch}`)}\n`);
  process.stdout.write(`  ${info(`node     : ${env.node}`)}\n`);
  if (env.python3) {
    process.stdout.write(`  ${ok(`python3  : ${env.python3.version} ${c.dim('(' + env.python3.path + ')')}`)}\n`);
  } else {
    process.stdout.write(`  ${fail('python3  : not found')}\n`);
  }
  if (env.uv) {
    process.stdout.write(`  ${ok(`uv       : ${env.uv.version} ${c.dim('(' + env.uv.path + ')')}`)}\n`);
  } else {
    process.stdout.write(`  ${warn('uv       : not found (optional but recommended — 10× faster installs)')}\n`);
  }
  if (env.git) {
    process.stdout.write(`  ${ok(`git      : ${env.git.version}`)}\n`);
  } else {
    process.stdout.write(`  ${warn('git      : not found (needed only for --source git fallback)')}\n`);
  }
  return env;
}

function printRemediation(env) {
  if (!env.python3) {
    process.stdout.write(`\n${bold('Install Python 3.10+:')}\n`);
    if (process.platform === 'darwin') {
      process.stdout.write(`  ${c.cyan('brew install python@3.12')}\n`);
    } else if (process.platform === 'linux') {
      process.stdout.write(`  ${c.cyan('sudo apt install -y python3 python3-venv python3-pip')}    ${c.dim('# Debian/Ubuntu')}\n`);
      process.stdout.write(`  ${c.cyan('sudo dnf install -y python3 python3-pip')}                 ${c.dim('# Fedora/RHEL')}\n`);
    } else if (process.platform === 'win32') {
      process.stdout.write(`  ${c.cyan('winget install Python.Python.3.12')}\n`);
    }
  }
  if (env.python3 && !env.uv) {
    process.stdout.write(`\n${bold('Optional — install uv for 10× faster installs:')}\n`);
    process.stdout.write(`  ${c.cyan('curl -LsSf https://astral.sh/uv/install.sh | sh')}\n`);
  }
}

module.exports = { diagnose, pickInstaller, printReport, printRemediation };
