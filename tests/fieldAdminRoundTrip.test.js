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
  everySubject,
  columnsFor,
  fromCsv,
  importSeason2026Fields,
  quoteCell,
  readCell,
  readFieldRegistry,
  renderCell,
  serialiseFieldRegistry,
  splitCsvLine,
  splitCsvRecords,
  toCsv,
} from '@squadlogic/core/fieldAdmin/index.js';

const season = loadSeason2026();
const practice = loadSeason2026Practice({ season });
const graph = buildSeason2026PracticeFacilityGraph(loadFacilityGeometry());
const complexMap = buildSeason2026VenueComplexMap();
const imported = importSeason2026Fields({ practice, graph, complexMap });

/** Every record a change set proposes, for one subject. */
const recordsOf = (changeSet) =>
  everySubject(changeSet)
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
/** Every permit record, for the service-value enumeration below. */
const permitRecords = recordsOf(imported.permitWindows);

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

  it('is the identity on the RECORDS, not only on the bytes', () => {
    // **"Export then import is the identity" is a claim about records.** The
    // byte assertion above cannot see a value that changes while its rendering
    // does not: measured, `notesText: ''` came back as `null` with the file
    // byte-identical, because `''` and an absent value both rendered empty.
    //
    // So the records are compared too, and this assertion is the one that
    // would have caught it.
    for (const { name } of SUBJECTS) {
      const registry = registries.get(name);
      const document = fromCsv(toCsv(serialiseFieldRegistry(registry)), {
        registryId: registry.registryId,
        label: registry.label,
        kind: registry.kind,
      });
      const back = readFieldRegistry(document);
      expect({ subject: name, count: back.records.length }).toEqual({
        subject: name,
        count: registry.records.length,
      });
      const before = [...registry.records].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const after = [...back.records].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      expect({ subject: name, records: after }).toEqual({ subject: name, records: before });
    }
  });

  it('normalises an empty string to absent, so the two cannot diverge', () => {
    // The measured instance. Five nullable string columns and `NoteSchema`
    // accept `''`, and the two are different values: `''` is "the operator
    // wrote nothing here", `null` is "no value was ever set".
    const registry = registries.get('venueAttributes');
    const withEmpty = registry.records.map((record, index) =>
      index === 0 ? { ...record, notesText: '' } : record
    );
    const rebuilt = buildFieldRegistry({
      registryId: registry.registryId,
      label: registry.label,
      kind: registry.kind,
      records: withEmpty,
    });
    const back = readFieldRegistry(
      fromCsv(toCsv(serialiseFieldRegistry(rebuilt)), {
        registryId: registry.registryId,
        label: registry.label,
        kind: registry.kind,
      })
    );
    // Normalised at the schema boundary, so the value that reaches the page is
    // already `null` and the round trip is the identity on it.
    expect(rebuilt.records.find((record) => record.id === withEmpty[0].id).notesText).toBeNull();
    const subject = back.records.find((record) => record.id === withEmpty[0].id);
    expect(subject.notesText).toBeNull();
    // ... and `null` still round-trips as `null`, so the two stay distinct.
    const withNull = registry.records.map((record, index) =>
      index === 0 ? { ...record, notesText: null } : record
    );
    const nullBack = readFieldRegistry(
      fromCsv(
        toCsv(
          serialiseFieldRegistry(
            buildFieldRegistry({
              registryId: registry.registryId,
              label: registry.label,
              kind: registry.kind,
              records: withNull,
            })
          )
        ),
        { registryId: registry.registryId, label: registry.label, kind: registry.kind }
      )
    );
    expect(nullBack.records.find((record) => record.id === withNull[0].id).notesText).toBeNull();
  });

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

describe('fieldAdmin round trip :: a re-import of an export changes nothing', () => {
  // **The regression test for the two-key-space defect.** `buildChangeSet()`
  // once keyed the held side on `keyFields` and the proposed side on each
  // projector's own `subjectKey` string. The two could never collide for
  // `blackouts`, `recurringWindows` or `permitWindows`, so re-importing the
  // corpus against its own output reported every subject as both `removed` and
  // `added` - eleven blocking findings for identical input. Every test held an
  // empty current state, so nothing saw it.
  //
  // This is the shape that catches it: hand the importer what it just produced
  // and require the change set to be a no-op.
  for (const { name } of SUBJECTS) {
    it(`re-imports ${name} as entirely matched`, () => {
      const changeSet = imported[name];
      const held = recordsOf(changeSet);
      const reimported = importSeason2026Fields({
        practice,
        graph,
        complexMap,
        held: { [name]: held },
      })[name];

      // Nothing vanished and nothing appeared.
      expect({
        subject: name,
        removed: reimported.buckets.removed.length,
        added: reimported.buckets.added.length,
      }).toEqual({ subject: name, removed: 0, added: 0 });

      // ... and the comparison actually ran, so this is not passing by
      // comparing an empty set against an empty set.
      expect(reimported.meta.currentSubjectsRead).toBe(held.length);
      expect(reimported.meta.fieldComparisons).toBeGreaterThan(0);

      // **Every held record is accounted for**, which `removed === 0` does not
      // say: a map that last-won on a duplicate identity satisfied that
      // assertion while dropping 20 of 47 alias records with nothing naming
      // them. Summing what each subject stands for is what catches it.
      const heldAccounted = everySubject(reimported).reduce(
        (sum, subject) => sum + subject.heldCount,
        0
      );
      expect({ subject: name, heldAccounted }).toEqual({
        subject: name,
        heldAccounted: held.length,
      });
      expect(
        reimported.findings.filter(
          (finding) => finding.code === FIELD_ADMIN_REASON.CHANGE_SET_PARTITION_INCOMPLETE
        )
      ).toEqual([]);
    });
  }

  it('names every held identity collision, and finds none where ids are unique', () => {
    // Stated as a count rather than as silence, and each number is a fact
    // about the corpus rather than a tolerance:
    //
    // - three subjects key on a record's own `id` and collide nowhere;
    // - `aliases` keys on the published name, which **two rings legitimately
    //   share**, so each of the 20 shared codes holds two records and says so;
    // - `venueAttributes` keys on `venueLabel`, and `field_inventory.csv`
    //   lists **Willowmead Park twice** with different notes - so exactly one
    //   collision is the right answer, and this check rediscovers that fact
    //   independently of the projector that already reports it.
    /** @type {Record<string, number>} */
    const collisions = {};
    for (const { name } of SUBJECTS) {
      const held = recordsOf(imported[name]);
      const reimported = importSeason2026Fields({
        practice,
        graph,
        complexMap,
        held: { [name]: held },
      })[name];
      collisions[name] = reimported.findings.filter(
        (finding) => finding.code === FIELD_ADMIN_REASON.HELD_KEY_AMBIGUOUS
      ).length;
    }
    expect(collisions).toEqual({
      blackouts: 0,
      recurringWindows: 0,
      permitWindows: 0,
      venueAttributes: 1,
      aliases: 20,
    });
  });

  it('can fail, when the held records are perturbed', () => {
    // The control for the four assertions above: a held set that genuinely
    // differs must not come back clean, or "removed: 0" would prove nothing.
    const held = recordsOf(imported.blackouts).map((record, index) =>
      index === 0 ? { ...record, id: 'a-record-no-source-names' } : record
    );
    const reimported = importSeason2026Fields({
      practice,
      graph,
      complexMap,
      held: { blackouts: held },
    }).blackouts;
    expect(reimported.buckets.removed.length).toBe(1);
    expect(reimported.buckets.added.length).toBe(1);
  });
});

describe('fieldAdmin round trip :: structured cells survive their own values', () => {
  it('round-trips a service name containing a space', () => {
    // The space-joined encoding turned `['Restroom Use']` into
    // `['Restroom', 'Use']`, which `PermitWindowSchema` accepted because both
    // halves are non-empty. The round-trip test could not see it: re-rendering
    // the broken value produced the same bytes, so the file was stable while
    // the record was wrong. Every service value in the corpus contains a space.
    const services = ['Restroom Use', 'Field Lights', 'Custodian Open/Close'];
    expect(readCell('services', renderCell('services', services))).toEqual(services);
  });

  it('round-trips every service value the corpus actually writes', () => {
    // Enumerated from the permits rather than from the three above, so a value
    // this test does not happen to name is still covered.
    const written = new Set(
      permitRecords.flatMap((record) => /** @type {string[]} */ (record.services))
    );
    expect(written.size).toBeGreaterThan(0);
    for (const service of written) {
      expect(readCell('services', renderCell('services', [service]))).toEqual([service]);
    }
  });

  it('round-trips an equipment list, quantities included', () => {
    const equipment = [
      { item: 'PUGG Goals (blue)', value: '12.0' },
      { item: 'Storage Container', value: '2.0' },
    ];
    expect(readCell('equipment', renderCell('equipment', equipment))).toEqual(equipment);
  });

  it('round-trips a cell containing a comma, a quote and a newline', () => {
    // `quoteCell()` quotes all three, which says the format supports them. The
    // reader used to split on newlines before parsing quotes, so a record the
    // writer would happily produce could not be read back.
    const awkward = 'closed,\n"see" the notice';
    const text = `notesText\n${quoteCell(awkward)}\n`;
    expect(splitCsvRecords(text)).toEqual([['notesText'], [awkward]]);
  });

  it('refuses a structured cell that is not JSON, rather than guessing', () => {
    expect(() => readCell('services', 'Restroom Use')).toThrow(/is not JSON/);
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

describe('fieldAdmin round trip :: an absent structured cell is not an empty one', () => {
  it("reads '' back as null and '[]' back as an empty array", () => {
    // **The mutation sweep found this fix unpinned.** Reverting `readCell` to
    // map `''` to `[]` left the entire suite green, because no column is
    // nullable on today's model so the path is unreachable through the
    // registry. It is reachable through the exported function, which is where
    // the contract lives, so that is where it is pinned.
    //
    // The defect it guards: a nullable structured column would round-trip
    // `null -> '' -> [] -> '[]'`, a changed file for an unchanged record.
    for (const column of ['venueIds', 'surfaceIds', 'services', 'equipment']) {
      expect({ column, absent: readCell(column, '') }).toEqual({ column, absent: null });
      expect({ column, empty: readCell(column, '[]') }).toEqual({ column, empty: [] });
      // ... and the writer produces exactly those two cells, so the reader's
      // two answers correspond to two things the writer can actually write.
      expect({ column, written: renderCell(column, null) }).toEqual({ column, written: '' });
      expect({ column, written: renderCell(column, []) }).toEqual({ column, written: '[]' });
    }
    // `''` means absence on every column, not only the structured ones -- the
    // consistency that makes the structured branch's `null` the right answer
    // rather than a special case. (I asserted `''` here first and it failed;
    // the code was right and the assertion was wrong.)
    expect(readCell('label', '')).toBeNull();
    expect(readCell('startMinutes', '')).toBeNull();
    // ... and a present value on a structured column still parses, so the
    // absent-vs-empty distinction is not swallowing real data.
    expect(readCell('venueIds', JSON.stringify(['v1']))).toEqual(['v1']);
  });
});
