import { describe, it, expect } from 'vitest';
import { normalizePlayerData } from '../packages/core/src/utils/normalization.js';

describe('Data Ingestion Hardening: Malformed CSV Data', () => {
    it('merges or rejects duplicate GotSport ID numbers gracefully', () => {
        const dirtyData = [
            { gotSportId: 'GS-123', firstName: 'John', lastName: 'Doe', dob: '2015-05-12' },
            { gotSportId: 'GS-123', firstName: 'John', lastName: 'Doe', dob: '2015-05-12' } // Duplicate
        ];

        const { valid, errors } = normalizePlayerData(dirtyData);

        expect(valid.length).toBe(1);
        expect(errors).toContainEqual(
            expect.objectContaining({ type: 'DUPLICATE_ID', id: 'GS-123' })
        );
    });

    it('flags an exact row-level validation error when Date of Birth is missing', () => {
        const dirtyData = [
            { gotSportId: 'GS-456', firstName: 'Jane', lastName: 'Smith', dob: '' } // Missing DOB
        ];

        const { valid, errors } = normalizePlayerData(dirtyData);

        expect(valid.length).toBe(0);
        expect(errors[0]).toMatchObject({
            row: 0,
            column: 'dob',
            message: 'Missing critical column: Date of Birth'
        });
    });
});
