import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTeamPortal } from '../hooks/useTeamPortal.js';
import Button from '../components/ui/Button.jsx';
import { API_BASE_URL } from '../config.js';
import {
  MessageSquare,
  Calendar,
  Users,
  Send,
  CheckCircle2,
  XCircle,
  HelpCircle,
  MapPin,
  Clock,
  CalendarPlus,
  Copy,
} from 'lucide-react';

export default function TeamPortalPage() {
  const { teamId } = useParams();
  const {
    team,
    players,
    events,
    rsvps,
    messages,
    loading,
    error,
    updateRsvp,
    sendMessage,
    userId,
  } = useTeamPortal(teamId);
  const [chatInput, setChatInput] = useState('');
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [copied, setCopied] = useState(false);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full min-h-screen">
        <div className="text-text-secondary animate-pulse text-lg">Loading team portal...</div>
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="flex justify-center items-center h-full min-h-screen">
        <div className="text-red-400 bg-red-900/20 p-4 rounded-xl border border-red-900/40">
          {error || 'Team not found or access denied.'}
        </div>
      </div>
    );
  }

  const myChildren = players.filter((p) => p.isMyChild);

  // Rsvp Status helper
  const getRsvpStatus = (playerId, referenceId, date) => {
    const record = rsvps.find(
      (r) =>
        r.player_id === playerId && r.reference_id === referenceId && r.occurrence_date === date
    );
    return record?.status || null;
  };

  const handleSend = (e) => {
    e.preventDefault();
    sendMessage(chatInput);
    setChatInput('');
  };

  return (
    <div className="animate-fadeIn max-w-7xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div className="bg-bg-surface border border-border-subtle rounded-xl p-6 lg:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl lg:text-4xl font-display font-bold text-text-primary mb-2">
            {team.name}
          </h1>
          <p className="text-text-secondary">
            Team Portal &bull; Coach {team.coaches?.first_name} {team.coaches?.last_name}
          </p>
        </div>
        {team.calendar_token && (
          <Button variant="secondary" onClick={() => setShowCalendarModal(true)}>
            <CalendarPlus size={18} className="mr-2" /> Subscribe to Calendar
          </Button>
        )}
      </div>

      {showCalendarModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-surface border border-border-subtle rounded-xl p-6 max-w-lg w-full">
            <h2 className="text-xl font-bold text-text-primary mb-2">Sync Team Schedule</h2>
            <p className="text-text-secondary text-sm mb-6">
              Subscribe to your personal team calendar feed. Updates will automatically sync to
              Apple Calendar, Google Calendar, or Outlook.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-text-muted uppercase mb-2">
                  Your Secure Subscription URL
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`${API_BASE_URL}/calendar-feed?token=${team.calendar_token}`}
                    className="flex-1 bg-bg-app border border-border-subtle rounded-lg px-3 py-2 text-sm font-mono text-text-primary select-all"
                  />
                  <Button
                    variant="primary"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `${API_BASE_URL}/calendar-feed?token=${team.calendar_token}`
                      );
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
                  </Button>
                </div>
              </div>
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                <p className="text-xs text-blue-400">
                  <strong>Google Calendar:</strong> Look for &quot;Add calendar&quot; {'->'}{' '}
                  &quot;From URL&quot; and paste the link above.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <Button variant="outline" onClick={() => setShowCalendarModal(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Col: Roster & Details */}
        <div className="space-y-8">
          <div className="bg-bg-surface border border-border-subtle rounded-xl p-6">
            <h2 className="text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
              <Users size={20} className="text-brand-400" /> Team Roster
            </h2>
            <ul className="space-y-2">
              {players.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between py-2 border-b border-border-subtle last:border-0"
                >
                  <span
                    className={`text-sm ${p.isMyChild ? 'font-bold text-brand-400' : 'text-text-primary'}`}
                  >
                    {p.name}
                  </span>
                  {p.isMyChild && (
                    <span className="text-xs bg-brand-500/20 text-brand-300 px-2 py-0.5 rounded-full border border-brand-500/30">
                      Your Child
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Middle Col: Schedule & RSVPs */}
        <div className="lg:col-span-1 space-y-6">
          <h2 className="text-2xl font-bold text-text-primary flex items-center gap-2 mb-4">
            <Calendar size={24} className="text-blue-400" /> Upcoming Schedule
          </h2>

          {events.length === 0 ? (
            <div className="text-text-secondary italic P-4">No upcoming events scheduled.</div>
          ) : (
            events.map((ev, idx) => (
              <div
                key={ev.id || idx}
                className="bg-bg-surface border border-border-subtle rounded-xl p-5 hover:border-border-highlight transition-colors"
              >
                {/* Event Header */}
                <div className="flex justify-between items-start mb-4 border-b border-border-subtle pb-4">
                  <div>
                    <div className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-1">
                      {ev.event_type}
                    </div>
                    <h3 className="text-lg font-bold text-text-primary">{ev.title}</h3>
                    <div className="text-sm text-text-secondary mt-1 flex items-center gap-2">
                      <Calendar size={14} /> {ev.occurrence_date}
                    </div>
                    <div className="text-sm text-text-secondary mt-1 flex items-center gap-2">
                      <Clock size={14} /> {ev.start_time} - {ev.end_time}
                    </div>
                    <div className="text-sm text-text-secondary mt-1 flex items-center gap-2">
                      <MapPin size={14} /> {ev.location}
                    </div>
                  </div>
                </div>

                {/* RSVP Section (Handles Twins Edge Case distinctly) */}
                {myChildren.length > 0 && (
                  <div className="space-y-4">
                    <div className="text-xs font-semibold text-text-muted uppercase">
                      Your Household RSVP
                    </div>
                    {myChildren.map((child) => {
                      const status = getRsvpStatus(child.id, ev.reference_id, ev.occurrence_date);
                      return (
                        <div
                          key={child.id}
                          className="flex items-center justify-between bg-bg-app p-2 rounded-lg border border-border-subtle"
                        >
                          <span className="text-sm font-medium text-text-primary pl-2">
                            {child.name}
                          </span>
                          <div className="flex gap-1">
                            <button
                              onClick={() =>
                                updateRsvp(
                                  child.id,
                                  ev.reference_id,
                                  ev.event_type,
                                  ev.occurrence_date,
                                  'attending'
                                )
                              }
                              className={`px-3 py-1 text-xs rounded-full border transition-all ${status === 'attending' ? 'bg-green-500/20 border-green-500/50 text-green-400' : 'bg-transparent border-border-highlight text-text-muted hover:text-green-400'}`}
                            >
                              <CheckCircle2 size={14} className="inline mr-1" /> Going
                            </button>
                            <button
                              onClick={() =>
                                updateRsvp(
                                  child.id,
                                  ev.reference_id,
                                  ev.event_type,
                                  ev.occurrence_date,
                                  'declined'
                                )
                              }
                              className={`px-3 py-1 text-xs rounded-full border transition-all ${status === 'declined' ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'bg-transparent border-border-highlight text-text-muted hover:text-red-400'}`}
                            >
                              <XCircle size={14} className="inline mr-1" /> No
                            </button>
                            <button
                              onClick={() =>
                                updateRsvp(
                                  child.id,
                                  ev.reference_id,
                                  ev.event_type,
                                  ev.occurrence_date,
                                  'maybe'
                                )
                              }
                              className={`px-3 py-1 text-xs rounded-full border transition-all ${status === 'maybe' ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400' : 'bg-transparent border-border-highlight text-text-muted hover:text-yellow-400'}`}
                            >
                              <HelpCircle size={14} className="inline mr-1" /> Maybe
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Right Col: Team Chat */}
        <div className="lg:col-span-1 h-[600px] flex flex-col bg-bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-border-subtle bg-bg-surface flex items-center gap-2">
            <MessageSquare size={20} className="text-brand-400" />
            <h2 className="font-bold text-text-primary">Team Chat</h2>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-bg-app/50">
            {messages.length === 0 && (
              <div className="text-center text-text-muted text-sm mt-10">
                No messages yet. Say hi!
              </div>
            )}
            {messages.map((msg) => {
              const isMe = msg.author_id === userId;
              return (
                <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`px-4 py-2 rounded-2xl max-w-[85%] ${isMe ? 'bg-brand-600 text-white rounded-tr-sm' : 'bg-bg-surface border border-border-highlight text-text-primary rounded-tl-sm'}`}
                  >
                    <p className="text-sm">{msg.content}</p>
                  </div>
                  <span className="text-[10px] text-text-muted mt-1 px-1">
                    {msg.profiles?.first_name || 'Someone'} &bull;{' '}
                    {new Date(msg.created_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              );
            })}
          </div>

          <form
            onSubmit={handleSend}
            className="p-4 bg-bg-surface border-t border-border-subtle flex gap-2"
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Message team..."
              className="flex-1 bg-bg-app border border-border-highlight rounded-full px-4 text-sm text-text-primary focus:outline-none focus:border-brand-400"
            />
            <Button
              type="submit"
              variant="primary"
              className="rounded-full w-10 h-10 p-0 flex items-center justify-center shrink-0"
              onClick={() => {}}
            >
              <Send size={16} />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
