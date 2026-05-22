// Cross-platform "get the user's current position" helper.
//
// Browser navigator.geolocation requires a secure context (HTTPS or
// localhost). On a physical iPhone running the Capacitor app against
// the dev server's LAN IP (http://192.168.7.129:3000), WebKit treats
// that as insecure and rejects the API with:
//   "Access to geolocation was blocked over insecure connection"
//
// Capacitor's @capacitor/geolocation plugin sidesteps that by routing
// through native CoreLocation — the iOS system prompt asks the user
// once, the JS bridge returns coords, no WebView origin check applies.
// On web / iOS Simulator (localhost is secure), we still fall back to
// the standard browser API so behavior is identical.

export interface PositionResult {
  latitude: number;
  longitude: number;
}

export interface PositionError {
  code: "permission_denied" | "unsupported" | "timeout" | "unknown";
  message: string;
}

const NATIVE_TIMEOUT_MS = 10_000;
const NATIVE_MAX_AGE_MS = 60_000;

export async function getCurrentPosition(): Promise<PositionResult | PositionError> {
  // Native (Capacitor) path — preferred on iOS / Android devices.
  if (typeof window !== "undefined") {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform?.()) {
      try {
        const { Geolocation } = await import("@capacitor/geolocation");
        const perm = await Geolocation.checkPermissions();
        if (perm.location !== "granted") {
          const req = await Geolocation.requestPermissions();
          if (req.location !== "granted") {
            return { code: "permission_denied", message: "Location permission denied." };
          }
        }
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: false,
          timeout: NATIVE_TIMEOUT_MS,
          maximumAge: NATIVE_MAX_AGE_MS,
        });
        return {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        };
      } catch (err) {
        return {
          code: "unknown",
          message: err instanceof Error ? err.message : "Could not get location",
        };
      }
    }
  }

  // Web fallback.
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { code: "unsupported", message: "Your browser doesn't support geolocation." };
  }
  return new Promise<PositionResult | PositionError>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => {
        const code: PositionError["code"] =
          err.code === err.PERMISSION_DENIED ? "permission_denied" :
          err.code === err.TIMEOUT ? "timeout" : "unknown";
        resolve({ code, message: err.message || "Could not get your location." });
      },
      { timeout: NATIVE_TIMEOUT_MS, maximumAge: NATIVE_MAX_AGE_MS }
    );
  });
}

export function isPositionError(r: PositionResult | PositionError): r is PositionError {
  return "code" in r;
}
