-- オペレータごとの日給。空欄の山科重機工業の従業員は、画面側で2万円として給与を計算します。
-- Supabase の SQL Editor で、このファイルを1回実行してください。
alter table public.operators
  add column if not exists daily_wage numeric;
