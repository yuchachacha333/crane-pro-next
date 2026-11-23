-- 配車依頼書の備考。配車表の備考（notes）とは別に保存する。
-- Supabase の SQL Editor で、このファイルを1回実行してください。
alter table public.dispatches
  add column if not exists request_notes text;
