import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createTmp, readText, sleep, startWatcher, writeFiles } from "./helpers.js";

const INITIAL_TIMEOUT = 5_000;
const REBUILD_TIMEOUT = 5_000;

async function waitBuilt(watcher, src, dst, { since = 0, ...opts } = {}) {
  return watcher.waitFor((out) => out.slice(since).includes(`${src} → ${dst}`), opts);
}

describe("watch", () => {
  test("modifying an entry rebuilds only that entry", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { color: red; }\n`,
      "src/b.css": `.b { color: blue; }\n`,
    });

    const watcher = startWatcher(["src/*.css"], { cwd: dir });
    await watcher.waitForLine("ready", { timeout: INITIAL_TIMEOUT });

    const before = watcher.stdout.length;
    await writeFile(join(dir, "src/a.css"), `.a { color: green; }\n`);
    await waitBuilt(watcher, join("src", "a.css"), join("dist", "a.css"), {
      since: before,
      timeout: REBUILD_TIMEOUT,
    });
    await sleep(100);

    const since = watcher.stdout.slice(before);
    expect(since).toContain(`${join("src", "a.css")} → ${join("dist", "a.css")}`);
    expect(since).not.toContain(`${join("src", "b.css")} → ${join("dist", "b.css")}`);
    expect(await readText(dir, "dist/a.css")).toContain("green");

    await watcher.shutdown();
  });

  test("modifying a shared partial rebuilds all importers, not siblings", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/one.css": `@import "./vars.css";\n.one { color: var(--fg); }\n`,
      "src/two.css": `@import "./vars.css";\n.two { color: var(--fg); }\n`,
      "src/three.css": `.three { color: red; }\n`,
      "src/vars.css": `:root { --fg: #111; }\n`,
    });

    const watcher = startWatcher(["src/one.css", "src/two.css", "src/three.css"], { cwd: dir });
    await watcher.waitForLine("ready", { timeout: INITIAL_TIMEOUT });

    const before = watcher.stdout.length;
    await writeFile(join(dir, "src/vars.css"), `:root { --fg: #222; }\n`);
    await waitBuilt(watcher, join("src", "one.css"), join("dist", "one.css"), {
      since: before,
      timeout: REBUILD_TIMEOUT,
    });
    await waitBuilt(watcher, join("src", "two.css"), join("dist", "two.css"), {
      since: before,
      timeout: REBUILD_TIMEOUT,
    });
    await sleep(100);

    const since = watcher.stdout.slice(before);
    expect(since).toContain(`${join("src", "one.css")} → ${join("dist", "one.css")}`);
    expect(since).toContain(`${join("src", "two.css")} → ${join("dist", "two.css")}`);
    expect(since).not.toContain(`${join("src", "three.css")} → ${join("dist", "three.css")}`);
    expect(await readText(dir, "dist/one.css")).toContain("#222");

    await watcher.shutdown();
  });

  test("modifying a file not in any dep graph rebuilds nothing", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { color: red; }\n`,
      "src/unrelated.txt": `hello\n`,
    });

    const watcher = startWatcher(["src/a.css"], { cwd: dir });
    await watcher.waitForLine("ready", { timeout: INITIAL_TIMEOUT });

    const before = watcher.stdout.length;
    await writeFile(join(dir, "src/unrelated.txt"), `world\n`);
    await sleep(200);
    expect(watcher.stdout.slice(before)).toBe("");

    await watcher.shutdown();
  });

  test("parse error preserves prior output and keeps watcher running", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { color: red; }\n`,
    });

    const watcher = startWatcher(["src/a.css"], { cwd: dir });
    await watcher.waitForLine("ready", { timeout: INITIAL_TIMEOUT });
    const good = await readText(dir, "dist/a.css");

    const beforeErr = watcher.stderr.length;
    await writeFile(join(dir, "src/a.css"), `@@@ not css {\n`);
    await watcher.waitFor((_, err) => err.slice(beforeErr).includes("✗"), {
      timeout: REBUILD_TIMEOUT,
    });
    expect(await readText(dir, "dist/a.css")).toBe(good);

    const beforeFix = watcher.stdout.length;
    await writeFile(join(dir, "src/a.css"), `.a { color: #00f; }\n`);
    await waitBuilt(watcher, join("src", "a.css"), join("dist", "a.css"), {
      since: beforeFix,
      timeout: REBUILD_TIMEOUT,
    });
    expect(watcher.stdout.slice(beforeFix)).toContain(`${join("src", "a.css")} → ${join("dist", "a.css")}`);
    expect(await readText(dir, "dist/a.css")).toContain("#00f");

    await watcher.shutdown();
  });

  test("deleting an imported partial surfaces an error", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `@import "./vars.css";\n.a { color: var(--fg); }\n`,
      "src/vars.css": `:root { --fg: #111; }\n`,
    });

    const watcher = startWatcher(["src/a.css"], { cwd: dir });
    await watcher.waitForLine("ready", { timeout: INITIAL_TIMEOUT });

    const beforeErr = watcher.stderr.length;
    await rm(join(dir, "src/vars.css"));
    await watcher.waitFor((_, err) => err.slice(beforeErr).includes("✗"), {
      timeout: REBUILD_TIMEOUT,
    });

    const beforeFix = watcher.stdout.length;
    await writeFile(join(dir, "src/vars.css"), `:root { --fg: #333; }\n`);
    await waitBuilt(watcher, join("src", "a.css"), join("dist", "a.css"), {
      since: beforeFix,
      timeout: REBUILD_TIMEOUT,
    });
    expect(watcher.stdout.slice(beforeFix)).toContain(`${join("src", "a.css")} → ${join("dist", "a.css")}`);

    await watcher.shutdown();
  });

  test("entry with failed initial build recovers when missing import is created", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `@import "./missing.css";\n.a { color: red; }\n`,
    });

    const watcher = startWatcher(["src/a.css"], { cwd: dir });
    await watcher.waitFor((_, err) => err.includes("✗"), { timeout: INITIAL_TIMEOUT });
    await watcher.waitForLine("ready", { timeout: INITIAL_TIMEOUT });

    const beforeFix = watcher.stdout.length;
    await writeFile(join(dir, "src/missing.css"), `:root { --fg: #111; }\n`);
    await waitBuilt(watcher, join("src", "a.css"), join("dist", "a.css"), {
      since: beforeFix,
      timeout: REBUILD_TIMEOUT,
    });
    expect(existsSync(join(dir, "dist/a.css"))).toBe(true);

    await watcher.shutdown();
  });

  test("deleting a known entry removes its output", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { color: red; }\n`,
      "src/b.css": `.b { color: blue; }\n`,
    });

    const watcher = startWatcher(["src/*.css"], { cwd: dir });
    await watcher.waitForLine("ready", { timeout: INITIAL_TIMEOUT });
    expect(existsSync(join(dir, "dist/b.css"))).toBe(true);

    await rm(join(dir, "src/b.css"));
    await watcher.waitFor((out) => out.includes(`removed ${join("dist", "b.css")}`), {
      timeout: REBUILD_TIMEOUT,
    });
    expect(existsSync(join(dir, "dist/b.css"))).toBe(false);
    expect(existsSync(join(dir, "dist/a.css"))).toBe(true);

    await watcher.shutdown();
  });

  test("new file under inputDir is ignored (entries are fixed at startup)", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { color: red; }\n`,
    });

    const watcher = startWatcher(["src/*.css"], { cwd: dir });
    await watcher.waitForLine("ready", { timeout: INITIAL_TIMEOUT });

    const before = watcher.stdout.length;
    await writeFile(join(dir, "src/b.css"), `.b { color: #00f; }\n`);
    await sleep(200);
    expect(watcher.stdout.slice(before)).toBe("");
    expect(existsSync(join(dir, "dist/b.css"))).toBe(false);

    await watcher.shutdown();
  });

  // Skipped on Windows: child.kill("SIGINT") from Node doesn't deliver SIGINT
  // (Windows has no real signals; the process is killed forcefully and exitCode
  // comes back null). Real Ctrl+C in a console works because Windows generates
  // CTRL_C_EVENT, but that path isn't reachable from a spawned child.
  test.skipIf(process.platform === "win32")("SIGINT exits cleanly with code 0", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { color: red; }\n`,
    });

    const watcher = startWatcher(["src/a.css"], { cwd: dir });
    await watcher.waitForLine("ready", { timeout: INITIAL_TIMEOUT });

    const exitCode = await watcher.shutdown();
    expect(exitCode).toBe(0);
  });

  test("silent mode suppresses stdout but not stderr errors", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `@@@ not css {\n`,
    });

    const watcher = startWatcher(["--silent", "src/a.css"], { cwd: dir });
    await watcher.waitFor((_, err) => err.includes("✗"), { timeout: INITIAL_TIMEOUT });
    await sleep(200);
    expect(watcher.stdout).toBe("");

    await watcher.shutdown();
  });
});
