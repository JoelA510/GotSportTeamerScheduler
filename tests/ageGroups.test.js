import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  AGE_CUTOFF_MODES,
  computeAgeNumber,
  computeAgeGroup,
  cohortWindow,
  divisionBirthWindow,
  parseAgeNumbersFromName,
  parseGenderFromName,
  classifyPlacement,
  isEligibleForDivision,
  normalizeDivisionAgeBounds,
} from '../packages/core/src/ageGroups.js';

const S = 2026;

test('birth_year cutoff: U-number is seasonYear minus birth year', () => {
  assert.equal(computeAgeNumber('2016-09-15', S, AGE_CUTOFF_MODES.BIRTH_YEAR), 10);
  assert.equal(computeAgeNumber('2016-03-01', S, AGE_CUTOFF_MODES.BIRTH_YEAR), 10);
  assert.equal(computeAgeNumber('2021-06-01', S, AGE_CUTOFF_MODES.BIRTH_YEAR), 5);
  assert.equal(computeAgeNumber('2007-01-01', S, AGE_CUTOFF_MODES.BIRTH_YEAR), 19);
});

test('school_year (Aug-Jul) cutoff: Aug-Dec births shift one group younger', () => {
  const mode = AGE_CUTOFF_MODES.SCHOOL_YEAR_AUG_JUL;
  // Jan-Jul birthdays match the birth-year number.
  assert.equal(computeAgeNumber('2016-03-01', S, mode), 10);
  assert.equal(computeAgeNumber('2016-07-31', S, mode), 10);
  // Aug-Dec birthdays drop one (youngest-for-grade).
  assert.equal(computeAgeNumber('2016-08-01', S, mode), 9);
  assert.equal(computeAgeNumber('2016-12-31', S, mode), 9);
  // The previous year's Aug-Dec rejoins the older group.
  assert.equal(computeAgeNumber('2015-09-01', S, mode), 10);
});

test('default mode is applied when cutoff mode is missing/invalid', () => {
  // Default is school-year, so an Aug birthday lands a year younger than birth-year.
  assert.equal(computeAgeNumber('2016-08-01', S, undefined), 9);
  assert.equal(computeAgeNumber('2016-08-01', S, 'nonsense'), 9);
});

test('cohortWindow: birth-year is calendar, school-year is Aug-Jul', () => {
  assert.deepEqual(cohortWindow(10, S, AGE_CUTOFF_MODES.BIRTH_YEAR), {
    start: '2016-01-01',
    end: '2016-12-31',
  });
  assert.deepEqual(cohortWindow(10, S, AGE_CUTOFF_MODES.SCHOOL_YEAR_AUG_JUL), {
    start: '2015-08-01',
    end: '2016-07-31',
  });
});

test('divisionBirthWindow spans multi-year bands (U11-U12)', () => {
  // Older players (U12) are born earlier; the window runs oldest-start..youngest-end.
  assert.deepEqual(divisionBirthWindow(11, 12, S, AGE_CUTOFF_MODES.BIRTH_YEAR), {
    start: '2014-01-01',
    end: '2015-12-31',
  });
  // U3-U4 Bumblebee band.
  assert.deepEqual(divisionBirthWindow(3, 4, S, AGE_CUTOFF_MODES.BIRTH_YEAR), {
    start: '2022-01-01',
    end: '2023-12-31',
  });
});

test('computeAgeGroup returns label and cohort window', () => {
  const result = computeAgeGroup({
    dob: '2016-03-01',
    seasonYear: S,
    cutoffMode: AGE_CUTOFF_MODES.BIRTH_YEAR,
  });
  assert.equal(result.ageNumber, 10);
  assert.equal(result.ageGroup, 'U10');
  assert.equal(result.cohortStart, '2016-01-01');
});

test('computeAgeNumber returns null for unparseable DOB', () => {
  assert.equal(computeAgeNumber('not-a-date', S, AGE_CUTOFF_MODES.BIRTH_YEAR), null);
  assert.equal(computeAgeNumber('', S, AGE_CUTOFF_MODES.BIRTH_YEAR), null);
});

test('parseAgeNumbersFromName handles singles, ranges, and gendered codes', () => {
  assert.deepEqual(parseAgeNumbersFromName('U11 - U12'), { minAge: 11, maxAge: 12 });
  assert.deepEqual(parseAgeNumbersFromName('U5 - U5'), { minAge: 5, maxAge: 5 });
  assert.deepEqual(parseAgeNumbersFromName('U3 - U4'), { minAge: 3, maxAge: 4 });
  assert.deepEqual(parseAgeNumbersFromName('2026 U05G Grasshopper Registration'), {
    minAge: 5,
    maxAge: 5,
  });
  assert.equal(parseAgeNumbersFromName('2026 Bumblebee Registration'), null);
});

test('parseGenderFromName reads gendered U-codes and words', () => {
  assert.equal(parseGenderFromName('2026 U05G Grasshopper Registration'), 'girls');
  assert.equal(parseGenderFromName('2026 U06B Grasshopper Registration'), 'boys');
  assert.equal(parseGenderFromName('U10 Girls'), 'girls');
  assert.equal(parseGenderFromName('U10 Boys'), 'boys');
  assert.equal(parseGenderFromName('2026 Bumblebee Registration'), null);
});

test('classifyPlacement: in-band, up (younger), down (older)', () => {
  const bounds = { minAge: 10, maxAge: 10 };
  assert.equal(classifyPlacement(10, bounds), 'in_band');
  assert.equal(classifyPlacement(9, bounds), 'up');
  assert.equal(classifyPlacement(11, bounds), 'down');
  assert.equal(classifyPlacement(NaN, bounds), 'unknown');
});

test('normalizeDivisionAgeBounds falls back to name parsing', () => {
  assert.deepEqual(normalizeDivisionAgeBounds({ id: 'd1', name: 'U11 - U12 Boys' }), {
    id: 'd1',
    name: 'U11 - U12 Boys',
    minAge: 11,
    maxAge: 12,
  });
  assert.deepEqual(normalizeDivisionAgeBounds({ id: 'd2', name: 'X', min_age: 7, max_age: 8 }), {
    id: 'd2',
    name: 'X',
    minAge: 7,
    maxAge: 8,
  });
});

test('isEligibleForDivision uses explicit birthdate window when present', () => {
  const division = { name: 'U10 Boys', birthdate_start: '2016-01-01', birthdate_end: '2016-12-31' };
  assert.equal(
    isEligibleForDivision({ dob: '2016-05-01', division, seasonYear: S, cutoffMode: 'birth_year' }),
    true
  );
  assert.equal(
    isEligibleForDivision({ dob: '2017-05-01', division, seasonYear: S, cutoffMode: 'birth_year' }),
    false
  );
});

test('isEligibleForDivision falls back to band when no window configured', () => {
  const division = { name: 'U11 - U12 Boys' };
  assert.equal(
    isEligibleForDivision({ dob: '2015-03-01', division, seasonYear: S, cutoffMode: 'birth_year' }),
    true // age 11
  );
  assert.equal(
    isEligibleForDivision({ dob: '2016-03-01', division, seasonYear: S, cutoffMode: 'birth_year' }),
    false // age 10, below the band
  );
});
