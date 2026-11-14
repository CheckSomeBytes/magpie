/**
 * User-facing notices. Never blocks the main process: without a notification
 * service (no session D-Bus, daemon off) Electron reports isSupported() false,
 * and the old fallback, dialog.showErrorBox, is synchronous and froze the app.
 */
import { dialog, Notification } from 'electron';
import { trayNotice } from './tray';

export function notify(title: string, body: string, level: 'info' | 'error' = 'info'): void {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
    return;
  }
  if (level === 'error') {
    void dialog.showMessageBox({ type: 'error', title, message: title, detail: body }); // async: doesn't block
    return;
  }
  trayNotice(title, body);
}
