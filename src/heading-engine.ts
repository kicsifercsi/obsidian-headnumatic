import type {
  HeadnumaticConfig,
  HeadingChange,
  HeadingEntry,
  NumberingResult,
} from "./types";
import { formatValue, getFolderPrefix } from "./numbering-parser";

function findBodyStart(lines: string[]): number {
  if (lines[0]?.trimEnd() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trimEnd();
    if (t === "---" || t === "...") return i + 1;
  }
  return 0;
}

/**
 * Matches the number part of a heading we previously inserted.
 * A generated number consists of one or more segments (each either all-digits
 * or a single letter) joined by dots:  001  |  001.a  |  1.a.B.3  etc.
 * No minimum dot count — single-level numbers ("001", "a") are valid too.
 *
 * A trailing run of symbols is allowed so that a format suffix ("?.1.1.1:" →
 * "1.1.1:") is stripped again on the next pass instead of being mistaken for
 * part of the title, which would make the number accumulate on every refresh.
 * The run deliberately excludes letters, digits and "_": without that, "v1.2.3"
 * in "v1.2.3 - Release notes" would parse as the single letter "v" plus a
 * suffix and the version would be eaten off the title.
 */
const NUMBER_SEGMENT_RE =
  /^(?:\d+|[a-z]|[A-Z])(?:\.(?:\d+|[a-z]|[A-Z]))*[^\s\w]*$/;

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
 * all parts (including the optional folder prefix) are joined with ".".  Any
 * literal suffix from the format value is appended to the result, so a format
 * of "?.1.1.1:" numbers the third level as "02.01.1.1.1:".
 */
function buildNumberString(
  counters: number[],
  config: HeadnumaticConfig,
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

  return parts.join(".") + config.formatSuffix;
}

/**
 * Process all headings in `content`, adding or updating " - " separated
 * numbering prefixes.
 *
 * @param content  Full file content (including frontmatter).
 * @param config   Parsed HeadnumaticConfig for this note.
 * @param filePath Vault-relative path to the note (used to derive folder prefix).
 */
export function processHeadings(
  content: string,
  config: HeadnumaticConfig,
  filePath: string,
  skipLine?: number
): NumberingResult {
  const lines = content.split("\n");
  const folderPrefix = config.usesFolderPrefix ? getFolderPrefix(filePath) : "";
  const bodyStart = findBodyStart(lines);

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
 * Extract every markdown heading from `content` (skipping frontmatter and
 * fenced code blocks) as an ordered list of {level, text, line} entries.
 *
 * This is the building block for the heading snapshot the plugin keeps per
 * file: it records what each heading's text is right now, which is what links
 * elsewhere in the vault currently point to.
 */
export function parseHeadings(content: string): HeadingEntry[] {
  const lines = content.split("\n");
  const bodyStart = findBodyStart(lines);
  const headings: HeadingEntry[] = [];
  let insideCodeBlock = false;

  for (let lineIdx = bodyStart; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    if (/^(`{3,}|~{3,})/.test(line)) {
      insideCodeBlock = !insideCodeBlock;
      continue;
    }
    if (insideCodeBlock) continue;

    const hm = line.match(/^(#{1,6}) (.+)$/);
    if (!hm) continue;

    headings.push({ level: hm[1].length, text: hm[2], line: lineIdx });
  }

  return headings;
}

/** Stable identity key for alignment: level + title with numbering stripped. */
function headingKey(entry: HeadingEntry): string {
  return `${entry.level}\0${stripNumberPrefix(entry.text)}`;
}

/**
 * Longest-common-subsequence alignment between two key arrays.
 * Returns the matched index pairs [oldIdx, newIdx] in increasing order.
 */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * Diff a previous heading snapshot against the current headings and return the
 * old→new text mappings needed to rewrite links across the vault.
 *
 * Headings are aligned by their numbering-stripped title (via an LCS), so
 * inserting or removing a heading does not throw off the alignment of the rest:
 *   - Aligned headings whose full text differs  → renumbering (title unchanged).
 *   - Headings left unaligned between two anchors are paired positionally  →
 *     title renames (number unchanged or changed).
 *   - Any leftover old heading is a deletion and any leftover new heading is an
 *     insertion; neither produces a mapping.
 *
 * Unlike a line-index comparison, this is robust to lines being added or removed
 * above a changed heading, and it does not depend on any on-disk state.
 */
export function diffHeadings(
  oldHeadings: HeadingEntry[],
  newHeadings: HeadingEntry[]
): HeadingChange[] {
  const changes: HeadingChange[] = [];

  const matches = lcsPairs(
    oldHeadings.map(headingKey),
    newHeadings.map(headingKey)
  );

  let oi = 0;
  let nj = 0;

  const recordIfChanged = (o: HeadingEntry, n: HeadingEntry) => {
    if (o.text !== n.text) {
      changes.push({
        oldText: o.text,
        newText: n.text,
        level: n.level,
        line: n.line,
      });
    }
  };

  // Pair the unaligned runs [oi, oEnd) and [nj, nEnd) positionally.
  const flushGap = (oEnd: number, nEnd: number) => {
    const count = Math.min(oEnd - oi, nEnd - nj);
    for (let k = 0; k < count; k++) {
      recordIfChanged(oldHeadings[oi + k], newHeadings[nj + k]);
    }
    oi = oEnd;
    nj = nEnd;
  };

  for (const [mo, mn] of matches) {
    flushGap(mo, mn);
    recordIfChanged(oldHeadings[mo], newHeadings[mn]);
    oi = mo + 1;
    nj = mn + 1;
  }
  flushGap(oldHeadings.length, newHeadings.length);

  return changes;
}

/**
 * Parse frontmatter YAML and return the raw value for `headnumatic-numbering`.
 * Returns null when the property is absent.
 */
export function readHeadnumaticProperty(content: string): string | null {
  const lines = content.split("\n");
  if (lines[0]?.trimEnd() !== "---") return null;

  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trimEnd();
    if (trimmed === "---" || trimmed === "...") break;

    const m = lines[i].match(/^headnumatic-numbering\s*:\s*(.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}
