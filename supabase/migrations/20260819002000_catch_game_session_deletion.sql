-- Keep one Beauty лов history card per entry and link its attempts to it.

alter table public.catch_game_results
  drop constraint if exists catch_game_results_session_id_fkey;

alter table public.catch_game_results
  add constraint catch_game_results_session_id_fkey
  foreign key (session_id)
  references public.catch_game_sessions (session_id)
  on delete cascade
  not valid;
