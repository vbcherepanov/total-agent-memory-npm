'use strict';

const { spawn, spawnSync } = require('child_process');
const { c, dim } = require('./style');

function isVerbose() {
  return process.argv.includes('--verbose') || process.env.TAM_DEBUG === '1';
}

function which(bin) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(cmd, [bin], { encoding: 'utf8' });
  if (r.status === 0) {
    const path = (r.stdout || '').split(/\r?\n/).filter(Boolean)[0];
    return path || null;
  }
  return null;
}

function probe(bin, args = ['--version']) {
  const path = which(bin);
  if (!path) return { ok: false };
  const r = spawnSync(path, args, { encoding: 'utf8' });
  return {
    ok: r.status === 0,
    path,
    out: (r.stdout || '').trim() || (r.stderr || '').trim(),
  };
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    if (isVerbose()) {
      process.stderr.write(
        `${dim('$')} ${[cmd, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n`
      );
    }
    const child = spawn(cmd, args, {
      stdio: opts.silent ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env: { ...process.env, ...(opts.env || {}) },
      cwd: opts.cwd || process.cwd(),
    });
    let stdout = '';
    let stderr = '';
    if (opts.silent) {
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
    }
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', (err) => resolve({ code: 1, stdout, stderr: String(err) }));
  });
}

async function runOrThrow(cmd, args, opts = {}) {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) {
    const err = new Error(`${cmd} ${args.join(' ')} exited with code ${r.code}`);
    err.stdout = r.stdout;
    err.stderr = r.stderr;
    err.code = r.code;
    throw err;
  }
  return r;
}

module.exports = { which, probe, run, runOrThrow, isVerbose };
