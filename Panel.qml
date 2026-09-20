import QtQuick
import Quickshell
import Quickshell.Io
import qs.Ui
import qs.Commons

Panel {
  id: root
  moduleName: "custom.opencode-mobile"
  ipcTarget: "custom.opencode-mobile"
  manageIpc: false

  property bool isActive: false
  property string serverUrl: ""
  property string serverIp: ""
  property string statusText: "Checking..."
  property var activePins: []
  property var pairedDevices: []
  property int pinCount: 0
  property int pairedCount: 0
  property string pinInput: ""
  property string feedbackMsg: ""
  property bool feedbackSuccess: true
  property string currentTab: "pair"
  property int copySuccessId: 0

  readonly property string helperScript: Qt.resolvedUrl("tray.py").toString().replace(/^file:\/\//, "")

  function toggleServer() {
    if (isActive) {
      stopProc.running = true
    } else {
      startProc.running = true
    }
  }

  function restartServer() {
    restartProc.running = true
  }

  function openWebUI() {
    if (serverUrl !== "") {
      Qt.openUrlExternally(serverUrl)
    }
  }

  function copyText(val, id) {
    if (!val) return
    copyProc.command = ["wl-copy", val]
    copyProc.running = true
    root.copySuccessId = id
    copyTimer.restart()
  }

  function refresh() {
    if (!statusProc.running) statusProc.running = true
  }

  function confirmPin(pin, name) {
    if (!pin || String(pin).trim() === "") {
      root.feedbackMsg = "Please enter a 4-digit PIN"
      root.feedbackSuccess = false
      feedbackTimer.restart()
      return
    }
    confirmProc.command = ["python3", root.helperScript, "confirm-pin", String(pin).trim(), name ? String(name).trim() : "Mobile Client"]
    confirmProc.running = true
  }

  function unpairDevice(devId) {
    if (!devId) return
    unpairProc.command = ["python3", root.helperScript, "unpair", String(devId)]
    unpairProc.running = true
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Component.onCompleted: refresh()

  onOpenedChanged: {
    if (opened) refresh()
  }

  Timer {
    interval: 2000
    running: true
    repeat: true
    onTriggered: root.refresh()
  }

  Timer {
    id: feedbackTimer
    interval: 4000
    repeat: false
    onTriggered: root.feedbackMsg = ""
  }

  Timer {
    id: copyTimer
    interval: 2000
    repeat: false
    onTriggered: root.copySuccessId = 0
  }

  Process {
    id: statusProc
    command: ["python3", root.helperScript, "status-json"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        try {
          var data = JSON.parse(String(text || "{}"))
          root.isActive = Boolean(data.active)
          root.serverIp = String(data.ip || "")
          root.serverUrl = String(data.url || "")
          root.pinCount = Number(data.pinCount || 0)
          root.pairedCount = Number(data.pairedCount || 0)
          root.activePins = data.activePins || []
          root.pairedDevices = data.pairedDevices || []
          root.statusText = root.isActive ? ("Running on " + root.serverIp + ":3900") : "Server Stopped"
        } catch (err) {
          root.statusText = "Status check error"
        }
      }
    }
  }

  Process {
    id: confirmProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        try {
          var res = JSON.parse(String(text || "{}"))
          if (res.success) {
            root.feedbackMsg = "✓ Device paired successfully!"
            root.feedbackSuccess = true
            root.pinInput = ""
          } else if (res.error) {
            root.feedbackMsg = "✗ " + res.error
            root.feedbackSuccess = false
          }
        } catch (e) {
          root.feedbackMsg = "Error pairing device"
          root.feedbackSuccess = false
        }
        feedbackTimer.restart()
        root.refresh()
      }
    }
  }

  Process {
    id: unpairProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.feedbackMsg = "✓ Device removed"
        root.feedbackSuccess = true
        feedbackTimer.restart()
        root.refresh()
      }
    }
  }

  Process {
    id: copyProc
    stdout: StdioCollector { waitForEnd: true }
  }

  Process {
    id: startProc
    command: ["systemctl", "--user", "start", "opencode-mobile.service"]
    stdout: StdioCollector { waitForEnd: true }
    onRunningChanged: if (!running) root.refresh()
  }

  Process {
    id: stopProc
    command: ["systemctl", "--user", "stop", "opencode-mobile.service"]
    stdout: StdioCollector { waitForEnd: true }
    onRunningChanged: if (!running) root.refresh()
  }

  Process {
    id: restartProc
    command: ["systemctl", "--user", "restart", "opencode-mobile.service"]
    stdout: StdioCollector { waitForEnd: true }
    onRunningChanged: if (!running) root.refresh()
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.pinCount > 0 ? "󰤨" : (root.isActive ? "󰆍" : "󰅛")
    foreground: (root.pinCount > 0) ? Color.accent : (root.isActive ? root.barForeground : Qt.darker(root.barForeground, 1.8))
    onPressed: function(b) { root.toggle() }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    contentWidth: panel.fittedContentWidth(Style.space(360))
    contentHeight: Math.max(Style.space(420), panel.fittedContentHeight(content.implicitHeight, Style.space(540)))

    Column {
      id: content
      width: parent.width
      spacing: Style.space(12)

      // Header Row
      Item {
        width: parent.width
        implicitHeight: Style.space(32)

        Row {
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.space(8)

          Text {
            text: root.pinCount > 0 ? "󰤨" : "󰆍"
            color: Color.accent
            font.family: root.bar ? root.bar.fontFamily : "sans-serif"
            font.pixelSize: Style.font.title
            anchors.verticalCenter: parent.verticalCenter
          }

          Text {
            text: "OpenCode Mobile"
            color: root.barForeground
            font.family: root.bar ? root.bar.fontFamily : "sans-serif"
            font.pixelSize: Style.font.title
            font.bold: true
            anchors.verticalCenter: parent.verticalCenter
          }
        }

        Rectangle {
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          radius: Style.space(4)
          width: statusBadgeText.implicitWidth + Style.space(14)
          height: Style.space(22)
          color: root.isActive ? "#22c55e" : "#ef4444"

          Text {
            id: statusBadgeText
            anchors.centerIn: parent
            text: root.isActive ? "Running" : "Stopped"
            color: "#ffffff"
            font.family: root.bar ? root.bar.fontFamily : "sans-serif"
            font.pixelSize: Style.font.caption
            font.bold: true
          }
        }
      }

      Text {
        width: parent.width
        text: root.statusText
        wrapMode: Text.Wrap
        color: Qt.darker(root.barForeground, 1.3)
        font.family: root.bar ? root.bar.fontFamily : "sans-serif"
        font.pixelSize: Style.font.body
      }

      // Tab Switcher (Pair Devices vs Server)
      Row {
        width: parent.width
        spacing: Style.space(8)

        // Tab: Pair Devices
        Rectangle {
          width: (parent.width - Style.space(8)) / 2
          height: Style.space(32)
          radius: Style.space(4)
          color: root.currentTab === "pair" ? Color.accent : Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.08)

          Text {
            anchors.centerIn: parent
            text: root.pinCount > 0 ? ("󰤨 Pair (" + root.pinCount + ")") : "󰤨 Pair Devices"
            color: root.currentTab === "pair" ? "#ffffff" : (root.pinCount > 0 ? Color.accent : root.barForeground)
            font.family: root.bar ? root.bar.fontFamily : "sans-serif"
            font.pixelSize: Style.font.caption
            font.bold: true
          }

          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.currentTab = "pair"
          }
        }

        // Tab: Server Controls
        Rectangle {
          width: (parent.width - Style.space(8)) / 2
          height: Style.space(32)
          radius: Style.space(4)
          color: root.currentTab === "server" ? Color.accent : Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.08)

          Text {
            anchors.centerIn: parent
            text: "󰒓 Server"
            color: root.currentTab === "server" ? "#ffffff" : root.barForeground
            font.family: root.bar ? root.bar.fontFamily : "sans-serif"
            font.pixelSize: Style.font.caption
            font.bold: true
          }

          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.currentTab = "server"
          }
        }
      }

      PanelSeparator {
        foreground: root.barForeground
      }

      // ==================== TAB 1: PAIR DEVICES (Sunshine-style) ====================
      Column {
        visible: root.currentTab === "pair"
        width: parent.width
        spacing: Style.space(12)

        Text {
          width: parent.width
          wrapMode: Text.WordWrap
          text: "Sunshine-style PIN pairing: enter or confirm the 4-digit PIN displayed on your mobile device."
          color: Qt.darker(root.barForeground, 1.3)
          font.family: root.bar ? root.bar.fontFamily : "sans-serif"
          font.pixelSize: Style.font.caption
        }

        // Feedback notification message
        Rectangle {
          visible: root.feedbackMsg !== ""
          width: parent.width
          height: Style.space(32)
          radius: Style.space(4)
          color: root.feedbackSuccess ? Qt.rgba(0.13, 0.77, 0.36, 0.15) : Qt.rgba(0.93, 0.27, 0.27, 0.15)
          border.color: root.feedbackSuccess ? "#22c55e" : "#ef4444"
          border.width: 1

          Text {
            anchors.centerIn: parent
            text: root.feedbackMsg
            color: root.feedbackSuccess ? "#22c55e" : "#ef4444"
            font.family: root.bar ? root.bar.fontFamily : "sans-serif"
            font.pixelSize: Style.font.caption
            font.bold: true
          }
        }

        // Active PIN Requests from Devices Awaiting Confirmation
        Column {
          width: parent.width
          spacing: Style.space(8)
          visible: root.activePins.length > 0

          Text {
            text: "PENDING PAIRING REQUESTS"
            color: Color.accent
            font.family: root.bar ? root.bar.fontFamily : "sans-serif"
            font.pixelSize: Style.font.caption
            font.bold: true
          }

          Repeater {
            model: root.activePins
            delegate: Rectangle {
              width: parent.width
              height: Style.space(56)
              radius: Style.space(6)
              color: Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.06)
              border.color: Color.accent
              border.width: 1

              Row {
                anchors.fill: parent
                anchors.margins: Style.space(8)
                spacing: Style.space(10)

                // Big PIN
                Rectangle {
                  width: Style.space(76)
                  height: parent.height
                  radius: Style.space(4)
                  color: Qt.rgba(Color.accent.r, Color.accent.g, Color.accent.b, 0.15)
                  
                  Text {
                    anchors.centerIn: parent
                    text: modelData.pin || ""
                    color: Color.accent
                    font.family: "monospace"
                    font.pixelSize: Style.font.title
                    font.bold: true
                  }
                }

                // Client info
                Column {
                  width: parent.width - Style.space(76) - Style.space(80) - Style.space(20)
                  anchors.verticalCenter: parent.verticalCenter
                  spacing: Style.space(2)

                  Text {
                    text: modelData.clientName || "Mobile Device"
                    color: root.barForeground
                    font.family: root.bar ? root.bar.fontFamily : "sans-serif"
                    font.pixelSize: Style.font.body
                    font.bold: true
                    elide: Text.ElideRight
                  }
                  Text {
                    text: modelData.clientIp || "Unknown IP"
                    color: Qt.darker(root.barForeground, 1.4)
                    font.family: "monospace"
                    font.pixelSize: Style.font.caption
                    elide: Text.ElideRight
                  }
                }

                // Pair Button
                Rectangle {
                  width: Style.space(80)
                  height: Style.space(32)
                  radius: Style.space(4)
                  anchors.verticalCenter: parent.verticalCenter
                  color: Color.accent

                  Text {
                    anchors.centerIn: parent
                    text: "󰄬 Pair"
                    color: "#ffffff"
                    font.family: root.bar ? root.bar.fontFamily : "sans-serif"
                    font.pixelSize: Style.font.caption
                    font.bold: true
                  }

                  MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.confirmPin(modelData.pin, modelData.clientName)
                  }
                }
              }
            }
          }
        }

        // Manual PIN Entry
        Column {
          width: parent.width
          spacing: Style.space(6)

          Text {
            text: "ENTER 4-DIGIT PIN"
            color: Qt.darker(root.barForeground, 1.4)
            font.family: root.bar ? root.bar.fontFamily : "sans-serif"
            font.pixelSize: Style.font.caption
            font.bold: true
          }

          Row {
            width: parent.width
            spacing: Style.space(8)

            Rectangle {
              width: Style.space(120)
              height: Style.space(36)
              radius: Style.space(4)
              color: Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.08)
              border.color: pinInputItem.activeFocus ? Color.accent : Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.2)
              border.width: 1

              TextInput {
                id: pinInputItem
                anchors.fill: parent
                anchors.leftMargin: Style.space(10)
                anchors.rightMargin: Style.space(10)
                verticalAlignment: TextInput.AlignVCenter
                clip: true
                text: root.pinInput
                onTextChanged: {
                  if (text.length > 4) text = text.substring(0, 4)
                  root.pinInput = text
                }
                color: root.barForeground
                font.family: "monospace"
                font.pixelSize: Style.font.body
                font.bold: true
                inputMethodHints: Qt.ImhDigitsOnly

                Text {
                  anchors.fill: parent
                  verticalAlignment: Text.AlignVCenter
                  text: "0000"
                  color: Qt.darker(root.barForeground, 2.0)
                  font.family: "monospace"
                  font.pixelSize: Style.font.body
                  font.bold: true
                  visible: !pinInputItem.text
                }
              }
            }

            Rectangle {
              width: parent.width - Style.space(128)
              height: Style.space(36)
              radius: Style.space(4)
              color: root.pinInput.trim().length >= 4 ? Color.accent : Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.12)

              Text {
                anchors.centerIn: parent
                text: "󰤨 Confirm PIN"
                color: root.pinInput.trim().length >= 4 ? "#ffffff" : Qt.darker(root.barForeground, 1.3)
                font.family: root.bar ? root.bar.fontFamily : "sans-serif"
                font.pixelSize: Style.font.body
                font.bold: true
              }

              MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: {
                  root.confirmPin(root.pinInput, "Mobile Client")
                }
              }
            }
          }
        }

        // Paired Devices List
        Column {
          width: parent.width
          spacing: Style.space(6)

          PanelSeparator {
            foreground: root.barForeground
          }

          Text {
            text: "PAIRED DEVICES (" + root.pairedCount + ")"
            color: Qt.darker(root.barForeground, 1.4)
            font.family: root.bar ? root.bar.fontFamily : "sans-serif"
            font.pixelSize: Style.font.caption
            font.bold: true
          }

          Text {
            visible: root.pairedDevices.length === 0
            text: "No paired devices yet. Open OpenCode Mobile on your phone to generate a pairing PIN."
            color: Qt.darker(root.barForeground, 1.5)
            font.family: root.bar ? root.bar.fontFamily : "sans-serif"
            font.pixelSize: Style.font.caption
            wrapMode: Text.WordWrap
            width: parent.width
          }

          Repeater {
            model: root.pairedDevices
            delegate: Rectangle {
              width: parent.width
              height: Style.space(46)
              radius: Style.space(4)
              color: Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.04)

              Row {
                anchors.fill: parent
                anchors.margins: Style.space(6)
                spacing: Style.space(8)

                Column {
                  width: parent.width - Style.space(70)
                  anchors.verticalCenter: parent.verticalCenter
                  spacing: Style.space(2)

                  Text {
                    text: modelData.name || "Mobile Device"
                    color: root.barForeground
                    font.family: root.bar ? root.bar.fontFamily : "sans-serif"
                    font.pixelSize: Style.font.body
                    font.bold: true
                    elide: Text.ElideRight
                  }
                  Text {
                    text: (modelData.ip || "LAN") + " · " + (modelData.pairedAt ? String(modelData.pairedAt).substring(0, 10) : "Paired")
                    color: Qt.darker(root.barForeground, 1.4)
                    font.family: "monospace"
                    font.pixelSize: Style.font.caption
                    elide: Text.ElideRight
                  }
                }

                Rectangle {
                  width: Style.space(62)
                  height: Style.space(28)
                  radius: Style.space(4)
                  anchors.verticalCenter: parent.verticalCenter
                  color: Qt.rgba(0.93, 0.27, 0.27, 0.15)
                  border.color: "#ef4444"
                  border.width: 1

                  Text {
                    anchors.centerIn: parent
                    text: "Unpair"
                    color: "#ef4444"
                    font.family: root.bar ? root.bar.fontFamily : "sans-serif"
                    font.pixelSize: Style.font.caption
                    font.bold: true
                  }

                  MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.unpairDevice(modelData.id)
                  }
                }
              }
            }
          }
        }
      }

      // ==================== TAB 2: SERVER CONTROLS ====================
      Column {
        visible: root.currentTab === "server"
        width: parent.width
        spacing: Style.space(10)

        // Local Wi-Fi URL Card with Copy Button
        Rectangle {
          width: parent.width
          height: Style.space(40)
          radius: Style.space(4)
          color: Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.06)

          Row {
            anchors.fill: parent
            anchors.margins: Style.space(6)
            spacing: Style.space(8)

            Text {
              width: parent.width - copyBtn.width - Style.space(8)
              anchors.verticalCenter: parent.verticalCenter
              text: root.serverUrl || ("http://" + root.serverIp + ":3900")
              color: root.barForeground
              font.family: "monospace"
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }

            Rectangle {
              id: copyBtn
              width: Style.space(70)
              height: Style.space(26)
              radius: Style.space(4)
              anchors.verticalCenter: parent.verticalCenter
              color: root.copySuccessId === 1 ? "#22c55e" : Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.12)

              Text {
                anchors.centerIn: parent
                text: root.copySuccessId === 1 ? "󰄬 Copied" : "󰆏 Copy"
                color: root.copySuccessId === 1 ? "#ffffff" : root.barForeground
                font.family: root.bar ? root.bar.fontFamily : "sans-serif"
                font.pixelSize: Style.font.caption
                font.bold: true
              }

              MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: root.copyText(root.serverUrl || ("http://" + root.serverIp + ":3900"), 1)
              }
            }
          }
        }

        // Start / Stop Server Button
        Rectangle {
          width: parent.width
          height: Style.space(38)
          radius: Style.space(4)
          color: root.isActive ? Qt.rgba(0.93, 0.27, 0.27, 0.15) : Qt.rgba(0.13, 0.77, 0.36, 0.15)
          border.color: root.isActive ? "#ef4444" : "#22c55e"
          border.width: 1

          Text {
            anchors.centerIn: parent
            text: root.isActive ? "󰓛 Stop Server" : "󰐊 Start Server"
            color: root.isActive ? "#ef4444" : "#22c55e"
            font.family: root.bar ? root.bar.fontFamily : "sans-serif"
            font.pixelSize: Style.font.body
            font.bold: true
          }

          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.toggleServer()
          }
        }

        // Restart Server Button
        Rectangle {
          visible: root.isActive
          width: parent.width
          height: Style.space(38)
          radius: Style.space(4)
          color: Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.08)

          Text {
            anchors.centerIn: parent
            text: "󰜗 Restart Server"
            color: root.barForeground
            font.family: root.bar ? root.bar.fontFamily : "sans-serif"
            font.pixelSize: Style.font.body
            font.bold: true
          }

          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.restartServer()
          }
        }

        // Open in Browser Button
        Rectangle {
          visible: root.isActive
          width: parent.width
          height: Style.space(38)
          radius: Style.space(4)
          color: Qt.rgba(Color.accent.r, Color.accent.g, Color.accent.b, 0.15)
          border.color: Color.accent
          border.width: 1

          Text {
            anchors.centerIn: parent
            text: "󰖟 Open OpenCode Mobile"
            color: Color.accent
            font.family: root.bar ? root.bar.fontFamily : "sans-serif"
            font.pixelSize: Style.font.body
            font.bold: true
          }

          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.openWebUI()
          }
        }
      }
    }
  }
}