import type { App, TFile } from "obsidian";
import type { HeadingChange } from "./types";

// ---------------------------------------------------------------------------
// Heading-link updates (after renumbering a note's headings)
// ---------------------------------------------------------------------------

/**
 * After the headings in `targetFile` have been renumbered, scan every markdown
 * note in the vault and rewrite any wikilinks or markdown links that point to
 * those headings.
 *
 * Supported link forms:
 *   [[Note#Old Heading Text]]
 *   [[Note#Old Heading Text|Display]]
 *   [[path/to/Note#Old Heading Text]]
 *   [text](Note#Old%20Heading%20Text)   (encoded or plain)
 *
 * The caller passes the TFile it already holds rather than a path: re-resolving
 * a path through getAbstractFileByPath() would hand back a TAbstractFile that
 * only an unchecked cast could turn into a TFile.
 *
 * `skipPath` lets the caller exclude a file it will update by other means — in
 * particular the currently-open note, whose self-links must be rewritten in the
 * live editor buffer rather than on disk (a disk write would be clobbered by the
 * editor's unsaved content).
 */
export async function updateHeadingLinks(
  app: App,
  targetFile: TFile,
  changes: HeadingChange[],
  skipPath?: string
): Promise<void> {
  if (changes.length === 0) return;

  // Build a map of oldText → newText for quick lookup.
  const changeMap = new Map<string, string>(
    changes.map((c) => [c.oldText, c.newText])
  );

  const files = app.vault.getMarkdownFiles();

  const rewrite = (data: string) =>
    rewriteHeadingLinksInContent(data, targetFile, changeMap, app);

  for (const file of files) {
    if (skipPath && file.path === skipPath) continue;

    // Pre-check against the cache so untouched notes are skipped: process()
    // saves unconditionally, and writing every note in the vault on each
    // update would churn mtimes and fire a modify event per file.
    const content = await app.vault.cachedRead(file);
    if (rewrite(content) === content) continue;

    // Re-run the rewrite inside process() so the write is an atomic
    // read-modify-save against whatever is on disk at that moment.
    await app.vault.process(file, rewrite);
  }
}

/**
 * Pure helper: return `content` with every link that points to a heading in
 * `changeMap` (on `targetFile`) rewritten to the new heading text. Does no I/O,
 * so it can be applied either to disk content or to a live editor buffer.
 */
export function rewriteHeadingLinksInContent(
  content: string,
  targetFile: TFile,
  changeMap: Map<string, string>,
  app: App
): string {
  let updated = content;
  for (const [oldText, newText] of changeMap) {
    updated = replaceHeadingInLinks(updated, targetFile, oldText, newText, app);
  }
  return updated;
}

function replaceHeadingInLinks(
  content: string,
  targetFile: TFile,
  oldHeading: string,
  newHeading: string,
  app: App
): string {
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
    (match, open, notePart, _heading, alias) => {
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
      if (!refersToFile(safeDecodeURIComponent(notePart).trim(), targetFile, app))
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
 *
 * `isFolder` is decided by the caller, which receives the renamed
 * TAbstractFile from the vault event and can test it with `instanceof TFolder`
 * — a real type guard, unlike probing a re-resolved path for an `extension`
 * property.
 */
export async function updateLinksAfterRename(
  app: App,
  oldPath: string,
  newPath: string,
  isFolder: boolean
): Promise<void> {
  const files = app.vault.getMarkdownFiles();

  const rewrite = (data: string) =>
    isFolder
      ? rewriteLinksForFolderRename(data, oldPath, newPath)
      : rewriteLinksForFileRename(data, oldPath, newPath);

  for (const file of files) {
    // Do not touch the renamed file itself if it's a note.
    if (file.path === newPath) continue;

    // See updateHeadingLinks: pre-check keeps process() from rewriting notes
    // that contain no matching link.
    const content = await app.vault.cachedRead(file);
    if (rewrite(content) === content) continue;

    await app.vault.process(file, rewrite);
  }
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
  // We match both the full path form and the basename-only form, and — as with
  // markdown links — the replacement keeps whichever form was used, so a link
  // written as [[docs/Old]] is not flattened to [[New]].  Wikilink targets are
  // literal text, so nothing is percent-encoded here.
  content = content.replace(
    /(\[\[)([^[\]#|]+)((?:#[^\]|]*)?)(\|[^\]]*)?(\]\])/g,
    (match, open, ref, anchor, alias, close) => {
      const trimRef = ref.trim();

      let replacement: string | null = null;
      if (trimRef === oldPath) replacement = newPath;
      else if (trimRef === oldPathNoExt) replacement = newPathNoExt;
      else if (trimRef === `${oldBasename}.md`) replacement = `${newBasename}.md`;
      else if (trimRef === oldBasename) replacement = newBasename;

      if (replacement === null) return match;
      return `${open}${replacement}${anchor}${alias ?? ""}${close}`;
    }
  );

  // Markdown link: [text](Old%20Name.md) or [text](Old Name.md)
  //
  // The replacement mirrors the shape the link already had — full path or bare
  // basename, with or without the extension — so a link written as
  // "[x](docs/Old.md)" does not come back as "[x](New)".  Order matters: the
  // most specific form is tested first.
  content = content.replace(
    /(\[[^\]]*\]\()([^)#]+)((?:#[^)]*)?)\)/g,
    (match, linkOpen, ref, anchor) => {
      const decoded = safeDecodeURIComponent(ref).trim();

      let replacement: string | null = null;
      if (decoded === oldPath) replacement = newPath;
      else if (decoded === oldPathNoExt) replacement = newPathNoExt;
      else if (decoded === `${oldBasename}.md`) replacement = `${newBasename}.md`;
      else if (decoded === oldBasename) replacement = newBasename;

      if (replacement === null) return match;
      return `${linkOpen}${encodePath(replacement)}${anchor})`;
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
    /(\[\[)([^[\]#|]+)((?:#[^\]|]*)?)(\|[^\]]*)?(\]\])/g,
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
      const decoded = safeDecodeURIComponent(ref);
      if (decoded.startsWith(oldPrefix)) {
        const newRef = newPrefix + decoded.slice(oldPrefix.length);
        return `${linkOpen}${encodePath(newRef)}${anchor})`;
      }
      return match;
    }
  );

  return content;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * decodeURIComponent() that never throws.
 *
 * Link targets are hand-written text and may contain a bare "%" that is not a
 * valid escape sequence (e.g. "[report](50%_done.md)").  decodeURIComponent()
 * raises a URIError on those, which would abort the whole vault scan and leave
 * the remaining notes un-updated.  An undecodable target is used as-is instead.
 */
function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Percent-encode a vault path for use inside a markdown link target.
 *
 * Each path segment is encoded on its own so the "/" separators survive —
 * encodeURIComponent() on the whole path would turn them into "%2F" and break
 * every multi-level link.
 */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function basenameWithoutExt(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[^.]+$/, "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
