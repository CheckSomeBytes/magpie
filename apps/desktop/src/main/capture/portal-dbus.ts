/**
 * Thin wrapper over org.freedesktop.portal.Screenshot via dbus-next (§4.2).
 * Kept small and isolated so it can be swapped for a native helper (ashpd).
 */
import { readFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import type { MessageBus } from 'dbus-next';
import { CaptureCancelled } from './types';

// dbus-next is CommonJS; import lazily so Windows builds never touch it.
type DBus = typeof import('dbus-next');
let dbusMod: DBus | null = null;
function dbus(): DBus {
  if (!dbusMod) dbusMod = require('dbus-next') as DBus;
  return dbusMod;
}

const PORTAL_BUS = 'org.freedesktop.portal.Desktop';
const PORTAL_PATH = '/org/freedesktop/portal/desktop';
const SCREENSHOT_IFACE = 'org.freedesktop.portal.Screenshot';
const REQUEST_IFACE = 'org.freedesktop.portal.Request';

let bus: MessageBus | null = null;

function sessionBus(): MessageBus {
  if (!bus) {
    bus = dbus().sessionBus();
    bus.on('error', (err: Error) => {
      console.error('[portal] session bus error', err);
      bus = null;
    });
  }
  return bus;
}

export function disconnectBus(): void {
  bus?.disconnect();
  bus = null;
}

async function call(msg: ConstructorParameters<DBus['Message']>[0]): Promise<unknown[]> {
  const { Message, MessageType } = dbus();
  const reply = await sessionBus().call(new Message(msg));
  if (!reply || reply.type === MessageType.ERROR) {
    throw new Error(`D-Bus error: ${reply?.errorName ?? 'no reply'} ${String(reply?.body?.[0] ?? '')}`);
  }
  return reply.body;
}

/** Read a portal interface's `version` property, or 0 if the interface is absent. */
export async function portalInterfaceVersion(iface: string): Promise<number> {
  const { Variant } = dbus();
  try {
    const [v] = await call({
      destination: PORTAL_BUS,
      path: PORTAL_PATH,
      interface: 'org.freedesktop.DBus.Properties',
      member: 'Get',
      signature: 'ss',
      body: [iface, 'version'],
    });
    return v instanceof Variant ? Number(v.value) : Number(v);
  } catch {
    return 0;
  }
}

export interface PortalShot {
  png: Buffer;
  uri: string;
}

/**
 * Call Screenshot(parent_window, options) and wait for Request.Response.
 * Subscribes to the pre-computed request path BEFORE calling, to avoid the race.
 */
export async function portalScreenshot(opts: { interactive: boolean; timeoutMs?: number }): Promise<PortalShot> {
  const { Message, MessageType, Variant } = dbus();
  const b = sessionBus();
  // Ensure the connection has a unique name (":1.234") before computing the request path.
  // `name` exists at runtime but is missing from dbus-next's typings.
  const uniqueName = () => (b as MessageBus & { name?: string | null }).name ?? '';
  if (!uniqueName()) await call({ destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', interface: 'org.freedesktop.DBus', member: 'GetId' });
  const sender = uniqueName().replace(/^:/, '').replace(/\./g, '_');
  const token = `magpie_${randomBytes(6).toString('hex')}`;
  const requestPath = `${PORTAL_PATH}/request/${sender}/${token}`;
  const rule = `type='signal',sender='${PORTAL_BUS}',interface='${REQUEST_IFACE}',member='Response',path='${requestPath}'`;

  await call({ destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', interface: 'org.freedesktop.DBus', member: 'AddMatch', signature: 's', body: [rule] });

  const timeoutMs = opts.timeoutMs ?? (opts.interactive ? 5 * 60_000 : 20_000);
  let onMessage: ((msg: InstanceType<DBus['Message']>) => void) | undefined;

  const response = new Promise<{ code: number; results: Record<string, InstanceType<DBus['Variant']>> }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Screenshot portal did not answer within ${timeoutMs / 1000}s`)), timeoutMs);
    onMessage = (msg) => {
      if (msg.type !== MessageType.SIGNAL || msg.path !== requestPath || msg.member !== 'Response') return;
      clearTimeout(timer);
      const [code, results] = msg.body as [number, Record<string, InstanceType<DBus['Variant']>>];
      resolve({ code, results });
    };
    b.on('message', onMessage);
  });

  try {
    const [handle] = await call({
      destination: PORTAL_BUS,
      path: PORTAL_PATH,
      interface: SCREENSHOT_IFACE,
      member: 'Screenshot',
      signature: 'sa{sv}',
      body: [
        '',
        {
          handle_token: new Variant('s', token),
          interactive: new Variant('b', opts.interactive),
          modal: new Variant('b', true),
        },
      ],
    });
    if (handle !== requestPath) {
      // Old portals (<0.9) return a different path; we'd miss the signal. Surface it loudly.
      console.warn(`[portal] request path mismatch: expected ${requestPath}, got ${String(handle)}`);
    }

    const { code, results } = await response;
    if (code === 1) throw new CaptureCancelled();
    if (code !== 0) throw new Error(`Screenshot portal failed (response ${code}). Permission may have been denied.`);
    const uri = String(results.uri?.value ?? '');
    if (!uri.startsWith('file://')) throw new Error(`Screenshot portal returned no file (uri=${uri || 'none'}).`);

    const file = fileURLToPath(uri); // percent-decodes
    const png = await readFile(file);
    // The portal may write into ~/Pictures (KDE does). It's ours to clean up.
    await unlink(file).catch((err) => console.warn('[portal] could not delete', file, err));
    return { png, uri };
  } finally {
    if (onMessage) b.removeListener('message', onMessage);
    call({ destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', interface: 'org.freedesktop.DBus', member: 'RemoveMatch', signature: 's', body: [rule] }).catch(() => {});
  }
}

/** Does the portal object expose this interface at all? */
export async function portalHasInterface(iface: string): Promise<boolean> {
  try {
    const [xml] = await call({
      destination: PORTAL_BUS,
      path: PORTAL_PATH,
      interface: 'org.freedesktop.DBus.Introspectable',
      member: 'Introspect',
    });
    return String(xml).includes(`name="${iface}"`);
  } catch {
    return false;
  }
}

export const PORTAL_IFACES = {
  screenshot: SCREENSHOT_IFACE,
  globalShortcuts: 'org.freedesktop.portal.GlobalShortcuts',
  screencast: 'org.freedesktop.portal.ScreenCast',
} as const;
