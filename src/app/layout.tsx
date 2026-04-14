import type { Metadata, Viewport } from "next";
import "./globals.css";
import SessionProvider from "@/components/SessionProvider";
import Navbar from "@/components/Navbar";
import BottomNav from "@/components/BottomNav";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
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
      <body className="min-h-full flex flex-col bg-surface">
        <SessionProvider>
          <Navbar />
          <main className="flex-1">{children}</main>
          <BottomNav />
        </SessionProvider>
      </body>
    </html>
  );
}
