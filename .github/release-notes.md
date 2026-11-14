Local-first screenshot and annotation app for **Windows 11** and **Ubuntu 26.04 (GNOME, Wayland)**. No cloud, no telemetry.

## Download

| System | File |
|---|---|
| Windows 11 | `Magpie-Setup-1.0.0.exe` (installs for your user, no admin) |
| Ubuntu 26.04 | `magpie_1.0.0_amd64.deb` (recommended) |
| Other Linux | `Magpie-1.0.0-x86_64.AppImage` |

- **Windows:** the installer isn't code-signed yet, so SmartScreen will warn. Click **More info → Run anyway**.
- **Ubuntu:** install with `sudo apt install ./magpie_1.0.0_amd64.deb`, then log out and back in once. The `.deb` installs the desktop entry that GNOME needs before it allows global hotkeys and silent screenshots. The AppImage runs, but hotkeys won't work until a matching desktop entry is installed.
- Checksums are in `SHA256SUMS.txt`.

## Hotkeys

| Key | Capture |
|---|---|
| PrintScreen | Region |
| Shift+PrintScreen | Window |
| Ctrl+PrintScreen | Full screen |
| Ctrl+Shift+PrintScreen | Scrolling capture |
| Ctrl+Alt+PrintScreen | Start/stop video recording |

You can change these in Settings. On Ubuntu, GNOME asks you to confirm them the first time.

## What's in 1.0

- Capture a region, window or full screen, then annotate it. The editor has arrows, shapes, text, highlighter, blur, numbered steps, stamps and pasted images.
- Captures save as editable `.magpie` files, and you can export them as PNG or copy them to the clipboard.
- A library with thumbnails, tags, titles, and full-text search that includes the text inside your screenshots (offline OCR).
- Scrolling capture: you scroll, and Magpie stitches the page together. A review step lets you fix any seam.
- **Grab text** reads the text in a selected area offline.
- Style presets, annotation templates and capture presets, with optional hotkeys for the presets.
- Screen recording with microphone (optional) and system audio (Windows), plus trimming and MP4/GIF/WebM export.

## Known limits

This is the first build on real systems. It was tested with automated and simulated-capture tests, not yet on physical Ubuntu and Windows machines with multiple monitors or mixed scaling. Please report anything odd.
