-- Keep the existing phone-only entry as explicitly requested. This is an
-- allowlist, NOT proof of the caller's identity (no password or OTP).
create table public.keycrm_admins (
  phone text primary key check (phone ~ '^\+380[0-9]{9}$'),
  created_at timestamptz not null default now()
);

-- Snapshot existing configured administrators once. Subsequent public changes
-- to app_settings cannot grant CRM access; manage this list with SQL Editor.
insert into public.keycrm_admins(phone)
select distinct phone
from public.app_settings settings,
  lateral jsonb_array_elements_text(case
    when jsonb_typeof(settings.value->'adminPhones') = 'array' then settings.value->'adminPhones'
    when jsonb_typeof(settings.value->'admin_phones') = 'array' then settings.value->'admin_phones'
    else '[]'::jsonb end) as phones(phone)
where settings.key = 'catalog' and phone ~ '^\+380[0-9]{9}$'
on conflict do nothing;

create table public.keycrm_order_exports (
  local_order_id bigint primary key references public.orders(id),
  state text not null check (state in ('preflight', 'posting', 'created', 'failed', 'needs_review')),
  attempt_id uuid not null,
  actor_phone text not null,
  request_payload jsonb,
  crm_id bigint unique check (crm_id > 0),
  crm_total numeric check (crm_total >= 0),
  crm_products jsonb,
  message text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  reviewed_by_phone text,
  check (state <> 'created' or (crm_id is not null and crm_total is not null))
);

create table public.keycrm_rate_limits (
  key_hash text primary key,
  next_at timestamptz not null
);

alter table public.keycrm_admins enable row level security;
alter table public.keycrm_order_exports enable row level security;
alter table public.keycrm_rate_limits enable row level security;
revoke all on public.keycrm_admins, public.keycrm_order_exports, public.keycrm_rate_limits from anon, authenticated;
grant all on public.keycrm_admins, public.keycrm_order_exports, public.keycrm_rate_limits to service_role;

-- Only failed attempts known not to have created an order can be claimed again.
-- An uncertain POST is never unlocked by a timer.
create function public.claim_keycrm_order(p_order_id bigint, p_attempt_id uuid, p_actor_phone text)
returns jsonb language plpgsql set search_path = '' as $$
declare result public.keycrm_order_exports; acquired boolean := false;
begin
  insert into public.keycrm_order_exports(local_order_id, state, attempt_id, actor_phone)
  values (p_order_id, 'preflight', p_attempt_id, p_actor_phone)
  on conflict (local_order_id) do nothing
  returning * into result;
  if found then
    acquired := true;
  else
    select * into result from public.keycrm_order_exports where local_order_id = p_order_id for update;
    if result.state = 'failed' and result.crm_id is null then
      update public.keycrm_order_exports
      set state = 'preflight', attempt_id = p_attempt_id, actor_phone = p_actor_phone,
          request_payload = null, crm_total = null, crm_products = null, message = null,
          started_at = now(), updated_at = now(), completed_at = null, reviewed_by_phone = null
      where local_order_id = p_order_id returning * into result;
      acquired := true;
    end if;
  end if;
  return jsonb_build_object('acquired', acquired, 'record', to_jsonb(result));
end;
$$;

-- Called only on a read from an allowlisted phone. Expired
-- preflight cannot subsequently enter posting: the worker's update is fenced by state.
create function public.expire_keycrm_attempts(p_order_ids bigint[])
returns void language sql set search_path = '' as $$
  update public.keycrm_order_exports
  set state = case when state = 'preflight' then 'failed' else 'needs_review' end,
      message = case when state = 'preflight'
        then 'Підготовка перервана до відправлення. Можна повторити вручну.'
        else 'Відповідь не підтверджена. Потребує перевірки без повторного створення.' end,
      updated_at = now()
  where local_order_id = any(p_order_ids) and state in ('preflight', 'posting')
    and updated_at < now() - interval '2 minutes';
$$;

-- Pace this application's requests across concurrent Edge workers. Other
-- integrations using the same API key still count towards KeyCRM's quota.
create function public.reserve_keycrm_request(p_key_hash text)
returns integer language plpgsql set search_path = '' as $$
declare scheduled_at timestamptz; current_at timestamptz := clock_timestamp();
begin
  insert into public.keycrm_rate_limits(key_hash, next_at)
  values (p_key_hash, current_at) on conflict do nothing;
  select greatest(next_at, current_at) into scheduled_at
    from public.keycrm_rate_limits where key_hash = p_key_hash for update;
  if scheduled_at > current_at + interval '15 seconds' then
    return -1;
  end if;
  update public.keycrm_rate_limits set next_at = scheduled_at + interval '3100 milliseconds'
    where key_hash = p_key_hash;
  return greatest(0, ceil(extract(epoch from (scheduled_at - current_at)) * 1000)::integer);
end;
$$;

revoke all on function public.claim_keycrm_order(bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.expire_keycrm_attempts(bigint[]) from public, anon, authenticated;
revoke all on function public.reserve_keycrm_request(text) from public, anon, authenticated;
grant execute on function public.claim_keycrm_order(bigint, uuid, text) to service_role;
grant execute on function public.expire_keycrm_attempts(bigint[]) to service_role;
grant execute on function public.reserve_keycrm_request(text) to service_role;
