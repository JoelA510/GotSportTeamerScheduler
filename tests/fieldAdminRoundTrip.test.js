/**
 * The export seam: `export -> import -> export` is the identity.
 *
 * **What is being claimed, precisely.** The identity is over the **domain
 * model**, not over the four working sheets. `PHASE_8_PLAN.md` §8.4's phrase
 * "byte-stable and re-importable" must not be read as "the source CSVs are
 * reproduced byte for byte" - they cannot be, and that is the point of keeping
 * the raw cell rather than a defect in the serialiser.
 * `field_inventory.csv`'s `9v9 (1) 7v7 (2) upper (+ lower)` has no normal form;
 * 15 rows of `field_weekly_availability.csv` carry a date where an hour range
 * was meant. A serialiser reproducing those exactly would be a file copier, and
 * one "fixing" them would destroy the evidence.
 *
 * So: the export writes the domain model's own CSV, and re-reading it yields a
 * byte-identical export. That is the property a store needs.
 */

import { describe, it, expect } from 'vitest';

import {
  loadFacilityGeometry,
  loadSeason2026,
  loadSeason2026Practice,
} from '@squadlogic/core/fixtures/index.js';
import {
  buildSeason2026PracticeFacilityGraph,
  buildSeason2026VenueComplexMap,
} from '@squadlogic/core/facility/index.js';
import {
  COLUMNS,
  FIELD_ADMIN_REASON,
  FIELD_REGISTRY_DOCUMENT_VERSION,
  SUBJECT_KINDS,
  buildFieldRegistry,
  columnsFor,
  fromCsv,
  importSeason2026Fields,
  quoteCell,
  readFieldRegistry,
  serialiseFieldRegistry,
  splitCsvLine,
  toCsv,
} from '@squadlogic/core/fieldAdmin/index.js';

const season = loadSeason2026();
const practice = loadSeason2026Practice({ season });
const graph = buildSeason2026PracticeFacilityGraph(loadFacilityGeometry());
const complexMap = buildSeason2026VenueComplexMap();
const imported = importSeason2026Fields({ practice, graph, complexMap });

/** Every record a change set proposes, for one subject. */
const recordsOf = (changeSet) =>
  [...changeSet.buckets.matched, ...changeSet.buckets.differing, ...changeSet.buckets.added]
    .flatMap((subject) => subject.rows)
    .map((row) => row.record)
    .filter((record) => record !== null);

/** The subject name -> kind map this file round-trips. */
const SUBJECTS = Object.freeze([
  { name: 'blackouts', kind: 'blackout' },
  { name: 'recurringWindows', kind: 'recurring-window' },
  { name: 'permitWindows', kind: 'permit-window' },
  { name: 'venueAttributes', kind: 'venue-attributes' },
  { name: 'aliases', kind: 'alias' },
]);

/**
 * A registry per subject, built once. Ids are made unique per source file by
 * the projectors, except on the ring subjects where two rings legitimately
 * describe one code - those carry a ring-qualified id already.
 */
const registries = new Map(
  SUBJECTS.map(({ name, kind }) => [
    name,
    buildFieldRegistry({
      registryId: `season-2026-${kind}`,
      label: `season 2026 ${kind}`,
      kind,
      records: recordsOf(imported[name]),
    }),
  ])
);

describe('fieldAdmin round trip :: every subject kind is exercised', () => {
  it('round-trips every declared subject kind, not a convenient subset', () => {
    // The meta-assertion: a kind added to the model without a round-trip test
    // fails here rather than shipping unserialised.
    expect([...registries.keys()]).toHaveLength(SUBJECT_KINDS.length);
    expect(SUBJECTS.map((subject) => subject.kind).sort()).toEqual([...SUBJECT_KINDS]);
  });

  it('carries a non-zero number of records in every registry', () => {
    // A round trip over an empty set is the identity trivially. Each of these
    // must actually hold records, or the assertions below prove nothing.
    for (const [name, registry] of registries) {
      expect({ name, records: registry.records.length > 0 }).toEqual({ name, records: true });
    }
  });
});

describe('fieldAdmin round trip :: export then import is the identity', () => {
  for (const { name } of SUBJECTS) {
    it(`is byte-identical across a round trip for ${name}`, () => {
      const registry = registries.get(name);
      const once = toCsv(serialiseFieldRegistry(registry));
      const document = fromCsv(once, {
        registryId: registry.registryId,
        label: registry.label,
        kind: registry.kind,
      });
      const twice = toCsv(serialiseFieldRegistry(readFieldRegistry(document)));
      expect(twice).toBe(once);
    });
  }

  it('can fail, on a single changed cell that is still valid', () => {
    // The positive control. A round trip that cannot be made to fail is not a
    // round trip; this proves the comparison above is doing work.
    //
    // The tamper has to stay *valid*, or the reader refuses it and this passes
    // for the wrong reason - which is what the first version of this control
    // did: it shifted every date a year, `fromDate` overtook `toDate`, and the
    // schema threw. That proves the schema works, not the comparison. Swapping
    // one enum value for another leaves a document the reader accepts and the
    // comparison must still reject.
    const registry = registries.get('blackouts');
    const once = toCsv(serialiseFieldRegistry(registry));
    expect(once).toContain('school-event');
    const tampered = once.replace('school-event', 'weather');
    expect(tampered).not.toBe(once);
    const document = fromCsv(tampered, {
      registryId: registry.registryId,
      label: registry.label,
      kind: registry.kind,
    });
    // Read back without complaint - the point of this control.
    const twice = toCsv(serialiseFieldRegistry(readFieldRegistry(document)));
    expect(twice).not.toBe(once);
  });

  it('refuses a tampered cell that breaks an invariant, rather than round-tripping it', () => {
    // The other half, and a separate guarantee: a document edited into an
    // impossible state is refused on read rather than quietly re-exported.
    const registry = registries.get('blackouts');
    const once = toCsv(serialiseFieldRegistry(registry));
    const impossible = once.replace(/2026-/g, '2027-').replace('2027-08-01', '2028-08-01');
    const document = fromCsv(impossible, {
      registryId: registry.registryId,
      label: registry.label,
      kind: registry.kind,
    });
    expect(() => readFieldRegistry(document)).toThrow(/fromDate must not be after toDate/);
  });

  it('is stable against the input order of the records', () => {
    // Row order is a declared sort, not the order the projector happened to
    // emit. Without it a re-import in a different order writes a different file
    // and every diff is noise.
    const registry = registries.get('recurringWindows');
    const reversed = buildFieldRegistry({
      registryId: registry.registryId,
      label: registry.label,
      kind: registry.kind,
      records: [...registry.records].reverse(),
    });
    expect(toCsv(serialiseFieldRegistry(reversed))).toBe(toCsv(serialiseFieldRegistry(registry)));
  });
});

describe('fieldAdmin round trip :: the document is validated in both directions', () => {
  it('stamps a version', () => {
    const document = serialiseFieldRegistry(registries.get('aliases'));
    expect(document.version).toBe(FIELD_REGISTRY_DOCUMENT_VERSION);
  });

  it('refuses a document with an unknown key', () => {
    const document = serialiseFieldRegistry(registries.get('aliases'));
    expect(() => readFieldRegistry({ ...document, sneaked: true })).toThrow();
  });

  it('refuses a document whose kind is not a subject kind', () => {
    const document = serialiseFieldRegistry(registries.get('aliases'));
    expect(() => readFieldRegistry({ ...document, kind: 'invented' })).toThrow();
  });

  it('refuses a record that no longer satisfies its schema', () => {
    // There is no fast path that trusts a document because this module wrote
    // it, so a store with its own opinions about a value is caught on read.
    const document = serialiseFieldRegistry(registries.get('blackouts'));
    const broken = {
      ...document,
      records: [{ ...document.records[0], fromDate: 'not-a-date' }, ...document.records.slice(1)],
    };
    expect(() => readFieldRegistry(broken)).toThrow();
  });

  it('refuses a duplicate record id', () => {
    const registry = registries.get('blackouts');
    expect(() =>
      buildFieldRegistry({
        registryId: registry.registryId,
        label: registry.label,
        kind: registry.kind,
        records: [registry.records[0], registry.records[0]],
      })
    ).toThrow(/duplicate record id/);
  });
});

describe('fieldAdmin round trip :: the CSV grammar', () => {
  it('quotes only what needs quoting', () => {
    expect(quoteCell('plain')).toBe('plain');
    expect(quoteCell('has,comma')).toBe('"has,comma"');
    expect(quoteCell('has"quote')).toBe('"has""quote"');
    expect(quoteCell(' leading')).toBe('" leading"');
    expect(quoteCell('trailing ')).toBe('"trailing "');
    expect(quoteCell('has\nnewline')).toBe('"has\nnewline"');
  });

  it('reads back everything it writes, including the awkward cells', () => {
    // The writer's grammar and the reader's are the same grammar; this is what
    // stops them drifting.
    const cells = ['plain', 'has,comma', 'has"quote', ' leading', 'trailing ', '', 'a b'];
    expect(splitCsvLine(cells.map(quoteCell).join(','))).toEqual(cells);
  });

  it('refuses an unterminated quote rather than guessing', () => {
    expect(() => splitCsvLine('"never closed')).toThrow(/unterminated quote/);
  });

  it('writes a header in the frozen column order and refuses any other', () => {
    const registry = registries.get('blackouts');
    const text = toCsv(serialiseFieldRegistry(registry));
    expect(text.split('\n')[0]).toBe(COLUMNS.blackout.join(','));
    const reordered = [...COLUMNS.blackout].reverse().join(',');
    const swapped = text.replace(COLUMNS.blackout.join(','), reordered);
    expect(() =>
      fromCsv(swapped, {
        registryId: registry.registryId,
        label: registry.label,
        kind: registry.kind,
      })
    ).toThrow(/header is/);
  });

  it('ends every file with exactly one newline and no BOM', () => {
    for (const registry of registries.values()) {
      const text = toCsv(serialiseFieldRegistry(registry));
      expect(text.endsWith('\n')).toBe(true);
      expect(text.endsWith('\n\n')).toBe(false);
      expect(text.charCodeAt(0)).not.toBe(0xfeff);
      expect(text.includes('\r')).toBe(false);
    }
  });

  it('names the union when asked for a kind it has no columns for', () => {
    expect(() => columnsFor('invented')).toThrow(/has no column order/);
  });
});

describe('fieldAdmin round trip :: the seam admits it persists nothing', () => {
  it('says so on every registry it builds', () => {
    for (const [name, registry] of registries) {
      const codes = registry.findings.map((finding) => finding.code);
      expect({ name, declared: codes.includes(FIELD_ADMIN_REASON.REGISTRY_NOT_PERSISTED) }).toEqual(
        { name, declared: true }
      );
    }
  });
});
