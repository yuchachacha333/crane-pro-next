-- 庸車先（外注）への支払額を保存する列。
-- Supabase の SQL Editor で、このファイルを1回実行してください。
alter table public.dispatches
  add column if not exists purchase_amount numeric;
