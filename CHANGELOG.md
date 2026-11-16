# Changelog

All notable changes to the `total-agent-memory` npm wrapper.

## [1.10.1] — 2026-11-16

Targets server v15.0.0.

### Changed
- Repository and issue links point to GitHub (`vbcherepanov/total-agent-memory-npm`); the previous host is gone.

## [1.10.0] — 2026-11-16

Targets server v15.0.0. Upgrading the server runs schema migrations on its first start: back up the database first (see the server's `docs/UPGRADE_15.md`).

### Changed
- `DEFAULT_SERVER_VERSION` bumped to `15.0.0`.

## [1.9.4] — 2026-10-26

Targets server v14.10.0.

### Changed
- `DEFAULT_SERVER_VERSION` bumped to `14.10.0`.

## [1.9.3] — 2026-10-14

Targets server v14.9.0.

### Changed
- `DEFAULT_SERVER_VERSION` bumped to `14.9.0`.

## [1.9.2] — 2026-10-08

Targets server v14.8.0.

### Changed
- `DEFAULT_SERVER_VERSION` bumped to `14.8.0`.

## [1.9.1] — 2026-09-30

Targets server v14.7.0.

### Changed
- `DEFAULT_SERVER_VERSION` bumped to `14.7.0`.

## [1.9.0] — 2026-09-28

Targets server v14.6.0. `connect` needs server 14.6.0 or later.

### Changed
- `connect <ide>` registers the client through the server's own
  `tam setup register` (the code `install.sh`, `install.ps1` and the setup
  wizard use), so each client gets the config file it actually reads.
  Against an older server it stops with "the installed server is too old
  to register clients".
- `claude-desktop` is a supported IDE.
- `DEFAULT_SERVER_VERSION` bumped to `14.6.0`.

### Fixed
- Cline and OpenCode were written to `~/.cline/mcp.json` and
  `~/.config/opencode/config.json`, files those clients do not read.
- `connect` rejects an unknown IDE before installing anything.
- Background services are machine-wide, so installing or removing them
  (`install`, `uninstall`, `dashboard install|uninstall`) is refused for a
  `--memory-dir` under the system temp dir unless `--allow-temp-services`
  is passed. `uninstall` reports a service it could not remove instead of
  ignoring the error.

## [1.3.0] — 2026-05-26

Targets server v12.4.0. After `npx total-agent-memory connect <ide>` the
host has all four background services running (was two in 1.2.0):
dashboard, reflection (file-watch), orphan-backfill (4×/day),
check-updates (weekly).

### Added
- `orphan-backfill` and `check-updates` background services. Use
  `StartCalendarInterval` arrays on macOS (00/06/12/18 daily for
  backfill, Sun 03:00 for updates) and systemd `OnCalendar` timers on
  Linux (`00,06,12,18:00:00` / `Sun *-*-* 03:00:00`).
- `tam dashboard status` now prints a new `scheduled` mode (◷) for
  cron-style services.
- `tam doctor` probes Ollama (`/api/tags`) over HTTP — works whether
  installed via brew, the `.app`, or a remote daemon (`OLLAMA_HOST`
  honoured). Suggests `brew install ollama` / `curl … install.sh` /
  `winget install Ollama.Ollama` per platform when missing.
- Idempotent retry on `launchctl bootout → bootstrap` race: 150 ms
  settle plus one retry after 500 ms. Eliminates the "Input/output
  error 5" first-install glitch.

### Changed
- `DEFAULT_SERVER_VERSION` bumped to `12.4.0`.

## [1.2.0] — 2026-05-26

### Added
- **Background services are now installed automatically.** After `npx total-agent-memory connect <ide>` the dashboard (HTTP UI on `127.0.0.1:37737`) and the reflection drain (file-watch) are registered with the host OS supervisor:
  - macOS → LaunchAgent (`~/Library/LaunchAgents/com.total-agent-memory.{dashboard,reflection}.plist`)
  - Linux → systemd `--user` units (`~/.config/systemd/user/tam-{dashboard,reflection}.{service,path}`)
  - Windows → Task Scheduler `onLogon` (dashboard only; reflection prints manual instructions)
- New subcommand `tam dashboard {install|uninstall|start|stop|restart|status|logs|open}`.
- `tam status` now reports service state and probes the dashboard HTTP endpoint.
- New flag `--no-services` for headless / CI installs.
- New library exports: `installServices`, `uninstallServices`, `serviceStatus`, `controlService`, `probeDashboardHealth`.

### Changed
- `DEFAULT_SERVER_VERSION` bumped to `12.3.0`.
- `tam uninstall --yes` now removes background services before deleting `~/.tam` (prevents zombie supervisors trying to respawn against a deleted venv).
- README reflects auto-services and per-OS install locations.

### Fixed
- v1.1.0 left users with MCP-only installs — the dashboard module existed in the PyPI package (`src.dashboard`) but no supervisor was ever wired, so `http://127.0.0.1:37737` never came up after a plain `npx connect`. Reported by clients on 2026-05-26.

## [1.1.0]

- Pinned server version to `12.2.0`.

## [1.0.0]

- Initial public release.
