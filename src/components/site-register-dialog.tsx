'use client';

import React, { useEffect, useState } from 'react';
import { lookupPostal } from '@/lib/address-lookup';
import { toHalfwidthTime } from '@/lib/time-text';
import { nextMasterCode } from '@/lib/next-code';
import { supabase } from '@/lib/supabase';

export type SiteDraft = {
  rowId: string;
  name: string;
  customerCode: string;
  customerName: string;
  entryTime: string;
};

type Props = {
  companyId: string;
  draft: SiteDraft;
  onClose: () => void;
  onCreated: (site: {
    id: string;
    code: string;
    name: string;
    customer_code: string;
    customer_name: string;
    default_entry_time: string;
    contact_name: string;
    contact_tel: string;
  }) => void;
};

export default function SiteRegisterDialog({ companyId, draft, onClose, onCreated }: Props) {
  const [code, setCode] = useState('');
  const [name, setName] = useState(draft.name);
  const [postal, setPostal] = useState('');
  const [address, setAddress] = useState('');
  const [tel, setTel] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactTel, setContactTel] = useState('');
  const [entryTime, setEntryTime] = useState(draft.entryTime);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    nextMasterCode('sites', companyId)
      .then((next) => {
        if (!cancelled) setCode(next);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || '現場コードを作れません');
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function fillAddress() {
    const found = await lookupPostal({ zip: postal });
    if (found.address) {
      setAddress(found.address);
      if (found.zip) setPostal(found.zip);
    } else if (postal.replace(/\D/g, '').length === 7) {
      setError('その郵便番号の住所は見つかりません');
    }
  }

  async function fillPostal() {
    if (postal.trim()) return;
    const found = await lookupPostal({ address });
    if (found.zip) setPostal(found.zip);
  }

  async function save() {
    const siteName = name.trim();
    if (!siteName) {
      setError('現場名は必須です');
      return;
    }
    setSaving(true);
    setError('');
    const siteCode = code || (await nextMasterCode('sites', companyId));
    const payload = {
      company_id: companyId,
      code: siteCode,
      name: siteName,
      customer_code: draft.customerCode || null,
      customer_name: draft.customerName || null,
      postal_code: postal.trim() || null,
      address: address.trim() || null,
      tel: tel.trim() || null,
      contact_name: contactName.trim() || null,
      contact_tel: contactTel.trim() || null,
      default_entry_time: toHalfwidthTime(entryTime.trim()) || null,
    };
    const { data, error: saveError } = await supabase.from('sites').insert(payload).select('id, code, name').single();
    setSaving(false);
    if (saveError || !data) {
      setError(saveError?.message || '現場を保存できません');
      return;
    }
    onCreated({
      id: data.id,
      code: data.code,
      name: data.name,
      customer_code: draft.customerCode,
      customer_name: draft.customerName,
      default_entry_time: entryTime.trim(),
      contact_name: contactName.trim(),
      contact_tel: contactTel.trim(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
      <form
        className="bg-white w-full max-w-lg rounded-2xl shadow-2xl p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 className="text-xl font-extrabold">現場マスタに登録</h2>
        <p className="mt-1 text-sm font-bold text-slate-500">
          現場コードは {code || '採番中...'} です。いまある番号の次を自動で付けます。
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="sm:col-span-2 block text-xs font-extrabold text-slate-600">
            現場名
            <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full h-10 rounded-xl border border-slate-300 px-3 font-bold" />
          </label>
          <label className="sm:col-span-2 block text-xs font-extrabold text-slate-600">
            得意先
            <input value={draft.customerName} readOnly className="mt-1 w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 font-bold" />
          </label>
          <label className="block text-xs font-extrabold text-slate-600">
            郵便番号
            <input
              value={postal}
              onChange={(event) => setPostal(event.target.value)}
              onBlur={() => void fillAddress()}
              placeholder="7桁で住所が出ます"
              className="mt-1 w-full h-10 rounded-xl border border-slate-300 px-3 font-bold"
            />
          </label>
          <label className="block text-xs font-extrabold text-slate-600">
            電話
            <input value={tel} onChange={(event) => setTel(event.target.value)} className="mt-1 w-full h-10 rounded-xl border border-slate-300 px-3 font-bold" />
          </label>
          <label className="sm:col-span-2 block text-xs font-extrabold text-slate-600">
            住所
            <textarea
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              onBlur={() => void fillPostal()}
              placeholder="入れると郵便番号が出ます"
              rows={2}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-bold"
            />
          </label>
          <label className="block text-xs font-extrabold text-slate-600">
            担当者
            <input value={contactName} onChange={(event) => setContactName(event.target.value)} className="mt-1 w-full h-10 rounded-xl border border-slate-300 px-3 font-bold" />
          </label>
          <label className="block text-xs font-extrabold text-slate-600">
            携帯
            <input value={contactTel} onChange={(event) => setContactTel(event.target.value)} className="mt-1 w-full h-10 rounded-xl border border-slate-300 px-3 font-bold" />
          </label>
          <label className="block text-xs font-extrabold text-slate-600">
            標準入場
            <input value={entryTime} onChange={(event) => setEntryTime(event.target.value)} className="mt-1 w-full h-10 rounded-xl border border-slate-300 px-3 font-bold" />
          </label>
        </div>
        {error && <p className="mt-3 text-sm font-bold text-rose-700">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 px-4 rounded-xl border border-slate-300 font-extrabold text-sm">
            キャンセル
          </button>
          <button type="submit" disabled={saving} className="h-10 px-4 rounded-xl bg-[#121826] text-white font-extrabold text-sm disabled:opacity-50">
            {saving ? '保存中...' : '登録して配車に入れる'}
          </button>
        </div>
      </form>
    </div>
  );
}
