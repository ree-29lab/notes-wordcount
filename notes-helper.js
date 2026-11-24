// Notes Word Count — a floating word/character counter for Apple Notes on macOS.
//
// Runs as a background LaunchAgent:
//   /usr/bin/osascript -l JavaScript notes-helper.js
//
// Shows a small always-on-top panel while Notes is the frontmost app:
//   line 1 (white)  — counters for the whole note
//   line 2 (amber)  — counters for the current selection
// Optional: cleans copied text (drops struck-through text, collapses repeated spaces).
//
// Self test (no window, prints results, exits):
//   NOTESWORDCOUNT_SELFTEST=1 osascript -l JavaScript notes-helper.js

ObjC.import("AppKit");
ObjC.import("Foundation");

var HOME = ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey("HOME"));
var SUPPORT_DIR = HOME + "/Library/Application Support/NotesWordCount";
var CONFIG_PATH = SUPPORT_DIR + "/config.json";
var STATUS_PATH = SUPPORT_DIR + "/status.txt";

var DEFAULTS = {
    // Panel corner: bottom-right | bottom-left | top-right | top-left
    corner: "bottom-right",
    // Panel width in points.
    width: 300,
    // How often (seconds) the frontmost note is re-read.
    refreshSeconds: 0.9,
    // On copy inside Notes: drop struck-through text and collapse repeated spaces.
    cleanClipboard: true
};

function loadConfig() {
    var cfg = {};
    for (var key in DEFAULTS) {
        if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) cfg[key] = DEFAULTS[key];
    }
    var fm = $.NSFileManager.defaultManager;
    if (!fm.fileExistsAtPath(CONFIG_PATH)) return cfg;
    var raw = $.NSString.stringWithContentsOfFileEncodingError(CONFIG_PATH, $.NSUTF8StringEncoding, null);
    if (raw.isNil()) return cfg;
    var parsed;
    try {
        parsed = JSON.parse(raw.js);
    } catch (e) {
        return cfg;
    }
    for (var k in DEFAULTS) {
        if (Object.prototype.hasOwnProperty.call(parsed, k) && typeof parsed[k] === typeof DEFAULTS[k]) {
            cfg[k] = parsed[k];
        }
    }
    return cfg;
}

// Counts a plain-text string: CJK by character, Latin/number runs by word.
function countText(text) {
    var cjk = 0;
    var words = 0;
    var noSpace = 0;
    var inWord = false;
    for (var i = 0; i < text.length; i++) {
        var c = text.charCodeAt(i);
        if (c !== 32 && c !== 9 && c !== 10 && c !== 13) noSpace++;
        if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) ||
            (c >= 0x3040 && c <= 0x309F) || (c >= 0x30A0 && c <= 0x30FF) ||
            (c >= 0xAC00 && c <= 0xD7AF)) {
            cjk++;
            inWord = false;
        } else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 39) {
            if (!inWord) {
                words++;
                inWord = true;
            }
        } else {
            inWord = false;
        }
    }
    return {
        cjkChars: cjk,
        enWords: words,
        totalWords: cjk + words,
        totalChars: text.length,
        charsNoSpace: noSpace
    };
}

function htmlToText(html) {
    return html
        .replace(/<(s|strike|del)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#\d+;/g, "")
        .replace(/[ \t]+/g, " ")
        .trim();
}

function env(name) {
    var value = $.NSProcessInfo.processInfo.environment.objectForKey(name);
    return value.isNil() ? "" : ObjC.unwrap(value);
}

if (env("NOTESWORDCOUNT_SELFTEST") === "1") {
    ObjC.import("stdlib");
    var cases = [
        ["", 0, 0],
        ["你好世界", 4, 0],
        ["hello world", 0, 2],
        ["你好 world", 2, 1],
        ["SAT 要写 650 words, 不是 650 字", 5, 4],
        ["don't stop", 0, 2],
        ["  多   空格  ", 3, 0],
        ["あア한", 3, 0]
    ];
    var failures = 0;
    for (var ci = 0; ci < cases.length; ci++) {
        var input = cases[ci][0];
        var wantCjk = cases[ci][1];
        var wantWords = cases[ci][2];
        var got = countText(input);
        var pass = got.cjkChars === wantCjk && got.enWords === wantWords;
        if (!pass) failures++;
        console.log((pass ? "PASS " : "FAIL ") + JSON.stringify(input) +
            " -> cjk=" + got.cjkChars + " (want " + wantCjk + "), words=" + got.enWords + " (want " + wantWords + ")");
    }
    console.log(failures === 0 ? "selftest: all " + cases.length + " cases passed" : "selftest: " + failures + " failed");
    $.exit(failures === 0 ? 0 : 1);
}

// One-shot diagnostic: read the frontmost note once, print the result, exit.
// Used for permission checks and for verifying a fresh install without a window.
if (env("NOTESWORDCOUNT_ONCE") === "1") {
    ObjC.import("stdlib");
    var probe = frontNoteBody();
    var counts = probe.ok ? countText(htmlToText(probe.body)) : null;
    console.log(JSON.stringify({ ok: probe.ok, error: probe.error, bodyHtmlChars: probe.body.length, counts: counts }));
    if (counts) {
        console.log("全文: 中 " + counts.cjkChars + "字 英 " + counts.enWords + "词 | 共 " + counts.totalChars + "字符");
    }
    $.exit(probe.ok ? 0 : 1);
}

// Diagnostic: render the panel to a PNG and exit (no live sampling).
//   NOTESWORDCOUNT_RENDER=/tmp/panel.png osascript -l JavaScript notes-helper.js
var CFG = loadConfig();

var app = $.NSApplication.sharedApplication;
app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);

// ============ Panel ============
function frameFor(corner, w, h) {
    var vf = $.NSScreen.mainScreen.visibleFrame;
    var x = vf.origin.x + 16;
    var y = vf.origin.y + 8;
    if (corner.indexOf("right") >= 0) x = vf.origin.x + vf.size.width - w - 16;
    if (corner.indexOf("top") >= 0) y = vf.origin.y + vf.size.height - h - 8;
    return $.NSMakeRect(x, y, w, h);
}

var winW = CFG.width;
var winH = 52;
var win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
    frameFor(CFG.corner, winW, winH),
    $.NSWindowStyleMaskBorderless, $.NSBackingStoreBuffered, false
);
win.setLevel($.NSFloatingWindowLevel);
win.setBackgroundColor($.NSColor.colorWithRedGreenBlueAlpha(0, 0, 0, 0.78));
win.setOpaque(false);
win.setHasShadow(true);
win.setIgnoresMouseEvents(true);
win.setCollectionBehavior(1);

function makeLabel(y, height, color, size) {
    var label = $.NSTextField.alloc.initWithFrame($.NSMakeRect(12, y, winW - 24, height));
    label.setTextColor(color);
    label.setBackgroundColor($.NSColor.clearColor);
    label.setBezeled(false);
    label.setDrawsBackground(false);
    label.setEditable(false);
    label.setSelectable(false);
    label.setFont($.NSFont.systemFontOfSize(size));
    label.setUsesSingleLineMode(true);
    label.cell.setLineBreakMode($.NSLineBreakByTruncatingTail);
    win.contentView.addSubview(label);
    return label;
}

var totalLabel = makeLabel(30, 18, $.NSColor.whiteColor, 12);
var selLabel = makeLabel(10, 18, $.NSColor.colorWithRedGreenBlueAlpha(1, 0.85, 0.3, 1), 11);
totalLabel.setStringValue("全文: --");
selLabel.setStringValue("");
win.orderFront(app);

if (env("NOTESWORDCOUNT_RENDER") !== "") {
    ObjC.import("stdlib");
    var sample = env("NOTESWORDCOUNT_RENDER_TEXT");
    totalLabel.setStringValue(sample !== "" ? sample : "全文: 中 1284字 英 392词 | 共 6912字符");
    selLabel.setStringValue("选中: 中 15字 英 3词 | 共 78字符");
    var bounds = win.contentView.bounds;
    var rep = win.contentView.bitmapImageRepForCachingDisplayInRect(bounds);
    win.contentView.cacheDisplayInRectToBitmapImageRep(bounds, rep);
    var png = rep.representationUsingTypeProperties($.NSPNGFileType, $.NSDictionary.dictionary);
    png.writeToFileAtomically(env("NOTESWORDCOUNT_RENDER"), true);
    console.log("rendered panel to " + env("NOTESWORDCOUNT_RENDER"));
    $.exit(0);
}

// ============ State ============
var pasteboard = $.NSPasteboard.generalPasteboard;
var lastChangeCount = pasteboard.changeCount;
var visible = true;
var lastBodyHtml = "";
var hiddenTicks = 0;
var lastStatus = "";
var ticksPerRefresh = Math.max(1, Math.round(CFG.refreshSeconds / 0.3));

function writeStatus(message) {
    if (message === lastStatus) return;
    lastStatus = message;
    var s = $.NSString.alloc.initWithUTF8String(message);
    s.writeToFileAtomicallyEncodingError(STATUS_PATH, true, $.NSUTF8StringEncoding, null);
}

var bodyScript = null;
var probeScript = null;

function compiledScript(cacheKey, source) {
    if (cacheKey === "body" && bodyScript) return bodyScript;
    if (cacheKey === "probe" && probeScript) return probeScript;
    var script = $.NSAppleScript.alloc.initWithSource(source);
    if (cacheKey === "body") bodyScript = script;
    else probeScript = script;
    return script;
}

function runScript(script) {
    if (!script || script.isNil()) return null;
    var descriptor = script.executeAndReturnError(null);
    if (descriptor.isNil()) return null;
    var value = descriptor.stringValue;
    return value.isNil() ? "" : value.js;
}

// True when macOS lets this process talk to Notes at all.
function notesReachable() {
    var probe = compiledScript("probe", 'tell application "Notes" to count notes');
    return runScript(probe) !== null;
}

// Body HTML of the note selected in Notes.
// NSAppleScript rather than JXA: JXA's Application("Notes").selection() reports an
// empty selection instead of failing when automation access is denied.
function frontNoteBody() {
    var result = { ok: false, body: "", error: "" };
    var body = runScript(compiledScript("body",
        'tell application "Notes"\n' +
        'set sel to selection\n' +
        'if sel is {} then return ""\n' +
        'return body of item 1 of sel\n' +
        'end tell'));
    if (body !== null) {
        result.ok = true;
        result.body = body;
        return result;
    }
    if (notesReachable()) {
        // Reachable but nothing readable right now: no note open, no window.
        result.ok = true;
        return result;
    }
    result.error = "macOS denied automation access to Notes";
    return result;
}

function cleanClipboard() {
    var rtfData = pasteboard.dataForType($.NSPasteboardTypeRTF);
    if (rtfData.isNil()) return;

    var attributed = $.NSAttributedString.alloc.initWithRTFDocumentAttributes(rtfData, $());
    if (attributed.isNil()) return;

    var len = attributed.string.length;
    var kept = $.NSMutableAttributedString.alloc.init;
    var changed = false;
    var previousWasSpace = false;

    for (var i = 0; i < len; i++) {
        var strike = attributed.attributeAtIndexEffectiveRange($.NSStrikethroughStyleAttributeName, i, null);
        if (!strike.isNil() && strike.js != 0) {
            changed = true;
            continue;
        }
        var ch = attributed.string.js[i];
        if (ch === " " && previousWasSpace) {
            changed = true;
            continue;
        }
        previousWasSpace = (ch === " ");
        var piece = attributed.attributedSubstringFromRange($.NSMakeRange(i, 1));
        if (!piece.isNil()) kept.appendAttributedString(piece);
    }

    if (!changed) return;

    var types = $.NSMutableArray.array;
    types.addObject($.NSPasteboardTypeRTF);
    types.addObject($.NSPasteboardTypeString);
    pasteboard.declareTypesOwner(types, null);

    var keptLength = parseInt(kept.length);
    if (keptLength > 0) {
        var rtf = kept.RTFFromRangeDocumentAttributes($.NSMakeRange(0, keptLength), $.NSDictionary.dictionary);
        if (!rtf.isNil()) pasteboard.setDataForType(rtf, $.NSPasteboardTypeRTF);
    }
    var plain = kept.string;
    if (!plain.isNil()) pasteboard.setStringForType(plain, $.NSPasteboardTypeString);
}

// ============ Main loop ============
var tick = 0;
while (true) {
    var deadline = $.NSDate.dateWithTimeIntervalSinceNow(0.3);
    while ($.NSDate.date.compare(deadline) === $.NSOrderedAscending) {
        var event = app.nextEventMatchingMaskUntilDateInModeDequeue(
            $.NSEventMaskAny, $.NSDate.dateWithTimeIntervalSinceNow(0.1),
            $.NSEventTrackingRunLoopMode, true
        );
        if (!event.isNil()) app.sendEvent(event);
    }

    tick++;
    var bundleId = "";
    try {
        bundleId = $.NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier.js;
    } catch (e) {}
    var notesInFront = (bundleId === "com.apple.Notes");

    // Copied text: clean it, then report the selection counters.
    if (notesInFront) {
        var changeCount = pasteboard.changeCount;
        if (changeCount !== lastChangeCount) {
            lastChangeCount = changeCount;
            if (CFG.cleanClipboard) cleanClipboard();
            lastChangeCount = pasteboard.changeCount;

            var copied = pasteboard.stringForType($.NSPasteboardTypeString);
            if (!copied.isNil() && copied.js.length > 0) {
                var copiedCount = countText(copied.js);
                selLabel.setStringValue("选中: 中 " + copiedCount.cjkChars + "字 英 " + copiedCount.enWords +
                    "词 | 共 " + copiedCount.totalChars + "字符");
                writeStatus("ok");
            }
        }
    }

    if (tick % ticksPerRefresh === 0) {
        if (notesInFront) {
            hiddenTicks = 0;
            var note = frontNoteBody();
            if (note.error) {
                totalLabel.setStringValue("全文: 需要授权备忘录");
                selLabel.setStringValue("系统设置 › 隐私与安全性 › 自动化");
                writeStatus("error: " + note.error);
            } else if (note.ok) {
                writeStatus("ok");
                if (note.body !== "" && note.body !== lastBodyHtml) {
                    lastBodyHtml = note.body;
                    var count = countText(htmlToText(note.body));
                    totalLabel.setStringValue("全文: 中 " + count.cjkChars + "字 英 " + count.enWords +
                        "词 | 共 " + count.totalChars + "字符");
                }
            }
            if (!visible) {
                win.orderFront(app);
                visible = true;
            }
        } else {
            hiddenTicks++;
            if (hiddenTicks >= 5 && visible) {
                win.orderOut(app);
                visible = false;
            }
        }
    }
}
