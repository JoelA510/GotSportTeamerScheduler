/**
 * CSV template generators for the three import types (players / coaches /
 * fields). Users click "Download Template" in ImportPanel to get a .csv
 * with the expected header row + one example row they can replace.
 *
 * Header labels use the human-friendly form (e.g. "First Name") rather than
 * the canonical snake_case — the import pipeline's alias map in
 * `src/utils/telemetryUtils.js` normalizes them back on upload, and the
 * friendlier form is easier to hand to club admins.
 *
 * Required columns mirror `REQUIRED_HEADERS` in `ImportContext.jsx` and
 * `REQUIRED_FIELDS` in `supabase/functions/import-validation/index.ts`. Add
 * the common optional columns so users discover what else they can include.
 */

export const CSV_TEMPLATES = {
  players: {
    headers: ['First Name', 'Last Name', 'Date of Birth', 'Medical Info', 'Skill Tier'],
    example: ['Jane', 'Doe', '2015-03-14', 'None', 'developing'],
    filename: 'squadlogic-players-template.csv',
  },
  coaches: {
    headers: ['Full Name', 'Email', 'Willing to Coach'],
    example: ['Alex Smith', 'coach@example.com', 'yes'],
    filename: 'squadlogic-coaches-template.csv',
  },
  fields: {
    headers: ['Name'],
    example: ['Main Field 1'],
    filename: 'squadlogic-fields-template.csv',
  },
};

/**
 * RFC-4180-compliant quoting: wrap a cell in double quotes only if it
 * contains a quote, comma, or newline, and escape embedded quotes by
 * doubling them.
 */
function escapeCsvCell(cell) {
  const str = String(cell ?? '');
  if (/["\n,]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(rows) {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

/**
 * Generate a template CSV and trigger a browser download.
 * @param {'players'|'coaches'|'fields'} type
 */
export function downloadTemplate(type) {
  const tmpl = CSV_TEMPLATES[type];
  if (!tmpl) return;

  const csv = toCsv([tmpl.headers, tmpl.example]);
  // Prepend UTF-8 BOM so Excel opens it with the right encoding.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = tmpl.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
