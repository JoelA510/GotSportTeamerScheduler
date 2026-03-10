import React, { useState } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, Database, Users, MapPin, Settings } from 'lucide-react';
import Papa from 'papaparse';
import { DEFAULT_DIVISIONS } from '../lib/constants';
import { useSeason } from '../context/SeasonContext';
import { useClub, CLUB_THEMES } from '../context/ClubContext';

export default function DataImport() {
  const { currentSeason } = useSeason();
  const { currentClub } = useClub();
  const [activeTab, setActiveTab] = useState<'players' | 'coaches' | 'fields' | 'constraints'>('players');
  const [data, setData] = useState<Record<string, any[]>>({ players: [], coaches: [], fields: [] });
  const [errors, setErrors] = useState<Record<string, string[]>>({ players: [], coaches: [], fields: [] });
  const [divisions, setDivisions] = useState(DEFAULT_DIVISIONS);

  const theme = CLUB_THEMES[currentClub.color];

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>, type: 'players' | 'coaches' | 'fields') => {
    const file = event.target.files?.[0];
    if (file) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const parsedData = results.data;
          const validationErrors: string[] = [];
          
          if (type === 'players') {
            parsedData.forEach((row: any, index) => {
              if (!row.firstName && !row.first_name) validationErrors.push(`Row ${index + 1}: Missing First Name`);
              if (!row.lastName && !row.last_name) validationErrors.push(`Row ${index + 1}: Missing Last Name`);
              if (!row.dob && !row.age) validationErrors.push(`Row ${index + 1}: Missing DOB/Age`);
            });
          }

          setData(prev => ({ ...prev, [type]: parsedData }));
          setErrors(prev => ({ ...prev, [type]: validationErrors }));
        }
      });
    }
  };

  const updateDivisionRoster = (id: string, maxRoster: number) => {
    setDivisions(prev => prev.map(d => d.id === id ? { ...d, maxRoster } : d));
  };

  return (
    <div className="animate-in fade-in duration-500">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white mb-2">Data Import Pipeline</h1>
          <p className="text-slate-400">Upload GotSport CSVs for players, coaches, and fields for {currentClub.name} ({currentSeason.name}).</p>
        </div>
        <button className="glass-button flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500">
          <Database size={18} />
          Commit to Database
        </button>
      </header>

      <div className="glass-panel overflow-hidden">
        <div className="flex border-b border-white/10 bg-slate-900/50 overflow-x-auto">
          {['players', 'coaches', 'fields', 'constraints'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`flex-1 py-4 px-6 font-semibold text-sm uppercase tracking-wider transition-colors whitespace-nowrap ${
                activeTab === tab 
                  ? `${theme.text} border-b-2 ${theme.border.replace('/30', '')} ${theme.bgLight}` 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeTab === 'constraints' ? (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex items-center gap-3 mb-6">
                <Settings className="text-blue-400" size={24} />
                <div>
                  <h3 className="text-xl font-bold text-white">Roster Constraints</h3>
                  <p className="text-sm text-slate-400">Adjust maximum roster sizes before generating teams. Defaults are based on NorCal Premier rules.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {divisions.map(div => (
                  <div key={div.id} className="glass-card p-4 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-white">{div.name}</h4>
                      <p className="text-xs text-slate-400 font-mono mt-1">Format: {div.format}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-semibold text-slate-400 uppercase">Max Team Size</label>
                      <input 
                        type="number" 
                        value={div.maxRoster}
                        onChange={(e) => updateDivisionRoster(div.id, parseInt(e.target.value) || 0)}
                        className="glass-input w-20 text-center font-mono"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed border-white/10 rounded-xl bg-slate-800/30 mb-8">
                <Upload size={48} className="text-slate-500 mb-4" />
                <h3 className="text-xl font-bold text-white mb-2">Upload {activeTab} CSV</h3>
                <p className="text-slate-400 mb-6 text-center max-w-md">
                  Drag and drop your GotSport export file here, or click to browse.
                </p>
                <label className="glass-button cursor-pointer flex items-center gap-2">
                  <span>Select File</span>
                  <input 
                    type="file" 
                    accept=".csv" 
                    className="hidden" 
                    onChange={(e) => handleFileUpload(e, activeTab)}
                  />
                </label>
              </div>

              {data[activeTab].length > 0 && (
                <div className="space-y-6 animate-in slide-in-from-bottom-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-white">Validation Results</h3>
                    <div className="flex gap-4">
                      <div className="flex items-center gap-2 text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full border border-emerald-400/20">
                        <CheckCircle2 size={16} />
                        <span className="text-sm font-bold">{data[activeTab].length} Records Parsed</span>
                      </div>
                      {errors[activeTab].length > 0 && (
                        <div className="flex items-center gap-2 text-red-400 bg-red-400/10 px-3 py-1 rounded-full border border-red-400/20">
                          <AlertCircle size={16} />
                          <span className="text-sm font-bold">{errors[activeTab].length} Issues Found</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {errors[activeTab].length > 0 ? (
                    <div className="glass-card border-red-500/30 bg-red-950/20 p-4">
                      <h4 className="text-red-400 font-bold mb-3 flex items-center gap-2">
                        <AlertCircle size={18} />
                        Data Validation Errors
                      </h4>
                      <ul className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
                        {errors[activeTab].map((err, i) => (
                          <li key={i} className="text-sm text-red-300/80 font-mono bg-red-900/20 p-2 rounded border border-red-900/30">
                            {err}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="glass-card border-emerald-500/30 bg-emerald-950/20 p-6 flex flex-col items-center justify-center text-center">
                      <CheckCircle2 size={32} className="text-emerald-400 mb-3" />
                      <h4 className="text-emerald-400 font-bold text-lg mb-1">Data is clean and ready</h4>
                      <p className="text-emerald-300/70 text-sm">No validation errors found in the uploaded dataset.</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
