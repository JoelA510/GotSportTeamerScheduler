import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import process from 'process';
import readline from 'readline';

// 1. Load configuration from .env and .env.local
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Error: Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env/.env.local');
  process.exit(1);
}

// 2. Initialize Admin Client (Bypasses RLS)
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/**
 * List of tables to clear, ordered to avoid foreign key violations where possible.
 */
const TABLES_TO_CLEAR = [
  'audit_log',
  'games',
  'practice_assignments',
  'team_players',
  'teams',
  'game_slots',
  'practice_slots',
  'field_subunits',
  'fields',
  'locations',
  'coaches',
  'player_buddies',
  'players',
  'divisions',
  'season_settings',
  'import_jobs',
  'staging_players',
  'scheduler_runs',
  'evaluation_run_events',
  'evaluation_findings',
  'evaluation_metrics',
  'evaluation_runs',
  'export_jobs',
  'email_log'
];

/**
 * Safety confirmation before executing destructive operations.
 */
async function confirmExecution(url) {
  const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
  const isForced = process.argv.includes('--force');

  if (isForced) {
    console.log('⚠️  --force flag detected. Bypassing confirmation prompt.');
    return true;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\n' + '!'.repeat(50));
  console.log('⚠️  DESTRUCTIVE OPERATION WARNING ⚠️');
  console.log(`Targeting: ${url}`);
  if (!isLocal) {
    console.log('\n[CRITICAL] This appears to be a REMOTE/PRODUCTION environment.');
  }
  console.log('!'.repeat(50) + '\n');

  const question = isLocal 
    ? 'Are you sure you want to clear ALL data? (y/N): ' 
    : `Type the full URL to CONFIRM deletion of ${url}: `;

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (isLocal) {
        resolve(answer.toLowerCase() === 'y');
      } else {
        resolve(answer === url);
      }
    });
  });
}

/**
 * Attempt to dynamically fetch tables from public schema.
 * 
 * NOTE: For full dynamic discovery, run the following SQL in your Supabase Editor:
 * 
 * CREATE OR REPLACE FUNCTION get_public_tables()
 * RETURNS TABLE (table_name text) 
 * LANGUAGE plpgsql
 * SECURITY DEFINER
 * AS $$
 * BEGIN
 *     RETURN QUERY
 *     SELECT t.table_name::text
 *     FROM information_schema.tables t
 *     WHERE t.table_schema = 'public'
 *     AND t.table_type = 'BASE TABLE';
 * END;
 * $$;
 */
async function getDynamicTableList() {
  try {
    // Attempt to use the helper RPC for true dynamic discovery
    const { data: rpcData, error: rpcError } = await adminClient.rpc('get_public_tables');
    
    if (!rpcError && Array.isArray(rpcData)) {
      return rpcData.map(t => typeof t === 'string' ? t : t.table_name);
    }

    console.warn('     ℹ️  Dynamic discovery (RPC) unavailable. Using internal registry.');
    console.warn('     💡 Tip: Deploy "get_public_tables()" RPC for automatic schema detection.');
    return TABLES_TO_CLEAR;
  } catch (err) {
    return TABLES_TO_CLEAR;
  }
}

async function clearStorage() {
  const confirmed = await confirmExecution(SUPABASE_URL);
  
  if (!confirmed) {
    console.log('\n❌ Operation cancelled by user. No data was deleted.');
    return;
  }

  const tables = await getDynamicTableList();
  console.log('\n🧹 Clearing existing Supabase storage data...\n');
  console.log('USAGE TIP: For automation, use: node scripts/clear-remote-storage.js --force\n');

  for (const table of tables) {
    try {
      console.log(`   - Clearing table: ${table}...`);
      
      // Try by UUID primary key (most common)
      const { error } = await adminClient
        .from(table)
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (error) {
        // Fallback for tables without 'id' or with bigint PKs
        const { error: retryError } = await adminClient
          .from(table)
          .delete()
          .gte('created_at', '1900-01-01');
          
        if (retryError) {
          // If both fail, the table likely has a unique schema or different PK name
          console.warn(`     ⚠️  Skipped ${table}: ${retryError.message}`);
        } else {
          console.log(`     ✅ Cleared ${table} (Fallback filter)`);
        }
      } else {
        console.log(`     ✅ Cleared ${table}`);
      }
    } catch (err) {
      console.error(`     ❌ Error clearing ${table}:`, err.message);
    }
  }

  console.log('\n✨ Database storage cleared (DATA ONLY).');
  console.log('NOTE: Schema changes (Migrations) must be applied via the Supabase SQL Editor as the CLI is unavailable.');
}

clearStorage();
