import ChatDesktopShell from "@/components/chat/ChatDesktopShell";

export const dynamic = "force-dynamic";
export const dynamicParams = true;

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ChatDesktopShell>{children}</ChatDesktopShell>;
}
