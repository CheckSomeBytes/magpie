# Magpie

Local-first screenshot + annotation app (Snagit replacement) for **Ubuntu 26.04 / GNOME 50 (Wayland-only)** and **Windows 11**. Electron + React + Konva. No cloud, no telemetry.

Built from the design doc ("Snagit Alternative — Design Doc", Nov 4 2026):

- **v1:** capture, overlay region select, editor, `.magpie` project files, tray, hotkeys.
- **Phase 2:** library with thumbnail grid, tags, full-text search and a SQLite index.
- **Phase 3:** scrolling capture (you scroll, Magpie samples and stitches).
- **Phase 4:** offline OCR (Grab text + searchable library), stamps and pasted images, style presets, annotation templates, capture presets.
- **Phase 5:** screen recording with trim and MP4/GIF export.

## Download

Installers for Windows 11 (`.exe`) and Ubuntu (`.deb`, AppImage) are on the [Releases page](https://github.com/CheckSomeBytes/magpie/releases/latest). To publish a new one, bump `version` in `apps/desktop/package.json`, then push a tag such as `v1.0.1`. The *Release* workflow builds on both OSes and attaches the installers.

## Quick start (from source)

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
packages/stitcher/           scrolling-capture stitcher (row signatures, offset voting, header/footer masking, seams). Pure TS, tested.
apps/desktop/
  src/main/                  tray, hotkeys, capture flow, IPC, settings, doctor, autostart
    capture/                 CaptureProvider: linux-portal (dbus-next → Screenshot portal), windows (desktopCapturer + koffi Win32), fake
    windows/                 overlay (region select), editor, home
    store/project-store.ts   autosave to ~/Pictures/Magpie/YYYY/MM/*.magpie (atomic, per-file locked writes)
    library/                 db.ts (node:sqlite + FTS5 index), indexer.ts (scan/sync), service.ts (watcher, thumbs, edits)
  src/preload/               contextBridge API (sandboxed renderers)
  src/shared/                IPC contract, geometry (logical↔physical mapping), CLI, accelerators. Tested.
  src/renderer/{overlay,editor,home,library,scroll}/
  scripts/smoke/             end-to-end CDP smoke tests with fake capture sources (run.sh)
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

## Scrolling capture (Phase 3)

Start it from the tray (**Scrolling Capture**), the home window, `magpie --capture=scroll`, or **Ctrl+Shift+PrintScreen**.

1. **Choose a screen.** On Wayland this is one ScreenCast portal dialog: Magpie hands Chromium a synthetic source, so it never calls `getSources()` first, which would cause a second dialog (§12). On Windows and X11 it uses the monitor under the cursor, with no dialog.
2. **Drag around the area that scrolls** on a frozen frame. Enter alone uses the whole screen.
3. **Scroll down slowly.** A small panel shows the stitched height. On Windows it's excluded from capture with `setContentProtection`. Press **Finish** or the hotkey again.
4. **Review:** seams are marked, with weak or lost-track seams highlighted. Nudge any seam by ±1 or ±10 px, then **Open in editor** to get a normal `.magpie`.

`@magpie/stitcher` summarises each row as 48 column blocks of luma mean plus horizontal gradient. That signature survives the video-colour conversion of screen-share frames, where exact pixel hashes don't.

- Offsets are found by voting over informative rows. Flat background rows never vote.
- Each sample is compared with the previous sample, not the last kept frame, so repetitive content can't alias.
- Sticky headers and footers are detected and masked.
- Seams go at the most similar row.
- Memory stays bounded: a frame is kept about every 40% of the region height.
- Scrolling up is ignored. Scrolling faster than one region per sample is flagged as a gap. Output is capped at 32,000 px.

Limitations: only downward scrolling is stitched. On Wayland the portal may ask again on each capture, because Chromium doesn't expose the portal's `restore_token`. On Linux the recording panel can be captured if it overlaps the region, since GNOME doesn't let apps place windows.

## OCR, stamps and presets (Phase 4)

- **OCR** uses tesseract.js 7, the browser build, fully offline. `scripts/copy-ocr-assets.mjs` copies the worker, the three LSTM WASM cores and the English `best_int` model (~3 MB) into `resources/ocr`; it runs automatically before dev and build. They're served over `magpie-asset://`, a CORS-enabled custom scheme, because the OCR worker runs from a `blob:` URL. The editor and OCR pages allow this in their CSP (`'wasm-unsafe-eval'`, `magpie-asset:`).
  - **Grab text** (G in the editor): drag around text, or click once for the whole image. It reads the original capture, not the annotations, and copies the result.
  - **Library search:** a hidden OCR window reads each capture in the background, newest first. The text goes into the index (it's also shown in the details panel) and is searchable straight away. Turn it off in Settings with "Read text in captures…".
- **Stamps** (M): six built-in badges (check, cross, warning, info, question, star), plus your own stamps. Add them with "Add image as stamp…" or **Save as stamp** on a pasted image. They're stored in `<userData>/stamps`.
- **Paste** (Ctrl+V): drops any clipboard image in as an image annotation. Its pixels are embedded in the `.magpie` under `assets/`, and unused assets are dropped on save.
- **Style presets:** a "Presets" row in the properties panel for every tool. Save the current style under a name and click a preset to apply it.
- **Templates:** the Templates menu saves the current annotations, positioned relative to the image size, and applies them to any capture as one undo step. Image annotations aren't included.
- **Capture presets** (Settings → Capture presets): a mode, a 0–30 s delay, auto-tags, copy to clipboard, open the editor or save quietly to the library, and an optional hotkey. Run them from the tray **Presets** menu, the home window, or `magpie --preset=<name>`.

## Video (Phase 5)

Start and stop recording from the tray (**Record Video**), the home window, `magpie --capture=video`, or **Ctrl+Alt+PrintScreen**.

- **Capture** uses `getDisplayMedia` through the same handler as scrolling capture. On Wayland you get one portal dialog; on Windows and X11 it records the monitor under the cursor. You can add the **microphone** (Settings) and, on Windows, **system audio** (loopback). When both are on, they're mixed into one track.
- **Recording:** MediaRecorder (VP9 + Opus) writes 1-second chunks straight to `….webm.part` on disk, so long recordings never sit in memory. A small panel shows the timer, Pause/Resume, Stop and Discard; on Windows it's kept out of the recording.
- **On stop**, the file is **remuxed** with ffmpeg (stream copy). MediaRecorder WebM has no duration or cues, so without this it couldn't be seeked. Then it opens for review.
- **Review window:**
  - The player is served over `magpie-media://`, which supports HTTP Range so you can seek. It only serves files Magpie registered.
  - Trim with the sliders, or **I** / **O** at the playhead, and use **Play selection** to check it.
  - **Export MP4** (H.264/AAC, faststart), **Export GIF** (palette-optimised; width and fps options), or **Save trimmed WebM** (frame-accurate). Exports go next to the source and never overwrite.
- **Library:** `.webm` and `.mp4` files show up with a thumbnail, a ▶ duration and format badge, and the same rename and tag editing. Videos have no manifest, so title and tags live in a `<video>.json` sidecar. OCR skips videos.
- **ffmpeg** comes from `ffmpeg-static` 5.3 (ffmpeg 7, GPL build, about 80 MB per platform). It's unpacked from the asar in packaged builds. It downloads the binary for the platform you install on, so **build each platform's package on that platform**. Doctor reports if it's missing.

## Verified / not yet verified

Verified in this repo: unit tests; typecheck; production build; an Electron smoke test driven over CDP (on WSLg, with the fake provider). The smoke test covered editor render of all eight annotation types, drawing, save, thumbnail, undo + autosave, crop, copy, region capture through the overlay into a cropped editor, the home window, and staying resident after windows close.

**Not yet verified on real hardware — the week-1 spikes (§15):**

1. Portal non-interactive screenshot on Ubuntu 26.04: one-time permission, then silent.
2. Where the fullscreen overlay lands with 2+ monitors on GNOME 50, and whether `getDisplayMatching` finds it. The overlay has a screen picker as a fallback, plus the *editor-crop* region mode in Settings.
3. Fractional (125/150%) and mixed-DPI scale mapping.
4. GlobalShortcuts consent dialog and persistence with the installed dev `.desktop`.
5. Pasting clipboard images into Firefox, Slack, LibreOffice and GNOME Text Editor while Magpie sits in the tray.
6. Windows: per-monitor overlays and koffi window bounds on mixed DPI.
7. Screen-share path (scrolling capture and video): on Wayland, check the synthetic source opens exactly one ScreenCast portal dialog. On Windows, check system-audio loopback and that the panel is excluded from capture.
8. Microphone permission prompts on each OS.

Phase 2 is verified the same way: 12 unit tests on the index and indexer, plus a 14-check Electron smoke test. That test covered the scan, thumbnails, search, tag filter, writing tags and titles to files, the watcher picking up an external delete, a new capture appearing live, and an editor save keeping library tags.

Phase 3 is verified the same way: 9 stitcher unit tests (exact reconstruction, noise and chroma smear, repetitive content, gaps, reverse scrolling, nudges, height cap), plus an 11-check smoke test. In the smoke test, a fake scrolling stream (`MAGPIE_FAKE_SCROLL=tall.png`) goes through the real video → worker → stitcher → editor path, and the saved `.magpie` matches the source page pixel-for-pixel.

Phase 4 is verified the same way: format tests for assets, plus a 9-check smoke test that renders a real text image in the app.

- Background OCR makes "overdue" searchable, and Grab text reads both lines exactly.
- A quiet preset saves with its auto-tag and doesn't open an editor.
- A pasted image is embedded as an asset, and Save as stamp, a style preset and a template all work.
- The saved file contains the expected annotation types and the asset.

Phase 5 is verified with 8 unit tests that run real ffmpeg (probe, thumbnail, remux, trim-accurate MP4/GIF/WebM exports, video indexing with sidecars, v1 → v2 index migration), plus a 13-check smoke test. It records a synthetic stream through the real MediaRecorder path, using the hotkey path to start and stop, then checks:

- the remuxed file has a real duration and the player can seek
- the I/O trim gives a 1.5 s MP4, and the GIF export is valid
- videos appear in the library, and tagging writes the sidecar

**Smoke tests:** `npm run build -w magpie && apps/desktop/scripts/smoke/run.sh` (needs a display). Fakes: `MAGPIE_FAKE_CAPTURE`, `MAGPIE_FAKE_SCROLL`, `MAGPIE_FAKE_VIDEO`, all unpackaged builds only.
