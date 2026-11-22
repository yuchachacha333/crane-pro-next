-- 仕入先と現場に緯度・経度を保存する列。
-- Supabase の SQL Editor で、このファイルを1回実行してください。
-- https://supabase.com/dashboard/project/mwdncojkmjewgiqkyllc/sql/new

alter table public.customers
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table public.sites
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
