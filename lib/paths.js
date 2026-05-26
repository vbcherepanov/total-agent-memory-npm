'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

function home() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

let _warnedLegacyEnv = false;

function memoryDir(flags) {
  if (flags && typeof flags['memory-dir'] === 'string') return flags['memory-dir'];
  if (process.env.TAM_MEMORY_DIR) return process.env.TAM_MEMORY_DIR;
  if (process.env.CLAUDE_MEMORY_DIR) {
    if (!_warnedLegacyEnv) {
      // eslint-disable-next-line no-console
      console.warn('  ⚠ CLAUDE_MEMORY_DIR is deprecated, please switch to TAM_MEMORY_DIR');
      _warnedLegacyEnv = true;
    }
    return process.env.CLAUDE_MEMORY_DIR;
  }
  const tam = path.join(home(), '.tam');
  const legacy = path.join(home(), '.claude-memory');
  if (fs.existsSync(tam)) return tam;
  if (fs.existsSync(legacy)) return legacy; // Python server will migrate on first run.
  return tam;
}

function venvDir(flags) {
  return path.join(memoryDir(flags), '.venv');
}

function venvBin(flags, name) {
  const sub = process.platform === 'win32' ? 'Scripts' : 'bin';
  const ext = process.platform === 'win32' && !name.endsWith('.exe') ? '.exe' : '';
  return path.join(venvDir(flags), sub, name + ext);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch (_) { return false; }
}

function readJSONSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function writeJSON(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

module.exports = { home, memoryDir, venvDir, venvBin, ensureDir, exists, readJSONSafe, writeJSON };
