import React from 'react';
import PropTypes from 'prop-types';

export default function PersistenceOverridesList({
  overrides,
  pendingCount,
  totalCount,
  onMarkReviewed,
}) {
  return (
    <article className="bg-white/5 border border-white/10 rounded-lg p-5 flex flex-col gap-2" aria-labelledby="manual-overrides-heading">
      <h3 className="text-base font-semibold text-blue-300 m-0" id="manual-overrides-heading">Manual Overrides</h3>
      <p className="text-sm text-white/50 mt-auto pt-3 border-t border-white/10">
        {pendingCount} of {totalCount} pending review.
      </p>
      {overrides.length > 0 ? (
        <ul className="list-none p-0 mt-2 grid gap-2">
          {overrides.map((override) => (
            <li
              key={override.id}
              className="p-3 rounded-md bg-white/5 flex justify-between items-center border border-white/5"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white/90 truncate">
                  {override.playerName}
                </p>
                <p className="text-xs text-white/50 truncate">
                  {override.divisionId} · {override.type}
                </p>
              </div>
              {override.status === 'pending' && (
                <button
                  type="button"
                  className="glass-button-secondary ml-4"
                  onClick={() => onMarkReviewed(override.id)}
                >
                  Mark Reviewed
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="p-8 text-center text-white/30 italic border border-dashed border-white/10 rounded-lg">
          No manual overrides found.
        </div>
      )}
    </article>
  );
}

PersistenceOverridesList.propTypes = {
  overrides: PropTypes.array.isRequired,
  pendingCount: PropTypes.number.isRequired,
  totalCount: PropTypes.number.isRequired,
  onMarkReviewed: PropTypes.func.isRequired,
};
