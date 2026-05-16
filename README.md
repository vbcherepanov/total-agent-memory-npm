# total-agent-memory

> Persistent memory for Claude Code, Codex CLI, Cursor, Cline and any MCP client.
> Local-first. Hits **#5 on LoCoMo** and **96.2% R@5 on LongMemEval**.

```bash
npx -y total-agent-memory
```

That's it. One command bootstraps a Python virtual env in `~/.claude-memory/`,
installs the MCP server, and prints next-step instructions for wiring your IDE.

## Quick start

```bash
# Onboard (install + show next steps)
npx -y total-agent-memory

# Or explicit
npx -y total-agent-memory install
npx -y total-agent-memory connect claude-code
npx -y total-agent-memory connect cursor
npx -y total-agent-memory connect codex
npx -y total-agent-memory status
```

Alias: `tam` (same binary).

## Commands

| Command | What it does |
|---|---|
| `install`         | Create venv, install Python server. Idempotent. |
| `start`           | Run the MCP server (stdin/stdout). |
| `connect <ide>`   | Wire an IDE config. `claude-code` `codex` `cursor` `cline` `continue` `windsurf` `gemini-cli` `opencode` `aider` |
| `demo`            | Health-check end-to-end. |
| `status`          | Print install paths, DB size. |
| `doctor`          | Diagnose Python/uv/git on PATH. |
| `upgrade`         | Pull the latest server version. |
| `uninstall`       | Remove `~/.claude-memory` (needs `--yes`). |

## Options

| Flag | Meaning |
|---|---|
| `--server-version 11.2.2` | Pin a specific server release. |
| `--source pypi\|git`       | Force install source. Default: PyPI with GitHub fallback. |
| `--memory-dir /path`      | Override install dir (default `~/.claude-memory`). |
| `--yes`                   | Skip prompts (needed for `uninstall`). |
| `--no-color`              | Disable ANSI. |
| `--verbose`               | Print every shell command. |

## Requirements

- **Node ≥ 18** (you already have it if you're reading this).
- **Python ≥ 3.10** on PATH. The wrapper will tell you how to install it if missing.
- Optional: **[uv](https://docs.astral.sh/uv/)** — 10× faster installs, auto-detected.

## What gets installed

```
~/.claude-memory/
├── .venv/                   # isolated Python env
│   └── bin/claude-total-memory   # MCP server entry-point
└── memory.db                # SQLite — your memory lives here
```

Nothing global is touched. Uninstall with `tam uninstall --yes`.

## Links

- Site: <https://totalmemory.dev>
- Server source: <https://github.com/vbcherepanov/total-agent-memory>
- PyPI package: `claude-total-memory`

## License

MIT
