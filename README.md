# lightningcss-build

[![Package](https://img.shields.io/npm/v/lightningcss-build.svg?color=blue)](https://www.npmjs.com/package/lightningcss-build)
[![Node](https://img.shields.io/node/v/lightningcss-build.svg?color=blue)](https://www.npmjs.com/package/lightningcss-build)
[![CI](https://img.shields.io/github/actions/workflow/status/igordanchenko/lightningcss-build/ci.yml?branch=main&label=CI&color=blue)](https://github.com/igordanchenko/lightningcss-build/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/lightningcss-build.svg?color=blue)](https://github.com/igordanchenko/lightningcss-build/blob/main/LICENSE)

An opinionated CSS bundler for libraries, built on the
[`lightningcss`](https://lightningcss.dev/) Node API.

It adds the three things `lightningcss-cli` does not support — **glob entry
patterns**, **watch mode**, and **preserving your source layout in the output**
— on top of always-bundle, always-minify, and always-target-browserslist
defaults. One command replaces ad hoc combinations of `lightningcss`,
`npm-run-all`, and custom watcher scripts.

It always:

- Minifies the output.
- Bundles `@import`s into each entry.
- Targets the project's
  [`browserslist`](https://github.com/browserslist/browserslist) config (or
  browserslist's defaults if none is present).
- Preserves source directory structure in the output.
- Expands glob patterns consistently across shells (macOS, Linux, and Windows),
  so quoting your patterns behaves the same everywhere.

In watch mode, it rebuilds only the entries affected by a change — editing a
shared `@import` partial rebuilds only the entries that import it.

## Install

```sh
npm install --save-dev lightningcss-build
```

Requires **Node 22+**.

## Usage

```sh
lightningcss-build [options] [entries...]
```

Each entry is a file path or a glob pattern (resolved relative to the current
working directory). If no entries are specified, it defaults to
`<input-dir>/*.css` — top-level `.css` files in the source root, which is a
common case for libraries.

| Option                   | Default | Description               |
| ------------------------ | ------- | ------------------------- |
| `-i, --input-dir <dir>`  | `src`   | Source root               |
| `-o, --output-dir <dir>` | `dist`  | Output directory          |
| `-w, --watch`            | —       | Rebuild on file changes   |
| `-s, --silent`           | —       | Suppress non-error output |
| `-v, --version`          | —       | Show version              |
| `-h, --help`             | —       | Show help                 |

Every resolved entry must live under `--input-dir` — anything outside is a hard
error. Output mirrors the layout beneath it: each entry (or each file matched by
an entry glob) produces its own file at
`<output-dir>/<relative-path-from-input-dir>`.

Entries are never combined — `N` entries resolve to `N` outputs. Bundling refers
to inlining each entry's `@import`s into that entry's output, not to merging
entries with each other.

Files reached only via `@import` (not listed as entries) are inlined into the
importer and never emitted as standalone outputs. A file that is both listed as
an entry _and_ `@import`ed by another entry is emitted standalone _and_ inlined
into its importer.

## Examples

**Default.** Top-level stylesheets in `src/`:

```json
{
  "scripts": {
    "build:css": "lightningcss-build"
  }
}
```

→ each `src/*.css` writes to `dist/`.

**Glob over a tree.** Multiple stylesheets in a nested source tree:

```json
{
  "scripts": {
    "build:css": "lightningcss-build \"src/**/*.css\""
  }
}
```

→ writes one output per matched file, preserving the directory layout.

> **Quote your globs.** Without quotes, some shells expand globs themselves (and
> inconsistently — `sh` does not understand `**`). Quoting delegates expansion
> to `lightningcss-build`, which behaves identically across macOS, Linux, and
> Windows.

**Custom input and output directories.** Stylesheets under `styles/`, output to
`build/css/`:

```json
{
  "scripts": {
    "build:css": "lightningcss-build -i styles -o build/css \"styles/**/*.css\""
  }
}
```

→ `styles/index.css` writes to `build/css/index.css`;\
`styles/components/button.css` writes to `build/css/components/button.css`.

**Watch mode.** Re-run on change, scoped to the affected entries:

```json
{
  "scripts": {
    "watch:css": "lightningcss-build -w \"src/**/*.css\""
  }
}
```

`Ctrl+C` (SIGINT) or `SIGTERM` shuts the watcher down cleanly.

Only files under `--input-dir` are watched. `@import`s may still reference files
outside it (they are bundled normally), but changes to those external files do
not trigger a rebuild — re-save the importing entry to pick them up.

The set of entries is fixed at startup. Creating a new file that matches an
entry glob does not add it to the watch set; restart `lightningcss-build` to
pick up new entries.

## Browserslist

Browserslist targets come from your project's `browserslist` config. The tool
looks in the standard locations, in the usual order of precedence:

1. `browserslist` field in `package.json`
2. `.browserslistrc`
3. Browserslist's built-in `defaults`
   (`> 0.5%, last 2 versions, Firefox ESR, not dead`)

Example `package.json`:

```json
{
  "browserslist": ["> 0.25%", "last 2 versions", "not dead"]
}
```

There is no `--targets` flag. If you need a different query per build, set the
`BROWSERSLIST` env var inline or switch configs with `BROWSERSLIST_ENV`.

## Exit codes

| Code | Meaning                                                                |
| ---- | ---------------------------------------------------------------------- |
| `0`  | Build succeeded                                                        |
| `1`  | Build error (parse error, missing `@import`, etc.)                     |
| `2`  | Usage error (no entries, unknown flag, or entry outside `--input-dir`) |

In watch mode, build errors stay scoped to the failing entry — previous good
outputs are preserved, the watcher keeps running, and the error is logged as
`file:line:col`.

## Non-goals

- **Not a `lightningcss-cli` replacement for generic use cases.** The opinions
  (always bundle, always minify, always respect Browserslist, and always
  preserve structure) cannot be turned off.
- **Not a CSS Modules / custom-media / custom-syntax configurator.** If you need
  those `lightningcss` features, use `lightningcss-cli` or the API directly.
- **Not a config-file tool.** All options are passed via CLI `argv` or resolved
  from standard project files.
- **Not a general bundler.** No JS, no assets, no CSS Modules JSON, no HMR.

## License

MIT © 2026 [Igor Danchenko](https://github.com/igordanchenko)
