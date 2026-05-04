import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePracticeAssignments } from '../frontend/src/hooks/usePracticeAssignments.js';
import { supabase } from '../frontend/src/lib/supabaseClient.js';

vi.mock('../frontend/src/lib/supabaseClient.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(),
      })),
    })),
  },
}));

describe('usePracticeAssignments', () => {
  it('returns empty assignments if no runId is provided', () => {
    const { result } = renderHook(() => usePracticeAssignments(null));
    expect(result.current.assignments).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current).not.toHaveProperty('updateAssignmentSource');
  });

  it('fetches assignments from supabase when runId is provided', async () => {
    const mockData = [
      { id: '1', team_id: 't1', run_id: 'run-123' },
      { id: '2', team_id: 't2', run_id: 'run-123' },
    ];

    const mockEq = vi.fn().mockResolvedValue({ data: mockData, error: null });
    const mockSelect = vi.fn(() => ({ eq: mockEq }));
    const mockFrom = vi.fn(() => ({ select: mockSelect }));
    // @ts-expect-error [MOCK] - overriding readonly client property for test isolation; Supabase from() is typed as a method on the client instance
    supabase.from = mockFrom;

    const { result } = renderHook(() => usePracticeAssignments('run-123'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.assignments.length).toBe(2);
    // Verify camelCase mapping
    expect(result.current.assignments[0]).toHaveProperty('teamId');
    expect(result.current.assignments[0].teamId).toBe('t1');
    expect(mockEq).toHaveBeenCalledWith('run_id', 'run-123');
  });

  it('handles fetch errors correctly', async () => {
    const mockError = { message: 'Database error' };
    const mockEq = vi.fn().mockResolvedValue({ data: null, error: mockError });
    const mockSelect = vi.fn(() => ({ eq: mockEq }));
    // @ts-expect-error [MOCK] - overriding readonly client property for test isolation; Supabase from() is typed as a method on the client instance
    supabase.from = vi.fn(() => ({ select: mockSelect }));

    const { result } = renderHook(() => usePracticeAssignments('run-err'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toEqual(mockError);
    expect(result.current.assignments).toEqual([]);
  });
});
