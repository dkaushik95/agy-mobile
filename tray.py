import sys
import subprocess
from PyQt6.QtWidgets import QApplication, QSystemTrayIcon, QMenu
from PyQt6.QtGui import QIcon, QPixmap, QColor, QPainter
from PyQt6.QtCore import QTimer

def get_service_status():
    try:
        # Check if the service is active
        res = subprocess.run(["systemctl", "--user", "is-active", "agy-mobile.service"], capture_output=True, text=True)
        return res.stdout.strip() == "active"
    except Exception:
        return False

def start_server():
    subprocess.run(["systemctl", "--user", "start", "agy-mobile.service"])

def stop_server():
    subprocess.run(["systemctl", "--user", "stop", "agy-mobile.service"])

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
        
        self.action_start = self.menu.addAction("Start Server")
        self.action_start.triggered.connect(start_server)
        
        self.action_stop = self.menu.addAction("Stop Server")
        self.action_stop.triggered.connect(stop_server)
        
        self.menu.addSeparator()
        self.action_quit = self.menu.addAction("Quit Tray")
        self.action_quit.triggered.connect(self.app.quit)
        
        self.tray.setContextMenu(self.menu)
        
        self.icon_green = create_icon("#10B981") # Tailwind Emerald 500
        self.icon_red = create_icon("#EF4444")   # Tailwind Red 500
        
        self.update_status()
        self.tray.show()
        
        self.timer = QTimer()
        self.timer.timeout.connect(self.update_status)
        self.timer.start(2000)
        
    def update_status(self):
        is_active = get_service_status()
        if is_active:
            self.tray.setIcon(self.icon_green)
            self.tray.setToolTip("AGY Mobile: Running")
            self.action_start.setEnabled(False)
            self.action_stop.setEnabled(True)
        else:
            self.tray.setIcon(self.icon_red)
            self.tray.setToolTip("AGY Mobile: Stopped")
            self.action_start.setEnabled(True)
            self.action_stop.setEnabled(False)

    def run(self):
        sys.exit(self.app.exec())

if __name__ == "__main__":
    TrayApp().run()
