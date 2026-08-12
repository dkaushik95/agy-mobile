# Instructions for AI Agents Working on AGY Mobile

This document outlines the architecture and workflow for agents working on the AGY Mobile repository.

## Architecture Overview

This project consists of three main components:
1. **Node.js Backend (`server.js`)**: An Express and WebSocket server that interfaces with the Antigravity (`agy`) CLI. It reads session transcripts from `~/.gemini/antigravity-cli/brain` and forwards them to connected clients. It also provides basic REST APIs for telemetry and file uploads.
2. **React Frontend (`frontend/`)**: A Vite-powered React application using Framer Motion for animations and DOMPurify/Marked for markdown rendering. Built to be mobile-friendly.
3. **System Tray App (`tray.py`)**: A PyQt6-based system tray icon that interacts with systemctl to start and stop the `agy-mobile.service`.

## Development Workflow

- **Backend Changes**: Modify `server.js`. Test by restarting the Node process. Be mindful of how it spawns child processes for `agy`.
- **Frontend Changes**: Navigate to the `frontend/` directory. Use `npm run dev` for hot-reloading. The backend serves the built assets from `frontend/dist` in production, so ensure you run `npm run build` after finalizing frontend changes if testing the full stack via `server.js`.
- **Tray Changes**: Modify `tray.py`. Requires restarting the Python script. Ensure `systemctl --user` commands match the user's environment.

## Key Considerations

- The backend dynamically locates the `agy` executable. When debugging execution issues, verify `AGY_PATH` resolution logic.
- Ensure any new REST API routes in `server.js` are properly prefixed with `/api/` to avoid conflicts with static file serving.
- For UI changes, prioritize a responsive, mobile-first design using the existing Tailwind/React patterns.
