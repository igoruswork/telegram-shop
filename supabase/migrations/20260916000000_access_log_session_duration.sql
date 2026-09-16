-- Track the active foreground time for each catalog visit.
alter table public.access_log
  add column if not exists session_duration_seconds integer not null default 0,
  add column if not exists session_ended_at timestamptz;

alter table public.access_log
  drop constraint if exists access_log_session_duration_seconds_check;

alter table public.access_log
  add constraint access_log_session_duration_seconds_check
  check (session_duration_seconds >= 0);

drop policy if exists "Access log session can be updated from app" on public.access_log;

-- This follows the current client-side administration model used by the
-- existing access-log policies. Move session writes behind verified Telegram
-- initData before exposing the catalog beyond the trusted audience.
create policy "Access log session can be updated from app"
on public.access_log
for update
to anon, authenticated
using (true)
with check (session_duration_seconds >= 0);
