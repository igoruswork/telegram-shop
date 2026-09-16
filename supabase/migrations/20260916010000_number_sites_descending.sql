-- Preserve the current catalog order while switching to descending numbers.
-- Current order: number_sites ASC, then id ASC.
-- New order: number_sites DESC, then id ASC.
-- Each product receives a unique sequence value, so the next product can use
-- max(number_sites) + 1 and appear at the top of the catalog.
with ranked_products as (
  select
    id,
    row_number() over (order by number_sites asc, id asc) as current_position,
    count(*) over () as product_count
  from public.products
)
update public.products as product
set number_sites = (ranked_products.product_count - ranked_products.current_position + 1)::integer
from ranked_products
where product.id = ranked_products.id;
