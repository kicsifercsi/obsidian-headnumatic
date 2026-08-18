/** A single minimal in-line replacement, in editor coordinates. */
export interface LineEdit {
  /** 0-indexed line number. */
  line: number;
  /** First column that differs. */
  from: number;
  /** Column just past the last differing character, in the OLD line. */
  to: number;
  /** Replacement text for [from, to). */
  text: string;
}

/**
 * Compute the edits that turn `oldContent` into `newContent`, one per changed
 * line, narrowed to the span that actually differs.
 *
 * Narrowing matters for the cursor. CodeMirror maps a collapsed selection that
 * falls *inside* a replaced range to the range's start, and only a selection
 * sitting exactly on the range's end boundary is carried to the end of the
 * inserted text. Replacing a heading line as a whole therefore dropped the
 * cursor at column 0 for every position except the very end of the line.
 * Replacing only the differing span — for a renumbering, just the number —
 * leaves the cursor outside the replaced range, so CodeMirror shifts it by the
 * length delta and it keeps its place in the title.
 *
 * Edits are returned bottom-to-top so a caller applying them in order never
 * works from a line index it has already invalidated.
 */
export function computeLineEdits(oldContent: string, newContent: string): LineEdit[] {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const edits: LineEdit[] = [];

  for (let i = newLines.length - 1; i >= 0; i--) {
    const oldLine = oldLines[i] ?? "";
    const newLine = newLines[i];
    if (oldLine === newLine) continue;

    // Longest common prefix.
    const maxStart = Math.min(oldLine.length, newLine.length);
    let start = 0;
    while (start < maxStart && oldLine[start] === newLine[start]) start++;

    // Longest common suffix, without letting the two ends cross the prefix.
    let oldEnd = oldLine.length;
    let newEnd = newLine.length;
    while (
      oldEnd > start &&
      newEnd > start &&
      oldLine[oldEnd - 1] === newLine[newEnd - 1]
    ) {
      oldEnd--;
      newEnd--;
    }

    edits.push({ line: i, from: start, to: oldEnd, text: newLine.slice(start, newEnd) });
  }

  return edits;
}
