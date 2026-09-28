/**
 * A database or network error in words a social worker can act on. Our own
 * functions already raise plain sentences ("Bed B6 is taken", "Room 1 is a
 * women's room now"); those pass through. Postgres and PostgREST wording
 * does not, so the usual ones are translated. Pure: tests/ runs it directly.
 */
const KNOWN: [RegExp, string][] = [
  [/failed to fetch|networkerror|network request failed|load failed/i, "No connection. Check the internet and try again."],
  [/jwt expired|invalid jwt|not signed in|auth session missing/i, "You were signed out. Sign in again, then try once more."],
  [/row-level security|permission denied|not allowed to|42501/i, "You don't have permission to do this. Ask an admin if you should."],
  [/duplicate key value|already exists|23505/i, "This was already saved, or is taken by someone else. Refresh to see the latest."],
  [/violates foreign key/i, "Something this depends on was changed or removed. Refresh and try again."],
  [/violates check constraint|violates not-null/i, "A value isn't allowed here. Check the form and try again."],
  [/statement timeout|canceling statement|timeout/i, "The server took too long. Try again in a moment."],
];

export function plainError(message: string | null | undefined): string {
  const text = (message ?? "").trim();
  if (!text) return "Something went wrong. Try again.";
  for (const [pattern, plain] of KNOWN) if (pattern.test(text)) return plain;
  // Our own sentences (and anything unrecognised) as they are, without SQL noise.
  return text.replace(/^(error:\s*)/i, "").replace(/\s*\(SQLSTATE [0-9A-Z]{5}\)$/, "");
}
