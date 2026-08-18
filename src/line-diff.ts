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

/**
 * Find an edit that inserts text at exactly `line`/`ch` without removing
 * anything.
 *
 * CodeMirror maps a collapsed selection sitting on such a point to the *start*
 * of the insertion, which leaves the cursor in front of the text just added.
 * For a heading numbered while the cursor sat at the start of its title, that
 * would put the next keystroke before the number ("## abc001.002.1 - Title").
 * Callers use this to detect the case and move the cursor past the insertion,
 * which is where the title — and so the cursor — still belongs.
 *
 * Every other cursor position is mapped correctly by CodeMirror on its own:
 * before the edit it does not move, after it, it shifts by the length delta.
 */
export function insertionAtCursor(
  edits: LineEdit[],
  line: number,
  ch: number
): LineEdit | undefined {
  return edits.find((e) => e.line === line && e.from === e.to && e.from === ch);
}
