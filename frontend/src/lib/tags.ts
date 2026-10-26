/** Comma-separated tags as typed: trimmed, lower-case, without empty ones or repeats. */
export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}
