import { useMemo } from 'react';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { FEATURE_DEFAULTS, GENDER_MODELS } from '../constants/featureFlags.js';

/**
 * Org feature configuration with defaults applied.
 *
 * `isEnabled(key)` for boolean features; `genderModel` is the division
 * format ('split' | 'coed', default 'split').
 */
export function useFeatures() {
  // Tolerate render outside OrganizationProvider (isolated component tests).
  const { featureFlags = {}, updateFeatureFlags, loading } = useOrganization() || {};

  return useMemo(() => {
    const effective = { ...FEATURE_DEFAULTS, ...featureFlags };
    const genderModel = GENDER_MODELS.includes(effective.gender_model)
      ? effective.gender_model
      : 'split';
    return {
      features: effective,
      isEnabled: (key) => !!effective[key],
      genderModel,
      updateFeatureFlags,
      loading,
    };
  }, [featureFlags, updateFeatureFlags, loading]);
}
