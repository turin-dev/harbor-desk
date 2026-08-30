export function filterRowsByQuery<T>(
  rows: readonly T[],
  fields: (row: T) => string[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) =>
    fields(row).some((value) => value.toLowerCase().includes(needle)),
  );
}
