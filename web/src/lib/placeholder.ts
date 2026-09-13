/**
 * Deterministic placeholder artwork derived from the artist name.
 * Pure helpers (no DOM) so they stay testable and cheap to render.
 */

/** Stable hue 0-359 for a string, so the same artist always gets one color. */
export function artistHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

/** One or two uppercase initials, or "?" when there is nothing to show. */
export function placeholderInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0 && !/^(the|a|an|and|&)$/i.test(w));
  const source = words.length > 0 ? words : name.trim().split(/\s+/).filter(Boolean);
  const letters = source.slice(0, 2).map((w) => w[0] ?? "");
  const initials = letters.join("").toUpperCase();
  return initials.length > 0 ? initials : "?";
}
