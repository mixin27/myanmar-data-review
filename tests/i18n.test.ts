import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { translate, userMessage } from "../src/messages";
import myanmar from "../src/locales/my.json";

const root = join(import.meta.dirname, "..", "src");
// Developer-only invariants. They are never shown: userMessage() replaces
// any untranslated text with a written fallback.
const internal = new Set([
  "Parser already finished",
  "Duplicate cell identity.",
  "Invalid revision.",
  "Invalid local request.",
]);
// Text written into exported files, which stay in English by design.
const exported = new Set([
  "User-controlled review record. Not a tamper-proof audit or independent linguistic validation. Approved manual replacements retain original findings. Spreadsheet escaping changes field values; spreadsheet behavior varies and re-saving may remove protection.",
]);

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory())
      return name === "generated" ? [] : files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Sentence-like literals: what a person could read in the interface. */
function sentences() {
  const found: { text: string; at: string }[] = [];
  for (const path of files(root)) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      let text: string | undefined;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        text = node.text;
      else if (ts.isTemplateExpression(node))
        text =
          node.head.text +
          node.templateSpans
            .map((span, index) => `{${index}}${span.literal.text}`)
            .join("");
      if (
        text !== undefined &&
        !ts.isImportDeclaration(node.parent) &&
        /^[A-Z“]/.test(text) &&
        /\s/.test(text) &&
        /[.?!”]$/.test(text)
      ) {
        const line =
          source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        found.push({ text, at: `${relative(root, path)}:${line}` });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

describe("Myanmar interface coverage", () => {
  const all = sentences();

  it("finds the interface sentences", () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it("translates every interface sentence, including errors", () => {
    const missing = all
      .filter(({ text }) => !internal.has(text) && !exported.has(text))
      .filter(({ text }) => {
        const key = text.trim();
        return /\{\d+\}/.test(key)
          ? !(key in myanmar)
          : translate(key) === undefined;
      })
      .map(({ text, at }) => `${at} ${text}`);
    expect(missing).toEqual([]);
  });

  it("keeps internal invariant messages untranslated so they never show", () => {
    for (const text of internal) expect(translate(text)).toBeUndefined();
  });

  it("writes every translation in Myanmar script with matching placeholders", () => {
    for (const [key, value] of Object.entries(myanmar)) {
      expect(value.trim(), key).not.toBe("");
      // Names and punctuation (MyanLex, CSV UTF-8, "·") stay as written.
      if (value !== key) expect(value, key).toMatch(/[က-႟]/u);
      const placeholders = (text: string) =>
        (text.match(/\{\d+\}/g) ?? []).sort().join();
      expect(placeholders(value), key).toBe(placeholders(key));
    }
  });
});

describe("userMessage", () => {
  const fallback = "This action could not be completed.";

  it("keeps written messages and fills numbers into templates", () => {
    expect(
      userMessage(
        new Error("Close other tabs using this app, then try again."),
        fallback,
      ),
    ).toBe("Close other tabs using this app, then try again.");
    const limit = "Choose a CSV smaller than 10 MB.";
    expect(userMessage(new Error(limit), fallback)).toBe(limit);
    expect(translate(limit)).toContain("10");
  });

  it("replaces internal and browser exception text with the fallback", () => {
    expect(userMessage(new Error("Duplicate cell identity."), fallback)).toBe(
      fallback,
    );
    expect(
      userMessage(
        new DOMException("The quota has been exceeded.", "QuotaExceededError"),
        fallback,
      ),
    ).toBe(fallback);
    expect(userMessage(new TypeError("x is undefined"), fallback)).toBe(
      fallback,
    );
    expect(userMessage(undefined, fallback)).toBe(fallback);
  });
});
