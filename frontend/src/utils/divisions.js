/**
 * Division display helpers for the org-level gender model
 * (feature key `gender_model`: 'split' | 'coed').
 *
 * Stored truth stays gendered: division rows keep their gendered names
 * ("U10 Girls", "U8B") and `gender_policy`. Under the 'coed' model the UI
 * collapses gendered labels into the shared age label ("U10"), except where
 * an explicit merge has produced a real coed division.
 */

const GENDER_SUFFIX_RE = /\s*(?:girls?|boys?|coed|co-ed)\s*$/i;
const COMPACT_RE = /^(u\d+)\s*([bg])$/i;

/** "U10 Girls" / "U8B" / "u12" → 10 / 8 / 12 (null when unparsable). */
export function divisionAge(name) {
  const match = /u\s*(\d+)/i.exec(name || '');
  return match ? Number(match[1]) : null;
}

/** Gender letter from a division name: 'B' | 'G' | null (coed/unknown). */
export function divisionGenderLetter(name) {
  if (!name) return null;
  const compact = COMPACT_RE.exec(name.trim());
  if (compact) return compact[2].toUpperCase();
  if (/girls?$/i.test(name.trim())) return 'G';
  if (/boys?$/i.test(name.trim())) return 'B';
  return null;
}

/** Strip the gender marker: "U10 Girls" → "U10", "U8B" → "U8". */
export function divisionBaseName(name) {
  if (!name) return '';
  const trimmed = name.trim();
  const compact = COMPACT_RE.exec(trimmed);
  if (compact) return compact[1].toUpperCase();
  return trimmed.replace(GENDER_SUFFIX_RE, '');
}

/**
 * Display label for a division name under the active gender model.
 * - 'split': gendered names render as-is.
 * - 'coed': gendered names collapse to the base age label.
 */
export function divisionDisplayName(name, genderModel) {
  if (genderModel !== 'coed') return name || '';
  return divisionBaseName(name) || name || '';
}

/**
 * Collapse a division list into UI filter options for the active model.
 * Returns [{ key, label, divisionIds, names }] sorted by age then label.
 * Under 'coed', U10 Girls + U10 Boys fold into one "U10" option carrying
 * both division ids.
 */
export function divisionFilters(divisions, genderModel) {
  const byKey = new Map();
  (divisions || []).forEach((division) => {
    const label = divisionDisplayName(division.name, genderModel);
    const key = label.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, { key, label, divisionIds: [], names: [] });
    }
    const entry = byKey.get(key);
    entry.divisionIds.push(division.id);
    entry.names.push(division.name);
  });
  return [...byKey.values()].sort((a, b) => {
    const ageA = divisionAge(a.label);
    const ageB = divisionAge(b.label);
    if (ageA != null && ageB != null && ageA !== ageB) return ageA - ageB;
    return a.label.localeCompare(b.label);
  });
}
