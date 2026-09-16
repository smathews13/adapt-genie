export function orderedWatchlistTitles(
  availableTitles: readonly string[],
  selectedTitles: readonly string[],
  query: string
): string[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matching = availableTitles.filter((title) => title.toLocaleLowerCase().includes(normalizedQuery));
  if (normalizedQuery) return matching;

  const selected = new Set(selectedTitles);
  return [...matching].sort(
    (left, right) =>
      Number(selected.has(right)) - Number(selected.has(left)) ||
      left.localeCompare(right, undefined, { sensitivity: 'base' })
  );
}
