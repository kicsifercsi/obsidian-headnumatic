import { test } from "node:test";
import assert from "node:assert/strict";
import { updateHeadingLinks, updateLinksAfterRename } from "../src/link-updater";

// ---------------------------------------------------------------------------
// Minimal Obsidian App stub.
//
// link-updater only takes *types* from "obsidian" (import type), so the module
// has no runtime dependency on the plugin host and can be driven directly.
//
// `files` maps path → content and doubles as the vault contents; the iteration
// order of its keys is the order getMarkdownFiles() returns, which lets a test
// place a note deliberately *before* another one.
//
// Nothing here stubs getAbstractFileByPath: the rewriters take the TFile and
// the folder/file distinction from their caller rather than re-resolving paths.
// ---------------------------------------------------------------------------

/** A stand-in for the TFile fields the rewriters actually read. */
const fileRef = (path: string) =>
  ({
    path,
    basename: path.split("/").pop()!.replace(/\.md$/, ""),
    extension: "md",
  }) as any;

function makeApp(files: Record<string, string>) {
  const store = { ...files };
  const writes: string[] = [];

  const app = {
    vault: {
      getMarkdownFiles: () => Object.keys(store).map(fileRef),
      read: async (f: any) => store[f.path],
      cachedRead: async (f: any) => store[f.path],
      modify: async (f: any, c: string) => {
        store[f.path] = c;
      },
      // Mirrors Vault.process(): read, transform, save unconditionally.  Each
      // call is counted so a test can assert that untouched notes are never
      // written.
      process: async (f: any, fn: (data: string) => string) => {
        writes.push(f.path);
        const next = fn(store[f.path]);
        store[f.path] = next;
        return next;
      },
    },
    metadataCache: { getFirstLinkpathDest: () => null },
  } as any;

  return { app, store, writes };
}

// ---------------------------------------------------------------------------
// Folder rename – path separators must survive percent-encoding.
//
// Regression: the rewritten target used to be passed through
// encodeURIComponent() as a whole, which turns "/" into "%2F" and breaks every
// markdown link that spans more than one path level.
// ---------------------------------------------------------------------------

test("TEST 1 – folder rename keeps '/' separators in markdown links", async () => {
  const { app, store } = makeApp(
    {
      "index.md": [
        "[one level](001_Old/Note.md)",
        "[two levels](001_Old/002_Sub/Note.md)",
        "[three levels](001_Old/002_Sub/003_Deep/Note.md)",
      ].join("\n"),
    }
  );

  await updateLinksAfterRename(app, "001_Old", "001_New", true);
  const out = store["index.md"];

  assert.ok(!out.includes("%2F"), "path separators must not be percent-encoded");
  assert.match(out, /\[one level\]\(001_New\/Note\.md\)/);
  assert.match(out, /\[two levels\]\(001_New\/002_Sub\/Note\.md\)/);
  assert.match(out, /\[three levels\]\(001_New\/002_Sub\/003_Deep\/Note\.md\)/);
});

test("TEST 2 – folder rename preserves existing escapes without double-encoding", async () => {
  const { app, store } = makeApp(
    { "index.md": "[spaced](001_Old/002_Sub/My%20Note.md)" }
  );

  await updateLinksAfterRename(app, "001_Old", "001_New", true);

  // The space stays a single %20 — not re-encoded to %2520 — and the separators
  // stay literal.
  assert.equal(store["index.md"], "[spaced](001_New/002_Sub/My%20Note.md)");
});

test("TEST 3 – folder rename rewrites wikilinks and leaves unrelated links alone", async () => {
  const { app, store } = makeApp(
    {
      "index.md": [
        "[[001_Old/002_Sub/Note]]",
        "[[001_Old/002_Sub/Note#001 - Heading|Label]]",
        "[unrelated](Other/Note.md)",
        "[[Other/Note]]",
      ].join("\n"),
    }
  );

  await updateLinksAfterRename(app, "001_Old", "001_New", true);
  const out = store["index.md"];

  assert.ok(out.includes("[[001_New/002_Sub/Note]]"));
  assert.ok(out.includes("[[001_New/002_Sub/Note#001 - Heading|Label]]"));
  assert.ok(out.includes("[unrelated](Other/Note.md)"));
  assert.ok(out.includes("[[Other/Note]]"));
});

// ---------------------------------------------------------------------------
// File rename – the markdown link keeps the shape it was written in.
//
// Regression: the replacement used to always be the bare new basename, so
// "[x](docs/Old.md)" came back as "[x](New)" — both the directory and the
// extension were dropped.
// ---------------------------------------------------------------------------

test("TEST 4 – file rename preserves the extension in markdown links", async () => {
  const { app, store } = makeApp({
    "index.md": [
      "[with ext](Old Name.md)",
      "[without ext](Old Name)",
      "[with anchor](Old Name.md#Some Heading)",
    ].join("\n"),
  });

  await updateLinksAfterRename(app, "Old Name.md", "New Name.md", false);

  assert.equal(
    store["index.md"],
    [
      "[with ext](New%20Name.md)",
      "[without ext](New%20Name)",
      "[with anchor](New%20Name.md#Some Heading)",
    ].join("\n")
  );
});

test("TEST 5 – file rename preserves the directory path in markdown links", async () => {
  const { app, store } = makeApp({
    "index.md": [
      "[full path](docs/001_Old.md)",
      "[full path no ext](docs/001_Old)",
      "[basename only](001_Old.md)",
    ].join("\n"),
  });

  await updateLinksAfterRename(app, "docs/001_Old.md", "docs/002_New.md", false);
  const out = store["index.md"];

  assert.ok(!out.includes("%2F"), "path separators must not be percent-encoded");
  assert.ok(out.includes("[full path](docs/002_New.md)"));
  assert.ok(out.includes("[full path no ext](docs/002_New)"));
  assert.ok(out.includes("[basename only](002_New.md)"));
});

test("TEST 6 – file rename preserves a non-markdown extension", async () => {
  const { app, store } = makeApp({ "index.md": "![shot](assets/old.png)" });

  await updateLinksAfterRename(app, "assets/old.png", "assets/new.png", false);

  assert.equal(store["index.md"], "![shot](assets/new.png)");
});

test("TEST 7 – file rename preserves the path form in wikilinks", async () => {
  const { app, store } = makeApp({
    "index.md": [
      "[[001_Old]]",
      "[[001_Old.md]]",
      "[[docs/001_Old]]",
      "[[docs/001_Old.md]]",
      "[[docs/001_Old#001 - Heading|Label]]",
      "[[Other/Note]]",
    ].join("\n"),
  });

  await updateLinksAfterRename(app, "docs/001_Old.md", "docs/002_New.md", false);

  assert.equal(
    store["index.md"],
    [
      "[[002_New]]", // basename form stays a basename
      "[[002_New.md]]", // basename-with-extension form keeps its extension
      "[[docs/002_New]]", // path form keeps its directory
      "[[docs/002_New.md]]", // path-with-extension form keeps both
      "[[docs/002_New#001 - Heading|Label]]", // anchor and alias survive
      "[[Other/Note]]", // unrelated link untouched
    ].join("\n")
  );
});

// ---------------------------------------------------------------------------
// Undecodable link targets must not abort the vault scan.
//
// Regression: decodeURIComponent() raises a URIError on a bare "%" (a link like
// "[report](50%_done.md)" is perfectly ordinary text).  The throw escaped the
// per-file loop, so a single such note stopped every *later* note in the vault
// from being updated.  Each test below therefore places the offending note
// first and asserts a note after it was still processed.
// ---------------------------------------------------------------------------

test("TEST 8 – folder rename survives a bare '%' in a link target", async () => {
  const { app, store } = makeApp(
    {
      "a-bad.md": ["[report](50%_done.md)", "[coverage](100%.md)"].join("\n"),
      "b-good.md": "[good link](001_Old/002_Sub/Note.md)",
    }
  );

  await updateLinksAfterRename(app, "001_Old", "001_New", true);

  assert.equal(
    store["a-bad.md"],
    ["[report](50%_done.md)", "[coverage](100%.md)"].join("\n"),
    "undecodable targets are left exactly as they were"
  );
  assert.equal(
    store["b-good.md"],
    "[good link](001_New/002_Sub/Note.md)",
    "notes after the undecodable one must still be updated"
  );
});

test("TEST 9 – file rename survives a bare '%' in a link target", async () => {
  const { app, store } = makeApp({
    "a-bad.md": "[report](50%_done.md)",
    "b-good.md": "[good link](Old Name.md)",
  });

  await updateLinksAfterRename(app, "Old Name.md", "New Name.md", false);

  assert.equal(store["a-bad.md"], "[report](50%_done.md)");
  assert.ok(
    store["b-good.md"].includes("New%20Name"),
    "notes after the undecodable one must still be updated"
  );
});

test("TEST 10 – heading-link updates survive a bare '%' in a link target", async () => {
  const { app, store } = makeApp({
    // The heading here *does* match the change, so the rewriter gets as far as
    // decoding the note part — which is the bare-"%" target that used to throw.
    "a-bad.md": "[report](50%_done.md#Old Heading)",
    "b-good.md": ["[md link](Target.md#Old Heading)", "[[Target#Old Heading]]"].join("\n"),
    "Target.md": "## 001 - Old Heading",
  });

  await updateHeadingLinks(app, fileRef("Target.md"), [
    { oldText: "Old Heading", newText: "001 - Old Heading", level: 2, line: 0 },
  ]);

  assert.equal(store["a-bad.md"], "[report](50%_done.md#Old Heading)");
  assert.ok(
    store["b-good.md"].includes("[md link](Target.md#001%20-%20Old%20Heading)"),
    "markdown link heading is rewritten and URL-encoded"
  );
  assert.ok(
    store["b-good.md"].includes("[[Target#001 - Old Heading]]"),
    "wikilink heading is rewritten verbatim"
  );
});

// ---------------------------------------------------------------------------
// Vault.process() saves unconditionally, so the rewriters pre-check each note
// and only call it for notes that actually change.  Without that guard every
// note in the vault would be rewritten on every rename.
// ---------------------------------------------------------------------------

test("TEST 11 – only notes containing a matching link are written", async () => {
  const { app, store, writes } = makeApp(
    {
      "no-links.md": "# Just a heading\n\nSome prose.",
      "other-links.md": "[elsewhere](Other/Note.md)\n[[Unrelated]]",
      "has-link.md": "[target](001_Old/002_Sub/Note.md)",
    }
  );

  await updateLinksAfterRename(app, "001_Old", "001_New", true);

  assert.deepEqual(writes, ["has-link.md"], "untouched notes must not be saved");
  assert.equal(store["no-links.md"], "# Just a heading\n\nSome prose.");
  assert.equal(store["other-links.md"], "[elsewhere](Other/Note.md)\n[[Unrelated]]");
  assert.equal(store["has-link.md"], "[target](001_New/002_Sub/Note.md)");
});

test("TEST 12 – heading-link updates only write notes that reference the heading", async () => {
  const { app, store, writes } = makeApp({
    "no-links.md": "nothing to see",
    "has-link.md": "[md link](Target.md#Old Heading)",
    "Target.md": "## 001 - Old Heading",
  });

  await updateHeadingLinks(app, fileRef("Target.md"), [
    { oldText: "Old Heading", newText: "001 - Old Heading", level: 2, line: 0 },
  ]);

  assert.deepEqual(writes, ["has-link.md"]);
  assert.equal(store["no-links.md"], "nothing to see");
});
