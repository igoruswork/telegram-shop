-- Keep one Beauty лов history card per entry and remove its attempts together.

alter table public.catch_game_results
  drop constraint if exists catch_game_results_session_id_fkey;

alter table public.catch_game_results
  add constraint catch_game_results_session_id_fkey
  foreign key (session_id)
  references public.catch_game_sessions (session_id)
  on delete cascade
  not valid;

drop policy if exists "Beauty game sessions can be deleted from app" on public.catch_game_sessions;
create policy "Beauty game sessions can be deleted from app"
on public.catch_game_sessions
for delete
to anon, authenticated
using (true);

drop policy if exists "CatchCare results can be deleted from app" on public.catch_game_results;
create policy "CatchCare results can be deleted from app"
on public.catch_game_results
for delete
to anon, authenticated
using (true);
