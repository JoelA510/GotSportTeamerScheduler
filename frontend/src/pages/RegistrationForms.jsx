import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import Button from '../components/ui/Button.jsx';
import { Plus, Save, Trash2, ClipboardList, AlertCircle, CheckCircle2 } from 'lucide-react';
import { logger } from '../lib/logger.js';

export default function RegistrationForms() {
  const { currentOrganization, currentSeasonSetting } = useOrganization();
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  
  // Editor State
  const [editingForm, setEditingForm] = useState({
    title: '',
    description: '',
    season_id: '',
    fields: []
  });

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    loadForms();
  }, [currentOrganization?.id]);

  async function loadForms() {
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
  }

  const handleCreateNew = () => {
    setEditingForm({
      title: '',
      description: '',
      season_id: currentSeasonSetting?.id || '',
      fields: []
    });
    setShowEditor(true);
  };

  const addField = () => {
    setEditingForm({
      ...editingForm,
      fields: [...editingForm.fields, { label: '', type: 'text', required: false }]
    });
  };

  const updateField = (index, updates) => {
    const newFields = [...editingForm.fields];
    newFields[index] = { ...newFields[index], ...updates };
    setEditingForm({ ...editingForm, fields: newFields });
  };

  const removeField = (index) => {
    setEditingForm({
      ...editingForm,
      fields: editingForm.fields.filter((_, i) => i !== index)
    });
  };

  const handleSave = async () => {
    if (!editingForm.title) {
      setMessage({ type: 'error', text: 'Title is required' });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('registration_forms')
        .insert([{
          ...editingForm,
          organization_id: currentOrganization.id,
          status: 'active'
        }]);
      if (error) throw error;
      
      setMessage({ type: 'success', text: 'Form saved successfully!' });
      setTimeout(() => {
        setShowEditor(false);
        loadForms();
        setMessage(null);
      }, 1500);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (showEditor) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-display font-bold text-text-primary">Create Registration Form</h1>
          <Button variant="ghost" onClick={() => setShowEditor(false)}>Back to List</Button>
        </div>

        <div className="bg-bg-surface border border-border-subtle rounded-2xl p-8 shadow-xl space-y-6">
          <div className="space-y-4">
            <div>
              <label htmlFor="form-title" className="block text-sm font-medium text-text-secondary mb-1">Form Title</label>
              <input 
                id="form-title"
                type="text" 
                value={editingForm.title}
                onChange={(e) => setEditingForm({...editingForm, title: e.target.value})}
                className="w-full bg-bg-app border border-border-highlight rounded-lg p-3 text-text-primary focus:border-color-primary outline-none"
                placeholder="e.g. Fall 2026 Season Registration"
              />
            </div>
            <div>
              <label htmlFor="form-description" className="block text-sm font-medium text-text-secondary mb-1">Description</label>
              <textarea 
                id="form-description"
                value={editingForm.description}
                onChange={(e) => setEditingForm({...editingForm, description: e.target.value})}
                className="w-full bg-bg-app border border-border-highlight rounded-lg p-3 text-text-primary focus:border-color-primary outline-none"
                rows={3}
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-text-primary">Custom Fields</h3>
              <Button size="sm" icon={Plus} onClick={addField}>Add Field</Button>
            </div>
            
            {editingForm.fields.map((field, idx) => (
              <div key={idx} className="form-field-editor bg-bg-app/50 border border-border-subtle rounded-xl p-4 flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 w-full text-left">
                  <label htmlFor={`field-label-${idx}`} className="block text-xs font-bold text-text-muted uppercase mb-1">Label</label>
                  <input 
                    id={`field-label-${idx}`}
                    type="text" 
                    value={field.label}
                    onChange={(e) => updateField(idx, { label: e.target.value })}
                    className="w-full bg-bg-surface border border-border-highlight rounded-lg p-2 text-sm text-text-primary outline-none"
                  />
                </div>
                <div className="w-full md:w-32 text-left">
                  <label htmlFor={`field-type-${idx}`} className="block text-xs font-bold text-text-muted uppercase mb-1">Type</label>
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
                    checked={field.required}
                    onChange={(e) => updateField(idx, { required: e.target.checked })}
                    className="rounded border-border-highlight"
                   />
                   <span className="text-xs text-text-secondary">Required</span>
                </div>
                <button onClick={() => removeField(idx)} className="p-2 text-status-error hover:bg-status-error-bg rounded-lg transition-colors">
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>

          {message && (
            <div className={`p-4 rounded-xl flex items-center gap-3 ${message.type === 'error' ? 'bg-status-error-bg text-status-error border border-status-error/20' : 'bg-status-success-bg text-status-success border border-status-success/20'}`}>
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

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-text-primary">Registration Forms</h1>
          <p className="text-text-secondary">Manage how parents register their children.</p>
        </div>
        <Button icon={Plus} onClick={handleCreateNew}>Create Form</Button>
      </div>

      <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-md">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-app border-b border-border-subtle text-text-muted uppercase tracking-wider text-xs font-bold">
            <tr>
              <th className="px-6 py-4">Title</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Fields</th>
              <th className="px-6 py-4">Created At</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle text-text-primary">
            {loading ? (
              <tr><td colSpan={5} className="px-6 py-12 text-center text-text-muted animate-pulse">Loading forms...</td></tr>
            ) : forms.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-text-secondary">
                  <ClipboardList size={48} className="mx-auto mb-4 text-border-highlight" />
                  <p>No registration forms yet. Create your first one!</p>
                </td>
              </tr>
            ) : (
              forms.map(form => (
                <tr key={form.id} className="hover:bg-bg-app/50 transition-colors">
                  <td className="px-6 py-4 font-medium">{form.title}</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 rounded-full bg-status-success-bg text-status-success text-xs font-bold border border-status-success/20">
                      {form.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">{form.fields?.length || 0} fields</td>
                  <td className="px-6 py-4 text-text-muted">{new Date(form.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-right">
                    <Button variant="ghost" size="sm">Manage</Button>
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
