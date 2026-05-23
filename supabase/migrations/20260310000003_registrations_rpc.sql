-- Registration RPC: Atomic Submission
-- Replaces multi-step client-side inserts with a single transactional RPC.

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
    v_caller_profile_id uuid := auth.uid();
    v_player_id uuid := p_player_id;
    v_registration_id uuid;
    v_form_division_id uuid;
begin
    -- 0. Caller can only submit as self
    if v_caller_profile_id is null or p_profile_id <> v_caller_profile_id then
        raise exception 'Access denied: profile mismatch.';
    end if;

    -- 1. Validate Organization Membership (Caller must be member of target org)
    if not is_org_member(p_organization_id) then
        raise exception 'Access denied: User is not a member of organization %', p_organization_id;
    end if;

    -- 2. Validate form is in org and open
    select rf.division_id
    into v_form_division_id
    from public.registration_forms rf
    where rf.id = p_form_id
      and rf.organization_id = p_organization_id
      and rf.status = 'open';

    if v_form_division_id is null then
        raise exception 'Invalid or closed registration form for organization %', p_organization_id;
    end if;

    -- 3. Create player if not provided
    if v_player_id is null then
        if p_first_name is null or p_last_name is null then
            raise exception 'New player registration requires first and last name.';
        end if;

        insert into public.players (organization_id, first_name, last_name, division_id)
        values (p_organization_id, p_first_name, p_last_name, v_form_division_id)
        returning id into v_player_id;
    else
        -- Existing player must belong to org and already be linked to caller.
        if not exists (
            select 1
            from public.players p
            where p.id = v_player_id
              and p.organization_id = p_organization_id
        ) then
            raise exception 'Invalid player for organization %', p_organization_id;
        end if;

        if not exists (
            select 1
            from public.profile_players pp
            where pp.profile_id = v_caller_profile_id
              and pp.player_id = v_player_id
              and pp.organization_id = p_organization_id
        ) then
            raise exception 'Access denied: player is not linked to caller profile.';
        end if;
    end if;

    -- 4. Ensure player is linked to profile (safe: p_profile_id is bound to auth.uid())
    insert into public.profile_players (organization_id, profile_id, player_id)
    values (p_organization_id, p_profile_id, v_player_id)
    on conflict (profile_id, player_id) do nothing;

    -- 5. Create Registration Record
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
        p_organization_id,
        p_form_id,
        v_player_id,
        p_profile_id,
        p_responses,
        true,
        now()
    )
    returning id into v_registration_id;

    return v_registration_id;
exception
    when unique_violation then
        raise exception 'This player is already registered for this form.';
end;
$$;

commit;
