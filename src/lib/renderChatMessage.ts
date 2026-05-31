import { createElement, type ReactNode } from "react";
import Link from "next/link";

/**
 * Tiny safe markdown-link renderer for chat-message bubbles.
 *
 * Today the only source of links is the create_session_chat_on_complete
 * trigger, which embeds a "[Court Name](/courts?selected=tf-N)" when the
 * find_players post has a resolved court_facility_id. This helper keeps
 * the existing plain-text rendering for everything else and only emits
 * an actual link when the `(href)` portion is an internal path (starts
 * with "/"). External URLs are rendered as plain text on purpose — the
 * trigger never emits them, and refusing to render arbitrary http(s)
 * links closes the obvious phishing vector if a future code path ever
 * persists user-supplied content with `[click here](https://evil)`.
 *
 * The pattern is intentionally minimal: `[label](url)`. No nesting, no
 * escaping, no images, no autolinks. If we ever need richer formatting
 * we should add a real markdown library, not extend this regex.
 *
 * Uses React.createElement so the file stays plain TypeScript and works
 * under vitest's default esbuild config (the project's tsconfig sets
 * `jsx: "preserve"` for Next, which vitest can't pick up).
 */
const LINK_RE = /\[([^\]]+)\]\((\/[^\s)]*)\)/g;

export function renderChatMessage(content: string): ReactNode[] {
  if (!content) return [];
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  // Reset the regex's lastIndex so callers can't poison it across runs.
  LINK_RE.lastIndex = 0;
  while ((match = LINK_RE.exec(content)) !== null) {
    const [whole, label, href] = match;
    if (match.index > lastIndex) {
      nodes.push(content.slice(lastIndex, match.index));
    }
    nodes.push(
      createElement(
        Link,
        {
          key: `l${key++}`,
          href,
          className: "underline decoration-current/40 hover:decoration-current",
        },
        label
      )
    );
    lastIndex = match.index + whole.length;
  }
  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }
  return nodes;
}
