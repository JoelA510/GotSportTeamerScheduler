[← Back to Documentation Index](../README.md)
---

# Supabase Auth — Leaked-Password Protection

> **Audit F-2-04 / advisor `auth_leaked_password_protection`**: Supabase Auth
> has a built-in toggle to reject passwords that appear in the HaveIBeenPwned
> (HIBP) breach corpus. **As of mid-2026 this feature requires the Pro plan or
> above** ([Supabase docs](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection));
> SquadLogic prod runs on the free tier, so the toggle cannot be enabled and
> the security advisor warning is **accepted** until/unless the project moves
> to Pro. Compensating controls in place on free tier: 12-character minimum
> password length (auth config + `check_password_length_on_auth_users`
> trigger) and `secure_password_change`. If the project upgrades to Pro,
> follow the procedure below — it is a one-click operator action; no code
> change is required.

## Why enable (on Pro)

- Defense-in-depth against credential stuffing on the login flow.
- Many password-reuse attacks use leaked-credential corpuses (e.g., the 2024 RockYou variants); the HIBP integration blocks those at signup / password change.

## Procedure

1. Supabase dashboard → **Authentication** → **Providers** (or "Auth" → "Settings").
2. Find the **Password Settings** section.
3. Toggle **"Prevent use of leaked passwords"** → ON.
4. (Optional but recommended) set **"Minimum password length"** to 12.
5. Click **Save**.

## Verification

After enabling:

1. Open https://squadlogic.vercel.app/login (or staging equivalent).
2. Try to register with the password `Password1!` (a known leaked password).
3. Expected: registration is rejected with `"Password has been pwned"` (or
   similar Supabase Auth error message). The frontend should surface this via
   `frontend/src/components/Login.jsx`'s error pipe.

If registration succeeds with a leaked password, the toggle did not stick —
re-check the dashboard setting.

## Caveats

- HIBP lookup adds ~50–100 ms latency to signup / password-change flows.
- Existing accounts with leaked passwords are NOT auto-rotated. Consider an
  email campaign for accounts whose password length is below the new minimum.
  (Out of scope for v1.0.1; track as v1.1 follow-up if needed.)
- The setting is per-Supabase-project. Enable in **prod** AND in any **staging**
  branch you use for E2E auth flows.

## Roll-back

Set the toggle back to OFF in the same dashboard panel. No data migration
needed.
