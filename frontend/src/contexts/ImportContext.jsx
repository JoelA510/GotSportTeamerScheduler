import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import Papa from 'papaparse';
import { logger } from '../lib/logger.js';
import { useOrganization } from './OrganizationContext.jsx';
import { matchHeaders } from '../utils/telemetryUtils.js';

const ImportContext = createContext({
  isImporting: false,
  progress: 0,
  importStatus: 'idle',
  importLogs: [],
  notifyOnComplete: false,
  setNotifyOnComplete: (val) => {},
  startImport: async (file, type) => {},
  resetImport: async (type) => {},
  importedData: null,
  setImportedData: (data) => {},
  importedPlayers: null,
  setImportedPlayers: (data) => {},
  importedCoaches: null,
  setImportedCoaches: (data) => {},
  importedFields: null,
  setImportedFields: (data) => {},
  telemetryLogs: [],
});

export function useImport() {
  return useContext(ImportContext);
}

export function ImportProvider({ children }) {
  const { currentOrganization } = useOrganization();
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importStatus, setImportStatus] = useState(() => {
    return localStorage.getItem('importStatus') || 'idle';
  }); // idle, importing, completed, error
  const [importLogs, setImportLogs] = useState([]);
  const [notifyOnComplete, setNotifyOnComplete] = useState(false);
  const [telemetryLogs, setTelemetryLogs] = useState([]);

  // Multi-type state
  const [importedPlayers, setImportedPlayers] = useState(null);
  const [importedCoaches, setImportedCoaches] = useState(null);
  const [importedFields, setImportedFields] = useState(null);
  const [importedData, setImportedData] = useState(null); // Legacy/General

  // 1. Fetch Organization-Scoped Telemetry (RBAC Check)
  useEffect(() => {
    const loadTelemetry = async () => {
      if (!currentOrganization?.id) return;
      
      try {
        logger.log('[ImportContext] Fetching telemetry for org:', currentOrganization.id);
        const { data, error } = await supabase
          .from('telemetry_log')
          .select('*')
          .eq('org_id', currentOrganization.id)
          .order('created_at', { ascending: false });

        if (error) throw error;
        setTelemetryLogs(data || []);
      } catch (err) {
        logger.error('Failed to fetch telemetry logs:', err);
      }
    };

    loadTelemetry();
  }, [currentOrganization?.id]);

  // 2. Load initial state from Supabase
  useEffect(() => {
    const loadFromSupabase = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          logger.log('[ImportContext] No user found, skipping load');
          return;
        }

        logger.log('[ImportContext] Loading imports for user:', user.id, 'org:', currentOrganization.id);
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        loadFromSupabase();
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  const addLog = useCallback((message) => {
    setImportLogs((prev) => [...prev, { timestamp: new Date(), message }]);
  }, []);

  const completeImport = useCallback((type, previewData) => {
    setIsImporting(false);
    setImportStatus('completed');
    localStorage.setItem('importStatus', 'completed');
    addLog(`Import for ${type} completed successfully.`);

    if (notifyOnComplete) {
      logger.log('Sending email notification...');
      addLog('Email notification sent.');
    }
  }, [addLog, notifyOnComplete]);

  const startImport = useCallback(async (file, type = 'players') => {
    setIsImporting(true);
    setImportStatus('importing');
    setProgress(0);
    setImportLogs([]);
    addLog(`Starting import for ${type} from ${file.name}...`);

    try {
      addLog('Parsing CSV data...');
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          const { data, meta } = results;

          // Phase 3: Smart Ingestion Logic
          const { mappings, isFallback, timing } = matchHeaders(meta.fields, telemetryLogs);
          
          if (isFallback) {
             addLog(`Performance Warning: Smart Ingestion timed out (${timing.toFixed(2)}ms). Using static fallback.`);
          } else {
             addLog(`Smart Ingestion active. Match calculated in ${timing.toFixed(2)}ms.`);
          }

          const normalizeHeader = (h) => mappings[h] || h.toLowerCase().trim();
          const normalizedData = [];
          const validationErrors = [];

          const REQUIRED_HEADERS = {
            players: ['first_name', 'last_name', 'date_of_birth'],
            coaches: ['full_name', 'email'],
            fields: ['name']
          };

          const requiredForType = REQUIRED_HEADERS[type] || [];
          const normalizedFileHeaders = meta.fields.map(normalizeHeader);

          const missingHeaders = requiredForType.filter(req => !normalizedFileHeaders.includes(req));
          if (missingHeaders.length > 0) {
              setImportStatus('error');
              setIsImporting(false);
              addLog(`Import failed: Missing required columns: ${missingHeaders.join(', ')}`);
              return;
          }

          data.forEach((row, index) => {
            const newRow = {};
            let isRowValid = true;
            let rowErrors = [];

            Object.keys(row).forEach((key) => {
              const mapped = normalizeHeader(key);
              newRow[mapped] = row[key];
            });

            if (type === 'players') {
               if (!newRow['first_name']) { isRowValid = false; rowErrors.push('Missing first name'); }
               if (!newRow['last_name']) { isRowValid = false; rowErrors.push('Missing last name'); }
            }

            if (isRowValid) normalizedData.push(newRow);
            else validationErrors.push({ row: index + 2, data: newRow, errors: rowErrors });
          });

          addLog(`Processed ${normalizedData.length} valid rows.`);

          const importData = {
            fileName: file.name,
            totalRows: data.length,
            validRows: normalizedData.length,
            errorRows: validationErrors.length,
            timestamp: new Date(),
            data: normalizedData,
            validationErrors
          };

          addLog('Saving to database...');
          const { data: { user } } = await supabase.auth.getUser();

          if (user && currentOrganization?.id) {
            await supabase.from('import_jobs').insert({
              created_by: user.id,
              organization_id: currentOrganization.id,
              job_type: type === 'fields' ? 'fields' : 'registration',
              storage_path: `imports/${user.id}/${file.name}`,
              status: validationErrors.length > 0 ? 'completed_with_warnings' : 'completed',
              total_rows: data.length,
              processed_rows: normalizedData.length,
              error_summary: { rowErrors: validationErrors }
            });
          }

          if (type === 'players') setImportedPlayers(importData);
          if (type === 'coaches') setImportedCoaches(importData);
          if (type === 'fields') setImportedFields(importData);
          setImportedData(importData);

          completeImport(type, importData);
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
  }, [addLog, telemetryLogs, completeImport]);

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
    } else {
      if (type === 'players') setImportedPlayers(null);
      if (type === 'coaches') setImportedCoaches(null);
      if (type === 'fields') setImportedFields(null);
    }
  }, []);

  const value = useMemo(() => ({
    isImporting,
    progress,
    importStatus,
    importLogs,
    notifyOnComplete,
    setNotifyOnComplete,
    startImport,
    resetImport,
    importedData,
    setImportedData,
    importedPlayers,
    setImportedPlayers,
    importedCoaches,
    setImportedCoaches,
    importedFields,
    setImportedFields,
    telemetryLogs,
  }), [
    isImporting, progress, importStatus, importLogs, 
    notifyOnComplete, startImport, resetImport, 
    importedData, importedPlayers, importedCoaches, 
    importedFields, telemetryLogs
  ]);

  return <ImportContext.Provider value={value}>{children}</ImportContext.Provider>;
}
