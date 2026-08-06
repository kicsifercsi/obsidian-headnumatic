import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  TFolder,
  Editor,
  MarkdownView,
} from "obsidian";

import { parseHeadnumaticConfig, validateHeadnumaticRaw, HeadnumaticConfig } from "./numbering-parser";
import { processHeadings, readHeadnumaticProperty, parseHeadings, diffHeadings } from "./heading-engine";
import {
  updateHeadingLinks,
  updateLinksAfterRename,
  rewriteHeadingLinksInContent,
} from "./link-updater";
import type { HeadingEntry } from "./types";

const MALFORMED_NOTICE = "Malformed settings, check headnumatic-numbering property!";

interface HeadnumaticSettings {
  /**
   * Vault-wide link rewriting after headings are renumbered.
   *
   * When false only the note whose headings changed is touched — its own
   * links to its own headings, which nothing else would fix. Links in other
   * notes keep pointing at the previous heading text.
   */
  updateAllLinksOnRenumber: boolean;

  /**
   * Vault-wide link rewriting after a file or folder is renamed.
   *
   * Off by default: Obsidian already does this when "Automatically update
   * internal links" is enabled, so the plugin's pass is a safety net that
   * costs a full vault read on every rename. Turn it on only when Obsidian's
   * own setting is disabled.
   */
  updateAllLinksOnRename: boolean;
}

const DEFAULT_SETTINGS: HeadnumaticSettings = {
  updateAllLinksOnRenumber: true,
  updateAllLinksOnRename: false,
};

export default class HeadnumaticPlugin extends Plugin {
  settings: HeadnumaticSettings = { ...DEFAULT_SETTINGS };

  /** Debounce timers keyed by file path. */
  private refreshTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /** Last known cursor line per file, used to detect when the cursor leaves the settings line. */
  private prevCursorLines: Map<string, number> = new Map();

  /**
   * Per-file snapshot of the headings as they were the last time the plugin
   * reconciled this note (or when it was opened).  This is the reliable
   * reference for what links elsewhere in the vault currently point to; diffing
   * it against the freshly numbered headings yields the old→new text mappings
   * used to rewrite those links.  Kept in memory and only updated after a
   * successful reconcile, so it never depends on the editor/disk save race.
   */
  private headingSnapshots: Map<string, HeadingEntry[]> = new Map();

  /**
   * Set to true while we are programmatically writing to an editor so that
   * the resulting editor-change event does not re-trigger auto-refresh.
   */
  private applyingNumbering = false;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new HeadnumaticSettingTab(this.app, this));

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

    // Seed the heading snapshot whenever a note becomes active so the first
    // edit has a correct "before" reference for link updates.
    this.registerEvent(
      this.app.workspace.on("file-open", async (file) => {
        if (file) await this.seedSnapshot(file);
      })
    );

    // file-open does not fire for the note that is already open at load time.
    this.app.workspace.onLayoutReady(() => {
      const activeFile = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
      if (activeFile) void this.seedSnapshot(activeFile);
    });
  }

  onunload() {
    for (const timer of this.refreshTimers.values()) clearTimeout(timer);
    this.refreshTimers.clear();
    this.prevCursorLines.clear();
    this.headingSnapshots.clear();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Record the current headings of `file` as the snapshot reference. */
  private async seedSnapshot(file: TFile): Promise<void> {
    try {
      const content = await this.app.vault.cachedRead(file);
      this.headingSnapshots.set(file.path, parseHeadings(content));
    } catch {
      // file may be unreadable (e.g. just deleted); ignore
    }
  }

  // -------------------------------------------------------------------------
  // Settings validation on cursor leave
  // -------------------------------------------------------------------------

  /**
   * Called on every editor-change event. Tracks the cursor line; when the
   * cursor moves away from the `headnumatic-numbering` frontmatter line, the
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
    if (!/^headnumatic-numbering\s*:/.test(lines[prevLine] ?? "")) return;

    // Cursor just left the settings line — validate now.
    const rawProp = readHeadnumaticProperty(content);
    if (!rawProp) return;
    if (!validateHeadnumaticRaw(rawProp) || !parseHeadnumaticConfig(rawProp)) {
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
        const rawProp = readHeadnumaticProperty(content);
        if (!rawProp) return;

        // Malformed-settings feedback is handled by checkSettingsOnLeave;
        // silently skip here so the auto-refresh never spams notices.
        if (!validateHeadnumaticRaw(rawProp)) return;

        const config = parseHeadnumaticConfig(rawProp);
        if (!config?.autoRefresh) return;

        // Option 1: pass the cursor line so processHeadings skips it while typing.
        const cursorLine = editor.getCursor().line;
        await this.applyToEditor(editor, file, content, config, cursorLine);
      } catch (e) {
        console.error("[HeadNumatic] auto-refresh error:", e);
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
   * back through the Editor API for an immediate visual update.
   */
  private async refreshWithEditor(editor: Editor, file: TFile): Promise<void> {
    try {
      const content = editor.getValue();
      const rawProp = readHeadnumaticProperty(content);
      if (!rawProp) {
        new Notice("No 'headnumatic-numbering' property found in this note.");
        return;
      }

      if (!validateHeadnumaticRaw(rawProp)) {
        new Notice(MALFORMED_NOTICE);
        return;
      }

      const config = parseHeadnumaticConfig(rawProp);
      if (!config) {
        new Notice(MALFORMED_NOTICE);
        return;
      }

      await this.applyToEditor(editor, file, content, config);
    } catch (e) {
      console.error("[HeadNumatic] refreshWithEditor error:", e);
      new Notice("Error refreshing heading numbers. Check the console for details.");
    }
  }

  /**
   * Apply computed heading numbering to an open editor.
   *
   * Each changed line is updated with editor.replaceRange() so that
   * CodeMirror's own change-mapping keeps the cursor in the right place —
   * no manual cursor save/restore is needed.
   *
   * The open file is written through the Editor API only; Obsidian persists
   * the buffer itself. Links in other notes still go through the vault, but
   * this file is excluded from that pass (see the skipPath argument below).
   */
  private async applyToEditor(
    editor: Editor,
    file: TFile,
    content: string,
    config: HeadnumaticConfig,
    skipLine?: number
  ): Promise<void> {
    const result = processHeadings(content, config, file.path, skipLine);

    // Diff the heading snapshot (what links currently point to) against the
    // freshly numbered headings to get reliable old→new text mappings. This
    // catches both renumbering and pure title renames, and — unlike comparing
    // against disk — never loses the "old" text to an editor/disk save race.
    const oldHeadings = this.headingSnapshots.get(file.path) ?? parseHeadings(content);
    const newHeadings = parseHeadings(result.newContent);
    const linkChanges = diffHeadings(oldHeadings, newHeadings);

    if (result.changes.length === 0 && linkChanges.length === 0) {
      // Nothing changed, but keep the snapshot current.
      this.headingSnapshots.set(file.path, newHeadings);
      return;
    }

    // Rewrite this note's own links to its headings in the same content we are
    // about to apply. Self-links must be updated in the editor buffer (not on
    // disk) or the editor's unsaved content would clobber the change.
    const changeMap = new Map(linkChanges.map((c) => [c.oldText, c.newText]));
    const finalContent = rewriteHeadingLinksInContent(
      result.newContent,
      file,
      changeMap,
      this.app
    );

    // Apply every changed line (heading renumbering + self-link rewrites) with
    // per-line replaceRange so CodeMirror maps the cursor correctly. Lines left
    // untouched (including the skipped cursor line) are not rewritten.
    this.applyingNumbering = true;
    try {
      this.applyLineDiff(editor, content, finalContent);
    } finally {
      this.applyingNumbering = false;
    }

    // Deliberately no vault.modify() here: the editor buffer is the only
    // writer for the open file, and Obsidian persists it on its own. Writing
    // the same bytes through the vault made Obsidian call editor.setValue()
    // to reconcile, which re-seeks the cursor by absolute offset and lands on
    // the wrong line whenever headings above it changed width — the reason
    // this function used to save and restore the cursor on a later tick. CM6
    // maps the cursor through the replaceRange calls above by itself.

    // Update links in every OTHER note; the active note was handled above.
    // With the setting off, the self-links written above are all we touch.
    if (this.settings.updateAllLinksOnRenumber) {
      await updateHeadingLinks(this.app, file, linkChanges, file.path);
    }

    // The reconcile is complete and consistent — refresh the snapshot.
    this.headingSnapshots.set(file.path, newHeadings);
  }

  /**
   * Apply the line-level differences between `oldContent` and `newContent` to
   * the editor using replaceRange per changed line. Link/heading rewrites never
   * add or remove lines, so a positional line comparison is sufficient and keeps
   * the cursor mapping stable.
   */
  private applyLineDiff(editor: Editor, oldContent: string, newContent: string): void {
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");
    // Apply bottom-to-top as a cheap safety net for line-index validity.
    for (let i = newLines.length - 1; i >= 0; i--) {
      const oldLine = oldLines[i] ?? "";
      if (oldLine === newLines[i]) continue;
      editor.replaceRange(
        newLines[i],
        { line: i, ch: 0 },
        { line: i, ch: oldLine.length }
      );
    }
  }

  /**
   * Apply numbering to a file that is not currently open in an editor
   * (used by "refresh all").
   */
  private async applyToFile(file: TFile): Promise<void> {
    const content = await this.app.vault.cachedRead(file);
    const rawProp = readHeadnumaticProperty(content);
    if (!rawProp) return;

    const config = parseHeadnumaticConfig(rawProp);
    if (!config) return;

    const result = processHeadings(content, config, file.path);

    const oldHeadings = this.headingSnapshots.get(file.path) ?? parseHeadings(content);
    const newHeadings = parseHeadings(result.newContent);
    const linkChanges = diffHeadings(oldHeadings, newHeadings);

    // Renumber and fix this note's links to its own headings in one write, so
    // the note is self-consistent even when vault-wide updating is off.
    const changeMap = new Map(linkChanges.map((c) => [c.oldText, c.newText]));
    const finalContent = rewriteHeadingLinksInContent(
      result.newContent,
      file,
      changeMap,
      this.app
    );

    if (finalContent !== content) {
      // Redo the work inside process() so the atomic read-modify-save works
      // from the on-disk content rather than writing back a stale snapshot.
      await this.app.vault.process(file, (data) =>
        rewriteHeadingLinksInContent(
          processHeadings(data, config, file.path).newContent,
          file,
          changeMap,
          this.app
        )
      );
    }

    if (this.settings.updateAllLinksOnRenumber && linkChanges.length > 0) {
      await updateHeadingLinks(this.app, file, linkChanges, file.path);
    }

    this.headingSnapshots.set(file.path, newHeadings);
  }

  /** Refresh every note in the vault that carries the headnumatic-numbering property. */
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
        console.error(`[HeadNumatic] error processing ${file.path}:`, e);
      }
    }

    new Notice(`Heading numbers refreshed in ${count} note${count !== 1 ? "s" : ""}.`);
  }

  // -------------------------------------------------------------------------
  // Rename handling
  // -------------------------------------------------------------------------

  private async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
    try {
      // Keep the snapshot keyed by the new path.
      const snapshot = this.headingSnapshots.get(oldPath);
      if (snapshot) {
        this.headingSnapshots.delete(oldPath);
        this.headingSnapshots.set(file.path, snapshot);
      }
      // Obsidian updates links on rename itself when "Automatically update
      // internal links" is on. Scanning the whole vault again is opt-out.
      if (!this.settings.updateAllLinksOnRename) return;

      // `file` is the renamed object handed over by the vault event, so
      // instanceof is a real type guard here — no re-resolving a path and
      // casting the result.
      await updateLinksAfterRename(
        this.app,
        oldPath,
        file.path,
        file instanceof TFolder
      );
    } catch (e) {
      console.error("[HeadNumatic] rename handler error:", e);
    }
  }
}

class HeadnumaticSettingTab extends PluginSettingTab {
  plugin: HeadnumaticPlugin;

  constructor(app: App, plugin: HeadnumaticPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Update links across vault on renumber")
      .setDesc(
        "On: links pointing to a renumbered heading are rewritten across the " +
          "whole vault. Off: only the note being renumbered is updated — its " +
          "own links to its own headings — and links elsewhere keep pointing " +
          "at the previous heading text."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.updateAllLinksOnRenumber)
          .onChange(async (value) => {
            this.plugin.settings.updateAllLinksOnRenumber = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Update links across vault on rename")
      .setDesc(
        "Off by default, because Obsidian already does this through its own " +
          '"Automatically update internal links" setting. Turn it on only if ' +
          "you keep that disabled: it makes the plugin read every note in the " +
          "vault on every rename."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.updateAllLinksOnRename)
          .onChange(async (value) => {
            this.plugin.settings.updateAllLinksOnRename = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
