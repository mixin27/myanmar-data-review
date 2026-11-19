import myanmar from "./locales/my.json";

const messages: Readonly<Record<string, string>> = myanmar;

// Keys with positional placeholders ({0}, {1}, …) translate messages that
// contain numbers, such as limits or record widths.
const templates = Object.entries(messages)
  .filter(([key]) => /\{\d+\}/.test(key))
  .map(([key, value]) => ({
    pattern: new RegExp(
      `^${key
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\\\{(\d+)\\\}/g, "(?<p$1>[^\\s]+?)")}$`,
      "u",
    ),
    value,
  }));

/** The Myanmar text for an English interface message, or undefined. */
export function translate(text: string): string | undefined {
  const exact = messages[text];
  if (exact !== undefined) return exact;
  for (const { pattern, value } of templates) {
    const match = pattern.exec(text);
    if (match)
      return value.replace(
        /\{(\d+)\}/g,
        (_, index: string) => match.groups?.[`p${index}`] ?? "",
      );
  }
  return undefined;
}

/**
 * A message is shown to people only when it is written for them, which the
 * product defines as having a translation. Internal errors and browser
 * exception text become the caller's fallback instead.
 */
export function userMessage(error: unknown, fallback: string): string {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return translate(text) === undefined ? fallback : text;
}
