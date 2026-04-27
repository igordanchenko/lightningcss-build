# CLAUDE.md

## Commands

- `npm test` — run the vitest suite (`vitest run`)
- `npx vitest run test/build.test.js` — run a single test file
- `npx vitest run -t "name substring"` — run tests by name
- `npm run lint` — ESLint (flat config, `@eslint/js` recommended + Node globals)
- `npm run ci` — lint + test (what CI runs)

Husky + lint-staged run `eslint --fix` and `prettier --write` on commit;
commitlint enforces Conventional Commits with `subject-exclamation-mark`
disallowed. Releases go through semantic-release.

Publishing uses npm **OIDC Trusted Publishing** — the `id-token: write`
permission in `release.yml` is what authorizes the registry, not an `NPM_TOKEN`
secret. Don't add `NPM_TOKEN` to the workflow env.

Requires **Node 22+** (the CLI uses `node:util` `parseArgs` defaults and
top-level await).

## Architecture

This is a CLI wrapping `lightningcss`' `bundleAsync` Node API with opinionated
defaults (always bundle, minify, target browserslist, preserve layout). There is
no config file — everything flows from CLI `argv` and standard project files.

### Flow

`bin/cli.js` parses `argv`, then calls `build()` or lazy-imports `watch()`. Exit
codes are **load-bearing** and externally documented: `0` success, `1` build
error, `2` usage error. The CLI preserves these by inspecting `err.code`;
`lib/errors.js` exposes `usageError(msg)` which tags errors with `code: 2`.
Don't throw bare errors for usage-style problems — use `usageError`.

`lib/prepare.js` is the shared front-end for both one-shot build and watch: it
validates `inputDir`, resolves browserslist targets, expands entry patterns (via
`tinyglobby`), and asserts every resolved entry lives under `inputDir`. Both
`build` and `watch` call it once at startup.

`lib/build.js#buildEntry` is the single build primitive. It calls `bundleAsync`
with a custom `resolver.read` that records every file lightningcss reads into a
`dependencies` set — this is how the per-entry dep graph is captured. The entry
itself is filtered out of `dependencies` before returning. `buildEntry` is
reused by the watcher for rebuilds.

`lib/log.js` is the shared console output surface for both modes. It's a
stateless factory (`createLogger({ cwd, silent, version })`) that emits the
header, per-entry `✓ src → dst (Nms)` lines, `ready`, `removed`, build summary,
and `✗` error lines. Paths passed in are absolute; the logger relativizes them
to `cwd`. Colors come from `picocolors` and auto-off on non-TTY / `NO_COLOR`.
`--silent` suppresses all stdout but keeps `✗` on stderr so CI still surfaces
failures. Function signatures across `build` / `watch` / `prepare` / logger
follow a consistent order: inputs (patterns/inputDir/outputDir) → `cwd` →
`silent` → `version` → `signal`.

### Watch mode (`lib/watch.js`)

The watch implementation has several invariants worth understanding before
editing:

- **State map**: `Map<entryPath, { outputPath, dependencies: Set }>`. Every
  entry has a record, even failed ones (with `outputPath: null`) — this keeps
  unlink bookkeeping consistent.
- **Affected-entry computation** on change: walk the state map and collect
  entries where `entry === path || dependencies.has(path)`. Do not shortcut to
  "rebuild everything".
- **Entry set is fixed at startup.** New files that match an entry glob are
  ignored; users restart to pick them up. There is no runtime pattern matcher.
- **External deps** (files `@import`-ed from outside `inputDir`) are bundled
  normally but **not watched** — `chokidar` only watches `inputDir`. Editing an
  external partial does not trigger a rebuild; the user re-saves the importer.
  This is documented in the README.
- **Debouncing**: chokidar is configured with
  `awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 }` — without it,
  chokidar's hardcoded 50ms `_emit` throttle silently drops a follow-up change
  to the same path that lands inside the window (the bug behind the original
  "parse error preserves prior output" Linux/Windows CI flake). After chokidar,
  events go through a `pending` Map keyed by path (last-event-wins), flushed
  30ms after the last event — this coalesces _across paths_ (e.g., a saved
  partial that touches several entries). `flushing` is a single-flight lock so
  concurrent flushes coalesce onto the in-flight one.
- **Unlink semantics**: deleting a tracked entry removes its output file.
  Deleting a non-entry file that's a dependency triggers rebuilds of its
  importers (lightningcss will then report the missing @import).
- **Shutdown**: signal handling lives in `bin/cli.js` — it installs a
  `SIGINT`/`SIGTERM` → `AbortController.abort()` bridge before any async work
  and passes `signal` into `watch()`. The watcher wires the signal's `abort`
  event to "clear the debounce timer, close chokidar, resolve with code 0."
  Don't reintroduce `process.once` inside `watch()`; the CLI-level handlers
  suppress Node's default signal-kill for the whole run, so aborts during
  `prepare()` or the initial rebuild pass also exit cleanly.

### Entries vs. partials

Any file listed (or matched by a glob) in `argv` is an **entry** and produces an
output at `<outputDir>/<relative-from-inputDir>`. Files reached only via
`@import` are inlined into the importer and never emitted standalone. A file can
be both — if it's listed as an entry _and_ imported by another entry, it gets
emitted **and** inlined. The test suite pins this behavior.

### Testing

Tests spawn the real CLI via `child_process.spawn` against `bin/cli.js` in a
temp dir (see `test/helpers.js`). This is intentional — it exercises `argv`
parsing, exit codes, and stderr formatting. Watch tests use `startWatcher` which
exposes a `waitFor(predicate)` on accumulated stdout/stderr; prefer that over
`sleep`. On macOS, temp dirs must be passed through `realpath` (done in
`createTmp`) because `/tmp` is a symlink to `/private/tmp` and path comparisons
would otherwise fail the `assertEntriesUnderInputDir` check.

CI runs the full matrix on Linux, macOS, and Windows. The SIGINT exit-code test
is skipped on Windows because `child.kill("SIGINT")` from Node doesn't deliver a
catchable signal there (Windows has no real signals; only `CTRL_C_EVENT` from a
real console reaches Node's `SIGINT` handler).

### Cross-platform path conventions

Three different libraries make different assumptions about path separators on
Windows. Get this wrong and Windows-only failures show up that look like "path X
is not under dir Y" or "glob never matches anything":

- **`path.resolve()` / `path.relative()`** — return native separators
  (backslashes on Windows). This is the canonical form for state-map keys,
  `inputDir` comparisons, logger relativization, and
  `assertEntriesUnderInputDir`.
- **`tinyglobby`** — returns absolute paths with **forward slashes** even on
  Windows. `lib/resolve.js` runs every glob match through `path.resolve()` so
  downstream code sees one consistent separator.
- **`chokidar`** event paths use native separators on Windows, matching
  `path.resolve()` output, so the state map's keys agree without conversion.

If a future feature needs path comparison or matching, decide deliberately which
form it needs and convert at the boundary — don't assume.
