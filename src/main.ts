import {
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  Editor,
  MarkdownView,
} from "obsidian";

import { parseTechdocConfig, validateTechdocRaw, TechdocConfig } from "./numbering-parser";
import { processHeadings, readTechdocProperty, mergeHeadingChanges } from "./heading-engine";
import { updateHeadingLinks, updateLinksAfterRename } from "./link-updater";

const MALFORMED_NOTICE = "Malformed settings, check techdoc-number property!";

export default class TechDocHeadingNumbering extends Plugin {
  /** Debounce timers keyed by file path. */
  private refreshTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /** Last known cursor line per file, used to detect when the cursor leaves the settings line. */
  private prevCursorLines: Map<string, number> = new Map();

  /**
   * Set to true while we are programmatically writing to an editor so that
   * the resulting editor-change event does not re-trigger auto-refresh.
   */
  private applyingNumbering = false;

  async onload() {
    // -----------------------------------------------------------------------
    // Commands
    // -----------------------------------------------------------------------

    this.addCommand({
      id: "refresh-heading-numbers",
      name: "Refresh heading numbers in current note",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        if (view.file) {
          await this.refreshWithEditor(editor, view.file);
          new Notice("Heading numbers refreshed.");
        }
      },
    });

    this.addCommand({
      id: "refresh-all-heading-numbers",
      name: "Refresh heading numbers in all notes",
      callback: async () => {
        await this.refreshAll();
      },
    });

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    // Auto-refresh: pass both editor and file into the debounce closure so
    // the callback can update the editor directly 600 ms later.
    // Also check if the cursor has just left the settings line so we can
    // show the malformed-settings notice at the right moment.
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor: Editor, view: MarkdownView) => {
        if (this.applyingNumbering) return;
        if (!view.file) return;
        this.checkSettingsOnLeave(editor, view.file);
        this.scheduleAutoRefresh(editor, view.file);
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", async (file: TAbstractFile, oldPath: string) => {
        await this.handleRename(file, oldPath);
      })
    );
  }

  onunload() {
    for (const timer of this.refreshTimers.values()) clearTimeout(timer);
    this.refreshTimers.clear();
    this.prevCursorLines.clear();
  }

  // -------------------------------------------------------------------------
  // Settings validation on cursor leave
  // -------------------------------------------------------------------------

  /**
   * Called on every editor-change event. Tracks the cursor line; when the
   * cursor moves away from the `techdoc-numbering` frontmatter line, the
   * settings are validated and an error notice is shown if they are malformed.
   * This fires reliably whenever the user presses Enter, types on a new line,
   * or makes any content change after leaving the settings line.
   */
  private checkSettingsOnLeave(editor: Editor, file: TFile): void {
    const curLine = editor.getCursor().line;
    const prevLine = this.prevCursorLines.get(file.path);
    this.prevCursorLines.set(file.path, curLine);

    if (prevLine === undefined || prevLine === curLine) return;

    const content = editor.getValue();
    const lines = content.split("\n");
    if (!/^techdoc-numbering\s*:/.test(lines[prevLine] ?? "")) return;

    // Cursor just left the settings line — validate now.
    const rawProp = readTechdocProperty(content);
    if (!rawProp) return;
    if (!validateTechdocRaw(rawProp) || !parseTechdocConfig(rawProp)) {
      new Notice(MALFORMED_NOTICE);
    }
  }

  // -------------------------------------------------------------------------
  // Auto-refresh debounce
  // -------------------------------------------------------------------------

  private scheduleAutoRefresh(editor: Editor, file: TFile) {
    const existing = this.refreshTimers.get(file.path);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.refreshTimers.delete(file.path);
      try {
        // Always read from the editor — it holds the latest unsaved content.
        const content = editor.getValue();
        const rawProp = readTechdocProperty(content);
        if (!rawProp) return;

        // Malformed-settings feedback is handled by checkSettingsOnLeave;
        // silently skip here so the auto-refresh never spams notices.
        if (!validateTechdocRaw(rawProp)) return;

        const config = parseTechdocConfig(rawProp);
        if (!config?.autoRefresh) return;

        // Option 1: pass the cursor line so processHeadings skips it while typing.
        const cursorLine = editor.getCursor().line;
        await this.applyToEditor(editor, file, content, config, cursorLine);
      } catch (e) {
        console.error("[TechDoc Heading Numbering] auto-refresh error:", e);
      }
    }, 600);

    this.refreshTimers.set(file.path, timer);
  }

  // -------------------------------------------------------------------------
  // Core refresh helpers
  // -------------------------------------------------------------------------

  /**
   * Refresh heading numbers in the currently open editor.
   * Reads content from the editor itself (latest unsaved state) and writes
   * back via editor.setValue() for an immediate visual update.
   */
  private async refreshWithEditor(editor: Editor, file: TFile): Promise<void> {
    try {
      const content = editor.getValue();
      const rawProp = readTechdocProperty(content);
      if (!rawProp) {
        new Notice("No 'techdoc-numbering' property found in this note.");
        return;
      }

      if (!validateTechdocRaw(rawProp)) {
        new Notice(MALFORMED_NOTICE);
        return;
      }

      const config = parseTechdocConfig(rawProp);
      if (!config) {
        new Notice(MALFORMED_NOTICE);
        return;
      }

      await this.applyToEditor(editor, file, content, config);
    } catch (e) {
      console.error("[TechDoc Heading Numbering] refreshWithEditor error:", e);
      new Notice("Error refreshing heading numbers. Check the console for details.");
    }
  }

  /**
   * Apply computed heading numbering to an open editor.
   * Each changed line is updated with editor.replaceRange() so that
   * CodeMirror's own change-mapping keeps the cursor in the right place —
   * no manual cursor save/restore is needed.
   */
  private async applyToEditor(
    editor: Editor,
    file: TFile,
    content: string,
    config: TechdocConfig,
    skipLine?: number
  ): Promise<void> {
    const result = processHeadings(content, config, file.path, skipLine);

    // Read the on-disk content to detect title changes: processHeadings only
    // records a change when its output differs from the current editor line, so
    // a pure title rename (same number, different text) would be invisible to it.
    // mergeHeadingChanges adds those missing changes by comparing the saved
    // heading texts (what other files' links point to) with the new heading texts.
    const savedContent = await this.app.vault.read(file);
    const allChanges = mergeHeadingChanges(savedContent, result.newContent, result.changes);

    if (result.changes.length === 0 && allChanges.length === 0) return;

    // Apply changes bottom-to-top so earlier line indices stay valid while
    // iterating (replaceRange within a single line never shifts line numbers,
    // but the order is a cheap safety net).
    const sortedChanges = [...result.changes].sort((a, b) => b.line - a.line);

    // Guard against each replaceRange triggering another editor-change → debounce.
    this.applyingNumbering = true;
    try {
      for (const change of sortedChanges) {
        const hashes = "#".repeat(change.level);
        editor.replaceRange(
          `${hashes} ${change.newText}`,
          { line: change.line, ch: 0 },
          { line: change.line, ch: hashes.length + 1 + change.oldText.length }
        );
      }
    } finally {
      this.applyingNumbering = false;
    }

    // CM6's change mapping has already placed the cursor correctly after the
    // replaceRange calls above.  vault.modify() persists the changes to disk,
    // but Obsidian may respond by calling editor.setValue() internally to
    // reconcile the file with the editor — which resets the cursor via an
    // absolute-offset mapping that can land on a different line when headings
    // above the cursor changed length.  Saving the cursor now and restoring it
    // on the next tick (after Obsidian's potential reload) fixes this.
    const savedCursor = editor.getCursor();

    await this.app.vault.modify(file, result.newContent);
    await updateHeadingLinks(this.app, file.path, allChanges);

    // Restore cursor after any editor reload triggered by vault.modify.
    setTimeout(() => {
      try {
        editor.setCursor(savedCursor);
      } catch {
        // editor may have been closed; ignore
      }
    }, 0);
  }

  /**
   * Apply numbering to a file that is not currently open in an editor
   * (used by "refresh all").
   */
  private async applyToFile(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const rawProp = readTechdocProperty(content);
    if (!rawProp) return;

    const config = parseTechdocConfig(rawProp);
    if (!config) return;

    const result = processHeadings(content, config, file.path);

    if (result.newContent !== content) {
      await this.app.vault.modify(file, result.newContent);
    }

    if (result.changes.length > 0) {
      await updateHeadingLinks(this.app, file.path, result.changes);
    }
  }

  /** Refresh every note in the vault that carries the techdoc-numbering property. */
  async refreshAll(): Promise<void> {
    // For the active note, prefer the editor path so changes are visible immediately.
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const activeFile = activeView?.file ?? null;

    const files = this.app.vault.getMarkdownFiles();
    let count = 0;

    for (const file of files) {
      try {
        if (activeFile && file.path === activeFile.path && activeView?.editor) {
          await this.refreshWithEditor(activeView.editor, file);
        } else {
          await this.applyToFile(file);
        }
        count++;
      } catch (e) {
        console.error(`[TechDoc Heading Numbering] error processing ${file.path}:`, e);
      }
    }

    new Notice(`Heading numbers refreshed in ${count} note${count !== 1 ? "s" : ""}.`);
  }

  // -------------------------------------------------------------------------
  // Rename handling
  // -------------------------------------------------------------------------

  private async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
    try {
      await updateLinksAfterRename(this.app, oldPath, file.path);
    } catch (e) {
      console.error("[TechDoc Heading Numbering] rename handler error:", e);
    }
  }
}
