#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "../lib/build.js";

const HELP = `Usage: lightningcss-build [options] [entries...]

Arguments:
  [entries...]             Entry files or glob patterns (default: <input-dir>/*.css)

Options:
  -i, --input-dir <dir>    Source root; output mirrors its layout (default: src)
  -o, --output-dir <dir>   Output directory (default: dist)
  -w, --watch              Rebuild on file changes
  -s, --silent             Suppress non-error output
  -v, --version            Show version
  -h, --help               Show help
`;

let values;
let positionals;

try {
  ({ values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "input-dir": { type: "string", short: "i", default: "src" },
      "output-dir": { type: "string", short: "o", default: "dist" },
      watch: { type: "boolean", short: "w", default: false },
      silent: { type: "boolean", short: "s", default: false },
      version: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  }));
} catch (err) {
  process.stderr.write(`error: ${err.message}\n`);
  process.exit(2);
}

if (values.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "../package.json");
const { version } = JSON.parse(await readFile(pkgPath, "utf8"));

if (values.version) {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

const patterns = positionals.length > 0 ? positionals : [`${values["input-dir"]}/*.css`];

const options = {
  patterns,
  inputDir: resolve(values["input-dir"]),
  outputDir: resolve(values["output-dir"]),
  silent: values.silent,
  version,
};

try {
  if (values.watch) {
    // Own signal handling here, not inside watch(). Listeners attach before
    // watch() runs any awaits, so aborts during prepare() or the initial
    // rebuild pass are absorbed into the AbortController and exit cleanly
    // instead of hitting Node's default signal-kill.
    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort());
    process.once("SIGTERM", () => controller.abort());
    const { watch } = await import("../lib/watch.js");
    process.exit(await watch({ ...options, signal: controller.signal }));
  }
  process.exit(await build(options));
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(err.code === 2 ? 2 : 1);
}
