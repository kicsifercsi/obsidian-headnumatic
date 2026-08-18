import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { processHeadings, parseHeadings, diffHeadings } from "../src/heading-engine";
import { parseHeadnumaticConfig, validateHeadnumaticRaw } from "../src/numbering-parser";
import type { HeadingEntry } from "../src/types";

// Note: a comma is required between each directive. The original spec had
// "format ?.01.01.01 start-values ?.1.1.1" (no comma), which would cause
// start-values to be silently swallowed into the format token. The corrected
// config below matches the intended behaviour; since all start values are 1
// (the default) the expected outputs are identical either way.
const CONFIG_RAW =
  "auto-refresh, first-level 2, max-level 7, format ?.01.01.01, start-values ?.1.1.1";

const FILE_PATH = "007_watever/05_blah.md";

const INPUT = [
  "---",
  `headnumatic-numbering: ${CONFIG_RAW}`,
  "---",
  "# first",
  "## second",
  "### third",
  "### anotherthird",
  "#### fourth",
  "##### fifth",
  "## newsecond",
  "### newthird",
  "### newthirdplus",
].join("\n");

// prettier-ignore
const EXPECTED_LINES = [
  "---",
  `headnumatic-numbering: ${CONFIG_RAW}`,
  "---",
  "# first",                              // level 1 < first-level(2) — untouched
  "## 007.05.01 - second",
  "### 007.05.01.01 - third",
  "### 007.05.01.02 - anotherthird",
  "#### 007.05.01.02.01 - fourth",
  "##### 007.05.01.02.01.1 - fifth",      // level 5 has no format part → plain "1"
  "## 007.05.02 - newsecond",
  "### 007.05.02.01 - newthird",
  "### 007.05.02.02 - newthirdplus",
];

describe("tests/heading-engine.test.ts", () => {
  test("TEST 1 – heading numbering with folder prefix and overflow level", () => {
    const config = parseHeadnumaticConfig(CONFIG_RAW);
    if (!config) throw new Error("config should parse without error");
    assert.strictEqual(config.firstLevel, 2);
    assert.strictEqual(config.maxLevel, 7);
    assert.strictEqual(config.usesFolderPrefix, true);
    // 7 - 2 + 1 = 6 levels; format only defined 3 parts, so 3 extras are padded with {type:"plain"}.
    assert.deepStrictEqual(
      config.formatParts.map((p) => ({ type: p.type, digits: p.digits })),
      [
        { type: "zeros", digits: 2 },
        { type: "zeros", digits: 2 },
        { type: "zeros", digits: 2 },
        { type: "plain", digits: 1 },
        { type: "plain", digits: 1 },
        { type: "plain", digits: 1 },
      ]
    );
    // startNums padded to 6 entries; all null (default start = 1).
    assert.strictEqual(config.startNums.length, 6);
    assert.ok(config.startNums.every((n) => n === null || n === 1));

    const result = processHeadings(INPUT, config, FILE_PATH);
    const outputLines = result.newContent.split("\n");

    for (let i = 0; i < EXPECTED_LINES.length; i++) {
      assert.strictEqual(
        outputLines[i],
        EXPECTED_LINES[i],
        `line ${i + 1} mismatch`
      );
    }

    // Changes should have been recorded for every heading that received a number.
    assert.strictEqual(result.changes.length, 8, "8 headings should be numbered (TEST 1)");
  });

  // ---------------------------------------------------------------------------

  const CONFIG_RAW_2 =
    "auto-refresh, first-level 2, max-level 7, format ?.001.001.001.A, start-values ?.1.1.1.A";

  const FILE_PATH_2 = "1_watever/01_blah.md";

  const INPUT_2 = [
    "---",
    `headnumatic-numbering: ${CONFIG_RAW_2}`,
    "---",
    "# first",
    "## second",
    "### third",
    "### anotherthird",
    "#### fourth",
    "##### fifth",
    "## newsecond",
    "### newthird",
    "### newthirdplus",
  ].join("\n");

  // prettier-ignore
  const EXPECTED_LINES_2 = [
    "---",
    `headnumatic-numbering: ${CONFIG_RAW_2}`,
    "---",
    "# first",                                  // level 1 < first-level(2) — untouched
    "## 1.01.001 - second",                     // folder prefix "1.01" from 1_watever/01_blah
    "### 1.01.001.001 - third",
    "### 1.01.001.002 - anotherthird",
    "#### 1.01.001.002.001 - fourth",
    "##### 1.01.001.002.001.A - fifth",          // level 5 uses uppercase-letter format
    "## 1.01.002 - newsecond",
    "### 1.01.002.001 - newthird",
    "### 1.01.002.002 - newthirdplus",
  ];

  test("TEST 2 – uppercase-letter format part and mixed-digit folder prefix", () => {
    const config = parseHeadnumaticConfig(CONFIG_RAW_2);
    if (!config) throw new Error("config should parse without error");
    assert.strictEqual(config.firstLevel, 2);
    assert.strictEqual(config.maxLevel, 7);
    assert.strictEqual(config.usesFolderPrefix, true);
    // 4 format parts defined; padded to 6 (7-2+1) with {plain} defaults.
    assert.deepStrictEqual(
      config.formatParts.map((p) => ({ type: p.type, digits: p.digits })),
      [
        { type: "zeros", digits: 3 },
        { type: "zeros", digits: 3 },
        { type: "zeros", digits: 3 },
        { type: "upper", digits: 1 },
        { type: "plain", digits: 1 },
        { type: "plain", digits: 1 },
      ]
    );
    // start-values ?.1.1.1.A → all levels start at 1; padded slots are null (also 1).
    assert.deepStrictEqual(config.startNums, [1, 1, 1, 1, null, null]);

    const result = processHeadings(INPUT_2, config, FILE_PATH_2);
    const outputLines = result.newContent.split("\n");

    for (let i = 0; i < EXPECTED_LINES_2.length; i++) {
      assert.strictEqual(
        outputLines[i],
        EXPECTED_LINES_2[i],
        `line ${i + 1} mismatch`
      );
    }

    assert.strictEqual(result.changes.length, 8, "8 headings should be numbered (TEST 2)");
  });

  // ---------------------------------------------------------------------------

  const CONFIG_RAW_3 =
    "auto-refresh, first-level 1, max-level 7, format 1.01.001.a, start-values 2.3.4.a";

  const FILE_PATH_3 = "123_watever/001_blahblah.md";

  const INPUT_3 = [
    "---",
    `headnumatic-numbering: ${CONFIG_RAW_3}`,
    "---",
    "# first",
    "## second",
    "### third",
    "### anotherthird",
    "#### fourth",
    "##### fifth",
    "## newsecond",
    "### newthird",
    "### newthirdplus",
  ].join("\n");

  // prettier-ignore
  const EXPECTED_LINES_3 = [
    "---",
    `headnumatic-numbering: ${CONFIG_RAW_3}`,
    "---",
    "# 2 - first",          // first-level 1, starts at 2 per start-values
    "## 2.03 - second",     // starts at 3 per start-values → "03" (2-digit pad)
    "### 2.03.004 - third", // starts at 4 per start-values → "004" (3-digit pad)
    "### 2.03.005 - anotherthird",
    "#### 2.03.005.a - fourth",   // lowercase-letter format; starts at 'a' per start-values
    "##### 2.03.005.a.1 - fifth", // level 5: padded plain-number default
    "## 2.04 - newsecond",
    "### 2.04.004 - newthird",    // level-3 counter resets to start-value 4 on each new ##
    "### 2.04.005 - newthirdplus",
  ];

  test("TEST 3 – no folder prefix, non-default start-values, lowercase-letter format", () => {
    const config = parseHeadnumaticConfig(CONFIG_RAW_3);
    if (!config) throw new Error("config should parse without error");
    assert.strictEqual(config.firstLevel, 1);
    assert.strictEqual(config.maxLevel, 7);
    assert.strictEqual(config.usesFolderPrefix, false);
    // 4 format parts defined; padded to 7 (7-1+1) with {plain} defaults.
    assert.deepStrictEqual(
      config.formatParts.map((p) => ({ type: p.type, digits: p.digits })),
      [
        { type: "plain", digits: 1 },
        { type: "zeros", digits: 2 },
        { type: "zeros", digits: 3 },
        { type: "lower", digits: 1 },
        { type: "plain", digits: 1 },
        { type: "plain", digits: 1 },
        { type: "plain", digits: 1 },
      ]
    );
    // start-values 2.3.4.a → [2, 3, 4, 1]; padded slots are null (start at 1).
    assert.deepStrictEqual(config.startNums, [2, 3, 4, 1, null, null, null]);

    const result = processHeadings(INPUT_3, config, FILE_PATH_3);
    const outputLines = result.newContent.split("\n");

    for (let i = 0; i < EXPECTED_LINES_3.length; i++) {
      assert.strictEqual(
        outputLines[i],
        EXPECTED_LINES_3[i],
        `line ${i + 1} mismatch`
      );
    }

    // first-level 1, so all 9 headings receive a number.
    assert.strictEqual(result.changes.length, 9, "9 headings should be numbered (TEST 3)");
  });

  // ---------------------------------------------------------------------------

  const CONFIG_RAW_4 =
    "auto-refresh, first-level 2, max-level 7, format ?.01.A.1.a, start-values ?.1.A.1.a";

  const FILE_PATH_4 = "21_watever/11_blah.md";

  const INPUT_4 = [
    "---",
    `headnumatic-numbering: ${CONFIG_RAW_4}`,
    "---",
    "# first",
    "## second",
    "### third",
    "### anotherthird",
    "#### fourth",
    "##### fifth",
    "##### anotherfifth",
    "## newsecond",
    "### newthird",
    "### newthirdplus",
  ].join("\n");

  // prettier-ignore
  const EXPECTED_LINES_4 = [
    "---",
    `headnumatic-numbering: ${CONFIG_RAW_4}`,
    "---",
    "# first",                            // level 1 < first-level(2) — untouched
    "## 21.11.01 - second",
    "### 21.11.01.A - third",             // upper-letter starts at A
    "### 21.11.01.B - anotherthird",      // upper-letter increments to B
    "#### 21.11.01.B.1 - fourth",
    "##### 21.11.01.B.1.a - fifth",       // lower-letter starts at a
    "##### 21.11.01.B.1.b - anotherfifth",// lower-letter increments to b
    "## 21.11.02 - newsecond",
    "### 21.11.02.A - newthird",          // upper-letter resets to A after new ##
    "### 21.11.02.B - newthirdplus",
  ];

  test("TEST 4 – mixed upper/lower letter formats with counter reset", () => {
    const config = parseHeadnumaticConfig(CONFIG_RAW_4);
    if (!config) throw new Error("config should parse without error");
    assert.strictEqual(config.firstLevel, 2);
    assert.strictEqual(config.maxLevel, 7);
    assert.strictEqual(config.usesFolderPrefix, true);
    // 4 format parts defined; padded to 6 (7-2+1) with {plain} defaults.
    assert.deepStrictEqual(
      config.formatParts.map((p) => ({ type: p.type, digits: p.digits })),
      [
        { type: "zeros", digits: 2 },
        { type: "upper", digits: 1 },
        { type: "plain", digits: 1 },
        { type: "lower", digits: 1 },
        { type: "plain", digits: 1 },
        { type: "plain", digits: 1 },
      ]
    );
    // start-values ?.1.A.1.a → all levels start at 1; padded slots are null.
    assert.deepStrictEqual(config.startNums, [1, 1, 1, 1, null, null]);

    const result = processHeadings(INPUT_4, config, FILE_PATH_4);
    const outputLines = result.newContent.split("\n");

    for (let i = 0; i < EXPECTED_LINES_4.length; i++) {
      assert.strictEqual(
        outputLines[i],
        EXPECTED_LINES_4[i],
        `line ${i + 1} mismatch`
      );
    }

    // All headings except # first receive a number (9 total).
    assert.strictEqual(result.changes.length, 9, "9 headings should be numbered (TEST 4)");
  });

  // ---------------------------------------------------------------------------

  const CONFIG_RAW_5 =
    "auto-refresh, first-level 2, max-level 3, format ?.01.01.01.01.01, start-values ?.1.1.1.1.1";

  const FILE_PATH_5 = "007_watever/05_blah.md";

  const INPUT_5 = [
    "---",
    `headnumatic-numbering: ${CONFIG_RAW_5}`,
    "---",
    "# first",
    "## second",
    "### third",
    "#### fourth",
    "##### fifth",
  ].join("\n");

  // prettier-ignore
  const EXPECTED_LINES_5 = [
    "---",
    `headnumatic-numbering: ${CONFIG_RAW_5}`,
    "---",
    "# first",                       // level 1 < first-level(2) — untouched
    "## 007.05.01 - second",
    "### 007.05.01.01 - third",
    "#### fourth",                   // level 4 > max-level(3) — untouched
    "##### fifth",                   // level 5 > max-level(3) — untouched
  ];

  test("TEST 5 – headings beyond max-level are left unchanged", () => {
    const config = parseHeadnumaticConfig(CONFIG_RAW_5);
    if (!config) throw new Error("config should parse without error");
    assert.strictEqual(config.firstLevel, 2);
    assert.strictEqual(config.maxLevel, 3);
    assert.strictEqual(config.usesFolderPrefix, true);
    // format has 5 parts but max-level implies only 2 levels — no padding, no trimming.
    assert.strictEqual(config.formatParts.length, 5);
    assert.strictEqual(config.startNums.length, 5);

    const result = processHeadings(INPUT_5, config, FILE_PATH_5);
    const outputLines = result.newContent.split("\n");

    for (let i = 0; i < EXPECTED_LINES_5.length; i++) {
      assert.strictEqual(
        outputLines[i],
        EXPECTED_LINES_5[i],
        `line ${i + 1} mismatch`
      );
    }

    // Only ## and ### headings are within range — 2 changes.
    assert.strictEqual(result.changes.length, 2, "2 headings should be numbered (TEST 5)");
  });

  // ---------------------------------------------------------------------------

  // TEST 6 uses the malformed config string from the spec — the comma between
  // "format" and "start-values" is intentionally missing.  The purpose of the
  // test is twofold:
  //   1. Assert that validateHeadnumaticRaw catches it (returns false) so the plugin
  //      shows an error notice instead of silently producing wrong output.
  //   2. Document the wrong output the parser would produce if validation were
  //      bypassed: "01 start-values ?" is not a valid format segment so it is
  //      silently dropped, and the stray "1" segments become {plain,1} parts
  //      instead of {zeros,2} — causing #### headings to show "1" not "01".
  const CONFIG_RAW_6 =
    "auto-refresh, first-level 2, max-level 7, format ?.01.01.01 start-values ?.1.1.1";

  const FILE_PATH_6 = "mainb/blah.md";

  const INPUT_6 = [
    "---",
    `headnumatic-numbering: ${CONFIG_RAW_6}`,
    "---",
    "# first",
    "## one",
    "## two",
    "## three",
    "### threeone",
    "### threetwo",
    "#### threetwoone",
    "##### threetwooneone",
    "#### threetwotwo",
  ].join("\n");

  // These are the WRONG outputs produced when the malformed config is parsed
  // without validation.  Level-3 and deeper headings use {plain,1} instead of
  // {zeros,2} because the "01 start-values ?" segment was silently discarded and
  // the "1" segments that followed it became plain-integer format parts.
  // prettier-ignore
  const EXPECTED_LINES_6_BYPASSED = [
    "---",
    `headnumatic-numbering: ${CONFIG_RAW_6}`,
    "---",
    "# first",
    "## 01 - one",
    "## 02 - two",
    "## 03 - three",
    "### 03.01 - threeone",
    "### 03.02 - threetwo",
    "#### 03.02.1 - threetwoone",          // wrong: "1" instead of "01"
    "##### 03.02.1.1 - threetwooneone",    // wrong: "1.1" instead of "01.1"
    "#### 03.02.2 - threetwotwo",          // wrong: "2" instead of "02"
  ];

  test("TEST 6 – malformed config (missing comma) is caught by validateHeadnumaticRaw", () => {
    // Primary assertion: the validator must reject this config.
    assert.strictEqual(
      validateHeadnumaticRaw(CONFIG_RAW_6),
      false,
      "missing comma between format and start-values should fail validation"
    );

    // Secondary: document the broken parse result when validation is bypassed.
    // parseHeadnumaticConfig still returns a non-null config (it does not detect the
    // missing comma), but the format parts are wrong.
    const config = parseHeadnumaticConfig(CONFIG_RAW_6);
    if (!config) throw new Error("parseHeadnumaticConfig unexpectedly returned null");

    // The "01 start-values ?" segment is dropped; the three "1" trailing segments
    // become {plain,1} parts, giving only 2 {zeros,2} parts instead of 3.
    assert.deepStrictEqual(
      config.formatParts.slice(0, 3).map((p) => ({ type: p.type, digits: p.digits })),
      [
        { type: "zeros", digits: 2 },
        { type: "zeros", digits: 2 },
        { type: "plain", digits: 1 }, // ← should have been {zeros,2}
      ]
    );

    const result = processHeadings(INPUT_6, config, FILE_PATH_6);
    const outputLines = result.newContent.split("\n");

    for (let i = 0; i < EXPECTED_LINES_6_BYPASSED.length; i++) {
      assert.strictEqual(
        outputLines[i],
        EXPECTED_LINES_6_BYPASSED[i],
        `line ${i + 1} mismatch`
      );
    }
  });

  // ---------------------------------------------------------------------------
  // diffHeadings — old→new mappings that drive vault-wide link updates.
  // ---------------------------------------------------------------------------

  /** Parse headings from a body (frontmatter is prepended for realism). */
  function headings(body: string[]): HeadingEntry[] {
    return parseHeadings(["---", "headnumatic-numbering: x", "---", ...body].join("\n"));
  }

  /** Collapse a diff to [oldText, newText] pairs for easy assertions. */
  function pairs(old: HeadingEntry[], next: HeadingEntry[]): Array<[string, string]> {
    return diffHeadings(old, next).map((c) => [c.oldText, c.newText]);
  }

  test("TEST 7 – diffHeadings: renumber after inserting a heading", () => {
    const old = headings(["# 001 - A", "# 002 - B"]);
    const next = headings(["# 001 - A", "# 002 - New", "# 003 - B"]);
    // A unchanged; "New" is an insertion (no mapping); B renumbered 002 → 003.
    assert.deepStrictEqual(pairs(old, next), [["002 - B", "003 - B"]]);
  });

  test("TEST 8 – diffHeadings: renumber after deleting a heading", () => {
    const old = headings(["# 001 - A", "# 002 - B", "# 003 - C"]);
    const next = headings(["# 001 - A", "# 002 - C"]);
    // B deleted (no mapping); C renumbered 003 → 002.
    assert.deepStrictEqual(pairs(old, next), [["003 - C", "002 - C"]]);
  });

  test("TEST 9 – diffHeadings: pure title rename (number unchanged)", () => {
    const old = headings(["# 001 - Intro"]);
    const next = headings(["# 001 - Introduction"]);
    assert.deepStrictEqual(pairs(old, next), [["001 - Intro", "001 - Introduction"]]);
  });

  test("TEST 10 – diffHeadings: title rename with a line inserted above it", () => {
    // The renamed heading sits on a different line index in the new content;
    // the old line-index comparison missed this, the LCS-based diff does not.
    const old = headings(["# 001 - Intro", "# 002 - Setup"]);
    const next = headings(["# 001 - Intro", "a new paragraph", "more text", "# 002 - Renamed"]);
    assert.deepStrictEqual(pairs(old, next), [["002 - Setup", "002 - Renamed"]]);
  });

  test("TEST 11 – diffHeadings: no change yields no mappings", () => {
    const same = ["# 001 - A", "## 001.01 - B", "# 002 - C"];
    assert.deepStrictEqual(pairs(headings(same), headings(same)), []);
  });

  test("TEST 12 – diffHeadings: simultaneous insert + renumber + rename", () => {
    const old = headings(["# 001 - Alpha", "# 002 - Beta"]);
    // Inserted "Gamma" at top pushes everything down; Beta also renamed.
    const next = headings(["# 001 - Gamma", "# 002 - Alpha", "# 003 - BetaPrime"]);
    // Alpha 001 → 002 (renumber); Beta → BetaPrime paired in the trailing gap.
    assert.deepStrictEqual(pairs(old, next), [
      ["001 - Alpha", "002 - Alpha"],
      ["002 - Beta", "003 - BetaPrime"],
    ]);
  });

  // -------------------------------------------------------------------------
  // Format suffix: anything after the last level format is appended literally
  // to every generated number.
  // -------------------------------------------------------------------------

  const SUFFIX_PATH = "02_Chapter/01_Section/Note.md";

  test("TEST 13 – a trailing symbol in the format is appended to every number", () => {
    const config = parseHeadnumaticConfig("format ?.1.1.1:")!;
    assert.strictEqual(config.formatSuffix, ":");

    const input = ["# One", "## Two", "### Three", "#### Four"].join("\n");
    const out = processHeadings(input, config, SUFFIX_PATH).newContent;

    assert.deepStrictEqual(out.split("\n"), [
      "# 02.01.1: - One",
      "## 02.01.1.1: - Two",
      "### 02.01.1.1.1: - Three",
      // Beyond the declared levels the counter still runs and keeps the suffix.
      "#### 02.01.1.1.1.1: - Four",
    ]);
  });

  test("TEST 14 – a suffixed number is stripped again, so it never accumulates", () => {
    const config = parseHeadnumaticConfig("format ?.1.1.1:")!;
    const input = ["# One", "## Two", "### Three"].join("\n");

    const once = processHeadings(input, config, SUFFIX_PATH).newContent;
    const twice = processHeadings(once, config, SUFFIX_PATH);

    assert.strictEqual(twice.newContent, once, "second pass must be a no-op");
    assert.deepStrictEqual(twice.changes, [], "a no-op pass reports no changes");
  });

  test("TEST 15 – a renumbering re-suffixes rather than nesting the old number", () => {
    const config = parseHeadnumaticConfig("format ?.1.1:")!;
    // Headings carrying stale numbers: the old suffixed number must be removed
    // before the new one is built.
    const stale = ["# 02.01.9: - One", "## 02.01.9.9: - Two"].join("\n");
    const out = processHeadings(stale, config, SUFFIX_PATH).newContent;

    assert.deepStrictEqual(out.split("\n"), [
      "# 02.01.1: - One",
      "## 02.01.1.1: - Two",
    ]);
  });

  test("TEST 16 – assorted suffixes are appended and round-trip", () => {
    for (const [format, expected] of [
      ["?.001.a)", "# 7.001) - A"],
      ["?.001.a.)", "# 7.001.) - A"], // the "." before ")" is part of the suffix
      ["1.1|", "# 1| - A"],
      ["1.1=>", "# 1=> - A"], // multi-character suffix
    ] as Array<[string, string]>) {
      const config = parseHeadnumaticConfig(`format ${format}`)!;
      const out = processHeadings("# A", config, "7_x/Note.md").newContent;
      assert.strictEqual(out, expected, `format ${format}`);

      // Every suffix must round-trip, or numbers would grow on each refresh.
      assert.strictEqual(
        processHeadings(out, config, "7_x/Note.md").newContent,
        out,
        `format ${format} is not idempotent`
      );
    }
  });

  test("TEST 17 – start-values may carry the same suffix as the format", () => {
    const withSuffix = parseHeadnumaticConfig(
      "format ?.1.1:, start-values ?.3.5:"
    )!;
    const without = parseHeadnumaticConfig("format ?.1.1, start-values ?.3.5")!;

    // The suffix must not disturb how the start values are read.
    assert.deepStrictEqual(
      withSuffix.startNums.slice(0, 2),
      without.startNums.slice(0, 2)
    );

    const out = processHeadings(["# One", "## Two"].join("\n"), withSuffix, SUFFIX_PATH)
      .newContent;
    assert.deepStrictEqual(out.split("\n"), [
      "# 02.01.3: - One",
      "## 02.01.3.5: - Two",
    ]);
  });

  test("TEST 18 – a suffix the stripper could not remove is refused", () => {
    // ":a" would be appended but not recognised again on the next pass, so the
    // number would nest on every refresh ("1:a - A" → "1:a - 1:a - A").
    // Such a value is not accepted as a suffix at all.
    for (const format of ["1.1:a", "1.1:2", "1.1_"]) {
      const config = parseHeadnumaticConfig(`format ${format}`)!;
      assert.strictEqual(config.formatSuffix, "", `format ${format}`);

      const once = processHeadings("# A", config, "Note.md").newContent;
      assert.strictEqual(
        processHeadings(once, config, "Note.md").newContent,
        once,
        `format ${format} must still be idempotent`
      );
    }
  });

  test("TEST 19 – a version-like title is not mistaken for a suffixed number", () => {
    // "v1.2.3" must not parse as the single letter "v" plus a symbol suffix,
    // which would strip the version off the title. This is why the suffix run
    // in NUMBER_SEGMENT_RE excludes letters and digits.
    const config = parseHeadnumaticConfig("format 1")!;
    const out = processHeadings("# v1.2.3 - Release notes", config, "Note.md")
      .newContent;

    assert.strictEqual(out, "# 1 - v1.2.3 - Release notes");
  });
});
