import { test } from "node:test";
import assert from "node:assert/strict";
import { processHeadings } from "../src/heading-engine";
import { parseTechdocConfig } from "../src/numbering-parser";

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
  `techdoc-numbering: ${CONFIG_RAW}`,
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
  `techdoc-numbering: ${CONFIG_RAW}`,
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

test("TEST 1 – heading numbering with folder prefix and overflow level", () => {
  const config = parseTechdocConfig(CONFIG_RAW);
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
  `techdoc-numbering: ${CONFIG_RAW_2}`,
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
  `techdoc-numbering: ${CONFIG_RAW_2}`,
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
  const config = parseTechdocConfig(CONFIG_RAW_2);
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
  `techdoc-numbering: ${CONFIG_RAW_3}`,
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
  `techdoc-numbering: ${CONFIG_RAW_3}`,
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
  const config = parseTechdocConfig(CONFIG_RAW_3);
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
  `techdoc-numbering: ${CONFIG_RAW_4}`,
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
  `techdoc-numbering: ${CONFIG_RAW_4}`,
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
  const config = parseTechdocConfig(CONFIG_RAW_4);
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
  `techdoc-numbering: ${CONFIG_RAW_5}`,
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
  `techdoc-numbering: ${CONFIG_RAW_5}`,
  "---",
  "# first",                       // level 1 < first-level(2) — untouched
  "## 007.05.01 - second",
  "### 007.05.01.01 - third",
  "#### fourth",                   // level 4 > max-level(3) — untouched
  "##### fifth",                   // level 5 > max-level(3) — untouched
];

test("TEST 5 – headings beyond max-level are left unchanged", () => {
  const config = parseTechdocConfig(CONFIG_RAW_5);
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
