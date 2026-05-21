"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { registerDeviceToken } from "@/lib/supabase/queries";

// Registers the device for APNs (or FCM on Android) and POSTs the token to the
// backend whenever a user is authenticated. Routes the user to the right place
// when they tap a banner. No-op on web — Capacitor is only present in the
// native iOS/Android shell.

type CapacitorPushModule = typeof import("@capacitor/push-notifications").PushNotifications;
type CoreModule = typeof import("@capacitor/core").Capacitor;

async function loadCapacitor(): Promise<{ Push: CapacitorPushModule; Core: CoreModule } | null> {
  try {
    const core = await import("@capacitor/core");
    if (!core.Capacitor.isNativePlatform()) return null;
    const push = await import("@capacitor/push-notifications");
    return { Push: push.PushNotifications, Core: core.Capacitor };
  } catch {
    return null;
  }
}

export default function PushRegistrar() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status !== "authenticated") return;
    let cleanup: (() => void) | null = null;

    (async () => {
      const cap = await loadCapacitor();
      if (!cap) return;
      const platform = cap.Core.getPlatform(); // "ios" | "android" | "web"
      if (platform !== "ios" && platform !== "android") return;

      // Ask permission. iOS will prompt the first time; subsequent calls return
      // the previously chosen state without re-prompting.
      const perm = await cap.Push.checkPermissions();
      let granted = perm.receive === "granted";
      if (!granted) {
        const req = await cap.Push.requestPermissions();
        granted = req.receive === "granted";
      }
      if (!granted) return;

      await cap.Push.register();

      const onRegistered = await cap.Push.addListener("registration", async (token) => {
        try {
          const supabase = createSupabaseBrowserClient();
          await registerDeviceToken(supabase, token.value, platform);
        } catch {
          // Will be re-registered on next sign-in.
        }
      });

      const onError = await cap.Push.addListener("registrationError", (err) => {
        console.warn("[push] registrationError", err);
      });

      // Tap on a banner from background/killed → route to the relevant chat.
      const onTap = await cap.Push.addListener("pushNotificationActionPerformed", (action) => {
        const data = action.notification.data || {};
        const kind = data.kind as string | undefined;
        if (kind === "dm" && data.from) {
          router.push(`/chat/${data.from}`);
        } else if (kind === "message_reaction" && data.from) {
          const target = data.messageId ? `/chat/${data.from}?msg=${data.messageId}` : `/chat/${data.from}`;
          router.push(target);
        } else if (kind === "group" && data.groupId) {
          router.push(`/groups/${data.groupId}/chat`);
        } else if (kind === "chat" && data.chatId) {
          router.push(`/chat/group/${data.chatId}`);
        }
      });

      cleanup = () => {
        onRegistered.remove();
        onError.remove();
        onTap.remove();
      };
    })();

    return () => {
      if (cleanup) cleanup();
    };
  }, [status, router]);

  return null;
}
