import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ChangeSet, Text } from "@codemirror/state";
import { computeLineEdits, insertionAtCursor } from "../src/line-diff";
import { parseHeadnumaticConfig } from "../src/numbering-parser";
import { processHeadings } from "../src/heading-engine";

// ---------------------------------------------------------------------------
// These tests drive the real CodeMirror state package — the same version
// Obsidian bundles — so the cursor assertions reflect how the editor actually
// maps a selection through the plugin's edits rather than a hand-rolled model.
//
// Each replaceRange in main.ts becomes one transaction, so the edits are
// applied here one ChangeSet at a time, mapping the cursor through each.
// ---------------------------------------------------------------------------

/** Apply the computed edits to `oldContent`, mapping a cursor as CodeMirror would. */
function applyWithCursor(
  oldContent: string,
  newContent: string,
  cursorLine: number,
  cursorCh: number
): { content: string; line: number; ch: number } {
  let doc = Text.of(oldContent.split("\n"));
  let pos = doc.line(cursorLine + 1).from + cursorCh;

  for (const edit of computeLineEdits(oldContent, newContent)) {
    const lineStart = doc.line(edit.line + 1).from;
    const changes = ChangeSet.of(
      [{ from: lineStart + edit.from, to: lineStart + edit.to, insert: edit.text }],
      doc.length
    );
    // -1 is the assoc CodeMirror uses when mapping a collapsed selection.
    pos = changes.mapPos(pos, -1);
    doc = changes.apply(doc);
  }

  const line = doc.lineAt(pos);
  return { content: doc.toString(), line: line.number - 1, ch: pos - line.from };
}

const FRONTMATTER = [
  "---",
  "headnumatic-numbering: first-level 2, max-level 4, format ?.1.a.1",
  "---",
  "",
];

const PATH = "001_Chap/002_Note.md";

/** Renumber `content` the way the plugin does, without skipping any line. */
function renumber(content: string): string {
  const config = parseHeadnumaticConfig(
    "first-level 2, max-level 4, format ?.1.a.1"
  )!;
  return processHeadings(content, config, PATH).newContent;
}

// ---------------------------------------------------------------------------

describe("tests/line-diff.test.ts", () => {
  test("TEST 1 – a renumbered line only replaces the number, not the whole line", () => {
    const oldContent = "## 001.002.1 - Alpha";
    const newContent = "## 001.002.2 - Alpha";

    const edits = computeLineEdits(oldContent, newContent);

    assert.equal(edits.length, 1);
    assert.deepEqual(edits[0], { line: 0, from: 11, to: 12, text: "2" });
  });

  test("TEST 2 – cursor keeps its place in the title at every heading level", () => {
    // A note whose headings all need renumbering: every level's counter starts
    // one higher than what is written, so each heading line changes.
    const stale = [
      ...FRONTMATTER,
      "# Doc",
      "",
      "## 001.002.9 - Alpha",
      "",
      "### 001.002.9.z - Beta",
      "",
      "#### 001.002.9.z.9 - Gamma",
      "",
    ].join("\n");

    const renumbered = renumber(stale);

    // Sanity: all three headings really are rewritten by this fixture.
    assert.match(renumbered, /## 001\.002\.1 - Alpha/);
    assert.match(renumbered, /### 001\.002\.1\.a - Beta/);
    assert.match(renumbered, /#### 001\.002\.1\.a\.1 - Gamma/);

    // line 6 is the level-2 heading (== first-level), 8 is level 3, 10 is level 4.
    for (const [line, title] of [
      [6, "Alpha"],
      [8, "Beta"],
      [10, "Gamma"],
    ] as Array<[number, string]>) {
      const text = stale.split("\n")[line];

      // Cursor in the middle of the title — the case that used to collapse to
      // column 0 because the whole line was replaced.
      const midCh = text.length - 2;
      const mid = applyWithCursor(stale, renumbered, line, midCh);
      assert.equal(mid.line, line, `${title}: cursor stayed on its line`);
      assert.equal(
        mid.content.split("\n")[line].slice(mid.ch - 3, mid.ch),
        text.slice(midCh - 3, midCh),
        `${title}: cursor kept the same text behind it`
      );

      // Cursor at the end of the line.
      const end = applyWithCursor(stale, renumbered, line, text.length);
      assert.equal(end.line, line, `${title}: end-of-line cursor stayed on its line`);
      assert.equal(
        end.ch,
        renumbered.split("\n")[line].length,
        `${title}: end-of-line cursor stayed at the end`
      );
    }
  });

  test("TEST 3 – level 2 and level 3 shift the cursor by the same rule", () => {
    // The old whole-line replace made the outcome depend on where in the line the
    // cursor sat; the number's own width must not matter either. Both headings
    // below grow by exactly the same amount, so the cursor offset must move
    // identically for both.
    const stale = [...FRONTMATTER, "## Alpha", "### Beta", ""].join("\n");
    const renumbered = renumber(stale);

    const lvl2 = applyWithCursor(stale, renumbered, 4, "## Alph".length);
    const lvl3 = applyWithCursor(stale, renumbered, 5, "### Bet".length);

    // "001.002.1 - " and "001.002.1.a - " are inserted after the hashes.
    assert.equal(lvl2.ch, "## 001.002.1 - Alph".length);
    assert.equal(lvl3.ch, "### 001.002.1.a - Bet".length);
    assert.equal(lvl2.line, 4);
    assert.equal(lvl3.line, 5);
  });

  test("TEST 4 – a cursor before the changed span is left untouched", () => {
    const oldContent = "## 001.002.9 - Alpha";
    const newContent = "## 001.002.1 - Alpha";

    // Cursor sits in the hashes, before the digit that changes.
    const res = applyWithCursor(oldContent, newContent, 0, 2);
    assert.equal(res.ch, 2);
    assert.equal(res.content, newContent);
  });

  test("TEST 5 – edits are ordered bottom-to-top", () => {
    const oldContent = ["## a", "## b", "## c"].join("\n");
    const newContent = ["## x", "## y", "## z"].join("\n");

    const edits = computeLineEdits(oldContent, newContent);
    assert.deepEqual(
      edits.map((e) => e.line),
      [2, 1, 0]
    );
  });

  test("TEST 6 – identical content produces no edits", () => {
    const content = ["## 001.002.1 - Alpha", "text"].join("\n");
    assert.deepEqual(computeLineEdits(content, content), []);
  });

  test("TEST 7 – a pure insertion is a zero-width replacement", () => {
    // "## Alpha" -> "## 001.002.1 - Alpha": nothing is deleted, so a cursor
    // anywhere in the title must simply shift right.
    const edits = computeLineEdits("## Alpha", "## 001.002.1 - Alpha");
    assert.equal(edits.length, 1);
    assert.equal(edits[0].from, edits[0].to, "no characters are removed");
    assert.equal(edits[0].from, 3);
    assert.equal(edits[0].text, "001.002.1 - ");
  });
  test("TEST 8 – the cursor at the start of a title is found as an insert point", () => {
    // Numbering "## Alpha" inserts at ch 3, right where the title begins. A
    // cursor parked there must be reported so the caller can move it past the
    // number — otherwise the next keystroke lands in front of it.
    const edits = computeLineEdits("## Alpha", "## 001.002.1 - Alpha");

    const hit = insertionAtCursor(edits, 0, 3);
    assert.ok(hit, "cursor at the title start sits on the insertion");
    assert.equal(hit!.text, "001.002.1 - ");

    // The nudged position is where the title now starts.
    assert.equal(3 + hit!.text.length, "## 001.002.1 - ".length);
  });

  test("TEST 9 – no other cursor position needs nudging", () => {
    const edits = computeLineEdits("## Alpha", "## 001.002.1 - Alpha");

    // Before the insertion, and anywhere inside or after the title.
    for (const ch of [0, 1, 2, 4, 5, 8]) {
      assert.equal(
        insertionAtCursor(edits, 0, ch),
        undefined,
        `ch ${ch} must be left to CodeMirror`
      );
    }

    // A different line never matches either.
    assert.equal(insertionAtCursor(edits, 1, 3), undefined);
  });

  test("TEST 10 – a replacement is never treated as an insert point", () => {
    // "001.002.9" -> "001.002.1" removes a character, so CodeMirror maps the
    // cursor correctly on its own and nudging would double-count.
    const edits = computeLineEdits("## 001.002.9 - Alpha", "## 001.002.1 - Alpha");

    assert.equal(edits[0].from, 11);
    assert.notEqual(edits[0].from, edits[0].to, "this edit deletes a character");
    assert.equal(insertionAtCursor(edits, 0, 11), undefined);
  });

});
