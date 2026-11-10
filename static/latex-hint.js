/* ============================================================================
   LaTeX 内联补全（window.initLatexHint）
   ----------------------------------------------------------------------------
   触发：在数学上下文（$…$ / $$…$$ / \(…\) / \[…\]，且不在代码围栏里）里输入
   反斜杠时弹出；继续输入字母即按前缀过滤。
   排序：前缀命中 > 子串命中；组内 = 候选基础权重 − 使用频率加成（localStorage
   持久化），模板类在短前缀时 +200 让位给纯符号。
   插入：纯符号直接补全；结构模板带 ${n} 跳转锚点，Tab 依序跳转，编辑时锚点
   随文档改动平移。
   ========================================================================== */
(function () {
  "use strict";

  var USAGE_KEY = "diary.latexHint.usage.v1";
  var MAX_SHOW = 40;

  // ---------------------------------------------------------------- 使用频率
  var usage = {};
  try { usage = JSON.parse(localStorage.getItem(USAGE_KEY) || "{}") || {}; } catch (e) { usage = {}; }
  function bumpUsage(cmd) {
    usage[cmd] = (usage[cmd] || 0) + 1;
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(usage)); } catch (e) { /* 存储满就算了 */ }
  }

  // ---------------------------------------------------------------- KaTeX 缓存
  var katexCache = new Map();
  function renderKatex(src) {
    if (!window.katex) return "";
    if (katexCache.has(src)) return katexCache.get(src);
    var html = "";
    try {
      html = window.katex.renderToString(src, { throwOnError: false, displayMode: false });
    } catch (e) { html = ""; }
    if (katexCache.size > 400) katexCache.clear();
    katexCache.set(src, html);
    return html;
  }

  // ---------------------------------------------------------------- 数学上下文
  /* 从文档头扫到光标，跟踪 $ 配对 / \(…\) / \[…\] / 代码围栏，判断光标是否处于
     数学区。行内 `code` 里的 $ 没单独处理（日记里极少见），可接受。 */
  function inMathContext(cm, pos) {
    var s = cm.getRange({ line: 0, ch: 0 }, pos);
    var inMath = false, inFence = false, i = 0, n = s.length;
    while (i < n) {
      var c = s[i];
      // 代码围栏：行首 ```
      if (c === "`" && s.charAt(i + 1) === "`" && s.charAt(i + 2) === "`" &&
          (i === 0 || s.charAt(i - 1) === "\n")) {
        inFence = !inFence;
        i += 3;
        continue;
      }
      if (inFence) { i++; continue; }
      if (c === "\\") {
        var nx = s.charAt(i + 1);
        if (nx === "(" || nx === "[") { inMath = true; i += 2; continue; }
        if (nx === ")" || nx === "]") { inMath = false; i += 2; continue; }
        i += 2;   // 转义字符（含 \$）整体跳过
        continue;
      }
      if (c === "$") {
        if (s.charAt(i + 1) === "$") { inMath = !inMath; i += 2; continue; }
        inMath = !inMath; i++;
        continue;
      }
      i++;
    }
    return inMath;
  }

  /* 光标前是否以 \xxxx 收尾；返回 {from(Pos), to(Pos), prefix(不含\)} 或 null */
  function mathToken(cm) {
    var cur = cm.getCursor();
    var line = cm.getLine(cur.line).slice(0, cur.ch);
    var m = line.match(/\\([A-Za-z]*)$/);
    if (!m) return null;
    if (!inMathContext(cm, cur)) return null;
    return {
      from: { line: cur.line, ch: cur.ch - m[0].length },
      to: { line: cur.line, ch: cur.ch },
      prefix: m[1],
    };
  }

  // ---------------------------------------------------------------- 排序
  function rankCandidates(prefix) {
    var out = [];
    var all = window.LATEX_COMMANDS || [];
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      var m = -1;
      if (!prefix) m = 0;
      else if (c.cmd.indexOf(prefix) === 0) m = 0;         // 前缀命中
      else m = c.cmd.indexOf(prefix);                       // 子串命中
      if (m < 0) continue;
      var score = c.w + (c.tpl ? 200 : 0) + m * 40;
      score -= Math.min(usage[c.cmd] || 0, 40) * 15;        // 常用者靠前
      if (prefix && c.cmd === prefix) score -= 1000;        // 全名命中置顶
      out.push({ c: c, score: score });
    }
    out.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      if (a.c.cmd.length !== b.c.cmd.length) return a.c.cmd.length - b.c.cmd.length;
      return a.c.cmd < b.c.cmd ? -1 : 1;
    });
    var res = [];
    for (var j = 0; j < out.length && j < MAX_SHOW; j++) res.push(out[j].c);
    return res;
  }

  // ---------------------------------------------------------------- 片段锚点
  /* body 里的 ${n} / ${n:默认} → 纯文本 + 锚点（相对插入起点的偏移） */
  function parseSnippet(body) {
    var stops = [];
    var text = "";
    var re = /\$\{(\d+)(?::([^}]*))?\}/g;
    var m, last = 0;
    while ((m = re.exec(body))) {
      text += body.slice(last, m.index);
      var def = m[2] || "";
      stops.push({ n: +m[1], start: text.length, end: text.length + def.length });
      text += def;
      last = m.index + m[0].length;
    }
    text += body.slice(last);
    stops.sort(function (a, b) { return a.n - b.n; });
    return { text: text, stops: stops };
  }

  // ================================================================ 主部件
  window.initLatexHint = function (cm) {
    var box = null, listEl = null;
    var items = [];          // 当前候选
    var sel = 0;             // 选中下标
    var token = null;        // 当前触发 token
    var open = false;
    var keymap = null;
    var snip = null;         // 片段状态
    var selfSel = false;     // 我们自己刚 setSelection，cursorActivity 别解除片段

    function buildDom() {
      box = document.createElement("div");
      box.className = "latex-hint";
      box.setAttribute("role", "listbox");
      listEl = document.createElement("div");
      listEl.className = "lh-list";
      var foot = document.createElement("div");
      foot.className = "lh-foot";
      foot.textContent = "↑↓ 选择 · Tab / Enter 插入 · Esc 关闭";
      box.appendChild(listEl);
      box.appendChild(foot);
      document.body.appendChild(box);
    }

    function highlightCmd(cmd, prefix) {
      // 命中的前缀用 <b> 强调（候选名都是我们自己的，无注入风险）
      var idx = prefix ? cmd.indexOf(prefix) : -1;
      if (idx < 0) return "\\" + cmd;
      return "\\" + cmd.slice(0, idx) + "<b>" + cmd.slice(idx, idx + prefix.length) + "</b>"
        + cmd.slice(idx + prefix.length);
    }

    function render() {
      var html = "";
      for (var i = 0; i < items.length; i++) {
        var c = items[i];
        html += '<div class="lh-item' + (i === sel ? " is-sel" : "") + (c.tpl ? " is-tpl" : "")
          + '" role="option" data-i="' + i + '">'
          + '<span class="lh-sym">' + renderKatex(c.katex || ("\\" + c.cmd)) + "</span>"
          + '<span class="lh-cmd">' + highlightCmd(c.cmd, token ? token.prefix : "") + "</span>"
          + '<span class="lh-desc">' + c.desc + "</span>"
          + "</div>";
      }
      listEl.innerHTML = html;
      var selEl = listEl.children[sel];
      if (selEl && selEl.scrollIntoView) selEl.scrollIntoView({ block: "nearest" });
      position();
    }

    function position() {
      if (!box) return;
      var r = cm.cursorCoords(true, "page");
      var bw = box.offsetWidth, bh = box.offsetHeight;
      var x = Math.max(8, Math.min(r.left, window.innerWidth - bw - 8));
      var y = r.bottom + 6;
      if (y + bh > window.innerHeight - 8 && r.top - bh - 6 > 8) y = r.top - bh - 6;
      box.style.left = Math.round(x) + "px";
      box.style.top = Math.round(y) + "px";
    }

    function attachKeys() {
      if (keymap) return;
      keymap = {
        Up: function () { move(-1); },
        Down: function () { move(1); },
        PageUp: function () { move(-8); },
        PageDown: function () { move(8); },
        Home: function () { sel = 0; render(); },
        End: function () { sel = items.length - 1; render(); },
        Enter: function () { pick(sel); },
        Tab: function () { pick(sel); },
        Esc: function () { close(); },
      };
      cm.addKeyMap(keymap, true);
    }

    function detachKeys() {
      if (!keymap) return;
      cm.removeKeyMap(keymap);
      keymap = null;
    }

    function move(d) {
      if (!items.length) return;
      sel = ((sel + d) % items.length + items.length) % items.length;
      render();
    }

    function show() {
      if (!box) buildDom();
      if (!open) {
        open = true;
        attachKeys();
        box.classList.add("is-open");
      }
      render();
    }

    function close() {
      if (!open) return;
      open = false;
      detachKeys();
      if (box) box.classList.remove("is-open");
    }

    // ------------------------------------------------------------ 选取与插入
    function pick(i) {
      var c = items[i];
      if (!c || !token) return;
      var t = token;
      close();
      bumpUsage(c.cmd);
      var parsed = parseSnippet(c.body);
      var baseIdx = cm.indexFromPos(t.from);
      cm.replaceRange(parsed.text, t.from, t.to, "+latex");
      if (parsed.stops.length) {
        startSnippet(baseIdx, parsed);
      } else {
        cm.setCursor(cm.posFromIndex(baseIdx + parsed.text.length));
      }
      cm.focus();
    }

    // ------------------------------------------------------------ 片段引擎
    function startSnippet(baseIdx, parsed) {
      var stops = parsed.stops.map(function (s) {
        return { start: baseIdx + s.start, end: baseIdx + s.end };
      });
      // 隐含 ${0} 出口锚点：Tab 走到底时光标落在片段末尾
      stops.push({ start: baseIdx + parsed.text.length, end: baseIdx + parsed.text.length, exit: true });
      snip = { base: baseIdx, stops: stops, cur: 0 };
      selectStop();
      armSnippetKeys();
    }

    function selectStop() {
      if (!snip) return;
      var s = snip.stops[snip.cur];
      if (!s) { endSnippet(false); return; }
      if (s.exit) { endSnippet(true); return; }   // Tab 到底：落点出口锚点
      selfSel = true;
      if (s.end > s.start) cm.setSelection(cm.posFromIndex(s.start), cm.posFromIndex(s.end));
      else cm.setCursor(cm.posFromIndex(s.start));
      selfSel = false;
    }

    function armSnippetKeys() {
      if (keymap) return;
      keymap = {
        Tab: function () {
          if (!snip) return;
          snip.cur++;
          selectStop();
        },
        Esc: function () { endSnippet(false); },
      };
      cm.addKeyMap(keymap, true);
    }

    function endSnippet(placeCursor) {
      // 只有 Tab 走到底（placeCursor=true）才把光标挪到出口锚点；
      // 用户自己点击/方向键离开时原地不动
      if (snip && placeCursor) {
        var last = snip.stops[snip.stops.length - 1];
        if (last) cm.setCursor(cm.posFromIndex(last.end));
      }
      snip = null;
      detachKeys();
    }

    /* 文档变化时平移锚点。change.to 是旧坐标里被替换区的末端；在它之后的锚点
       都要跟着 delta 走。 */
    function shiftStops(change) {
      if (!snip) return;
      var removed = change.removed ? change.removed.join("\n").length : 0;
      var delta = change.text.join("\n").length - removed;
      var at = cm.indexFromPos(change.to);
      for (var i = 0; i < snip.stops.length; i++) {
        var s = snip.stops[i];
        if (s.start >= at) { s.start += delta; s.end += delta; }
      }
    }

    // ------------------------------------------------------------ 事件
    var refreshTimer = 0;
    function scheduleRefresh() {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, 30);
    }

    function refresh() {
      if (snip) return;      // 片段跳转期间别弹
      token = mathToken(cm);
      if (!token) { close(); return; }
      items = rankCandidates(token.prefix);
      if (!items.length) { close(); return; }
      if (sel >= items.length) sel = 0;
      show();
    }

    cm.on("change", function (cm2, change) {
      shiftStops(change);
      if (open || change.origin !== "setValue") scheduleRefresh();
    });
    cm.on("cursorActivity", function () {
      if (selfSel) return;
      if (snip) {
        // 只在光标离开整个片段区间时才解除；在空锚点里打字不算离开
        var idx = cm.indexFromPos(cm.getCursor());
        var first = snip.stops[0], last = snip.stops[snip.stops.length - 1];
        if (idx < first.start || idx > last.end) endSnippet(false);
        return;
      }
      // 光标停在一个 \xxx 尾部时同样补一次（点击/方向键挪进来的场景）
      scheduleRefresh();
    });
    cm.on("scroll", close);
    cm.on("blur", close);

    // 鼠标选择：mousedown 拦默认行为，焦点留在编辑器里
    document.addEventListener("mousedown", function (e) {
      if (!open || !box) return;
      var row = e.target && e.target.closest ? e.target.closest(".lh-item") : null;
      if (row && box.contains(row)) {
        e.preventDefault();
        pick(+row.dataset.i);
      } else if (!box.contains(e.target)) {
        close();
      }
    }, true);

    // ------------------------------------------------------------ 调试钩子
    window.__LATEX_HINT = {
      isOpen: function () { return open; },
      items: function () { return items.map(function (c) { return c.cmd; }); },
      select: move,
      pick: pick,
      close: close,
      refresh: refresh,
      token: function () { return token && token.prefix; },
    };
  };
})();
