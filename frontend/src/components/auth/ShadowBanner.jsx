import { useAuth } from '../../contexts/AuthContext.jsx';
import { Eye } from 'lucide-react';

/**
 * Role-preview (impersonation) banner. Rendered by DashboardLayout in the
 * `.app.has-banner` grid row; styled by `.role-banner` in styles/chrome.css.
 */
const ShadowBanner = () => {
  const { impersonatedUser, isImpersonating, stopImpersonation } = useAuth();

  if (!isImpersonating || !impersonatedUser) return null;

  const name = impersonatedUser.full_name || impersonatedUser.email;
  const roleLabel = impersonatedUser.role
    ? impersonatedUser.role.charAt(0).toUpperCase() + impersonatedUser.role.slice(1)
    : 'Member';

  return (
    <div className="role-banner" role="status">
      <Eye size={15} aria-hidden="true" />
      <span>
        Previewing as{' '}
        <b>
          {name} · {roleLabel} view
        </b>{' '}
        — this is what they see and can edit.
      </span>
      <button type="button" onClick={stopImpersonation}>
        Exit preview
      </button>
    </div>
  );
};

export default ShadowBanner;
