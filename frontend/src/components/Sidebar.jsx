import React, { useEffect, useRef, useState } from 'react';
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
  ClipboardCheck,
  ClipboardList,
  History,
  FlaskConical,
  UserRoundCheck,
  UserCircle,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { NavLink } from 'react-router-dom';
import { IS_MOCK_MODE } from '../config.js';

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/' },
  { id: 'import', label: 'Data Import', icon: Upload, path: '/import' },
  { id: 'teams', label: 'Team Management', icon: Users, path: '/teams' },
  { id: 'coaches', label: 'Coaches', icon: UserRoundCheck, path: '/coaches' },
  { id: 'fields', label: 'Field Management', icon: Map, path: '/fields' },
  {
    id: 'schedule-practice',
    label: 'Practice Schedule',
    icon: Calendar,
    path: '/schedule/practice',
  },
  { id: 'standings', label: 'League Standings', icon: Trophy, path: '/standings' },
  { id: 'reports', label: 'Reporting Dashboard', icon: LayoutDashboard, path: '/admin/reports' },
  {
    id: 'compliance',
    label: 'Compliance Dashboard',
    icon: ClipboardCheck,
    path: '/admin/compliance',
  },
  { id: 'forms', label: 'Registration Forms', icon: ClipboardList, path: '/admin/forms' },
  {
    id: 'analytics',
    label: 'Analytical Insights',
    icon: LayoutDashboard,
    path: '/admin/analytics',
  },
  { id: 'audit', label: 'Audit Explorer', icon: History, path: '/admin/audit-logs' },
  { id: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
];

export default function Sidebar({ isOpen, toggleSidebar }) {
  const { signOut, isAdmin, isCoach, isImpersonating, user } = useAuth();
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
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const pendingUserMenuFocusRef = useRef(null);
  const userMenuButtonRef = useRef(null);
  const userMenuRef = useRef(null);

  const displayName =
    user?.profile?.full_name ||
    [user?.profile?.first_name, user?.profile?.last_name].filter(Boolean).join(' ') ||
    user?.email ||
    'Account';
  const displayEmail = user?.email || user?.profile?.email || '';
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  const getUserMenuItems = () =>
    Array.from(userMenuRef.current?.querySelectorAll('[role="menuitem"]') ?? []).filter(
      (item) => !item.hasAttribute('disabled') && item.getAttribute('aria-disabled') !== 'true'
    );

  useEffect(() => {
    const pendingFocus = pendingUserMenuFocusRef.current;
    if (!isUserMenuOpen || !pendingFocus) return;

    pendingUserMenuFocusRef.current = null;
    const items = getUserMenuItems();
    const targetIndex = pendingFocus === 'last' ? items.length - 1 : 0;
    items[targetIndex]?.focus();
  }, [isUserMenuOpen]);

  const focusUserMenuItem = (focusTarget) => {
    const items = getUserMenuItems();
    const targetIndex = focusTarget === 'last' ? items.length - 1 : 0;
    items[targetIndex]?.focus();
  };

  const closeUserMenu = ({ restoreFocus = false } = {}) => {
    setIsUserMenuOpen(false);
    pendingUserMenuFocusRef.current = null;
    if (restoreFocus) {
      userMenuButtonRef.current?.focus();
    }
  };

  const openUserMenu = (focusTarget = null) => {
    if (focusTarget && isUserMenuOpen) {
      focusUserMenuItem(focusTarget);
      pendingUserMenuFocusRef.current = null;
    } else {
      pendingUserMenuFocusRef.current = focusTarget;
    }

    setIsUserMenuOpen(true);
    setIsOrgMenuOpen(false);
    setIsSeasonMenuOpen(false);
  };

  const handleUserMenuKeyDown = (event) => {
    const items = getUserMenuItems();

    if (event.key === 'Escape') {
      event.preventDefault();
      closeUserMenu({ restoreFocus: true });
      return;
    }

    if (items.length === 0) return;

    const activeIndex = items.indexOf(document.activeElement);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(activeIndex + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(activeIndex <= 0 ? items.length : activeIndex) - 1]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

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
                fixed md:sticky left-0 z-[100]
                w-72 bg-bg-app border-r border-border-subtle
                transform transition-transform duration-300 ease-in-out
                ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
                ${isImpersonating ? 'top-12 h-[calc(100vh-48px)]' : 'top-0 h-screen'}
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
                const allowed = ['dashboard', 'teams', 'schedule-practice', 'standings'];
                return allowed.includes(item.id);
              }
              // Parent / Player view
              return ['dashboard', 'schedule-game'].includes(item.id);
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
        <div className="p-4 border-t border-border-subtle relative">
          <button
            ref={userMenuButtonRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={isUserMenuOpen}
            aria-controls="sidebar-user-menu"
            onClick={() => {
              if (isUserMenuOpen) {
                closeUserMenu();
              } else {
                openUserMenu();
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeUserMenu();
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                openUserMenu('first');
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                openUserMenu('last');
              }
            }}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover transition-all duration-200 border border-border-subtle bg-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <span className="w-10 h-10 rounded-full bg-brand-500/20 text-brand-400 flex items-center justify-center font-bold shrink-0">
              {initials || <UserCircle size={22} aria-hidden="true" />}
            </span>
            <span className="min-w-0 text-left">
              <span className="block text-sm font-semibold truncate">{displayName}</span>
              {displayEmail && (
                <span className="block text-xs text-text-muted truncate">{displayEmail}</span>
              )}
            </span>
            <ChevronDown
              size={16}
              className={`ml-auto text-text-muted transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>

          {isUserMenuOpen && (
            <div
              id="sidebar-user-menu"
              ref={userMenuRef}
              role="menu"
              aria-label="User account menu"
              onKeyDown={handleUserMenuKeyDown}
              className="absolute bottom-full left-4 right-4 mb-2 bg-bg-surface border border-border-subtle rounded-xl shadow-xl overflow-hidden z-50"
            >
              <NavLink
                to="/account"
                role="menuitem"
                onClick={() => {
                  closeUserMenu();
                  if (window.innerWidth < 768) {
                    toggleSidebar();
                  }
                }}
                className="flex items-center gap-3 px-4 py-3 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-inset"
              >
                <UserCircle size={18} aria-hidden="true" />
                Account Settings
              </NavLink>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeUserMenu();
                  signOut();
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-text-secondary hover:text-status-error hover:bg-status-error-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-inset"
              >
                <LogOut size={18} aria-hidden="true" />
                Sign Out
              </button>
            </div>
          )}
        </div>

        {/* Mock Mode Dev Indicator */}
        {IS_MOCK_MODE && (
          <div className="absolute bottom-32 left-4 right-4">
            <a
              href="https://github.com/JoelA510/SquadLogic/blob/main/docs/operations/ENVIRONMENT.md"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold backdrop-blur-xl border transition-colors hover:border-amber-400/50"
              style={{
                color: '#fbbf24',
                background: 'rgba(251, 191, 36, 0.08)',
                borderColor: 'rgba(251, 191, 36, 0.2)',
              }}
            >
              <FlaskConical size={14} />
              <span>Mock Mode Active</span>
            </a>
          </div>
        )}
      </aside>
    </>
  );
}
