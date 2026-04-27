import browserslist from "browserslist";
import { browserslistToTargets } from "lightningcss";

export function resolveTargets(cwd = process.cwd()) {
  const queries = browserslist(undefined, { path: cwd });
  return browserslistToTargets(queries);
}
