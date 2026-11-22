-- 配車行へのPDF添付。Supabase の SQL Editor で1回実行してください。

create table if not exists public.dispatch_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  dispatch_id uuid not null,
  file_name text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

grant select, insert, delete on table public.dispatch_attachments to anon, authenticated;

insert into storage.buckets (id, name, public)
values ('dispatch-files', 'dispatch-files', false)
on conflict (id) do nothing;

drop policy if exists "dispatch files read" on storage.objects;
drop policy if exists "dispatch files write" on storage.objects;
drop policy if exists "dispatch files delete" on storage.objects;

create policy "dispatch files read"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'dispatch-files');

create policy "dispatch files write"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'dispatch-files');

create policy "dispatch files delete"
  on storage.objects for delete to anon, authenticated
  using (bucket_id = 'dispatch-files');
