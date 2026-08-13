import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { bundleAsync } from "lightningcss";
import { createLogger } from "./log.js";
import { prepare } from "./prepare.js";

export async function build({ patterns, inputDir, outputDir, cwd = process.cwd(), silent = false, version }) {
  const log = createLogger({ silent, cwd, version });

  const { entries, targets } = await prepare({ patterns, inputDir, outputDir, cwd, log });

  log.header("build", inputDir);

  const start = performance.now();
  // allSettled so one failing entry doesn't cancel the others. No concurrency
  // limiter: lightningcss is a Rust binding that runs on libuv's thread pool,
  // so real parallelism is already bounded no matter how many promises we queue.
  const results = await Promise.allSettled(entries.map((entry) => buildEntry({ entry, inputDir, outputDir, targets })));
  const totalMs = performance.now() - start;

  let builtCount = 0;
  for (let i = 0; i < results.length; i += 1) {
    if (results[i].status === "fulfilled") {
      builtCount += 1;
      log.built(entries[i], results[i].value.outputPath, results[i].value.durationMs);
    } else {
      log.error(entries[i], results[i].reason);
    }
  }

  log.summary(builtCount, results.length, totalMs);

  return builtCount < results.length ? 1 : 0;
}

export async function buildEntry({ entry, inputDir, outputDir, targets }) {
  // Every file lightningcss reads flows through this resolver — we piggyback on
  // it to capture the per-entry dep graph that watch mode needs for rebuilds.
  const dependencies = new Set();
  const resolver = {
    async read(filePath) {
      dependencies.add(resolve(filePath));
      return readFile(filePath, "utf8");
    },
  };
  // The entry reaches the resolver too — drop it so the dep list is imports
  // only. Success and failure paths must report the same list (watch mode's
  // rebuild bookkeeping relies on it), so both go through this helper.
  const listDependencies = () => [...dependencies].filter((dep) => dep !== entry);

  const start = performance.now();
  try {
    const { code } = await bundleAsync({
      filename: entry,
      minify: true,
      targets,
      resolver,
    });

    const outputPath = resolve(outputDir, relative(inputDir, entry));
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, code);

    return {
      entry,
      outputPath,
      dependencies: listDependencies(),
      durationMs: performance.now() - start,
    };
  } catch (error) {
    // Surface whatever lightningcss did read before failing so watch mode can
    // wire those files into the dep graph of a failed entry. This covers the
    // write path too: a bundle that succeeded but couldn't be written (EACCES,
    // ENOTDIR) still knows its full dep list, and losing it would leave the
    // entry watching nothing once the user fixes the output dir.
    error.dependencies = listDependencies();
    throw error;
  }
}
