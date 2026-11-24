#!/bin/bash
# Installs Notes Word Count: a floating word/character counter for Apple Notes.
#
# Usage:
#   bash install.sh              install (or upgrade) for the current user
#   bash install.sh --dry-run    show what would be done, touch nothing
#   bash install.sh --help       this text
#
# Everything installed lives in:
#   ~/Library/Application Support/NotesWordCount/   script + config.json + status.txt
#   ~/Library/LaunchAgents/com.noteswordcount.helper.plist
#   ~/Library/Logs/NotesWordCount.log
# Remove it all with uninstall.sh.

set -euo pipefail

LABEL="com.noteswordcount.helper"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPPORT_DIR="$HOME/Library/Application Support/NotesWordCount"
AGENTS_DIR="$HOME/Library/LaunchAgents"
LOGS_DIR="$HOME/Library/Logs"
PLIST="$AGENTS_DIR/$LABEL.plist"
SCRIPT="$SUPPORT_DIR/notes-helper.js"
CONFIG="$SUPPORT_DIR/config.json"
STATUS="$SUPPORT_DIR/status.txt"
LOG_FILE="$LOGS_DIR/NotesWordCount.log"
DOMAIN="gui/$(id -u)"

DRY_RUN=0
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $arg" >&2; exit 2 ;;
    esac
done

say() { printf '==> %s\n' "$*"; }
act() {
    if [ "$DRY_RUN" = 1 ]; then
        printf '    [dry-run] %s\n' "$*"
    else
        "$@"
    fi
}

# ---------- 1. environment checks ----------
if [ "$(uname -s)" != "Darwin" ]; then
    echo "This tool only runs on macOS." >&2
    exit 1
fi
if [ ! -x /usr/bin/osascript ]; then
    echo "/usr/bin/osascript is missing — is this a full macOS install?" >&2
    exit 1
fi
if [ ! -f "$SRC_DIR/notes-helper.js" ]; then
    echo "notes-helper.js not found next to this installer ($SRC_DIR)." >&2
    exit 1
fi

# ---------- 2. warn about a previous hand-made install ----------
if [ -f "$AGENTS_DIR/com.ree.notes-helper.plist" ]; then
    echo
    echo "注意：检测到旧的 com.ree.notes-helper 也在运行。"
    echo "      两个同时开会显示两个浮窗。要停掉旧的："
    echo "      launchctl bootout gui/$(id -u)/com.ree.notes-helper || true"
    echo
fi

# ---------- 3. copy files ----------
say "安装到 $SUPPORT_DIR"
act mkdir -p "$SUPPORT_DIR" "$AGENTS_DIR" "$LOGS_DIR"
act cp "$SRC_DIR/notes-helper.js" "$SCRIPT"
act chmod 644 "$SCRIPT"

if [ "$DRY_RUN" = 1 ] || [ ! -f "$CONFIG" ]; then
    say "写入默认配置 $CONFIG"
    if [ "$DRY_RUN" = 1 ]; then
        printf '    [dry-run] 写默认 config.json\n'
    else
        cat > "$CONFIG" <<'JSON'
{
  "corner": "bottom-right",
  "width": 300,
  "refreshSeconds": 0.9,
  "cleanClipboard": true
}
JSON
    fi
else
    say "保留已有配置 $CONFIG"
fi

# ---------- 4. write the LaunchAgent ----------
say "写入启动项 $PLIST"
if [ "$DRY_RUN" = 1 ]; then
    printf '    [dry-run] 写 plist: osascript -l JavaScript %s\n' "$SCRIPT"
else
    cat > "$PLIST" <<PLIST_END
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/osascript</string>
        <string>-l</string>
        <string>JavaScript</string>
        <string>$SCRIPT</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>LimitLoadToSessionType</key>
    <string>Aqua</string>
    <key>StandardOutPath</key>
    <string>$LOG_FILE</string>
    <key>StandardErrorPath</key>
    <string>$LOG_FILE</string>
</dict>
</plist>
PLIST_END
    chmod 644 "$PLIST"
fi

# ---------- 5. (re)load the agent ----------
say "加载启动项"
if [ "$DRY_RUN" = 1 ]; then
    printf '    [dry-run] launchctl bootout %s/%s\n' "$DOMAIN" "$LABEL"
    printf '    [dry-run] launchctl bootstrap %s %s\n' "$DOMAIN" "$PLIST"
else
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    if ! launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null; then
        echo "    bootstrap 失败，改用 launchctl load 重试" >&2
        launchctl unload "$PLIST" 2>/dev/null || true
        launchctl load -w "$PLIST"
    fi
    rm -f "$STATUS"
fi

# ---------- 6. ask macOS for permission to read Notes ----------
say "请求备忘录访问权限（首次会弹窗，请点「好」）"
if [ "$DRY_RUN" = 1 ]; then
    printf '    [dry-run] osascript -e tell application "Notes" to count notes\n'
else
    probe="$(osascript -e 'tell application "Notes" to count notes' 2>&1)" || true
    case "$probe" in
        ''|*[!0-9]*) echo "    未能读到备忘录：$probe" ;;
        *) echo "    已连通备忘录，共 $probe 篇笔记" ;;
    esac
fi

# ---------- 7. report ----------
if [ "$DRY_RUN" = 0 ]; then
    # The agent only samples while Notes is in front, so bring it up for one check.
    open -a Notes >/dev/null 2>&1 || true
    status=""
    for _ in 1 2 3 4 5 6 7 8; do
        sleep 0.8
        status="$(cat "$STATUS" 2>/dev/null || true)"
        [ -n "$status" ] && break
    done
    case "$status" in
        ok) say "后台进程运行正常（刚刚切到备忘录做了一次自检）" ;;
        error:*)
            say "后台进程起不来：${status#error: }"
            echo "    这是权限问题。修法：系统设置 › 隐私与安全性 › 自动化，"
            echo "    允许「终端」/「osascript」控制「备忘录」，然后执行："
            echo "    launchctl kickstart -k $DOMAIN/$LABEL"
            ;;
        *)
            say "后台进程没有回报状态，看日志：open \"$LOG_FILE\""
            ;;
    esac
fi

echo
echo "完成。切到备忘录（Notes）就会在屏幕角落看到字数浮窗。"
echo "  配置：$CONFIG"
echo "  日志：$LOG_FILE"
echo "  卸载：bash \"$SRC_DIR/uninstall.sh\""
