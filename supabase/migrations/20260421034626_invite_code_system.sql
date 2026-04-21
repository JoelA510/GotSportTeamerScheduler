-- Invite-code system for onboarding existing users into an organization
-- without creating a new one.
--
-- Ask: single-use short codes (A3KQ-7PLM form), keep slugs for the first
-- admin's org, "Got an invite code?" on the onboarding screen AND a
-- /invite/<code> deep-link, signup-then-auto-redeem UX.
--
-- Schema: public.organization_invites — one row per issued code.
-- Policies: admin-only SELECT/DELETE; INSERT/UPDATE flows through
--           SECURITY DEFINER RPCs so the redeem path works for any
--           authenticated user even though they're not (yet) a member
--           of the target org.
-- RPCs:
--   public.generate_invite_code()                      -- helper (internal)
--   public.create_org_invite(p_org_id, p_role, p_expires_in)
--                                                     -- admin-only
--   public.redeem_org_invite(p_code)                  -- authenticated
--
-- Reversal: docs/sql/reverts/20260421034626_revert.sql.
-- Smoke:    docs/sql/tests/20260421034626_smoke.sql.

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organization_invites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('admin', 'coach', 'player', 'parent', 'staff')),
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  used_at         timestamptz,
  used_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT organization_invites_used_consistency
    CHECK ((used_at IS NULL AND used_by IS NULL) OR (used_at IS NOT NULL))
);

-- Performance + lookup.
CREATE INDEX IF NOT EXISTS idx_organization_invites_org_id
  ON public.organization_invites (organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_invites_unused
  ON public.organization_invites (organization_id, created_at DESC)
  WHERE used_at IS NULL;

COMMENT ON TABLE public.organization_invites IS
  'Single-use invite codes that add an auth.users member to an org with a preset role.';

-- ────────────────────────────────────────────────────────────
-- 2. RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

-- Admins can see their org's invites (for listing / revoking in settings UI).
DROP POLICY IF EXISTS "Invites: admins view own org"
  ON public.organization_invites;
CREATE POLICY "Invites: admins view own org"
  ON public.organization_invites FOR SELECT
  TO authenticated
  USING (public.is_org_admin(organization_id));

-- Admins can delete unused invites (revoke).
DROP POLICY IF EXISTS "Invites: admins delete unused"
  ON public.organization_invites;
CREATE POLICY "Invites: admins delete unused"
  ON public.organization_invites FOR DELETE
  TO authenticated
  USING (public.is_org_admin(organization_id) AND used_at IS NULL);

-- NO direct INSERT or UPDATE policy — both go through the SECURITY DEFINER
-- RPCs below. That keeps the redeem flow working for users who are not
-- (yet) members of the target org.

-- ────────────────────────────────────────────────────────────
-- 3. Code generator
-- ────────────────────────────────────────────────────────────
-- Crockford-ish base32 (no 0, 1, I, L, O, U — reduces visual ambiguity).
-- 8 symbols × log2(32) = 40 bits of entropy ≈ 1.1 trillion values; plenty
-- for single-use codes. Format: XXXX-XXXX for easy typing.
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  alphabet text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  out_code text := '';
  i int;
BEGIN
  FOR i IN 1..8 LOOP
    out_code := out_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    IF i = 4 THEN
      out_code := out_code || '-';
    END IF;
  END LOOP;
  RETURN out_code;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 4. create_org_invite — admin-only
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_org_invite(
  p_org_id     uuid,
  p_role       text,
  p_expires_in interval DEFAULT interval '7 days'
)
RETURNS TABLE (code text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code       text;
  v_expires_at timestamptz;
  v_attempts   int := 0;
BEGIN
  -- Authz: caller must be admin of the target org.
  IF NOT public.is_org_admin(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized to create invites for this organization'
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  -- Role whitelist (matches the CHECK constraint).
  IF p_role NOT IN ('admin', 'coach', 'player', 'parent', 'staff') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role USING ERRCODE = '22023';
  END IF;

  v_expires_at := CASE
    WHEN p_expires_in IS NULL THEN NULL
    ELSE now() + p_expires_in
  END;

  -- Retry up to 5 times on code collision (probability ≈ 0 at current volume).
  LOOP
    v_attempts := v_attempts + 1;
    v_code := public.generate_invite_code();
    BEGIN
      INSERT INTO public.organization_invites (code, organization_id, role, created_by, expires_at)
      VALUES (v_code, p_org_id, p_role, auth.uid(), v_expires_at);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempts >= 5 THEN
        RAISE EXCEPTION 'Could not generate a unique invite code after % attempts', v_attempts;
      END IF;
    END;
  END LOOP;

  RETURN QUERY SELECT v_code, v_expires_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_org_invite(uuid, text, interval) TO authenticated;

COMMENT ON FUNCTION public.create_org_invite(uuid, text, interval) IS
  'Admin-only. Mints a single-use invite code for the given org + role.';

-- ────────────────────────────────────────────────────────────
-- 5. redeem_org_invite — any authenticated user
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.redeem_org_invite(p_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite       public.organization_invites;
  v_user_id      uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Normalize input: strip whitespace, upper-case. Codes are case-insensitive
  -- to the user but stored upper-case. `FOR UPDATE` locks the row for the
  -- duration of this transaction so two concurrent redeems of the same code
  -- can't both pass the used_at check — the second caller blocks until the
  -- first commits/rolls back, then re-reads the updated used_at and rejects.
  SELECT * INTO v_invite
  FROM public.organization_invites
  WHERE code = upper(btrim(p_code))
  FOR UPDATE;

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'Invite code not found' USING ERRCODE = '22023';
  END IF;
  IF v_invite.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invite code has already been used' USING ERRCODE = '22023';
  END IF;
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'Invite code has expired' USING ERRCODE = '22023';
  END IF;

  -- If the caller is ALREADY a member of this org, short-circuit: mark the
  -- invite used (so it can't be reused) but don't duplicate the membership
  -- row. Returning the org_id still lets the frontend route to the dashboard.
  IF EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = v_invite.organization_id
      AND profile_id = v_user_id
  ) THEN
    UPDATE public.organization_invites
    SET used_at = now(), used_by = v_user_id
    WHERE id = v_invite.id;
    RETURN v_invite.organization_id;
  END IF;

  -- Happy path: add membership + consume invite atomically.
  INSERT INTO public.organization_members (organization_id, profile_id, role)
  VALUES (v_invite.organization_id, v_user_id, v_invite.role);

  UPDATE public.organization_invites
  SET used_at = now(), used_by = v_user_id
  WHERE id = v_invite.id;

  -- Audit (best-effort — don't fail the redeem if audit RPC is missing).
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'record_audit_event') THEN
    PERFORM public.record_audit_event(
      v_invite.organization_id,
      'members.invited_joined',
      'organization_member',
      v_user_id,
      jsonb_build_object('role', v_invite.role, 'invite_id', v_invite.id)
    );
  END IF;

  RETURN v_invite.organization_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_org_invite(text) TO authenticated;

COMMENT ON FUNCTION public.redeem_org_invite(text) IS
  'Authenticated. Consumes a single-use invite; adds the caller to the invited org with the preset role.';

COMMIT;
