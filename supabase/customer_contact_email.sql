-- 担当者マスタにメールアドレスを保存する列。
-- Supabase の SQL Editor で、このファイルを1回実行してください。

alter table public.customer_contacts
  add column if not exists email text;
