import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Download, Users, ShieldCheck, MapPin, Activity } from 'lucide-react';

export default function AdminReportingDashboard() {
  const { currentOrganization } = useOrganization();

  const [metrics, setMetrics] = useState({ players: 0, teams: 0, users: 0 });
  const [compliance, setCompliance] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [standings, setStandings] = useState([]);

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadReports() {
      if (!currentOrganization?.id) return;
      setLoading(true);
      setError(null);
      try {
        // Load Org Metrics
        const { data: orgData, error: orgErr } = await supabase
          .from('view_org_metrics')
          .select('*')
          .eq('organization_id', currentOrganization.id)
          .single();
        if (orgErr && orgErr.code !== 'PGRST116') throw orgErr; // Ignore no rows error if brand new org
        if (orgData)
          setMetrics({
            players: orgData.total_players,
            teams: orgData.total_teams,
            users: orgData.total_users,
          });

        // Load Compliance Stats
        const { data: compData, error: compErr } = await supabase
          .from('view_compliance_stats')
          .select('*')
          .eq('organization_id', currentOrganization.id);
        if (compErr) throw compErr;
        setCompliance(compData || []);

        // Load Facility Usage
        const { data: facData, error: facErr } = await supabase
          .from('view_facility_usage')
          .select('*')
          .eq('organization_id', currentOrganization.id);
        if (facErr) throw facErr;
        setFacilities(facData || []);

        // Load Standings (For division distribution proxy in this view)
        const { error: stdErr } = await supabase
          .from('view_league_standings')
          .select('division, count as teams_count')
          .eq('organization_id', currentOrganization.id);
        if (stdErr && stdErr.code !== 'PGRST116') {
             // We can ignore if it fails or log it, but the pie chart just needs raw rawStdData below
        }
        // Note: PostgREST won't effortlessly count over views without aggregation,
        // to keep it simple we'll just pull raw standings and count manually in JS for the pie chart
        const { data: rawStdData } = await supabase
          .from('view_league_standings')
          .select('division')
          .eq('organization_id', currentOrganization.id);

        if (rawStdData) {
          const counts = rawStdData.reduce((acc, curr) => {
            const div = curr.division || 'Unassigned';
            acc[div] = (acc[div] || 0) + 1;
            return acc;
          }, {});
          setStandings(Object.keys(counts).map((key) => ({ name: key, value: counts[key] })));
        }
      } catch (err) {
        console.error(err);
        setError('Failed to load reporting metrics.');
      } finally {
        setLoading(false);
      }
    }
    loadReports();
  }, [currentOrganization?.id]);

  const handleExportRosters = async () => {
    if (!currentOrganization?.id) return;
    setExporting(true);
    try {
      // Fetch Raw Data for export using existing client logic
      const { data: teamsData, error: tErr } = await supabase
        .from('teams')
        .select(
          `
          id, name, division, coach_id,
          coach:profiles!coach_id (first_name, last_name, email)
        `
        )
        .eq('organization_id', currentOrganization.id);
      if (tErr) throw tErr;

      const { data: playersData, error: pErr } = await supabase
        .from('players')
        .select('id, first_name, last_name, date_of_birth, team_id')
        .eq('organization_id', currentOrganization.id);
      if (pErr) throw pErr;

      // Construct a simple roster CSV (custom for this view, avoiding the complex schedule export if possible,
      // but the guardrails specifically requested using `@squadlogic/core/src/outputGeneration.js` which is schedule specific...
      // WAIT, the core outputGeneration.js actually handles schedule formatting (Practice/Game).
      // It does NOT have a roster export. But the user asked to use the existing logic to "construct and download the CSV entirely client-side".
      // I will implement a client-side CSV builder.

      const headers = [
        'Team ID',
        'Team Name',
        'Division',
        'Coach Name',
        'Player First Name',
        'Player Last Name',
      ];
      const rows = [];

      teamsData.forEach((team) => {
        const teamPlayers = playersData.filter((p) => p.team_id === team.id);
        const coach = Array.isArray(team.coach) ? team.coach[0] : team.coach;
        const coachName = coach ? `${coach.first_name} ${coach.last_name}` : '';

        if (teamPlayers.length === 0) {
          rows.push({
            'Team ID': team.id,
            'Team Name': team.name,
            Division: team.division || '',
            'Coach Name': coachName,
            'Player First Name': 'No Players',
            'Player Last Name': '',
          });
        } else {
          teamPlayers.forEach((p) => {
            rows.push({
              'Team ID': team.id,
              'Team Name': team.name,
              Division: team.division || '',
              'Coach Name': coachName,
              'Player First Name': p.first_name,
              'Player Last Name': p.last_name,
            });
          });
        }
      });

      const headerLine = headers.join(',');
      const dataLines = rows.map((row) =>
        headers.map((h) => `"${(row[h] || '').toString().replace(/"/g, '""')}"`).join(',')
      );
      const csv = [headerLine, ...dataLines].join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `squadlogic-rosters-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Failed to generate export.');
    } finally {
      setExporting(false);
    }
  };

  const COLORS = [
    'var(--color-primary)',
    'var(--color-status-success)',
    'var(--color-text-accent)',
    'var(--color-primary-400)',
    'var(--color-status-warning)',
  ];

  if (loading)
    return (
      <div className="text-center p-8 animate-pulse text-text-secondary">
        Crunching Season Data...
      </div>
    );

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fadeIn">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-text-primary">Reporting Dashboard</h1>
          <p className="text-text-secondary">High-level operational metrics and exports.</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={handleExportRosters}
            disabled={exporting}
            className="glass-button px-6 py-2.5 shadow-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={18} /> {exporting ? 'Generating CSV...' : 'Export Rosters CSV'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-status-error-bg border border-status-error/30 text-status-error rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      {/* Metric Cards Top Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-bg-surface border border-border-highlight rounded-xl p-6 shadow-xl relative overflow-hidden group bg-bg-card" data-testid="metric-card-total-players">
          <div className="absolute top-0 right-0 w-32 h-32 bg-brand-glow rounded-full blur-3xl -mr-10 -mt-10 transition-transform group-hover:scale-110" />
          <div className="flex flex-col">
            <span className="text-text-muted text-sm font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
              <Users size={16} /> Total Players
            </span>
            <span className="text-4xl font-black text-text-primary" data-testid="metric-value-total-players">{metrics.players}</span>
            <span className="text-xs text-color-primary mt-2">Active in Organization</span>
          </div>
        </div>
        <div className="bg-bg-surface border border-border-highlight rounded-xl p-6 shadow-xl relative overflow-hidden group bg-bg-card" data-testid="metric-card-active-teams">
          <div className="absolute top-0 right-0 w-32 h-32 bg-status-success-bg rounded-full blur-3xl -mr-10 -mt-10 transition-transform group-hover:scale-110" />
          <div className="flex flex-col">
            <span className="text-text-muted text-sm font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
              <ShieldCheck size={16} /> Active Teams
            </span>
            <span className="text-4xl font-black text-text-primary" data-testid="metric-value-active-teams">{metrics.teams}</span>
            <span className="text-xs text-status-success mt-2">Current Season</span>
          </div>
        </div>
        <div className="bg-bg-surface border border-border-highlight rounded-xl p-6 shadow-xl relative overflow-hidden group bg-bg-card" data-testid="metric-card-staff-admins">
          <div className="absolute top-0 right-0 w-32 h-32 bg-brand-glow rounded-full blur-3xl -mr-10 -mt-10 transition-transform group-hover:scale-110" />
          <div className="flex flex-col">
            <span className="text-text-muted text-sm font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
              <Activity size={16} /> Staff & Admins
            </span>
            <span className="text-4xl font-black text-text-primary">{metrics.users}</span>
            <span className="text-xs text-text-accent mt-2">Registered Profiles</span>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Compliance Chart */}
        <div className="bg-bg-surface border border-border-subtle rounded-xl p-6 shadow-xl">
          <h3 className="text-lg font-bold text-text-primary mb-6">Form Compliance Status</h3>
          <div className="h-64">
            {compliance.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={compliance} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" vertical={false} />
                  <XAxis dataKey="form_title" stroke="var(--color-text-muted)" tick={{ fill: 'var(--color-text-muted)' }} />
                  <YAxis stroke="var(--color-text-muted)" tick={{ fill: 'var(--color-text-muted)' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-bg-app)',
                      borderColor: 'var(--color-border-subtle)',
                      borderRadius: '8px',
                    }}
                    itemStyle={{ color: 'var(--color-text-primary)' }}
                  />
                  <Bar
                    dataKey="total_registrations"
                    name="Total Submissions"
                    fill="var(--color-primary)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="medical_cleared"
                    name="Medical Cleared"
                    fill="var(--color-status-success)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-text-muted">
                No Compliance Data
              </div>
            )}
          </div>
        </div>

        {/* Teams by Division / Facility Pie */}
        <div className="bg-bg-surface border border-border-subtle rounded-xl p-6 shadow-xl">
          <h3 className="text-lg font-bold text-text-primary mb-6">Teams by Division</h3>
          <div className="h-64">
            {standings.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={standings}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {standings.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-bg-app)',
                      borderColor: 'var(--color-border-subtle)',
                      borderRadius: '8px',
                    }}
                    itemStyle={{ color: 'var(--color-text-primary)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-text-muted">
                No Division Data
              </div>
            )}
          </div>
        </div>

        {/* Facility Usage Full Width */}
        <div className="bg-bg-surface border border-border-subtle rounded-xl p-6 shadow-xl lg:col-span-2">
          <h3 className="text-lg font-bold text-text-primary mb-6 flex items-center gap-2">
            <MapPin size={18} /> Facility Usage (Total Events)
          </h3>
          <div className="h-72">
            {facilities.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={facilities}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" horizontal={false} />
                  <XAxis type="number" stroke="var(--color-text-muted)" />
                  <YAxis
                    dataKey="field_name"
                    type="category"
                    stroke="var(--color-text-muted)"
                    tick={{ fill: 'var(--color-text-muted)' }}
                    width={100}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-bg-app)',
                      borderColor: 'var(--color-border-subtle)',
                      borderRadius: '8px',
                    }}
                  />
                  <Bar
                    dataKey="practice_count"
                    name="Practices"
                    stackId="a"
                    fill="var(--color-primary)"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="game_count"
                    name="Games"
                    stackId="a"
                    fill="var(--color-status-success)"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-text-muted">
                No Field Assignments Found
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
