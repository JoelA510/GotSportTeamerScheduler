import React, { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import PropTypes from 'prop-types';
import { useTeamPortal } from '../hooks/useTeamPortal.js';
import { Calendar, Users, MessageSquare, Send, Check, X, Minus, MapPin, Clock } from 'lucide-react';
import LoadingScreen from '../components/LoadingScreen.jsx';

export default function TeamPortalPage() {
  const { teamId } = useParams();
  const {
    loading,
    error,
    team,
    roster,
    events,
    rsvps,
    messages,
    myPlayers,
    updateRsvp,
    sendMessage
  } = useTeamPortal(teamId);

  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (loading) return <LoadingScreen />;
  if (error) return <div className="p-8 text-status-error glass-panel">Error: {error}</div>;

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    sendMessage(chatInput);
    setChatInput('');
  };

  return (
    <div className="animate-fadeIn space-y-8">
      {/* Team Header */}
      <header className="glass-panel p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-text-primary tracking-tight">
            {team?.name || 'Loading Team...'}
          </h1>
          <p className="text-text-secondary">
            {team?.division?.name} | {team?.division?.season?.season_label} {team?.division?.season?.season_year}
          </p>
        </div>
        <div className="flex gap-4">
          <div className="bg-bg-surface px-4 py-2 rounded-lg border border-border-subtle flex items-center gap-2">
            <Users size={18} className="text-color-primary" />
            <span className="font-semibold">{roster.length} Players</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Schedule (2/3) */}
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-2xl font-display font-bold flex items-center gap-2">
            <Calendar className="text-color-primary" />
            Team Schedule
          </h2>

          <div className="space-y-4">
            {events.length === 0 ? (
              <div className="glass-panel p-8 text-center text-text-muted">
                No upcoming events scheduled.
              </div>
            ) : (
              events.map((event, idx) => (
                <div key={`${event.type}-${event.id}-${event.date}`} className="glass-panel p-5 animate-slideUp" style={{ animationDelay: `${idx * 0.05}s` }}>
                  <div className="flex flex-col md:flex-row justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          event.type === 'game' ? 'bg-status-success-bg text-status-success' : 'bg-brand-glow text-color-primary'
                        }`}>
                          {event.type}
                        </span>
                        <h3 className="font-bold text-lg">{event.description}</h3>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-y-1 gap-x-4 text-sm text-text-secondary">
                        <div className="flex items-center gap-1.5">
                          <Calendar size={14} />
                          {new Date(event.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Clock size={14} />
                          {event.startTime?.substring(0, 5)} - {event.endTime?.substring(0, 5)}
                        </div>
                        <div className="flex items-center gap-1.5 md:col-span-2">
                          <MapPin size={14} />
                          {event.location}
                        </div>
                      </div>
                    </div>

                    {/* RSVP Section - Handles "The Twins Edge Case" */}
                    <div className="flex flex-col gap-3 min-w-[200px]">
                      {myPlayers.length > 0 ? (
                        <div className="space-y-3">
                          <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Your RSVPs</p>
                          {myPlayers.map(player => {
                            const rsvp = rsvps.find(r => 
                              r.player_id === player.id && 
                              r.reference_id === event.id && 
                              r.occurrence_date === event.date
                            );
                            
                            return (
                              <div key={player.id} className="flex flex-col gap-1.5 p-2 rounded bg-bg-surface/30 border border-border-subtle">
                                <span className="text-xs font-semibold text-text-primary px-1">{player.first_name}</span>
                                <div className="flex gap-2">
                                  <RsvpButton 
                                    active={rsvp?.status === 'attending'} 
                                    type="attending" 
                                    onClick={() => updateRsvp(player.id, event.id, event.type, event.date, 'attending')} 
                                  />
                                  <RsvpButton 
                                    active={rsvp?.status === 'declined'} 
                                    type="declined" 
                                    onClick={() => updateRsvp(player.id, event.id, event.type, event.date, 'declined')} 
                                  />
                                  <RsvpButton 
                                    active={rsvp?.status === 'maybe'} 
                                    type="maybe" 
                                    onClick={() => updateRsvp(player.id, event.id, event.type, event.date, 'maybe')} 
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="h-full flex items-center justify-end">
                          <span className="text-xs text-text-muted">Viewing as Guest/Coach</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Sidebar: Chat (1/3) */}
        <div className="lg:col-span-1 flex flex-col h-[700px]">
          <h2 className="text-2xl font-display font-bold flex items-center gap-2 mb-6">
            <MessageSquare className="text-color-primary" />
            Team Chat
          </h2>

          <div className="glass-panel p-0 flex flex-col flex-grow overflow-hidden">
            {/* Messages Area */}
            <div className="flex-grow overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-text-muted text-sm italic">
                  No messages yet. Say hello!
                </div>
              ) : (
                messages.map((msg) => (
                  <div key={msg.id} className="flex flex-col gap-1">
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs font-bold text-color-primary">{msg.author?.full_name}</span>
                      <span className="text-[10px] text-text-muted">
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="bg-bg-surface p-3 rounded-lg rounded-tl-none border border-border-subtle text-sm">
                      {msg.content}
                    </div>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Area */}
            <form onSubmit={handleSendMessage} className="p-4 bg-bg-surface/50 border-t border-border-subtle flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type a message..."
                className="glass-input flex-grow text-sm"
              />
              <button type="submit" className="glass-button p-2 flex items-center justify-center">
                <Send size={18} />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function RsvpButton({ active, type, onClick }) {
  const configs = {
    attending: { icon: Check, color: 'text-status-success', bg: 'bg-status-success-bg', label: 'Going' },
    declined: { icon: X, color: 'text-status-error', bg: 'bg-status-error-bg', label: 'Not Going' },
    maybe: { icon: Minus, color: 'text-status-warning', bg: 'bg-status-warning-bg', label: 'Maybe' }
  };

  const config = configs[type];
  const Icon = config.icon;

  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center gap-1 p-2 rounded transition-all duration-200 ${
        active 
          ? `${config.bg} ${config.color} border-current shadow-glow scale-105` 
          : 'bg-bg-surface/20 text-text-muted border-transparent grayscale hover:grayscale-0 hover:bg-bg-surface/40'
      } border`}
      title={config.label}
    >
      <Icon size={16} />
      <span className="text-[9px] font-bold uppercase">{config.label}</span>
    </button>
  );
}

RsvpButton.propTypes = {
  active: PropTypes.bool.isRequired,
  type: PropTypes.oneOf(['attending', 'declined', 'maybe']).isRequired,
  onClick: PropTypes.func.isRequired
};
