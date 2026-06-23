import type { TechdocConfig, HeadingChange, NumberingResult } from "./types";
import { formatValue, getFolderPrefix } from "./numbering-parser";

/**
 * Matches the number part of a heading we previously inserted.
 * A generated number consists of one or more segments (each either all-digits
 * or a single letter) joined by dots:  001  |  001.a  |  1.a.B.3  etc.
 * No minimum dot count — single-level numbers ("001", "a") are valid too.
 */
const NUMBER_SEGMENT_RE = /^(?:\d+|[a-z]|[A-Z])(?:\.(?:\d+|[a-z]|[A-Z]))*$/;

/**
 * Strip a previously inserted numbering prefix from heading text.
 *
 * The canonical format is "<number> - <title>".  We look for the first " - "
 * and check whether what precedes it is a generated number.  If so, the title
 * (everything after " - ") is returned; otherwise the text is unchanged.
 *
 * As a fallback, the old dot-separated-prefix-plus-space format is also
 * recognised so that headings produced before the separator was introduced
 * are cleaned up on the next refresh.
 */
function stripNumberPrefix(text: string): string {
  const sepIdx = text.indexOf(" - ");
  if (sepIdx !== -1) {
    const prefix = text.slice(0, sepIdx);
    if (NUMBER_SEGMENT_RE.test(prefix)) {
      return text.slice(sepIdx + 3); // skip " - "
    }
  }

  // Legacy fallback: "<number with at least one dot> <title>"
  const legacy = text.match(
    /^((?:\d+|[a-z]|[A-Z])(?:\.(?:\d+|[a-z]|[A-Z]))+) (.+)$/
  );
  return legacy ? legacy[2] : text;
}

/**
 * Build the full number string for a given set of counters.
 *
 * Each counter value is formatted according to its FormatPart descriptor and
 * all parts (including the optional folder prefix) are joined with ".".
 */
function buildNumberString(
  counters: number[],
  config: TechdocConfig,
  folderPrefix: string
): string {
  const parts: string[] = [];

  if (config.usesFolderPrefix && folderPrefix) {
    parts.push(folderPrefix);
  }

  for (let i = 0; i < counters.length; i++) {
    const fp = config.formatParts[i];
    parts.push(fp ? formatValue(counters[i], fp) : counters[i].toString());
  }

  return parts.join(".");
}

/**
 * Process all headings in `content`, adding or updating " - " separated
 * numbering prefixes.
 *
 * @param content  Full file content (including frontmatter).
 * @param config   Parsed TechdocConfig for this note.
 * @param filePath Vault-relative path to the note (used to derive folder prefix).
 */
export function processHeadings(
  content: string,
  config: TechdocConfig,
  filePath: string,
  skipLine?: number
): NumberingResult {
  const lines = content.split("\n");
  const folderPrefix = config.usesFolderPrefix ? getFolderPrefix(filePath) : "";

  // Find where frontmatter ends so we do not touch YAML headings.
  let bodyStart = 0;
  if (lines[0]?.trimEnd() === "---") {
    for (let i = 1; i < lines.length; i++) {
      const trimmed = lines[i].trimEnd();
      if (trimmed === "---" || trimmed === "...") {
        bodyStart = i + 1;
        break;
      }
    }
  }

  const numLevels = config.maxLevel - config.firstLevel + 1;

  // Each counter starts at (startNum - 1) because we increment before use.
  const counters = Array.from({ length: numLevels }, (_, i) =>
    (config.startNums[i] ?? 1) - 1
  );

  const changes: HeadingChange[] = [];
  const newLines = [...lines];
  let insideCodeBlock = false;

  for (let lineIdx = bodyStart; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    // Track fenced code blocks so we skip headings inside them.
    if (/^(`{3,}|~{3,})/.test(line)) {
      insideCodeBlock = !insideCodeBlock;
      continue;
    }
    if (insideCodeBlock) continue;

    const hm = line.match(/^(#{1,6}) (.+)$/);
    if (!hm) continue;

    const hashes = hm[1];
    const level = hashes.length;
    const rawText = hm[2];

    if (level < config.firstLevel || level > config.maxLevel) continue;

    const cleanTitle = stripNumberPrefix(rawText);
    const pos = level - config.firstLevel;

    // Increment current level counter; reset all deeper levels to (startNum - 1).
    counters[pos]++;
    for (let j = pos + 1; j < numLevels; j++) {
      counters[j] = (config.startNums[j] ?? 1) - 1;
    }

    // Option 1: reserve the counter slot but leave the line untouched while the
    // cursor is on it — the user may still be typing the heading title.
    if (lineIdx === skipLine) continue;

    const numberStr = buildNumberString(counters.slice(0, pos + 1), config, folderPrefix);
    // Canonical output: "<hashes> <number> - <title>"
    const newText = `${numberStr} - ${cleanTitle}`;
    const newLine = `${hashes} ${newText}`;

    if (newLine !== line) {
      changes.push({ oldText: rawText, newText, level, line: lineIdx });
      newLines[lineIdx] = newLine;
    }
  }

  return { newContent: newLines.join("\n"), changes };
}

/**
 * Parse frontmatter YAML and return the raw value for `techdoc-numbering`.
 * Returns null when the property is absent.
 */
export function readTechdocProperty(content: string): string | null {
  const lines = content.split("\n");
  if (lines[0]?.trimEnd() !== "---") return null;

  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trimEnd();
    if (trimmed === "---" || trimmed === "...") break;

    const m = lines[i].match(/^techdoc-numbering\s*:\s*(.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}
