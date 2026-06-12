import React, { useState } from 'react';
import { generateScheduleExports } from '@squadlogic/core/outputGeneration.js';
import { uploadScheduleExport } from '@squadlogic/core/storageSupabase.js';
import { IS_MOCK_MODE } from '../config.js';
import { logger } from '../lib/logger.js';

const MOCK_UPLOAD = IS_MOCK_MODE;
const DAY_INDEX = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

function getAssignmentTeamId(assignment) {
  return assignment?.teamId ?? assignment?.team_id ?? assignment?.teams?.id ?? null;
}

function getAssignmentSlotId(assignment) {
  return (
    assignment?.slotId ??
    assignment?.slot_id ??
    assignment?.practiceSlotId ??
    assignment?.practice_slot_id ??
    assignment?.practiceSlots?.id ??
    assignment?.practice_slots?.id ??
    null
  );
}

function normalizeTeamForExport(team) {
  const id = team?.id ?? team?.teamId ?? team?.team_id;
  if (!id) return null;

  const division =
    team.division ??
    team.divisionName ??
    team.division_id ??
    team.divisionId ??
    team.divisions?.name ??
    '';

  return {
    id,
    name: team.name ?? team.teamName ?? id,
    division,
    coachName: team.headCoach ?? team.coachName ?? team.coach_name ?? team.coach?.name ?? '',
    coachEmail:
      team.coachEmail ?? team.coach_email ?? team.headCoachEmail ?? team.coach?.email ?? '',
    assistantCoaches: team.assistantCoaches ?? team.assistant_coaches ?? [],
  };
}

function getDateFromRange(range) {
  const match = String(range ?? '').match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? '2026-01-01';
}

function getDateForDay(baseDate, day) {
  const date = new Date(`${baseDate}T00:00:00Z`);
  const dayIndex = DAY_INDEX[String(day ?? '').toLowerCase()];
  if (Number.isNaN(date.getTime()) || dayIndex == null) {
    return baseDate;
  }

  const delta = (dayIndex - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function normalizeTime(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const [hours = '00', minutes = '00', seconds = '00'] = trimmed.split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`;
}

function normalizePracticeForExport(assignment) {
  const teamId = getAssignmentTeamId(assignment);
  const slot = assignment?.practiceSlots ?? assignment?.practice_slots ?? {};
  const startTime = normalizeTime(
    assignment?.startTime ?? assignment?.start_time ?? slot.startTime ?? slot.start_time
  );
  const endTime = normalizeTime(
    assignment?.endTime ?? assignment?.end_time ?? slot.endTime ?? slot.end_time
  );
  const range = assignment?.effectiveDateRange ?? assignment?.effective_date_range;
  const day =
    assignment?.dayOfWeek ?? assignment?.day_of_week ?? slot.dayOfWeek ?? slot.day_of_week;
  const date = getDateForDay(getDateFromRange(range), day);

  if (!teamId || (!assignment?.start && !startTime) || (!assignment?.end && !endTime)) {
    return null;
  }

  return {
    teamId,
    start: assignment.start ?? `${date}T${startTime}`,
    end: assignment.end ?? `${date}T${endTime}`,
    fieldId:
      assignment.fieldId ??
      assignment.field_id ??
      slot.fieldId ??
      slot.field_id ??
      slot.fields?.id ??
      slot.fields?.name ??
      '',
    slotId: getAssignmentSlotId(assignment) ?? '',
    notes: assignment.notes ?? '',
  };
}

function normalizeGameForExport(assignment) {
  if (!assignment?.start || !assignment?.end) return null;

  return {
    homeTeamId: assignment.homeTeamId ?? assignment.home_team_id,
    awayTeamId: assignment.awayTeamId ?? assignment.away_team_id,
    start: assignment.start,
    end: assignment.end,
    fieldId: assignment.fieldId ?? assignment.field_id ?? '',
    slotId: assignment.slotId ?? assignment.slot_id ?? '',
    notes: assignment.notes ?? '',
  };
}

function buildExportPayload({ teams, teamSummary, practiceAssignments, gameAssignments }) {
  const teamDirectory = new Map();
  const addTeam = (team) => {
    const normalized = normalizeTeamForExport(team);
    if (normalized) teamDirectory.set(normalized.id, normalized);
  };

  (Array.isArray(teams) ? teams : []).forEach(addTeam);
  (Array.isArray(teamSummary?.teams) ? teamSummary.teams : []).forEach(addTeam);
  (Array.isArray(practiceAssignments) ? practiceAssignments : []).forEach((assignment) => {
    const teamId = getAssignmentTeamId(assignment);
    if (!teamDirectory.has(teamId)) {
      addTeam({ ...assignment.teams, id: teamId });
    }
  });

  const exportTeams = Array.from(teamDirectory.values());
  const exportTeamIds = new Set(exportTeams.map((team) => String(team.id)));
  const exportPractices = (Array.isArray(practiceAssignments) ? practiceAssignments : [])
    .map(normalizePracticeForExport)
    .filter((assignment) => assignment && exportTeamIds.has(String(assignment.teamId)));
  const exportGames = (Array.isArray(gameAssignments) ? gameAssignments : [])
    .map(normalizeGameForExport)
    .filter(
      (assignment) =>
        assignment &&
        exportTeamIds.has(String(assignment.homeTeamId)) &&
        exportTeamIds.has(String(assignment.awayTeamId))
    );

  return { teams: exportTeams, practiceAssignments: exportPractices, gameAssignments: exportGames };
}

export default function OutputGenerationPanel({
  teams = [],
  teamSummary = null,
  practiceAssignments = [],
  gameAssignments = [],
  supabaseClient,
}) {
  const [generated, setGenerated] = useState(null);
  const [emails, setEmails] = useState(null);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  const generateEmails = () => {
    const sourceTeams =
      Array.isArray(teams) && teams.length > 0
        ? teams
        : Array.isArray(teamSummary?.teams)
          ? teamSummary.teams
          : [];

    const drafts = sourceTeams
      .map((team) => ({
        team,
        coachName:
          team.headCoach ||
          team.coachName ||
          team.coach_name ||
          team.coach?.name ||
          team.coach?.full_name ||
          null,
        coachEmail:
          team.coachEmail || team.coach_email || team.coach?.email || team.headCoachEmail || null,
      }))
      .filter(({ coachName, coachEmail }) => coachName && coachEmail)
      .map((team) => {
        const teamPractices = practiceAssignments.filter((p) =>
          [p.teamId, p.team_id].some((teamId) => String(teamId) === String(team.team.id))
        );
        const scheduleStr =
          teamPractices.length > 0
            ? teamPractices
                .map((p) => `${p.day} at ${p.slotId.split('_').pop().slice(0, 5)} on ${p.fieldId}`)
                .join(' and ')
            : 'TBD';

        const subject = `Welcome to the season, Coach ${team.coachName}!`;
        const body = `Hi Coach ${team.coachName},\n\nThank you for volunteering to coach ${team.team.name} in the ${team.team.division || team.team.divisionName} division this season! Your roster has been finalized.\n\nYour assigned practice schedule is:\n${scheduleStr}\n\nPlease let us know if you have any questions.\n\nBest,\nLeague Admin`;
        return {
          teamId: team.team.id,
          coachName: team.coachName,
          coachEmail: team.coachEmail,
          subject,
          body,
        };
      });

    setEmails(drafts);
    setMessage(`Generated ${drafts.length} email drafts.`);
  };

  const handleGenerate = () => {
    setStatus('generating');
    setMessage('Generating CSVs...');

    setTimeout(() => {
      try {
        const exportPayload = buildExportPayload({
          teams,
          teamSummary,
          practiceAssignments,
          gameAssignments,
        });
        const exports = generateScheduleExports({
          teams: exportPayload.teams,
          practiceAssignments: exportPayload.practiceAssignments,
          gameAssignments: exportPayload.gameAssignments,
        });
        setGenerated(exports);
        setStatus('idle');
        setMessage('CSVs generated successfully.');
      } catch (err) {
        logger.error('Generation error:', err);
        setStatus('error');
        setMessage(`Generation failed: ${err.message}`);
      }
    }, 0);
  };

  const handleUpload = async () => {
    if (!generated) return;
    if (!supabaseClient && !IS_MOCK_MODE) {
      setStatus('error');
      setMessage('Supabase client not available for upload.');
      return;
    }

    setStatus('uploading');
    setMessage('Uploading to Storage...');

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const uploads = [];

      uploads.push(
        uploadFile(supabaseClient, `master-schedule-${timestamp}.csv`, generated.master.csv)
      );

      for (const teamExport of generated.perTeam) {
        uploads.push(
          uploadFile(supabaseClient, `teams/${teamExport.teamId}-${timestamp}.csv`, teamExport.csv)
        );
      }

      await Promise.all(uploads);

      setStatus('success');
      setMessage(`Uploaded ${uploads.length} files to 'exports' bucket.`);
    } catch (err) {
      logger.error('Upload error:', err);
      setStatus('error');
      setMessage(`Upload failed: ${err.message}`);
    }
  };

  const uploadFile = async (client, path, content) => {
    if (MOCK_UPLOAD) {
      logger.log(`[Mock Upload] ${path} (${content.length} bytes)`);
      return Promise.resolve({ path });
    }
    return uploadScheduleExport({
      supabaseClient: client,
      bucket: 'exports',
      path,
      file: content,
    });
  };

  const downloadCsv = (filename, content) => {
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="glass-panel p-6 rounded-xl border border-border-subtle relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-red-500/5 pointer-events-none" />

      <div className="relative z-10">
        <h2 className="text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.5)]" />
          Output Generation
        </h2>

        <div className="flex flex-col gap-4">
          <div className="flex gap-4">
            <button
              type="button"
              data-testid="generate-csvs-btn"
              onClick={handleGenerate}
              disabled={status === 'generating' || status === 'uploading'}
              className="relative z-20 bg-bg-surface hover:bg-bg-surface-hover text-text-primary px-4 py-2 rounded-lg transition-colors"
            >
              {status === 'generating' ? 'Generating...' : 'Generate CSVs'}
            </button>

            {generated && (
              <button
                type="button"
                onClick={handleUpload}
                disabled={status === 'uploading'}
                className="relative z-20 bg-orange-500 hover:bg-orange-400 text-white px-4 py-2 rounded-lg shadow-lg shadow-orange-500/20 transition-all"
              >
                {status === 'uploading' ? 'Uploading...' : 'Upload to Storage'}
              </button>
            )}
          </div>

          {generated && (
            <div className="bg-bg-surface rounded-lg p-4 border border-border-subtle mt-2">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-medium text-text-primary">Generated Files</h3>
                <button
                  type="button"
                  onClick={() => downloadCsv('master-schedule.csv', generated.master.csv)}
                  className="relative z-20 text-xs text-blue-400 hover:text-blue-300"
                >
                  Download Master CSV
                </button>
              </div>
              <div className="text-xs text-text-muted font-mono">
                <div>Master Schedule: {generated.master.rows.length} rows</div>
                <div>Team Schedules: {generated.perTeam.length} files</div>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-border-subtle mt-4">
            <h3 className="text-lg font-bold text-text-primary mb-4">Coach Communications</h3>
            <button
              type="button"
              data-testid="generate-emails-btn"
              onClick={generateEmails}
              className="relative z-20 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 px-4 py-2 rounded-lg transition-colors mb-4"
            >
              Generate Draft Welcome Emails
            </button>

            {emails && (
              <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                {emails.length === 0 ? (
                  <p className="text-sm text-text-muted">No coaches with emails found.</p>
                ) : (
                  emails.map((email, idx) => (
                    <div
                      key={idx}
                      className="bg-bg-surface border border-border-subtle rounded-lg p-4"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="text-sm font-bold text-text-primary">
                            To: {email.coachName} &lt;{email.coachEmail}&gt;
                          </div>
                          <div className="text-sm text-text-secondary">
                            Subject: {email.subject}
                          </div>
                        </div>
                        <a
                          href={`mailto:${email.coachEmail}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`}
                          className="relative z-20 bg-blue-500/20 text-blue-400 px-3 py-1 text-xs rounded hover:bg-blue-500/30 transition-colors shrink-0"
                        >
                          Open in Mail App
                        </a>
                      </div>
                      <div className="bg-bg-app rounded p-3 text-xs text-text-secondary whitespace-pre-wrap font-mono border border-border-subtle">
                        {email.body}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="text-sm min-h-[20px]">
            {status === 'error' && <span className="text-red-400">{message}</span>}
            {status === 'success' && <span className="text-emerald-400">{message}</span>}
            {(status === 'generating' || status === 'uploading') && (
              <span className="text-orange-400 animate-pulse">{message}</span>
            )}
            {status === 'idle' && message && <span className="text-text-muted">{message}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
