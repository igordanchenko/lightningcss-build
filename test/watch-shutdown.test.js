import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { createTmp, writeFiles } from "./helpers.js";

// The rest of the watch suite spawns the real CLI, but a watcher.close()
// failure can't be injected from outside the process, so this test mocks
// chokidar and drives watch() in-process instead.
vi.mock("chokidar", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    default: {
      watch() {
        const watcher = new EventEmitter();
        watcher.close = () => Promise.reject(new Error("EPERM: operation not permitted"));
        // watch() attaches its listeners synchronously after this call returns.
        setImmediate(() => watcher.emit("ready"));
        return watcher;
      },
    },
  };
});

const { watch } = await import("../lib/watch.js");

describe("watch shutdown", () => {
  test("resolves with code 0 when closing the watcher fails", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { color: red; }\n`,
    });

    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const controller = new AbortController();
    const exitCode = watch({
      patterns: ["src/a.css"],
      inputDir: join(dir, "src"),
      outputDir: join(dir, "dist"),
      cwd: dir,
      silent: true,
      version: "0.0.0-test",
      signal: controller.signal,
    });
    controller.abort();

    // A rejecting close() must neither leave watch() unsettled nor escape as
    // an unhandled rejection — it degrades to a warning and a clean exit.
    await expect(exitCode).resolves.toBe(0);
    expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("shutdown error");

    stderr.mockRestore();
  });
});
