# Notes Word Count

A small background utility for **Apple Notes on macOS**: while Notes is in front, a compact always-on-top panel in the corner of the screen shows how long the note you have open actually is — Chinese characters counted per character, English and numbers counted per word, struck-through text excluded.

Companion behavior: when you copy text inside Notes, struck-through text is dropped and repeated spaces are collapsed, so pasted text carries no leftover editing marks.

![浮窗效果](preview.png)

Nothing is written to your notes, and the tool makes no network requests.

---

## 功能

| 功能 | 触发方式 |
|---|---|
| 实时光标位置无关的字数浮窗 | 把备忘录切到前台，自动出现 |
| 选中文字单独计数（下排金字） | 在备忘录里选中一段文字 |
| 复制时去掉删除线、合并多余空格 | 在备忘录里 `Cmd+C` |
| 记忆配置（位置、宽度、刷新间隔、是否清理剪贴板） | `~/Library/Application Support/NotesWordCount/config.json` |

浮窗两行（上排白字是全文，下排金字是选中）：

```
全文: 中 420字 英 88词 | 共 2829字符
选中: 中 15字 英 3词 | 共 78字符
```

- **中文按字**（含日文假名、韩文），**英文和数字按词**，中英混排分别计。
- **删除线文字不计入**（正文里带删除线的部分被排除后再统计）。
- 切到别的 App 约 1.5 秒后浮窗自动隐藏，切回备忘录再出现。

## 系统要求

- macOS 12 或更高（在 macOS 26.5 上实测）
- 系统自带的 `/usr/bin/osascript`，无需安装 Node / Python / Homebrew

## 安装

### 方式一：双击

1. 下载本仓库（`Code` › `Download ZIP`）并解压；
2. 双击解压目录里的 `install.command`；
3. 终端窗口里看到「完成」即可，切到备忘录看效果。

> 若双击时 macOS 提示「无法打开，因为来自身份不明的开发者」：在文件上右键 › 打开，或先执行
> `xattr -d com.apple.quarantine install.command`。

### 方式二：终端

```bash
git clone https://github.com/ree-29lab/notes-wordcount.git
cd notes-wordcount
bash install.sh
```

`bash install.sh --dry-run` 只打印要做的事，不写任何文件。

### 首次授权

第一次读取备忘录时，macOS 会弹窗询问是否允许控制「备忘录」，点**好**。若没看到弹窗或浮窗显示「需要授权备忘录」：

1. 打开 **系统设置 › 隐私与安全性 › 自动化**，允许「终端」/「osascript」控制「备忘录」；
2. 执行 `launchctl kickstart -k gui/$(id -u)/com.noteswordcount.helper` 重启后台进程。

安装脚本最后会打印后台进程的自检结果（读通了、报错了、还是在等权限），照提示处理即可。

## 配置

安装时生成 `~/Library/Application Support/NotesWordCount/config.json`：

```json
{
  "corner": "bottom-right",
  "width": 300,
  "refreshSeconds": 0.9,
  "cleanClipboard": true
}
```

| 字段 | 说明 |
|---|---|
| `corner` | `bottom-right` / `bottom-left` / `top-right` / `top-left` |
| `width` | 浮窗宽度（点） |
| `refreshSeconds` | 多久重读一次当前笔记，越小越实时、越费电 |
| `cleanClipboard` | `true` 时在备忘录里复制会自动去删除线、合并空格；不想要就设 `false` |

改完执行 `launchctl kickstart -k gui/$(id -u)/com.noteswordcount.helper` 生效。

## 卸载

```bash
bash uninstall.sh            # 停用并删除所有安装产物
bash uninstall.sh --keep-config   # 只停用，保留配置
```

## 排错

| 现象 | 处理 |
|---|---|
| 浮窗一直显示 `--` 或「需要授权备忘录」 | 执行 `NOTESWORDCOUNT_ONCE=1 osascript -l JavaScript "$HOME/Library/Application Support/NotesWordCount/notes-helper.js"`，看输出里的 `error` 字段 |
| 浮窗不出现 | 确认备忘录在前台；`cat "$HOME/Library/Application Support/NotesWordCount/status.txt"` 看后台自检结果；`launchctl print gui/$(id -u)/com.noteswordcount.helper \| head` 看进程是否 running |
| 出现两个浮窗 | 机器上还有一份旧的 `com.ree.notes-helper`，执行 `launchctl bootout gui/$(id -u)/com.ree.notes-helper` |
| 数字一直是 `--` | 没有在编辑器里选中笔记。在左栏点开一篇笔记即可 |
| 复制后剪贴板被改了 | 这是 `cleanClipboard` 功能，在 `config.json` 里设为 `false` |
| 日志 | `open ~/Library/Logs/NotesWordCount.log` |

## 安装位置

```
~/Library/Application Support/NotesWordCount/notes-helper.js   # 主程序
~/Library/Application Support/NotesWordCount/config.json       # 配置
~/Library/Application Support/NotesWordCount/status.txt        # 后台自检结果
~/Library/LaunchAgents/com.noteswordcount.helper.plist         # 开机自启
~/Library/Logs/NotesWordCount.log                              # 日志
```

## 开发

主程序是 macOS 的 JavaScript for Automation（JXA），通过 ObjC 桥直接调用 AppKit 画浮窗，用 `Application("Notes")` 读当前笔记。改完先跑自检（不开窗、只验计数逻辑）：

```bash
NOTESWORDCOUNT_SELFTEST=1 osascript -l JavaScript notes-helper.js
```

不装到系统、直接看它读不读得到当前笔记（打印 JSON，退出）：

```bash
NOTESWORDCOUNT_ONCE=1 osascript -l JavaScript notes-helper.js
```

不开真窗口、把浮窗渲染成 PNG（排版/截断回归用，可用 `NOTESWORDCOUNT_RENDER_TEXT` 指定样例文字）：

```bash
NOTESWORDCOUNT_RENDER=/tmp/panel.png osascript -l JavaScript notes-helper.js
```

再重装并重启后台进程验证真实效果：

```bash
bash install.sh && launchctl kickstart -k gui/$(id -u)/com.noteswordcount.helper
```

## 授权

MIT，见 [LICENSE](LICENSE)。
