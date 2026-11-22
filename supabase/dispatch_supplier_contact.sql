-- 配車の「庸車の担当者」を保存する列。
-- Supabase の SQL Editor で、このファイルを1回実行してください。

alter table public.dispatches
  add column if not exists supplier_contact_code text,
  add column if not exists supplier_contact_name text,
  add column if not exists supplier_contact_tel text;
