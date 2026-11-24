#!/bin/bash
# Removes Notes Word Count: stops the LaunchAgent and deletes what install.sh created.
#
# Usage:
#   bash uninstall.sh              remove everything (script, config, plist, log)
#   bash uninstall.sh --keep-config  remove the agent but keep config.json and status.txt
#   bash uninstall.sh --dry-run    show what would be done, touch nothing

set -euo pipefail

LABEL="com.noteswordcount.helper"
SUPPORT_DIR="$HOME/Library/Application Support/NotesWordCount"
AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST="$AGENTS_DIR/$LABEL.plist"
LOG_FILE="$HOME/Library/Logs/NotesWordCount.log"
DOMAIN="gui/$(id -u)"

DRY_RUN=0
KEEP_CONFIG=0
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        --keep-config) KEEP_CONFIG=1 ;;
        -h|--help) sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

say "停止后台进程"
if [ "$DRY_RUN" = 1 ]; then
    printf '    [dry-run] launchctl bootout %s/%s\n' "$DOMAIN" "$LABEL"
else
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
fi

say "删除启动项 $PLIST"
act rm -f "$PLIST"

if [ "$KEEP_CONFIG" = 1 ]; then
    say "保留 ${SUPPORT_DIR}（配置与脚本），只停用"
    act rm -f "$SUPPORT_DIR/status.txt"
else
    say "删除 $SUPPORT_DIR"
    act rm -rf "$SUPPORT_DIR"
fi

say "删除日志 $LOG_FILE"
act rm -f "$LOG_FILE"

echo
echo "已卸载。备忘录里的笔记没有被修改过。"
