# Changelog

Notable changes to HeadNumatic. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Write entries under `## [Unreleased]` as you work. `./build` promotes that
section to the new version number when it bumps `manifest.json`, and the
release workflow publishes it as the GitHub release description.

Releases before 0.4.22 predate this file; see the commit history for those.

## [Unreleased]

## [0.4.23] - 2026-08-19

### Changed

- **Refresh heading numbers in all notes** now uses Obsidian's metadata cache to
  skip notes without the `headnumatic-numbering` property instead of reading
  every note in the vault to find out.
- The notice that command shows now counts the notes actually renumbered rather
  than every Markdown file scanned.

### Added

- README section explaining why the plugin can enumerate the vault, which
  features need it, and how to switch them off.

## [0.4.22] - 2026-08-19

### Added

- Release assets now carry GitHub artifact attestations, so a download can be
  verified against the workflow run that produced it with
  `gh attestation verify main.js --repo kicsifercsi/obsidian-headnumatic`.
- The settings tab implements Obsidian 1.13.0's declarative settings API, which
  makes both options discoverable through the settings search. The imperative
  tab is kept as a fallback for app versions older than 1.13.0.

### Changed

- Dropped the `builtin-modules` build dependency in favour of Node's own
  `module.builtinModules`. The `node:`-prefixed module names are now
  externalised by esbuild as well.
- Timers use `window.setTimeout` / `window.clearTimeout` for compatibility with
  Obsidian popout windows.

### Fixed

- Raised the TypeScript `lib` target to ES2019 so `String.prototype.trimEnd`
  and `padStart` resolve to real types instead of being silently treated as
  errors by type-aware linting.
- Annotated the `String.prototype.replace` callback parameters in the link
  updater, which were implicitly `any`.
