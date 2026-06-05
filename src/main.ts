import {
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  Editor,
  MarkdownView,
} from "obsidian";

import { parseTechdocConfig, TechdocConfig } from "./numbering-parser";
import { processHeadings, readTechdocProperty } from "./heading-engine";
import { updateHeadingLinks, updateLinksAfterRename } from "./link-updater";

export default class TechDocHeadingNumbering extends Plugin {
  /** Debounce timers keyed by file path. */
  private refreshTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

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
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor: Editor, view: MarkdownView) => {
        if (this.applyingNumbering) return;
        if (view.file) this.scheduleAutoRefresh(editor, view.file);
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

        const config = parseTechdocConfig(rawProp);
        if (!config?.autoRefresh) return;

        await this.applyToEditor(editor, file, content, config);
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

      const config = parseTechdocConfig(rawProp);
      if (!config) {
        new Notice("Could not parse 'techdoc-numbering' property.");
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
   * Uses editor.setValue() for immediate visual feedback, then persists to
   * disk via vault.modify().  Cursor position is preserved where possible.
   */
  private async applyToEditor(
    editor: Editor,
    file: TFile,
    content: string,
    config: TechdocConfig
  ): Promise<void> {
    const result = processHeadings(content, config, file.path);
    if (result.newContent === content && result.changes.length === 0) return;

    if (result.newContent !== content) {
      const cursor = editor.getCursor();

      // Guard against the setValue triggering another editor-change → debounce.
      this.applyingNumbering = true;
      try {
        editor.setValue(result.newContent);
      } finally {
        this.applyingNumbering = false;
      }

      // Restore cursor, clamped to new line count.
      const totalLines = result.newContent.split("\n").length;
      editor.setCursor({
        line: Math.min(cursor.line, totalLines - 1),
        ch: cursor.ch,
      });

      // Persist to disk so the file is saved with the new content.
      await this.app.vault.modify(file, result.newContent);
    }

    if (result.changes.length > 0) {
      await updateHeadingLinks(this.app, file.path, result.changes);
    }
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
