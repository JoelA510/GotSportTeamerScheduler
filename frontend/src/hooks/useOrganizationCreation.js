import { useState } from 'react';
import { z } from 'zod';
import { supabase } from '../lib/supabaseClient.js';

const organizationSchema = z.object({
  name: z.string().trim().min(1, 'Organization name is required'),
  slug: z
    .string()
    .trim()
    .min(1, 'Slug is required')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase letters, numbers, and hyphens'),
  timezone: z.string().trim().min(1, 'Timezone is required'),
  seasonYear: z.coerce.number().int().min(2000).max(3000),
});

export function useOrganizationCreation() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const [newOrgId, setNewOrgId] = useState(null);

  const createOrganization = async ({ name, slug, timezone, seasonYear }) => {
    setLoading(true);
    setError(null);
    setFieldErrors(/** @type {Record<string, string>} */ ({}));
    setNewOrgId(null);
    const parsed = organizationSchema.safeParse({ name, slug, timezone, seasonYear });
    if (!parsed.success) {
      const nextErrors = /** @type {Record<string, string>} */ ({});
      for (const issue of parsed.error.issues) nextErrors[String(issue.path[0])] = issue.message;
      setFieldErrors(nextErrors);
      setLoading(false);
      return { data: null, error: nextErrors };
    }

    const payload = {
      p_name: parsed.data.name,
      p_slug: parsed.data.slug,
      p_timezone: parsed.data.timezone,
      p_season_year: parsed.data.seasonYear,
    };
    const { data, error: rpcError } = await supabase.rpc('initialize_new_tenant', payload);
    if (rpcError) {
      const message = rpcError.message || 'Failed to create organization.';
      if (message.toLowerCase().includes('duplicate') || message.toLowerCase().includes('unique')) {
        setFieldErrors({ slug: 'This slug is already taken.' });
      } else {
        setError(message);
      }
      setLoading(false);
      return { data: null, error: rpcError };
    }
    setNewOrgId(data);
    setLoading(false);
    return { data, error: null };
  };

  return { createOrganization, loading, error, fieldErrors, newOrgId };
}
