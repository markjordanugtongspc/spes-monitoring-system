-- Store optional RBAC grants per staff account instead of per shared role.
-- New and existing non-admin accounts start with no optional permissions.

alter table public.staffs
  add column if not exists perm_view_users boolean not null default false,
  add column if not exists perm_create_users boolean not null default false,
  add column if not exists perm_edit_users boolean not null default false,
  add column if not exists perm_delete_users boolean not null default false,
  add column if not exists perm_export_reports boolean not null default false,
  add column if not exists perm_view_other_offices boolean not null default false,
  add column if not exists perm_view_global_stats boolean not null default false;

comment on column public.staffs.perm_view_users is
  'Allows this staff account to view the implementor directory for its assigned office.';
comment on column public.staffs.perm_view_other_offices is
  'Allows this staff account read-only access to other office rosters.';
comment on column public.staffs.perm_view_global_stats is
  'Allows this staff account to view global dashboard analytics.';
comment on column public.staffs.perm_create_users is
  'Allows this staff account to create implementors in its assigned office.';
comment on column public.staffs.perm_edit_users is
  'Allows this staff account to edit and approve implementors in its assigned office.';
comment on column public.staffs.perm_delete_users is
  'Allows this staff account to archive implementors in its assigned office.';
comment on column public.staffs.perm_export_reports is
  'Allows cross-office exports when read-only other-office access is also granted.';

-- Administrators are unrestricted in application code; keeping their stored
-- flags true makes administrative inspection consistent.
update public.staffs
set
  perm_view_users = true,
  perm_create_users = true,
  perm_edit_users = true,
  perm_delete_users = true,
  perm_export_reports = true,
  perm_view_other_offices = true,
  perm_view_global_stats = true,
  updated_at = now()
where role_id = 1;
