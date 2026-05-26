'use strict';

const path = require('path');
const fs = require('fs');
const { home, memoryDir, venvBin, exists, readJSONSafe, writeJSON, ensureDir } = require('./paths');
const { c, ok, info, warn } = require('./style');

const SUPPORTED = [
  'claude-code',
  'codex',
  'cursor',
  'cline',
  'continue',
  'aider',
  'windsurf',
  'gemini-cli',
  'opencode',
];

function mcpEntry(flags) {
  const bin = venvBin(flags, 'total-agent-memory');
  return {
    command: bin,
    args: [],
    env: {
      MEMORY_MODE: 'fast',
    },
  };
}

function claudeCodePath() {
  return path.join(home(), '.claude.json');
}

function cursorPath() {
  return path.join(home(), '.cursor', 'mcp.json');
}

function clinePath() {
  // Cline reads VSCode global state, but for portability we use its public
  // config file location when present.
  return path.join(home(), '.cline', 'mcp.json');
}

function continuePath() {
  return path.join(home(), '.continue', 'config.json');
}

function codexPath() {
  return path.join(home(), '.codex', 'config.toml');
}

function geminiPath() {
  return path.join(home(), '.gemini', 'settings.json');
}

function windsurfPath() {
  return path.join(home(), '.codeium', 'windsurf', 'mcp_config.json');
}

function aiderPath() {
  return path.join(home(), '.aider.conf.yml');
}

function opencodePath() {
  return path.join(home(), '.config', 'opencode', 'config.json');
}

function mergeMcpServers(file, name, entry) {
  const cfg = readJSONSafe(file) || {};
  cfg.mcpServers = cfg.mcpServers || {};
  cfg.mcpServers[name] = entry;
  writeJSON(file, cfg);
}

function wireClaudeCode(flags) {
  mergeMcpServers(claudeCodePath(), 'total-agent-memory', mcpEntry(flags));
  return claudeCodePath();
}
function wireCursor(flags) {
  ensureDir(path.dirname(cursorPath()));
  mergeMcpServers(cursorPath(), 'total-agent-memory', mcpEntry(flags));
  return cursorPath();
}
function wireCline(flags) {
  ensureDir(path.dirname(clinePath()));
  mergeMcpServers(clinePath(), 'total-agent-memory', mcpEntry(flags));
  return clinePath();
}
function wireContinue(flags) {
  ensureDir(path.dirname(continuePath()));
  const cfg = readJSONSafe(continuePath()) || {};
  cfg.mcpServers = cfg.mcpServers || [];
  cfg.mcpServers = cfg.mcpServers.filter((s) => s.name !== 'total-agent-memory');
  cfg.mcpServers.push({ name: 'total-agent-memory', ...mcpEntry(flags) });
  writeJSON(continuePath(), cfg);
  return continuePath();
}
function wireWindsurf(flags) {
  ensureDir(path.dirname(windsurfPath()));
  mergeMcpServers(windsurfPath(), 'total-agent-memory', mcpEntry(flags));
  return windsurfPath();
}
function wireGeminiCLI(flags) {
  ensureDir(path.dirname(geminiPath()));
  mergeMcpServers(geminiPath(), 'total-agent-memory', mcpEntry(flags));
  return geminiPath();
}
function wireOpenCode(flags) {
  ensureDir(path.dirname(opencodePath()));
  mergeMcpServers(opencodePath(), 'total-agent-memory', mcpEntry(flags));
  return opencodePath();
}
function wireCodex(flags) {
  ensureDir(path.dirname(codexPath()));
  const bin = venvBin(flags, 'total-agent-memory');
  const block = `

[mcp_servers.total-agent-memory]
command = ${JSON.stringify(bin)}
args = []
env = { MEMORY_MODE = "fast" }
`;
  let prev = '';
  try { prev = fs.readFileSync(codexPath(), 'utf8'); } catch (_) { /* fresh */ }
  if (prev.includes('[mcp_servers.total-agent-memory]')) {
    return codexPath(); // already wired
  }
  fs.writeFileSync(codexPath(), prev + block);
  return codexPath();
}
function wireAider() {
  return aiderPath() + ' (manual: aider does not yet support MCP; use lookup-memory CLI instead)';
}

function connect(ide, flags) {
  switch (ide) {
    case 'claude-code': return { file: wireClaudeCode(flags) };
    case 'codex': return { file: wireCodex(flags) };
    case 'cursor': return { file: wireCursor(flags) };
    case 'cline': return { file: wireCline(flags) };
    case 'continue': return { file: wireContinue(flags) };
    case 'windsurf': return { file: wireWindsurf(flags) };
    case 'gemini-cli': return { file: wireGeminiCLI(flags) };
    case 'opencode': return { file: wireOpenCode(flags) };
    case 'aider': return { file: wireAider(flags), manual: true };
    default: throw new Error(`unsupported IDE: ${ide}. Supported: ${SUPPORTED.join(', ')}`);
  }
}

module.exports = { SUPPORTED, connect, mcpEntry };
