import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, ArrowRight, Upload, Users, MapPin, Calendar, Play, Save, Building2 } from 'lucide-react';
import { useSeason } from '../context/SeasonContext';
import { useClub, CLUB_THEMES } from '../context/ClubContext';

const WorkflowStep = ({ 
  number, 
  title, 
  description, 
  icon: Icon, 
  isCompleted, 
  isActive, 
  onClick, 
  actionText,
  onAction
}: any) => {
  return (
    <div 
      className={`glass-card p-6 mb-4 transition-all duration-300 cursor-pointer border-l-4 ${
        isActive ? 'border-l-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.15)] bg-slate-800/60' : 
        isCompleted ? 'border-l-emerald-500 opacity-80' : 'border-l-slate-700 opacity-60'
      }`}
      onClick={onClick}
    >
      <div className="flex items-start gap-4">
        <div className="mt-1">
          {isCompleted ? (
            <CheckCircle2 className="text-emerald-500" size={24} />
          ) : isActive ? (
            <div className="w-6 h-6 rounded-full border-2 border-blue-500 flex items-center justify-center text-xs font-bold text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.5)]">
              {number}
            </div>
          ) : (
            <Circle className="text-slate-600" size={24} />
          )}
        </div>
        
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h3 className={`text-xl font-bold ${isActive ? 'text-white' : 'text-slate-300'}`}>
              {title}
            </h3>
            <Icon size={20} className={isActive ? 'text-blue-400' : 'text-slate-500'} />
          </div>
          
          <p className={`mt-2 text-sm ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>
            {description}
          </p>
          
          {isActive && (
            <div className="mt-6 flex justify-end">
              <button 
                onClick={(e) => { e.stopPropagation(); onAction(); }}
                className="glass-button flex items-center gap-2"
              >
                {actionText}
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { currentSeason, updateSeason } = useSeason();
  const { currentClub } = useClub();
  const [activeStep, setActiveStep] = useState(1);
  const [isEditingDates, setIsEditingDates] = useState(false);
  const [startDate, setStartDate] = useState(currentSeason.startDate);
  const [endDate, setEndDate] = useState(currentSeason.endDate);

  const theme = CLUB_THEMES[currentClub.color];

  // Update local state when season changes
  React.useEffect(() => {
    setStartDate(currentSeason.startDate);
    setEndDate(currentSeason.endDate);
  }, [currentSeason]);

  const handleSaveDates = () => {
    updateSeason(currentSeason.id, { startDate, endDate });
    setIsEditingDates(false);
  };

  const steps = [
    {
      number: 1,
      title: 'Data Import',
      description: 'Upload GotSport CSVs for players, coaches, and fields. Validate data and resolve missing information.',
      icon: Upload,
      actionText: 'Go to Import',
      path: '/import'
    },
    {
      number: 2,
      title: 'Team Generation',
      description: 'Run the algorithmic engine to draft balanced teams based on skill ratings, buddy requests, and coach anchoring.',
      icon: Users,
      actionText: 'Manage Rosters',
      path: '/rosters'
    },
    {
      number: 3,
      title: 'Field Allocation',
      description: 'Configure field capacities, subunits, and priority levels for practice and game scheduling.',
      icon: MapPin,
      actionText: 'Configure Fields',
      path: '/fields'
    },
    {
      number: 4,
      title: 'Practice Scheduling',
      description: 'Automatically assign weekly practice slots to teams based on coach availability and field capacity.',
      icon: Calendar,
      actionText: 'Schedule Practices',
      path: '/practice'
    },
    {
      number: 5,
      title: 'Game Scheduling',
      description: 'Generate a full-season round-robin game schedule, resolving coach conflicts and allocating field slots.',
      icon: Play,
      actionText: 'Generate Games',
      path: '/games'
    }
  ];

  return (
    <div className="animate-in fade-in duration-500">
      <header className="mb-8">
        <h1 className="text-3xl font-black tracking-tight text-white mb-2">Season Setup Workflow</h1>
        <p className="text-slate-400">Follow these steps to configure and generate your league schedule.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="glass-panel p-6">
            {steps.map((step, index) => (
              <WorkflowStep
                key={step.number}
                number={step.number}
                title={step.title}
                description={step.description}
                icon={step.icon}
                isActive={activeStep === step.number}
                isCompleted={activeStep > step.number}
                onClick={() => setActiveStep(step.number)}
                actionText={step.actionText}
                onAction={() => navigate(step.path)}
              />
            ))}
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="glass-panel p-6 sticky top-8">
            <h3 className="text-lg font-bold text-white mb-4 border-b border-white/10 pb-4">League Status</h3>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-sm flex items-center gap-1"><Building2 size={14} /> Active Club</span>
                <span className={`font-semibold text-white ${theme.bgLight} px-2 py-1 rounded text-xs border ${theme.border}`}>{currentClub.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-sm">Active Season</span>
                <span className="font-semibold text-white bg-blue-500/20 px-2 py-1 rounded text-xs border border-blue-500/30">{currentSeason.name}</span>
              </div>
              
              <div className="bg-slate-800/50 p-3 rounded-lg border border-white/5 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 text-sm font-semibold">Season Dates</span>
                  {!isEditingDates ? (
                    <button 
                      onClick={() => setIsEditingDates(true)}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      Edit
                    </button>
                  ) : (
                    <button 
                      onClick={handleSaveDates}
                      className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                    >
                      <Save size={12} /> Save
                    </button>
                  )}
                </div>
                
                {isEditingDates ? (
                  <div className="space-y-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase text-slate-500 font-bold">Start Date</label>
                      <input 
                        type="date" 
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase text-slate-500 font-bold">End Date</label>
                      <input 
                        type="date" 
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-white font-mono">
                    <span>{currentSeason.startDate}</span>
                    <span className="text-slate-500">to</span>
                    <span>{currentSeason.endDate}</span>
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-sm">Total Players</span>
                <span className="font-mono text-white">420</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-sm">Total Teams</span>
                <span className="font-mono text-white">36</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-sm">Readiness Score</span>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 w-[45%] shadow-[0_0_10px_rgba(245,158,11,0.5)]"></div>
                  </div>
                  <span className="font-mono text-amber-400 text-sm">45%</span>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-white/10">
              <h4 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">Recent Activity</h4>
              <div className="space-y-3">
                <div className="flex gap-3 items-start">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shadow-[0_0_5px_rgba(16,185,129,0.5)]"></div>
                  <div>
                    <p className="text-sm text-slate-300">Imported 420 players</p>
                    <p className="text-xs text-slate-500">2 hours ago</p>
                  </div>
                </div>
                <div className="flex gap-3 items-start">
                  <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shadow-[0_0_5px_rgba(59,130,246,0.5)]"></div>
                  <div>
                    <p className="text-sm text-slate-300">Created U10 Boys Division</p>
                    <p className="text-xs text-slate-500">Yesterday</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
