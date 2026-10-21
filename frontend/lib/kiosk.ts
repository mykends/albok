// The kiosk shell's bridge (desktop/preload.js). Absent in an ordinary browser.

export type WebToolBlocked = { webContentsId: number; url: string };

export type KioskBridge = {
  kiosk?: boolean;
  /** Set by kiosk installers that can show web tools; older ones lack it. */
  webTools?: boolean;
  signOut?: () => Promise<void> | void;
  setWebTools?: (urls: string[], endsInMs: number) => Promise<void>;
  onWebToolBlocked?: (callback: (detail: WebToolBlocked) => void) => () => void;
  onWebToolActivity?: (callback: () => void) => () => void;
};

export function kioskBridge(): KioskBridge | undefined {
  return (globalThis as { albokKiosk?: KioskBridge }).albokKiosk;
}

/** How a student sees the lesson's web tools (KTD8): tabs in a kiosk that supports them, nothing in an
 * older kiosk, plain links anywhere else (an ordinary browser, or the desktop app outside kiosk mode). */
export type WebToolMode = 'tabs' | 'hidden' | 'links';

export function webToolMode(): WebToolMode {
  const bridge = kioskBridge();
  if (!bridge?.kiosk) return 'links';
  return bridge.webTools && bridge.setWebTools ? 'tabs' : 'hidden';
}
