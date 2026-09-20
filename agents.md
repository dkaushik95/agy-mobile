# Instructions for AI Agents Working on OpenCode Mobile

This document outlines the architecture and workflow for agents working on the OpenCode Mobile repository.

## Architecture Overview

This project consists of three main components:
1. **Node.js Backend (`server.js`)**: An Express and WebSocket server that interfaces with OpenCode / Antigravity agents. It queries session records via `better-sqlite3` (`~/.local/share/opencode/opencode.db`) or legacy brain transcripts (`~/.gemini/antigravity-cli/brain`) and streams real-time updates to connected clients.
2. **React Frontend (`frontend/`)**: A Vite-powered React application with an optimized terminal feed, DOMPurify/Marked markdown rendering, and service worker push notification support.
3. **System Tray App (`tray.py`)**: A PyQt6-based system tray icon that interacts with systemctl to start and stop the `opencode-mobile.service`.

## Development Workflow

- **Backend Changes**: Modify `server.js`. Test by restarting the Node process. Be mindful of CIDR IP allowlisting, auth tokens, path security, and child process lifecycle.
- **Frontend Changes**: Navigate to the `frontend/` directory. Use `npm run dev` for hot-reloading. The backend serves the built assets from `frontend/dist` in production, so run `npm run build` after finalizing frontend changes.
- **Tray Changes**: Modify `tray.py`. Requires restarting the Python script. Ensure `systemctl --user` commands match the user's environment.

## Key Considerations

- The backend dynamically resolves CLI binary paths.
- Ensure all REST API routes in `server.js` are properly prefixed with `/api/` and covered by auth and IP middleware.
- Keep agent process lifecycle clean, bounding session memory and avoiding race conditions between successive prompt runs.
