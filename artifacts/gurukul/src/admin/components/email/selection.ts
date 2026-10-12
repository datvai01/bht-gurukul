// Row selection shared by Student and Member Management. Selections are sets of record ids, so
// they are unaffected by paging, sorting and filtering; "filtered" means every record matching
// the current search and filters across all pages.

export function toggleId<T>(selected: ReadonlySet<T>, id: T): Set<T> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** Header checkbox: selects the visible page, or clears it when the whole page is selected. */
export function togglePage<T>(selected: ReadonlySet<T>, pageIds: readonly T[]): Set<T> {
  const next = new Set(selected);
  const allSelected = pageIds.length > 0 && pageIds.every(id => next.has(id));
  for (const id of pageIds) {
    if (allSelected) next.delete(id); else next.add(id);
  }
  return next;
}

/** "Select all filtered results": adds every matching record, on every page. */
export function addAll<T>(selected: ReadonlySet<T>, ids: readonly T[]): Set<T> {
  const next = new Set(selected);
  for (const id of ids) next.add(id);
  return next;
}

export function allSelected<T>(selected: ReadonlySet<T>, ids: readonly T[]): boolean {
  return ids.length > 0 && ids.every(id => selected.has(id));
}

/** Selected records that the current filters hide (they stay selected). */
export function hiddenCount<T>(selected: ReadonlySet<T>, filteredIds: ReadonlySet<T>): number {
  let count = 0;
  for (const id of selected) if (!filteredIds.has(id)) count++;
  return count;
}

/** Keeps only selections whose records still exist (after a reload or delete). */
export function keepExisting<T>(selected: ReadonlySet<T>, existingIds: readonly T[]): ReadonlySet<T> {
  const existing = new Set(existingIds);
  const kept = [...selected].filter(id => existing.has(id));
  return kept.length === selected.size ? selected : new Set(kept);
}
