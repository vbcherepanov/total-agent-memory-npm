'use strict';

// Minimal CLI parser. Supports:
//   <command> <positional...>
//   --flag, --flag=value, --flag value
//   -shortflag, -shortflag value
//   bare positionals collected in order.

const FLAGS_WITH_VALUE = new Set([
  '--server-version',
  '--source',
  '--memory-dir',
  '--ide',
  '--port',
  '--log-level',
]);

function normalize(name) {
  return name.replace(/^-+/, '');
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  let command = null;

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok) continue;
    if (tok === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      let key, val;
      if (eq !== -1) {
        key = tok.slice(0, eq);
        val = tok.slice(eq + 1);
      } else {
        key = tok;
        if (FLAGS_WITH_VALUE.has(key) && argv[i + 1] && !argv[i + 1].startsWith('-')) {
          val = argv[++i];
        } else {
          val = true;
        }
      }
      flags[normalize(key)] = val;
      continue;
    }
    if (tok.startsWith('-') && tok.length > 1) {
      // Short flag(s). We treat each separately and they take no value
      // except the well-known -v/--version mapping.
      const short = tok.slice(1);
      flags[short] = true;
      continue;
    }
    if (command === null) {
      command = tok;
    } else {
      positional.push(tok);
    }
  }

  // Normalize aliases.
  if (flags.y) flags.yes = true;
  if (flags.h) flags.help = true;

  return { command, positional, flags };
}

module.exports = { parseArgs };
