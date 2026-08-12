# AGY Mobile

AGY Mobile is a web interface and system tray utility for interacting with the Antigravity (AGY) CLI. It allows you to monitor and manage AGY sessions, send prompts, and view telemetry data from a convenient web interface, optimized for mobile.

## Project Structure

- `server.js`: Node.js Express server with WebSockets for managing Antigravity interactions.
- `tray.py`: PyQt6 system tray utility to start/stop the `agy-mobile.service`.
- `frontend/`: React + Vite frontend application.

## Prerequisites

- Node.js (v18+)
- Python 3 with PyQt6
- `agy` (Antigravity CLI) installed and in your PATH.
- (Optional) `agy-mobile.service` systemd user service configured for the tray app to control.

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
