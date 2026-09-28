'use strict';

// Client registration is done by the Python package (`tam setup register`,
// src/setup_wizard/register.py): the same code install.sh, install.ps1 and the
// setup wizard use, so every client gets the config file it actually reads.

const { spawnSync } = require('child_process');
const { memoryDir, venvBin, exists } = require('./paths');

const SUPPORTED = [
  'claude-code',
  'claude-desktop',
  'codex',
  'cursor',
  'cline',
  'continue',
  'aider',
  'windsurf',
  'gemini-cli',
  'opencode',
];

// Exit code of the probe below when the installed server predates `tam setup register`.
const PROBE_MISSING = 3;
const REGISTER_PROBE =
  "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('src.setup_wizard.register') else 3)";

function mcpEntry(flags) {
  return {
    command: venvBin(flags, 'total-agent-memory'),
    args: [],
    env: {
      MEMORY_MODE: 'fast',
    },
  };
}

function registerArgs(ide, flags) {
  const entry = mcpEntry(flags);
  const env = Object.entries(entry.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
  return ['setup', 'register', '--client', ide, '--memory-dir', memoryDir(flags), '--command', entry.command, ...env];
}

function connect(ide, flags) {
  if (!SUPPORTED.includes(ide)) {
    throw new Error(`unsupported IDE: ${ide}. Supported: ${SUPPORTED.join(', ')}`);
  }
  const tam = venvBin(flags, 'tam');
  const python = venvBin(flags, 'python');
  if (!exists(tam) || !exists(python)) {
    throw new Error(`the server is not installed in ${memoryDir(flags)}; run \`npx total-agent-memory install\` first`);
  }
  const probe = spawnSync(python, ['-c', REGISTER_PROBE], { encoding: 'utf8' });
  if (probe.status === PROBE_MISSING) {
    throw new Error('the installed server is too old to register clients; reinstall it with --server-version latest');
  }
  if (probe.status !== 0) {
    throw new Error(`could not inspect the installed server: ${(probe.stderr || '').trim() || `exit ${probe.status}`}`);
  }
  const result = spawnSync(tam, registerArgs(ide, flags), { encoding: 'utf8', env: process.env });
  if (result.error) {
    throw new Error(`could not run ${tam}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || '').trim() || `tam setup register exited with ${result.status}`);
  }
  return { output: result.stdout };
}

module.exports = { SUPPORTED, connect, mcpEntry, registerArgs };
