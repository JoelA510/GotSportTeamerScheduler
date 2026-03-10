import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTeamAnalysis } from '../frontend/src/hooks/useTeamAnalysis.js';
import { useImport } from '../frontend/src/contexts/ImportContext.jsx';

vi.mock('../frontend/src/contexts/ImportContext.jsx', () => ({
  useImport: vi.fn(),
}));

describe('useTeamAnalysis', () => {
  it('processes imported players into program groups', async () => {
    // Fix system time for consistent U-group calculation
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01'));

    const mockPlayers = [
      { 'First Name': 'Alice', 'Last Name': 'Smith', 'Birthdate': '2016-01-01', 'Gender': 'f' }, // Age 9 -> U10 Girls
      { 'First Name': 'Bob', 'Last Name': 'Brown', 'Birthdate': '2018-06-15', 'Gender': 'm' },   // Age 7 -> U8 Boys
    ];

    vi.mocked(useImport).mockReturnValue({
      importedPlayers: { data: mockPlayers },
    });

    const { result } = renderHook(() => useTeamAnalysis());

    await waitFor(() => {
      expect(result.current.programs.length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    const programNames = result.current.programs.map(p => p.name);
    expect(programNames).toContain('U10 Girls');
    expect(programNames).toContain('U8 Boys');

    vi.useRealTimers();
  });

  it('reports missing DOB/Gender as validation errors', async () => {
    const mockPlayers = [
      { 'First Name': 'Missing', 'Last Name': 'Data' }, // No Birthdate/Gender
    ];

    vi.mocked(useImport).mockReturnValue({
      importedPlayers: { data: mockPlayers },
    });

    const { result } = renderHook(() => useTeamAnalysis());
    
    await waitFor(() => {
        expect(result.current.validationErrors.length).toBe(1);
    }, { timeout: 2000 });
    expect(result.current.validationErrors[0].type).toBe('missing_info');
  });
});
