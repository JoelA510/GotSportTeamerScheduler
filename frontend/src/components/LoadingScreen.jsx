import React from 'react';

export default function LoadingScreen({ message = 'Loading SquadLogic...' }) {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      {message}
    </div>
  );
}
