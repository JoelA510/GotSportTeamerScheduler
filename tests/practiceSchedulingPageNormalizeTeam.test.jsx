import { describe, it, expect } from 'vitest';

import { normalizeTeam } from '../frontend/src/pages/PracticeSchedulingPage.jsx';

// 8.1: the auto-scheduler request must carry every coach on the team, not only the head coach.
describe('PracticeSchedulingPage normalizeTeam', () => {
  it('forwards assistant coach ids from the engine spelling', () => {
    const team = normalizeTeam({
      id: 't1',
      division: 'U10',
      coachId: 'head-1',
      assistantCoachIds: ['assistant-1', 'assistant-2'],
    });
    expect(team.coachId).toBe('head-1');
    expect(team.assistantCoachIds).toEqual(['assistant-1', 'assistant-2']);
  });

  it('forwards assistant coach ids from the teams-column spelling', () => {
    const team = normalizeTeam({
      id: 't1',
      division_id: 'U10',
      coach_id: 'head-1',
      assistant_coach_ids: ['assistant-1'],
    });
    expect(team.coachId).toBe('head-1');
    expect(team.assistantCoachIds).toEqual(['assistant-1']);
  });

  it('sends an empty list, never undefined, when a row carries no assistants', () => {
    const team = normalizeTeam({ id: 't1', division: 'U10', coachId: null });
    expect(team.assistantCoachIds).toEqual([]);
    // Control: the mapping is not a pass-through of arbitrary fields.
    expect(team).not.toHaveProperty('assistant_coach_ids');
  });
});
