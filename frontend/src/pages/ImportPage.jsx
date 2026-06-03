import React from 'react';
import ImportPanel from '../components/ImportPanel.jsx';
import { useImport } from '../contexts/ImportContext.jsx';
import { useNavigate } from 'react-router-dom';
import { logger } from '../lib/logger.js';

export default function ImportPage() {
  const { setImportedData } = useImport();
  const navigate = useNavigate();

  const handleImport = (data) => {
    logger.log('Imported data:', data);
    setImportedData(data);
    navigate('/teams');
  };

  return (
    <div className="animate-fadeIn">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-text-primary mb-2">Data Import</h1>
        <p className="text-text-muted">
          Upload player and coach data from GotSport CSVs to initialize the season.
        </p>
      </div>
      <ImportPanel onImport={handleImport} />
    </div>
  );
}
