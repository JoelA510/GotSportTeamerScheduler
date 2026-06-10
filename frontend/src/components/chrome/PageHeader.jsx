import React from 'react';
import PropTypes from 'prop-types';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { ROUTE_META } from '../../constants/navigation.js';

/**
 * Standard page header: breadcrumbs (derived from ROUTE_META unless given),
 * optional object icon, title, subtitle, right-aligned actions, and an
 * optional tabs row (e.g. a <Tabs> element).
 */
export default function PageHeader({
  title = null,
  subtitle = null,
  icon = null,
  actions = null,
  tabs = null,
  crumbs = null,
}) {
  const location = useLocation();
  const meta = ROUTE_META[location.pathname];
  const resolvedCrumbs =
    crumbs || (meta?.groupLabel ? [meta.groupLabel, meta.label] : meta ? [meta.label] : null);
  const resolvedTitle = title || meta?.label || '';

  return (
    <div className="page-head">
      {resolvedCrumbs && resolvedCrumbs.length > 1 && (
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          {resolvedCrumbs.map((crumb, index) => (
            <React.Fragment key={crumb}>
              <ChevronRight size={12} aria-hidden="true" />
              {index === resolvedCrumbs.length - 1 ? <span>{crumb}</span> : <span>{crumb}</span>}
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="page-head-row">
        <div className="page-title-wrap">
          {icon}
          <div style={{ minWidth: 0 }}>
            <h1 className="page-title">{resolvedTitle}</h1>
            {subtitle && <div className="page-sub">{subtitle}</div>}
          </div>
        </div>
        {actions && <div className="page-head-actions">{actions}</div>}
      </div>
      {tabs}
    </div>
  );
}

PageHeader.propTypes = {
  title: PropTypes.node,
  subtitle: PropTypes.node,
  icon: PropTypes.node,
  actions: PropTypes.node,
  tabs: PropTypes.node,
  crumbs: PropTypes.arrayOf(PropTypes.string),
};
