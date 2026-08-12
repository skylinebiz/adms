import { useCallback, useState } from "react";

// Checkbox multi-select state for a list of row ids, shared by every
// "select rows then bulk-act" table in the admin UI (retry, delete, ...).
export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Toggles between "all of `ids` selected" and "none selected" - if some
  // but not all are already selected, this selects the rest (fills to all).
  const toggleAll = useCallback((ids: string[]) => {
    setSelected((s) => {
      const allSelected = ids.length > 0 && ids.every((id) => s.has(id));
      return allSelected ? new Set() : new Set(ids);
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  return { selected, toggle, toggleAll, clear };
}
