import React, { useState } from 'react';
import { Globe, User, Palette, Calendar } from 'lucide-react';
import BrandingModule from './modules/BrandingModule.jsx';
import SeasonModule from './modules/SeasonModule.jsx';
import AccountModule from './modules/AccountModule.jsx';
import { useTheme } from '../../contexts/ThemeContext.jsx';

export default function GeneralSettings() {
  const { leagueName, updateLeagueName } = useTheme();
  const [localLeagueName, setLocalLeagueName] = useState(leagueName);
  const [activeSubTab, setActiveSubTab] = useState('identity');

  const subTabs = [
    { id: 'identity', label: 'League Identity', icon: Globe },
    { id: 'account', label: 'Account & Security', icon: User },
    { id: 'branding', label: 'Branding & Theme', icon: Palette },
    { id: 'season', label: 'Season & Calendar', icon: Calendar },
  ];

  const renderSubContent = () => {
    switch (activeSubTab) {
      case 'identity':
        return (
          <div className="space-y-6 animate-fadeIn">
            <div>
              <label
                htmlFor="league-name"
                className="block text-sm font-medium text-text-secondary mb-2"
              >
                League Name
              </label>
              <input
                id="league-name"
                type="text"
                value={localLeagueName}
                onChange={(e) => setLocalLeagueName(e.target.value)}
                onBlur={() => updateLeagueName(localLeagueName)}
                className="w-full bg-bg-surface border border-border-subtle rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-brand-400 transition-colors"
              />
            </div>
            {/* Switch League dropdown logic could also be moved to a module if it grows */}
            <div>
              <label
                htmlFor="switch-league"
                className="block text-sm font-medium text-text-secondary mb-2"
              >
                Switch Organization
              </label>
              <select
                id="switch-league"
                className="w-full bg-bg-surface border border-border-subtle rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-brand-400 transition-colors"
              >
                <option value="current">Current Organization</option>
              </select>
            </div>
          </div>
        );
      case 'account':
        return <AccountModule />;
      case 'branding':
        return <BrandingModule />;
      case 'season':
        return <SeasonModule />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-2 px-2 scrollbar-hide">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all border ${
              activeSubTab === tab.id
                ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                : 'bg-bg-surface/50 text-text-muted border-white/5 hover:bg-bg-surface hover:text-text-primary'
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="pt-2 border-t border-white/5">{renderSubContent()}</div>
    </div>
  );
}
