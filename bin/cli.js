#!/usr/bin/env node
// total-agent-memory CLI — Node wrapper around the Python MCP server.
// Zero runtime dependencies, fast cold start, works on macOS / Linux / Windows.

'use strict';

const { parseArgs } = require('../lib/args');
const { c, banner, dim, bold } = require('../lib/style');
const cmds = require('../lib/commands');

const VERSION = require('../package.json').version;

const HELP = `${banner()}

${bold('Usage:')}  total-agent-memory <command> [options]
        ${dim('alias:')} tam <command> [options]

${bold('Commands:')}
  install            Install Python server + autostart dashboard/reflection
  start              Start the MCP server (default if no command)
  connect <ide>      Wire memory into an IDE config
                     ${dim('claude-code | codex | cursor | cline | continue')}
                     ${dim('aider | windsurf | gemini-cli | opencode')}
  dashboard <sub>    Manage background services
                     ${dim('install | uninstall | start | stop | restart')}
                     ${dim('status  | logs       | open')}
  demo               Seed demo session + run a recall to prove it works
  status             Health check + tool count + DB stats + service status
  doctor             Diagnose environment (python, uv, ports, configs)
  upgrade            Upgrade to the latest server version
  uninstall          Remove ~/.tam, services, and IDE wirings
  version            Print version
  help               Show this message

${bold('Options:')}
  --version, -v         Print npm wrapper version
  --server-version <v>  Pin server version (default: latest)
  --source <pypi|git>   Where to install from (default: auto)
  --memory-dir <path>   Override install dir (default: ~/.tam)
  --no-services         Skip dashboard/reflection autostart during install
  --allow-temp-services Allow services for a --memory-dir under the system temp dir
  --yes, -y             Skip prompts
  --no-color            Disable ANSI colors
  --verbose             Print every shell command

${bold('Examples:')}
  ${c.dim('# One-shot: install everything (server + dashboard + reflection)')}
  ${c.dim('# and wire Claude Code:')}
  npx -y total-agent-memory connect claude-code
  ${c.dim('# → open http://127.0.0.1:37737 for the dashboard')}

  ${c.dim('# Check that all services are running:')}
  npx total-agent-memory dashboard status

  ${c.dim('# Install server only, skip auto-services:')}
  npx -y total-agent-memory install --no-services

  ${c.dim('# Pin a specific server version:')}
  npx -y total-agent-memory install --server-version 12.3.0

${bold('Docs:')}  https://totalmemory.dev
${bold('Repo:')}  https://github.com/vbcherepanov/total-agent-memory
`;

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);

  if (parsed.flags.version || parsed.flags.v) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (parsed.command === 'version') {
    process.stdout.write(`total-agent-memory v${VERSION}\n`);
    return 0;
  }
  if (parsed.command === 'help' || parsed.flags.help || parsed.flags.h) {
    process.stdout.write(HELP);
    return 0;
  }

  const ctx = {
    flags: parsed.flags,
    positional: parsed.positional,
    wrapperVersion: VERSION,
  };

  const cmd = parsed.command || 'onboard';
  const fn = cmds[cmd];
  if (!fn) {
    process.stderr.write(`${c.red('error')}: unknown command "${cmd}"\n`);
    process.stderr.write(HELP);
    return 2;
  }
  return await fn(ctx);
}

main()
  .then((code) => process.exit(code || 0))
  .catch((err) => {
    process.stderr.write(`${c.red('fatal')}: ${err && err.message ? err.message : err}\n`);
    if (process.env.TAM_DEBUG || process.argv.includes('--verbose')) {
      process.stderr.write(`${err && err.stack ? err.stack : ''}\n`);
    }
    process.exit(1);
  });
