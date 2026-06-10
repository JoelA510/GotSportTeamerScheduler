import React from 'react';
import PropTypes from 'prop-types';

/**
 * Full-bleed page scaffold for redesigned pages: a pinned header region and
 * a scrolling body (`.page` / `.page-body` in styles/page.css). Routes using
 * this must be listed in FULL_BLEED_ROUTES (constants/navigation.js) so
 * DashboardLayout skips the legacy scroll wrapper.
 *
 * @param {Object} props
 * @param {React.ReactNode} [props.header] - Usually a <PageHeader>.
 * @param {boolean} [props.flush] - Remove body padding (grids, boards).
 * @param {React.ReactNode} props.children
 */
export default function Page({ header, flush = false, children }) {
  return (
    <div className="page">
      {header}
      <main className={`page-body ${flush ? 'flush' : ''}`.trim()}>{children}</main>
    </div>
  );
}

Page.propTypes = {
  header: PropTypes.node,
  flush: PropTypes.bool,
  children: PropTypes.node,
};
