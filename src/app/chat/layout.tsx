import ChatDesktopShell from "@/components/chat/ChatDesktopShell";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <ChatDesktopShell>{children}</ChatDesktopShell>;
}
