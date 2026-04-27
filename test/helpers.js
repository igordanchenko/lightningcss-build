import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { onTestFinished } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, "..", "bin", "cli.js");

export async function createTmp() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "lcb-")));
  onTestFinished(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

export async function writeFiles(dir, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const full = join(dir, relativePath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}

export async function readText(dir, relativePath) {
  return readFile(join(dir, relativePath), "utf8");
}

export function runCli(args, { cwd }) {
  return new Promise((resolvePromise) => {
    const proc = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => (stdout += c));
    proc.stderr.on("data", (c) => (stderr += c));
    proc.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

export function startWatcher(args, { cwd }) {
  const proc = spawn(process.execPath, [CLI, ...args, "-w"], {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
  });
  let stdout = "";
  let stderr = "";
  const listeners = [];

  proc.stdout.on("data", (chunk) => {
    stdout += chunk;
    for (const listener of [...listeners]) listener(stdout, stderr);
  });
  proc.stderr.on("data", (chunk) => {
    stderr += chunk;
    for (const listener of [...listeners]) listener(stdout, stderr);
  });

  const exited = new Promise((resolvePromise) => {
    proc.on("close", (code) => resolvePromise(code));
  });

  onTestFinished(async () => {
    if (proc.exitCode === null) {
      proc.kill("SIGINT");
      await exited;
    }
  });

  function waitFor(predicate, { timeout = 5_000 } = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
      const check = (out, err) => {
        if (predicate(out, err)) {
          const idx = listeners.indexOf(check);
          if (idx !== -1) listeners.splice(idx, 1);
          clearTimeout(timer);
          resolvePromise({ stdout, stderr });
        }
      };
      const timer = setTimeout(() => {
        const idx = listeners.indexOf(check);
        if (idx !== -1) listeners.splice(idx, 1);
        rejectPromise(new Error(`timeout waiting for predicate\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }, timeout);
      listeners.push(check);
      check(stdout, stderr);
    });
  }

  return {
    proc,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    waitFor,
    waitForLine(substring, opts) {
      return waitFor((out) => out.includes(substring), opts);
    },
    shutdown: async () => {
      if (proc.exitCode === null) proc.kill("SIGINT");
      return exited;
    },
  };
}

export async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}
