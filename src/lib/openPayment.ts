import type { PayIntent } from "./payment";

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  Plugins?: {
    Browser?: { open: (opts: { url: string; presentationStyle?: string }) => Promise<void> };
  };
};

function getCapacitor(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!cap) return null;
  if (cap.isNativePlatform && !cap.isNativePlatform()) return null;
  return cap;
}

function isMobileWeb(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export type OpenResult =
  | { kind: "launched_app" }
  | { kind: "opened_web" }
  | { kind: "copied"; text: string }
  | { kind: "noop" };

export async function openPayment(intent: PayIntent): Promise<OpenResult> {
  // Pure-copy methods (e.g. Zelle) — no URL to launch.
  if (!intent.appUrl && !intent.webUrl && intent.copyText) {
    try {
      await navigator.clipboard.writeText(intent.copyText);
      return { kind: "copied", text: intent.copyText };
    } catch {
      return { kind: "noop" };
    }
  }

  const cap = getCapacitor();

  if (cap) {
    if (intent.appUrl) {
      try {
        window.location.href = intent.appUrl;
        return { kind: "launched_app" };
      } catch {
        // Fall through to browser open
      }
    }
    if (intent.webUrl) {
      const browser = cap.Plugins?.Browser;
      if (browser) {
        try {
          await browser.open({ url: intent.webUrl, presentationStyle: "fullscreen" });
          return { kind: "opened_web" };
        } catch {
          // Fall through
        }
      }
      try {
        window.open(intent.webUrl, "_system");
        return { kind: "opened_web" };
      } catch {
        window.location.href = intent.webUrl;
        return { kind: "opened_web" };
      }
    }
    return { kind: "noop" };
  }

  if (isMobileWeb()) {
    if (intent.appUrl) {
      window.location.href = intent.appUrl;
      if (intent.webUrl) {
        const fallback = intent.webUrl;
        setTimeout(() => {
          if (document.visibilityState === "visible") {
            window.location.href = fallback;
          }
        }, 1500);
      }
      return { kind: "launched_app" };
    }
    if (intent.webUrl) {
      window.location.href = intent.webUrl;
      return { kind: "opened_web" };
    }
    return { kind: "noop" };
  }

  if (intent.webUrl) {
    window.open(intent.webUrl, "_blank", "noopener,noreferrer");
    return { kind: "opened_web" };
  }
  if (intent.appUrl) {
    window.open(intent.appUrl, "_blank", "noopener,noreferrer");
    return { kind: "launched_app" };
  }
  return { kind: "noop" };
}
