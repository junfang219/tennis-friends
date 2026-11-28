"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { setCached } from "@/lib/queryCache";
import { getCachedUserId } from "@/lib/supabase/auth-store";
import { fetchActiveTeams, readLastTeam, teamLaunchTarget } from "@/lib/teamNavigation";
import { notificationTarget, universalLinkTarget } from "@/lib/nativeNavigation";
import { finishNativeLaunch, nativeLaunchPending } from "@/lib/nativeLaunch";

export default function NativeNavigation() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/") finishNativeLaunch();
  }, [pathname]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
    let explicitTarget: string | null = null;
    const listeners: PluginListenerHandle[] = [];
    const initialHref = window.location.href;
    const openedFromHome = window.location.pathname === "/" && !window.location.search && !window.location.hash;
    const abort = new AbortController();
    const chooseDefault = nativeLaunchPending();
    if (!chooseDefault) finishNativeLaunch();
    // Offline or a stalled bridge should still let the user reach Feed.
    const timeout = window.setTimeout(() => {
      abort.abort();
      finishNativeLaunch();
    }, 4000);

    function navigate(target: string | null) {
      if (!target || disposed) return;
      const wasStarting = nativeLaunchPending();
      if (wasStarting && target === explicitTarget) return;
      explicitTarget = target;
      abort.abort();
      const current = window.location;
      if (`${current.pathname}${current.search}${current.hash}` !== target) {
        if (wasStarting) router.replace(target);
        else router.push(target);
      }
      if (new URL(target, current.origin).pathname === "/") finishNativeLaunch();
    }

    async function retain(pending: Promise<PluginListenerHandle>) {
      const listener = await pending;
      if (disposed) await listener.remove();
      else listeners.push(listener);
    }

    async function connectLinks() {
      const { App } = await import("@capacitor/app");
      if (disposed) return;
      await retain(App.addListener("appUrlOpen", ({ url }) => navigate(universalLinkTarget(url))));
      // An invite that created the WebView can be available here even when
      // there wasn't a JS listener at the time the OS delivered it.
      if (openedFromHome && !explicitTarget && !disposed) {
        const launch = await App.getLaunchUrl();
        if (!explicitTarget) navigate(universalLinkTarget(launch?.url));
      }
    }

    async function connectNotifications() {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      if (disposed) return;
      // Register this listener before auth/permission/device registration.
      // Capacitor delivers retained notification taps to the first listener.
      await retain(PushNotifications.addListener("pushNotificationActionPerformed", action => {
        navigate(notificationTarget(action.notification.data));
      }));
    }

    async function launch() {
      await Promise.allSettled([connectLinks(), connectNotifications()]);
      if (disposed || explicitTarget || !chooseDefault || !nativeLaunchPending()) return;
      try {
        const { teams, viewerId } = await fetchActiveTeams({ signal: abort.signal });
        const currentUser = getCachedUserId();
        if (disposed || abort.signal.aborted || !nativeLaunchPending() || window.location.href !== initialHref) return;
        if (currentUser && currentUser !== viewerId) {
          finishNativeLaunch();
          return;
        }
        setCached(`active-teams:${viewerId}`, { viewerId, teams });
        const target = teamLaunchTarget(teams, readLastTeam(viewerId));
        if (target) {
          router.replace(target);
          return;
        }
      } catch {
        if (disposed || explicitTarget) return;
      }
      finishNativeLaunch();
    }

    void launch();
    return () => {
      disposed = true;
      abort.abort();
      window.clearTimeout(timeout);
      for (const listener of listeners) void listener.remove().catch(() => {});
    };
  }, [router]);

  return null;
}
