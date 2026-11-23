-- 機種マスタの単位。請求書の単位欄は、ここが入っていれば手入力せずに使います。
-- Supabase の SQL Editor で、このファイルを1回実行してください。
alter table public.machine_models
  add column if not exists unit_name text;
