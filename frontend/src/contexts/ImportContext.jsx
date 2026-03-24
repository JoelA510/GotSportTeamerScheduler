import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import Papa from 'papaparse';
import { logger } from '../lib/logger.js';

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
});

export function useImport() {
  return useContext(ImportContext);
}

export function ImportProvider({ children }) {
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importStatus, setImportStatus] = useState(() => {
    return localStorage.getItem('importStatus') || 'idle';
  }); // idle, importing, completed, error
  const [importLogs, setImportLogs] = useState([]);
  const [notifyOnComplete, setNotifyOnComplete] = useState(false);

  // Multi-type state
  const [importedPlayers, setImportedPlayers] = useState(null);
  const [importedCoaches, setImportedCoaches] = useState(null);
  const [importedFields, setImportedFields] = useState(null);
  const [importedData, setImportedData] = useState(null); // Legacy/General

  // Load initial state from Supabase
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

        logger.log('[ImportContext] Loading imports for user:', user.id);
        const { data, error } = await supabase
          .from('imports')
          .select('*')
          .eq('user_id', user.id)
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

    // Listen for auth changes to reload data
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        loadFromSupabase();
      } else if (event === 'SIGNED_OUT') {
        resetImport('all');
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  // Helper for safe storage
  const saveToStorage = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        logger.warn(`Storage quota exceeded for ${key}. Persistence disabled for this item.`);
        addLog(`Warning: Data too large to save locally. It will be lost on refresh.`);
      } else {
        logger.error(`Failed to save ${key} to localStorage`, e);
      }
    }
  };

  const startImport = async (file, type = 'players') => {
    setIsImporting(true);
    setImportStatus('importing');
    setProgress(0);
    setImportLogs([]);
    addLog(`Starting import for ${type} from ${file.name}...`);

    try {
      // 1. Parse CSV client-side
      addLog('Parsing CSV data...');
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          const { data, meta } = results;

          // R3 Update: Normalize headers to match schema
          // Phase 4 (L-3): Strict alias map replaces fuzzy .includes() matching.
          // Mirrors the server-side HEADER_ALIASES in import-validation Edge Function.
          const HEADER_ALIASES = {
            'first name': 'first_name', 'first_name': 'first_name', 'firstname': 'first_name',
            'last name': 'last_name', 'last_name': 'last_name', 'lastname': 'last_name',
            'date of birth': 'date_of_birth', 'date_of_birth': 'date_of_birth',
            'dob': 'date_of_birth', 'birthdate': 'date_of_birth',
            'full name': 'full_name', 'full_name': 'full_name', 'coach name': 'full_name',
            'email': 'email', 'email address': 'email',
            'name': 'name', 'field name': 'name', 'field_name': 'name',
            'coach willing': 'willing_to_coach', 'willing to coach': 'willing_to_coach',
            'buddy': 'buddy_request', 'buddy request': 'buddy_request',
            'friend': 'buddy_request', 'friend request': 'buddy_request',
            'medical': 'medical_info', 'medical info': 'medical_info',
            'allergy': 'medical_info', 'allergies': 'medical_info',
            'skill': 'skill_tier', 'skill level': 'skill_tier',
            'skill tier': 'skill_tier', 'level': 'skill_tier',
          };
          const normalizeHeader = (h) => HEADER_ALIASES[h.toLowerCase().trim()] ?? h.toLowerCase().trim();

          const normalizedData = [];
          const validationErrors = [];

          const REQUIRED_HEADERS = {
            players: ['first_name', 'last_name', 'date_of_birth'],
            coaches: ['full_name', 'email'],
            fields: ['name']
          };

          const requiredForType = REQUIRED_HEADERS[type] || [];
          const normalizedFileHeaders = meta.fields.map(normalizeHeader);

          // 1. Validate Headers (strict alias match)
          const missingHeaders = requiredForType.filter(req => !normalizedFileHeaders.includes(req));
          if (missingHeaders.length > 0) {
              setImportStatus('error');
              setIsImporting(false);
              addLog(`Import failed: Missing required columns: ${missingHeaders.join(', ')}`);
              return;
          }

          // 2. Process and Validate Rows
          data.forEach((row, index) => {
            const newRow = {};
            let isRowValid = true;
            let rowErrors = [];

            Object.keys(row).forEach((key) => {
              const mapped = normalizeHeader(key);
              newRow[mapped] = row[key];
            });

            // Row validation
            if (type === 'players') {
               if (!newRow['first_name']) {
                   isRowValid = false;
                   rowErrors.push('Missing first name');
               }
               if (!newRow['last_name']) {
                   isRowValid = false;
                   rowErrors.push('Missing last name');
               }
            }

            if (isRowValid) {
                normalizedData.push(newRow);
            } else {
                validationErrors.push({ row: index + 2, data: newRow, errors: rowErrors });
            }
          });

          addLog(`Parsed ${normalizedData.length} valid rows. Found ${validationErrors.length} rows with errors.`);

          const importData = {
            fileName: file.name,
            totalRows: data.length,
            validRows: normalizedData.length,
            errorRows: validationErrors.length,
            timestamp: new Date(),
            data: normalizedData,
            validationErrors
          };

          // 2. Save to Supabase DB (If we had real staging tables we'd insert them here, for now we save the blob)
          addLog('Saving to database...');
          const {
            data: { user },
          } = await supabase.auth.getUser();

          if (user) {
            const { error: insertError } = await supabase.from('import_jobs').insert({
              created_by: user.id,
              job_type: type === 'fields' ? 'fields' : 'registration',
              storage_path: `imports/${user.id}/${file.name}`,
              status: validationErrors.length > 0 ? 'completed_with_warnings' : 'completed',
              total_rows: data.length,
              processed_rows: normalizedData.length,
              error_summary: { rowErrors: validationErrors }
            });

            if (insertError) {
              addLog(`Warning: Failed to save to import_jobs: ${insertError.message}`);
            } else {
               addLog('Saved to database successfully.');
            }
          } else {
            addLog('Warning: User not authenticated, data will not be saved to DB.');
          }

          // Update local state
          if (type === 'players') setImportedPlayers(importData);
          if (type === 'coaches') setImportedCoaches(importData);
          if (type === 'fields') setImportedFields(importData);
          setImportedData(importData); // Legacy

          completeImport(type);
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
  };

  const completeImport = (type) => {
    setIsImporting(false);
    setImportStatus('completed');
    localStorage.setItem('importStatus', 'completed'); // Keep status in local storage for UI flow
    addLog(`Import for ${type} completed successfully.`);

    if (notifyOnComplete) {
      // Simulate email notification
      logger.log('Sending email notification...');
      addLog('Email notification sent.');
    }
  };

  const addLog = (message) => {
    setImportLogs((prev) => [...prev, { timestamp: new Date(), message }]);
  };

  const resetImport = async (type = 'all') => {
    if (type === 'all') {
      setIsImporting(false);
      setImportStatus('idle');
      localStorage.removeItem('importStatus');
      setImportLogs([]);
      setImportedData(null);
      setImportedPlayers(null);
      setImportedCoaches(null);
      setImportedFields(null);

      // Optional: Delete from DB? For now, just clearing local state is safer/simpler for "reset"
      // If we wanted to delete, we'd need the ID.
    } else {
      // Reset specific type
      if (type === 'players') setImportedPlayers(null);
      if (type === 'coaches') setImportedCoaches(null);
      if (type === 'fields') setImportedFields(null);
    }
  };

  const value = {
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
  };

  return <ImportContext.Provider value={value}>{children}</ImportContext.Provider>;
}
