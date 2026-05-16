'use strict';

// Library facade so users can `require('total-agent-memory')` and drive
// the wrapper from JS as well. Useful for postinstall scripts and CI.

const cmds = require('./commands');
const { diagnose } = require('./doctor');
const { mcpEntry, SUPPORTED } = require('./ide');
const { memoryDir, venvDir, venvBin } = require('./paths');
const { install, pinned } = require('./install');

module.exports = {
  ...cmds,
  diagnose,
  mcpEntry,
  SUPPORTED_IDES: SUPPORTED,
  memoryDir,
  venvDir,
  venvBin,
  installServer: install,
  pinnedVersion: pinned,
};
