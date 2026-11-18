type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  HapticFeedback?: {
    impactOccurred: (style: "light" | "medium" | "heavy") => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
  };
  openLink?: (url: string) => void;
};

/**
 * The Telegram WebApp object, or null outside Telegram. In a normal browser tab the script still
 * defines a stub with empty initData whose methods only log "not supported" warnings, so we treat
 * it as absent.
 */
export function getWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const wa = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  return wa && wa.initData ? wa : null;
}

export function isInsideTelegram(): boolean {
  return getWebApp() !== null;
}

export function haptic(kind: "tap" | "success" | "error") {
  const h = getWebApp()?.HapticFeedback;
  if (!h) return;
  if (kind === "tap") h.impactOccurred("light");
  else h.notificationOccurred(kind);
}

export function openExternal(url: string) {
  const wa = getWebApp();
  if (wa?.openLink) wa.openLink(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
