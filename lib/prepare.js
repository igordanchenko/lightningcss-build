import { usageError } from "./errors.js";
import { assertEntriesUnderInputDir, resolveEntries, validateInputDir } from "./resolve.js";
import { resolveTargets } from "./targets.js";

export async function prepare({ patterns, inputDir, cwd = process.cwd(), log }) {
  await validateInputDir(inputDir);

  const targets = resolveTargets(cwd);

  const { entries, warnings } = await resolveEntries(patterns, cwd);
  for (const warning of warnings) {
    log.warn(warning);
  }
  if (entries.length === 0) {
    throw usageError("error: no files matched any of the provided entries");
  }

  assertEntriesUnderInputDir(entries, inputDir);

  return { entries, targets };
}
