'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, Upload } from 'lucide-react';
import type { ParsedSheet, TableName } from '@/lib/master-import';

type PreviewSheet = Omit<ParsedSheet, 'rows'>;

type PreviewResponse = {
  filename: string;
  sheets: PreviewSheet[];
  error?: string;
};

type CommitResult = {
  table: TableName;
  label: string;
  saved: number;
  skippedNoCode: number;
  duplicateCodes: number;
  error?: string;
};

type StatusResponse = {
  ok: boolean;
  message?: string;
  sql?: string;
};

const SAMPLE_LIMIT = 6;

function isImportable(sheet: PreviewSheet): boolean {
  return Boolean(sheet.table) && !sheet.error && sheet.importable > 0;
}

export default function ImportClient() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selected, setSelected] = useState<TableName[]>([]);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [message, setMessage] = useState('');
  const [results, setResults] = useState<CommitResult[] | null>(null);
  const [sqlCopied, setSqlCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/import/status')
      .then((response) => response.json())
      .then((body: StatusResponse) => {
        if (!cancelled) setStatus(body);
      })
      .catch(() => {
        if (!cancelled) setStatus({ ok: false, message: '接続確認に失敗しました' });
      });
    return () => {
      cancelled = true;
    };
  }, [results]);

  const importableSheets = useMemo(
    () => (preview?.sheets ?? []).filter(isImportable),
    [preview]
  );

  async function previewFile(nextFile: File) {
    setFile(nextFile);
    setResults(null);
    setMessage('');
    setBusy('preview');
    const form = new FormData();
    form.set('file', nextFile);
    const response = await fetch('/api/import/preview', { method: 'POST', body: form });
    const body = (await response.json()) as PreviewResponse;
    setBusy(null);
    if (!response.ok || body.error) {
      setPreview(null);
      setMessage(body.error || 'プレビューに失敗しました');
      return;
    }
    setPreview(body);
    setSelected(body.sheets.filter(isImportable).map((sheet) => sheet.table as TableName));
  }

  function toggle(table: TableName) {
    setSelected((current) =>
      current.includes(table) ? current.filter((item) => item !== table) : [...current, table]
    );
  }

  async function commit() {
    if (!file || selected.length === 0) return;
    const total = importableSheets
      .filter((sheet) => selected.includes(sheet.table as TableName))
      .reduce((sum, sheet) => sum + sheet.importable, 0);
    if (!window.confirm(`${total.toLocaleString()}件を取り込みます。同じコードの既存データは上書きされます。`)) {
      return;
    }
    setBusy('commit');
    setMessage('');
    const form = new FormData();
    form.set('file', file);
    form.set('tables', selected.join(','));
    const response = await fetch('/api/import/commit', { method: 'POST', body: form });
    const body = await response.json();
    setBusy(null);
    if (body.needsGrant) setStatus((current) => ({ ...(current ?? { ok: false }), ok: false }));
    if (!response.ok && !body.results) {
      setMessage(body.error || '取り込みに失敗しました');
      return;
    }
    setResults(body.results ?? []);
    if (body.error) setMessage(body.error);
  }

  async function copySql() {
    if (!status?.sql) return;
    await navigator.clipboard.writeText(status.sql);
    setSqlCopied(true);
    setTimeout(() => setSqlCopied(false), 2000);
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-[#121826] text-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-teal-600 flex items-center justify-center font-black text-slate-950">
              CP
            </span>
            <span>
              <span className="block font-extrabold leading-none">クレーンPRO</span>
              <span className="block text-[11px] text-slate-400 mt-1">マスタ一括取込</span>
            </span>
          </a>
          <a href="/" className="text-sm font-bold text-slate-200 hover:text-white">
            配車ボードへ戻る
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">マスタ一括取込</h1>
          <p className="text-sm text-slate-600 mt-1 leading-relaxed">
            取引先・現場・オペレータ・機種・商品の CSV または Excel を取り込みます。
            クレーンPRO.xlsx の「取引先マスタ」「現場マスタ」「オペレータマスタ」「機種マスタ」「商品マスタ」を自動で判別し、同じコードは更新、新しいコードは追加します。
          </p>
        </div>

        {status && !status.ok && (
          <section className="bg-amber-50 border border-amber-300 rounded-2xl p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h2 className="font-extrabold text-amber-950">Supabase の権限がまだありません</h2>
                <p className="text-sm text-amber-950 mt-1 leading-relaxed">
                  公開キーではマスタを読めません。Supabase の SQL Editor で
                  <code className="mx-1 px-1.5 py-0.5 rounded bg-white border border-amber-200">supabase/enable_master_access.sql</code>
                  を1回実行してから、取り込みを始めてください。
                </p>
                {status.message && (
                  <p className="text-xs text-amber-800 mt-2 break-all">{status.message}</p>
                )}
                {status.sql && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={copySql}
                      className="px-3 py-1.5 rounded-lg bg-amber-900 text-white text-xs font-bold"
                    >
                      {sqlCopied ? 'コピーしました' : 'SQLをコピー'}
                    </button>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-xl bg-white border border-amber-200 p-3 text-[11px] leading-relaxed text-slate-700">
                      {status.sql}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        <section className="bg-white border border-slate-200 rounded-2xl p-4 md:p-5 shadow-sm">
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-2xl px-4 py-8 text-center cursor-pointer hover:border-teal-600 hover:bg-teal-50/40">
            <Upload className="w-7 h-7 text-teal-700" />
            <span className="font-extrabold">CSV または Excel（.xlsx）を選択</span>
            <span className="text-xs text-slate-500">複数シートの Excel からは、5つのマスタシートだけを取り込みます</span>
            <input
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(event) => {
                const next = event.target.files?.[0];
                if (next) void previewFile(next);
              }}
            />
          </label>
          {file && (
            <p className="mt-3 text-sm font-bold text-slate-700 flex items-center gap-2">
              <FileUp className="w-4 h-4" />
              {file.name}
              {busy === 'preview' && <span className="font-medium text-slate-500">読み込み中...</span>}
            </p>
          )}
          {message && <p className="mt-3 text-sm font-bold text-rose-700">{message}</p>}
        </section>

        {preview && (
          <section className="space-y-4">
            {importableSheets.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-bold text-slate-700">取り込むマスタにチェックを入れて実行します。</p>
                <button
                  type="button"
                  disabled={busy !== null || selected.length === 0}
                  onClick={() => void commit()}
                  className="px-4 py-2.5 rounded-xl bg-teal-700 text-white font-extrabold text-sm disabled:opacity-50"
                >
                  {busy === 'commit' ? '取り込み中...' : '選択したマスタを取り込む'}
                </button>
              </div>
            )}

            {preview.sheets.some((sheet) => sheet.error?.includes('対象外')) && (
              <p className="text-xs text-slate-500">
                対象外のシート: {preview.sheets.filter((sheet) => sheet.error?.includes('対象外')).map((sheet) => sheet.sheetName).join('、')}
              </p>
            )}

            {preview.sheets.filter((sheet) => !sheet.error?.includes('対象外')).map((sheet) => (
              <article key={`${sheet.sheetName}-${sheet.table ?? 'skip'}`} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {isImportable(sheet) && (
                      <input
                        type="checkbox"
                        checked={selected.includes(sheet.table as TableName)}
                        onChange={() => toggle(sheet.table as TableName)}
                        className="w-4 h-4 accent-teal-700"
                        aria-label={`${sheet.label}を取り込む`}
                      />
                    )}
                    <div>
                      <h2 className="font-extrabold">{sheet.label}</h2>
                      <p className="text-xs text-slate-500">{sheet.sheetName}</p>
                    </div>
                  </div>
                  {sheet.error ? (
                    <span className="text-xs font-bold text-slate-500">{sheet.error}</span>
                  ) : (
                    <p className="text-sm font-bold text-slate-700">
                      取込 {sheet.importable.toLocaleString()}件
                      {sheet.skippedNoCode > 0 && ` / コードなし ${sheet.skippedNoCode}件`}
                      {sheet.duplicateCodes > 0 && ` / ファイル内の重複 ${sheet.duplicateCodes}件は後の行を採用`}
                    </p>
                  )}
                </div>

                {!sheet.error && sheet.sample.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-sky-50 text-left text-xs font-extrabold text-slate-700">
                          {sheet.mapped.slice(0, SAMPLE_LIMIT).map((column) => (
                            <th key={column.column} className="px-3 py-2 whitespace-nowrap">
                              {column.header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sheet.sample.map((row, index) => (
                          <tr key={`${row.code ?? index}`} className="border-t border-slate-100">
                            {sheet.mapped.slice(0, SAMPLE_LIMIT).map((column) => (
                              <td key={column.column} className="px-3 py-2 whitespace-nowrap max-w-[240px] truncate">
                                {formatCell(row[column.column])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {!sheet.error && sheet.unmapped.length > 0 && (
                  <p className="px-4 py-3 text-xs text-slate-500 border-t border-slate-100 leading-relaxed">
                    データベースに対応する列が無いため保存しない項目: {sheet.unmapped.join('、')}
                  </p>
                )}
                {sheet.warnings.length > 0 && (
                  <ul className="px-4 py-3 text-xs text-amber-800 border-t border-slate-100 space-y-1">
                    {sheet.warnings.slice(0, 8).map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </section>
        )}

        {results && (
          <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <h2 className="font-extrabold flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-teal-700" />
              取り込み結果
            </h2>
            <ul className="mt-3 space-y-2">
              {results.map((result) => (
                <li key={result.table} className="text-sm">
                  <span className="font-extrabold">{result.label}</span>
                  <span className="ml-2">{result.saved.toLocaleString()}件を保存</span>
                  {result.error && <span className="block text-rose-700 font-bold mt-1">{result.error}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

function formatCell(value: string | number | boolean | null | undefined): string {
  if (value == null || value === '') return '';
  if (typeof value === 'boolean') return value ? 'はい' : 'いいえ';
  return String(value);
}
