# HeadNumatic

An [Obsidian](https://obsidian.md/) plugin that automatically adds hierarchical numbers to headings inside technical-documentation notes, using the folder structure as a prefix.

> Inspired by [number-headings-obsidian](https://github.com/onlyafly/number-headings-obsidian).

---

## Background information

This plugin was written with the aid of AI, taking into account the Obsidian guidelines. The main motivation for this plugin was making my life easier when writing technical documentation, mainly because inserting new notes and modifying content was not updating all references. This solution is geared towards a specific way of organizing the information so at the end, its easy to create a printable document that has the correct references also findable in the physical document. 

## Folder & Note Structure

The plugin is designed for a vault that follows this layout:

```
vault/
├── 001_Introduction/
│   ├── 001_Overview.md
│   └── 002_Motivation.md
├── 002_Installation/
│   ├── 001_Requirements.md
│   └── 002_Steps.md
└── 003_Reference/
    ├── 001_API/
    │   ├── 001_Endpoints.md
    │   └── 002_Authentication.md
    └── 002_Config/
        └── 001_Options.md
```

**Rules:**

- A *chapter folder* name starts with a zero-padded number, then `_`, then the title (e.g. `001_Introduction`).
- A *note* (subchapter) name follows the same convention (e.g. `001_Overview.md`).
- A chapter folder may contain sub-folders; in that case the chapter folder itself should contain no notes.

This layout only matters for the `?` folder-prefix format segment. Everything else works in any vault.

---

## Installation

### Manual (used only for development)

1. Build the plugin (see [Building](#building)).
2. Copy the contents of `build-output/` into your vault's plugin directory:  
   `<vault>/.obsidian/plugins/headnumatic/`
3. In Obsidian → *Settings → Community plugins*, enable **HeadNumatic**.

### From the Community Plugin Registry

Once published, search for **HeadNumatic** in *Settings → Community plugins → Browse*.

---

## Configuration (per-note)

Numbering is configured per note, in the note's YAML frontmatter under the key `headnumatic-numbering`, and applies only to that note. A note without this property is never touched. The only vault-wide option lives in the [plugin settings](#plugin-settings).

The value is a comma-separated list of directives:

```yaml
---
headnumatic-numbering: auto-refresh, first-level 2, max-level 4, format ?.001.a.A, start-values ?.1.a.A
---
```

### Directives

| Directive | Description |
|-----------|-------------|
| `auto-refresh` | When present, heading numbers are updated automatically whenever the note is edited (debounced 600 ms). Vault links pointing to changed headings are updated too. Without it, only the manual commands renumber the note. |
| `first-level <n>` | First heading level (`##` = 2, `###` = 3 …) that receives a number. Accepted range 1–6; a value outside that range is ignored and the default is kept. Default: `1`. |
| `max-level <n>` | Last heading level that receives a number (inclusive). Must be ≥ 1; values above 6 have no additional effect since Markdown stops at `######`. Default: `6`. |
| `format <value>` | **Required.** Defines the numbering format for each level, plus an optional literal suffix appended to every number (see below). |
| `start-values <value>` | Optional starting value for each level's counter (same structure as `format`, and it may carry the same suffix). |

Directives may appear in any order, and all except `format` may be omitted.

### How the value is validated

The property is parsed strictly, and the whole note is skipped if anything does not fit:

- Directives are split on commas. Every token must be exactly one of the five forms above — an unrecognised or malformed token invalidates the entire value.
- Each directive uses exactly one space between the name and its value.
- `format` and `start-values` values may not contain spaces. This is what catches a **missing comma**: in `format ?.001 start-values ?.1` the space makes the `format` token invalid, so the mistake is reported instead of being silently half-applied.
- A `format` directive must be present.
- `first-level` may not be greater than `max-level`.

When the settings are malformed, the notice **"Malformed settings, check headnumatic-numbering property!"** is shown the moment the cursor leaves the `headnumatic-numbering:` line — not on every keystroke, so the note can be edited in peace. Auto-refresh itself stays silent and simply does nothing until the value is valid again.

Note that within a valid `format` value, segments that match none of the patterns below are ignored rather than reported.

---

## Format Syntax

The format string uses `.` as a separator. Each segment describes how one level is formatted:

| Segment | Meaning | Example output |
|---------|---------|----------------|
| `?` | Prefix derived from the containing folder names and the note's filename. Always rendered first, wherever it appears in the string. | `001.002` |
| `001` (multiple digits) | Zero-padded integer, padded to the segment's digit count. | `001`, `042` |
| `1` (single digit) | Plain integer, no padding. | `1`, `42` |
| `a` | Lowercase letter (`a`…`z`, wrapping back to `a` after 26). | `a`, `z` |
| `A` | Uppercase letter (`A`…`Z`, wrapping back to `A` after 26). | `A`, `Z` |

The segment positions (after the optional `?`) map 1:1 to heading levels starting at `first-level`. If `max-level` implies more levels than the format lists, the surplus levels fall back to plain integers.

### Trailing Suffix

Anything after the last level format is treated as a literal **suffix** and appended to every generated number. `format ?.1.1.1:` numbers the third level as `02.01.1.1.1:` — the trailing `:` is not a level format, so it is carried through to the heading as-is:

| Format | Level | Rendered as |
|--------|-------|-------------|
| `?.1.1.1:` | `#` | `# 02.01.1: - Introduction` |
| `?.1.1.1:` | `##` | `## 02.01.1.1: - Overview` |
| `?.1.1.1:` | `###` | `### 02.01.1.1.1: - Details` |
| `?.001.a)` | `#` | `# 7.001) - Introduction` |
| `1.1=>` | `#` | `# 1=> - Introduction` |

The suffix is everything the parser cannot read as a level format, so it may be more than one character (`=>`) and may include a dot: `?.001.a.)` yields `7.001.)`, because the `.` before `)` is part of the suffix rather than a separator. The suffix sits inside the number, before the ` - ` separator, and it is stripped along with the number on the next refresh, so it does not accumulate.

A suffix may contain **symbols only** — no letters, digits, `_` or spaces. A trailing run containing any of those is not treated as a suffix at all; it is ignored like any other unreadable segment, and the number is produced without it.

That restriction is what keeps numbering reversible. The suffix has to be recognised again in order to be stripped on the next refresh, and the stripper can only safely skip a run of symbols: if it also skipped letters and digits, a heading like `# v1.2.3 - Release notes` would have its version read as a number and cut from the title. Were a suffix such as `:a` accepted, it could be written but never removed, and the number would nest on every refresh (`1:a - A` → `1:a - 1:a - A`).

### Example with folder prefix (`?`)

Note located at `001_Chapter/002_Section/003_Note.md`:

```
format ?.001.a.A.1
first-level 2
max-level 5
```

| Source heading | Rendered as |
|----------------|-------------|
| `## Introduction` | `## 001.002.003.001 - Introduction` |
| `### Overview` | `### 001.002.003.001.a - Overview` |
| `#### Details` | `#### 001.002.003.001.a.A - Details` |
| `##### Step` | `##### 001.002.003.001.a.A.1 - Step` |

The `?` prefix (`001.002.003`) comes from the two containing folders **and the note's own filename**.  
Any segment (folder or filename) that does *not* start with `<digits>_` is omitted from the prefix. If no segment qualifies, the prefix is empty and is left out entirely.

### Example without folder prefix

Same note, format changed to `001.a.A.1` (no `?.`):

| Source heading | Rendered as |
|----------------|-------------|
| `## Introduction` | `## 001 - Introduction` |
| `### Overview` | `### 001.a - Overview` |
| `#### Details` | `#### 001.a.A - Details` |
| `##### Step` | `##### 001.a.A.1 - Step` |

Without `?`, the folder/note numbers are not included. Dots still separate each heading level counter from the next — a top-level heading (`##`) has only one counter so no dot appears, while deeper headings accumulate dot-separated counters.

### Start Values

```
start-values ?.1.c.D.4
```

Sets the counter for each level to begin at the specified value. The `?` placeholder keeps alignment with the format and is otherwise ignored; use the same letter/number notation as the format. With the example above, the first `##` is numbered `001`, the first `###` under it starts at `c`, the first `####` at `D`, and the first `#####` at `4`.

A start value that does not match its level's format type (e.g. `c` where a number is expected) falls back to `1`. Levels not covered by the string also start at `1`.

`start-values` may repeat the format's trailing suffix (`format ?.1.1:` pairs with `start-values ?.3.5:`); it is ignored when the starting values are read, so the two strings can be kept visually identical.

---

## How Numbering Is Applied

- **Heading format.** The canonical output is `<hashes> <number> - <title>`, where `<number>` includes any [trailing suffix](#trailing-suffix) — the ` - ` separator always follows it. On every refresh an existing number is stripped and recomputed, so numbers never accumulate. The older `<number> <title>` form (without the ` - ` separator) is also recognised and converted on the next refresh.
- **What counts as a heading.** A line matching `#` to `######` followed by a single space and a non-empty title. Frontmatter and fenced code blocks (``` and ~~~) are skipped.
- **Counters.** Each numbered heading increments its own level's counter and resets all deeper counters to their start values.
- **Levels outside the range.** Headings shallower than `first-level` or deeper than `max-level` are left exactly as they are and do not affect any counter.
- **Titles are never rewritten.** Only the number in front of the title changes.

---

## Commands

| Command | Description |
|---------|-------------|
| **Refresh heading numbers in current note** | Renumber all eligible headings in the active note and update all links pointing to headings that changed. Reports if the note has no `headnumatic-numbering` property or the property is malformed. |
| **Refresh heading numbers in all notes** | Same as above, applied to every note in the vault. Notes without the property are skipped. |

---

## Auto-Refresh

With `auto-refresh` in the property, editing the note schedules a renumber 600 ms after you stop typing. Every heading is numbered on that pass, including the one you are currently typing in — a new heading gets its number as soon as you pause, without having to move the cursor or edit elsewhere first.

That is unobtrusive because **the cursor keeps its place**. Renumbering patches only the characters that actually change — for a renumbering, just the number itself — rather than rewriting the whole document or even the whole heading line. The cursor therefore sits outside the edited range and CodeMirror carries it along, so it stays where you left it in the title instead of being dropped at the start of the line. The one position CodeMirror cannot resolve on its own is a cursor sitting exactly where the number is inserted (the very start of the title); there the plugin moves it past the number, so typing continues at the front of the title as expected.

Programmatic edits made by the plugin do not re-trigger auto-refresh.

---

## Link Updating

### On heading renumber or rename

When a heading's text changes — because a number was added, an existing number changed, **or the title itself was edited** — every wikilink and Markdown link in the vault that pointed at the old heading text is rewritten.

Supported link forms:

```
[[Note#001.002.003.001 - Old Heading]]
[[Note#001.002.003.001 - Old Heading|Display label]]
[[path/to/Note#001.002.003.001 - Old Heading]]
[label](Note#001.002.003.001%20-%20Old%20Heading)
```

The note part of a link may be a basename or a full path; it is resolved through Obsidian's own link resolver, so only links that genuinely point at the changed note are touched. Headings in Markdown-style links are URL-encoded when written back.

To know what the links currently point to, the plugin keeps an in-memory snapshot of each note's headings, taken when the note is opened and refreshed after each successful update. The new headings are matched against that snapshot by their title (ignoring numbering), so inserting or deleting a heading in the middle of a note does not misalign the rest — and a pure title rename is detected as well as a renumbering.

Links in the note being edited are rewritten in the editor buffer itself, so unsaved content never overwrites them.

### On file / folder rename

When any file or folder is renamed, every note in the vault is scanned and links referencing the old name/path are updated to the new one.

> **Note:** this is **off by default** — Obsidian performs these link updates natively when *Automatically update internal links* is enabled. The plugin's rename handler is a safety net for vaults that keep Obsidian's built-in feature disabled, and runs only while **Update links across vault on rename** is switched on — see [Plugin Settings](#plugin-settings).

---

## Plugin Settings

*Settings → Community plugins → HeadNumatic*

| Setting | Default | Effect |
|---------|---------|--------|
| **Update links across vault on renumber** | On | **On** — links pointing at a renumbered heading are rewritten across the whole vault.<br>**Off** — only the note being renumbered is updated: its own links to its own headings are fixed, since nothing else would fix them. Links in other notes keep pointing at the previous heading text. |
| **Update links across vault on rename** | **Off** | **On** — after any rename the whole vault is scanned and links to the old name or path are rewritten.<br>**Off** — renames are left entirely to Obsidian's built-in *Automatically update internal links*. |

The two are independent.

The rename switch is off by default because Obsidian already does that job: leaving it off avoids a full vault read on every rename, for no loss of function. Turn it on only if you keep Obsidian's own *Automatically update internal links* disabled — otherwise both features rewrite the same links.

The renumbering switch defaults to on and has no built-in equivalent to fall back on; with it off, links elsewhere in the vault go stale until you re-enable it and run one of the refresh commands.

---

## Known Limitations

- With the vault-wide settings on, every link update scans and reads all Markdown files in the vault. On very large vaults with `auto-refresh` enabled this is noticeable — the two switches in [Plugin Settings](#plugin-settings) turn it off per trigger.
- **Refresh heading numbers in all notes** shows the "no property found" notice when the active note has no `headnumatic-numbering` property, even though the rest of the vault is processed normally.
- Fenced code blocks are tracked with a simple open/close toggle, so an unbalanced fence inside a note can cause headings after it to be skipped.
- Headings are matched only in the `# Title` form; Setext-style headings (underlined with `===` or `---`) are not numbered.

---

## Building

### Prerequisites

```
node >= 18
npm >= 9
```

### Release build

Use the included `build` script. It takes one required argument, `Y` or `N`,
saying whether the new version should also be recorded in `versions.json`:

```bash
chmod +x build   # first time only

./build Y        # bump, and add the new version to versions.json
./build N        # bump, and leave versions.json alone
./build          # prints usage and exits without changing anything
```

Either way the script:

1. Reads the current version from `manifest.json` and bumps the **patch** component.
2. Writes the new version back to `manifest.json` and `package.json`.
3. With `Y`, adds `"<new version>": "<minAppVersion>"` to `versions.json` — the map Obsidian uses to decide the newest release a given app version may install. Use `N` for builds you are not publishing, so the file only ever lists real releases.
4. Compiles TypeScript (type-check only, no emit).
5. Bundles the plugin with esbuild (production mode, no source maps).
6. Copies `main.js`, `manifest.json`, and `styles.css` (if present) into `build-output/`.

The `build-output/` directory is ready to be dropped into an Obsidian vault's plugin folder.

Pushing a tag triggers the GitHub Actions workflow, which builds and creates a release with the same artifacts.

### Tests

```bash
npm test     # or: ./runtest
```

The suite covers the numbering engine (folder prefixes, letter formats, start values, level cut-offs, malformed-config detection), the heading-diff logic used for link updates, the link rewriters themselves (path and extension handling on rename, and which notes get written), and cursor preservation when edits are applied to the editor — the last of these runs against the real CodeMirror `state` package, so it reflects how Obsidian actually maps the cursor rather than an approximation of it.

---

## Funding

If you find this plugin useful, consider buying me a coffee - it helps me stay awake !

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-yellow)](https://ko-fi.com/kicsifercsi)

---

## Compatibility

| | Supported |
|---|---|
| Obsidian desktop | Yes |
| Obsidian mobile | Yes |
| Minimum Obsidian version | 1.2.8 |

---

## Privacy & Data

This plugin operates entirely within your local vault. It does not:

- Make any network requests
- Collect, transmit, or store any user data outside of Obsidian
- Connect to any external service or API

All processing happens locally on your device. The only files it reads and writes are the Markdown notes inside your vault.

### Why the plugin can see every note

Obsidian's plugin review flags HeadNumatic as enumerating the vault, because it
calls `vault.getMarkdownFiles()`. That is inherent to what link updating does: a
link pointing at a renumbered heading can live in *any* note, and there is no
way to know which notes those are without looking.

It happens in three places:

- **After a note's headings are renumbered** — other notes may link to those
  headings by their old text. Controlled by *Update links across vault on
  renumber*.
- **After a file or folder is renamed** — other notes may link to the old path.
  Controlled by *Update links across vault on rename*, which is off by default.
- **Refresh heading numbers in all notes** — a command you invoke explicitly,
  where covering the whole vault is the entire point. Notes without the
  `headnumatic-numbering` property are identified through Obsidian's metadata
  cache and skipped without being read.

Both vault-wide link passes can be turned off in
[Plugin Settings](#plugin-settings). Either way nothing leaves your machine:
the plugin makes no network requests of any kind, so file names and paths are
never transmitted anywhere.

---

## License

This plugin is released under the [MIT License](LICENSE).
