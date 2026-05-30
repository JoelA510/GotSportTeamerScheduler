import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  canonicalizePlayerRow,
  canonicalizeCoachRow,
  flattenCanonicalPlayer,
  makeDedupeHeaderTransformer,
  PLAYER_ALLOWLIST,
  COACH_ALLOWLIST,
} from '../frontend/src/utils/gotsportCanonicalizer.js';

/** Zip headers->values, applying the dedupe transformer like PapaParse would. */
function rowFromCsv(headers, values) {
  const transform = makeDedupeHeaderTransformer();
  /** @type {Record<string, string>} */
  const row = {};
  headers.forEach((h, i) => {
    row[transform(h)] = values[i];
  });
  return row;
}

const BUDDY_HEADER =
  'If you have a buddy request for this player enter their first and last name EXACTLY as it is entered on their registration. Example Samantha Brown.';

const playerRow = {
  'Registration ID': 'REG123',
  Program: '2026 U10B Registration',
  'First Name': 'Sam',
  'Last Name': 'Stripe',
  Gender: 'm',
  DOB: '2016-09-15',
  'Birth Year': '2016',
  'Age Group': 'U10 - U10',
  'Contact Email': 'parent@example.com',
  Phone: '555-1212',
  Allergies: 'Peanuts',
  'Medical Conditions': 'Asthma',
  'Guardian 1 First Name': 'Pat',
  'Guardian 1 Last Name': 'Stripe',
  'Guardian 1 Email Address': 'pat@example.com',
  'Guardian 1 Mobile Phone Number': '555-0001',
  'Insurance Policy Number': 'INS-XYZ',
  Complete: 'Yes',
  Submitted: 'Yes',
  Waitlist: 'No',
  'Payment Status': 'Paid',
  [BUDDY_HEADER]: 'Alex Rivera',
  'How many years has your player played in an organized soccer program?': '3',
  "Can you coach for this player's team?": 'Yes',
  'Are you coaching so this player can play up a division?': 'No',
  'We are applying for financial aid.': 'Yes',
  'CVSC FA Discount 50% Total Amount': '100',
};

test('player canonicalization keeps only whitelisted fields', () => {
  const out = canonicalizePlayerRow(playerRow);
  for (const key of Object.keys(out)) {
    assert.ok(PLAYER_ALLOWLIST.includes(key), `unexpected key leaked: ${key}`);
  }
});

test('player canonicalization drops sensitive columns', () => {
  const out = canonicalizePlayerRow(playerRow);
  const serialized = JSON.stringify(out).toLowerCase();
  assert.ok(!serialized.includes('peanuts'), 'allergies leaked');
  assert.ok(!serialized.includes('asthma'), 'medical leaked');
  assert.ok(!serialized.includes('ins-xyz'), 'insurance leaked');
  assert.ok(!serialized.includes('financial'), 'financial aid leaked');
});

test('player canonicalization maps and derives the right values', () => {
  const out = canonicalizePlayerRow(playerRow);
  assert.equal(out.external_registration_id, 'REG123');
  assert.equal(out.division_name, '2026 U10B Registration');
  assert.equal(out.age_group_label, 'U10 - U10');
  assert.equal(out.date_of_birth, '2016-09-15');
  assert.equal(out.birth_year, 2016);
  assert.equal(out.gender, 'm');
  assert.equal(out.registration_status, 'eligible');
  assert.equal(out.placement_eligible, true);
  assert.deepEqual(out.guardian_contacts, [
    { name: 'Pat Stripe', email: 'pat@example.com', phone: '555-0001' },
  ]);
  assert.equal(out.buddy_request_name, 'Alex Rivera');
  assert.equal(out.experience_years, 3);
  assert.equal(out.skill_tier, 'developing');
  assert.equal(out.willing_to_coach, true);
  assert.equal(out.play_up_requested, false);
});

test('recognizes the common "Buddy ID" / Division headers (non-CVSC exports)', () => {
  const row = {
    'First Name': 'Avery',
    'Last Name': 'Adams',
    'Date of Birth': '2016-04-02',
    'Registration ID': 'GS-BUDDY-A',
    Division: 'U8 Coed',
    'Buddy ID': 'GS-BUDDY-B',
  };
  const out = canonicalizePlayerRow(row);
  assert.equal(out.buddy_request_name, 'GS-BUDDY-B');
  assert.equal(out.division_name, 'U8 Coed');
  assert.equal(out.external_registration_id, 'GS-BUDDY-A');
  // The flat upload row must carry buddy_request (consumed by materialization).
  assert.equal(flattenCanonicalPlayer(out).buddy_request, 'GS-BUDDY-B');
});

test('flattenCanonicalPlayer emits the keys the finalize RPC consumes', () => {
  const flat = flattenCanonicalPlayer(canonicalizePlayerRow(playerRow));
  // guardian_* (consumed by finalize + coach-lead builder) and the richer guardian1_*
  assert.equal(flat.guardian_name, 'Pat Stripe');
  assert.equal(flat.guardian_email, 'pat@example.com');
  assert.equal(flat.guardian_phone, '555-0001');
  assert.equal(flat.guardian1_name, 'Pat Stripe');
  // buddy_request is what the finalize RPC + buddy materialization read.
  assert.equal(flat.buddy_request, 'Alex Rivera');
  assert.equal(flat.buddy_request_name, 'Alex Rivera');
});

test('eligibility reflects waitlist and payment status', () => {
  const waitlisted = canonicalizePlayerRow({ ...playerRow, Waitlist: 'Yes' });
  assert.equal(waitlisted.registration_status, 'waitlisted');
  assert.equal(waitlisted.placement_eligible, false);

  const unpaid = canonicalizePlayerRow({ ...playerRow, 'Payment Status': 'Pending' });
  assert.equal(unpaid.registration_status, 'unpaid');
  assert.equal(unpaid.placement_eligible, false);

  const incomplete = canonicalizePlayerRow({ ...playerRow, Complete: 'No' });
  assert.equal(incomplete.placement_eligible, false);
});

test('dedupe header transformer suffixes repeated headers', () => {
  const transform = makeDedupeHeaderTransformer();
  assert.equal(transform('Playing Up'), 'Playing Up');
  assert.equal(transform('Playing Up'), 'Playing Up__2');
  assert.equal(transform('Preferred Co-Coach'), 'Preferred Co-Coach');
  assert.equal(transform('Preferred Co-Coach'), 'Preferred Co-Coach__2');
});

test('coach canonicalization handles composite name, children, and duplicate headers', () => {
  const headers = [
    'Registration ID',
    'First Name',
    'Last Name',
    'Contact Email',
    'Phone',
    'Age Group',
    'How many years have you coached with Castro Valley Soccer Club?',
    'First and Last name of your player.',
    "What is your player's gender?",
    "What is your player's birth date?",
    'Playing Up',
    'Preferred Co-Coach',
    'If you are coaching two teams what is the first and last name of your second player?',
    'If you are coaching two teams what is the gender of your second player?',
    "If you are coaching two teams what is your second player's birth date?",
    'Playing Up',
    'Preferred Co-Coach',
    'Complete',
    'Waitlist',
    'Allergies',
  ];
  const values = [
    'C-9',
    'Coach',
    'Carter',
    'coach@example.com',
    '555-9999',
    'U10 - U10',
    '5',
    'Sam Stripe',
    'm',
    '2016-09-15',
    'Yes',
    'Jamie Coski',
    'Bee Stripe',
    'f',
    '2018-03-03',
    'No',
    '',
    'Yes',
    'No',
    'Peanuts',
  ];
  const out = canonicalizeCoachRow(rowFromCsv(headers, values));

  for (const key of Object.keys(out)) {
    assert.ok(COACH_ALLOWLIST.includes(key), `unexpected key leaked: ${key}`);
  }
  assert.equal(out.full_name, 'Coach Carter');
  assert.equal(out.email, 'coach@example.com');
  assert.equal(out.source_registration_id, 'C-9');
  assert.equal(out.requested_division, 'U10 - U10');
  assert.equal(out.coaching_years, 5);
  assert.equal(out.coach_registration_ready, true);
  assert.equal(out.can_coach_multiple_teams, true);
  assert.equal(out.children.length, 2);
  assert.deepEqual(out.children[0], {
    name: 'Sam Stripe',
    gender: 'm',
    birth_date: '2016-09-15',
    playing_up: true,
    preferred_co_coach: 'Jamie Coski',
  });
  assert.deepEqual(out.children[1], {
    name: 'Bee Stripe',
    gender: 'f',
    birth_date: '2018-03-03',
    playing_up: false,
    preferred_co_coach: null,
  });
  assert.ok(!JSON.stringify(out).toLowerCase().includes('peanuts'), 'allergies leaked');
});
