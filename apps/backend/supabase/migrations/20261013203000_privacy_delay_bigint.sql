-- 31 days in milliseconds (2_678_400_000) does not fit in integer (max 2_147_483_647).
-- The private-transfer API allows that delay, and sender/recipient copy reads this column.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payments' and column_name = 'private_max_delay_ms'
  ) then
    execute 'alter table public.payments alter column private_max_delay_ms type bigint';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'private_transfers' and column_name = 'delivery_max_delay_ms'
  ) then
    execute 'alter table public.private_transfers alter column delivery_max_delay_ms type bigint';
  end if;
end
$$;
