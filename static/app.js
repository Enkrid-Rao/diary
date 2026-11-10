/* 日记 · 前端逻辑 v5
   动效原则：
   · 弹层只有一个状态源（state.overlay → body[data-overlay]），不会出现两个面板同时开着
   · 进场/退场靠 CSS transition + .anim，JS 只负责切状态，不写内联 transition
   · 只动 opacity / transform，避免触发重排；翻页时两侧内容先压暗再换，遮住硬切
*/
(function () {
  "use strict";

  // ---------- 动效常量（与 style.css 令牌保持一致） ----------
  const DUR = { 0: 70, 1: 130, 2: 190, 3: 270, 4: 400 };
  const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
  const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
  const EASE_IN = "cubic-bezier(0.4, 0, 0.9, 0.2)";
  const EASE_SPRING = "cubic-bezier(0.34, 1.16, 0.64, 1)";
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");

  // ---------- 工具 ----------
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const DOW = ["日", "一", "二", "三", "四", "五", "六"];

  function parseDate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function shift(dateStr, days) {
    const d = parseDate(dateStr);
    d.setDate(d.getDate() + days);
    return fmt(d);
  }
  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  /* rAF 在窗口被遮挡/最小化时会暂停，等它可能永远等不到。
     这里加一次 60ms 兜底：正常有帧时走 rAF，无帧时也能按时继续。 */
  const nextFrame = () => new Promise((r) => {
    let done = false;
    const go = () => { if (!done) { done = true; r(); } };
    requestAnimationFrame(go);
    setTimeout(go, 60);
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- 设置：启动即读（后端注入，无需等待网络） ----------
  const BOOT = window.__BOOT__ || null;
  let S = BOOT && BOOT.settings ? BOOT.settings : null;
  let DEFAULTS = BOOT && BOOT.defaults ? BOOT.defaults : null;
  let META = (BOOT && BOOT.meta) || { version: "", diaryDir: "", defaultDir: "" };

  /* 动效总开关：系统偏好 + 设置项，两者有一个说"不要"就不动 */
  function motionOK() {
    if (REDUCED.matches) return false;
    if (S && S.appearance && S.appearance.motion === false) return false;
    return !document.body.classList.contains("no-motion");
  }

  /* 统一入场：只换 keyframes 名与参数，不往元素上堆内联 transition。
     name: aFade | aFadeUp | aFadeDown | aFadeLeft | aFadeRight | aPop | aNudgeY */
  function runAnim(el, name, opt) {
    if (!el || !el.classList || !motionOK()) return null;
    opt = opt || {};
    el.classList.remove("anim");
    void el.offsetWidth;                       // 强制回流，让同名动画能重放
    el.style.setProperty("--a-name", name || "aFade");
    el.style.setProperty("--a-dur", (opt.dur || DUR[3]) + "ms");
    el.style.setProperty("--a-ease", opt.ease || EASE_OUT);
    el.style.setProperty("--a-delay", (opt.delay || 0) + "ms");
    if (opt.dist != null) el.style.setProperty("--a-dist", opt.dist + "px");
    if (opt.from != null) el.style.setProperty("--a-from", String(opt.from));
    el.classList.add("anim");
    const done = () => { el.classList.remove("anim"); el.removeEventListener("animationend", done); };
    el.addEventListener("animationend", done);
    return el;
  }

  // 低强度文案反馈：数字/状态标签变化时轻轻推一下
  function nudge(el, dy, dur) {
    runAnim(el, "aNudgeY", { dur: dur || DUR[2], dist: Math.abs(dy || 3) });
  }

  // ---------- 状态 ----------
  let currentDate = fmt(new Date());
  let knownDates = new Set();
  let dirty = false;
  let loadSeq = 0;

  const state = { overlay: null };   // null | "calendar" | "settings"

  // ---------- Markdown 编辑辅助 ----------
  function wrapToken(cm, left, right) {
    right = right || left;
    cm.operation(() => {
      if (cm.somethingSelected()) {
        const sel = cm.getSelection();
        const from = cm.getCursor("from");
        const to = cm.getCursor("to");
        const before = cm.getRange({ line: from.line, ch: from.ch - left.length }, from);
        const after = cm.getRange(to, { line: to.line, ch: to.ch + right.length });
        if (before === left && after === right) {
          cm.replaceRange("", to, { line: to.line, ch: to.ch + right.length });
          cm.replaceRange("", { line: from.line, ch: from.ch - left.length }, from);
          cm.setSelection(
            { line: from.line, ch: from.ch - left.length },
            { line: to.line, ch: to.ch - left.length });
        } else {
          cm.replaceSelection(left + sel + right);
          const sameLine = from.line === to.line;
          cm.setSelection(
            { line: from.line, ch: from.ch + left.length },
            { line: to.line, ch: to.ch + (sameLine ? left.length : 0) });
        }
      } else {
        const cur = cm.getCursor();
        cm.replaceRange(left + right, cur);
        cm.setCursor({ line: cur.line, ch: cur.ch + left.length });
      }
      cm.focus();
    });
  }

  function insertLink(cm) {
    cm.operation(() => {
      if (cm.somethingSelected()) {
        const sel = cm.getSelection();
        cm.replaceSelection("[" + sel + "](url)");
        const cur = cm.getCursor();
        cm.setSelection({ line: cur.line, ch: cur.ch - 5 }, { line: cur.line, ch: cur.ch - 1 });
      } else {
        const cur = cm.getCursor();
        cm.replaceRange("[](url)", cur);
        cm.setSelection({ line: cur.line, ch: cur.ch + 6 }, { line: cur.line, ch: cur.ch + 9 });
      }
      cm.focus();
    });
  }

  function toggleHeading(cm, level) {
    const line = cm.getCursor().line;
    const text = cm.getLine(line);
    const m = text.match(/^(#{1,6})\s+/);
    const prefix = "#".repeat(level) + " ";
    cm.operation(() => {
      if (m && m[1].length === level) {
        cm.replaceRange("", { line, ch: 0 }, { line, ch: m[0].length });
      } else if (m) {
        cm.replaceRange(prefix, { line, ch: 0 }, { line, ch: m[0].length });
      } else {
        cm.replaceRange(prefix, { line, ch: 0 });
      }
      cm.focus();
    });
  }

  const cm = CodeMirror.fromTextArea($("#editor"), {
    mode: "markdown",
    theme: "dracula",
    lineWrapping: true,
    styleActiveLine: true,
    matchBrackets: true,
    autoCloseBrackets: {
      pairs: "()[]{}''\"\"``$$",
      explode: "[]{}()",
      override: true,
    },
    placeholder: "今天发生了什么…",
    extraKeys: {},
  });

  const editorScroller = cm.getScrollerElement();
  const previewPane = $("#previewPane");
  const previewEl = $("#preview");

  // LaTeX 内联补全（数学上下文里输入 \ 触发）
  if (window.initLatexHint) initLatexHint(cm);

  // ---------- 渲染 ----------
  const md = window.markdownit({
    html: false,
    linkify: true,
    breaks: true,
    typographer: true,
  });

  /* ---------- 数学片段抽取 ----------
     markdown-it 会把反斜杠当转义符：`\(` 变 `(`、`\{` 变 `{`，KaTeX 拿到的就是残缺内容。
     所以渲染前先把公式整段抠出来换成占位符，markdown 跑完再回填 KaTeX HTML。
     占位符补上与原文等量的换行，保证 token.map 的行号和源码一致（同步滚动依赖它）。 */
  const MATH_OPEN = "\uE000";
  const MATH_CLOSE = "\uE001";

  function extractMath(src) {
    const segs = [];
    let out = "";
    let i = 0;
    const n = src.length;
    let lineStart = true;

    function push(tex, display, raw) {
      const idx = segs.length;
      segs.push({ tex: tex, display: display });
      const nl = raw.split("\n").length - 1;
      out += MATH_OPEN + idx + MATH_CLOSE + "\n".repeat(nl);
    }

    while (i < n) {
      const ch = src[i];

      // 行首围栏代码块：整块原样复制
      if (lineStart) {
        let q = i;
        while (q < n && src[q] === " " && q - i < 4) q++;
        const fc = src[q];
        if (fc === "`" || fc === "~") {
          let r = q;
          while (r < n && src[r] === fc) r++;
          if (r - q >= 3) {
            const fence = fc;
            const flen = r - q;
            let e = src.indexOf("\n", i);
            let stop = e < 0 ? n : e + 1;
            out += src.slice(i, stop);
            i = stop;
            while (i < n) {
              e = src.indexOf("\n", i);
              const line = src.slice(i, e < 0 ? n : e);
              stop = e < 0 ? n : e + 1;
              out += src.slice(i, stop);
              i = stop;
              const m = line.match(/^\s*(`{3,}|~{3,})\s*$/);
              if (m && m[1][0] === fence && m[1].length >= flen) break;
            }
            lineStart = true;
            continue;
          }
        }
      }
      lineStart = false;

      // 行内代码：原样复制
      if (ch === "`") {
        let r = i;
        while (r < n && src[r] === "`") r++;
        const ticks = src.slice(i, r);
        const end = src.indexOf(ticks, r);
        if (end > 0) {
          const stop = end + ticks.length;
          out += src.slice(i, stop);
          i = stop;
          continue;
        }
      }

      // \( ... \) / \[ ... \]
      if (ch === "\\") {
        const nx = src[i + 1];
        if (nx === "(" || nx === "[") {
          const closeSeq = nx === "(" ? "\\)" : "\\]";
          const end = src.indexOf(closeSeq, i + 2);
          if (end > 0) {
            const raw = src.slice(i, end + 2);
            push(src.slice(i + 2, end), nx === "[", raw);
            i = end + 2;
            continue;
          }
        }
        out += src.slice(i, Math.min(i + 2, n));   // 其他转义成对保留（含 \$）
        i += 2;
        continue;
      }

      // $ ... $ / $$ ... $$
      if (ch === "$") {
        const dbl = src[i + 1] === "$";
        const openLen = dbl ? 2 : 1;
        let j = i + openLen;
        let closeAt = -1;
        while (j < n) {
          if (src[j] === "\\") { j += 2; continue; }
          if (src[j] === "$") {
            if (dbl) {
              if (src[j + 1] === "$") { closeAt = j; break; }
              j++;
              continue;
            }
            closeAt = j;
            break;
          }
          j++;
        }
        if (closeAt > i + openLen) {
          const tex = src.slice(i + openLen, closeAt);
          // 单个 $ 的防误判：两侧不留空白、闭合后不接数字（"$5 和 $10" 不是公式）
          const badSingle = !dbl && (/^\s/.test(tex) || /\s$/.test(tex) || /^\d/.test(src[closeAt + 1] || ""));
          if (tex.trim() && !badSingle) {
            push(tex, dbl, src.slice(i, closeAt + openLen));
            i = closeAt + openLen;
            continue;
          }
        }
      }

      if (ch === "\n") {
        out += ch;
        i++;
        lineStart = true;
        continue;
      }
      out += ch;
      i++;
    }
    return { text: out, segs: segs };
  }

  function injectMath(html, segs) {
    if (!segs.length) return html;
    return html.replace(/\uE000(\d+)\uE001/g, function (m, k) {
      const s = segs[+k];
      if (!s) return m;
      try {
        return window.katex.renderToString(s.tex, {
          displayMode: s.display,
          throwOnError: false,
        });
      } catch (err) {
        return m;
      }
    });
  }

  function renderPreview() {
    const text = cm.getValue();
    if (!text.trim()) {
      previewPane.classList.add("is-empty");
      previewEl.innerHTML = "";
      anchors = [];
      resetSyncGeometry();
      return;
    }
    previewPane.classList.remove("is-empty");
    // 必须走 parse + renderer.render 而不是 md.render()，否则拿不到 token 的源码行号
    const math = extractMath(text);
    const env = {};
    const tokens = md.parse(math.text, env);
    let html = md.renderer.render(tokens, md.options, env);
    html = injectMath(html, math.segs);
    previewEl.innerHTML = html;
    anchors = buildAnchors(tokens, previewEl);
    resetSyncGeometry();   // 正文改了行号就变了，实测样本必须丢

    previewEl.querySelectorAll("a").forEach((a) => {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    });
    // 图片撑高之后锚点会失效，加载完重新量
    previewEl.querySelectorAll("img").forEach((img) => {
      if (!img.complete) img.addEventListener("load", invalidateSync, { once: true });
    });
    if (window.renderMathInElement) {
      renderMathInElement(previewEl, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false },
          { left: "$", right: "$", display: false },
        ],
        ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
        throwOnError: false,
      });
    }
  }
  const renderPreviewDebounced = debounce(renderPreview, 140);

  // ---------- 字数 ----------
  let lastWordText = "";
  function updateWordCount() {
    const text = cm.getValue().trim();
    const el = $("#wordCount");
    if (!text) {
      if (el.textContent) { el.textContent = ""; lastWordText = ""; }
      return;
    }
    const cjk = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
    const words = (text.replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, " ")
      .match(/[a-zA-Z0-9]+/g) || []).length;
    const total = cjk + words;
    const next = `${total} 字`;
    if (next !== lastWordText) {
      const digitChanged = String(lastWordText).length !== next.length;
      el.textContent = next;
      lastWordText = next;
      if (digitChanged) nudge(el, 3, DUR[2]);   // 位数变化时才动，避免每敲一个字都在抖
    }
  }
  const updateWordCountDebounced = debounce(updateWordCount, 200);

  // ---------- 保存 ----------
  function setSaveState(stateName, text) {
    const el = $("#saveState");
    const cls = "meta save-state " + stateName;
    if (el.className !== cls) el.className = cls;
    const label = $("#saveText");
    if (label.textContent !== text) {
      label.textContent = text;
      nudge(label, -3, DUR[2]);
    }
  }

  async function saveNow() {
    if (!dirty) return;
    const content = cm.getValue();
    setSaveState("saving", "保存中…");
    try {
      const r = await fetch("/api/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: currentDate, content }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error("save failed");
      dirty = false;
      setSaveState("saved", `已保存 ${data.savedAt}`);
      refreshListSoft(content);
    } catch (e) {
      setSaveState("error", "保存失败");
    }
  }
  let saveDebounced = debounce(saveNow, 900);

  cm.on("change", () => {
    dirty = true;
    setSaveState("dirty", "未保存");
    renderPreviewDebounced();
    updateWordCountDebounced();
    saveDebounced();
  });

  // ---------- 日期 ----------
  function updateDateUI() {
    const d = parseDate(currentDate);
    $("#dateTitle").textContent = `${d.getMonth() + 1}月${d.getDate()}日`;
    const today = fmt(new Date());
    const isTodayMark = currentDate === today;
    $("#dateSub").innerHTML =
      `${d.getFullYear()} · 周${DOW[d.getDay()]}${isTodayMark ? ' · <span class="today-mark">今天</span>' : ""}`;
    document.title = `日记 · ${currentDate}`;
  }

  /* 翻页：两侧内容先压暗一档，数据回来再换，换完淡回来。
     这样即便本地读盘只要 3ms，用户看到的也是一次"过渡"而不是"闪一下"。 */
  async function loadDate(date) {
    if (dirty) await saveNow();
    const seq = ++loadSeq;
    const dir = date < currentDate ? -1 : (date > currentDate ? 1 : 0);
    currentDate = date;
    updateDateUI();
    advanceTitle(dir);
    markActiveItem();

    const ws = $("#workspace");
    const fade = motionOK() && dir !== 0;
    const t0 = performance.now();
    switching = true;                         // 换页期间别让联动滚动把旧位置带过去
    if (fade) ws.classList.add("is-switching");

    let data = null;
    try {
      const r = await fetch(`/api/entry?date=${date}`);
      data = await r.json();
    } catch (e) { /* 失败也继续，至少把界面切过去 */ }
    if (seq !== loadSeq) return;              // 已经被更新的翻页取代，别回填旧数据

    if (fade) await sleep(Math.max(0, 100 - (performance.now() - t0)));

    if (data) {
      cm.setValue(data.content || "");
      cm.clearHistory();
      dirty = false;
      setSaveState("saved", data.exists ? "已加载" : "新的一页");
    } else {
      setSaveState("error", "读取失败");
    }
    renderPreview();
    updateWordCount();
    // 换页后两栏都回到顶部，否则新的一页会停在上一篇的滚动位置上
    editorScroller.scrollTop = 0;
    previewPane.scrollTop = 0;
    resetSyncGeometry();       // 换了一篇，实测样本全作废
    switching = false;
    if (!state.overlay) cm.focus();

    if (fade) {
      await nextFrame();
      await nextFrame();
      if (seq === loadSeq) ws.classList.remove("is-switching");
    }
    rememberLastDate(date);
  }

  function advanceTitle(dir) {
    if (!dir) return;
    runAnim($("#dateTitle"), dir > 0 ? "aFadeRight" : "aFadeLeft", { dur: DUR[3], dist: 12 });
    runAnim($("#dateSub"), "aFade", { dur: DUR[3], delay: 30 });
  }

  const rememberLastDate = debounce((date) => {
    if (!S || S.general.startup !== "last") return;
    fetch("/api/settings/lastdate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    }).catch(() => {});
  }, 700);

  // ---------- 侧边列表 ----------
  function esc(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  async function refreshList() {
    try {
      const r = await fetch("/api/list");
      const data = await r.json();
      buildList(data.entries);
      if (data.dir) META.diaryDir = data.dir;
    } catch (e) { /* 列表失败不打断 */ }
  }

  function buildList(entries) {
    knownDates = new Set(entries.map((e) => e.date));
    $("#totalCount").textContent = entries.length ? `共 ${entries.length} 篇` : "";
    const list = $("#entryList");
    if (!entries.length) {
      list.innerHTML = `<div class="list-empty">还没有日记<br>从右边这一页开始吧</div>`;
      return;
    }
    const today = fmt(new Date());
    let html = "";
    let lastMonth = "";
    let i = 0;
    for (const e of entries) {
      const month = e.date.slice(0, 7);
      if (month !== lastMonth) {
        lastMonth = month;
        const [y, m] = month.split("-");
        const isThisMonth = month === today.slice(0, 7);
        html += `<div class="month-group">${y}年${Number(m)}月${isThisMonth ? " · 本月" : ""}</div>`;
      }
      const d = parseDate(e.date);
      const excerpt = e.excerpt ? esc(e.excerpt) : "<i style='opacity:.5'>（无文字）</i>";
      html += `
        <button class="entry-item" data-date="${e.date}" style="--i:${i}">
          <span class="row1"><span class="day">${d.getDate()}日</span><span class="dow">周${DOW[d.getDay()]}</span></span>
          <span class="excerpt">${excerpt}</span>
        </button>`;
      i++;
    }
    list.innerHTML = html;
    list.querySelectorAll(".entry-item").forEach((btn) => {
      btn.addEventListener("click", () => loadDate(btn.dataset.date));
    });
    markActiveItem();
  }

  // 保存后轻量更新列表项（不重新拉取整个列表）
  function refreshListSoft(content) {
    const has = knownDates.has(currentDate);
    const empty = !content.trim();
    if (has === empty) {
      refreshList();
      return;
    }
    const btn = document.querySelector(`.entry-item[data-date="${currentDate}"] .excerpt`);
    if (btn) {
      const plain = content.replace(/[#>*`\-\[\]()$]/g, "").split("\n")
        .map((l) => l.trim()).filter(Boolean).join(" ").slice(0, 60);
      btn.textContent = plain || "（无文字）";
    }
  }

  /* 高亮当前条目：只有它完全在可视区之外才滚动，
     避免每翻一天就把用户的滚动位置拽回去。 */
  function markActiveItem() {
    const list = $("#entryList");
    const items = document.querySelectorAll(".entry-item");
    items.forEach((el) => {
      const on = el.dataset.date === currentDate;
      const wasOn = el.classList.contains("active");
      el.classList.toggle("active", on);
      if (!on || wasOn || !list) return;
      const box = el.getBoundingClientRect();
      const view = list.getBoundingClientRect();
      const out = box.top < view.top + 8 || box.bottom > view.bottom - 8;
      if (out) el.scrollIntoView({ block: "nearest", behavior: motionOK() ? "smooth" : "auto" });
    });
  }

  // ---------- 顶栏交互 ----------
  $("#prevDay").addEventListener("click", () => loadDate(shift(currentDate, -1)));
  $("#nextDay").addEventListener("click", () => loadDate(shift(currentDate, 1)));
  $("#todayBtn").addEventListener("click", () => loadDate(fmt(new Date())));

  // ---------- 弹层状态机 ----------
  /* 全页只有一处记着"现在开着什么"，两个面板不可能同时出现在屏幕上 */
  function setOverlay(name) {
    if (state.overlay === name) return;
    state.overlay = name;
    if (name) document.body.dataset.overlay = name;
    else delete document.body.dataset.overlay;
    $("#calBtn").classList.toggle("is-open", name === "calendar");
    $("#settingsBtn").classList.toggle("is-open", name === "settings");
    $("#searchBtn").classList.toggle("is-open", name === "search");
  }
  function overlayOpen() { return state.overlay !== null; }

  // ---------- 日历弹层 ----------
  const calPop = $("#calendarPop");
  let calView = null;

  async function openCalendar() {
    if (state.overlay === "calendar") return;
    calView = parseDate(currentDate);
    calView.setDate(1);
    try {
      const r = await fetch("/api/list");
      const data = await r.json();
      knownDates = new Set(data.entries.map((e) => e.date));
    } catch (e) { /* 沿用已有 */ }
    renderCalendar();
    positionCal();
    setOverlay("calendar");
  }

  function positionCal() {
    const btn = $("#calBtn").getBoundingClientRect();
    const top = Math.round(btn.bottom + 10);
    const left = Math.round(Math.max(10, Math.min(btn.left, window.innerWidth - 316)));
    calPop.style.top = top + "px";
    calPop.style.left = left + "px";
    // 以触发按钮为缩放原点：弹层像是从按钮里长出来的
    calPop.style.setProperty("--cal-origin", `${Math.round(btn.left + btn.width / 2 - left)}px 0px`);
  }

  function closeCalendar() {
    if (state.overlay === "calendar") setOverlay(null);
  }

  function renderCalendar() {
    const y = calView.getFullYear();
    const m = calView.getMonth();
    const first = new Date(y, m, 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(y, m, 1 - offset);
    const today = fmt(new Date());

    let cells = "";
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const ds = fmt(d);
      const cls = ["cal-day"];
      if (d.getMonth() !== m) cls.push("other");
      if (ds === today) cls.push("today");
      if (ds === currentDate) cls.push("selected");
      if (knownDates.has(ds)) cls.push("has-entry");
      cells += `<button class="${cls.join(" ")}" data-date="${ds}">${d.getDate()}</button>`;
    }

    calPop.innerHTML = `
      <div class="cal-head">
        <span class="cal-title">${y}年${pad(m + 1)}月</span>
        <span class="cal-spacer"></span>
        <button class="cal-today" data-act="today">今天</button>
        <button class="cal-nav" data-act="prev" aria-label="上个月">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button class="cal-nav" data-act="next" aria-label="下个月">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>
      <div class="cal-week">
        ${["一", "二", "三", "四", "五", "六", "日"].map((w) => `<span>${w}</span>`).join("")}
      </div>
      <div class="cal-grid">${cells}</div>`;

    calPop.querySelectorAll(".cal-day").forEach((b) => {
      b.addEventListener("click", () => {
        setOverlay(null);
        loadDate(b.dataset.date);
      });
    });
    calPop.querySelectorAll(".cal-nav").forEach((b) => {
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        calView.setMonth(calView.getMonth() + (b.dataset.act === "next" ? 1 : -1));
        renderCalendar();
        runAnim(calPop.querySelector(".cal-grid"), "aFade", { dur: DUR[2] });
      });
    });
    calPop.querySelector(".cal-today").addEventListener("click", () => {
      setOverlay(null);
      loadDate(fmt(new Date()));
    });
  }

  function toggleCalendar() {
    if (state.overlay === "calendar") closeCalendar();
    else openCalendar();
  }
  $("#calBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleCalendar(); });
  $(".date-block").addEventListener("click", (e) => { e.stopPropagation(); toggleCalendar(); });

  document.addEventListener("pointerdown", (e) => {
    if (state.overlay !== "calendar") return;
    if (calPop.contains(e.target)) return;
    if (e.target.closest && e.target.closest("#calBtn, .date-block")) return;
    closeCalendar();
  });

  // ---------- 全文搜索 ----------
  /* 结果列表只做展示，真正的定位交给 openResult：
     换日期 → 选中命中句 → 编辑区滚到中部（同步开着时预览会自己跟过去）。 */
  const searchOverlay = $("#searchOverlay");
  const searchInput = $("#searchInput");
  const searchResults = $("#searchResults");
  const searchCount = $("#searchCount");
  let searchList = [];
  let searchSel = -1;
  let searchTimer = 0;
  let searchSeq = 0;

  function shortDate(date) {
    const d = parseDate(date);
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 周" + DOW[d.getDay()];
  }

  const SEARCH_HINT = '<div class="sr-hint">输入关键词，搜索全部日记的正文</div>';

  function openSearch() {
    if (state.overlay === "search") { searchInput.focus(); searchInput.select(); return; }
    setOverlay("search");
    searchInput.value = "";
    searchList = [];
    searchSel = -1;
    searchResults.innerHTML = SEARCH_HINT;
    searchCount.textContent = "";
    focusSearch();
  }

  /* 面板是靠 body[data-overlay] 切换 visibility 的，属性写入后同步 focus 即可；
     少数环境（样式还没 flush 完）会静默失败，下一轮事件循环再兜一次。 */
  function focusSearch() {
    searchInput.focus({ preventScroll: true });
    if (document.activeElement === searchInput) return;
    setTimeout(() => {
      if (state.overlay === "search") searchInput.focus({ preventScroll: true });
    }, 0);
  }

  function closeSearch() {
    if (state.overlay !== "search") return;
    setOverlay(null);
    searchList = [];
    searchSel = -1;
    searchResults.innerHTML = "";
    searchCount.textContent = "";
    cm.focus();
  }

  function selResult(i) {
    const items = searchResults.querySelectorAll(".sr-item");
    if (!items.length) return;
    searchSel = (i + items.length) % items.length;
    items.forEach((el, k) => el.classList.toggle("is-sel", k === searchSel));
    items[searchSel].scrollIntoView({ block: "nearest" });
  }

  function renderResults(list, q) {
    searchList = list;
    searchSel = -1;
    if (!list.length) {
      searchResults.innerHTML = '<div class="sr-hint">没有找到「' + esc(q) + '」</div>';
      return;
    }
    searchResults.innerHTML = list.map((r, i) => {
      const before = esc(r.snippet.slice(0, r.hl));
      const hit = esc(r.snippet.slice(r.hl, r.hlEnd));
      const after = esc(r.snippet.slice(r.hlEnd));
      return '<button class="sr-item" type="button" data-i="' + i + '">' +
        '<span class="sr-meta"><span class="sr-date">' + shortDate(r.date) + '</span>' +
        '<span class="sr-title">' + esc(r.title) + '</span></span>' +
        '<span class="sr-snippet">' + before + '<mark>' + hit + '</mark>' + after + '</span>' +
        '</button>';
    }).join("");
    selResult(0);
  }

  async function runSearch() {
    const q = searchInput.value.trim();
    if (!q) {
      searchResults.innerHTML = SEARCH_HINT;
      searchCount.textContent = "";
      searchList = [];
      return;
    }
    const seq = ++searchSeq;
    try {
      const r = await fetch("/api/search?q=" + encodeURIComponent(q));
      const data = await r.json();
      if (seq !== searchSeq) return;        // 已经被更新的输入取代
      renderResults(data.results || [], q);
      searchCount.textContent = data.count ? data.count + " 处" : "";
    } catch (e) {
      if (seq === searchSeq) searchResults.innerHTML = '<div class="sr-hint">搜索失败</div>';
    }
  }

  /* 同步关闭时预览不会自己跟过去，手动滚到对应块 */
  function scrollPreviewToLine(line) {
    if (!anchors.length) return;
    let target = anchors[0];
    for (let i = 0; i < anchors.length; i++) {
      if (anchors[i].line <= line) target = anchors[i];
      else break;
    }
    previewPane.scrollTop = Math.max(0, target.el.offsetTop - 20);
  }

  async function openResult(r) {
    if (!r) return;
    closeSearch();
    if (r.date !== currentDate) await loadDate(r.date);
    const line = Math.min(r.line, cm.lineCount() - 1);
    const text = cm.getLine(line);
    cm.setSelection(
      { line: line, ch: Math.min(r.from, text.length) },
      { line: line, ch: Math.min(r.to, text.length) }
    );
    cm.focus();
    // 命中的句子落在编辑区中部，而不是贴着上边缘
    const h = editorScroller.clientHeight;
    cm.scrollIntoView({ line: line, ch: 0 }, Math.max(40, Math.round(h / 2)));
    if (!syncEnabled) scrollPreviewToLine(line);
  }

  $("#searchBtn").addEventListener("click", (e) => { e.stopPropagation(); openSearch(); });
  $("#searchClose").addEventListener("click", closeSearch);

  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 150);
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); selResult(searchSel + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); selResult(searchSel - 1); }
    else if (e.key === "Enter") { e.preventDefault(); openResult(searchList[searchSel]); }
    else if (e.key === "Escape") { e.preventDefault(); closeSearch(); }
  });

  searchResults.addEventListener("click", (e) => {
    const btn = e.target.closest(".sr-item");
    if (!btn) return;
    openResult(searchList[Number(btn.dataset.i)]);
  });

  searchOverlay.addEventListener("pointerdown", (e) => {
    if (state.overlay !== "search") return;
    if (e.target === searchOverlay) closeSearch();
  });


  function toggleSidebar() {
    const app = $("#app");
    app.classList.toggle("side-collapsed");
    localStorage.setItem("diary.sideCollapsed", app.classList.contains("side-collapsed") ? "1" : "");
  }
  $("#toggleSide").addEventListener("click", toggleSidebar);
  if (localStorage.getItem("diary.sideCollapsed") === "1") {
    $("#app").classList.add("side-collapsed");
  }

  // ---------- 分栏拖拽 ----------
  const divider = $("#divider");
  const workspace = $("#workspace");
  const editorPane = $("#editorPane");
  let ratio = 0.5;

  function applyRatio(r) {
    ratio = Math.min(0.8, Math.max(0.2, r));
    editorPane.style.width = (ratio * 100) + "%";
    editorPane.style.flex = "none";
    resetSyncGeometry();       // 宽度变了，折行随之变化：预览高度与实测样本全部作废
  }
  const persistRatio = debounce(() => {
    if (!S) return;
    S.appearance.splitRatio = ratio;
    pushSettings(S);
  }, 600);

  let dragging = false;
  divider.addEventListener("pointerdown", (e) => {
    dragging = true;
    divider.classList.add("dragging");
    workspace.classList.add("is-resizing");
    divider.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
  });
  divider.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = workspace.getBoundingClientRect();
    let r = (e.clientX - rect.left) / rect.width;
    // 接近正中间时轻微磁吸，回正不靠眼力
    if (Math.abs(r - 0.5) < 0.015) r = 0.5;
    applyRatio(r);
    if (S) S.appearance.splitRatio = ratio;
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove("dragging");
    workspace.classList.remove("is-resizing");
    document.body.style.cursor = "";
    persistRatio();
  }
  divider.addEventListener("pointerup", endDrag);
  divider.addEventListener("pointercancel", endDrag);
  divider.addEventListener("dblclick", () => {
    applyRatio(0.5);
    if (S) S.appearance.splitRatio = 0.5;
    persistRatio();
  });

  // ============================================================
  // 左右联动滚动
  // ============================================================
  /* 不按滚动比例硬同步，也不依赖 CodeMirror 的整篇高度表——它对还没渲染过的行
     一律按「默认行高 × 行数」估算，长段落一折行就偏，而且越往下累积越多，
     滚到后面能差出好几个屏幕。
     这里改成从「当前视口」出发的三步：
       ① 直接量已渲染的 DOM，得到视口顶部是哪一行、这行的真实 y（所见即所得）；
       ② 用 markdown-it 的 token.map 知道这行落在哪个源码块里，算出块内进度 r；
       ③ 把同一个 r 套到预览区那个块的真实像素高度上。
     每个滚动事件都从当前视口重算一次，误差不跨块累积，跳转之后也能立刻对齐。 */

  const SYNC_EPS = 0.6;
  let anchors = [];          // [{line, el, py}] 按源码行递增，py = 该块在预览里的 y
  let previewDirty = true;   // 预览侧高度需要重新量（重渲染 / 拖分栏 / 图片加载完）
  let echoEl = null;         // 刚被程序刷过的那一栏
  let echoY = 0;             // 刷进去的值：下一帧它自己的 scroll 事件要认出来，别当成用户滚动
  let switching = false;     // 换日期期间暂停联动
  let syncEnabled = true;    // 生效中的开关值（跟随设置面板里的 draft，而不是已保存的 S）
  let syncApprox = false;    // 这一次是按估算值对位的，需要重排后再补一次
  let settleTimer = 0;
  const samples = [];        // 编辑器里实测过的行：[{line, y}]，按 line 递增

  function buildAnchors(tokens, root) {
    const lines = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.level !== 0 || !t.map) continue;
      // nesting === 1 的是各类 *_open；nesting === 0 的自闭合块（fence/hr/code_block）
      if (t.nesting === 1 || (t.nesting === 0 && t.type !== "inline")) lines.push(t.map[0]);
    }
    const kids = root.children;
    // 块数与顶层元素数对不上，说明有渲染规则没产出元素：宁可不联动，也不许错位
    if (!lines.length || lines.length !== kids.length) return [];
    const out = [];
    for (let i = 0; i < kids.length; i++) out.push({ line: lines[i], el: kids[i], py: 0 });
    return out;
  }

  function invalidateSync() { previewDirty = true; }

  /* 预览整篇都已布局，offsetTop 就是真值；量一次存起来，布局变了再重来 */
  function measurePreview() {
    if (!previewDirty || !anchors.length) return;
    for (let i = 0; i < anchors.length; i++) anchors[i].py = anchors[i].el.offsetTop;
    previewDirty = false;
  }

  // ---------- 编辑器侧：只用实测值 ----------
  function addSample(line, y) {
    const n = samples.length;
    if (!n || line > samples[n - 1].line) { samples.push({ line: line, y: y }); return; }
    if (line === samples[n - 1].line) { samples[n - 1].y = y; return; }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].line < line) lo = mid; else hi = mid;
    }
    if (samples[lo].line === line) samples[lo].y = y;
    else if (samples[hi].line === line) samples[hi].y = y;
    else samples.splice(hi, 0, { line: line, y: y });
  }

  function localLineH(a, b) {
    const d = b.line - a.line;
    return d > 0 ? (b.y - a.y) / d : cm.defaultTextHeight();
  }

  /* 某一行在文档坐标里的 y：两侧都有实测点就插值，没有就用最近一段的行高外推。
     比 cm.heightAtLine 可靠——后者对未测量行用的是默认行高。 */
  function lineY(L) {
    const n = samples.length;
    if (!n) return cm.heightAtLine(L, "local");
    if (L <= samples[0].line) {
      const h = n > 1 ? localLineH(samples[0], samples[1]) : cm.defaultTextHeight();
      return samples[0].y + (L - samples[0].line) * h;
    }
    if (L >= samples[n - 1].line) {
      const b = samples[n - 1];
      const a = n > 1 ? samples[n - 2] : b;
      return b.y + (L - b.line) * localLineH(a, b);
    }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].line <= L) lo = mid; else hi = mid;
    }
    const a = samples[lo], b = samples[hi];
    return a.y + (L - a.line) * localLineH(a, b);
  }

  /* 视口顶那一行：遍历已渲染的行视图，取第一个底边还在视口里的。
     顺手把这批行的真实 y 记进 samples（渲染过就等于测量过）。 */
  function viewportTop() {
    const view = cm.display.view;
    if (!view || !view.length) return null;
    const scR = editorScroller.getBoundingClientRect();
    const st = editorScroller.scrollTop;
    const base = cm.defaultTextHeight();
    let first = null;
    for (let i = 0; i < view.length; i++) {
      const node = view[i].node;
      if (!node) continue;
      const r = node.getBoundingClientRect();
      if (r.bottom <= scR.top + 0.5) continue;   // 整行还在视口上方
      if (r.top >= scR.bottom) break;            // 后面的都在视口下方了
      // 只采信"确实落在视口里"的行：大跳转后 CM 还没重排，老节点的坐标已经不可信
      const y = r.top - scR.top + st;
      let line = cm.getLineNumber(view[i].line);
      if (line < 0) line = cm.display.viewFrom + i;   // 行句柄失效时的兜底
      if (r.height > 0) addSample(line, y);
      if (!first) first = { line: line, y: y, h: r.height || base };
    }
    return first;
  }

  function blockIndexAt(line) {
    const n = anchors.length;
    if (!n || line < anchors[0].line) return -1;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (anchors[mid].line <= line) lo = mid; else hi = mid;
    }
    return anchors[hi].line <= line ? hi : lo;
  }

  function blockTail(j) {
    const b = anchors[j + 1];
    return b ? { line: b.line, y: b.py } : { line: cm.lineCount(), y: pvMax() };
  }

  function pvMax() {
    return Math.max(0, previewPane.scrollHeight - previewPane.clientHeight);
  }

  /* 编辑区滚到 st 时，预览区应该停在哪 */
  function editorToPreview(st) {
    if (!anchors.length) return null;   // 锚点没建起来就彻底不联动，别把对面弹回顶部
    measurePreview();
    let line, frac;
    const t = viewportTop();
    if (t) {
      line = t.line;
      frac = Math.max(0, Math.min(1, (st - t.y) / t.h));
    } else {
      // 整屏都跳出了已渲染范围（跳转后 CM 还没重排）：先用 CM 的估算顶一下，
      // 等重排完再补一次精确对齐（见 scheduleSettle）
      line = cm.lineAtHeight(st, "local");
      frac = 0;
      syncApprox = true;
    }
    const j = Math.max(0, blockIndexAt(line));   // 第一块之前（开头空行）就按第一块算
    const head = anchors[j];
    const tail = blockTail(j);
    const spanL = tail.line - head.line;
    const pos = line + frac;
    const r = spanL > 0 ? Math.max(0, Math.min(1, (pos - head.line) / spanL)) : 0;
    return Math.max(0, Math.min(pvMax(), head.py + r * (tail.y - head.py)));
  }

  /* 预览区停到 pst 时，编辑区应该滚到哪 */
  function previewToEditor(pst) {
    if (!anchors.length) return null;
    measurePreview();
    // 先用当前视口把实测样本暖起来：这样 lineY() 是从"眼前这段"往外推，
    // 而不是退回 CM 那个按默认行高估的整篇高度表
    viewportTop();
    if (!samples.length) syncApprox = true;
    const n = anchors.length;
    let j = 0;
    if (pst > anchors[0].py) {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (anchors[mid].py <= pst) lo = mid; else hi = mid;
      }
      j = anchors[hi].py <= pst ? hi : lo;
    }
    const head = anchors[j];
    const tail = blockTail(j);
    const spanP = tail.y - head.py;
    const r = spanP > 0 ? Math.max(0, Math.min(1, (pst - head.py) / spanP)) : 0;
    const target = head.line + r * (tail.line - head.line);
    const li = Math.floor(target);
    return Math.max(0, lineY(li) + (target - li) * cm.defaultTextHeight());
  }

  function setPaneScroll(el, y) {
    if (Math.abs(el.scrollTop - y) < SYNC_EPS) return;
    echoEl = el;
    echoY = y;
    el.scrollTop = y;
  }

  /* 程序化滚动也会派发 scroll 事件。不按时间窗口去猜，而是认出"这一条就是我刚
     刷进去的值"——用户真滚动时位置必然和 echoY 不一样，不会被误吞。 */
  function isEcho(el) {
    if (echoEl !== el) return false;
    const hit = Math.abs(el.scrollTop - echoY) < 1.2;
    echoEl = null;
    return hit;
  }

  /* 跳转（拖滚动条、翻页键）时 CM 还没来得及重排，这一帧只能用估算值；
     等它排完再补一次精确对齐，用户停手后看到的一定是准的。 */
  function scheduleSettle(fn) {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = 0;
      if (switching || !syncEnabled) return;
      fn();
    }, 90);
  }

  editorScroller.addEventListener("scroll", () => {
    if (isEcho(editorScroller)) return;
    if (switching || !syncEnabled) return;
    syncApprox = false;
    const y = editorToPreview(editorScroller.scrollTop);
    if (y === null) return;
    setPaneScroll(previewPane, y);
    if (syncApprox) {
      scheduleSettle(() => {
        const y2 = editorToPreview(editorScroller.scrollTop);
        if (y2 !== null) setPaneScroll(previewPane, y2);
      });
    }
  }, { passive: true });

  previewPane.addEventListener("scroll", () => {
    if (isEcho(previewPane)) return;
    if (switching || !syncEnabled) return;
    syncApprox = false;
    const y = previewToEditor(previewPane.scrollTop);
    if (y === null) return;
    setPaneScroll(editorScroller, y);
    if (syncApprox) {
      scheduleSettle(() => {
        const y2 = previewToEditor(previewPane.scrollTop);
        if (y2 !== null) setPaneScroll(editorScroller, y2);
      });
    }
  }, { passive: true });

  /* 开关的可视状态：分栏把手常亮强调色 + 悬浮提示，不开设置也能看出联动开着。
     同时把"生效值"记在 syncEnabled 上——面板里改的是 draft，直接读 S 会出现
     把手已经显示关闭、实际还在联动的错位。 */
  function applySyncScroll(on) {
    syncEnabled = on !== false;
    divider.dataset.sync = syncEnabled ? "on" : "off";
    divider.title = (syncEnabled ? "同步滚动已开启" : "同步滚动已关闭") + " · 拖拽调整 · 双击重置";
  }

  /* 布局变化（换字号、拖分栏、窗口缩放）后，实测样本与预览高度都得作废重来 */
  function resetSyncGeometry() {
    invalidateSync();
    samples.length = 0;
  }

  window.addEventListener("resize", resetSyncGeometry);

  // ============================================================
  // 设置：应用 / 持久化
  // ============================================================
  let appliedTheme = null;
  let appliedAccent = null;
  let themeTimer = null;

  function flashTheme() {
    // 先挂上过渡再改变量，否则同一次样式计算里变量已经换掉了，看不到过渡
    document.body.classList.add("theming");
    void document.body.offsetWidth;
    clearTimeout(themeTimer);
    themeTimer = setTimeout(() => document.body.classList.remove("theming"), 300);
  }

  function applySettings(s, opts) {
    if (!s) return;
    const r = document.documentElement;

    const themeChanged = appliedTheme !== null &&
      (appliedTheme !== s.appearance.theme || appliedAccent !== s.appearance.accent);
    if (themeChanged) flashTheme();

    r.dataset.theme = s.appearance.theme;
    r.dataset.accent = s.appearance.accent;
    appliedTheme = s.appearance.theme;
    appliedAccent = s.appearance.accent;

    r.style.setProperty("--blur", s.appearance.blur + "px");
    r.style.setProperty("--sidebar-w", s.appearance.sidebarWidth + "px");
    r.style.setProperty("--preview-w", s.appearance.previewWidth + "px");
    r.style.setProperty("--editor-fs", s.editor.fontSize + "px");
    r.style.setProperty("--editor-lh", String(s.editor.lineHeight));
    document.body.classList.toggle("no-aurora", !s.appearance.aurora);
    document.body.classList.toggle("no-grain", !s.appearance.grain);
    document.body.classList.toggle("no-motion", s.appearance.motion === false);
    document.body.classList.toggle("topbar-glass", s.appearance.topbar === "glass");
    applySyncScroll(s.appearance.syncScroll !== false);

    cm.setOption("tabSize", s.editor.tabSize);
    cm.setOption("lineNumbers", !!s.editor.lineNumbers);
    cm.setOption("autoCloseBrackets", s.editor.autoPairs ? {
      pairs: "()[]{}''\"\"``$$", explode: "[]{}()", override: true,
    } : false);
    const wrap = cm.getWrapperElement();
    wrap.style.fontSize = s.editor.fontSize + "px";
    wrap.style.lineHeight = String(s.editor.lineHeight);

    applyRatio(s.appearance.splitRatio);
    buildKeymap(s);
    const sb = $("#searchBtn");
    if (sb) sb.title = "搜索日记" + (s.shortcuts.search ? " (" + s.shortcuts.search + ")" : "");
    resetSyncGeometry();
    if (!opts || opts.refresh !== false) cm.refresh();
    saveDebounced = debounce(saveNow, s.general.autosaveDelay);
  }

  function pushSettings(s) {
    return fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    }).then((r) => r.json());
  }

  // ---------- 快捷键映射 ----------
  const ACTIONS = {
    save: () => saveNow(),
    bold: (c) => wrapToken(c, "**"),
    italic: (c) => wrapToken(c, "*"),
    code: (c) => wrapToken(c, "`"),
    strike: (c) => wrapToken(c, "~~"),
    link: (c) => insertLink(c),
    h1: (c) => toggleHeading(c, 1),
    h2: (c) => toggleHeading(c, 2),
    h3: (c) => toggleHeading(c, 3),
    prevDay: () => loadDate(shift(currentDate, -1)),
    nextDay: () => loadDate(shift(currentDate, 1)),
    today: () => loadDate(fmt(new Date())),
    toggleSide: () => toggleSidebar(),
    settings: () => openSettings(),
  };
  const EDITOR_ACTIONS = ["bold", "italic", "code", "strike", "link", "h1", "h2", "h3"];

  const SC_LABELS = [
    ["save", "保存"],
    ["bold", "加粗"],
    ["italic", "斜体"],
    ["code", "行内代码"],
    ["strike", "删除线"],
    ["link", "插入链接"],
    ["search", "全文搜索"],
    ["h1", "一级标题"],
    ["h2", "二级标题"],
    ["h3", "三级标题"],
    ["prevDay", "前一天"],
    ["nextDay", "后一天"],
    ["today", "回到今天"],
    ["toggleSide", "收起 / 展开列表"],
    ["settings", "打开设置"],
  ];

  function normKey(e) {
    let k = e.key;
    if (k === " ") return "Space";
    if (k.length === 1) return k.toUpperCase();
    return k.replace(/^Arrow/, "");
  }

  function parseCombo(combo) {
    if (!combo) return null;
    const parts = String(combo).split("-");
    const key = parts.pop();
    if (!key) return null;
    const p = { ctrl: false, shift: false, alt: false, meta: false };
    for (const part of parts) {
      const l = part.toLowerCase();
      if (l === "ctrl" || l === "control") p.ctrl = true;
      else if (l === "shift") p.shift = true;
      else if (l === "alt") p.alt = true;
      else if (l === "meta" || l === "cmd" || l === "win") p.meta = true;
      else return null;
    }
    p.key = key;
    return p;
  }

  function matchCombo(e, combo) {
    const p = parseCombo(combo);
    if (!p) return false;
    if (p.ctrl !== e.ctrlKey || p.shift !== e.shiftKey ||
        p.alt !== e.altKey || p.meta !== e.metaKey) return false;
    return normKey(e).toUpperCase() === p.key.toUpperCase();
  }

  function cmKeyOf(combo) {
    const p = parseCombo(combo);
    if (!p) return null;
    const out = [];
    if (p.shift) out.push("Shift");
    if (p.ctrl) out.push("Ctrl");
    if (p.alt) out.push("Alt");
    if (p.meta) out.push("Cmd");
    out.push(p.key);
    return out.join("-");
  }

  function buildKeymap(src) {
    const s = src || S;
    if (!s) return;
    const km = {
      Enter: s.editor.continueList ? "newlineAndIndentContinueMarkdownList" : "newlineAndIndent",
    };
    for (const act of EDITOR_ACTIONS) {
      const combo = s.shortcuts[act];
      const k = cmKeyOf(combo);
      if (k && ACTIONS[act]) km[k] = (c) => ACTIONS[act](c);
    }
    cm.setOption("extraKeys", km);
  }

  document.addEventListener("keydown", (e) => {
    if (!S) return;
    if (recording) return;
    // 搜索面板：默认 Ctrl/⌘+F，开合同一个键（Spotlight 手感）；可在设置里改绑
    if (S.shortcuts.search && matchCombo(e, S.shortcuts.search)) {
      e.preventDefault();
      if (state.overlay === "search") closeSearch();
      else openSearch();
      return;
    }
    if (!overlayOpen()) {
      for (const act of Object.keys(ACTIONS)) {
        if (EDITOR_ACTIONS.indexOf(act) >= 0) continue;
        if (matchCombo(e, S.shortcuts[act])) {
          e.preventDefault();
          ACTIONS[act]();
          return;
        }
      }
    }
    if (e.key === "Escape") {
      if (state.overlay === "settings") { closeSettings(true); return; }
      if (state.overlay === "calendar") closeCalendar();
      if (state.overlay === "search") closeSearch();
    }
  });

  // ---------- 窗口几何 ----------
  const reportGeometry = debounce(() => {
    if (!S || !S.general.rememberWindow) return;
    fetch("/api/settings/window", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {});
  }, 900);
  window.addEventListener("resize", reportGeometry);

  window.addEventListener("beforeunload", () => {
    if (dirty) {
      navigator.sendBeacon("/api/entry",
        new Blob([JSON.stringify({ date: currentDate, content: cm.getValue() })],
          { type: "application/json" }));
    }
    if (S && S.general.rememberWindow) {
      navigator.sendBeacon("/api/settings/window",
        new Blob(["{}"], { type: "application/json" }));
    }
  });
  window.addEventListener("unload", () => {
    navigator.sendBeacon("/api/bye", "");
  });

  // ============================================================
  // 设置面板
  // ============================================================
  const overlay = $("#settingsOverlay");
  let draft = null;
  let recording = null;
  let tab = "general";

  const TAB_ORDER = ["general", "appearance", "editor", "shortcuts"];
  const TAB_META = {
    general: ["常规", "日记存放位置、自动保存与启动行为"],
    appearance: ["外观", "主题底色、强调色、玻璃质感与界面动效"],
    editor: ["编辑器", "字号行高、缩进与输入辅助"],
    shortcuts: ["快捷键", "点击键位框后按下新的组合键"],
  };

  function openSettings() {
    if (state.overlay === "settings" || !S) return;
    draft = clone(S);
    recording = null;
    fillControls();
    switchTab(tab, true);
    setOverlay("settings");
    $("#setHint").textContent = "";
    $("#setHint").className = "set-hint";
    requestAnimationFrame(moveIndicator);
  }

  function closeSettings(revert) {
    if (state.overlay !== "settings") return;
    setOverlay(null);
    stopRecording();
    if (revert && S) applySettings(S);
    draft = null;
  }

  function switchTab(name, instant) {
    const from = TAB_ORDER.indexOf(tab);
    const to = TAB_ORDER.indexOf(name);
    const dx = to >= from ? 10 : -10;
    tab = name;

    $$(".set-tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === name));
    $$(".set-pane").forEach((p) => {
      const on = p.dataset.pane === name;
      p.classList.toggle("is-active", on);
      if (on) {
        p.style.setProperty("--pane-dx", dx + "px");
        p.style.animation = instant ? "none" : "";
      }
    });
    const m = TAB_META[name] || ["", ""];
    $("#setTitle").textContent = m[0];
    $("#setSubtitle").textContent = m[1];
    const sc = document.querySelector(".set-scroll");
    if (sc) sc.scrollTop = 0;
    requestAnimationFrame(moveIndicator);
  }

  // 导航高亮块跟随当前分类滑动
  function moveIndicator() {
    const ind = $("#setNavInd");
    const active = document.querySelector(".set-tab.is-active");
    if (!ind || !active) return;
    ind.style.opacity = "1";
    ind.style.height = active.offsetHeight + "px";
    ind.style.transform = `translateY(${active.offsetTop}px)`;
  }

  $$(".set-tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

  // ---- 控件填充 ----
  function setSeg(sel, value) {
    $$(sel + " button").forEach((b) => b.classList.toggle("is-on", b.dataset.v === String(value)));
  }
  function setSw(sel, on) {
    const el = $(sel);
    if (el) el.setAttribute("aria-checked", on ? "true" : "false");
  }

  /* 滑块的进度填充：只写一个 --pct，轨道渐变自己算，省掉一套额外的 DOM */
  function paintRange(el) {
    if (!el) return;
    const min = Number(el.min || 0);
    const max = Number(el.max || 100);
    const v = Number(el.value);
    const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    el.style.setProperty("--pct", pct.toFixed(2) + "%");
  }
  function paintAllRanges(root) {
    $$((root || "") + " .rng").forEach(paintRange);
  }

  function fillControls() {
    const d = draft;
    $("#setVersion").textContent = "Diary v" + (META.version || "");

    $("#setDir").value = d.general.diaryDir || "";
    $("#setDir").placeholder = "留空 = " + (META.defaultDir || "程序目录\\diaries");
    $("#setAutosave").value = d.general.autosaveDelay;
    $("#setAutosaveVal").textContent = d.general.autosaveDelay + " ms";
    setSeg("#setStartup", d.general.startup);
    setSw("#setRememberWin", d.general.rememberWindow);
    checkDir(d.general.diaryDir);

    $$("#setTheme .theme-card").forEach((b) => b.classList.toggle("is-on", b.dataset.v === d.appearance.theme));
    $$("#setAccent .accent-dot").forEach((b) => b.classList.toggle("is-on", b.dataset.v === d.appearance.accent));
    setSeg("#setTopbar", d.appearance.topbar);
    $("#setBlur").value = d.appearance.blur;
    $("#setBlurVal").textContent = d.appearance.blur + " px";
    setSw("#setAurora", d.appearance.aurora);
    setSw("#setGrain", d.appearance.grain);
    setSw("#setMotion", d.appearance.motion !== false);
    $("#setSideW").value = d.appearance.sidebarWidth;
    $("#setSideWVal").textContent = d.appearance.sidebarWidth + " px";
    $("#setPreviewW").value = d.appearance.previewWidth;
    $("#setPreviewWVal").textContent = d.appearance.previewWidth + " px";

    $("#setFontSize").value = d.editor.fontSize;
    $("#setFontSizeVal").textContent = d.editor.fontSize + " px";
    $("#setLineHeight").value = d.editor.lineHeight;
    $("#setLineHeightVal").textContent = Number(d.editor.lineHeight).toFixed(2);
    $("#setSplit").value = Math.round(d.appearance.splitRatio * 100);
    $("#setSplitVal").textContent = Math.round(d.appearance.splitRatio * 100) + " %";
    setSw("#setSyncScroll", d.appearance.syncScroll !== false);
    setSeg("#setTabSize", d.editor.tabSize);
    setSw("#setAutoPairs", d.editor.autoPairs);
    setSw("#setContinueList", d.editor.continueList);
    setSw("#setLineNumbers", d.editor.lineNumbers);

    paintAllRanges(".set-body");
    renderShortcuts();
  }

  function touch() {
    applySettings(draft);
    const hint = $("#setHint");
    if (hint.textContent !== "未保存的修改") {
      hint.textContent = "未保存的修改";
      hint.className = "set-hint";
      nudge(hint, 3, DUR[2]);
    }
  }

  // ---- 常规 ----
  const checkDir = debounce(async (dir) => {
    const note = $("#setDirNote");
    const p = (dir || "").trim();
    if (!p) {
      note.textContent = "使用默认目录：" + (META.defaultDir || "");
      note.className = "set-note";
      return;
    }
    try {
      const r = await fetch("/api/dir/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: p }),
      });
      const d = await r.json();
      if (!d.exists) {
        note.textContent = "目录不存在，保存时会自动创建";
        note.className = "set-note is-warn";
      } else {
        note.textContent = `目录有效，现有 ${d.mdCount} 篇日记`;
        note.className = "set-note is-ok";
      }
    } catch (e) {
      note.textContent = "";
      note.className = "set-note";
    }
  }, 450);

  $("#setDir").addEventListener("input", () => {
    draft.general.diaryDir = $("#setDir").value.trim();
    checkDir(draft.general.diaryDir);
  });

  $("#setBrowse").addEventListener("click", async () => {
    const api = window.pywebview && window.pywebview.api;
    if (!api || !api.pick_folder) {
      $("#setDirNote").textContent = "当前环境不支持选择框，直接把路径粘贴到输入框即可";
      $("#setDirNote").className = "set-note is-warn";
      return;
    }
    try {
      const p = await api.pick_folder();
      if (p) {
        $("#setDir").value = p;
        draft.general.diaryDir = p;
        checkDir(p);
      }
    } catch (e) {
      $("#setDirNote").textContent = "打开选择框失败，请手动填写路径";
      $("#setDirNote").className = "set-note is-warn";
    }
  });

  $("#setOpenDir").addEventListener("click", () => {
    fetch("/api/open-dir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir: $("#setDir").value.trim() }),
    }).catch(() => {});
  });

  $("#setAutosave").addEventListener("input", () => {
    draft.general.autosaveDelay = Number($("#setAutosave").value);
    $("#setAutosaveVal").textContent = draft.general.autosaveDelay + " ms";
    paintRange($("#setAutosave"));
    touch();
  });

  $$("#setStartup button").forEach((b) => b.addEventListener("click", () => {
    draft.general.startup = b.dataset.v;
    setSeg("#setStartup", b.dataset.v);
    touch();
  }));

  $("#setRememberWin").addEventListener("click", () => {
    draft.general.rememberWindow = !draft.general.rememberWindow;
    setSw("#setRememberWin", draft.general.rememberWindow);
    touch();
  });

  // ---- 外观 ----
  $$("#setTheme .theme-card").forEach((b) => b.addEventListener("click", () => {
    if (draft.appearance.theme === b.dataset.v) return;
    draft.appearance.theme = b.dataset.v;
    $$("#setTheme .theme-card").forEach((x) => x.classList.toggle("is-on", x === b));
    touch();
  }));

  $$("#setAccent .accent-dot").forEach((b) => b.addEventListener("click", () => {
    if (draft.appearance.accent === b.dataset.v) return;
    draft.appearance.accent = b.dataset.v;
    $$("#setAccent .accent-dot").forEach((x) => x.classList.toggle("is-on", x === b));
    touch();
  }));

  $$("#setTopbar button").forEach((b) => b.addEventListener("click", () => {
    draft.appearance.topbar = b.dataset.v;
    setSeg("#setTopbar", b.dataset.v);
    touch();
  }));

  $("#setBlur").addEventListener("input", () => {
    draft.appearance.blur = Number($("#setBlur").value);
    $("#setBlurVal").textContent = draft.appearance.blur + " px";
    paintRange($("#setBlur"));
    touch();
  });

  $("#setAurora").addEventListener("click", () => {
    draft.appearance.aurora = !draft.appearance.aurora;
    setSw("#setAurora", draft.appearance.aurora);
    touch();
  });

  $("#setGrain").addEventListener("click", () => {
    draft.appearance.grain = !draft.appearance.grain;
    setSw("#setGrain", draft.appearance.grain);
    touch();
  });

  $("#setMotion").addEventListener("click", () => {
    draft.appearance.motion = draft.appearance.motion === false;
    setSw("#setMotion", draft.appearance.motion !== false);
    touch();
  });

  $("#setSideW").addEventListener("input", () => {
    draft.appearance.sidebarWidth = Number($("#setSideW").value);
    $("#setSideWVal").textContent = draft.appearance.sidebarWidth + " px";
    paintRange($("#setSideW"));
    touch();
  });

  $("#setPreviewW").addEventListener("input", () => {
    draft.appearance.previewWidth = Number($("#setPreviewW").value);
    $("#setPreviewWVal").textContent = draft.appearance.previewWidth + " px";
    paintRange($("#setPreviewW"));
    touch();
  });

  // ---- 编辑器 ----
  $("#setFontSize").addEventListener("input", () => {
    draft.editor.fontSize = Number($("#setFontSize").value);
    $("#setFontSizeVal").textContent = draft.editor.fontSize + " px";
    paintRange($("#setFontSize"));
    touch();
  });

  $("#setLineHeight").addEventListener("input", () => {
    draft.editor.lineHeight = Number($("#setLineHeight").value);
    $("#setLineHeightVal").textContent = draft.editor.lineHeight.toFixed(2);
    paintRange($("#setLineHeight"));
    touch();
  });

  $("#setSplit").addEventListener("input", () => {
    draft.appearance.splitRatio = Number($("#setSplit").value) / 100;
    $("#setSplitVal").textContent = $("#setSplit").value + " %";
    paintRange($("#setSplit"));
    touch();
  });

  $$("#setTabSize button").forEach((b) => b.addEventListener("click", () => {
    draft.editor.tabSize = Number(b.dataset.v);
    setSeg("#setTabSize", b.dataset.v);
    touch();
  }));

  $("#setSyncScroll").addEventListener("click", () => {
    draft.appearance.syncScroll = draft.appearance.syncScroll === false;
    setSw("#setSyncScroll", draft.appearance.syncScroll !== false);
    touch();
    // 刚打开时立刻对一次位，不然要等用户先滚一下才"生效"
    if (draft.appearance.syncScroll && !switching) {
      const y = editorToPreview(editorScroller.scrollTop);
      if (y !== null) setPaneScroll(previewPane, y);
    }
  });

  $("#setAutoPairs").addEventListener("click", () => {
    draft.editor.autoPairs = !draft.editor.autoPairs;
    setSw("#setAutoPairs", draft.editor.autoPairs);
    touch();
  });

  $("#setContinueList").addEventListener("click", () => {
    draft.editor.continueList = !draft.editor.continueList;
    setSw("#setContinueList", draft.editor.continueList);
    touch();
  });

  $("#setLineNumbers").addEventListener("click", () => {
    draft.editor.lineNumbers = !draft.editor.lineNumbers;
    setSw("#setLineNumbers", draft.editor.lineNumbers);
    touch();
  });

  // ---- 快捷键 ----
  function renderShortcuts() {
    const list = $("#scList");
    list.innerHTML = SC_LABELS.map(([act, label]) => {
      const combo = draft.shortcuts[act] || "";
      return `<div class="sc-row">
        <span class="sc-name">${label}</span>
        <button class="sc-key${combo ? "" : " is-empty"}" data-act="${act}">${combo || "未绑定"}</button>
      </div>`;
    }).join("");
    list.querySelectorAll(".sc-key").forEach((b) => {
      b.addEventListener("click", () => startRecording(b));
    });
  }

  function startRecording(btn) {
    stopRecording();
    const act = btn.dataset.act;
    recording = act;
    btn.classList.add("recording");
    btn.textContent = "按下组合键…";

    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { stopRecording(); renderShortcuts(); return; }
      if (e.key === "Backspace" || e.key === "Delete") { setCombo(act, ""); return; }
      const mods = [];
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.shiftKey) mods.push("Shift");
      if (e.altKey) mods.push("Alt");
      if (e.metaKey) mods.push("Meta");
      const k = normKey(e);
      if (["Control", "Shift", "Alt", "Meta"].indexOf(k) >= 0) return;
      if (!mods.length) {
        const hint = $("#setHint");
        hint.textContent = "组合键需要包含 Ctrl / Alt / Shift";
        hint.className = "set-hint";
        nudge(hint, 3, DUR[2]);
        return;
      }
      setCombo(act, mods.concat(k).join("-"));
    };
    window.addEventListener("keydown", onKey, true);
    document.__recKey = onKey;
  }

  function stopRecording() {
    if (document.__recKey) {
      window.removeEventListener("keydown", document.__recKey, true);
      document.__recKey = null;
    }
    recording = null;
    $$(".sc-key.recording").forEach((b) => b.classList.remove("recording"));
  }

  function setCombo(act, combo) {
    if (combo) {
      for (const other of Object.keys(draft.shortcuts)) {
        if (other !== act && draft.shortcuts[other] === combo) draft.shortcuts[other] = "";
      }
      draft.shortcuts[act] = combo;
    } else {
      draft.shortcuts[act] = "";
    }
    stopRecording();
    renderShortcuts();
    touch();
  }

  $("#scResetAll").addEventListener("click", () => {
    const defs = (DEFAULTS && DEFAULTS.shortcuts) || {};
    draft.shortcuts = clone(defs);
    renderShortcuts();
    touch();
  });

  // ---- 底部 ----
  $("#setClose").addEventListener("click", () => closeSettings(true));
  $("#setCancel").addEventListener("click", () => closeSettings(true));
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) closeSettings(true);
  });

  $("#setReset").addEventListener("click", () => {
    if (!DEFAULTS) return;
    draft = clone(DEFAULTS);
    fillControls();
    touch();
    $("#setHint").textContent = "已载入默认值，点保存生效";
  });

  $("#setSave").addEventListener("click", async () => {
    if (!draft) return;
    const hint = $("#setHint");
    hint.textContent = "保存中…";
    hint.className = "set-hint";
    try {
      const res = await pushSettings(draft);
      if (!res.ok) throw new Error("save failed");
      S = res.settings;
      if (res.meta) {
        META.diaryDir = res.meta.diaryDir;
        META.defaultDir = res.meta.defaultDir;
      }
      applySettings(S, { refresh: true });
      setOverlay(null);
      draft = null;
      stopRecording();
      await refreshList();
      await loadDate(currentDate);
      setSaveState("saved", "设置已保存");
    } catch (e) {
      hint.textContent = "保存失败，请重试";
      hint.className = "set-hint is-warn";
    }
  });

  $("#settingsBtn").addEventListener("click", openSettings);

  // ============================================================
  // 启动
  // ============================================================
  function boot() {
    if (!S) {
      return fetch("/api/settings")
        .then((r) => r.json())
        .then((d) => {
          S = d.settings;
          DEFAULTS = d.defaults || null;
          META = d.meta || META;
          start();
        })
        .catch(() => start());
    }
    start();
  }

  function start() {
    if (DEFAULTS && DEFAULTS.shortcuts && !S.shortcuts) S.shortcuts = clone(DEFAULTS.shortcuts);
    if (S.appearance.motion === undefined) S.appearance.motion = true;
    if (S.appearance.syncScroll === undefined) S.appearance.syncScroll = true;
    applySettings(S, { refresh: false });

    const today = fmt(new Date());
    let target = today;
    if (S.general.startup === "last" && S.general.lastDate) {
      const gap = (parseDate(today) - parseDate(S.general.lastDate)) / 86400000;
      if (gap >= 0 && gap <= 90) target = S.general.lastDate;
    }
    currentDate = target;

    updateDateUI();
    loadDate(currentDate);
    refreshList();
    setTimeout(() => reportGeometry(), 1800);

    const q = new URLSearchParams(location.search);
    if (q.get("cal") === "1") setTimeout(openCalendar, 350);
    if (q.get("settings") === "1") {
      setTimeout(() => {
        openSettings();
        if (q.get("tab")) switchTab(q.get("tab"), true);
      }, 300);
    }
  }

  boot();
})();
