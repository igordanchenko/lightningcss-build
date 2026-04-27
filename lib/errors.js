export function usageError(message) {
  const error = new Error(message);
  error.code = 2;
  return error;
}

export function formatBuildError(entry, error, rel = (p) => p) {
  if (error && typeof error === "object" && error.loc) {
    const { filename, line, column } = error.loc;
    return `${rel(entry)}: ${error.message} at ${rel(filename ?? entry)}:${line}:${column}`;
  }
  return `${rel(entry)}: ${error?.message ?? error}`;
}
