import type { ReactNode } from "react";
import { CheckSquare, X } from "lucide-react";

// Selection summary shared by Student and Member Management. Selections are kept by record id,
// so they survive paging, sorting and filter changes; records hidden by the current filters stay
// selected and are counted separately.

type Props = {
  selectedCount: number;
  hiddenCount: number;          // selected records not matching the current search/filters
  filteredCount: number;        // records matching the current search/filters (all pages)
  allFilteredSelected: boolean;
  onSelectAllFiltered: () => void;
  onClear: () => void;
  noun: string;                 // "student" | "member"
  children?: ReactNode;         // page-specific bulk actions
};

export function SelectionBar({
  selectedCount, hiddenCount, filteredCount, allFilteredSelected, onSelectAllFiltered, onClear, noun, children,
}: Props) {
  if (selectedCount === 0) return null;
  const plural = (n: number) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5 border border-primary/20 rounded-xl shrink-0 flex-wrap" data-testid="selection-bar">
      <span className="text-sm font-semibold text-primary" data-testid="text-selected-count">{plural(selectedCount)} selected</span>
      {hiddenCount > 0 && (
        <span className="text-xs text-muted-foreground">({hiddenCount} not shown by the current filters)</span>
      )}
      {!allFilteredSelected && filteredCount > 0 && (
        <button type="button" onClick={onSelectAllFiltered} data-testid="button-select-all-filtered"
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <CheckSquare className="w-3.5 h-3.5" /> Select all {filteredCount} filtered results
        </button>
      )}
      {children}
      <button type="button" onClick={onClear} data-testid="button-clear-selection"
        className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-secondary">
        <X className="w-3.5 h-3.5" /> Clear selection
      </button>
    </div>
  );
}
