-- Roll back 20260728000000_catalog_users_approval.sql.
-- Historical public.access_log data is intentionally preserved.

drop table if exists public.catalog_users;
drop function if exists public.set_catalog_users_updated_at();
