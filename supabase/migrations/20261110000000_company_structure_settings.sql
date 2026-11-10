-- Shared, editable company structure for the public /company/ page.
-- The page has no login, so (like the `catalog` key) the anon role may
-- insert and update this one settings row. Reading app_settings is already public.

drop policy if exists "Company structure is publicly insertable" on public.app_settings;
drop policy if exists "Company structure is publicly updatable" on public.app_settings;

create policy "Company structure is publicly insertable"
on public.app_settings
for insert
to anon, authenticated
with check (key = 'company_structure');

create policy "Company structure is publicly updatable"
on public.app_settings
for update
to anon, authenticated
using (key = 'company_structure')
with check (key = 'company_structure');
