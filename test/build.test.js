import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { createTmp, readText, runCli, writeFiles } from "./helpers.js";

describe("build", () => {
  test("single entry: inlines @imports and minifies", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/styles.css": `@import "./vars.css";\n.app { color: var(--fg); }\n`,
      "src/vars.css": `:root { --fg: #111; }\n`,
    });

    const { code } = await runCli(["src/styles.css"], { cwd: dir });
    expect(code).toBe(0);

    const out = await readText(dir, "dist/styles.css");
    expect(out).toContain(":root{--fg:#111}");
    expect(out).toContain(".app{color:var(--fg)}");
    expect(out).not.toMatch(/\n/);
  });

  test("nested entry preserves directory structure", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/themes/dark.css": `.dark { color: red; }\n`,
    });

    const { code } = await runCli(["src/themes/dark.css"], { cwd: dir });
    expect(code).toBe(0);

    expect(existsSync(join(dir, "dist/themes/dark.css"))).toBe(true);
    const out = await readText(dir, "dist/themes/dark.css");
    expect(out).toBe(".dark{color:red}");
  });

  test("glob entry produces one output per matched file, structure preserved", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { color: red; }\n`,
      "src/themes/dark.css": `.dark { color: blue; }\n`,
      "src/themes/light.css": `.light { color: green; }\n`,
    });

    const { code } = await runCli(["src/**/*.css"], { cwd: dir });
    expect(code).toBe(0);

    expect(existsSync(join(dir, "dist/a.css"))).toBe(true);
    expect(existsSync(join(dir, "dist/themes/dark.css"))).toBe(true);
    expect(existsSync(join(dir, "dist/themes/light.css"))).toBe(true);
  });

  test("mixed literal + glob entries dedupe correctly", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { color: red; }\n`,
      "src/b.css": `.b { color: blue; }\n`,
    });

    const { code } = await runCli(["src/a.css", "src/*.css"], { cwd: dir });
    expect(code).toBe(0);
    expect(existsSync(join(dir, "dist/a.css"))).toBe(true);
    expect(existsSync(join(dir, "dist/b.css"))).toBe(true);
  });

  test("entry outside inputDir exits 2", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { color: red; }\n`,
      "other/x.css": `.x { color: red; }\n`,
    });

    const { code, stderr } = await runCli(["other/x.css"], { cwd: dir });
    expect(code).toBe(2);
    expect(stderr).toContain("is not under input dir");
  });

  test("@import-only partials are not emitted as standalone outputs", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/styles.css": `@import "./vars.css";\n.app { color: var(--fg); }\n`,
      "src/vars.css": `:root { --fg: #111; }\n`,
    });

    const { code } = await runCli(["src/styles.css"], { cwd: dir });
    expect(code).toBe(0);
    expect(existsSync(join(dir, "dist/styles.css"))).toBe(true);
    expect(existsSync(join(dir, "dist/vars.css"))).toBe(false);
  });

  test("partial that is also an entry is both inlined and emitted", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/styles.css": `@import "./vars.css";\n.app { color: var(--fg); }\n`,
      "src/vars.css": `:root { --fg: #111; }\n`,
    });

    const { code } = await runCli(["src/styles.css", "src/vars.css"], { cwd: dir });
    expect(code).toBe(0);
    expect(await readText(dir, "dist/vars.css")).toBe(":root{--fg:#111}");
    expect(await readText(dir, "dist/styles.css")).toContain(":root{--fg:#111}");
  });

  test("browserslist in package.json affects output", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "package.json": JSON.stringify({ name: "t", browserslist: ["chrome 100"] }),
      "src/styles.css": `.app { color: red; & .child { color: blue; } }\n`,
    });

    const { code } = await runCli(["src/styles.css"], { cwd: dir });
    expect(code).toBe(0);
    const out = await readText(dir, "dist/styles.css");
    expect(out).not.toContain("&");
    expect(out).toContain(".app .child");
  });

  test(".browserslistrc is respected", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      ".browserslistrc": `chrome 100\n`,
      "src/styles.css": `.app { color: red; & .child { color: blue; } }\n`,
    });

    const { code } = await runCli(["src/styles.css"], { cwd: dir });
    expect(code).toBe(0);
    const out = await readText(dir, "dist/styles.css");
    expect(out).not.toContain("&");
    expect(out).toContain(".app .child");
  });

  test("no browserslist config: defaults apply, build succeeds", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/styles.css": `.app { color: red; }\n`,
    });

    const { code } = await runCli(["src/styles.css"], { cwd: dir });
    expect(code).toBe(0);
    expect(existsSync(join(dir, "dist/styles.css"))).toBe(true);
  });

  test("invalid browserslist query exits 1 with error", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "package.json": JSON.stringify({ name: "t", browserslist: ["not-a-real-query 123"] }),
      "src/styles.css": `.app { color: red; }\n`,
    });

    const { code, stderr } = await runCli(["src/styles.css"], { cwd: dir });
    expect(code).toBe(1);
    expect(stderr.length).toBeGreaterThan(0);
  });

  test("missing @import target: exit 1 with file info", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/styles.css": `@import "./does-not-exist.css";\n.a { color: red; }\n`,
    });

    const { code, stderr } = await runCli(["src/styles.css"], { cwd: dir });
    expect(code).toBe(1);
    expect(stderr).toContain("styles.css");
  });

  test("parse error: exit 1 with file:line:col", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/styles.css": `@@@ not css {\n`,
    });

    const { code, stderr } = await runCli(["src/styles.css"], { cwd: dir });
    expect(code).toBe(1);
    expect(stderr).toMatch(/styles\.css.*:\d+:\d+/);
  });

  test("unmatched glob: warning to stderr, other entries still build", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { color: red; }\n`,
    });

    const { code, stderr } = await runCli(["src/a.css", "src/nope/*.css"], {
      cwd: dir,
    });
    expect(code).toBe(0);
    expect(stderr).toContain(`no files matched 'src/nope/*.css'`);
    expect(existsSync(join(dir, "dist/a.css"))).toBe(true);
  });

  test("all unmatched globs: exit 2", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { color: red; }\n`,
    });

    const { code, stderr } = await runCli(["src/nope/*.css"], { cwd: dir });
    expect(code).toBe(2);
    expect(stderr).toContain("no files matched");
  });

  test("no entries: defaults to <input-dir>/*.css", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { color: red; }\n`,
      "src/nested/b.css": `.b { color: blue; }\n`,
    });

    const { code } = await runCli([], { cwd: dir });
    expect(code).toBe(0);
    expect(existsSync(join(dir, "dist/a.css"))).toBe(true);
    expect(existsSync(join(dir, "dist/nested/b.css"))).toBe(false);
  });

  test("no entries with custom -i: defaults to <input-dir>/*.css", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "lib/a.css": `.a { color: red; }\n`,
    });

    const { code } = await runCli(["-i", "lib"], { cwd: dir });
    expect(code).toBe(0);
    expect(existsSync(join(dir, "dist/a.css"))).toBe(true);
  });

  test("--version: prints version from package.json", async () => {
    const dir = await createTmp();
    const { code, stdout } = await runCli(["--version"], { cwd: dir });
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  });

  test("writes output files with non-empty content", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { padding: 4px; }\n`,
    });

    const { code } = await runCli(["src/a.css"], { cwd: dir });
    expect(code).toBe(0);
    const info = await stat(join(dir, "dist/a.css"));
    expect(info.size).toBeGreaterThan(0);
  });

  test("stdout: header, per-entry arrow line, summary", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { color: red; }\n`,
    });

    const { code, stdout } = await runCli(["src/a.css"], { cwd: dir });
    expect(code).toBe(0);
    expect(stdout).toContain(`lightningcss-build v${pkg.version} building src`);
    expect(stdout).toContain(`${join("src", "a.css")} → ${join("dist", "a.css")}`);
    expect(stdout).toMatch(/built 1 file in \d+ms/);
  });

  test("stdout: summary pluralizes for multiple entries", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { color: red; }\n`,
      "src/b.css": `.b { color: blue; }\n`,
    });

    const { code, stdout } = await runCli(["src/*.css"], { cwd: dir });
    expect(code).toBe(0);
    expect(stdout).toMatch(/built 2 files in \d+ms/);
  });

  test("partial failure: exit 1, summary shows X of N", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { color: red; }\n`,
      "src/b.css": `@@@ not css {\n`,
    });

    const { code, stdout, stderr } = await runCli(["src/*.css"], { cwd: dir });
    expect(code).toBe(1);
    expect(stdout).toMatch(/built 1 of 2 files in \d+ms/);
    expect(stderr).toContain("✗");
  });

  test("silent mode suppresses stdout on success", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `.a { color: red; }\n`,
    });

    const { code, stdout } = await runCli(["--silent", "src/a.css"], { cwd: dir });
    expect(code).toBe(0);
    expect(stdout).toBe("");
  });

  test("silent mode still emits stderr errors on failure", async () => {
    const dir = await createTmp();
    await writeFiles(dir, {
      "src/a.css": `@@@ not css {\n`,
    });

    const { code, stdout, stderr } = await runCli(["-s", "src/a.css"], { cwd: dir });
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("✗");
  });
});
