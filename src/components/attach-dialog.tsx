'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Attachment = { id: string; file_name: string; storage_path: string };

export default function AttachDialog({
  companyId,
  dispatchId,
  onClose,
}: {
  companyId: string;
  dispatchId: string;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase
      .from('dispatch_attachments')
      .select('id, file_name, storage_path')
      .eq('dispatch_id', dispatchId)
      .order('created_at', { ascending: false });
    if (error) {
      setMessage('添付一覧を読めません。Supabase で supabase/dispatch_attachments.sql を実行してください。');
      return;
    }
    setFiles((data || []) as Attachment[]);
  }

  useEffect(() => {
    load();
  }, [dispatchId]);

  async function upload(list: FileList | File[]) {
    const batch = Array.from(list);
    if (!batch.length) return;
    setBusy(true);
    setMessage('');
    for (const file of batch) {
      const path = `${companyId}/${dispatchId}/${Date.now()}-${file.name}`;
      const stored = await supabase.storage.from('dispatch-files').upload(path, file, { upsert: false });
      if (stored.error) {
        setMessage(stored.error.message || 'ファイルを保存できません。SQL を実行してください。');
        setBusy(false);
        return;
      }
      const inserted = await supabase.from('dispatch_attachments').insert({
        company_id: companyId,
        dispatch_id: dispatchId,
        file_name: file.name,
        storage_path: path,
      });
      if (inserted.error) {
        setMessage(inserted.error.message);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setMessage(`${batch.length}件を添付しました`);
    load();
  }

  async function openFile(item: Attachment) {
    const signed = await supabase.storage.from('dispatch-files').createSignedUrl(item.storage_path, 60 * 10);
    if (signed.error || !signed.data?.signedUrl) {
      setMessage(signed.error?.message || 'ファイルを開けません');
      return;
    }
    window.open(signed.data.signedUrl, '_blank', 'noopener');
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-900">添付</h2>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-bold">
            閉じる
          </button>
        </div>
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            upload(event.dataTransfer.files);
          }}
          className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center"
        >
          <p className="text-sm font-bold text-slate-700">PDFなどをここにドロップ</p>
          <label className="mt-3 inline-block cursor-pointer rounded-lg bg-[#121826] px-4 py-2 text-sm font-bold text-white">
            ファイルを選ぶ
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) upload(event.target.files);
                event.target.value = '';
              }}
            />
          </label>
        </div>
        {message && <p className="mt-3 text-sm font-bold text-amber-800">{message}</p>}
        <ul className="mt-3 space-y-1">
          {files.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => openFile(item)} className="text-sm font-bold text-teal-800 hover:underline">
                {item.file_name}
              </button>
            </li>
          ))}
          {!files.length && !busy && <li className="text-xs font-bold text-slate-400">まだ添付はありません</li>}
        </ul>
      </div>
    </div>
  );
}
