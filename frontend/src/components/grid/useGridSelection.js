/**
 * Selection helpers for DataGrid. `selected` is a controlled Set of row ids;
 * `view` is the filtered+sorted row array currently displayed.
 */
export function useGridSelection({ view, getRowId, selected, setSelected }) {
  const localSel = selected || new Set();

  const allSel = view.length > 0 && view.every((row) => localSel.has(getRowId(row)));
  const someSel = view.some((row) => localSel.has(getRowId(row)));

  const toggleAll = () => {
    if (!setSelected) return;
    const next = new Set(localSel);
    if (allSel) view.forEach((row) => next.delete(getRowId(row)));
    else view.forEach((row) => next.add(getRowId(row)));
    setSelected(next);
  };

  const toggleRow = (id) => {
    if (!setSelected) return;
    const next = new Set(localSel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return { localSel, allSel, someSel, toggleAll, toggleRow };
}
