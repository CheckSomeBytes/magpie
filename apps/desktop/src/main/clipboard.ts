import { clipboard, ClipboardItem } from 'electron';

/**
 * Put a PNG on the system clipboard. Electron 45 replaced writeImage() with the
 * async W3C-style write([ClipboardItem]).
 *
 * On Wayland the clipboard contents vanish when the source app exits (A7), so
 * Magpie stays resident in the tray; never copy-then-quit.
 */
export async function copyPng(png: Uint8Array): Promise<void> {
  const blob = new Blob([new Uint8Array(png)], { type: 'image/png' });
  await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
