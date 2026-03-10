import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabaseClient.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { Search, CheckCircle2, AlertCircle, ClipboardCheck, History } from 'lucide-react';

export default function AdminComplianceDashboard() {
  const { currentOrganization } = useOrganization();
  const [forms, setForms] = useState([]);
  const [selectedFormId, setSelectedFormId] = useState('');
  const [registrations, setRegistrations] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadForms() {
      if (!currentOrganization?.id) return;
      try {
        const { data, error } = await supabase
          .from('registration_forms')
          .select('id, title, status')
          .eq('organization_id', currentOrganization.id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        setForms(data || []);
        if (data && data.length > 0) {
          setSelectedFormId(data[0].id);
        }
      } catch (err) {
        console.error(err);
      }
    }
    loadForms();
  }, [currentOrganization?.id]);

  useEffect(() => {
    async function loadRegistrations() {
      if (!currentOrganization?.id || !selectedFormId) return;
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase
          .from('registrations')
          .select(
            `
            id,
            waiver_signed,
            medical_cleared,
            responses,
            created_at,
            players ( id, first_name, last_name ),
            profiles ( id, first_name, last_name, email )
          `
          )
          .eq('organization_id', currentOrganization.id)
          .eq('form_id', selectedFormId);
        if (error) throw error;
        setRegistrations(data || []);
      } catch (err) {
        console.error(err);
        setError('Failed to load compliance data.');
      } finally {
        setLoading(false);
      }
    }
    loadRegistrations();
  }, [currentOrganization?.id, selectedFormId]);

  const toggleMedicalStatus = async (regId, currentStatus) => {
    try {
      const newStatus = !currentStatus;
      const { error } = await supabase
        .from('registrations')
        .update({ medical_cleared: newStatus })
        .eq('id', regId);
      if (error) throw error;

      setRegistrations((prev) =>
        prev.map((r) => (r.id === regId ? { ...r, medical_cleared: newStatus } : r))
      );
    } catch (err) {
      console.error(err);
      alert('Failed to update medical status.');
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fadeIn">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-text-primary">
            Compliance Dashboard
          </h1>
          <p className="text-text-secondary">Track waivers, medical clearances, and forms.</p>
        </div>
        <div className="flex gap-4">{/* Future: Add 'Create Form' button */}</div>
      </div>

      <div className="bg-bg-surface border border-border-subtle rounded-xl p-6 shadow-md">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
          <div className="w-full md:w-1/3">
            <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
              Filter by Form
            </label>
            <select
              className="w-full bg-bg-app border border-border-highlight text-text-primary text-sm rounded-lg focus:ring-brand-500 focus:border-brand-500 block p-2.5"
              value={selectedFormId}
              onChange={(e) => setSelectedFormId(e.target.value)}
            >
              {forms.length === 0 && <option value="">No forms available...</option>}
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title} ({f.status})
                </option>
              ))}
            </select>
          </div>
          <div className="w-full md:w-1/4 relative mt-4 md:mt-0">
            <Search
              size={18}
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-muted"
            />
            <input
              type="text"
              placeholder="Search player/parent..."
              className="w-full bg-bg-app border border-border-highlight rounded-lg py-2 pl-10 pr-4 text-sm text-text-primary focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-text-muted animate-pulse">
            Loading compliance records...
          </div>
        ) : error ? (
          <div className="text-center py-12 text-red-400">{error}</div>
        ) : registrations.length === 0 ? (
          <div className="text-center py-12 text-text-secondary flex flex-col items-center">
            <ClipboardCheck size={48} className="text-border-highlight mb-4" />
            <p>No registrations found for this form.</p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-border-subtle rounded-xl">
            <table className="w-full text-sm text-left text-text-secondary">
              <thead className="text-xs text-text-muted uppercase bg-bg-app border-b border-border-subtle">
                <tr>
                  <th className="px-6 py-4 font-semibold tracking-wider">Player</th>
                  <th className="px-6 py-4 font-semibold tracking-wider">Parent / Guardian</th>
                  <th className="px-6 py-4 font-semibold tracking-wider text-center">
                    Waiver Signed
                  </th>
                  <th className="px-6 py-4 font-semibold tracking-wider text-center">
                    Medical Clearance
                  </th>
                  <th className="px-6 py-4 font-semibold tracking-wider text-right">
                    Registered On
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {registrations.map((reg) => (
                  <tr key={reg.id} className="bg-bg-surface hover:bg-bg-app/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-500/20 text-brand-400 flex items-center justify-center font-bold text-xs">
                          {reg.players?.first_name?.[0]}
                          {reg.players?.last_name?.[0]}
                        </div>
                        <span className="font-medium text-text-primary">
                          {reg.players?.first_name} {reg.players?.last_name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-text-primary">
                        {reg.profiles?.first_name} {reg.profiles?.last_name}
                      </div>
                      <div className="text-xs text-text-muted">{reg.profiles?.email}</div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {reg.waiver_signed ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-green-500/10 text-green-400 border border-green-500/20">
                          <CheckCircle2 size={12} /> Confirmed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
                          <AlertCircle size={12} /> Pending
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => toggleMedicalStatus(reg.id, reg.medical_cleared)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border transition-all hover:opacity-80 ${reg.medical_cleared ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-bg-surface text-text-muted border-border-highlight hover:border-brand-500/50 hover:text-brand-400'}`}
                        title="Click to toggle medical clearance status"
                      >
                        {reg.medical_cleared ? <CheckCircle2 size={12} /> : <History size={12} />}
                        {reg.medical_cleared ? 'Cleared' : 'Reviewing'}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-right text-xs whitespace-nowrap text-text-muted">
                      {new Date(reg.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
