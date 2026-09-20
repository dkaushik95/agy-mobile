# OpenCode Mobile

OpenCode Mobile is a web interface and system tray utility for interacting with OpenCode / Antigravity agents. It allows you to monitor and manage coding sessions, send prompts, inspect tool execution, and view system telemetry from a convenient mobile-optimized terminal interface.

## Project Structure

- `server.js`: Node.js Express server with WebSockets for managing agent interactions.
- `tray.py`: PyQt6 system tray utility to start/stop the `opencode-mobile.service`. Doubles as the JSON CLI helper for the Omarchy panel (`status-json`, `confirm-pin`, `unpair`).
- `Panel.qml`: Omarchy/Quickshell desktop bar plugin (pairing + server controls).
- `manifest.json`: Omarchy plugin manifest (`id: custom.opencode-mobile`, kind `bar-widget`).
- `frontend/`: React + Vite frontend application.

## Prerequisites

- Node.js (v18+)
- Python 3 with PyQt6
- `opencode` or `agy` CLI installed and in your PATH.
- (Optional) `opencode-mobile.service` systemd user service configured for the tray app to control.

## Environment Variables & Configuration

- `OPENCODE_MOBILE_TOKEN`: Secret token required for remote requests via `Authorization: Bearer <token>` or `?token=<token>` on WebSocket / API.
- `DEV_NO_AUTH`: Set to `1` to enable zero-config local development mode for `127.0.0.1` / localhost without requiring a token.
- `ALLOWED_NETS`: Comma-separated CIDR allowlist for client IPs (default: `127.0.0.0/8, ::1, 100.64.0.0/10, 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12`).
- `ALLOWED_CWDS`: Comma-separated directory paths permitted for agent execution (default: `$HOME`).
- `ALLOW_UNSAFE_AGENT`: Set to `1` to grant authenticated clients full agent access. The backend then launches `opencode run` with `--auto` (auto-approve, the 1.18 replacement for `--dangerously-skip-permissions`). Requires `OPENCODE_MOBILE_TOKEN` or local mode.
- `VAPID_MAILTO`: Email contact for Web Push VAPID headers (default: `mailto:admin@localhost`).

Device pairing state is stored in `~/.local/state/opencode-mobile/paired_devices.json` (owner-only permissions). Device tokens are never written to disk in plaintext — only salted PBKDF2 hashes are stored, so a leaked file yields no usable credentials. Existing plaintext stores are migrated automatically on first start under the new scheme.

## How to Run

### Backend
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   node server.js
   ```

### Frontend
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
4. To build for production (served by the backend):
   ```bash
   npm run build
   ```

### System Tray Utility
1. Ensure PyQt6 is installed (`pip install PyQt6`).
2. Run the tray script:
   ```bash
   python tray.py
   ```

## Omarchy Plugin

The repository root doubles as an [Omarchy](https://omarchy.org/) shell plugin
(`custom.opencode-mobile`, a `bar-widget` panel for pairing devices and
controlling the server). The panel resolves its helper (`tray.py`) relative to
its own install location, so it works from a git checkout, a manual copy, or an
`omarchy plugin add` clone.

Validate the plugin folder against the Omarchy manifest schema:

```bash
omarchy plugin validate .
```

Install from this repository (after pushing it somewhere git can reach):

```bash
omarchy plugin add <git-url-of-this-repo> --enable
```

The plugin needs `tray.py` next to `Panel.qml` on the same host as the
`opencode-mobile.service` user unit for the Start/Stop and pairing controls to
work.
