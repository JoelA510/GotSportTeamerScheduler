/**
 * Shared key for stashing a pending invite code between an unauthenticated
 * /invite/<code> visit and the post-login auto-redeem step.
 *
 * sessionStorage is deliberate (not localStorage): the value should not
 * survive a browser restart — if the user bounced without redeeming, the
 * code becomes just a URL they can revisit.
 */
export const PENDING_INVITE_STORAGE_KEY = 'squadlogic_pending_invite';

export function readPendingInvite() {
  try {
    return sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writePendingInvite(code) {
  try {
    sessionStorage.setItem(PENDING_INVITE_STORAGE_KEY, code);
  } catch {
    /* storage unavailable — noop */
  }
}

export function clearPendingInvite() {
  try {
    sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
  } catch {
    /* noop */
  }
}
