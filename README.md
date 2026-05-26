# total-agent-memory

> Persistent memory for Claude Code, Codex CLI, Cursor, Cline and any MCP client.
> Local-first. Hits **#5 on LoCoMo** and **96.2% R@5 on LongMemEval**.

```bash
npx -y total-agent-memory connect claude-code
# → server installed in ~/.tam, IDE wired, dashboard live at
#   http://127.0.0.1:37737
```

One command bootstraps a Python virtual env in `~/.tam/`, installs the
MCP server **and** registers two background services with your OS:

- **Dashboard** — web UI on `http://127.0.0.1:37737` (LaunchAgent on macOS,
  systemd-user unit on Linux, Scheduled Task on Windows). Survives reboot.
- **Reflection** — file-watch drain of the reflection queues. Fires
  whenever the server touches `~/.tam/.reflect-pending` (debounce 10s).

Pass `--no-services` to skip the auto-service install.

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
| `install`         | Create venv, install Python server, register dashboard + reflection services. Idempotent. |
| `start`           | Run the MCP server (stdin/stdout). |
| `connect <ide>`   | Wire an IDE config. `claude-code` `codex` `cursor` `cline` `continue` `windsurf` `gemini-cli` `opencode` `aider` |
| `dashboard <sub>` | Manage background services: `install`, `uninstall`, `start`, `stop`, `restart`, `status`, `logs`, `open`. |
| `demo`            | Health-check end-to-end. |
| `status`          | Print install paths, DB size, **service status, dashboard HTTP probe**. |
| `doctor`          | Diagnose Python/uv/git on PATH. |
| `upgrade`         | Pull the latest server version. |
| `uninstall`       | Remove `~/.tam` and unregister all services (needs `--yes`). |

## Options

| Flag | Meaning |
|---|---|
| `--server-version 12.3.0` | Pin a specific server release. |
| `--source pypi\|git`       | Force install source. Default: PyPI with GitHub fallback. |
| `--memory-dir /path`      | Override install dir (default `~/.tam`). |
| `--no-services`           | Skip dashboard / reflection auto-install. |
| `--yes`                   | Skip prompts (needed for `uninstall`). |
| `--no-color`              | Disable ANSI. |
| `--verbose`               | Print every shell command. |

## Requirements

- **Node ≥ 18** (you already have it if you're reading this).
- **Python ≥ 3.10** on PATH. The wrapper will tell you how to install it if missing.
- Optional: **[uv](https://docs.astral.sh/uv/)** — 10× faster installs, auto-detected.

## What gets installed

```
~/.tam/
├── .venv/                   # isolated Python env
│   └── bin/total-agent-memory   # MCP server entry-point
├── logs/
│   ├── dashboard.log
│   └── reflection.log
├── memory.db                # SQLite — your memory lives here
└── .reflect-pending         # touched on every save → triggers reflection
```

Background services registered with your OS:

| OS      | Location                                                                 |
|---------|--------------------------------------------------------------------------|
| macOS   | `~/Library/LaunchAgents/com.total-agent-memory.{dashboard,reflection}.plist` |
| Linux   | `~/.config/systemd/user/tam-{dashboard,reflection}.{service,path}`       |
| Windows | Task Scheduler — `TotalAgentMemory-dashboard` (reflection: manual)       |

Nothing system-wide. Uninstall with `tam uninstall --yes` (removes services first).

### Verify

```bash
tam dashboard status
# ● dashboard    running
# ◉ reflection   watching
# ✓ HTTP http://127.0.0.1:37737 → 200
```

## Links

- Site: <https://totalmemory.dev>
- Server source: <https://github.com/vbcherepanov/total-agent-memory>
- PyPI package: `total-agent-memory` (legacy `claude-total-memory` is now a deprecation shim)

## License

MIT
