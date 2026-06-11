import React from 'react';
import PropTypes from 'prop-types';

/**
 * Tri-state row-selection checkbox (Lightning-class `.cbx`), shared by the
 * DataGrid selection column and any roster table that offers mass-select.
 */
export default function GridCheckbox({ checked, mixed = false, onChange, label }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? 'mixed' : checked}
      aria-label={label}
      className={`cbx ${checked || mixed ? 'on' : ''}`.trim()}
      onClick={(event) => {
        event.stopPropagation();
        onChange();
      }}
    >
      {(checked || mixed) && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {mixed && !checked ? (
            <path d="M5 12h14" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
          ) : (
            <path
              d="M20 6L9 17l-5-5"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      )}
    </button>
  );
}

GridCheckbox.propTypes = {
  checked: PropTypes.bool.isRequired,
  mixed: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  label: PropTypes.string,
};
