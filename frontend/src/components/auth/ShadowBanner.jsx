import { useAuth } from '../../contexts/AuthContext.jsx';
import { Shield, X } from 'lucide-react';

const ShadowBanner = () => {
  const { impersonatedUser, isImpersonating, stopImpersonation } = useAuth();

  if (!isImpersonating || !impersonatedUser) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between px-6 py-2 bg-amber-500/10 border-b border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.2)]">
      <div className="flex items-center gap-3">
        <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-500 border border-amber-500/30 animate-pulse">
          <Shield className="w-4 h-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500/80 leading-tight">
            Active Shadow Session
          </span>
          <span className="text-sm font-medium text-text-secondary leading-tight">
            Viewing as{' '}
            <span className="text-amber-400 font-bold">
              {impersonatedUser.full_name || impersonatedUser.email}
            </span>
          </span>
        </div>
      </div>

      <button
        onClick={stopImpersonation}
        className="group flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500 text-black text-xs font-black transition-all hover:bg-amber-400 hover:scale-105 active:scale-95 shadow-lg shadow-amber-500/20 uppercase tracking-tighter"
      >
        <span>End Session</span>
        <X className="w-3.5 h-3.5 transition-transform group-hover:rotate-90 stroke-[3]" />
      </button>
    </div>
  );
};

export default ShadowBanner;
