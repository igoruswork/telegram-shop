-- Keep blocked users distinct from visitors who are only waiting for approval.
alter table public.catalog_users
  add column if not exists is_blocked boolean not null default false;

create index if not exists catalog_users_blocked_last_access_at_idx
  on public.catalog_users (is_blocked, last_access_at desc);
