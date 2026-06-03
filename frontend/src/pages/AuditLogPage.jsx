import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { logger } from '../lib/logger.js';
import {
  Filter,
  ChevronLeft,
  ChevronRight,
  UserPlus,
  History,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import Button from '../components/ui/Button.jsx';

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const { currentOrganization } = useOrganization();

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [impersonatedOnly, setImpersonatedOnly] = useState(false);

  const fetchLogs = useCallback(async () => {
    if (!currentOrganization?.id) return;

    setLoading(true);
    try {
      let query = supabase
        .from('audit_log')
        .select('*', { count: 'exact' })
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (actionFilter) {
        query = query.eq('action', actionFilter);
      }

      if (impersonatedOnly) {
        query = query.not('metadata->impersonated_by', 'is', null);
      }

      const { data, count, error } = await query;

      if (error) throw error;

      setLogs(data || []);
      setTotalCount(count || 0);
    } catch (err) {
      logger.error('Failed to fetch audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, [currentOrganization?.id, currentPage, actionFilter, impersonatedOnly]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const formatMetadata = (metadata) => {
    if (!metadata) return null;
    return (
      <pre className="text-[10px] bg-bg-glass p-2 rounded max-h-24 overflow-y-auto font-mono text-text-muted">
        {JSON.stringify(metadata, null, 2)}
      </pre>
    );
  };

  return (
    <div className="animate-fadeIn space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 py-2">
        <div>
          <h1 className="text-3xl font-display font-bold text-text-primary flex items-center gap-3">
            <History className="text-primary-500" />
            Audit Explorer
          </h1>
          <p className="text-text-muted mt-1 italic opacity-80">
            Immutable system-wide event traceability for compliance.
          </p>
        </div>

        <div className="flex items-center gap-3 bg-bg-glass p-1.5 rounded-lg border border-border-subtle shadow-lg">
          <History className="w-5 h-5 text-primary-500" />
          <span className="text-sm font-medium text-text-secondary">
            {totalCount.toLocaleString()} Total Events
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-bg-card/40 border border-border-default/50 p-4 rounded-xl shadow-inner-glass">
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <select
            className="w-full bg-bg-input/50 border border-border-default rounded-lg pl-10 pr-4 py-2 text-sm text-text-primary focus:ring-2 focus:ring-primary-500 transition-all outline-none appearance-none cursor-pointer"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            <option value="">All Actions</option>
            <option value="auth.password_updated">Password Updated</option>
            <option value="impersonation.started">Impersonation Started</option>
            <option value="impersonation.ended">Impersonation Ended</option>
            <option value="settings.color_updated">Branding: Color Updated</option>
            <option value="settings.logo_uploaded">Branding: Logo Uploaded</option>
            <option value="settings.season_format_updated">Season: Format Updated</option>
            <option value="settings.season_updated">Season: Label Updated</option>
            <option value="settings.timezone_updated">Season: Timezone Updated</option>
            <option value="settings.flags_updated">Feature Flags Updated</option>
            <option value="data.imported">Data Imported</option>
            <option value="teaming.generation_started">Teaming Generated</option>
            <option value="player.reassigned">Player Reassigned</option>
          </select>
        </div>

        <div className="flex items-center gap-2 px-3">
          <input
            type="checkbox"
            id="impersonatedOnly"
            className="w-4 h-4 rounded border-border-default bg-bg-input text-primary-600 focus:ring-primary-500"
            checked={impersonatedOnly}
            onChange={(e) => setImpersonatedOnly(e.target.checked)}
          />
          <label
            htmlFor="impersonatedOnly"
            className="text-sm text-text-primary cursor-pointer select-none"
          >
            Impersonated Only
          </label>
        </div>

        <div className="md:col-start-4 flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setActionFilter('');
              setImpersonatedOnly(false);
              setCurrentPage(0);
            }}
          >
            Reset
          </Button>
          <Button variant="primary" size="sm" onClick={fetchLogs}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-bg-card/40 border border-border-default/50 rounded-xl overflow-hidden shadow-md relative">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border-default/50 bg-bg-glass">
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Timestamp
                </th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  User ID
                </th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Action
                </th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Trace
                </th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Metadata
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default/30">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={5} className="px-6 py-8 h-16">
                      <div className="h-4 bg-bg-surface-hover rounded w-full"></div>
                    </td>
                  </tr>
                ))
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-text-muted italic">
                    <div className="flex flex-col items-center gap-3">
                      <AlertCircle className="w-10 h-10 opacity-20" />
                      No audit logs found matching the criteria.
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isImpersonated = !!log.metadata?.impersonated_by;
                  return (
                    <tr key={log.id} className="hover:bg-bg-glass transition-colors group">
                      <td className="px-6 py-4 text-sm text-text-primary whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-sm font-mono text-primary-400">
                        {log.user_id?.slice(0, 8)}...
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-tighter ${
                            log.action.includes('error') || log.action.includes('denied')
                              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                              : log.action.includes('started') || log.action.includes('login')
                                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          }`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {isImpersonated ? (
                          <div className="flex flex-col gap-1">
                            <span className="flex items-center gap-1.5 text-[11px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded shadow-sm">
                              <UserPlus className="w-3 h-3" />
                              IMPERSONATED
                            </span>
                            <span className="text-[10px] text-text-muted opacity-70 truncate max-w-[120px]">
                              by: {log.metadata.admin_email}
                            </span>
                          </div>
                        ) : (
                          <span className="flex items-center gap-1.5 text-[11px] font-medium text-text-muted opacity-60">
                            <ShieldCheck className="w-3 h-3 text-green-500/50" />
                            Direct Session
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 min-w-[200px]">{formatMetadata(log.metadata)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-6 py-4 bg-bg-glass border-t border-border-default/50 flex items-center justify-between">
          <div className="text-xs text-text-muted">
            Showing{' '}
            <span className="font-semibold text-text-primary">{currentPage * PAGE_SIZE + 1}</span>{' '}
            to{' '}
            <span className="font-semibold text-text-primary">
              {Math.min((currentPage + 1) * PAGE_SIZE, totalCount)}
            </span>{' '}
            of <span className="font-semibold text-text-primary">{totalCount}</span> results
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={currentPage === 0 || loading}
              onClick={() => setCurrentPage((prev) => prev - 1)}
              className="px-2"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            <div className="flex gap-1">
              {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                // Simplified pagination for now
                const pageNum = i;
                return (
                  <button
                    key={i}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`w-8 h-8 rounded-md text-xs font-medium transition-all ${
                      currentPage === pageNum
                        ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20'
                        : 'text-text-muted hover:bg-bg-surface-hover'
                    }`}
                  >
                    {pageNum + 1}
                  </button>
                );
              })}
              {totalPages > 5 && <span className="text-text-muted self-end py-1">...</span>}
            </div>

            <Button
              variant="secondary"
              size="sm"
              disabled={currentPage >= totalPages - 1 || loading}
              onClick={() => setCurrentPage((prev) => prev + 1)}
              className="px-2"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
