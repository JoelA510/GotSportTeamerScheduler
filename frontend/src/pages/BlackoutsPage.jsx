import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarOff } from 'lucide-react';
import Page from '../components/chrome/Page.jsx';
import PageHeader from '../components/chrome/PageHeader.jsx';
import DataGrid from '../components/grid/DataGrid.jsx';
import Badge from '../components/ui/Badge.jsx';
import { useFields } from '../hooks/useFields.js';
import LoadingScreen from '../components/LoadingScreen.jsx';

/**
 * Blackout Dates — every field blackout window for the season in one
 * sortable grid, sourced from the imported field-availability profiles
 * (useFields). Windows are managed through the field availability import
 * on Fields & Venues; this page is the review surface.
 */
export default function BlackoutsPage() {
  const { availabilityProfiles, loading, error } = useFields();
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const list = [];
    (availabilityProfiles || []).forEach((profile) => {
      (profile.field_blackout_windows || []).forEach((window) => {
        list.push({
          id: window.id,
          field:
            [profile.location, profile.field_name].filter(Boolean).join(' — ') || 'Unnamed field',
          from: window.blackout_from || '—',
          until: window.blackout_until || '—',
          reason: window.reason || '',
          status: profile.record_status || 'active',
        });
      });
    });
    return list;
  }, [availabilityProfiles]);

  const columns = useMemo(
    () =>
      /** @type {any[]} */ ([
        { key: 'field', label: 'Field', width: 220 },
        { key: 'from', label: 'From', width: 120 },
        { key: 'until', label: 'Until', width: 120 },
        { key: 'reason', label: 'Reason', width: 240, placeholder: 'No reason given' },
        {
          key: 'status',
          label: 'Profile status',
          width: 120,
          render: (row) => (
            <Badge tone={row.status === 'excluded' ? 'danger' : 'neutral'}>{row.status}</Badge>
          ),
        },
      ]),
    []
  );

  if (loading) return <LoadingScreen />;

  return (
    <Page
      flush
      header={
        <PageHeader
          title="Blackout Dates"
          subtitle={
            <>
              Field-level blackout windows from availability imports — manage them on{' '}
              <Link to="/fields" className="linklike">
                Fields &amp; Venues
              </Link>
              .
            </>
          }
          icon={
            <span className="page-obj-icon" style={{ background: 'var(--accent-rose)' }}>
              <CalendarOff size={20} aria-hidden="true" />
            </span>
          }
        />
      }
    >
      {error && (
        <div className="badge danger" role="alert" style={{ margin: 12 }}>
          {error}
        </div>
      )}
      <DataGrid
        label="Blackout windows grid"
        columns={columns}
        rows={rows}
        selectable={false}
        search={search}
        setSearch={setSearch}
        searchKeys={['field', 'reason', 'from', 'until']}
        emptyText="No blackout windows on file — import field availability to populate this view"
      />
    </Page>
  );
}
