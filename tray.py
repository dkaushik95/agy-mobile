#!/usr/bin/env python3
"""
OpenCode Mobile CLI helper for Omarchy Panel & System Tray.
Supports JSON output commands for Quickshell integration:
  - status-json: Returns server status, IP, URL, active PIN count, and paired devices
  - confirm-pin <pin> [name]: Confirms/pairs a 4-digit PIN challenge from client
  - unpair <device_id>: Unpairs a device
"""

import sys
import os
import json
import socket
import subprocess
import urllib.request
import urllib.error

SERVER_PORT = int(os.environ.get("PORT", 3900))

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def get_service_status():
    try:
        res = subprocess.run(["systemctl", "--user", "is-active", "opencode-mobile.service"], capture_output=True, text=True)
        return res.stdout.strip() == "active"
    except Exception:
        return False

def http_get(path):
    url = f"http://127.0.0.1:{SERVER_PORT}{path}"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=2) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return None

def http_post(path, data):
    url = f"http://127.0.0.1:{SERVER_PORT}{path}"
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            return json.loads(err_body)
        except Exception:
            return {"error": str(e)}
    except Exception as e:
        return {"error": str(e)}

def http_delete(path):
    url = f"http://127.0.0.1:{SERVER_PORT}{path}"
    req = urllib.request.Request(url, method="DELETE")
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}

def cmd_status_json():
    active = get_service_status()
    ip = get_local_ip()
    url = f"http://{ip}:{SERVER_PORT}" if active else ""
    
    active_pins = []
    paired_devices = []
    if active:
        pins_data = http_get("/api/pair/active-pins")
        if isinstance(pins_data, list):
            active_pins = pins_data
        devs_data = http_get("/api/pair/devices")
        if isinstance(devs_data, list):
            paired_devices = devs_data

    out = {
        "active": active,
        "ip": ip,
        "port": SERVER_PORT,
        "url": url,
        "activePins": active_pins,
        "pairedDevices": paired_devices,
        "pinCount": len(active_pins),
        "pairedCount": len(paired_devices)
    }
    print(json.dumps(out))

def cmd_confirm_pin(pin, name="Mobile Client"):
    res = http_post("/api/pair/confirm-pin", {"pin": pin, "name": name})
    print(json.dumps(res))

def cmd_unpair(device_id):
    res = http_delete(f"/api/pair/devices/{device_id}")
    print(json.dumps(res))

def run_tray():
    import webbrowser
    from PyQt6.QtWidgets import QApplication, QSystemTrayIcon, QMenu
    from PyQt6.QtGui import QIcon, QPixmap, QColor, QPainter
    from PyQt6.QtCore import QTimer

    def open_browser():
        ip = get_local_ip()
        webbrowser.open(f"http://{ip}:{SERVER_PORT}")

    def create_icon(color_name):
        pixmap = QPixmap(64, 64)
        pixmap.fill(QColor("transparent"))
        painter = QPainter(pixmap)
        painter.setBrush(QColor(color_name))
        painter.setPen(QColor("transparent"))
        painter.drawEllipse(8, 8, 48, 48)
        painter.end()
        return QIcon(pixmap)

    class TrayApp:
        def __init__(self):
            self.app = QApplication(sys.argv)
            self.app.setQuitOnLastWindowClosed(False)
            self.tray = QSystemTrayIcon()
            self.menu = QMenu()

            self.action_open = self.menu.addAction("Open OpenCode Mobile")
            self.action_open.triggered.connect(open_browser)
            self.menu.addSeparator()

            self.action_start = self.menu.addAction("Start Server")
            self.action_start.triggered.connect(lambda: subprocess.run(["systemctl", "--user", "start", "opencode-mobile.service"]))

            self.action_restart = self.menu.addAction("Restart Server")
            self.action_restart.triggered.connect(lambda: subprocess.run(["systemctl", "--user", "restart", "opencode-mobile.service"]))

            self.action_stop = self.menu.addAction("Stop Server")
            self.action_stop.triggered.connect(lambda: subprocess.run(["systemctl", "--user", "stop", "opencode-mobile.service"]))

            self.menu.addSeparator()
            self.action_quit = self.menu.addAction("Quit Tray")
            self.action_quit.triggered.connect(self.app.quit)

            self.tray.setContextMenu(self.menu)
            self.icon_green = create_icon("#10B981")
            self.icon_red = create_icon("#EF4444")
            self.update_status()
            self.tray.show()

            self.timer = QTimer()
            self.timer.timeout.connect(self.update_status)
            self.timer.start(2000)

        def update_status(self):
            is_active = get_service_status()
            ip = get_local_ip()
            if is_active:
                self.tray.setIcon(self.icon_green)
                self.tray.setToolTip(f"OpenCode Mobile: Running\nhttp://{ip}:{SERVER_PORT}")
                self.action_open.setEnabled(True)
                self.action_start.setEnabled(False)
                self.action_restart.setEnabled(True)
                self.action_stop.setEnabled(True)
            else:
                self.tray.setIcon(self.icon_red)
                self.tray.setToolTip("OpenCode Mobile: Stopped")
                self.action_open.setEnabled(False)
                self.action_start.setEnabled(True)
                self.action_restart.setEnabled(False)
                self.action_stop.setEnabled(False)

        def run(self):
            sys.exit(self.app.exec())

    TrayApp().run()

def main():
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "status-json":
            cmd_status_json()
            return
        elif cmd == "confirm-pin":
            if len(sys.argv) < 3:
                print(json.dumps({"error": "PIN required"}))
                sys.exit(1)
            pin = sys.argv[2]
            name = sys.argv[3] if len(sys.argv) > 3 else "Mobile Client"
            cmd_confirm_pin(pin, name)
            return
        elif cmd == "unpair":
            if len(sys.argv) < 3:
                print(json.dumps({"error": "Device ID required"}))
                sys.exit(1)
            cmd_unpair(sys.argv[2])
            return
        elif cmd == "open":
            import webbrowser
            webbrowser.open(f"http://{get_local_ip()}:{SERVER_PORT}")
            return
    run_tray()

if __name__ == "__main__":
    main()
