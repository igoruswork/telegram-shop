-- Replace the unbounded access_log lookup path with one current record per phone.
-- Existing access_log rows are kept as historical audit data.

create table if not exists public.catalog_users (
  phone text primary key,
  last_name text not null,
  tg_user_id bigint,
  is_approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_access_at timestamptz not null default now(),
  constraint catalog_users_phone_format_check check (phone ~ '^[+]380[0-9]{9}$')
);

create index if not exists catalog_users_last_access_at_idx
  on public.catalog_users (last_access_at desc);

create index if not exists catalog_users_pending_last_access_at_idx
  on public.catalog_users (is_approved, last_access_at desc);

create or replace function public.set_catalog_users_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists catalog_users_set_updated_at on public.catalog_users;

create trigger catalog_users_set_updated_at
before update on public.catalog_users
for each row
execute function public.set_catalog_users_updated_at();

-- Seed one pending approval per historic visitor. The administrator explicitly
-- approves these records in the app before they can use the catalog again.
do $$
begin
  if to_regclass('public.access_log') is not null then
    insert into public.catalog_users (phone, last_name, tg_user_id, is_approved, created_at, last_access_at)
    select distinct on (phone)
      phone,
      coalesce(nullif(trim(last_name), ''), 'Користувач'),
      tg_user_id,
      false,
      created_at,
      created_at
    from public.access_log
    where phone ~ '^[+]380[0-9]{9}$'
    order by phone, created_at desc
    on conflict (phone) do nothing;
  end if;

  -- Do not lock out existing administrators after the approval flow is enabled.
  if to_regclass('public.app_settings') is not null then
    update public.catalog_users as catalog_user
    set is_approved = true
    where exists (
      select 1
      from public.app_settings as settings
      cross join lateral jsonb_array_elements_text(
        coalesce(settings.value -> 'adminPhones', settings.value -> 'admin_phones', '[]'::jsonb)
      ) as admin_phone(phone)
      where settings.key = 'catalog'
        and admin_phone.phone = catalog_user.phone
    );
  end if;
end;
$$;

alter table public.catalog_users enable row level security;

drop policy if exists "Catalog users are publicly readable" on public.catalog_users;
drop policy if exists "Catalog users can request access" on public.catalog_users;
drop policy if exists "Catalog users can be approved from app" on public.catalog_users;

-- The current Mini App has no server-verified administrator identity yet.
-- These policies preserve the existing client-side administration model. Move
-- approval to a Telegram initData-verified Edge Function before exposing the
-- catalog outside the current trusted audience.
create policy "Catalog users are publicly readable"
on public.catalog_users
for select
to anon, authenticated
using (true);

create policy "Catalog users can request access"
on public.catalog_users
for insert
to anon, authenticated
with check (is_approved = false);

create policy "Catalog users can update profile and approval from app"
on public.catalog_users
for update
to anon, authenticated
using (true)
with check (true);
