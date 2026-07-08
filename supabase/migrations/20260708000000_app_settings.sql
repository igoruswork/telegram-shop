-- Persist catalog UI settings across devices.
-- Run this in Supabase SQL editor or through the Supabase CLI with admin rights.

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.set_app_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_settings_set_updated_at on public.app_settings;

create trigger app_settings_set_updated_at
before update on public.app_settings
for each row
execute function public.set_app_settings_updated_at();

alter table public.app_settings enable row level security;

drop policy if exists "App settings are publicly readable" on public.app_settings;
drop policy if exists "Catalog settings are publicly insertable" on public.app_settings;
drop policy if exists "Catalog settings are publicly updatable" on public.app_settings;

create policy "App settings are publicly readable"
on public.app_settings
for select
to anon, authenticated
using (true);

create policy "Catalog settings are publicly insertable"
on public.app_settings
for insert
to anon, authenticated
with check (key = 'catalog');

create policy "Catalog settings are publicly updatable"
on public.app_settings
for update
to anon, authenticated
using (key = 'catalog')
with check (key = 'catalog');
