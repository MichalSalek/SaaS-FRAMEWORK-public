/** Keep active deep-link filters visible even outside the statistics window. */
export function crawlerFilterOptions(
  values: readonly string[],
  selected: string | null | undefined
): string[] {
  const options = new Set(values);
  if (selected) {
    options.add(selected);
  }
  return [...options].sort((a, b) => a.localeCompare(b));
}
