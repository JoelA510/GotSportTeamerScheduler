import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, Calendar, MapPin, Settings, LogOut, Database, Shield, ChevronDown, Building2 } from 'lucide-react';
import { useSeason } from '../context/SeasonContext';
import { useClub, CLUB_THEMES } from '../context/ClubContext';

export default function Sidebar() {
  const navigate = useNavigate();
  const { seasons, currentSeason, setCurrentSeason } = useSeason();
  const { clubs, currentClub, setCurrentClub } = useClub();
  const [isSeasonMenuOpen, setIsSeasonMenuOpen] = React.useState(false);
  const [isClubMenuOpen, setIsClubMenuOpen] = React.useState(false);

  const theme = CLUB_THEMES[currentClub.color];

  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Data Import', path: '/import', icon: Database },
    { name: 'Team Viewer', path: '/teams', icon: Shield },
    { name: 'Roster Manager', path: '/rosters', icon: Users },
    { name: 'Field Allocation', path: '/fields', icon: MapPin },
    { name: 'Practice Schedule', path: '/practice', icon: Calendar },
    { name: 'Game Schedule', path: '/games', icon: Calendar },
    { name: 'Settings', path: '/settings', icon: Settings },
  ];

  return (
    <div className="w-64 h-screen glass-panel rounded-none border-y-0 border-l-0 flex flex-col sticky top-0">
      <div className="p-6 flex items-center gap-3 border-b border-white/10">
        <div className={`w-8 h-8 rounded-lg ${theme.primary} flex items-center justify-center font-bold text-white ${theme.iconShadow}`}>
          {currentClub.shortName}
        </div>
        <span className="font-bold text-xl tracking-tight text-white truncate">{currentClub.name}</span>
      </div>

      <div className="px-4 py-4 border-b border-white/10 relative space-y-4">
        {/* Club Selector */}
        <div className="relative">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-2 flex items-center gap-2">
            <Building2 size={12} />
            Current Club
          </div>
          <button 
            onClick={() => {
              setIsClubMenuOpen(!isClubMenuOpen);
              setIsSeasonMenuOpen(false);
            }}
            className={`w-full flex items-center justify-between bg-slate-800/50 hover:bg-slate-800 border ${isClubMenuOpen ? theme.border : 'border-white/10'} rounded-lg px-3 py-2 text-sm text-white transition-colors`}
          >
            <div className="flex items-center gap-2 truncate">
              <div className={`w-2 h-2 rounded-full ${theme.primary}`} />
              <span className="font-medium truncate">{currentClub.name}</span>
            </div>
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${isClubMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          
          {isClubMenuOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-white/10 rounded-lg shadow-xl overflow-hidden z-50">
              {clubs.map((club) => {
                const clubTheme = CLUB_THEMES[club.color];
                const isSelected = currentClub.id === club.id;
                return (
                  <button
                    key={club.id}
                    onClick={() => {
                      setCurrentClub(club);
                      setIsClubMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm transition-colors ${
                      isSelected 
                        ? `${clubTheme.bgLight} ${clubTheme.text}` 
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full ${clubTheme.primary}`} />
                    {club.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Season Selector */}
        <div className="relative">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-2 flex items-center gap-2">
            <Calendar size={12} />
            Current Season
          </div>
          <button 
            onClick={() => {
              setIsSeasonMenuOpen(!isSeasonMenuOpen);
              setIsClubMenuOpen(false);
            }}
            className="w-full flex items-center justify-between bg-slate-800/50 hover:bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white transition-colors"
          >
            <span className="font-medium truncate">{currentSeason.name}</span>
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${isSeasonMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          
          {isSeasonMenuOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-white/10 rounded-lg shadow-xl overflow-hidden z-50">
              {seasons.map((season) => (
                <button
                  key={season.id}
                  onClick={() => {
                    setCurrentSeason(season);
                    setIsSeasonMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    currentSeason.id === season.id 
                      ? `${theme.bgLight} ${theme.text}` 
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {season.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 py-6 flex flex-col gap-2 px-4 overflow-y-auto custom-scrollbar">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-2">
          League Management
        </div>
        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                isActive
                  ? `${theme.bgLight} ${theme.text} border ${theme.border} ${theme.shadow}`
                  : 'text-slate-300 hover:bg-white/5 hover:text-white border border-transparent'
              }`
            }
          >
            <item.icon size={18} />
            <span className="font-medium text-sm">{item.name}</span>
          </NavLink>
        ))}
      </div>

      <div className="p-4 border-t border-white/10">
        <div 
          onClick={() => navigate('/account')}
          className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-white/5 rounded-lg transition-colors"
        >
          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold">
            A
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-white">Admin User</span>
            <span className="text-xs text-slate-400">admin@squadlogic.com</span>
          </div>
        </div>
        <button className="mt-2 w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </div>
  );
}
