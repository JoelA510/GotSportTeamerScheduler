import React, { useState, useEffect } from 'react';
import { MapPin, Plus, Edit2, Trash2, Maximize2, Columns, Clock, X, Lightbulb, Copy, Building2 } from 'lucide-react';
import { useSeason } from '../context/SeasonContext';
import { useClub, CLUB_THEMES } from '../context/ClubContext';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type TimeSlot = { start: string; end: string; clubId: string } | null;

type Field = {
  id: string;
  name: string;
  address: string;
  hasLighting: boolean;
  type: string;
  subunits: number;
  priority: string;
  status: string;
  schedule: Record<string, TimeSlot>;
};

const MOCK_FIELDS: Field[] = [
  { 
    id: 'f1', name: 'Centennial Park Field 1', address: '123 Park Ave, Cityville', hasLighting: true, type: '11v11', subunits: 2, priority: 'High', status: 'Active',
    schedule: { Mon: { start: '16:00', end: '20:00', clubId: 'c1' }, Tue: { start: '16:00', end: '20:00', clubId: 'c1' }, Wed: { start: '16:00', end: '20:00', clubId: 'c2' }, Thu: { start: '16:00', end: '20:00', clubId: 'c1' }, Fri: { start: '16:00', end: '19:00', clubId: 'c1' }, Sat: { start: '08:00', end: '18:00', clubId: 'c1' }, Sun: null }
  },
  { 
    id: 'f2', name: 'Centennial Park Field 2', address: '123 Park Ave, Cityville', hasLighting: true, type: '11v11', subunits: 2, priority: 'High', status: 'Active',
    schedule: { Mon: { start: '16:00', end: '20:00', clubId: 'c2' }, Tue: { start: '16:00', end: '20:00', clubId: 'c2' }, Wed: { start: '16:00', end: '20:00', clubId: 'c1' }, Thu: { start: '16:00', end: '20:00', clubId: 'c2' }, Fri: { start: '16:00', end: '19:00', clubId: 'c2' }, Sat: { start: '08:00', end: '18:00', clubId: 'c2' }, Sun: null }
  },
  { 
    id: 'f3', name: 'Oak Creek Elementary', address: '456 School Ln, Townsburg', hasLighting: false, type: '7v7', subunits: 1, priority: 'Medium', status: 'Active',
    schedule: { Mon: { start: '17:00', end: '19:30', clubId: 'c1' }, Tue: { start: '17:00', end: '19:30', clubId: 'c1' }, Wed: { start: '17:00', end: '19:30', clubId: 'c1' }, Thu: { start: '17:00', end: '19:30', clubId: 'c1' }, Fri: null, Sat: { start: '09:00', end: '14:00', clubId: 'c3' }, Sun: null }
  },
  { 
    id: 'f4', name: 'Community Center Turf', address: '789 Civic Blvd, Metropolis', hasLighting: true, type: '9v9', subunits: 1, priority: 'Low', status: 'Maintenance',
    schedule: { Mon: null, Tue: null, Wed: null, Thu: null, Fri: null, Sat: null, Sun: null }
  },
];

export default function FieldAllocation() {
  const { currentSeason, seasons } = useSeason();
  const { currentClub, clubs } = useClub();
  
  const [fieldsBySeason, setFieldsBySeason] = useState<Record<string, Field[]>>({
    's2026': MOCK_FIELDS,
    'f2025': [MOCK_FIELDS[0], MOCK_FIELDS[2]],
    's2025': [MOCK_FIELDS[1]],
    'f2024': [],
  });

  const fields = fieldsBySeason[currentSeason.id] || [];
  
  const setFields = (newFields: Field[]) => {
    setFieldsBySeason(prev => ({
      ...prev,
      [currentSeason.id]: newFields
    }));
  };

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);
  const [editingField, setEditingField] = useState<Field | null>(null);
  const [sourceSeasonId, setSourceSeasonId] = useState<string>('');

  const handleEdit = (field: Field) => {
    setEditingField(field);
    setIsModalOpen(true);
  };

  const handleAdd = () => {
    setEditingField({
      id: `f${Date.now()}`,
      name: '',
      address: '',
      hasLighting: false,
      type: '11v11',
      subunits: 1,
      priority: 'Medium',
      status: 'Active',
      schedule: { Mon: null, Tue: null, Wed: null, Thu: null, Fri: null, Sat: null, Sun: null }
    });
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    setFields(fields.filter(f => f.id !== id));
  };

  const handleSave = () => {
    if (!editingField) return;
    
    if (fields.some(f => f.id === editingField.id)) {
      setFields(fields.map(f => f.id === editingField.id ? editingField : f));
    } else {
      setFields([...fields, editingField]);
    }
    setIsModalOpen(false);
  };

  const handleCopyFromSeason = () => {
    if (!sourceSeasonId) return;
    const sourceFields = fieldsBySeason[sourceSeasonId] || [];
    
    // Generate new IDs for the copied fields to avoid conflicts
    const copiedFields = sourceFields.map(f => ({
      ...f,
      id: `f${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }));
    
    setFields([...fields, ...copiedFields]);
    setIsCopyModalOpen(false);
    setSourceSeasonId('');
  };

  return (
    <div className="animate-in fade-in duration-500">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white mb-2">Field Allocation</h1>
          <p className="text-slate-400">Configure field capacities, subunits, and priority levels for {currentSeason.name}.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setIsCopyModalOpen(true)} 
            className="glass-button flex items-center gap-2 bg-slate-800 hover:bg-slate-700"
          >
            <Copy size={18} />
            Copy from Season
          </button>
          <button onClick={handleAdd} className="glass-button flex items-center gap-2">
            <Plus size={18} />
            Add Field
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {fields.length === 0 ? (
            <div className="glass-panel p-12 flex flex-col items-center justify-center text-center border-dashed border-2 border-white/10">
              <MapPin size={48} className="text-slate-600 mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">No fields configured</h3>
              <p className="text-slate-400 max-w-md mb-6">
                There are no fields allocated for {currentSeason.name}. You can add a new field or copy fields from a previous season.
              </p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setIsCopyModalOpen(true)} 
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  <Copy size={18} />
                  Copy Fields
                </button>
                <button 
                  onClick={handleAdd} 
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shadow-[0_0_15px_rgba(37,99,235,0.3)] flex items-center gap-2"
                >
                  <Plus size={18} />
                  Add Field
                </button>
              </div>
            </div>
          ) : (
            fields.map(field => (
              <div key={field.id} className="glass-card p-5 group flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${field.status === 'Active' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}`}>
                    <MapPin size={24} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      {field.name}
                      {field.status !== 'Active' && (
                        <span className="text-xs font-mono bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded border border-amber-500/30 uppercase">
                          {field.status}
                        </span>
                      )}
                    </h3>
                    <div className="text-sm text-slate-400 mt-0.5 flex items-center gap-2">
                      <span>{field.address}</span>
                      {field.hasLighting && (
                        <span className="flex items-center gap-1 text-amber-300 text-xs bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                          <Lightbulb size={12} /> Lighting
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-sm text-slate-400 font-mono">
                      <span className="flex items-center gap-1"><Maximize2 size={14} /> {field.type}</span>
                      <span className="flex items-center gap-1"><Columns size={14} /> {field.subunits} Subunits</span>
                      <span className="text-blue-400">Priority: {field.priority}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => handleEdit(field)}
                    className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button 
                    onClick={() => handleDelete(field.id)}
                    className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-7 gap-2 mt-2 pt-4 border-t border-white/5">
                {DAYS.map(day => {
                  const slot = field.schedule[day];
                  const isOtherClub = slot && slot.clubId !== currentClub.id;
                  const club = clubs.find(c => c.id === slot?.clubId);
                  
                  let bgClass = 'bg-slate-800/50 border-white/5 opacity-50';
                  let textClass = 'text-slate-600';
                  
                  if (slot) {
                    if (isOtherClub) {
                      const clubTheme = club ? CLUB_THEMES[club.color] : CLUB_THEMES['blue'];
                      bgClass = `${clubTheme.bgLight} border ${clubTheme.border} opacity-70`;
                      textClass = clubTheme.text;
                    } else {
                      // Current club
                      const theme = CLUB_THEMES[currentClub.color];
                      bgClass = `${theme.bgLight} border ${theme.border} ${theme.shadow}`;
                      textClass = `${theme.text} font-bold`;
                    }
                  }

                  return (
                    <div key={day} className={`flex flex-col items-center p-2 rounded border ${bgClass}`}>
                      <span className="text-[10px] uppercase font-bold text-slate-400 mb-1">{day}</span>
                      {slot ? (
                        <>
                          <span className={`text-xs font-mono ${textClass} whitespace-nowrap`}>{slot.start}-{slot.end}</span>
                          {isOtherClub && (
                            <span className={`text-[9px] font-bold mt-0.5 flex items-center gap-1 ${textClass}`}>
                              <Building2 size={8} />
                              {club?.shortName}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs font-mono text-slate-600">OFF</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )))}
        </div>

        <div className="lg:col-span-1">
          <div className="glass-panel p-6 sticky top-8">
            <h3 className="text-lg font-bold text-white mb-4 border-b border-white/10 pb-4">Capacity Overview</h3>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-sm">Total Fields</span>
                <span className="font-mono text-white text-lg">{fields.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-sm">Total Subunits</span>
                <span className="font-mono text-white text-lg">{fields.reduce((acc, f) => acc + f.subunits, 0)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-sm">Active Capacity</span>
                <span className="font-mono text-emerald-400 text-lg">
                  {fields.filter(f => f.status === 'Active').reduce((acc, f) => acc + f.subunits, 0)}
                </span>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-white/10">
              <h4 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">Subunit Logic</h4>
              <p className="text-sm text-slate-400 leading-relaxed">
                Fields with multiple subunits (e.g., 11v11 fields split into two 7v7 fields) can host multiple teams simultaneously during practice.
              </p>
            </div>
          </div>
        </div>
      </div>

      {isModalOpen && editingField && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-white/10 flex justify-between items-center">
              <h2 className="text-xl font-bold text-white">
                {fields.some(f => f.id === editingField.id) ? 'Edit Field' : 'Add Field'}
              </h2>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Field Name</label>
                    <input 
                      type="text" 
                      value={editingField.name}
                      onChange={e => setEditingField({...editingField, name: e.target.value})}
                      className="w-full bg-slate-800 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                      placeholder="e.g. Centennial Park Field 1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Address</label>
                    <input 
                      type="text" 
                      value={editingField.address}
                      onChange={e => setEditingField({...editingField, address: e.target.value})}
                      className="w-full bg-slate-800 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                      placeholder="e.g. 123 Park Ave"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={editingField.hasLighting}
                      onChange={(e) => setEditingField({...editingField, hasLighting: e.target.checked})}
                      className="rounded border-white/20 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-900"
                    />
                    <span className="text-sm font-medium text-slate-300">Has Field Lighting</span>
                  </label>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Type</label>
                    <select 
                      value={editingField.type}
                      onChange={e => setEditingField({...editingField, type: e.target.value})}
                      className="w-full bg-slate-800 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                    >
                      <option value="11v11">11v11</option>
                      <option value="9v9">9v9</option>
                      <option value="7v7">7v7</option>
                      <option value="5v5">5v5</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Subunits</label>
                    <input 
                      type="number" 
                      min="1"
                      value={editingField.subunits}
                      onChange={e => setEditingField({...editingField, subunits: parseInt(e.target.value) || 1})}
                      className="w-full bg-slate-800 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Priority</label>
                    <select 
                      value={editingField.priority}
                      onChange={e => setEditingField({...editingField, priority: e.target.value})}
                      className="w-full bg-slate-800 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                    >
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Status</label>
                    <select 
                      value={editingField.status}
                      onChange={e => setEditingField({...editingField, status: e.target.value})}
                      className="w-full bg-slate-800 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                    >
                      <option value="Active">Active</option>
                      <option value="Maintenance">Maintenance</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-slate-400 mb-3">Schedule</h3>
                <div className="space-y-3">
                  {DAYS.map(day => {
                    const slot = editingField.schedule[day];
                    const isEnabled = slot !== null;
                    const isOtherClub = slot && slot.clubId !== currentClub.id;
                    const club = clubs.find(c => c.id === slot?.clubId);
                    
                    return (
                      <div key={day} className="flex items-center gap-4 bg-slate-800/50 p-3 rounded-lg border border-white/5">
                        <div className="w-16">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={isEnabled}
                              disabled={isOtherClub}
                              onChange={(e) => {
                                const newSchedule = { ...editingField.schedule };
                                if (e.target.checked) {
                                  newSchedule[day] = { start: '16:00', end: '20:00', clubId: currentClub.id };
                                } else {
                                  newSchedule[day] = null;
                                }
                                setEditingField({ ...editingField, schedule: newSchedule });
                              }}
                              className="rounded border-white/20 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-900 disabled:opacity-50"
                            />
                            <span className="text-sm font-bold text-white uppercase">{day}</span>
                          </label>
                        </div>
                        
                        {isOtherClub ? (
                          <div className="flex items-center gap-2 flex-1 opacity-70">
                            <div className="bg-slate-900 border border-white/10 rounded px-3 py-1.5 text-sm text-slate-400 flex items-center gap-2 w-full">
                              <Building2 size={14} />
                              Reserved by {club?.name} ({slot.start} - {slot.end})
                            </div>
                          </div>
                        ) : (
                          <div className={`flex items-center gap-2 flex-1 ${!isEnabled ? 'opacity-30 pointer-events-none' : ''}`}>
                            <input 
                              type="time" 
                              value={slot?.start || ''}
                              onChange={(e) => {
                                const newSchedule = { ...editingField.schedule };
                                if (newSchedule[day]) {
                                  newSchedule[day] = { ...newSchedule[day]!, start: e.target.value };
                                  setEditingField({ ...editingField, schedule: newSchedule });
                                }
                              }}
                              className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                            />
                            <span className="text-slate-500">to</span>
                            <input 
                              type="time" 
                              value={slot?.end || ''}
                              onChange={(e) => {
                                const newSchedule = { ...editingField.schedule };
                                if (newSchedule[day]) {
                                  newSchedule[day] = { ...newSchedule[day]!, end: e.target.value };
                                  setEditingField({ ...editingField, schedule: newSchedule });
                                }
                              }}
                              className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            
            <div className="p-6 border-t border-white/10 flex justify-end gap-3 bg-slate-800/50">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleSave}
                className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shadow-[0_0_15px_rgba(37,99,235,0.3)]"
              >
                Save Field
              </button>
            </div>
          </div>
        </div>
      )}

      {isCopyModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-white/10 flex justify-between items-center">
              <h2 className="text-xl font-bold text-white">Copy Fields</h2>
              <button 
                onClick={() => setIsCopyModalOpen(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-400">
                Select a previous season to copy its field configurations to {currentSeason.name}.
              </p>
              
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Source Season</label>
                <select 
                  value={sourceSeasonId}
                  onChange={e => setSourceSeasonId(e.target.value)}
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="" disabled>Select a season...</option>
                  {seasons.filter(s => s.id !== currentSeason.id).map(season => (
                    <option key={season.id} value={season.id}>
                      {season.name} ({fieldsBySeason[season.id]?.length || 0} fields)
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="p-6 border-t border-white/10 flex justify-end gap-3 bg-slate-800/50">
              <button 
                onClick={() => setIsCopyModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleCopyFromSeason}
                disabled={!sourceSeasonId}
                className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shadow-[0_0_15px_rgba(37,99,235,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Copy Fields
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
