import { preparePracticePersistenceSnapshot } from '@squadlogic/core/practicePersistenceSnapshot.js';
import { PRACTICE_PERSISTENCE_URL } from '../config.js';
import { supabase } from '../lib/supabaseClient.js';

export async function persistPracticeScheduleReview({
  assignments = [],
  slots = [],
  runId,
  runMetadata = {},
}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  if (!token) {
    throw new Error('Authentication required to apply practice schedule changes.');
  }

  const snapshot = preparePracticePersistenceSnapshot({
    assignments,
    slots,
    runId,
    runMetadata,
    practiceOverrides: [],
  });

  const response = await fetch(PRACTICE_PERSISTENCE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      snapshot,
      overrides: [],
      runMetadata,
    }),
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      result.message || result.error || `Practice persistence failed: ${response.status}`
    );
  }

  return result;
}
