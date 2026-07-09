-- Allow the current client-side admin panel to manage products and upload product images.
-- Run in Supabase SQL editor with admin rights.
--
-- Note: the app currently identifies admin access in the frontend by phone number,
-- so these policies intentionally allow anon/authenticated writes for this mini app.

alter table public.products
  add column if not exists source_thumbnail_url text,
  add column if not exists image_storage_path text,
  add column if not exists image_status text not null default 'pending',
  add column if not exists image_checked_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_image_status_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_image_status_check
      check (image_status in ('pending', 'ok', 'broken'));
  end if;
end $$;

update public.products
set source_thumbnail_url = thumbnail_url
where source_thumbnail_url is null
  and thumbnail_url is not null;

alter table public.products enable row level security;

drop policy if exists "Products are publicly readable" on public.products;
drop policy if exists "Products are publicly insertable from app" on public.products;
drop policy if exists "Products are publicly updatable from app" on public.products;

create policy "Products are publicly readable"
on public.products
for select
to anon, authenticated
using (true);

create policy "Products are publicly insertable from app"
on public.products
for insert
to anon, authenticated
with check (true);

create policy "Products are publicly updatable from app"
on public.products
for update
to anon, authenticated
using (true)
with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Product images are publicly readable" on storage.objects;
drop policy if exists "Product images can be uploaded from app" on storage.objects;
drop policy if exists "Product images can be updated from app" on storage.objects;

create policy "Product images are publicly readable"
on storage.objects
for select
to public
using (bucket_id = 'product-images');

create policy "Product images can be uploaded from app"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'product-images');

create policy "Product images can be updated from app"
on storage.objects
for update
to anon, authenticated
using (bucket_id = 'product-images')
with check (bucket_id = 'product-images');
