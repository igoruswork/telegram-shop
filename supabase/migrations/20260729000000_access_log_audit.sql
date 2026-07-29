-- catalog_users stores only the current profile and approval state. access_log
-- remains the event history of every catalog entry.

create index if not exists access_log_created_at_idx
  on public.access_log (created_at desc);

alter table public.access_log enable row level security;

drop policy if exists "Access log is readable from app" on public.access_log;
drop policy if exists "Access log can be created from app" on public.access_log;
drop policy if exists "Access log can be deleted from app" on public.access_log;

-- The Mini App currently has no server-verified administrator identity. These
-- policies match the existing client-side admin model; move deletion to a
-- Telegram initData-verified Edge Function when the app is opened publicly.
create policy "Access log is readable from app"
on public.access_log
for select
to anon, authenticated
using (true);

create policy "Access log can be created from app"
on public.access_log
for insert
to anon, authenticated
with check (true);

create policy "Access log can be deleted from app"
on public.access_log
for delete
to anon, authenticated
using (true);
