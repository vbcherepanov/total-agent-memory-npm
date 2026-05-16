'use strict';

const noColor =
  process.argv.includes('--no-color') ||
  process.env.NO_COLOR === '1' ||
  process.env.TERM === 'dumb' ||
  !process.stdout.isTTY;

function wrap(open, close) {
  return (s) => (noColor ? String(s) : `\x1b[${open}m${s}\x1b[${close}m`);
}

const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

function bold(s) { return c.bold(s); }
function dim(s) { return c.dim(s); }

function banner() {
  const v = require('../package.json').version;
  const line = c.cyan('total-agent-memory');
  return `\n${c.bold(line)}  ${c.dim(`v${v}`)}  ${c.dim('— persistent memory for AI coding agents')}\n`;
}

function step(n, total, msg) {
  return `${c.dim(`[${n}/${total}]`)} ${msg}`;
}

function ok(msg) { return `${c.green('✓')} ${msg}`; }
function fail(msg) { return `${c.red('✗')} ${msg}`; }
function warn(msg) { return `${c.yellow('!')} ${msg}`; }
function info(msg) { return `${c.cyan('›')} ${msg}`; }

module.exports = { c, bold, dim, banner, step, ok, fail, warn, info };
