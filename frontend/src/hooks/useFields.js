import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../utils/supabaseClient.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';

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
          field_subunits ( id, label )
        `
        )
        .eq('organization_id', currentOrganization.id)
        .order('name');

      if (fieldError) throw fieldError;
      setFields(fieldData || []);
    } catch (err) {
      console.error('Error fetching field data:', err);
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

    const { data, error: insertError } = await supabase
      .from('locations')
      .insert([
        {
          organization_id: currentOrganization.id,
          name: locationName.trim(),
        },
      ])
      .select()
      .single();

    if (insertError) throw insertError;
    setLocations((prev) => [...prev, data]);
    return data;
  };

  const addField = async (fieldData) => {
    if (!currentOrganization?.id) throw new Error('No active organization');

    const { data, error: insertError } = await supabase
      .from('fields')
      .insert([
        {
          organization_id: currentOrganization.id,
          location_id: fieldData.location_id,
          name: fieldData.name.trim(),
          surface_type: fieldData.surface_type,
          supports_halves: fieldData.supports_halves,
          priority_rating: fieldData.priority_rating || 1,
          active: fieldData.active !== false,
        },
      ])
      .select(
        `
        *,
        field_subunits ( id, label )
      `
      )
      .single();

    if (insertError) throw insertError;
    // The trigger will create subunits, but insert might return before trigger fully commits to the select tree,
    // so we re-fetch to ensure we have the subunits in our local state.
    await fetchLocationsAndFields();
    return data;
  };

  const updateField = async (fieldId, updates) => {
    const { error: updateError } = await supabase
      .from('fields')
      .update({
        location_id: updates.location_id,
        name: updates.name?.trim(),
        surface_type: updates.surface_type,
        supports_halves: updates.supports_halves,
        priority_rating: updates.priority_rating,
        active: updates.active,
      })
      .eq('id', fieldId);

    if (updateError) throw updateError;
    await fetchLocationsAndFields();
  };

  const deleteField = async (fieldId) => {
    const { error: deleteError } = await supabase.from('fields').delete().eq('id', fieldId);

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
