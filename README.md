# Magpie

Local-first screenshot + annotation app (Snagit replacement) for **Ubuntu 26.04 / GNOME 50 (Wayland-only)** and **Windows 11**. Electron + React + Konva. No cloud, no telemetry.

Built from the design doc ("Snagit Alternative — Design Doc", Nov 4 2026):

- **v1:** capture, overlay region select, editor, `.magpie` project files, tray, hotkeys.
- **Phase 2:** library with thumbnail grid, tags, full-text search and a SQLite index.

## Quick start

```bash
npm install
npm run dev                 # electron-vite dev server + app
npm test                    # unit tests (format package + desktop shared logic)
npm run typecheck
npm run build               # production bundles in apps/desktop/out
npm run dist:linux          # .deb + AppImage   (run on Linux)
npm run dist:win            # NSIS installer    (run on Windows)
```

**Linux, required once for dev:** GNOME only grants global shortcuts and the silent-screenshot permission to an app whose `desktopName` matches an *installed* `.desktop` file (§5):

```bash
npm run install-desktop-entry -w magpie          # writes ~/.local/share/applications/works.telesto.Magpie.desktop
npm run install-desktop-entry -w magpie -- --remove
```

Diagnostics: tray → *Settings & Diagnostics… → Run checks*, or `electron apps/desktop --doctor`.

**UI work without a portal** (WSL, CI, non-GNOME): `MAGPIE_FAKE_CAPTURE=/path/to/desktop.png npm run dev` serves that PNG as the desktop. Unpackaged builds only.

## Layout

```
packages/magpie-format/      .magpie schema, zip read/write (fflate), migrations, step renumbering. Pure TS, tested.
apps/desktop/
  src/main/                  tray, hotkeys, capture flow, IPC, settings, doctor, autostart
    capture/                 CaptureProvider: linux-portal (dbus-next → Screenshot portal), windows (desktopCapturer + koffi Win32), fake
    windows/                 overlay (region select), editor, home
    store/project-store.ts   autosave to ~/Pictures/Magpie/YYYY/MM/*.magpie (atomic, per-file locked writes)
    library/                 db.ts (node:sqlite + FTS5 index), indexer.ts (scan/sync), service.ts (watcher, thumbs, edits)
  src/preload/               contextBridge API (sandboxed renderers)
  src/shared/                IPC contract, geometry (logical↔physical mapping), CLI, accelerators. Tested.
  src/renderer/{overlay,editor,home,library}/
  resources/                 icons (scripts/make-icons.mjs), .desktop file
```

## Decisions and departures from the doc

- **Name and ids:** Magpie, `works.telesto.Magpie`, file extension **`.magpie`** (the doc used `.snapx`). The CLI is `magpie --capture=region|window|full [file.magpie]`.
- **Use `--capture=region` (with `=`) in shortcuts.** Chromium reorders a forwarded second-instance argv (switches first), so `--capture region` arrives split apart. The parser recovers either form, but `=` is the robust one.
- **Electron 45 removed `clipboard.writeImage`.** Copy uses `clipboard.write([new ClipboardItem({'image/png': blob})])` (`src/main/clipboard.ts`).
- **Linux scale mapping** uses image size ÷ logical desktop bounding box, not per-display `scaleFactor`, on the theory that GNOME renders the whole stage at one scale. Spike 3 must confirm this; a warning is logged if X and Y ratios disagree.
- **Blur** samples a padded area and clips, so the filter's edge falloff never reveals original pixels. Blur is baked into PNG export only; `.magpie` keeps the original (the status bar warns).
- **The highlighter uses opacity, not `multiply`.** Konva layers are separate canvases, so multiply would look different in the editor than in the export.
- **Window capture:** on Linux it uses the portal's interactive picker (the only way to get one window on Wayland). On Windows it uses the overlay with z-ordered window snapping. Clicking a window in region mode also snaps on Windows.
- **Known advisory:** `dbus-next` pins `xml2js@0.4` (prototype-pollution advisory). It only parses introspection XML from the local session bus. Replace it if the D-Bus layer gets swapped for an `ashpd` helper.

## Library (Phase 2)

Open it from the tray (**Library…**), from the home window, or with `magpie --library`.

- **Files are the source of truth.** Title and tags are stored in each `.magpie` manifest. `library.sqlite` in the app's data folder is a rebuildable cache, so deleting it loses nothing.
- **Index:** `node:sqlite` (bundled with Electron 45's Node 24, so no native module or `@electron/rebuild`). It has `captures`, `tags`, `capture_tags` and an FTS5 table over title, file name, text annotations, tags and OCR text. OCR text is reserved for Phase 4: `setOcrText` makes it searchable and it survives re-indexing.
- **Sync:** a full scan at startup, skipping files whose modification time and size haven't changed. A recursive file watcher handles external changes, and Magpie's own saves are indexed immediately. Moving the captures folder in Settings re-points the watcher and rescans.
- **Search:** each word is matched as a prefix, and all words must match. Tags in the sidebar filter with AND, and there's also an "Untagged" view.
- **Edits:** renaming and tagging rewrite the manifest under a per-file lock. Editor saves re-read title and tags from disk, so the two never clobber each other. **Move to Trash** uses the system trash, after a confirmation.
- **Thumbnails** are served from the index over `magpie-thumb://`.
- **Keys:** Ctrl+F search, Ctrl+A select all, ←/→ move, Enter open, Delete trash, Esc clear. Ctrl/Shift-click selects several.

## Verified / not yet verified

Verified in this repo: unit tests; typecheck; production build; an Electron smoke test driven over CDP (on WSLg, with the fake provider). The smoke test covered editor render of all eight annotation types, drawing, save, thumbnail, undo + autosave, crop, copy, region capture through the overlay into a cropped editor, the home window, and staying resident after windows close.

**Not yet verified on real hardware — the week-1 spikes (§15):**

1. Portal non-interactive screenshot on Ubuntu 26.04: one-time permission, then silent.
2. Where the fullscreen overlay lands with 2+ monitors on GNOME 50, and whether `getDisplayMatching` finds it. The overlay has a screen picker as a fallback, plus the *editor-crop* region mode in Settings.
3. Fractional (125/150%) and mixed-DPI scale mapping.
4. GlobalShortcuts consent dialog and persistence with the installed dev `.desktop`.
5. Pasting clipboard images into Firefox, Slack, LibreOffice and GNOME Text Editor while Magpie sits in the tray.
6. Windows: per-monitor overlays and koffi window bounds on mixed DPI.

Phase 2 is verified the same way: 12 unit tests on the index and indexer, plus a 14-check Electron smoke test. That test covered the scan, thumbnails, search, tag filter, writing tags and titles to files, the watcher picking up an external delete, a new capture appearing live, and an editor save keeping library tags.

Phases 3–5 (scrolling capture, OCR, video) are not started.
