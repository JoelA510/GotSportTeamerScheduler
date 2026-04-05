import React, { useState } from 'react';
import { generateScheduleExports } from '../../../packages/core/src/outputGeneration.js';
import { uploadScheduleExport } from '../../../packages/core/src/storageSupabase.js';
import { IS_MOCK_MODE } from '../config.js';
import { logger } from '../lib/logger.js';

const MOCK_UPLOAD = IS_MOCK_MODE;

export default function OutputGenerationPanel({
  teams = [],
  practiceAssignments = [],
  gameAssignments = [],
  supabaseClient,
}) {
  const [generated, setGenerated] = useState(null);
  const [emails, setEmails] = useState(null);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  const generateEmails = () => {
    if (!teams || teams.length === 0) return;

    const drafts = teams
      .filter((t) => t.headCoach && t.coachEmail)
      .map((team) => {
        const teamPractices = practiceAssignments.filter(
          (p) => String(p.teamId) === String(team.id)
        );
        const scheduleStr =
          teamPractices.length > 0
            ? teamPractices
                .map((p) => `${p.day} at ${p.slotId.split('_').pop().slice(0, 5)} on ${p.fieldId}`)
                .join(' and ')
            : 'TBD';

        const subject = `Welcome to the season, Coach ${team.headCoach}!`;
        const body = `Hi Coach ${team.headCoach},\n\nThank you for volunteering to coach ${team.name} in the ${team.division} division this season! Your roster has been finalized.\n\nYour assigned practice schedule is:\n${scheduleStr}\n\nPlease let us know if you have any questions.\n\nBest,\nLeague Admin`;
        return {
          teamId: team.id,
          coachName: team.headCoach,
          coachEmail: team.coachEmail,
          subject,
          body,
        };
      });

    setEmails(drafts);
    setMessage(`Generated ${drafts.length} email drafts.`);
  };

  const handleGenerate = () => {
    try {
      setStatus('generating');
      setMessage('Generating CSVs...');

      setTimeout(() => {
        const exports = generateScheduleExports({
          teams,
          practiceAssignments,
          gameAssignments,
        });
        setGenerated(exports);
        setStatus('idle');
        setMessage('CSVs generated successfully.');
      }, 50);
    } catch (err) {
      logger.error('Generation error:', err);
      setStatus('error');
      setMessage(`Generation failed: ${err.message}`);
    }
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
    <div className="glass-panel p-6 rounded-xl border border-white/10 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-red-500/5 pointer-events-none" />

      <div className="relative z-10">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.5)]" />
          Output Generation
        </h2>

        <div className="flex flex-col gap-4">
          <div className="flex gap-4">
            <button
              data-testid="generate-csvs-btn"
              onClick={handleGenerate}
              disabled={status === 'generating' || status === 'uploading'}
              className="relative z-20 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition-colors"
            >
              {status === 'generating' ? 'Generating...' : 'Generate CSVs'}
            </button>

            {generated && (
              <button
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

          <div className="pt-4 border-t border-white/10 mt-4">
            <h3 className="text-lg font-bold text-white mb-4">Coach Communications</h3>
            <button
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
