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
    ollama: null,
  };

  for (const bin of ['python3', 'python', 'uv', 'pipx', 'git', 'ollama']) {
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
  // Probe Ollama HTTP — works whether installed via brew, the .app, or
  // running in Docker. We hit /api/tags (cheap, always-available).
  env.ollamaHttp = await probeOllamaHttp();
  return env;
}

async function probeOllamaHttp(timeoutMs = 1500) {
  const host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  const url = host.endsWith('/') ? host + 'api/tags' : host + '/api/tags';
  return await new Promise((resolve) => {
    try {
      const http = url.startsWith('https') ? require('https') : require('http');
      const req = http.get(url, (res) => {
        let body = '';
        res.on('data', (d) => { body += d.toString(); });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve({ ok: false, status: res.statusCode, host });
            return;
          }
          let models = [];
          try {
            const j = JSON.parse(body);
            models = (j.models || []).map((m) => m.name);
          } catch (_) {}
          resolve({ ok: true, host, models, modelCount: models.length });
        });
      });
      req.on('error', () => resolve({ ok: false, host, error: 'unreachable' }));
      req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, host, error: 'timeout' }); });
    } catch (e) {
      resolve({ ok: false, host, error: String(e) });
    }
  });
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
  // Ollama — optional but unlocks LLM-powered enrichment (deep entity
  // extraction, summarisation, contradiction detection). Without it the
  // server still works in degraded mode: FTS5 + embeddings, no LLM stages.
  if (env.ollamaHttp && env.ollamaHttp.ok) {
    const models = env.ollamaHttp.modelCount;
    process.stdout.write(`  ${ok(`ollama   : reachable at ${env.ollamaHttp.host} (${models} model${models === 1 ? '' : 's'})`)}\n`);
  } else if (env.ollama) {
    process.stdout.write(`  ${warn(`ollama   : binary present but daemon not reachable at ${env.ollamaHttp ? env.ollamaHttp.host : 'http://127.0.0.1:11434'}`)}\n`);
    process.stdout.write(`             ${c.dim('start with: ollama serve')}\n`);
  } else {
    process.stdout.write(`  ${warn(`ollama   : not found (optional — needed for LLM enrichment)`)}\n`);
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
  // Suggest Ollama install only if it's missing entirely. If the binary
  // is present but the daemon is down, the printReport message already
  // tells the user to `ollama serve`.
  if (!env.ollama && (!env.ollamaHttp || !env.ollamaHttp.ok)) {
    process.stdout.write(`\n${bold('Optional — install Ollama for local LLM enrichment:')}\n`);
    if (process.platform === 'darwin') {
      process.stdout.write(`  ${c.cyan('brew install ollama && brew services start ollama')}\n`);
    } else if (process.platform === 'linux') {
      process.stdout.write(`  ${c.cyan('curl -fsSL https://ollama.com/install.sh | sh')}\n`);
    } else if (process.platform === 'win32') {
      process.stdout.write(`  ${c.cyan('winget install Ollama.Ollama')}\n`);
    }
    process.stdout.write(`  ${c.cyan('ollama pull qwen2.5-coder:7b && ollama pull nomic-embed-text')}    ${c.dim('# default models')}\n`);
    process.stdout.write(`  ${c.dim('(server still works without Ollama — runs in FTS+embedding mode)')}\n`);
  }
}

module.exports = { diagnose, pickInstaller, printReport, printRemediation };
