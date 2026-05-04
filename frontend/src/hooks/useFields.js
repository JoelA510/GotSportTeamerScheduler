import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { logger } from '../lib/logger.js';

export function useFields() {
  const [locations, setLocations] = useState([]);
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { currentOrganization } = useOrganization();

  const fetchLocationsAndFields = useCallback(async () => {
    if (!currentOrganization?.id) {
      setLocations([]);
      setFields([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // 1. Fetch Locations
      const { data: locData, error: locError } = await supabase
        .from('locations')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('name');

      if (locError) throw locError;
      setLocations(locData || []);

      // 2. Fetch Fields, joined with subunits
      const { data: fieldData, error: fieldError } = await supabase
        .from('fields')
        .select(
          `
          *,
          field_subunits ( id, label ),
          practice_slots ( id, day_of_week, start_time, end_time, capacity )
        `
        )
        .eq('organization_id', currentOrganization.id)
        .order('name');

      if (fieldError) throw fieldError;
      setFields(fieldData || []);
    } catch (err) {
      logger.error('Error fetching field data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [currentOrganization?.id]);

  useEffect(() => {
    fetchLocationsAndFields();
  }, [fetchLocationsAndFields]);

  const addLocation = async (locationName) => {
    if (!currentOrganization?.id) throw new Error('No active organization');

    const { data, error: insertError } = await supabase.rpc('admin_create_location', {
      p_organization_id: currentOrganization.id,
      p_name: locationName,
    });

    if (insertError) throw insertError;
    setLocations((prev) => [...prev, data]);
    return data;
  };

  const addField = async (fieldData) => {
    if (!currentOrganization?.id) throw new Error('No active organization');

    const { data, error: insertError } = await supabase.rpc('admin_create_field', {
      p_organization_id: currentOrganization.id,
      p_location_id: fieldData.location_id,
      p_name: fieldData.name,
      p_surface_type: fieldData.surface_type,
      p_size: fieldData.size,
      p_supports_halves: fieldData.supports_halves,
      p_priority_rating: fieldData.priority_rating || 1,
      p_active: fieldData.active !== false,
    });

    if (insertError) throw insertError;
    // The trigger will create subunits, but insert might return before trigger fully commits to the select tree,
    // so we re-fetch to ensure we have the subunits in our local state.
    await fetchLocationsAndFields();
    return data;
  };

  const updateField = async (fieldId, updates) => {
    if (!currentOrganization?.id) throw new Error('No active organization');

    const { error: updateError } = await supabase.rpc('admin_update_field', {
      p_organization_id: currentOrganization.id,
      p_field_id: fieldId,
      p_location_id: updates.location_id,
      p_name: updates.name,
      p_surface_type: updates.surface_type,
      p_size: updates.size,
      p_supports_halves: updates.supports_halves,
      p_priority_rating: updates.priority_rating,
      p_active: updates.active,
    });

    if (updateError) throw updateError;
    await fetchLocationsAndFields();
  };

  const deleteField = async (fieldId) => {
    if (!currentOrganization?.id) throw new Error('No active organization');

    const { error: deleteError } = await supabase.rpc('admin_delete_field', {
      p_organization_id: currentOrganization.id,
      p_field_id: fieldId,
    });

    if (deleteError) throw deleteError;
    setFields((prev) => prev.filter((f) => f.id !== fieldId));
  };

  return {
    locations,
    fields,
    loading,
    error,
    addLocation,
    addField,
    updateField,
    deleteField,
    refresh: fetchLocationsAndFields,
  };
}
