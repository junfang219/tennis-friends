import type { Metadata, Viewport } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import BottomNav from "@/components/BottomNav";
import PushRegistrar from "@/components/PushRegistrar";
import KeyboardInit from "@/components/KeyboardInit";

// SessionProvider is gone: Supabase's auth state is hydrated per-component
// via useSupabaseUser / the nextauth-compat shim. ArrivalDetector was
// deleted along with its useArrivalDetection hook — port it to a Supabase
// Realtime presence channel when the feature is rebuilt.

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  // No `interactiveWidget: "resizes-content"` — useKeyboardHeight
  // already handles keyboard-aware layout for both web (VisualViewport)
  // and Capacitor (Keyboard plugin), so the meta-viewport hint adds
  // no behaviour but logs a noisy `Viewport argument key
  // "interactive-widget" not recognized` warning on iOS Safari.
};

export const metadata: Metadata = {
  title: "TennisFriends — Find Your Court Companions",
  description: "The social network for tennis players. Connect, play, and share your tennis journey.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col bg-surface" suppressHydrationWarning>
        <PushRegistrar />
        <KeyboardInit />
        <Navbar />
        <main className="flex-1">{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
