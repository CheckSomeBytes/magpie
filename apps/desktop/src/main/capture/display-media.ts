/**
 * getDisplayMedia() for scrolling capture (Phase 3) and video (Phase 5).
 *
 * Wayland (§12): do NOT call desktopCapturer.getSources() first. That opens
 * the ScreenCast portal itself, so users would see two dialogs. Hand Chromium
 * a synthetic screen source and let its PipeWire capturer open the portal once.
 *
 * Windows / X11: pick the display under the cursor (no dialog).
 */
import { app, desktopCapturer, screen, session, type DesktopCapturerSource, type Display } from 'electron';
import { settings } from '../settings';

let lastDisplay: Display | null = null;

/** The display last handed to a getDisplayMedia() caller (Windows/X11 only). */
export function lastStreamDisplay(): Display | null {
  return lastDisplay;
}

export function isWayland(): boolean {
  return process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY) && app.commandLine.getSwitchValue('ozone-platform') !== 'x11';
}

/** Call before app 'ready' on Linux so Chromium uses PipeWire for screen capture. */
export function enablePipeWireCapture(): void {
  if (process.platform === 'linux') app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
}

export function setupDisplayMedia(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        if (isWayland()) {
          lastDisplay = null;
          // Synthetic source: Chromium's PipeWire capturer shows the portal picker.
          callback({ video: { id: 'screen:0:0', name: 'Screen' } as unknown as DesktopCapturerSource });
          return;
        }
        const cursor = screen.getCursorScreenPoint();
        const display = screen.getDisplayNearestPoint(cursor);
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        const all = screen.getAllDisplays();
        const source =
          sources.find((s) => s.display_id === String(display.id)) ??
          sources[all.findIndex((d) => d.id === display.id)] ??
          sources[0];
        if (!source) {
          callback({});
          return;
        }
        lastDisplay = display;
        // Windows can capture system audio ("loopback") alongside the screen.
        const loopback = process.platform === 'win32' && request.audioRequested && settings.get().recordSystemAudio;
        callback(loopback ? { video: source, audio: 'loopback' } : { video: source });
      } catch (err) {
        console.error('[display-media] failed', err);
        callback({});
      }
    },
    { useSystemPicker: false },
  );
}
