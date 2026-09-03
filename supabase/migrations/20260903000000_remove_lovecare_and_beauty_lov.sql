-- Remove retired LoveCare activity and Beauty лов game analytics.
-- Existing creation migrations stay in version history; this migration makes an
-- already deployed database match the application schema.

update public.app_settings
set value = value - 'loveCareActivity'
where key = 'catalog'
  and value ? 'loveCareActivity';

drop table if exists public.catch_game_results cascade;
drop table if exists public.catch_game_sessions cascade;
