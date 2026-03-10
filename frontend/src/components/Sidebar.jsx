import React, { useState } from 'react';
import {
  LayoutDashboard,
  Upload,
  Users,
  Map,
  Calendar,
  Trophy,
  LogOut,
  Settings,
  ChevronDown,
  Building2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { NavLink } from 'react-router-dom';

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/' },
  { id: 'import', label: 'Data Import', icon: Upload, path: '/import' },
  { id: 'teams', label: 'Team Management', icon: Users, path: '/teams' },
  { id: 'fields', label: 'Field Management', icon: Map, path: '/fields' },
  {
    id: 'schedule-practice',
    label: 'Practice Schedule',
    icon: Calendar,
    path: '/schedule/practice',
  },
  { id: 'schedule-game', label: 'Game Schedule', icon: Trophy, path: '/schedule/game' },
  { id: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
];

export default function Sidebar({ isOpen, toggleSidebar }) {
  const { signOut, isAdmin, isCoach } = useAuth();
  const {
    organizations,
    currentOrganization,
    availableSeasons,
    currentSeasonSetting,
    switchOrganization,
    switchSeason,
  } = useOrganization();

  const [isOrgMenuOpen, setIsOrgMenuOpen] = useState(false);
  const [isSeasonMenuOpen, setIsSeasonMenuOpen] = useState(false);

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden"
          onClick={toggleSidebar}
        />
      )}

      <aside
        className={`
                fixed md:static inset-y-0 left-0 z-[100]
                w-72 bg-bg-app border-r border-border-subtle
                transform transition-transform duration-300 ease-in-out
                ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
                flex flex-col
            `}
      >
        {/* Logo Area */}
        <div className="p-6 border-b border-border-subtle flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-600 to-brand-400 flex items-center justify-center shadow-lg shadow-brand-glow">
            <span className="text-white font-bold text-xl">S</span>
          </div>
          <div>
            <h1 className="text-xl font-display font-bold text-text-primary tracking-tight">
              SquadLogic
            </h1>
            <p className="text-xs text-brand-400 font-medium">League Management</p>
          </div>
        </div>

        {/* Context Selectors */}
        <div className="px-4 py-4 border-b border-border-subtle space-y-3">
          {/* Organization Selector */}
          <div className="relative">
            <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5 px-2 flex items-center gap-1.5">
              <Building2 size={12} />
              Active Organization
            </div>
            <button
              onClick={() => {
                setIsOrgMenuOpen(!isOrgMenuOpen);
                setIsSeasonMenuOpen(false);
              }}
              className={`w-full flex items-center justify-between bg-bg-surface hover:bg-bg-surface-hover border rounded-lg px-3 py-2 text-sm text-text-primary transition-colors ${
                isOrgMenuOpen ? 'border-brand-400/50' : 'border-border-subtle'
              }`}
            >
              <span className="font-medium truncate">
                {currentOrganization?.name || 'Select Organization'}
              </span>
              <ChevronDown
                size={16}
                className={`text-text-muted transition-transform ${isOrgMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isOrgMenuOpen && organizations.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-bg-surface border border-border-subtle rounded-lg shadow-xl overflow-hidden z-50 backdrop-blur-xl">
                {organizations.map((member) => {
                  const org = member.organizations;
                  const isSelected = currentOrganization?.id === org?.id;
                  return (
                    <button
                      key={member.organization_id}
                      onClick={() => {
                        switchOrganization(member.organization_id);
                        setIsOrgMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                        isSelected
                          ? 'bg-brand-glow text-brand-400'
                          : 'text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary'
                      }`}
                    >
                      {org?.name || member.organization_id}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Season Selector */}
          <div className="relative">
            <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5 px-2 flex items-center gap-1.5">
              <Calendar size={12} />
              Active Season
            </div>
            <button
              onClick={() => {
                setIsSeasonMenuOpen(!isSeasonMenuOpen);
                setIsOrgMenuOpen(false);
              }}
              className={`w-full flex items-center justify-between bg-bg-surface hover:bg-bg-surface-hover border rounded-lg px-3 py-2 text-sm text-text-primary transition-colors ${
                isSeasonMenuOpen ? 'border-brand-400/50' : 'border-border-subtle'
              }`}
            >
              <span className="font-medium truncate">
                {currentSeasonSetting?.name || 'No seasons'}
              </span>
              <ChevronDown
                size={16}
                className={`text-text-muted transition-transform ${isSeasonMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isSeasonMenuOpen && availableSeasons.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-bg-surface border border-border-subtle rounded-lg shadow-xl overflow-hidden z-50 backdrop-blur-xl">
                {availableSeasons.map((season) => {
                  const isSelected = currentSeasonSetting?.id === season.id;
                  return (
                    <button
                      key={season.id}
                      onClick={() => {
                        switchSeason(season);
                        setIsSeasonMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                        isSelected
                          ? 'bg-brand-glow text-brand-400'
                          : 'text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary'
                      }`}
                    >
                      {season.name || season.id}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {navItems
            .filter((item) => {
              if (isAdmin) return true;
              if (isCoach) {
                const allowed = ['dashboard', 'teams', 'schedule-practice', 'schedule-game'];
                return allowed.includes(item.id);
              }
              return ['dashboard'].includes(item.id);
            })
            .map((item) => (
              <NavLink
                key={item.id}
                to={item.path}
                onClick={() => {
                  if (window.innerWidth < 768) {
                    toggleSidebar();
                  }
                }}
                className={({ isActive }) => `
                                w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group border
                                ${
                                  isActive
                                    ? 'bg-brand-glow text-brand-400 border-brand-400/50 shadow-[0_0_20px_var(--color-primary-glow)]'
                                    : 'bg-bg-surface text-text-muted border-border-subtle hover:bg-bg-surface-hover hover:text-text-primary hover:border-border-highlight'
                                }
                            `}
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      size={20}
                      className={`transition-colors ${isActive ? 'text-brand-400' : 'text-text-muted group-hover:text-text-primary'}`}
                    />
                    <span className="font-medium">{item.label}</span>

                    {isActive && (
                      <div className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-400 shadow-[0_0_8px_var(--color-primary-glow)]" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
        </nav>

        {/* User Profile / Logout */}
        <div className="p-4 border-t border-border-subtle">
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-text-muted hover:text-status-error hover:bg-status-error-bg transition-all duration-200 group"
          >
            <LogOut size={20} className="transition-colors group-hover:text-status-error" />
            <span className="font-medium">Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}

