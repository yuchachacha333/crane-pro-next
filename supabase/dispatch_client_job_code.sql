-- 請求書に載せる客先の現場コード・工事コード。
-- 現場マスタの現場コード（自動採番）とは別に、配車ごとに保存する。
-- Supabase の SQL Editor で、このファイルを1回実行してください。
alter table public.dispatches
  add column if not exists client_job_code text;
