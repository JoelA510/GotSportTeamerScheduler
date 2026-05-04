export const buildSetupTelemetryRpcParams = ({
  organizationId,
  eventType,
  sessionId,
  payload = {},
  step,
}) => {
  if (!organizationId) return null;

  return {
    p_org_id: organizationId,
    p_event_name: eventType,
    p_payload: {
      ...payload,
      session_id: sessionId ?? 'N/A',
      step,
    },
  };
};

export const logSetupWizardTelemetry = async ({
  supabaseClient,
  organizationId,
  eventType,
  sessionId,
  payload = {},
  step,
  logger,
}) => {
  const params = buildSetupTelemetryRpcParams({
    organizationId,
    eventType,
    sessionId,
    payload,
    step,
  });

  if (!params) return;

  try {
    const { error } = await supabaseClient.rpc('log_telemetry_event', params);
    if (error) throw error;
  } catch (err) {
    logger?.error?.('Telemetry failed', err);
  }
};
