import React, { useState } from 'react';
import { User } from 'lucide-react';
import Button from '../../ui/Button.jsx';
import { useAuth } from '../../../contexts/AuthContext.jsx';

export default function AccountModule() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="p-4 bg-bg-surface rounded-lg border border-border-subtle flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400">
          <User size={24} />
        </div>
        <div>
          <h3 className="text-text-primary font-medium">Logged in as</h3>
          <p className="text-text-muted text-sm">{user?.email || 'user@example.com'}</p>
        </div>
      </div>

      <div className="border-t border-white/10 pt-6">
        <h3 className="text-lg font-medium text-text-primary mb-4">Change Password</h3>
        <div className="space-y-4">
          <div>
            <label
              htmlFor="current-password"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              Current Password
            </label>
            <input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full bg-bg-surface border border-border-subtle rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-brand-400 transition-colors"
            />
          </div>
          <div>
            <label
              htmlFor="new-password"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              New Password
            </label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-bg-surface border border-border-subtle rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-brand-400 transition-colors"
            />
          </div>
          <div>
            <label
              htmlFor="confirm-password"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              Confirm New Password
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-bg-surface border border-border-subtle rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-brand-400 transition-colors"
            />
          </div>
          <Button variant="secondary" size="sm">
            Update Password
          </Button>
        </div>
      </div>
    </div>
  );
}
