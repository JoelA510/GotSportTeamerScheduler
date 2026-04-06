import { describe, it, expect } from 'vitest';
import { mockSupabase as supabase } from '../frontend/src/lib/mockSupabaseClient.js';

describe('Supabase Hardening Verification', () => {
  it('should enforce 12-character password minimum on signUp', async () => {
    const { data, error } = await supabase.auth.signUp({ 
      email: 'test@example.com', 
      password: 'short' 
    });
    expect(data.user).toBeNull();
    expect(error.message).toContain('Password must be at least 12 characters long');
  });

  it('should allow 12-character password on signUp', async () => {
    const { data, error } = await supabase.auth.signUp({ 
      email: 'test@example.com', 
      password: 'longenough123' 
    });
    expect(error).toBeNull();
    expect(data.user).toBeDefined();
  });

  it('should enforce 12-character password minimum on updateUser', async () => {
    const { data, error } = await supabase.auth.updateUser({ 
      password: 'short' 
    });
    expect(data.user).toBeNull();
    expect(error.message).toContain('Password must be at least 12 characters long');
  });

  it('should record audit events via record_audit_event RPC', async () => {
    const params = {
      p_action: 'auth.password_updated',
      p_metadata: { user_id: 'test-user' }
    };
    
    const { error: rpcError } = await supabase.rpc('record_audit_event', params);
    expect(rpcError).toBeNull();

    const { data: logs, error: queryError } = await supabase
      .from('audit_log')
      .select('*')
      .eq('action', 'auth.password_updated');
    
    expect(queryError).toBeNull();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[logs.length - 1].action).toBe('auth.password_updated');
  });

  it('should store impersonation metadata correctly in audit_log', async () => {
    const impersonationMetadata = {
      user_id: 'admin-id',
      target_user_id: 'target-user-id',
      impersonated_by: 'admin-id',
      admin_email: 'admin@squadlogic.demo',
      flags: { ADVANCED_FAIRNESS: true }
    };

    const { error: rpcError } = await supabase.rpc('record_audit_event', {
      p_organization_id: 'demo-org',
      p_action: 'settings.flags_updated',
      p_metadata: impersonationMetadata
    });
    expect(rpcError).toBeNull();

    const { data: logs, error: queryError } = await supabase
      .from('audit_log')
      .select('*')
      .eq('action', 'settings.flags_updated');

    expect(queryError).toBeNull();
    const latestLog = (logs || []).pop();
    expect(latestLog).toBeDefined();
    expect(latestLog.metadata.impersonated_by).toBe('admin-id');
    expect(latestLog.metadata.admin_email).toBe('admin@squadlogic.demo');
    expect(latestLog.metadata.flags.ADVANCED_FAIRNESS).toBe(true);
  });
});
