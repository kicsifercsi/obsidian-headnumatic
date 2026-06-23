import type { FormatPart, FormatPartType, TechdocConfig } from "./types";

export type { TechdocConfig };

/**
 * Parse the value of the `techdoc-numbering` frontmatter property.
 * Returns null when the value is missing or no format is specified.
 *
 * Expected value format (comma-separated tokens):
 *   auto-refresh, first-level 3, max-level 6, format ?.001.a.A.1, start-values ?.1.c.D.4
 */
export function parseTechdocConfig(rawValue: unknown): TechdocConfig | null {
  if (!rawValue) return null;

  // Obsidian may give us the YAML value as an array when the user writes a YAML list.
  const raw = Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue);

  const config: TechdocConfig = {
    autoRefresh: false,
    firstLevel: 1,
    maxLevel: 6,
    format: "",
    startValues: null,
    usesFolderPrefix: false,
    formatParts: [],
    startNums: [],
  };

  const tokens = raw.split(/,\s*/);
  for (const token of tokens) {
    const t = token.trim();
    if (t === "auto-refresh") {
      config.autoRefresh = true;
    } else if (t.startsWith("first-level ")) {
      const n = parseInt(t.slice("first-level ".length), 10);
      if (!isNaN(n) && n >= 1 && n <= 6) config.firstLevel = n;
    } else if (t.startsWith("max-level ")) {
      const n = parseInt(t.slice("max-level ".length), 10);
      if (!isNaN(n) && n >= 1) config.maxLevel = n;
    } else if (t.startsWith("format ")) {
      config.format = t.slice("format ".length).trim();
    } else if (t.startsWith("start-values ")) {
      config.startValues = t.slice("start-values ".length).trim();
    }
  }

  if (!config.format) return null;
  if (config.firstLevel > config.maxLevel) return null;

  const { parts, usesFolderPrefix } = parseFormatString(config.format);
  config.formatParts = parts;
  config.usesFolderPrefix = usesFolderPrefix;
  config.startNums = parseStartNums(config.startValues, parts);

  // Pad formatParts and startNums to cover every level implied by max-level.
  const numLevels = Math.max(0, config.maxLevel - config.firstLevel + 1);
  while (config.formatParts.length < numLevels) {
    config.formatParts.push({ type: "plain", digits: 1 });
  }
  while (config.startNums.length < numLevels) {
    config.startNums.push(null);
  }

  return config;
}

function parseFormatString(
  format: string
): { parts: FormatPart[]; usesFolderPrefix: boolean } {
  const segments = format.split(".");
  const parts: FormatPart[] = [];
  let usesFolderPrefix = false;

  for (const seg of segments) {
    if (seg === "?") {
      usesFolderPrefix = true;
    } else if (/^\d+$/.test(seg)) {
      if (seg.length > 1) {
        parts.push({ type: "zeros", digits: seg.length });
      } else {
        parts.push({ type: "plain", digits: 1 });
      }
    } else if (/^[a-z]+$/.test(seg)) {
      parts.push({ type: "lower", digits: 1 });
    } else if (/^[A-Z]+$/.test(seg)) {
      parts.push({ type: "upper", digits: 1 });
    }
    // Unknown segments are silently ignored.
  }

  return { parts, usesFolderPrefix };
}

function parseStartNums(
  startValues: string | null,
  formatParts: FormatPart[]
): (number | null)[] {
  if (!startValues) return formatParts.map(() => null);

  const segments = startValues.split(".").filter((s) => s !== "?");

  return formatParts.map((part, i) => {
    if (i >= segments.length) return null;
    const seg = segments[i];

    switch (part.type) {
      case "zeros":
      case "plain": {
        const n = parseInt(seg, 10);
        return isNaN(n) ? null : n;
      }
      case "lower":
        return /^[a-z]$/.test(seg)
          ? seg.charCodeAt(0) - "a".charCodeAt(0) + 1
          : null;
      case "upper":
        return /^[A-Z]$/.test(seg)
          ? seg.charCodeAt(0) - "A".charCodeAt(0) + 1
          : null;
    }
  });
}

/** Format a counter value according to a FormatPart descriptor. */
export function formatValue(value: number, part: FormatPart): string {
  switch (part.type) {
    case "zeros":
      return value.toString().padStart(part.digits, "0");
    case "plain":
      return value.toString();
    case "lower":
      return String.fromCharCode("a".charCodeAt(0) + ((value - 1) % 26));
    case "upper":
      return String.fromCharCode("A".charCodeAt(0) + ((value - 1) % 26));
  }
}

/**
 * Derive the folder-prefix portion of the heading number from a file path.
 * Both containing folder names and the note's own filename are examined;
 * any segment that matches /^\d+_/ contributes its numeric prefix.
 *
 * Example: "001_Chapter/002_Section/003_Note.md" → "001.002.003"
 */
export function getFolderPrefix(filePath: string): string {
  const segments = filePath.split("/");

  // Strip .md (or any extension) from the filename so the regex works on it too.
  const filename = segments[segments.length - 1].replace(/\.[^.]+$/, "");
  segments[segments.length - 1] = filename;

  const nums: string[] = [];
  for (const seg of segments) {
    const m = seg.match(/^(\d+)_/);
    if (m) nums.push(m[1]);
  }

  return nums.join(".");
}
