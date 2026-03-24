-- Phase 3.3 (M-5): Harden submit_registration RPC
-- Derives organization_id from the form's org rather than trusting client input.
-- Also validates that the calling user's profile_id matches p_profile_id.

begin;

create or replace function public.submit_registration(
    p_organization_id uuid,
    p_form_id uuid,
    p_profile_id uuid,
    p_responses jsonb,
    p_player_id uuid default null,
    p_first_name text default null,
    p_last_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_player_id uuid := p_player_id;
    v_registration_id uuid;
    v_form_org_id uuid;
begin
    -- Phase 3.3 Fix: Derive organization_id from the form itself, not client input.
    -- This prevents a user from submitting a registration claiming to be in Org B
    -- when the form actually belongs to Org A.
    select organization_id into v_form_org_id
    from public.registration_forms
    where id = p_form_id;

    if v_form_org_id is null then
        raise exception 'Registration form not found: %', p_form_id;
    end if;

    -- Validate that the client-provided org matches the form's actual org
    if p_organization_id <> v_form_org_id then
        raise exception 'Organization mismatch: form belongs to a different organization';
    end if;

    -- 1. Validate Organization Membership (Caller must be member of the FORM's org)
    if not is_org_member(v_form_org_id) then
        raise exception 'Access denied: User is not a member of organization %', v_form_org_id;
    end if;

    -- Phase 3.3 Fix: Validate that the caller is submitting for themselves
    if p_profile_id <> auth.uid() then
        -- Allow admins to submit on behalf of others
        if not exists (
            select 1 from organization_members
            where organization_id = v_form_org_id
              and profile_id = auth.uid()
              and role = 'admin'
        ) then
            raise exception 'Access denied: Cannot submit registration for another user';
        end if;
    end if;

    -- 2. Create player if not provided
    if v_player_id is null then
        if p_first_name is null or p_last_name is null then
            raise exception 'New player registration requires first and last name.';
        end if;

        insert into public.players (organization_id, first_name, last_name, division_id)
        select v_form_org_id, p_first_name, p_last_name, rf.division_id
        from public.registration_forms rf
        where rf.id = p_form_id
        returning id into v_player_id;
    end if;

    -- 3. Ensure player is linked to profile
    insert into public.profile_players (organization_id, profile_id, player_id)
    values (v_form_org_id, p_profile_id, v_player_id)
    on conflict (profile_id, player_id) do nothing;

    -- 4. Create Registration Record
    insert into public.registrations (
        organization_id,
        form_id,
        player_id,
        profile_id,
        responses,
        waiver_signed,
        waiver_signed_at
    )
    values (
        v_form_org_id,
        p_form_id,
        v_player_id,
        p_profile_id,
        p_responses,
        true,
        now()
    )
    returning id into v_registration_id;

    -- Phase 4 (4.6): Audit log
    perform record_audit_event(
        v_form_org_id,
        'registration.submitted',
        'registration',
        v_registration_id,
        json_build_object('form_id', p_form_id, 'player_id', v_player_id)::jsonb
    );

    return v_registration_id;
exception
    when unique_violation then
        raise exception 'This player is already registered for this form.';
end;
$$;

commit;
