export const computeEnterpriseMetrics = (players = [], orgSchema = {}) => {
  const aggregates = {};
  const maskedFields = new Set();
  
  // 1. Identify sensitive attributes from the Fluid Schema
  Object.keys(orgSchema).forEach(key => {
    if (orgSchema[key]?.sensitive) {
      maskedFields.add(key);
    }
  });

  // 2. K-Anonymity Check
  const isLowSample = players.length < 3;

  if (isLowSample) {
    return {
      aggregates: {},
      totalPlayers: players.length,
      isLowSample,
      maskedFields: Array.from(maskedFields)
    };
  }

  // 3. Batch process aggregations (O(N) single pass to avoid waterfall lookups)
  players.forEach(player => {
    const customAttrs = player.custom_attributes || {};
    
    Object.keys(customAttrs).forEach(key => {
      // Differential Privacy: Mask sensitive fields
      if (maskedFields.has(key)) return; 
      
      if (!aggregates[key]) {
        aggregates[key] = { counts: {}, total: 0 };
      }
      
      const val = customAttrs[key];
      if (val !== undefined && val !== null && val !== '') {
        aggregates[key].counts[val] = (aggregates[key].counts[val] || 0) + 1;
        aggregates[key].total += 1;
      }
    });
  });

  // Post-process to ensure attributes with < 3 population are also flagged
  Object.keys(aggregates).forEach(key => {
    aggregates[key].isLowSample = aggregates[key].total < 3;
  });

  return {
    aggregates,
    totalPlayers: players.length,
    isLowSample,
    maskedFields: Array.from(maskedFields)
  };
};
