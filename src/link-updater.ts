import type { App, TAbstractFile, TFile, TFolder } from "obsidian";
import type { HeadingChange } from "./types";

// ---------------------------------------------------------------------------
// Heading-link updates (after renumbering a note's headings)
// ---------------------------------------------------------------------------

/**
 * After the headings in `changedFilePath` have been renumbered, scan every
 * markdown note in the vault and rewrite any wikilinks or markdown links
 * that point to those headings.
 *
 * Supported link forms:
 *   [[Note#Old Heading Text]]
 *   [[Note#Old Heading Text|Display]]
 *   [[path/to/Note#Old Heading Text]]
 *   [text](Note#Old%20Heading%20Text)   (encoded or plain)
 */
export async function updateHeadingLinks(
  app: App,
  changedFilePath: string,
  changes: HeadingChange[]
): Promise<void> {
  if (changes.length === 0) return;

  // Build a map of oldText → newText for quick lookup.
  const changeMap = new Map<string, string>(
    changes.map((c) => [c.oldText, c.newText])
  );

  const files = app.vault.getMarkdownFiles();

  for (const file of files) {
    const content = await app.vault.read(file);
    let updated = content;

    for (const [oldText, newText] of changeMap) {
      updated = replaceHeadingInLinks(updated, changedFilePath, oldText, newText, app);
    }

    if (updated !== content) {
      await app.vault.modify(file, updated);
    }
  }
}

function replaceHeadingInLinks(
  content: string,
  targetFilePath: string,
  oldHeading: string,
  newHeading: string,
  app: App
): string {
  const targetFile = app.vault.getAbstractFileByPath(targetFilePath) as TFile | null;
  if (!targetFile) return content;

  const targetBasename = targetFile.basename; // filename without extension

  // Escape special regex characters in the heading text.
  const oldEsc = escapeRegex(oldHeading);
  const newHeadingEsc = newHeading;

  // Wikilink: [[Note#Heading]] or [[Note#Heading|Display]]
  // The note part can be just the basename or a full path.
  const wikiRe = new RegExp(
    `(\\[\\[)([^\\[\\]#|]+)#(${oldEsc})(\\|[^\\]]*)?\\]\\]`,
    "g"
  );

  content = content.replace(
    wikiRe,
    (match, open, notePart, heading, alias) => {
      if (!refersToFile(notePart.trim(), targetFile, app)) return match;
      return `${open}${notePart}#${newHeadingEsc}${alias ?? ""}]]`;
    }
  );

  // Markdown link: [text](Note#Heading) – heading may be URL-encoded.
  const mdRe = new RegExp(
    `(\\[[^\\]]*\\]\\()([^)#]+)#(${oldEsc}|${escapeRegex(
      encodeURIComponent(oldHeading)
    )})(\\))`,
    "g"
  );

  content = content.replace(
    mdRe,
    (match, linkOpen, notePart, _heading, close) => {
      if (!refersToFile(decodeURIComponent(notePart).trim(), targetFile, app))
        return match;
      return `${linkOpen}${notePart}#${encodeURIComponent(newHeadingEsc)}${close}`;
    }
  );

  return content;
}

/** Returns true when `ref` (the note part of a link) resolves to `targetFile`. */
function refersToFile(ref: string, targetFile: TFile, app: App): boolean {
  // Strip leading ./ and trailing spaces.
  const cleaned = ref.replace(/^\.\//, "").trim();

  // Exact path match (with or without .md extension).
  if (
    cleaned === targetFile.path ||
    cleaned === targetFile.path.replace(/\.md$/, "") ||
    cleaned === targetFile.basename
  ) {
    return true;
  }

  // Let Obsidian's resolver decide.
  const resolved = app.metadataCache.getFirstLinkpathDest(cleaned, "");
  return resolved?.path === targetFile.path;
}

// ---------------------------------------------------------------------------
// File / folder rename link updates
// ---------------------------------------------------------------------------

/**
 * After a file or folder is renamed, rewrite every wikilink and markdown link
 * in the vault that referenced the old path.
 *
 * Obsidian already handles this when "Automatically update internal links" is
 * enabled, but this ensures it also happens through the plugin regardless of
 * that setting.
 */
export async function updateLinksAfterRename(
  app: App,
  oldPath: string,
  newPath: string
): Promise<void> {
  const isFolder = isPathFolder(app, newPath);
  const files = app.vault.getMarkdownFiles();

  for (const file of files) {
    // Do not touch the renamed file itself if it's a note.
    if (file.path === newPath) continue;

    const content = await app.vault.read(file);
    let updated: string;

    if (isFolder) {
      updated = rewriteLinksForFolderRename(content, oldPath, newPath);
    } else {
      updated = rewriteLinksForFileRename(content, oldPath, newPath);
    }

    if (updated !== content) {
      await app.vault.modify(file, updated);
    }
  }
}

function isPathFolder(app: App, path: string): boolean {
  const item = app.vault.getAbstractFileByPath(path);
  // TFolder doesn't have an extension property.
  return item !== null && !("extension" in item);
}

/** Rewrite links in `content` after a single file was renamed. */
function rewriteLinksForFileRename(
  content: string,
  oldPath: string,
  newPath: string
): string {
  const oldBasename = basenameWithoutExt(oldPath);
  const newBasename = basenameWithoutExt(newPath);
  const oldPathNoExt = oldPath.replace(/\.md$/, "");
  const newPathNoExt = newPath.replace(/\.md$/, "");

  // Wikilink (with optional heading/alias): [[Old Name]] [[Old Name#h]] [[Old Name|d]]
  // We match both the full path form and the basename-only form.
  content = content.replace(
    /(\[\[)([^\[\]#|]+)((?:#[^\]|]*)?)(\|[^\]]*)?(\]\])/g,
    (match, open, ref, anchor, alias, close) => {
      const trimRef = ref.trim();
      if (
        trimRef === oldBasename ||
        trimRef === oldPathNoExt ||
        trimRef === oldPath
      ) {
        return `${open}${newBasename}${anchor}${alias ?? ""}${close}`;
      }
      return match;
    }
  );

  // Markdown link: [text](Old%20Name.md) or [text](Old Name.md)
  content = content.replace(
    /(\[[^\]]*\]\()([^)#]+)((?:#[^)]*)?)\)/g,
    (match, linkOpen, ref, anchor) => {
      const decoded = decodeURIComponent(ref).trim();
      if (
        decoded === oldBasename ||
        decoded === oldPathNoExt ||
        decoded === oldPath ||
        decoded === `${oldBasename}.md`
      ) {
        return `${linkOpen}${encodeURIComponent(newBasename)}${anchor})`;
      }
      return match;
    }
  );

  return content;
}

/** Rewrite links in `content` after a folder was renamed. */
function rewriteLinksForFolderRename(
  content: string,
  oldFolderPath: string,
  newFolderPath: string
): string {
  const oldPrefix = oldFolderPath.endsWith("/")
    ? oldFolderPath
    : oldFolderPath + "/";
  const newPrefix = newFolderPath.endsWith("/")
    ? newFolderPath
    : newFolderPath + "/";

  // Wikilinks that embed the full path.
  content = content.replace(
    /(\[\[)([^\[\]#|]+)((?:#[^\]|]*)?)(\|[^\]]*)?(\]\])/g,
    (match, open, ref, anchor, alias, close) => {
      if (ref.startsWith(oldPrefix)) {
        return `${open}${newPrefix}${ref.slice(oldPrefix.length)}${anchor}${alias ?? ""}${close}`;
      }
      return match;
    }
  );

  // Markdown links.
  content = content.replace(
    /(\[[^\]]*\]\()([^)#]+)((?:#[^)]*)?)\)/g,
    (match, linkOpen, ref, anchor) => {
      const decoded = decodeURIComponent(ref);
      if (decoded.startsWith(oldPrefix)) {
        const newRef = newPrefix + decoded.slice(oldPrefix.length);
        return `${linkOpen}${encodeURIComponent(newRef)}${anchor})`;
      }
      return match;
    }
  );

  return content;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function basenameWithoutExt(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[^.]+$/, "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
