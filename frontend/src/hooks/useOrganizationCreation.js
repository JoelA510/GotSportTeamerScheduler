import { useState } from 'react';
import { z } from 'zod';
import { supabase } from '../lib/supabaseClient.js';
import { withTimeout } from '../lib/withTimeout.js';

const organizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, 'Organization name must be at least 3 characters')
    .max(100, 'Organization name must be 100 characters or fewer'),
  slug: z
    .string()
    .trim()
    .min(3, 'Slug must be at least 3 characters')
    .max(50, 'Slug must be 50 characters or fewer')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase letters, numbers, and hyphens'),
  timezone: z.string().trim().min(1, 'Timezone is required'),
  seasonYear: z.coerce
    .number()
    .int()
    .min(2020, 'Season year must be 2020 or later')
    .max(2100, 'Season year must be 2100 or earlier'),
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
    const { data, error: rpcError } = await withTimeout(
      supabase.rpc('initialize_new_tenant', payload),
      30000,
      'Create-organization request'
    );
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
