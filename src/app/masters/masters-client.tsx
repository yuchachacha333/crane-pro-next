'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Search } from 'lucide-react';
import AppSidebar from '@/components/app-sidebar';
import { getDefaultCompanyId, supabase } from '@/lib/supabase';
import { lookupPostal } from '@/lib/address-lookup';
import { nextMasterCode } from '@/lib/next-code';
import { MASTER_FORMS, fieldsOf, type MasterDefinition, type MasterField, type MasterTable } from '@/lib/master-forms';

type Cell = string | number | boolean | null;
type Row = Record<string, Cell> & { id: string };

const LIST_LIMIT = 80;

function asText(value: Cell | undefined): string {
  if (value == null || value === false) return '';
  if (value === true) return 'true';
  return String(value);
}

function sanitizeTerm(value: string): string {
  return value.replace(/[%_,*()]/g, '').trim();
}

export default function MastersClient() {
  const [companyId, setCompanyId] = useState('');
  const [table, setTable] = useState<MasterTable>('customers');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [needQuery, setNeedQuery] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const master = useMemo(
    () => MASTER_FORMS.find((item) => item.table === table) ?? MASTER_FORMS[0],
    [table]
  );

  useEffect(() => {
    let cancelled = false;
    getDefaultCompanyId()
      .then((id) => {
        if (!cancelled) setCompanyId(id);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || '会社マスタを読み込めません');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .then(({ count }) => {
        if (!cancelled) setTotal(count ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, table]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    const handle = window.setTimeout(() => {
      void loadRows(master, companyId, query);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [companyId, master, query]);

  async function loadRows(definition: MasterDefinition, cid: string, rawQuery: string) {
    const term = sanitizeTerm(rawQuery);
    if (definition.requireQuery && !term) {
      setRows([]);
      setNeedQuery(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNeedQuery(false);
    setError('');
    let request = supabase.from(definition.table).select('*').eq('company_id', cid);
    if (term) {
      const orFilter = definition.searchColumns.map((column) => `${column}.ilike.%${term}%`).join(',');
      request = request.or(orFilter);
    }
    const { data, error: queryError } = await request.order('code', { ascending: true }).limit(LIST_LIMIT);
    setLoading(false);
    if (queryError) {
      setError(queryError.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as Row[]);
  }

  function openRow(row: Row) {
    const next: Record<string, string> = {};
    for (const field of fieldsOf(master)) {
      const value = row[field.key];
      if (field.kind === 'bool') next[field.key] = value === true || value === 'true' || value === 1 ? '1' : '';
      else if (field.kind === 'date') next[field.key] = asText(value).slice(0, 10);
      else next[field.key] = asText(value);
    }
    setSelectedId(row.id);
    setDraft(next);
    setMessage('');
    setError('');
  }

  function startNew() {
    const next: Record<string, string> = {};
    for (const field of fieldsOf(master)) next[field.key] = '';
    setSelectedId('new');
    setDraft(next);
    setMessage('');
    setError('');
    const auto = fieldsOf(master).find((field) => field.auto);
    if (!auto || !companyId) return;
    void nextMasterCode(master.table, companyId)
      .then((code) => setDraft((current) => ({ ...current, [auto.key]: code })))
      .catch((err: Error) => setError(err.message || 'コードを作れません'));
  }

  function changeTable(next: MasterTable) {
    setTable(next);
    setQuery('');
    setRows([]);
    setTotal(null);
    setLoading(true);
    setNeedQuery(false);
    setSelectedId(null);
    setDraft({});
    setMessage('');
    setError('');
  }

  async function fillAddress(field: MasterField, value: string) {
    if (field.zipFor) {
      const found = await lookupPostal({ zip: value });
      if (!found.address) {
        if (value.replace(/\D/g, '').length === 7) setError('その郵便番号の住所は見つかりません');
        return;
      }
      setError('');
      setDraft((current) => ({
        ...current,
        [field.key]: found.zip || current[field.key],
        [field.zipFor as string]: found.address,
      }));
      return;
    }
    if (!field.addressFor) return;
    const found = await lookupPostal({ address: value });
    if (found.zip) setDraft((current) => ({ ...current, [field.addressFor as string]: found.zip }));
  }

  async function lookupCustomer(code: string) {
    if (!companyId || (table !== 'sites' && table !== 'customer_contacts')) return;
    const trimmed = code.trim();
    if (!trimmed) return;
    const { data } = await supabase
      .from('customers')
      .select('name')
      .eq('company_id', companyId)
      .eq('code', trimmed)
      .maybeSingle();
    if (data?.name) {
      setDraft((current) => ({ ...current, customer_name: data.name }));
    }
  }

  async function save() {
    if (!companyId || !selectedId) return;
    let code = (draft.code || '').trim();
    const name = (draft.name || '').trim();
    const autoCode = fieldsOf(master).some((field) => field.key === 'code' && field.auto);
    if (!code && autoCode) {
      try {
        code = await nextMasterCode(table, companyId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'コードを作れません');
        return;
      }
    }
    if (!code || !name) {
      setError('コードと名称は必須です');
      return;
    }
    const payload: Record<string, string | number | boolean | null> = { company_id: companyId };
    for (const field of fieldsOf(master)) {
      const raw = (draft[field.key] || '').trim();
      if (field.kind === 'bool') {
        payload[field.key] = raw === '1';
      } else if (field.kind === 'number') {
        if (raw === '') payload[field.key] = null;
        else if (!Number.isFinite(Number(raw))) {
          setError(`${field.label}は数字で入力してください`);
          return;
        } else payload[field.key] = Number(raw);
      } else if (field.kind === 'date') {
        payload[field.key] = raw === '' ? null : raw;
      } else if (field.required) {
        payload[field.key] = raw;
      } else {
        payload[field.key] = raw === '' ? null : raw;
      }
    }
    payload.code = code;
    setSaving(true);
    setError('');
    const request =
      selectedId === 'new'
        ? supabase.from(table).insert(payload).select('*').single()
        : supabase.from(table).update(payload).eq('id', selectedId).select('*').single();
    const { data, error: saveError } = await request;
    setSaving(false);
    if (saveError) {
      setError(saveError.message.includes('duplicate') || saveError.message.includes('unique')
        ? '同じコードがすでにあります'
        : saveError.message);
      return;
    }
    const saved = data as Row;
    setSelectedId(saved.id);
    setMessage('保存しました');
    await loadRows(master, companyId, query);
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col md:flex-row">
      <AppSidebar active="masters" />
      <main className="flex-1 min-w-0 p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">マスタ台帳</h1>
            <p className="text-sm text-slate-500 mt-1">
              {master.blurb}
              {total != null ? `　全${total.toLocaleString()}件` : ''}
            </p>
          </div>
          <div className="flex flex-wrap rounded-xl bg-white border border-slate-200 p-1">
            {MASTER_FORMS.map((item) => (
              <button
                key={item.table}
                type="button"
                onClick={() => changeTable(item.table)}
                className={`px-4 py-2 rounded-lg text-sm font-extrabold ${
                  table === item.table ? 'bg-[#121826] text-white' : 'text-slate-600'
                }`}
              >
                {item.title}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] gap-4 items-start">
          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <form
              className="p-3 border-b border-slate-100 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (companyId) void loadRows(master, companyId, query);
              }}
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={master.searchHint}
                  className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-300 font-bold"
                />
              </div>
              <button type="button" onClick={startNew} className="h-11 px-3 rounded-xl bg-teal-700 text-white font-extrabold text-sm inline-flex items-center gap-1">
                <Plus className="w-4 h-4" />
                新規
              </button>
            </form>

            {needQuery && (
              <p className="p-6 text-sm font-bold text-slate-500">
                {master.title}は{total?.toLocaleString() ?? ''}件あります。名前やコードで絞り込んでください。
              </p>
            )}
            {loading && <p className="p-6 text-sm font-bold text-slate-500">検索しています...</p>}
            {!loading && !needQuery && rows.length === 0 && (
              <p className="p-6 text-sm font-bold text-slate-500">該当する{master.title}はありません。</p>
            )}
            {!loading && rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-sky-50 text-left text-xs font-extrabold text-slate-700">
                      {master.listColumns.map((column) => (
                        <th key={column.key} className="px-3 py-2 whitespace-nowrap">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => openRow(row)}
                        className={`border-t border-slate-100 cursor-pointer ${
                          selectedId === row.id ? 'bg-teal-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        {master.listColumns.map((column) => (
                          <td key={column.key} className="px-3 py-2 max-w-[220px] truncate">
                            {asText(row[column.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length >= LIST_LIMIT && (
                  <p className="px-3 py-2 text-xs font-bold text-slate-500">先頭{LIST_LIMIT}件です。言葉を足すと絞り込めます。</p>
                )}
              </div>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
            {!selectedId ? (
              <p className="text-sm font-bold text-slate-500 py-8 text-center">一覧から選ぶと、ここで内容を修正できます。</p>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <h2 className="font-extrabold text-lg mb-3">
                  {selectedId === 'new' ? `${master.title}を追加` : draft.name || master.title}
                </h2>
                <div className="space-y-4 max-h-[70vh] overflow-auto pr-1">
                  {master.groups.map((group) => (
                    <fieldset key={group.name}>
                      <legend className="text-xs font-extrabold text-slate-500 mb-2">{group.name}</legend>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {group.fields.map((field) => (
                          <label key={field.key} className={field.kind === 'textarea' ? 'sm:col-span-2 block' : 'block'}>
                            <span className="text-xs font-extrabold text-slate-600">
                              {field.label}
                              {field.required ? ' *' : ''}
                            </span>
                            {field.kind === 'textarea' ? (
                              <textarea
                                value={draft[field.key] || ''}
                                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                                onBlur={field.addressFor ? (event) => void fillAddress(field, event.target.value) : undefined}
                                placeholder={field.addressFor ? '入れると郵便番号が出ます' : undefined}
                                rows={2}
                                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-bold"
                              />
                            ) : field.kind === 'bool' ? (
                              <input
                                type="checkbox"
                                checked={draft[field.key] === '1'}
                                onChange={(event) =>
                                  setDraft((current) => ({ ...current, [field.key]: event.target.checked ? '1' : '' }))
                                }
                                className="mt-3 h-5 w-5"
                              />
                            ) : (
                              <input
                                type={field.kind === 'date' ? 'date' : 'text'}
                                value={draft[field.key] || ''}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setDraft((current) => ({ ...current, [field.key]: value }));
                                  if (field.zipFor && value.replace(/\D/g, '').length === 7) void fillAddress(field, value);
                                }}
                                placeholder={
                                  field.auto
                                    ? '空欄なら保存時に自動で番号が入ります'
                                    : field.zipFor
                                      ? '7桁で住所が出ます'
                                      : undefined
                                }
                                onBlur={(event) => {
                                  if (field.key === 'customer_code') void lookupCustomer(event.target.value);
                                  if (field.zipFor || field.addressFor) void fillAddress(field, event.target.value);
                                }}
                                inputMode={field.kind === 'number' ? 'numeric' : undefined}
                                className="mt-1 w-full h-10 rounded-xl border border-slate-300 px-3 font-bold"
                              />
                            )}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
                {error && <p className="mt-3 text-sm font-bold text-rose-700">{error}</p>}
                {message && <p className="mt-3 text-sm font-bold text-teal-800">{message}</p>}
                <button
                  type="submit"
                  disabled={saving}
                  className="mt-4 h-11 px-4 rounded-xl bg-[#121826] text-white font-extrabold text-sm inline-flex items-center gap-2 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {saving ? '保存中...' : '保存'}
                </button>
              </form>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
