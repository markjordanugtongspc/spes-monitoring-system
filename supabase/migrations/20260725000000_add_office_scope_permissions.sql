-- Separate cross-office read access from cross-office analytics access.
-- Both permissions default to false so existing non-admin roles remain
-- restricted to their assigned office until an administrator opts them in.

alter table public.permissions
  add column if not exists view_other_offices boolean not null default false,
  add column if not exists view_global_stats boolean not null default false;

comment on column public.permissions.view_other_offices is
  'Allows read-only browsing of implementors and beneficiaries in other offices.';

comment on column public.permissions.view_global_stats is
  'Allows global dashboard analytics while leaving the gender donut scoped to the assigned office.';

update public.permissions
set
  view_other_offices = true,
  view_global_stats = true,
  updated_at = now()
where role_id = 1;

-- Postgres Changes only emits rows from tables included in the Realtime
-- publication. Keep this idempotent for projects where either table was
-- already enabled from the Supabase Dashboard.
do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'staffs'
    ) then
      execute 'alter publication supabase_realtime add table public.staffs';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'permissions'
    ) then
      execute 'alter publication supabase_realtime add table public.permissions';
    end if;
  end if;
end
$$;
