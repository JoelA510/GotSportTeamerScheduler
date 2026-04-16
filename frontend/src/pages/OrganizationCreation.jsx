import React, { useState } from 'react';
import { ShieldCheck, ArrowRight, Building2, Globe, Globe2, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { logger } from '../lib/logger';

/**
 * OrganizationCreation view.
 * The entry point for users who are authenticated but do not yet belong to an organization.
 * Focuses on Phase 1 of onboarding: Identity Establishment.
 */
const OrganizationCreation = () => {
    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);

    // Validation Regex: lowercase letters, numbers, and hyphens only
    const SLUG_REGEX = /^[a-z0-9-]+$/;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        // Client-side validation
        if (!SLUG_REGEX.test(slug)) {
            setError('URL Slug is invalid. Only lowercase letters, numbers, and hyphens are allowed.');
            setLoading(false);
            return;
        }

        try {
            logger.info('Initializing new tenant:', { name, slug });
            
            // Invoke the SECURITY DEFINER RPC to establish the organization and admin membership
            const { data, error: rpcError } = await supabase.rpc('initialize_new_tenant', {
                p_name: name,
                p_slug: slug,
                p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
            });

            if (rpcError) throw rpcError;

            setSuccess(true);
            logger.info('Tenant successfully initialized:', data);

            // Trigger a hard reload to refresh the OrganizationContext and session
            setTimeout(() => {
                window.location.href = '/';
            }, 2000);

        } catch (err) {
            logger.error('Failed to initialize tenant:', err);
            setError(err.message || 'An unexpected error occurred during setup.');
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
                <div className="max-w-md w-full glass-card p-8 text-center animate-in zoom-in duration-500">
                    <div className="w-16 h-16 bg-success-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <ShieldCheck className="w-8 h-8 text-success-500" />
                    </div>
                    <h1 className="text-2xl font-bold text-text-primary mb-2">Identity Locked</h1>
                    <p className="text-text-secondary mb-6">
                        {name} has been established. Preparing your command center...
                    </p>
                    <div className="flex justify-center">
                        <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
            <div className="max-w-2xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                
                {/* Visual Context */}
                <div className="hidden md:block space-y-6">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-500/10 border border-primary-500/20 text-primary-400 text-xs font-medium">
                        <Globe2 className="w-3 h-3" />
                        Next Generation Teaming
                    </div>
                    <h1 className="text-4xl font-bold text-text-primary tracking-tight">
                        New Frontier.
                    </h1>
                    <p className="text-text-secondary text-lg leading-relaxed">
                        Initialize your organization's digital core. Our AI-driven engine will handle the teaming and scheduling while you focus on the game.
                    </p>
                    <div className="space-y-4 pt-4">
                        <div className="flex items-start gap-3">
                            <div className="w-6 h-6 rounded bg-bg-secondary border border-border-primary flex items-center justify-center text-xs text-text-primary">1</div>
                            <p className="text-sm text-text-secondary">Identify your organization</p>
                        </div>
                        <div className="flex items-start gap-3 opacity-50">
                            <div className="w-6 h-6 rounded bg-bg-secondary border border-border-primary flex items-center justify-center text-xs text-text-primary">2</div>
                            <p className="text-sm text-text-secondary">Configure season logistics</p>
                        </div>
                    </div>
                </div>

                {/* Setup Form */}
                <div className="glass-card p-8 border border-white/10">
                    <div className="mb-8">
                        <h2 className="text-xl font-bold text-text-primary mb-2">Organization Identity</h2>
                        <p className="text-sm text-text-secondary">Establish your unique presence in the network.</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-text-secondary mb-2 flex items-center gap-2">
                                <Building2 className="w-4 h-4" />
                                Organization Name
                            </label>
                            <input
                                required
                                type="text"
                                name="name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full bg-bg-primary/50 border border-border-primary rounded-lg px-4 py-3 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary-500/50 transition-all"
                                placeholder="e.g. Galaxy Strikers"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-text-secondary mb-2 flex items-center gap-2">
                                <Globe className="w-4 h-4" />
                                URL Slug
                            </label>
                            <div className="relative">
                                <input
                                    required
                                    type="text"
                                    name="slug"
                                    value={slug}
                                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                                    className="w-full bg-bg-primary/50 border border-border-primary rounded-lg px-4 py-3 pl-4 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary-500/50 transition-all"
                                    placeholder="galaxy-strikers"
                                />
                                <div className="mt-2 text-[10px] text-text-tertiary uppercase tracking-wider font-semibold">
                                    squadlogic.app/{slug || '...'}
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="p-4 bg-danger-500/10 border border-danger-500/20 rounded-lg text-sm text-danger-400 animate-in fade-in slide-in-from-top-2">
                                {error}
                            </div>
                        )}

                        <button
                            disabled={loading || !name || !slug}
                            type="submit"
                            className="w-full group relative flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg transition-all duration-300 shadow-lg shadow-primary-600/20"
                        >
                            {loading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    Establish Organization
                                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                </>
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default OrganizationCreation;
