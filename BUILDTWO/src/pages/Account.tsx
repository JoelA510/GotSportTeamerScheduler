import React, { useState } from 'react';
import { User, Shield, Key, Bell, LogOut, CheckCircle2 } from 'lucide-react';

import { useClub, CLUB_THEMES } from '../context/ClubContext';

export default function Account() {
  const { currentClub } = useClub();
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'notifications'>('profile');

  const theme = CLUB_THEMES[currentClub.color];

  return (
    <div className="animate-in fade-in duration-500">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white mb-2">Account Management</h1>
          <p className="text-slate-400">Manage your profile, security settings, and preferences.</p>
        </div>
        <button className="glass-button-secondary flex items-center gap-2 text-red-400 hover:bg-red-500/10 hover:border-red-500/30">
          <LogOut size={18} />
          Sign Out
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-1">
          <div className="glass-panel p-2 flex flex-col gap-1">
            <button
              onClick={() => setActiveTab('profile')}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-sm font-medium ${
                activeTab === 'profile'
                  ? `${theme.bgLight} ${theme.text} border ${theme.border}`
                  : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <User size={18} />
              Profile
            </button>
            <button
              onClick={() => setActiveTab('security')}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-sm font-medium ${
                activeTab === 'security'
                  ? `${theme.bgLight} ${theme.text} border ${theme.border}`
                  : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Shield size={18} />
              Security
            </button>
            <button
              onClick={() => setActiveTab('notifications')}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-sm font-medium ${
                activeTab === 'notifications'
                  ? `${theme.bgLight} ${theme.text} border ${theme.border}`
                  : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Bell size={18} />
              Notifications
            </button>
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className="glass-panel p-6 min-h-[500px]">
            {activeTab === 'profile' && (
              <div className="space-y-6 animate-in fade-in">
                <h2 className="text-xl font-bold text-white border-b border-white/10 pb-4 mb-6">Personal Information</h2>
                
                <div className="flex items-center gap-6 mb-8">
                  <div className="w-24 h-24 rounded-full bg-slate-700 flex items-center justify-center text-3xl font-bold text-white shadow-[0_0_20px_rgba(0,0,0,0.5)] border-4 border-slate-600">
                    A
                  </div>
                  <div>
                    <button className="glass-button-secondary text-sm mb-2">Change Avatar</button>
                    <p className="text-xs text-slate-500">JPG, GIF or PNG. Max size of 800K</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">First Name</label>
                    <input type="text" className="glass-input w-full" defaultValue="Admin" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Last Name</label>
                    <input type="text" className="glass-input w-full" defaultValue="User" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Email Address</label>
                    <input type="email" className="glass-input w-full" defaultValue="admin@squadlogic.com" disabled />
                    <p className="text-xs text-slate-500 mt-1">Email cannot be changed directly. Contact support.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Role</label>
                    <input type="text" className="glass-input w-full text-emerald-400 font-bold" defaultValue="League Administrator" disabled />
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-white/10 flex justify-end">
                  <button className={`glass-button ${theme.primary} hover:opacity-90`}>Save Profile</button>
                </div>
              </div>
            )}

            {activeTab === 'security' && (
              <div className="space-y-6 animate-in fade-in">
                <h2 className="text-xl font-bold text-white border-b border-white/10 pb-4 mb-6">Security Settings</h2>
                
                <div className="space-y-6 max-w-md">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Key size={18} className="text-blue-400" />
                    Change Password
                  </h3>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Current Password</label>
                      <input type="password" className="glass-input w-full" placeholder="••••••••" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">New Password</label>
                      <input type="password" className="glass-input w-full" placeholder="••••••••" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Confirm New Password</label>
                      <input type="password" className="glass-input w-full" placeholder="••••••••" />
                    </div>
                    <button className="glass-button-secondary w-full mt-2">Update Password</button>
                  </div>
                </div>

                <div className="mt-10 pt-6 border-t border-white/10">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                    <Shield size={18} className="text-emerald-400" />
                    Two-Factor Authentication
                  </h3>
                  <div className="glass-card p-4 border-emerald-500/30 bg-emerald-950/20 flex items-start justify-between">
                    <div>
                      <h4 className="text-emerald-400 font-bold text-sm flex items-center gap-2">
                        <CheckCircle2 size={16} />
                        2FA is Enabled
                      </h4>
                      <p className="text-emerald-300/70 text-xs mt-1">Your account is protected by an authenticator app.</p>
                    </div>
                    <button className="glass-button-secondary text-xs py-1 px-3">Manage</button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="space-y-6 animate-in fade-in">
                <h2 className="text-xl font-bold text-white border-b border-white/10 pb-4 mb-6">Notification Preferences</h2>
                
                <div className="space-y-4">
                  {[
                    { title: 'System Alerts', desc: 'Critical system updates and maintenance notices.', checked: true },
                    { title: 'Import Summaries', desc: 'Receive an email summary after a data import completes.', checked: true },
                    { title: 'Schedule Generation', desc: 'Get notified when a scheduling engine finishes running.', checked: true },
                    { title: 'Coach Communications', desc: 'Bcc me on all automated emails sent to coaches.', checked: false },
                  ].map((pref, i) => (
                    <div key={i} className="glass-card p-4 flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-white text-sm">{pref.title}</h4>
                        <p className="text-xs text-slate-400 mt-1">{pref.desc}</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" defaultChecked={pref.checked} />
                        <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]"></div>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
