import { rm } from "node:fs/promises";
import chokidar from "chokidar";
import { buildEntry } from "./build.js";
import { createLogger } from "./log.js";
import { prepare } from "./prepare.js";

const DEBOUNCE_MS = 30;

export async function watch({ patterns, inputDir, outputDir, cwd = process.cwd(), silent = false, version, signal }) {
  const log = createLogger({ silent, cwd, version });

  const { entries, targets } = await prepare({ patterns, inputDir, cwd, log });

  log.header("watch", inputDir);

  // Map<entryPath, { outputPath, dependencies }>. Every entry lives here even
  // when its build fails (outputPath: null), so unlink bookkeeping stays correct.
  const state = new Map();

  async function rebuild(entry) {
    try {
      const record = await buildEntry({ entry, inputDir, outputDir, targets });
      state.set(entry, {
        outputPath: record.outputPath,
        dependencies: new Set(record.dependencies),
      });
      log.built(entry, record.outputPath, record.durationMs);
      return record;
    } catch (error) {
      log.error(entry, error);
      if (!state.has(entry)) {
        state.set(entry, {
          outputPath: null,
          dependencies: new Set(error.dependencies ?? []),
        });
      }
      return null;
    }
  }

  await Promise.all(entries.map(rebuild));

  // Only inputDir is watched. @imports may reach outside it (lightningcss will
  // still bundle them), but file-system changes to those external partials do
  // not trigger rebuilds — re-save the importing entry to pick them up.
  const watcher = chokidar.watch(inputDir, {
    ignoreInitial: true,
    // Coalesce rapid writes (editor saves, formatters, fix-after-error cycles)
    // and emit one event with the latest file state. Without this, chokidar's
    // hardcoded 50ms _emit throttle silently drops a follow-up change to the
    // same path that lands inside the window.
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
  });

  // Map keyed by path gives last-event-wins semantics; the trailing-edge timer
  // collapses chokidar's editor-save bursts into a single flush. `closing`
  // gates schedule() so events that arrive during shutdown don't queue new work.
  const pending = new Map();
  let timer = null;
  let closing = false;
  const schedule = (path, event) => {
    if (closing) return;
    pending.set(path, event);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, DEBOUNCE_MS);
  };

  // Single-flight lock: concurrent flush() calls coalesce onto the in-flight
  // promise. doFlush drains `pending` in a loop, so events that arrive while
  // a flush is running are picked up before it returns — without that loop,
  // a late event would sit in `pending` until something else woke the
  // scheduler (and could be stranded indefinitely if it's the last event).
  // Errors are caught here so flush() always resolves; callers (the trailing-
  // edge timer and shutdown's await) never have to handle rejections.
  let flushing = null;
  function flush() {
    if (flushing) return flushing;
    flushing = doFlush()
      .catch((e) => log.warn(`flush failed: ${e?.message ?? e}`))
      .finally(() => {
        flushing = null;
      });
    return flushing;
  }

  async function doFlush() {
    while (pending.size > 0) {
      const events = [...pending];
      pending.clear();

      const affected = new Set();

      for (const [path, event] of events) {
        if (event === "unlink") {
          if (state.has(path)) {
            const { outputPath } = state.get(path);
            state.delete(path);
            if (outputPath) {
              try {
                await rm(outputPath, { force: true });
                log.removed(outputPath);
              } catch (e) {
                // Don't let a stuck file (EACCES/EPERM/EBUSY — common on
                // Windows when something else holds the file) take down the
                // watcher; we've already dropped the entry from state.
                log.warn(`could not remove ${outputPath}: ${e?.message ?? e}`);
              }
            }
          } else {
            for (const [entry, { dependencies }] of state) {
              if (dependencies.has(path)) affected.add(entry);
            }
          }
        } else {
          for (const [entry, { dependencies }] of state) {
            if (entry === path || dependencies.has(path)) affected.add(entry);
          }
        }
      }

      await Promise.all([...affected].map(rebuild));
    }
  }

  watcher.on("add", (path) => schedule(path, "add"));
  watcher.on("change", (path) => schedule(path, "change"));
  watcher.on("unlink", (path) => schedule(path, "unlink"));
  // Without an "error" listener, chokidar inherits EventEmitter's default of
  // crashing the process — EMFILE on Linux/macOS is the realistic trigger.
  watcher.on("error", (e) => log.warn(`watcher error: ${e?.message ?? e}`));

  await new Promise((ready) => watcher.once("ready", ready));
  log.ready();

  // The CLI — not this function — calls process.exit on the returned code.
  return await new Promise((resolveExit) => {
    const shutdown = async () => {
      // Order matters: stop accepting new events, drain the in-flight flush
      // (so we don't tear the watcher down mid-write), then close chokidar.
      closing = true;
      if (timer) clearTimeout(timer);
      await flushing;
      await watcher.close();
      resolveExit(0);
    };
    const onAbort = () => void shutdown();
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}
