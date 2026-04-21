import React, { useState, useEffect } from 'react';
import {
  Rocket,
  Building,
  Globe,
  Calendar,
  Clock,
  ChevronRight,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import { logger } from '../lib/logger.js';
import Button from '../components/ui/Button.jsx';

/**
 * OrganizationCreation Page
 * Features Deep Space Glass design for a premium onboarding experience.
 */
export default function OrganizationCreation() {
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    slugEdited: false,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    seasonYear: String(new Date().getFullYear()),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Auto-generate slug from name
  useEffect(() => {
    if (formData.name && !formData.slugEdited) {
      const generatedSlug = formData.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      setFormData((prev) => ({ ...prev, slug: generatedSlug }));
    }
  }, [formData.name, formData.slugEdited]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
      ...(name === 'slug' ? { slugEdited: true } : {}),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('initialize_new_tenant', {
        p_name: formData.name,
        p_slug: formData.slug,
        p_timezone: formData.timezone,
        p_season_year: parseInt(formData.seasonYear, 10),
      });

      if (rpcError) throw rpcError;

      setSuccess(true);
      logger.info('Organization initialized successfully', { orgId: data });

      // Force reload to pick up new session/org context
      setTimeout(() => {
        window.location.href = '/?new_org=true';
      }, 1500);
    } catch (err) {
      logger.error('Failed to initialize organization', err);
      setError(err.message || 'Failed to create organization. Please try a different slug.');
    } finally {
      setLoading(false);
    }
  };

  const majorTimezones = [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'Asia/Tokyo',
    'Australia/Sydney',
    'UTC',
  ];

  if (success) {
    return (
      <div className="min-h-screen bg-bg-main flex items-center justify-center p-6 animate-fadeIn">
        <div className="max-w-md w-full glass-panel-premium p-10 text-center space-y-6">
          <div className="w-20 h-20 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center mx-auto animate-bounce">
            <CheckCircle size={48} />
          </div>
          <h2 className="text-3xl font-bold text-text-primary uppercase tracking-tight">
            Identity Locked
          </h2>
          <p className="text-text-muted">
            Your organization has been digitized. Launching admin dashboard...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-main flex items-center justify-center p-6 animate-fadeIn">
      <div className="max-w-2xl w-full glass-panel-premium overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-8 border-b border-white/5 bg-white/5 flex items-center gap-4">
          <div className="w-12 h-12 bg-brand-500/20 text-brand-400 rounded-2xl flex items-center justify-center shadow-glow-brand">
            <Rocket size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-primary tracking-tight uppercase">
              New Frontier
            </h1>
            <p className="text-text-muted text-sm">
              Initialize your organization&apos;s digital core.
            </p>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-8 space-y-8">
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400 animate-slideUp">
              <AlertCircle size={20} className="shrink-0" />
              <p className="text-xs font-medium">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Org Name */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-text-muted uppercase tracking-widest pl-1">
                <Building size={14} /> Organization Name
              </label>
              <input
                required
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="e.g. Galaxy Strikers"
                className="w-full glass-input"
              />
            </div>

            {/* URL Slug */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-text-muted uppercase tracking-widest pl-1">
                <Globe size={14} /> URL Identifier (Slug)
              </label>
              <input
                required
                name="slug"
                value={formData.slug}
                onChange={handleChange}
                placeholder="galaxy-strikers"
                className="w-full glass-input font-mono text-sm"
              />
            </div>

            {/* Timezone */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-text-muted uppercase tracking-widest pl-1">
                <Clock size={14} /> Operations Timezone
              </label>
              <select
                name="timezone"
                value={formData.timezone}
                onChange={handleChange}
                className="w-full glass-input"
              >
                {!majorTimezones.includes(formData.timezone) && (
                  <option value={formData.timezone}>{formData.timezone}</option>
                )}
                {majorTimezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            {/* Season Year */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-text-muted uppercase tracking-widest pl-1">
                <Calendar size={14} /> Launch Season Year
              </label>
              <input
                required
                type="number"
                name="seasonYear"
                min="2020"
                max="2100"
                value={formData.seasonYear}
                onChange={handleChange}
                className="w-full glass-input"
              />
            </div>
          </div>

          <div className="pt-6 border-t border-white/5 flex justify-end">
            <Button
              type="submit"
              variant="primary"
              disabled={loading}
              className="px-8 flex items-center gap-3 transition-all transform hover:scale-105"
            >
              {loading ? (
                'Initializing Core...'
              ) : (
                <>
                  Establish Organization <ChevronRight size={18} />
                </>
              )}
            </Button>
          </div>
        </form>

        <div className="px-8 py-4 bg-brand-500/5 border-t border-white/5 text-[10px] text-text-muted uppercase tracking-widest text-center italic">
          Admin session established. All fields recorded in the central audit log.
        </div>
      </div>
    </div>
  );
}
