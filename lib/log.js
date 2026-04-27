import { relative } from "node:path";
import pc from "picocolors";
import { formatBuildError } from "./errors.js";

export function createLogger({ cwd = process.cwd(), silent = false, version }) {
  const rel = (p) => relative(cwd, p) || ".";

  const out = (line) => {
    if (!silent) process.stdout.write(`${line}\n`);
  };

  const err = (line) => {
    process.stderr.write(`${line}\n`);
  };

  return {
    header(mode, inputDir) {
      const verb = mode === "watch" ? "watching" : "building";
      out(`${pc.bold(`lightningcss-build v${version}`)} ${pc.dim(`${verb} ${rel(inputDir)}...`)}`);
    },
    built(src, dst, durationMs) {
      out(`${pc.green("✓")} ${rel(src)} → ${rel(dst)} ${pc.dim(`(${Math.round(durationMs)}ms)`)}`);
    },
    removed(dst) {
      out(`${pc.green("✓")} removed ${rel(dst)}`);
    },
    ready() {
      out(pc.dim("ready"));
    },
    warn(message) {
      err(`${pc.yellow("⚠")} ${message}`);
    },
    summary(builtCount, total, durationMs) {
      const noun = total === 1 ? "file" : "files";
      const body =
        builtCount < total
          ? `built ${builtCount} of ${total} ${noun} in ${Math.round(durationMs)}ms`
          : `built ${total} ${noun} in ${Math.round(durationMs)}ms`;
      out(pc.dim(body));
    },
    error(entry, e) {
      err(`${pc.red("✗")} ${formatBuildError(entry, e, rel)}`);
    },
  };
}
