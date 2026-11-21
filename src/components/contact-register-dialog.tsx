'use client';

import React, { useEffect, useState } from 'react';
import { nextMasterCode } from '@/lib/next-code';
import { supabase } from '@/lib/supabase';

export type ContactDraft = {
  rowId: string;
  customerCode: string;
  customerName: string;
};

type CreatedContact = {
  id: string;
  code: string;
  name: string;
  tel: string;
  customer_code: string;
  customer_name: string;
};

type Props = {
  companyId: string;
  draft: ContactDraft;
  onClose: () => void;
  onCreated: (contact: CreatedContact) => void;
};

export default function ContactRegisterDialog({ companyId, draft, onClose, onCreated }: Props) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [tel, setTel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    nextMasterCode('customer_contacts', companyId)
      .then((next) => {
        if (!cancelled) setCode(next);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || '担当者コードを作れません');
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function save() {
    const personName = name.trim();
    if (!personName) {
      setError('担当者名は必須です');
      return;
    }
    setSaving(true);
    setError('');
    const personCode = code || (await nextMasterCode('customer_contacts', companyId));
    const payload = {
      company_id: companyId,
      code: personCode,
      name: personName,
      tel: tel.trim() || null,
      customer_code: draft.customerCode || null,
      customer_name: draft.customerName || null,
    };
    const { data, error: saveError } = await supabase
      .from('customer_contacts')
      .insert(payload)
      .select('id, code, name, tel')
      .single();
    setSaving(false);
    if (saveError || !data) {
      setError(saveError?.message || '担当者を保存できません');
      return;
    }
    onCreated({
      id: data.id,
      code: data.code,
      name: data.name,
      tel: data.tel || '',
      customer_code: draft.customerCode,
      customer_name: draft.customerName,
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
      <form
        className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 className="text-xl font-extrabold">担当者を登録</h2>
        <p className="mt-1 text-sm font-bold text-slate-600">
          {draft.customerName || '得意先未入力'} の担当者として、担当者マスタに追加します。
        </p>
        <label className="block mt-4 text-xs font-extrabold text-slate-600">
          担当者コード
          <input value={code} onChange={(event) => setCode(event.target.value)} className="mt-1 w-full h-11 rounded-xl border border-slate-300 px-3 font-bold" />
        </label>
        <label className="block mt-3 text-xs font-extrabold text-slate-600">
          担当者名
          <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full h-11 rounded-xl border border-slate-300 px-3 font-bold" />
        </label>
        <label className="block mt-3 text-xs font-extrabold text-slate-600">
          携帯番号
          <input value={tel} onChange={(event) => setTel(event.target.value)} className="mt-1 w-full h-11 rounded-xl border border-slate-300 px-3 font-bold" />
        </label>
        {error && <p className="mt-3 text-sm font-bold text-rose-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-11 px-4 rounded-xl border border-slate-300 font-bold">
            キャンセル
          </button>
          <button type="submit" disabled={saving} className="h-11 px-4 rounded-xl bg-teal-700 text-white font-extrabold disabled:opacity-50">
            {saving ? '保存中...' : '登録する'}
          </button>
        </div>
      </form>
    </div>
  );
}
