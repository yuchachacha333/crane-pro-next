-- クレーンPRO の公開キー（anon）からマスタを読み書きするための権限。
-- Supabase の SQL Editor で、このファイルを1回実行してください。
-- 取込は company_id + code の一意制約で「同じコードは更新、無ければ追加」になります。

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on table
  public.companies,
  public.customers,
  public.sites,
  public.operators,
  public.machine_models,
  public.products,
  public.dispatches,
  public.dispatch_extras,
  public.vehicle_inspections,
  public.customer_contacts
to anon, authenticated;

create unique index if not exists customers_company_code_key
  on public.customers (company_id, code);
create unique index if not exists sites_company_code_key
  on public.sites (company_id, code);
create unique index if not exists operators_company_code_key
  on public.operators (company_id, code);
create unique index if not exists machine_models_company_code_key
  on public.machine_models (company_id, code);
create unique index if not exists products_company_code_key
  on public.products (company_id, code);
do $$
begin
  create unique index if not exists customer_contacts_company_code_key
    on public.customer_contacts (company_id, code);
exception
  when others then
    raise notice 'customer_contacts index: %', sqlerrm;
end $$;

-- RLS が有効でも、この社内アプリから読み書きできるようにする。
do $$
declare
  t text;
begin
  foreach t in array array[
    'companies',
    'customers',
    'sites',
    'operators',
    'machine_models',
    'products',
    'dispatches',
    'dispatch_extras',
    'vehicle_inspections',
    'customer_contacts'
  ]
  loop
    begin
      execute format('drop policy if exists crane_pro_app_all on public.%I', t);
      execute format(
        'create policy crane_pro_app_all on public.%I for all to anon, authenticated using (true) with check (true)',
        t
      );
    exception
      when others then
        raise notice 'policy %: %', t, sqlerrm;
    end;
  end loop;
end $$;
