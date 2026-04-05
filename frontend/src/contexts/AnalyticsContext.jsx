import React, { createContext, useContext, useMemo } from 'react';
import { computeEnterpriseMetrics } from '../utils/analyticsUtils.js';

const AnalyticsContext = createContext(null);

export const useAnalytics = () => useContext(AnalyticsContext);

/**
 * Hook to aggregate enterprise metrics from players and custom attributes,
 * honoring the 200ms latency ceiling and PII Masking requirements.
 */
export const useEnterpriseMetrics = (players = [], orgSchema = {}) => {
  return useMemo(() => computeEnterpriseMetrics(players, orgSchema), [players, orgSchema]);
};

export const AnalyticsProvider = ({ children, players = [], orgSchema = {} }) => {
  const metrics = useEnterpriseMetrics(players, orgSchema);

  return (
    <AnalyticsContext.Provider value={metrics}>
      {children}
    </AnalyticsContext.Provider>
  );
};
