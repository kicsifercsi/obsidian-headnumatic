# HeadNumatic

An [Obsidian](https://obsidian.md/) plugin that automatically adds hierarchical numbers to headings inside technical-documentation notes, using the folder structure as a prefix.

> Inspired by [number-headings-obsidian](https://github.com/onlyafly/number-headings-obsidian).

---

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

---

## Installation

### Manual (recommended during development)

1. Build the plugin (see [Building](#building)).
2. Copy the contents of `build-output/` into your vault's plugin directory:  
   `<vault>/.obsidian/plugins/obsidian-techdoc-heading-numbering/`
3. In Obsidian → *Settings → Community plugins*, enable **TechDoc Heading Numbering**.

### From the Community Plugin Registry

Once published, search for **HeadNumatic** in *Settings → Community plugins → Browse*.

---

## Configuration (per-note)

All configuration lives in the note's YAML frontmatter under the key `techdoc-numbering`. The value is a comma-separated list of directives.

```yaml
---
techdoc-numbering: auto-refresh, first-level 2, max-level 4, format ?.001.a.A, start-values ?.1.a.A
---
```

### Directives

| Directive | Description |
|-----------|-------------|
| `auto-refresh` | When present, heading numbers are updated automatically whenever the note is edited (debounced 600 ms). All vault links pointing to changed headings are updated too. |
| `first-level <n>` | First heading level (`##` = 2, `###` = 3 …) that receives a number. Must be ≥ 2. Default: `1`. |
| `max-level <n>` | Last heading level that receives a number (inclusive). Range 1–6. Default: `6`. |
| `format <value>` | **Required.** Defines the numbering format for each level (see below). |
| `start-values <value>` | Optional starting value for each level's counter (same structure as `format`). |

### Format Syntax

The format string uses `.` as a separator. Each segment describes how one level is formatted:

| Segment | Meaning | Example output |
|---------|---------|----------------|
| `?` | Prefix derived from the containing folder names (only valid at position 0). | `001.002` |
| `001` (multiple digits) | Zero-padded integer, padded to the segment's digit count. | `001`, `042` |
| `1` (single digit) | Plain integer, no padding. | `1`, `42` |
| `a` | Lowercase letter (`a`…`z`, then wraps). | `a`, `z` |
| `A` | Uppercase letter (`A`…`Z`, then wraps). | `A`, `Z` |

The segment positions (after the optional `?`) map 1:1 to heading levels starting at `first-level`.

#### Example with folder prefix (`?`)

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
Any segment (folder or filename) that does *not* start with `<digits>_` is omitted from the prefix.

#### Example without folder prefix

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

Sets the counter for each level to begin at the specified value. The `?` placeholder keeps alignment with the format; use the same letter/number notation as the format.

---

## Commands

| Command | Description |
|---------|-------------|
| **Refresh heading numbers in current note** | Renumber all eligible headings in the active note and update all links pointing to headings that changed. |
| **Refresh heading numbers in all notes** | Same as above, applied to every note in the vault that has the `techdoc-numbering` property. |

---

## Link Updating

### On heading renumber

When heading text changes (because a new number was added, or an existing number changed), all wikilinks and Markdown links in the vault that point to the old heading text are updated automatically.

Supported link forms:

```
[[Note#001.002.003.001 - Old Heading]]
[[Note#001.002.003.001 - Old Heading|Display label]]
[[path/to/Note#001.002.003.001 - Old Heading]]
[label](Note#001.002.003.001%20-%20Old%20Heading)
```

### On file / folder rename

When any file or folder is renamed, every note in the vault is scanned and links referencing the old name/path are updated to the new name/path.

> **Note:** Obsidian also performs link updates natively when *Automatically update internal links* is enabled. The plugin's rename handler provides an additional safety net and is especially useful when Obsidian's built-in feature is disabled.

---

## Building

### Prerequisites

```
node >= 18
npm >= 9
```

### Release build

Use the included `build` script. It:

1. Reads the current version from `manifest.json` and bumps the **patch** component.
2. Writes the new version back to `manifest.json` and `package.json`.
3. Compiles TypeScript (type-check only, no emit).
4. Bundles the plugin with esbuild (production mode, no source maps).
5. Copies `main.js`, `manifest.json`, and `styles.css` (if present) into `build-output/`.

```bash
chmod +x build   # first time only
./build
```

The `build-output/` directory is ready to be dropped into an Obsidian vault's plugin folder.

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
| Minimum Obsidian version | 1.1.1 |

---

## Privacy & Data

This plugin operates entirely within your local vault. It does not:

- Make any network requests
- Collect, transmit, or store any user data outside of Obsidian
- Connect to any external service or API

All processing happens locally on your device. The only files it reads and writes are the Markdown notes inside your vault.

---

## License

This plugin is released under the [MIT License](LICENSE).
