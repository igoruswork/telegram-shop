-- Store product images in Supabase Storage instead of loading every thumbnail from CRM.
-- Run this in Supabase SQL editor or through the Supabase CLI with service-role/admin rights.

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

create index if not exists products_image_status_idx
  on public.products (image_status);

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

create policy "Product images are publicly readable"
on storage.objects
for select
to public
using (bucket_id = 'product-images');
