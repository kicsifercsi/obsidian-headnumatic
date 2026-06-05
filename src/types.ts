export type FormatPartType = "zeros" | "plain" | "lower" | "upper";

export interface FormatPart {
  type: FormatPartType;
  /** Number of digits for zero-padding (only relevant for "zeros" type). */
  digits: number;
}

export interface TechdocConfig {
  autoRefresh: boolean;
  /** Heading level at which numbering starts (1–6). Spec says > 1 is valid, but we accept 1 too. */
  firstLevel: number;
  /** Heading level at which numbering stops (1–6). */
  maxLevel: number;
  /** Raw format string from the property (e.g. "?.001.a.A.1"). */
  format: string;
  /** Raw start-values string, or null. */
  startValues: string | null;
  /** Whether the format string begins with "?". */
  usesFolderPrefix: boolean;
  /** Parsed level format descriptors (one per numbered heading level). */
  formatParts: FormatPart[];
  /** Starting counter value for each level (null means start at 1). */
  startNums: (number | null)[];
}

export interface HeadingChange {
  /** Full heading text as it appeared before renumbering (everything after the "#" chars and space). */
  oldText: string;
  /** Full heading text after renumbering. */
  newText: string;
  /** Markdown heading level (1–6). */
  level: number;
  /** 0-indexed line number in the file. */
  line: number;
}

export interface NumberingResult {
  newContent: string;
  changes: HeadingChange[];
}
