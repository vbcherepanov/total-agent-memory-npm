# Changelog

All notable changes to the `total-agent-memory` npm wrapper.

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
