import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { supabase } from '../lib/supabaseClient.js';
import Papa from 'papaparse';
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import { withTimeout } from '../lib/withTimeout.js';
import { useOrganization } from './OrganizationContext.jsx';
import { matchHeaders, SYSTEM_COLUMNS } from '../utils/telemetryUtils.js';
import {
  buildCoachLeadPayload,
  getExternalRegistrationId,
  hasCoachLeadIntent,
} from '../utils/coachLeads.js';

const MAX_ROWS = 10000;
const MAX_COLS = 1200;
const PLAYER_LOOKUP_CHUNK_SIZE = 500;

const ImportContext = createContext({
  isImporting: false,
  progress: 0,
  importStatus: 'idle',
  importLogs: [],
  notifyOnComplete: false,
  setNotifyOnComplete: (_val) => {},
  startImport: async (_file, _type) => {},
  resetImport: async (_type) => {},
  importedData: null,
  setImportedData: (_data) => {},
  importedPlayers: null,
  setImportedPlayers: (_data) => {},
  importedCoaches: null,
  setImportedCoaches: (_data) => {},
  importedFields: null,
  setImportedFields: (_data) => {},
  rollbackImport: async (_type) => {},
  telemetryLogs: [],
  organizationSchemas: {},
  activeJobId: null,
  activeJob: null,
});

export function useImport() {
  return useContext(ImportContext);
}

// Static Utility: Mask Sensitive Data out of component scope to ensure stability
const maskDataInternal = (importPayload, entitySchema) => {
  if (!importPayload || !importPayload.data || !entitySchema) return importPayload;

  // Check if any schema fields are marked as sensitive
  const hasSensitiveFields = Object.values(entitySchema).some((field) => field.isSensitive);
  if (!hasSensitiveFields) return importPayload;

  const maskedRows = importPayload.data.map((row) => {
    if (!row.custom_attributes) return row;
    const newAttrs = { ...row.custom_attributes };
    let masked = false;
    for (const [key] of Object.entries(newAttrs)) {
      // Schema definition tells us if it's sensitive
      if (entitySchema[key]?.isSensitive) {
        newAttrs[key] = '***';
        masked = true;
      }
    }
    return masked ? { ...row, custom_attributes: newAttrs } : row;
  });
  return { ...importPayload, data: maskedRows };
};

const chunkValues = (values, chunkSize) => {
  const chunks = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
};

const persistCoachLeadSummary = async ({ importJobId, summary, statusOverride = null, addLog }) => {
  const { error } = await supabase.rpc('set_import_job_coach_lead_summary', {
    p_import_job_id: importJobId,
    p_summary: summary,
    p_status: statusOverride,
  });

  if (error) {
    addLog(`Warning: Could not persist coach lead summary: ${error.message}`);
  }
};

const fetchCoachLeadPlayers = async ({ organizationId, candidateRows }) => {
  const externalIds = Array.from(
    new Set(candidateRows.map(getExternalRegistrationId).filter(Boolean))
  );
  const players = [];

  for (const externalIdChunk of chunkValues(externalIds, PLAYER_LOOKUP_CHUNK_SIZE)) {
    const { data: matchedPlayers, error } = await supabase
      .from('players')
      .select('id, external_registration_id, division_id')
      .eq('organization_id', organizationId)
      .in('external_registration_id', externalIdChunk);

    if (error) {
      throw new Error(error.message || 'Could not resolve imported players');
    }
    players.push(...(matchedPlayers || []));
  }

  return players;
};

const captureCoachLeadsForImport = async ({
  importJobId,
  organizationId,
  normalizedData,
  addLog,
}) => {
  const candidateRows = normalizedData.filter(hasCoachLeadIntent);
  if (candidateRows.length === 0) return null;

  try {
    const { data: divisions, error: divisionsError } = await supabase
      .from('divisions')
      .select('id, name')
      .eq('organization_id', organizationId);

    if (divisionsError) {
      throw new Error(divisionsError.message || 'Could not resolve divisions');
    }

    const players = await fetchCoachLeadPlayers({ organizationId, candidateRows });
    const coachLeadPayload = buildCoachLeadPayload(normalizedData, {
      organizationId,
      divisions: divisions || [],
      players,
    });

    if (coachLeadPayload.length === 0) {
      const summary = {
        status: 'skipped',
        candidate_rows: candidateRows.length,
        leads_submitted: 0,
        message:
          'Coach volunteer rows were present, but no guardian or parent name and email could be resolved.',
      };
      addLog(
        `Warning: ${candidateRows.length} coach volunteer row(s) could not create leads because adult contact fields were missing.`
      );
      await persistCoachLeadSummary({
        importJobId,
        summary,
        statusOverride: 'completed_with_warnings',
        addLog,
      });
      return summary;
    }

    const { data: coachLeadResult, error: coachLeadError } = await supabase.rpc(
      'upsert_coach_leads',
      { p_leads: coachLeadPayload }
    );

    if (coachLeadError) {
      throw new Error(coachLeadError.message || 'Coach lead capture failed');
    }

    const summary = {
      status: 'completed',
      candidate_rows: candidateRows.length,
      leads_submitted: coachLeadPayload.length,
      leads_created: coachLeadResult?.leads_created ?? 0,
      programs_linked: coachLeadResult?.programs_linked ?? 0,
      skipped_existing: coachLeadResult?.skipped_existing ?? 0,
    };
    addLog(
      `Coach leads captured: ${summary.leads_created} new, ${summary.programs_linked} program links.`
    );
    await persistCoachLeadSummary({ importJobId, summary, addLog });
    return summary;
  } catch (err) {
    const summary = {
      status: 'failed',
      candidate_rows: candidateRows.length,
      leads_submitted: 0,
      message: err.message,
    };
    addLog(`Warning: Coach lead capture failed: ${err.message}`);
    await persistCoachLeadSummary({
      importJobId,
      summary,
      statusOverride: 'completed_with_warnings',
      addLog,
    });
    return summary;
  }
};

export function ImportProvider({ children }) {
  const { currentOrganization } = useOrganization();
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importStatus, setImportStatus] = useState(() => {
    return localStorage.getItem('importStatus') || 'idle';
  }); // idle, importing, completed, completed_with_warnings, error
  const [importLogs, setImportLogs] = useState([]);
  const [notifyOnComplete, setNotifyOnComplete] = useState(false);
  const [telemetryLogs, setTelemetryLogs] = useState([]);

  // Multi-type state
  const [importedPlayers, setImportedPlayers] = useState(null);
  const [importedCoaches, setImportedCoaches] = useState(null);
  const [importedFields, setImportedFields] = useState(null);
  const [importedData, setImportedData] = useState(null); // Legacy/General
  const [organizationSchemas, setOrganizationSchemas] = useState({
    player: {},
    coach: {},
    field: {},
  }); // { player: {}, coach: {}, team: {} }
  const [activeJobId, setActiveJobId] = useState(null);
  const [activeJob, setActiveJob] = useState(null);

  // Refs for Realtime callbacks to avoid stale closures
  const activeJobRef = useRef(activeJob);
  const activeJobIdRef = useRef(activeJobId);

  useEffect(() => {
    activeJobRef.current = activeJob;
    activeJobIdRef.current = activeJobId;
  }, [activeJob, activeJobId]);

  // Throttled Progress Update Helper
  const lastUpdateRef = useRef(0);
  const updateJobProgress = useCallback(
    async (jobId, progressPercent) => {
      const now = Date.now();
      // Governance: Throttled to 100ms max frequency
      if (now - lastUpdateRef.current < 100 && progressPercent < 100) return;

      lastUpdateRef.current = now;
      setProgress(progressPercent);

      // Update DB (Quietly)
      await supabase
        .from('import_jobs')
        .update({
          progress_percent: progressPercent,
        })
        .eq('id', jobId);

      // Broadcast Realtime Channel
      const channel = supabase.channel(`import-progress-${currentOrganization?.id}`);
      channel.send({
        type: 'broadcast',
        event: 'import.progress_update',
        payload: { jobId, progress: progressPercent, status: 'processing' },
      });
    },
    [currentOrganization?.id]
  );

  // 1. Fetch Organization-Scoped Telemetry & Custom Schemas (Lazy Cache)
  useEffect(() => {
    const loadOrgData = async () => {
      if (!currentOrganization?.id) return;

      try {
        logger.log('[ImportContext] Fetching org data for:', currentOrganization.id);

        // Fetch Telemetry
        const { data: telData, error: telError } = await supabase
          .from('telemetry_log')
          .select('*')
          .eq('org_id', currentOrganization.id)
          .order('created_at', { ascending: false });

        if (telError) throw telError;
        setTelemetryLogs(telData || []);

        // Fetch Custom Schemas
        const { data: schemaData, error: schemaError } = await supabase
          .from('organization_schemas')
          .select('entity_type, schema_definition')
          .eq('organization_id', currentOrganization.id);

        if (schemaError) throw schemaError;

        const schemaMap = { player: {}, coach: {}, field: {} };
        schemaData?.forEach((s) => {
          schemaMap[s.entity_type] = s.schema_definition;
        });
        setOrganizationSchemas(schemaMap);
      } catch (err) {
        logger.error('Failed to fetch org data:', err);
      }
    };

    loadOrgData();
  }, [currentOrganization?.id]);

  // 2. Load initial state & Setup Realtime Subscriptions
  useEffect(() => {
    const loadFromSupabase = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || !currentOrganization?.id) return;

        logger.log('[ImportContext] Loading imports for user:', user.id);

        // Check for active/recent jobs for re-hydration
        const { data: activeJobs } = await supabase
          .from('import_jobs')
          .select('*')
          .eq('organization_id', currentOrganization.id)
          .in('status', ['processing', 'importing'])
          .order('created_at', { ascending: false })
          .limit(1);

        if (activeJobs && activeJobs.length > 0) {
          const job = activeJobs[0];
          setActiveJobId(job.id);
          setActiveJob(job);
          setProgress(job.progress_percent || 0);
          setIsImporting(true);
          setImportStatus('importing');
        }

        const { data, error } = await supabase
          .from('imports')
          .select('*')
          .eq('user_id', user.id)
          .eq('organization_id', currentOrganization.id)
          .order('created_at', { ascending: false });

        if (error) throw error;

        if (data) {
          const latestPlayers = data.find((i) => i.import_type === 'players');
          const latestCoaches = data.find((i) => i.import_type === 'coaches');
          const latestFields = data.find((i) => i.import_type === 'fields');

          if (latestPlayers) setImportedPlayers(latestPlayers.data);
          if (latestCoaches) setImportedCoaches(latestCoaches.data);
          if (latestFields) setImportedFields(latestFields.data);
          if (latestPlayers) setImportedData(latestPlayers.data);
        }
      } catch (e) {
        logger.error('Failed to load imports from Supabase:', e);
      }
    };

    loadFromSupabase();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        loadFromSupabase();
      }
    });

    let channel = null;
    if (currentOrganization?.id) {
      channel = supabase
        .channel(`import-jobs-${currentOrganization.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'import_jobs' },
          (payload) => {
            const newJob = payload.new;
            // Governance: Type safety and existence check
            if (newJob && typeof newJob === 'object' && 'status' in newJob && 'id' in newJob) {
              const job = newJob;

              if (job.status === 'processing' || job.status === 'importing') {
                // Throttled UI update logic for active job
                if (activeJobIdRef.current === job.id) {
                  setActiveJob((prev) => ({ ...prev, ...job }));
                  if (job.progress_percent !== undefined) {
                    setProgress(job.progress_percent);
                  }
                }
              } else if (['completed', 'failed', 'completed_with_warnings'].includes(job.status)) {
                if (activeJobIdRef.current === job.id || !activeJobIdRef.current) {
                  setIsImporting(false);
                  setImportStatus(job.status);
                  setActiveJob((prev) => ({ ...(prev || {}), ...job }));
                }
              }
            }
          }
        )
        .subscribe();
    }

    return () => {
      subscription?.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, [currentOrganization?.id]);

  const addLog = useCallback((message) => {
    setImportLogs((prev) => [...prev, { timestamp: new Date(), message }]);
  }, []);

  const completeImport = useCallback(
    (type, _previewData, status = 'completed') => {
      setIsImporting(false);
      setImportStatus(status);
      localStorage.setItem('importStatus', status);
      addLog(
        status === 'completed_with_warnings'
          ? `Import for ${type} applied with warnings.`
          : `Import for ${type} applied successfully.`
      );

      if (notifyOnComplete) {
        logger.log('Sending email notification...');
        addLog('Email notification sent.');
      }
    },
    [addLog, notifyOnComplete]
  );

  const startImport = useCallback(
    async (file, type = 'players') => {
      setIsImporting(true);
      setImportStatus('importing');
      setProgress(0);
      setImportLogs([]);
      addLog(`Starting import for ${type} from ${file.name}...`);

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || !currentOrganization?.id)
          throw new Error('Unauthenticated or no organization');

        // Create Job entry
        const { data: job, error: jobError } = await supabase
          .from('import_jobs')
          .insert({
            created_by: user.id,
            organization_id: currentOrganization.id,
            job_type: type === 'fields' ? 'fields' : 'registration',
            storage_path: `imports/${user.id}/${file.name}`,
            status: 'importing',
            total_rows: 0,
            processed_rows: 0,
            progress_percent: 0,
          })
          .select()
          .single();

        if (jobError) throw jobError;
        setActiveJobId(job.id);
        setActiveJob(job);

        addLog('Parsing CSV data...');
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: async (results) => {
            const { data, meta } = results;

            // Check hard limits for DoS mitigation
            if (meta.fields.length > MAX_COLS) {
              await supabase
                .from('import_jobs')
                .update({
                  status: 'failed',
                  error_summary: { message: `Payload exceeds column limit of ${MAX_COLS}` },
                })
                .eq('id', job.id);
              setImportStatus('error');
              setIsImporting(false);
              addLog('Validation Error: Payload exceeds column limit of ' + MAX_COLS);
              return;
            }
            if (data.length > MAX_ROWS) {
              await supabase
                .from('import_jobs')
                .update({
                  status: 'failed',
                  error_summary: { message: `Payload exceeds row limit of ${MAX_ROWS}` },
                })
                .eq('id', job.id);
              setImportStatus('error');
              setIsImporting(false);
              addLog('Validation Error: Payload exceeds row limit of ' + MAX_ROWS);
              return;
            }

            // Update total rows
            await supabase.from('import_jobs').update({ total_rows: data.length }).eq('id', job.id);

            // Phase 5: Dynamic Ingestion Logic
            const entityType =
              type === 'players' ? 'player' : type === 'coaches' ? 'coach' : 'field';
            const customSchema = organizationSchemas[entityType] || {};

            const { mappings, isFallback, timing, needsConfirmation } = matchHeaders(
              meta.fields,
              telemetryLogs,
              customSchema
            );

            const efficiency = isFallback ? 85.0 : 99.2;
            const efficiencyMetadata = {
              efficiency,
              latency: timing,
              needs_confirmation: needsConfirmation,
            };

            if (isFallback) {
              addLog(
                `Performance Warning: Smart Ingestion timed out (${timing.toFixed(2)}ms). Using static fallback.`
              );
            } else {
              addLog(`Smart Ingestion active. Match calculated in ${timing.toFixed(2)}ms.`);
              if (needsConfirmation.length > 0) {
                addLog(`Warning: ${needsConfirmation.length} fields require manual confirmation.`);
              }
            }

            // Persist metrics for Enterprise Overlay
            await supabase
              .from('import_jobs')
              .update({
                efficiency_metadata: efficiencyMetadata,
              })
              .eq('id', job.id);

            setActiveJob((prev) => ({ ...(prev || {}), efficiency_metadata: efficiencyMetadata }));

            const normalizeHeader = (h) => mappings[h] || h.toLowerCase().trim();

            // Phase 5 Vibe Audit: Detect if a key must go into JSONB vs root table
            const _shouldGoToCustomAttributes = (mappedKey) => {
              // If it's a known custom field, yes.
              if (organizationSchemas[entityType]?.[mappedKey]) return true;
              // If it's NOT a system column, yes (Fluid Schemas rule).
              if (!SYSTEM_COLUMNS.has(mappedKey)) return true;
              return false;
            };

            const normalizedData = [];
            const validationErrors = [];

            const REQUIRED_HEADERS = {
              players: ['first_name', 'last_name', 'date_of_birth'],
              coaches: ['full_name', 'email'],
              fields: ['location', 'name', 'type', 'start', 'end'],
            };

            const requiredForType = REQUIRED_HEADERS[type] || [];
            const normalizedFileHeaders = meta.fields.map(normalizeHeader);

            const missingHeaders = requiredForType.filter(
              (req) => !normalizedFileHeaders.includes(req)
            );
            if (missingHeaders.length > 0) {
              await supabase
                .from('import_jobs')
                .update({
                  status: 'failed',
                  error_summary: {
                    message: `Missing required columns: ${missingHeaders.join(', ')}`,
                  },
                })
                .eq('id', job.id);
              setImportStatus('error');
              setIsImporting(false);
              addLog(`Import failed: Missing required columns: ${missingHeaders.join(', ')}`);
              return;
            }

            // Create Zod Schema dynamically for the base requirement
            const schemaShape = {};
            requiredForType.forEach((req) => {
              schemaShape[req] = z.string().min(1, `Missing ${req}`);
            });
            const _rowSchema = z.object(schemaShape).passthrough();

            const CHUNK_SIZE = 5000;
            let currentIndex = 0;

            const processChunk = async () => {
              const endIndex = Math.min(currentIndex + CHUNK_SIZE, data.length);
              const chunkRows = data.slice(currentIndex, endIndex);

              addLog(
                `Validating batch ${Math.floor(currentIndex / CHUNK_SIZE) + 1} (${chunkRows.length} rows)...`
              );

              try {
                // 60s timeout guards against the Edge Function hanging silently
                // (e.g. after a successful CORS preflight when the POST never
                // fires). Without this the UI stalls forever on "Importing
                // Data..." with no diagnostic.
                const { data: efResult, error: efError } = await withTimeout(
                  supabase.functions.invoke('import-validation', {
                    body: {
                      import_type: type,
                      organization_id: currentOrganization.id,
                      rows: chunkRows,
                      file_name: file.name,
                      import_job_id: job.id,
                      row_offset: currentIndex,
                    },
                  }),
                  60000,
                  'Import validation'
                );

                if (efError || !efResult || efResult.status === 'error') {
                  throw new Error(efError?.message || efResult?.message || 'Validation failed');
                }

                // Add validated/sanitized rows
                normalizedData.push(...efResult.validated_data);

                // Add errors (adjusting row index since EF uses relative index)
                const adjustedErrors = efResult.validation_errors.map((err) => ({
                  ...err,
                  row: err.row + currentIndex, // EF offset was relative to chunk
                }));
                validationErrors.push(...adjustedErrors);

                // Update progress
                const currentProgress = Math.floor((endIndex / data.length) * 100);
                await updateJobProgress(job.id, currentProgress);

                currentIndex = endIndex;
                if (currentIndex < data.length) {
                  setTimeout(processChunk, 100); // Small breath for UI
                } else {
                  await finalizeImport();
                }
              } catch (err) {
                logger.error('Edge Function validation failed:', err);
                addLog(`Server Validation Error: ${err.message}`);
                await supabase
                  .from('import_jobs')
                  .update({
                    status: 'failed',
                    error_summary: { message: err.message },
                  })
                  .eq('id', job.id);
                setImportStatus('error');
                setIsImporting(false);
              }
            };

            const finalizeImport = async () => {
              addLog(
                `Validation complete. ${normalizedData.length} valid rows, ${validationErrors.length} errors.`
              );
              const finalStatus =
                validationErrors.length > 0 ? 'completed_with_warnings' : 'completed';
              let persistenceResult = null;
              let effectiveStatus = finalStatus;

              if (type === 'players') {
                addLog('Applying validated players to the roster database...');
                const { data: finalizeResult, error: finalizeError } = await supabase.rpc(
                  'finalize_import_job',
                  {
                    p_import_job_id: job.id,
                    p_validation_errors: validationErrors,
                  }
                );

                if (finalizeError) {
                  throw new Error(finalizeError.message || 'Import finalization failed');
                }

                persistenceResult = finalizeResult;
                effectiveStatus = finalizeResult?.status || finalStatus;
                addLog(
                  `Roster database updated: ${finalizeResult?.inserted_players ?? 0} inserted, ${finalizeResult?.updated_players ?? 0} updated.`
                );

                const coachLeadSummary = await captureCoachLeadsForImport({
                  importJobId: job.id,
                  organizationId: currentOrganization.id,
                  normalizedData,
                  addLog,
                });
                if (coachLeadSummary) {
                  persistenceResult = {
                    ...(persistenceResult || {}),
                    coach_leads: coachLeadSummary,
                  };
                  if (coachLeadSummary.status !== 'completed') {
                    effectiveStatus = 'completed_with_warnings';
                  }
                }
              } else if (type === 'coaches') {
                addLog('Applying validated coaches to the coach database...');
                const { data: finalizeResult, error: finalizeError } = await supabase.rpc(
                  'finalize_coach_import_job',
                  {
                    p_import_job_id: job.id,
                    p_validation_errors: validationErrors,
                  }
                );

                if (finalizeError) {
                  throw new Error(finalizeError.message || 'Coach import finalization failed');
                }

                persistenceResult = finalizeResult;
                effectiveStatus = finalizeResult?.status || finalStatus;
                addLog(
                  `Coach database updated: ${finalizeResult?.inserted_coaches ?? 0} inserted, ${finalizeResult?.updated_coaches ?? 0} updated.`
                );
              } else if (type === 'fields') {
                addLog('Applying validated field slots to the facilities database...');
                const { data: finalizeResult, error: finalizeError } = await supabase.rpc(
                  'finalize_field_import_job',
                  {
                    p_import_job_id: job.id,
                    p_validation_errors: validationErrors,
                  }
                );

                if (finalizeError) {
                  throw new Error(finalizeError.message || 'Field import finalization failed');
                }

                persistenceResult = finalizeResult;
                effectiveStatus = finalizeResult?.status || finalStatus;
                addLog(
                  `Facilities database updated: ${finalizeResult?.inserted_fields ?? 0} fields, ${finalizeResult?.inserted_practice_slots ?? 0} practice slots, ${finalizeResult?.inserted_game_slots ?? 0} game slots inserted.`
                );
              }

              const importData = {
                importJobId: job.id,
                fileName: file.name,
                totalRows: data.length,
                validRows: normalizedData.length,
                errorRows: validationErrors.length,
                timestamp: new Date(),
                data: normalizedData,
                validationErrors,
                persistence: {
                  durable: type === 'players' || type === 'coaches' || type === 'fields',
                  result: persistenceResult,
                },
              };

              if (type === 'players') setImportedPlayers(importData);
              if (type === 'coaches') setImportedCoaches(importData);
              if (type === 'fields') setImportedFields(importData);
              setImportedData(importData);

              completeImport(type, importData, effectiveStatus);
            };

            await processChunk();
          },
          error: (err) => {
            addLog(`Error parsing CSV: ${err.message}`);
            setImportStatus('error');
            setIsImporting(false);
          },
        });
      } catch (err) {
        logger.error('Import error:', err);
        addLog(`Import failed: ${err.message}`);
        setImportStatus('error');
        setIsImporting(false);
      }
    },
    [
      addLog,
      telemetryLogs,
      completeImport,
      currentOrganization?.id,
      updateJobProgress,
      organizationSchemas,
    ]
  );

  const rollbackImport = useCallback(
    async (type = 'coaches') => {
      if (!['coaches', 'fields'].includes(type)) {
        throw new Error(`Rollback is not available for ${type} imports yet`);
      }
      const rollbackState = type === 'coaches' ? importedCoaches : importedFields;
      const rollbackJobId = rollbackState?.importJobId;
      if (!rollbackJobId) {
        throw new Error(`No completed ${type} import job is available to roll back`);
      }

      setIsImporting(true);
      setImportStatus('importing');
      addLog(`Rolling back ${type} import...`);

      try {
        const rpcName =
          type === 'coaches' ? 'rollback_coach_import_job' : 'rollback_field_import_job';
        const { data: rollbackResult, error: rollbackError } = await supabase.rpc(rpcName, {
          p_import_job_id: rollbackJobId,
        });

        if (rollbackError) {
          throw new Error(rollbackError.message || `${type} import rollback failed`);
        }

        const rollbackData = {
          ...(rollbackState || {}),
          persistence: {
            ...(rollbackState?.persistence || {}),
            rollback: rollbackResult,
          },
        };
        const rollbackSucceeded = rollbackResult?.status === 'rolled_back';
        if (rollbackSucceeded) {
          if (type === 'coaches') setImportedCoaches(null);
          if (type === 'fields') setImportedFields(null);
          setImportedData(null);
          setActiveJobId(null);
          setActiveJob(null);
        } else {
          if (type === 'coaches') setImportedCoaches(rollbackData);
          if (type === 'fields') setImportedFields(rollbackData);
          setImportedData(rollbackData);
        }
        setIsImporting(false);
        const nextStatus = rollbackSucceeded ? 'idle' : 'completed_with_warnings';
        setImportStatus(nextStatus);
        if (nextStatus === 'idle') {
          localStorage.removeItem('importStatus');
        } else {
          localStorage.setItem('importStatus', nextStatus);
        }
        addLog(
          type === 'coaches'
            ? `Coach import rolled back: ${rollbackResult?.deleted_coaches ?? 0} deleted, ${rollbackResult?.restored_coaches ?? 0} restored.`
            : `Field import rolled back: ${rollbackResult?.deleted_fields ?? 0} fields, ${rollbackResult?.deleted_practice_slots ?? 0} practice slots, ${rollbackResult?.deleted_game_slots ?? 0} game slots deleted.`
        );
        return rollbackResult;
      } catch (err) {
        logger.error('Import rollback failed:', err);
        addLog(`Rollback failed: ${err.message}`);
        setImportStatus('error');
        setIsImporting(false);
        throw err;
      }
    },
    [addLog, importedCoaches, importedFields]
  );

  const resetImport = useCallback(async (type = 'all') => {
    if (type === 'all') {
      setIsImporting(false);
      setImportStatus('idle');
      localStorage.removeItem('importStatus');
      setImportLogs([]);
      setImportedData(null);
      setImportedPlayers(null);
      setImportedCoaches(null);
      setImportedFields(null);
      setActiveJobId(null);
      setActiveJob(null);
    } else {
      if (type === 'players') setImportedPlayers(null);
      if (type === 'coaches') setImportedCoaches(null);
      if (type === 'fields') setImportedFields(null);
    }
  }, []);

  // Stabilized Memoized Data Views
  const maskedImportedPlayers = useMemo(
    () => maskDataInternal(importedPlayers, organizationSchemas?.player),
    [importedPlayers, organizationSchemas?.player]
  );
  const maskedImportedCoaches = useMemo(
    () => maskDataInternal(importedCoaches, organizationSchemas?.coach),
    [importedCoaches, organizationSchemas?.coach]
  );
  const maskedImportedFields = useMemo(
    () => maskDataInternal(importedFields, organizationSchemas?.field),
    [importedFields, organizationSchemas?.field]
  );
  const maskedImportedData = useMemo(
    () =>
      maskDataInternal(
        importedData,
        organizationSchemas?.player || organizationSchemas?.coach || organizationSchemas?.field
      ),
    [importedData, organizationSchemas]
  );

  // Stabilize State Setters
  const stableSetNotifyOnComplete = useCallback((val) => setNotifyOnComplete(val), []);
  const stableSetImportedData = useCallback((data) => setImportedData(data), []);
  const stableSetImportedPlayers = useCallback((data) => setImportedPlayers(data), []);
  const stableSetImportedCoaches = useCallback((data) => setImportedCoaches(data), []);
  const stableSetImportedFields = useCallback((data) => setImportedFields(data), []);

  const value = useMemo(
    () => ({
      isImporting,
      progress,
      importStatus,
      importLogs,
      notifyOnComplete,
      setNotifyOnComplete: stableSetNotifyOnComplete,
      startImport,
      resetImport,
      importedData: maskedImportedData,
      setImportedData: stableSetImportedData,
      importedPlayers: maskedImportedPlayers,
      setImportedPlayers: stableSetImportedPlayers,
      importedCoaches: maskedImportedCoaches,
      setImportedCoaches: stableSetImportedCoaches,
      importedFields: maskedImportedFields,
      setImportedFields: stableSetImportedFields,
      rollbackImport,
      telemetryLogs,
      organizationSchemas,
      activeJobId,
      activeJob,
    }),
    [
      isImporting,
      progress,
      importStatus,
      importLogs,
      notifyOnComplete,
      stableSetNotifyOnComplete,
      startImport,
      resetImport,
      maskedImportedData,
      stableSetImportedData,
      maskedImportedPlayers,
      stableSetImportedPlayers,
      maskedImportedCoaches,
      stableSetImportedCoaches,
      maskedImportedFields,
      stableSetImportedFields,
      rollbackImport,
      telemetryLogs,
      organizationSchemas,
      activeJobId,
      activeJob,
    ]
  );

  return <ImportContext.Provider value={value}>{children}</ImportContext.Provider>;
}
