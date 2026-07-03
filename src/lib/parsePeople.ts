// Parse a captain's free-text roster input: one person per line, optionally
// "Name, contact" where contact is an email (has "@") or a phone otherwise.
// Shared by InvitePlayersPanel and SendRsvpPanel so the two stay in sync.

export interface ParsedPerson {
  name: string;
  email?: string;
  phone?: string;
}

export function parsePeopleLines(text: string): ParsedPerson[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): ParsedPerson => {
      const comma = line.indexOf(",");
      if (comma === -1) return { name: line };
      const name = line.slice(0, comma).trim();
      const contact = line.slice(comma + 1).trim();
      if (!contact) return { name };
      return contact.includes("@")
        ? { name, email: contact }
        : { name, phone: contact };
    })
    .filter((p) => p.name.length > 0);
}
