import React from 'react';
import PropTypes from 'prop-types';
import { Construction } from 'lucide-react';
import Page from './Page.jsx';
import PageHeader from './PageHeader.jsx';

/**
 * Temporary stub for routes whose redesigned page lands in a later phase.
 */
export default function PagePlaceholder({ title, description }) {
  return (
    <Page header={<PageHeader title={title} subtitle={description} />}>
      <div className="empty">
        <span className="empty-ico">
          <Construction size={24} aria-hidden="true" />
        </span>
        <div>
          <div style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>
            {title} is on the way
          </div>
          <p style={{ marginTop: 4, fontSize: 13 }}>{description}</p>
        </div>
      </div>
    </Page>
  );
}

PagePlaceholder.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
};
