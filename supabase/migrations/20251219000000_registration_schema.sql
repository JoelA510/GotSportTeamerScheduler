-- Milestone 3.4: Registration & Compliance Schema
-- Implements custom registration forms, dynamic responses, and explicit compliance tracking

begin;

-- 1. Registration Forms
create table if not exists public.registration_forms (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    title text not null,
    description text,
    season_id uuid references public.season_settings(id) on delete cascade,
    fields jsonb not null default '[]'::jsonb,
    waiver_text text,
    status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
    created_at timestamp with time zone default timezone('utc'::text, now()),
    updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- 2. Registrations (Submissions)
create table if not exists public.registrations (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    form_id uuid not null references public.registration_forms(id) on delete cascade,
    player_id uuid not null references public.players(id) on delete cascade,
    profile_id uuid not null references public.profiles(id) on delete cascade,
    responses jsonb not null default '{}'::jsonb,
    waiver_signed boolean not null default false,
    waiver_signed_at timestamp with time zone,
    medical_cleared boolean not null default false,
    created_at timestamp with time zone default timezone('utc'::text, now()),
    updated_at timestamp with time zone default timezone('utc'::text, now()),
    unique(form_id, player_id) -- A player can only register once per form
);

-- RLS Policies

alter table public.registration_forms enable row level security;
alter table public.registrations enable row level security;

-- Forms:
-- Admins can do all
create policy "Admins manage forms" on public.registration_forms
    for all
    using (
        exists (
            select 1 from public.organization_roles
            where organization_roles.profile_id = auth.uid()
            and organization_roles.organization_id = registration_forms.organization_id
            and organization_roles.role = 'admin'
        )
    );

-- Any authenticated user can read open forms for their organization context (or we can just make them globally readable if they have the link, but let's constrain by org if available via context)
create policy "Users view open forms" on public.registration_forms
    for select
    using (
        status = 'open'
    );


-- Registrations:
-- Admins can do all
create policy "Admins select registrations" on public.registrations
    for select
    using (
        exists (
            select 1 from public.organization_roles
            where organization_roles.profile_id = auth.uid()
            and organization_roles.organization_id = registrations.organization_id
            and organization_roles.role = 'admin'
        )
    );
    
create policy "Admins update registrations" on public.registrations
    for update
    using (
        exists (
            select 1 from public.organization_roles
            where organization_roles.profile_id = auth.uid()
            and organization_roles.organization_id = registrations.organization_id
            and organization_roles.role = 'admin'
        )
    );

create policy "Admins delete registrations" on public.registrations
    for delete
    using (
        exists (
            select 1 from public.organization_roles
            where organization_roles.profile_id = auth.uid()
            and organization_roles.organization_id = registrations.organization_id
            and organization_roles.role = 'admin'
        )
    );

-- Parents can insert and select/update their own submissions
create policy "Parents insert registrations" on public.registrations
    for insert
    with check (
        profile_id = auth.uid()
    );

create policy "Parents select own registrations" on public.registrations
    for select
    using (
        profile_id = auth.uid()
    );

create policy "Parents update own registrations" on public.registrations
    for update
    using (
        profile_id = auth.uid()
    );


-- Triggers for updated_at
create trigger handle_updated_at_forms
    before update on public.registration_forms
    for each row execute procedure moddatetime (updated_at);

create trigger handle_updated_at_registrations
    before update on public.registrations
    for each row execute procedure moddatetime (updated_at);

commit;
