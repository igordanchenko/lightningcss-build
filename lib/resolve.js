import { stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { glob } from "tinyglobby";
import { usageError } from "./errors.js";

function isGlob(pattern) {
  return /[*?[\]{}!]/.test(pattern);
}

export async function resolveEntries(patterns, cwd = process.cwd()) {
  const entries = new Set();
  const warnings = [];

  for (const pattern of patterns) {
    if (isGlob(pattern)) {
      const matches = await glob(pattern, { cwd, absolute: true, onlyFiles: true });
      if (matches.length === 0) {
        warnings.push(`warning: no files matched '${pattern}'`);
        continue;
      }
      for (const match of matches) {
        // tinyglobby returns absolute paths with forward slashes even on
        // Windows; normalize through resolve() so every entry uses the
        // platform separator and matches inputDir / state-map keys / logger
        // output produced via path.resolve().
        entries.add(resolve(match));
      }
    } else {
      entries.add(resolve(cwd, pattern));
    }
  }

  return { entries: [...entries].sort(), warnings };
}

export async function validateInputDir(inputDir) {
  let info;
  try {
    info = await stat(inputDir);
  } catch {
    throw usageError(`error: input dir '${inputDir}' does not exist`);
  }
  if (!info.isDirectory()) {
    throw usageError(`error: input dir '${inputDir}' is not a directory`);
  }
}

export function assertEntriesUnderInputDir(entries, inputDir) {
  for (const entry of entries) {
    const rel = relative(inputDir, entry);
    if (rel.startsWith(`..${sep}`) || rel === ".." || rel === "" || resolve(inputDir, rel) !== entry) {
      throw usageError(`error: entry '${entry}' is not under input dir '${inputDir}'`);
    }
  }
}
