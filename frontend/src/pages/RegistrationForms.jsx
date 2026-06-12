import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import { Plus, Save, Trash2, ClipboardList, AlertCircle, CheckCircle2, Pencil } from 'lucide-react';
import { logger } from '../lib/logger.js';

const STATUS_OPTIONS = ['draft', 'open', 'closed'];
const STATUS_TONE = { open: 'success', draft: 'warning', closed: 'neutral' };

// Editor-only stable keys for the custom-field list; stripped before save so
// they never persist into the form definition.
let fieldUidCounter = 0;
const withFieldUid = (field) => ({ _uid: `field-${++fieldUidCounter}`, ...field });
const stripFieldUid = ({ _uid, ...field }) => field;

export default function RegistrationForms() {
  const { currentOrganization, currentSeasonSetting } = useOrganization();
  const { user, isImpersonating } = useAuth();
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);

  const [editingForm, setEditingForm] = useState({
    id: null,
    title: '',
    description: '',
    season_id: '',
    status: 'open',
    waiver_text: '',
    fields: [],
  });

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [message, setMessage] = useState(null);

  const loadForms = useCallback(async () => {
    if (!currentOrganization?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('registration_forms')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setForms(data || []);
    } catch (err) {
      logger.error(err);
    } finally {
      setLoading(false);
    }
  }, [currentOrganization?.id]);

  useEffect(() => {
    loadForms();
  }, [loadForms]);

  const openCreate = () => {
    setEditingForm({
      id: null,
      title: '',
      description: '',
      season_id: currentSeasonSetting?.id || '',
      status: 'open',
      waiver_text: '',
      fields: [],
    });
    setMessage(null);
    setShowEditor(true);
  };

  const openEdit = (form) => {
    setEditingForm({
      id: form.id,
      title: form.title || '',
      description: form.description || '',
      season_id: form.season_id || '',
      status: form.status || 'open',
      waiver_text: form.waiver_text || '',
      fields: Array.isArray(form.fields) ? form.fields.map(withFieldUid) : [],
    });
    setMessage(null);
    setShowEditor(true);
  };

  const addField = () => {
    setEditingForm((prev) => ({
      ...prev,
      fields: [...prev.fields, withFieldUid({ label: '', type: 'text', required: false })],
    }));
  };

  const updateField = (index, updates) => {
    setEditingForm((prev) => {
      const next = [...prev.fields];
      next[index] = { ...next[index], ...updates };
      return { ...prev, fields: next };
    });
  };

  const removeField = (index) => {
    setEditingForm((prev) => ({
      ...prev,
      fields: prev.fields.filter((_, i) => i !== index),
    }));
  };

  const handleSave = async () => {
    if (!editingForm.title) {
      setMessage({ type: 'error', text: 'Title is required' });
      return;
    }
    setSaving(true);
    try {
      const auditMetadata = {
        ...(isImpersonating && {
          target_user_id: user.profile.id,
          impersonated_by: user.id,
          admin_email: user.email,
        }),
      };

      if (editingForm.id) {
        // Edit existing form
        const { error } = await supabase.rpc('admin_update_registration_form', {
          p_form_id: editingForm.id,
          p_patch: {
            title: editingForm.title,
            description: editingForm.description || null,
            season_id: editingForm.season_id || null,
            status: editingForm.status,
            waiver_text: editingForm.waiver_text || null,
            fields: editingForm.fields.map(stripFieldUid),
          },
        });
        if (error) throw error;
      } else {
        // Create new form
        const { error } = await supabase.rpc('admin_create_registration_form', {
          p_organization_id: currentOrganization.id,
          p_title: editingForm.title,
          p_description: editingForm.description || null,
          p_season_id: editingForm.season_id || null,
          p_fields: editingForm.fields.map(stripFieldUid),
          p_status: editingForm.status,
          p_waiver_text: editingForm.waiver_text || null,
          p_metadata: auditMetadata,
        });
        if (error) throw error;
      }

      setMessage({ type: 'success', text: 'Form saved successfully!' });
      setTimeout(() => {
        setShowEditor(false);
        loadForms();
        setMessage(null);
      }, 1000);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (form) => {
    if (
      !window.confirm(
        `Delete "${form.title}"? This will also permanently delete all registration submissions made through this form. This cannot be undone.`
      )
    )
      return;

    setDeleting(form.id);
    try {
      const { error } = await supabase.rpc('admin_delete_registration_form', {
        p_form_id: form.id,
      });
      if (error) throw error;
      await loadForms();
    } catch (err) {
      logger.error('Form delete failed', err);
      window.alert(err?.message || 'Could not delete form. Please try again.');
    } finally {
      setDeleting(null);
    }
  };

  // ── Editor view ────────────────────────────────────────────────────────────
  if (showEditor) {
    const isEditing = Boolean(editingForm.id);
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-display font-bold text-text-primary">
            {isEditing ? 'Edit Registration Form' : 'Create Registration Form'}
          </h1>
          <Button variant="ghost" onClick={() => setShowEditor(false)}>
            Back to List
          </Button>
        </div>

        <div className="bg-bg-surface border border-border-subtle rounded-2xl p-8 shadow-md space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="form-title"
                className="block text-sm font-medium text-text-secondary mb-1"
              >
                Form Title
              </label>
              <input
                id="form-title"
                type="text"
                value={editingForm.title}
                onChange={(e) => setEditingForm((prev) => ({ ...prev, title: e.target.value }))}
                className="w-full bg-bg-app border border-border-highlight rounded-lg p-3 text-text-primary focus:border-color-primary outline-none"
                placeholder="e.g. Fall 2026 Season Registration"
              />
            </div>
            <div>
              <label
                htmlFor="form-status"
                className="block text-sm font-medium text-text-secondary mb-1"
              >
                Status
              </label>
              <select
                id="form-status"
                value={editingForm.status}
                onChange={(e) => setEditingForm((prev) => ({ ...prev, status: e.target.value }))}
                className="w-full bg-bg-app border border-border-highlight rounded-lg p-3 text-text-primary outline-none"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="form-description"
              className="block text-sm font-medium text-text-secondary mb-1"
            >
              Description
            </label>
            <textarea
              id="form-description"
              value={editingForm.description}
              onChange={(e) => setEditingForm((prev) => ({ ...prev, description: e.target.value }))}
              className="w-full bg-bg-app border border-border-highlight rounded-lg p-3 text-text-primary focus:border-color-primary outline-none"
              rows={3}
            />
          </div>

          <div>
            <label
              htmlFor="form-waiver"
              className="block text-sm font-medium text-text-secondary mb-1"
            >
              Waiver Text
            </label>
            <textarea
              id="form-waiver"
              value={editingForm.waiver_text}
              onChange={(e) => setEditingForm((prev) => ({ ...prev, waiver_text: e.target.value }))}
              className="w-full bg-bg-app border border-border-highlight rounded-lg p-3 text-text-primary focus:border-color-primary outline-none"
              rows={4}
              placeholder="Optional waiver text shown to registrants"
            />
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-text-primary">Custom Fields</h3>
              <Button size="sm" icon={Plus} onClick={addField}>
                Add Field
              </Button>
            </div>

            {editingForm.fields.map((field, idx) => (
              <div
                key={field._uid || idx}
                className="form-field-editor bg-bg-app/50 border border-border-subtle rounded-xl p-4 flex flex-col md:flex-row gap-4 items-end"
              >
                <div className="flex-1 w-full text-left">
                  <label
                    htmlFor={`field-label-${idx}`}
                    className="block text-xs font-bold text-text-muted uppercase mb-1"
                  >
                    Label
                  </label>
                  <input
                    id={`field-label-${idx}`}
                    type="text"
                    value={field.label}
                    onChange={(e) => updateField(idx, { label: e.target.value })}
                    className="w-full bg-bg-surface border border-border-highlight rounded-lg p-2 text-sm text-text-primary outline-none"
                  />
                </div>
                <div className="w-full md:w-32 text-left">
                  <label
                    htmlFor={`field-type-${idx}`}
                    className="block text-xs font-bold text-text-muted uppercase mb-1"
                  >
                    Type
                  </label>
                  <select
                    id={`field-type-${idx}`}
                    value={field.type}
                    onChange={(e) => updateField(idx, { type: e.target.value })}
                    className="w-full bg-bg-surface border border-border-highlight rounded-lg p-2 text-sm text-text-primary outline-none"
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="checkbox">Checkbox</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    id={`field-req-${idx}`}
                    checked={field.required}
                    onChange={(e) => updateField(idx, { required: e.target.checked })}
                    className="rounded border-border-highlight"
                  />
                  <label htmlFor={`field-req-${idx}`} className="text-xs text-text-secondary">
                    Required
                  </label>
                </div>
                <button
                  onClick={() => removeField(idx)}
                  className="p-2 text-status-error hover:bg-status-error-bg rounded-lg transition-colors"
                  aria-label={`Remove field ${idx + 1}`}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>

          {message && (
            <div
              className={`p-4 rounded-xl flex items-center gap-3 ${message.type === 'error' ? 'bg-status-error-bg text-status-error border border-status-error/20' : 'bg-status-success-bg text-status-success border border-status-success/20'}`}
            >
              {message.type === 'error' ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
              <span className="font-medium">{message.text}</span>
            </div>
          )}

          <div className="pt-6 border-t border-border-subtle flex justify-end">
            <Button icon={Save} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Form'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-text-primary">Registration Forms</h1>
          <p className="text-text-secondary">Manage how parents register their children.</p>
        </div>
        <Button icon={Plus} onClick={openCreate}>
          Create Form
        </Button>
      </div>

      <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-md">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-app border-b border-border-subtle text-text-muted uppercase tracking-wider text-xs font-bold">
            <tr>
              <th className="px-6 py-4">Title</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Fields</th>
              <th className="px-6 py-4">Created</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle text-text-primary">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-text-muted animate-pulse">
                  Loading forms...
                </td>
              </tr>
            ) : forms.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-text-secondary">
                  <ClipboardList size={48} className="mx-auto mb-4 text-border-highlight" />
                  <p>No registration forms yet. Create your first one!</p>
                </td>
              </tr>
            ) : (
              forms.map((form) => (
                <tr key={form.id} className="hover:bg-bg-app/50 transition-colors">
                  <td className="px-6 py-4 font-medium">{form.title}</td>
                  <td className="px-6 py-4">
                    <Badge tone={STATUS_TONE[form.status] || 'neutral'}>{form.status}</Badge>
                  </td>
                  <td className="px-6 py-4">{form.fields?.length || 0} fields</td>
                  <td className="px-6 py-4 text-text-muted">
                    {new Date(form.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Pencil}
                        onClick={() => openEdit(form)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost-danger"
                        size="sm"
                        icon={Trash2}
                        disabled={deleting === form.id}
                        onClick={() => handleDelete(form)}
                      >
                        {deleting === form.id ? 'Deleting…' : 'Delete'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
