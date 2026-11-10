# Diary

**A local-first Markdown diary** — live LaTeX, full-text search, a hand-drawn glass calendar,
and two complete themes.

No account, no cloud, no telemetry. One `.md` file per day, on your own disk.

<p align="center">
  <a href="https://github.com/Enkrid-Rao/diary/releases"><img src="https://img.shields.io/github/v/release/Enkrid-Rao/diary?style=flat-square&color=e8a244&label=release" alt="Latest release"></a>
  <a href="#quick-start"><img src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-4a5568?style=flat-square" alt="Platform"></a>
  <a href="#quick-start"><img src="https://img.shields.io/badge/python-3.9%2B-3776ab?style=flat-square&logo=python&logoColor=white" alt="Python"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-e8a244?style=flat-square" alt="MIT"></a>
  <a href="https://github.com/Enkrid-Rao/diary/stargazers"><img src="https://img.shields.io/github/stars/Enkrid-Rao/diary?style=flat-square&color=e8a244" alt="Stars"></a>
  <img src="https://img.shields.io/badge/README-English-23252d?style=flat-square" alt="English">
  <a href="README.zh-CN.md"><img src="https://img.shields.io/badge/README-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-e8a244?style=flat-square" alt="简体中文"></a>
</p>

<p align="center">
  <a href="docs/01-main-flat.webp"><img src="docs/01-main-flat.webp" width="900" alt="Diary — main window (dark)"></a>
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#keyboard-shortcuts">Shortcuts</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#license">License</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

---

## Why another diary app?

Most journaling apps want an account, a subscription, or a proprietary database. Diary goes the other
way: one file per day (`2026-11-10.md`), a native window on top of your local files, and a UI built
for the one thing you actually do — write a little, every day, and sometimes with maths in it.

It is a single-file Python server plus a vanilla-JS front end. No build step, no framework, no
`node_modules`. Edit `static/style.css`, hit refresh, done.

<p align="center">
  <b><a href="https://github.com/Enkrid-Rao/diary/releases/latest">Download for Windows</a></b>
  &nbsp;·&nbsp; installer (.exe) or portable (.zip) — no Python needed
</p>

## Features

**Writing**
- Markdown editing with a live, side-by-side preview — and **synchronised scrolling** between the panes
- **LaTeX that actually renders** while you type: `$...$` inline, `$$...$$` blocks, plus an inline
  autocomplete panel for commands (`\frac`, `\sum`, `\int`, …) with live KaTeX previews
- Math-first preview typography: formulas keep their own size, spacing and line-height instead of
  being squeezed into the paragraph rhythm
- Markdown shortcuts, bracket/`$` auto-pairing, list continuation, autosave

**Finding things**
- Full-text search over every entry (`Ctrl+F`): a Spotlight-style panel listing the date, the heading
  and the **sentence** that matched — press `Enter` to jump straight to it, with the sentence selected
- The sidebar groups entries **by month**, and each month header collapses with one click; the
  collapsed state is remembered
- Jump the calendar to any date you type: click the month title, enter `YYYY-MM-DD`, `Enter`

**Looking at it**
- **Dark and light themes**, three paper colours each (Ink / Graphite / Ocean) and four accents —
  every combination is contrast-checked, not just tinted
- **Custom fonts**: pick the interface font and the editor font separately — follow the editor,
  follow the system, use LXGW WenKai, or type any font name installed on your machine (the editor
  font is the default for the whole UI)
- A five-step surface ladder (`--s1` … `--s5`) and a six-step radius scale, so panels, cards and
  wells actually read as different depths in both themes
- A glass calendar, Apple-flavoured motion (hover lift, press-in, spring transitions), optional
  aurora background and film grain

**Owning it**
- 100% local: the server binds `127.0.0.1` only, entries are plain text you can `grep`, `git`, or
  sync with anything
- Editable keyboard shortcuts, configurable diary directory, window geometry remembered
- No network calls at runtime; CodeMirror and KaTeX are vendored in `static/vendor`

## Screenshots

> Click any picture to open it full size. More in [`docs/`](docs).

<table>
  <tr>
    <td width="50%" align="center">
      <a href="docs/01-main-flat.webp"><img src="docs/01-main-flat.webp" alt="Editor and live preview — dark theme"></a><br>
      <sub><b>Dark · Ink</b> — editor and live preview</sub>
    </td>
    <td width="50%" align="center">
      <a href="docs/11-light-main.webp"><img src="docs/11-light-main.webp" alt="Editor and live preview — light theme"></a><br>
      <sub><b>Light · Ink</b> — the same page on paper white</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="docs/10-search.webp"><img src="docs/10-search.webp" alt="Full-text search — dark theme"></a><br>
      <sub><b>Full-text search</b> — date, heading, matched sentence</sub>
    </td>
    <td width="50%" align="center">
      <a href="docs/13-light-search.webp"><img src="docs/13-light-search.webp" alt="Full-text search — light theme"></a><br>
      <sub><b>Full-text search</b> — the hit is a highlighter block</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="docs/03-settings-appearance.webp"><img src="docs/03-settings-appearance.webp" alt="Appearance settings — dark theme"></a><br>
      <sub><b>Settings · Appearance</b> — three papers × four accents</sub>
    </td>
    <td width="50%" align="center">
      <a href="docs/12-light-settings.webp"><img src="docs/12-light-settings.webp" alt="Appearance settings — light theme"></a><br>
      <sub><b>Settings · Appearance</b> — bar / page / card ladder</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="docs/14-light-calendar.webp"><img src="docs/14-light-calendar.webp" alt="Calendar popover"></a><br>
      <sub><b>Calendar</b> — hand-drawn glass, dots mark days with entries</sub>
    </td>
    <td width="50%" align="center">
      <a href="docs/07-latex-hint.webp"><img src="docs/07-latex-hint.webp" alt="LaTeX autocomplete"></a><br>
      <sub><b>LaTeX autocomplete</b> — every row is a real KaTeX render</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="docs/06-ocean-glass.webp"><img src="docs/06-ocean-glass.webp" alt="Ocean theme"></a><br>
      <sub><b>Ocean</b> — deep sea, the cool third paper</sub>
    </td>
    <td width="50%" align="center">
      <a href="docs/09-empty-state.webp"><img src="docs/09-empty-state.webp" alt="Empty state"></a><br>
      <sub><b>Empty state</b> — the page before you write anything</sub>
    </td>
  </tr>
</table>

<p align="center">
  <a href="docs/15-settings-font.webp"><img src="docs/15-settings-font.webp" width="900" alt="Font settings"></a><br>
  <sub><b>Settings · Fonts</b> — interface and editor fonts are separate; type any font name installed on your machine</sub>
</p>

## Quick start

**Option 1 — install it.** No Python needed. Grab the latest
[`Diary-*-win64-setup.exe`](https://github.com/Enkrid-Rao/diary/releases/latest) and run it: Windows
10/11 only, WebView2 is already there on current builds. Entries go to `Documents\Diary`, settings to
`%APPDATA%\Diary`, and both survive upgrades and uninstalls. The installer drops the program into
`C:\Program Files\Diary` (or `%LOCALAPPDATA%\Programs\Diary` if you pick "install for me only").

**Option 2 — portable.** Download the `.zip`, unpack it anywhere, run `Diary.exe`. Entries stay next
to the exe, so the whole folder can live on a USB stick.

**Option 3 — run from source.** Windows 10/11 with the WebView2 runtime, Python 3.9+.

```bash
git clone https://github.com/Enkrid-Rao/diary.git
cd diary
pip install -r requirements.txt
python app.py
```

On first launch from source the app creates `diaries/` and `settings.json` next to `app.py`. Point the
diary folder somewhere else from **Settings → General** if you prefer.

> **Building the packages yourself:** `python build_release.py` produces the portable folder and zip
> (PyInstaller), `installer.iss` compiles the installer with Inno Setup 6, and `Diary.py` stays as the
> thin launcher for running an unpacked copy against editable source.

## Keyboard shortcuts

Every shortcut is rebindable in **Settings → Shortcuts**.

| Action | Default | Action | Default |
| --- | --- | --- | --- |
| Save | `Ctrl+S` | Bold | `Ctrl+B` |
| Italic | `Ctrl+I` | Inline code | `Ctrl+E` |
| Strikethrough | `Ctrl+Shift+X` | Link | `Ctrl+K` |
| Full-text search | `Ctrl+F` | Settings | `Ctrl+,` |
| Previous / next day | `Alt+←` / `Alt+→` | Back to today | `Ctrl+T` |
| Toggle sidebar | `Ctrl+\` | Heading 1–3 | `Ctrl+1…3` |

Inside the search panel: `↑` `↓` to move, `Enter` to open, `Esc` to close.
Inside the LaTeX panel: `↑` `↓` to move, `Tab` / `Enter` to insert, `Esc` to close.

## How it works

```
app.py                  single-file HTTP server (stdlib http.server) + pywebview window
static/index.html       the whole UI, one page
static/style.css        design tokens + 19 sections; light theme lives in §19
static/app.js           editor, preview, calendar, search, settings
static/latex-*.js       command table + suggestion engine
static/vendor/          CodeMirror 5, KaTeX (vendored — no CDN, works offline)
diaries/YYYY-MM-DD.md   your entries (git-ignored)
settings.json           local config (git-ignored)
```

The server exposes a small JSON API (`/api/entry`, `/api/list`, `/api/search`, `/api/settings`) and
injects the saved settings into the page so the first frame already has the right theme — no flash.

### Notes on the design

The palette is built on **surface steps, not shadows**. Dark mode raises elements by *brightening*
them in small, even steps; light mode does the same thing in the opposite direction — page darkest,
dialog slightly whiter, cards pure white — rather than inverting the dark theme, which only ever
produces dirty grey. Accent colours are split in two: `--accent` (deepened, for text and borders,
AA-contrast) and `--accent-fill` (kept saturated, for switches, sliders and the selected day).

## License

[MIT](LICENSE) © 2026 XinxingRao — use it, fork it, ship it.
