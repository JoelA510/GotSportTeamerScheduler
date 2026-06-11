import React from 'react';
import { Download } from 'lucide-react';
import Page from '../components/chrome/Page.jsx';
import PageHeader from '../components/chrome/PageHeader.jsx';
import OutputGenerationPanel from '../components/OutputGenerationPanel.jsx';
import { useDashboardData } from '../hooks/useDashboardData.js';
import { supabase } from '../lib/supabaseClient.js';

/**
 * Exports — roster/schedule CSV generation and coach welcome emails,
 * reusing the output-generation panel from the pipeline workflow.
 */
export default function ExportsPage() {
  const { team, practice, game } = useDashboardData();

  return (
    <Page
      header={
        <PageHeader
          title="Exports"
          subtitle="Generate roster and schedule CSVs, store them, and prepare coach welcome emails."
          icon={
            <span className="page-obj-icon" style={{ background: 'var(--accent-teal)' }}>
              <Download size={20} aria-hidden="true" />
            </span>
          }
        />
      }
    >
      <div style={{ maxWidth: 860 }}>
        <OutputGenerationPanel
          teams={team?.teams || []}
          teamSummary={team?.summary || null}
          practiceAssignments={practice?.assignments || []}
          gameAssignments={game?.assignments || []}
          supabaseClient={supabase}
        />
      </div>
    </Page>
  );
}
