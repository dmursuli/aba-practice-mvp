// Graph-time validation only: never infer the provenance of a stored zero.
export function graphNumericValue(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
