import { createClient } from '@supabase/supabase-js';

async function globalTeardown() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey || process.env.VITE_USE_MOCK_SUPABASE === 'true') {
    console.log('Skipping global teardown in mock mode.');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('🧹 Purging temporary E2E test organizations...');

  // Wipe organizations generated dynamically by concurrent tests
  const { error } = await supabase.from('organizations').delete().like('name', 'E2E-Isolation-%');

  if (error) {
    console.error('Failed to cleanup E2E databases:', error);
  } else {
    console.log('✅ Temporary E2E data cleared.');
  }
}

export default globalTeardown;
