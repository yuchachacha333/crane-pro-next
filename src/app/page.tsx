'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Printer,
  FileText,
  Copy,
  ClipboardPaste,
  Trash2,
  CheckCircle2,
  Clock,
  Truck,
  Users,
  MapPin,
  Receipt,
  AlertTriangle,
  Search,
  X,
  Save,
  Building2,
  Wrench,
} from 'lucide-react';
import { supabase, getDefaultCompanyId } from '@/lib/supabase';
import {
  getWeekday,
  formatJapaneseMonthDay,
  shiftIsoDate,
  getTodayIso,
  getRokuyo,
  calculateWorkHours,
  getMachineBadgeColor,
} from '@/lib/crane-utils';

interface DispatchRecord {
  id: string;
  company_id: string;
  work_date: string;
  shift_type: string;
  customer_code: string;
  customer_name: string;
  site_code: string;
  site_name: string;
  requested_model: string;
  assigned_product: string;
  operator_code: string;
  operator_name: string;
  entry_time: string;
  start_time: string;
  end_time: string;
  work_hours: number | null;
  unit_price: number | null;
  total_sales_amount: number | null;
  notes: string;
  supplier_code: string;
  supplier_name: string;
  is_dispatched: boolean;
  is_cancelled: boolean;
  contact_code: string;
  contact_name: string;
  contact_tel: string;
  received_date: string;
  end_client_name: string;
  work_location: string;
  prime_contractor: string;
  site_address: string;
}

interface ExtraLine {
  id?: string;
  item_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  amount: number;
  notes: string;
}

export default function CraneProApp() {
  const [companyId, setCompanyId] = useState<string>('');
  const [boardDate, setBoardDate] = useState<string>(getTodayIso());
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all');
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [toastMsg, setToastMsg] = useState<string>('');

  // コピー＆ペースト用クリップボード
  const [copiedRow, setCopiedRow] = useState<Partial<DispatchRecord> | null>(null);

  // 詳細モーダル用ステート
  const [selectedJob, setSelectedJob] = useState<DispatchRecord | null>(null);
  const [jobTab, setJobTab] = useState<'sales' | 'hire' | 'operator'>('sales');
  const [extras, setExtras] = useState<ExtraLine[]>([]);
  const [savingJob, setSavingJob] = useState<boolean>(false);

  // マスタ選択肢キャッシュ
  const [customers, setCustomers] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 2600);
  };

  // 初期データ（会社ID・マスタ類）の読み込み
  useEffect(() => {
    async function init() {
      try {
        const cid = await getDefaultCompanyId();
        setCompanyId(cid);

        const [custRes, siteRes, opRes, modRes] = await Promise.all([
          supabase.from('customers').select('*').eq('company_id', cid).order('search_word', { ascending: true }),
          supabase.from('sites').select('*').eq('company_id', cid).order('name', { ascending: true }),
          supabase.from('operators').select('*').eq('company_id', cid).order('sort_order', { ascending: true }),
          supabase.from('machine_models').select('*').eq('company_id', cid).order('sort_order', { ascending: true }),
        ]);

        if (custRes.data) setCustomers(custRes.data);
        if (siteRes.data) setSites(siteRes.data);
        if (opRes.data) setOperators(opRes.data);
        if (modRes.data) setModels(modRes.data);
      } catch (err: any) {
        showToast(err.message || '初期データの読み込みに失敗しました');
      }
    }
    init();
  }, []);

  // 指定日の配車データ取得
  const fetchDispatches = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('dispatches')
      .select('*')
      .eq('company_id', companyId)
      .eq('work_date', boardDate)
      .order('entry_time', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      showToast('配車データの取得に失敗しました: ' + error.message);
    } else {
      setDispatches(data || []);
    }
    setLoading(false);
  }, [companyId, boardDate]);

  useEffect(() => {
    fetchDispatches();
  }, [fetchDispatches]);

  // 新規配車行の追加
  const handleAddRow = async () => {
    if (!companyId) return;
    const newRow = {
      company_id: companyId,
      work_date: boardDate,
      shift_type: '昼',
      customer_code: '',
      customer_name: '',
      site_code: '',
      site_name: '',
      requested_model: '',
      assigned_product: '',
      operator_code: '',
      operator_name: '',
      entry_time: '8:00',
      start_time: '8:00',
      end_time: '17:00',
      work_hours: 8,
      notes: '',
      supplier_code: '',
      supplier_name: '',
      is_dispatched: false,
      is_cancelled: false,
      received_date: getTodayIso(),
    };

    const { data, error } = await supabase.from('dispatches').insert(newRow).select().single();
    if (error) {
      showToast('追加エラー: ' + error.message);
    } else if (data) {
      setDispatches((prev) => [...prev, data]);
      showToast('新規配車行を追加しました');
    }
  };

  // 行のインライン更新（オートセーブ）
  const handleUpdateField = async (id: string, patch: Partial<DispatchRecord>) => {
    // 画面状態を即座に反映
    setDispatches((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const updated = { ...row, ...patch };
        // 配車済みフラグの自動判定
        const hasCrewOrMachine = Boolean(
          updated.operator_name?.trim() ||
            updated.supplier_name?.trim() ||
            updated.requested_model?.trim()
        );
        updated.is_dispatched = !updated.is_cancelled && hasCrewOrMachine;
        patch.is_dispatched = updated.is_dispatched;
        return updated;
      })
    );

    const { error } = await supabase.from('dispatches').update(patch).eq('id', id);
    if (error) {
      showToast('保存エラー: ' + error.message);
    }
  };

  // 行の削除
  const handleDeleteRow = async (id: string) => {
    if (!window.confirm('この配車行を削除しますか？')) return;
    const { error } = await supabase.from('dispatches').delete().eq('id', id);
    if (error) {
      showToast('削除エラー: ' + error.message);
    } else {
      setDispatches((prev) => prev.filter((r) => r.id !== id));
      showToast('行を削除しました');
    }
  };

  // コピー＆貼り付け
  const handleCopyRow = (row: DispatchRecord) => {
    const { id, created_at, ...rest } = row as any;
    setCopiedRow(rest);
    showToast(`「${row.site_name || row.customer_name || '選択行'}」をコピーしました`);
  };

  const handlePasteRow = async () => {
    if (!copiedRow || !companyId) {
      showToast('先にコピーしたい行の「コピー」ボタンを押してください');
      return;
    }
    const payload = {
      ...copiedRow,
      company_id: companyId,
      work_date: boardDate,
      received_date: getTodayIso(),
    };
    const { data, error } = await supabase.from('dispatches').insert(payload).select().single();
    if (error) {
      showToast('貼り付けエラー: ' + error.message);
    } else if (data) {
      setDispatches((prev) => [...prev, data]);
      showToast(`${formatJapaneseMonthDay(boardDate)} に貼り付けました`);
    }
  };

  // 詳細モーダルを開く（付帯売上明細も取得）
  const openJobModal = async (job: DispatchRecord) => {
    setSelectedJob({ ...job });
    setJobTab('sales');
    const { data } = await supabase
      .from('dispatch_extras')
      .select('*')
      .eq('dispatch_id', job.id)
      .order('sort_order', { ascending: true });

    const loaded = (data || []).map((d) => ({
      id: d.id,
      item_name: d.item_name || '',
      quantity: Number(d.quantity ?? 1),
      unit: d.unit || '',
      unit_price: Number(d.unit_price ?? 0),
      amount: Number(d.amount ?? 0),
      notes: d.notes || '',
    }));
    while (loaded.length < 3) {
      loaded.push({ item_name: '', quantity: 1, unit: '', unit_price: 0, amount: 0, notes: '' });
    }
    setExtras(loaded);
  };

  // 詳細モーダルの保存
  const saveJobModal = async () => {
    if (!selectedJob || !companyId) return;
    setSavingJob(true);

    const basePrice = Number(selectedJob.unit_price || 0);
    const validExtras = extras.filter((e) => e.item_name.trim() !== '' || e.notes.trim() !== '');
    const extraTotal = validExtras.reduce((sum, e) => sum + Number(e.quantity || 0) * Number(e.unit_price || 0), 0);
    const grandTotal = basePrice + extraTotal;

    const updatePayload = {
      work_date: selectedJob.work_date,
      entry_time: selectedJob.entry_time,
      start_time: selectedJob.start_time,
      end_time: selectedJob.end_time,
      work_hours: selectedJob.work_hours,
      unit_price: selectedJob.unit_price,
      total_sales_amount: grandTotal > 0 ? grandTotal : selectedJob.unit_price,
      site_name: selectedJob.site_name,
      site_address: selectedJob.site_address,
      contact_name: selectedJob.contact_name,
      contact_tel: selectedJob.contact_tel,
      notes: selectedJob.notes,
      end_client_name: selectedJob.end_client_name,
      work_location: selectedJob.work_location,
      prime_contractor: selectedJob.prime_contractor,
    };

    const { error } = await supabase.from('dispatches').update(updatePayload).eq('id', selectedJob.id);

    // 付帯売上明細の入れ替え保存
    await supabase.from('dispatch_extras').delete().eq('dispatch_id', selectedJob.id);
    if (validExtras.length > 0) {
      await supabase.from('dispatch_extras').insert(
        validExtras.map((e, idx) => ({
          company_id: companyId,
          dispatch_id: selectedJob.id,
          item_name: e.item_name,
          quantity: Number(e.quantity || 0),
          unit: e.unit,
          unit_price: Number(e.unit_price || 0),
          amount: Number(e.quantity || 0) * Number(e.unit_price || 0),
          notes: e.notes,
          sort_order: idx,
        }))
      );
    }

    setSavingJob(false);
    if (error) {
      showToast('保存エラー: ' + error.message);
    } else {
      showToast('詳細と売上データを保存しました');
      setSelectedJob(null);
      fetchDispatches();
    }
  };

  // フィルタリング集計
  const counts = {
    all: dispatches.length,
    open: dispatches.filter((d) => !d.is_dispatched && !d.is_cancelled).length,
    done: dispatches.filter((d) => d.is_dispatched && !d.is_cancelled).length,
  };

  const filteredDispatches = dispatches.filter((d) => {
    if (filter === 'open') return !d.is_dispatched && !d.is_cancelled;
    if (filter === 'done') return d.is_dispatched && !d.is_cancelled;
    return true;
  });

  const rokuyoLabel = getRokuyo(boardDate);
  const weekdayLabel = getWeekday(boardDate);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col md:flex-row font-sans">
      {/* トースト通知 */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white px-5 py-3 rounded-full shadow-xl text-sm font-bold flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-teal-400" />
          {toastMsg}
        </div>
      )}

      {/* 左サイドバー（PC用） */}
      <aside className="hidden md:flex md:w-60 md:flex-col bg-[#121826] text-slate-100 p-4 shrink-0 sticky top-0 h-screen">
        <div className="flex items-center gap-3 px-2 py-3 border-b border-slate-800">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-teal-600 flex items-center justify-center font-black text-slate-950 shadow">
            CP
          </div>
          <div>
            <div className="font-extrabold text-lg tracking-tight leading-none">クレーンPRO</div>
            <div className="text-[11px] text-slate-400 mt-1">Next.js + Supabase Cloud</div>
          </div>
        </div>

        <nav className="mt-6 flex-1 space-y-1">
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-teal-600/20 text-teal-300 font-bold text-sm">
            <Calendar className="w-4 h-4" />
            配車ボード
          </button>
          <button
            onClick={() => showToast('請求書出力画面はステップ3で追加します')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-300 hover:bg-slate-800/70 font-medium text-sm transition"
          >
            <Receipt className="w-4 h-4" />
            請求・締め集計
          </button>
          <button
            onClick={() => showToast('マスタ管理画面はステップ3で追加します')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-300 hover:bg-slate-800/70 font-medium text-sm transition"
          >
            <Building2 className="w-4 h-4" />
            取引先・現場マスタ
          </button>
          <button
            onClick={() => showToast('車両・車検アラート画面はステップ3で追加します')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-300 hover:bg-slate-800/70 font-medium text-sm transition"
          >
            <Truck className="w-4 h-4" />
            車両・オペレーター
          </button>
          <a
            href="/import"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-300 hover:bg-slate-800/70 font-medium text-sm transition"
          >
            <FileText className="w-4 h-4" />
            マスタ一括取込
          </a>
        </nav>

        <div className="p-3 rounded-xl bg-slate-800/60 text-xs text-slate-400 leading-relaxed">
          入力内容はリアルタイムでクラウド（Supabase）へ自動保存されます。
        </div>
      </aside>

      {/* メインコンテンツ */}
      <main className="flex-1 min-w-0 p-4 md:p-6 pb-24">
        {/* 上部アクションバー */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">配車管理ボード</h1>
            <p className="text-xs md:text-sm text-slate-500 mt-0.5">
              オペレーターと庸車は排他連動・作業時間は昼休憩1時間を自動控除します
            </p>
            <a href="/import" className="md:hidden inline-flex mt-2 text-sm font-bold text-teal-800">
              マスタ一括取込
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {copiedRow && (
              <button
                onClick={handlePasteRow}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-amber-100 text-amber-900 border border-amber-300 font-bold text-sm hover:bg-amber-200 transition"
              >
                <ClipboardPaste className="w-4 h-4" />
                コピー行を貼り付け
              </button>
            )}
            <button
              onClick={handleAddRow}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#121826] text-white font-bold text-sm shadow-sm hover:bg-slate-800 transition"
            >
              <Plus className="w-4 h-4" />
              新規配車行追加
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white text-slate-700 border border-slate-300 font-bold text-sm hover:bg-slate-50 transition"
            >
              <Printer className="w-4 h-4" />
              印刷
            </button>
          </div>
        </div>

        {/* 日付・曜日・六曜ナビゲーションバー */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 md:p-4 mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBoardDate(shiftIsoDate(boardDate, -1))}
              className="w-11 h-12 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-700"
              aria-label="前日"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>

            <div className="flex items-baseline gap-3 px-4 py-2 rounded-xl bg-sky-50 border border-sky-200">
              <span className="text-2xl md:text-3xl font-black text-slate-900">
                {formatJapaneseMonthDay(boardDate)}
              </span>
              <span className="text-base md:text-lg font-bold text-sky-900">
                （{weekdayLabel}）
              </span>
              {rokuyoLabel && (
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs md:text-sm font-extrabold ${
                    rokuyoLabel === '大安'
                      ? 'bg-rose-100 text-rose-800'
                      : rokuyoLabel === '仏滅'
                      ? 'bg-slate-200 text-slate-700'
                      : 'bg-white text-sky-900 border border-sky-200'
                  }`}
                >
                  {rokuyoLabel}
                </span>
              )}
            </div>

            <button
              onClick={() => setBoardDate(shiftIsoDate(boardDate, 1))}
              className="w-11 h-12 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-700"
              aria-label="翌日"
            >
              <ChevronRight className="w-6 h-6" />
            </button>

            <button
              onClick={() => setBoardDate(getTodayIso())}
              className="px-3.5 h-12 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-bold text-slate-700"
            >
              今日
            </button>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="date"
              value={boardDate}
              onChange={(e) => e.target.value && setBoardDate(e.target.value)}
              className="h-11 px-3 rounded-xl border border-slate-300 bg-white font-bold text-sm text-slate-800"
            />
          </div>
        </div>

        {/* ステータス絞り込みタブ */}
        <div className="flex items-center gap-2 mb-4">
          {[
            { key: 'all', label: `すべて ${counts.all}` },
            { key: 'open', label: `未配車 ${counts.open}` },
            { key: 'done', label: `配車済み ${counts.done}` },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key as any)}
              className={`px-4 py-2 rounded-full text-sm font-bold transition ${
                filter === tab.key
                  ? 'bg-[#121826] text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* コンテンツ本体 */}
        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 font-bold">
            データベースから読み込み中...
          </div>
        ) : filteredDispatches.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
            <p className="text-slate-500 font-bold mb-4">この日の配車データはまだありません。</p>
            <button
              onClick={handleAddRow}
              className="inline-flex items-center gap-1.5 px-5 py-3 rounded-xl bg-teal-700 text-white font-bold text-sm hover:bg-teal-800 transition"
            >
              <Plus className="w-4 h-4" />
              最初の1行を追加する
            </button>
          </div>
        ) : (
          <>
            {/* PC用スプレッドシート風・高機能配車テーブル */}
            <div className="hidden lg:block bg-white rounded-2xl border border-slate-300 shadow-sm overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-sky-100/80 border-b-2 border-sky-300 text-slate-800 text-xs font-extrabold">
                    <th className="p-2.5 border-r border-slate-200 w-36">操作</th>
                    <th className="p-2.5 border-r border-slate-200 w-36">オペレーター</th>
                    <th className="p-2.5 border-r border-slate-200 w-40">庸車（仕入先）</th>
                    <th className="p-2.5 border-r border-slate-200 w-48">得意先</th>
                    <th className="p-2.5 border-r border-slate-200 w-56">現場名</th>
                    <th className="p-2.5 border-r border-slate-200 w-36">受付機種</th>
                    <th className="p-2.5 border-r border-slate-200 w-20 text-center">昼夜</th>
                    <th className="p-2.5 border-r border-slate-200 w-24">入場</th>
                    <th className="p-2.5 border-r border-slate-200 min-w-[160px]">備考</th>
                    <th className="p-2.5 border-r border-slate-200 w-16 text-center">取消</th>
                    <th className="p-2.5 w-14 text-center">削除</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {filteredDispatches.map((row, idx) => {
                    const hasOp = Boolean(row.operator_name?.trim());
                    const hasSup = Boolean(row.supplier_name?.trim());
                    const badgeColor = getMachineBadgeColor(row.requested_model);

                    return (
                      <tr
                        key={row.id}
                        className={`transition ${
                          row.is_cancelled
                            ? 'bg-rose-50/60 text-slate-400'
                            : idx % 2 === 1
                            ? 'bg-sky-50/30 hover:bg-teal-50/40'
                            : 'bg-white hover:bg-teal-50/40'
                        }`}
                      >
                        {/* 操作ボタン */}
                        <td className="p-1.5 border-r border-slate-200 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-bold text-slate-400 w-4 text-center">
                              {idx + 1}
                            </span>
                            <button
                              onClick={() => openJobModal(row)}
                              className="px-2 py-1.5 rounded-lg bg-teal-50 text-teal-800 border border-teal-200 font-bold text-xs hover:bg-teal-100"
                            >
                              詳細・売上
                            </button>
                            <button
                              onClick={() => handleCopyRow(row)}
                              title="この行をコピー"
                              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>

                        {/* オペレーター（庸車が入っている場合はロック） */}
                        <td className="p-0 border-r border-slate-200">
                          <input
                            type="text"
                            disabled={hasSup && !hasOp}
                            value={row.operator_name || ''}
                            placeholder={hasSup ? '庸車指定中' : 'オペ入力'}
                            onChange={(e) => {
                              const val = e.target.value;
                              handleUpdateField(row.id, {
                                operator_name: val,
                                ...(val ? { supplier_name: '', supplier_code: '' } : {}),
                              });
                            }}
                            className="w-full h-11 px-2.5 bg-transparent font-bold focus:bg-white focus:ring-2 focus:ring-teal-600 outline-none disabled:bg-slate-100 disabled:text-slate-400"
                          />
                        </td>

                        {/* 庸車（オペレーターが入っている場合はロック） */}
                        <td className="p-0 border-r border-slate-200">
                          <input
                            type="text"
                            disabled={hasOp && !hasSup}
                            value={row.supplier_name || ''}
                            placeholder={hasOp ? '自社オペ中' : '庸車先入力'}
                            onChange={(e) => {
                              const val = e.target.value;
                              handleUpdateField(row.id, {
                                supplier_name: val,
                                ...(val ? { operator_name: '', operator_code: '' } : {}),
                              });
                            }}
                            className="w-full h-11 px-2.5 bg-transparent font-bold focus:bg-white focus:ring-2 focus:ring-teal-600 outline-none disabled:bg-slate-100 disabled:text-slate-400"
                          />
                        </td>

                        {/* 得意先 */}
                        <td className="p-0 border-r border-slate-200">
                          <input
                            type="text"
                            value={row.customer_name || ''}
                            placeholder="得意先名"
                            onChange={(e) =>
                              handleUpdateField(row.id, { customer_name: e.target.value })
                            }
                            className="w-full h-11 px-2.5 bg-transparent font-bold focus:bg-white focus:ring-2 focus:ring-teal-600 outline-none"
                          />
                        </td>

                        {/* 現場名 */}
                        <td className="p-0 border-r border-slate-200">
                          <input
                            type="text"
                            value={row.site_name || ''}
                            placeholder="現場名"
                            onChange={(e) =>
                              handleUpdateField(row.id, { site_name: e.target.value })
                            }
                            className="w-full h-11 px-2.5 bg-transparent font-bold focus:bg-white focus:ring-2 focus:ring-teal-600 outline-none"
                          />
                        </td>

                        {/* 受付機種 */}
                        <td className="p-1 border-r border-slate-200">
                          <input
                            type="text"
                            value={row.requested_model || ''}
                            placeholder="機種"
                            onChange={(e) =>
                              handleUpdateField(row.id, { requested_model: e.target.value })
                            }
                            className={`w-full h-9 px-2 rounded-lg border font-extrabold text-xs outline-none focus:ring-2 focus:ring-teal-600 ${badgeColor}`}
                          />
                        </td>

                        {/* 昼夜 */}
                        <td className="p-0 border-r border-slate-200">
                          <select
                            value={row.shift_type || '昼'}
                            onChange={(e) =>
                              handleUpdateField(row.id, { shift_type: e.target.value })
                            }
                            className="w-full h-11 px-2 bg-transparent font-bold text-center outline-none"
                          >
                            <option value="昼">昼</option>
                            <option value="夜">夜</option>
                          </select>
                        </td>

                        {/* 入場時間 */}
                        <td className="p-0 border-r border-slate-200">
                          <input
                            type="text"
                            value={row.entry_time || ''}
                            placeholder="8:00"
                            onChange={(e) =>
                              handleUpdateField(row.id, { entry_time: e.target.value })
                            }
                            className="w-full h-11 px-2.5 bg-transparent font-bold text-center focus:bg-white focus:ring-2 focus:ring-teal-600 outline-none"
                          />
                        </td>

                        {/* 備考 */}
                        <td className="p-0 border-r border-slate-200">
                          <input
                            type="text"
                            value={row.notes || ''}
                            placeholder="備考"
                            onChange={(e) =>
                              handleUpdateField(row.id, { notes: e.target.value })
                            }
                            className="w-full h-11 px-2.5 bg-transparent focus:bg-white focus:ring-2 focus:ring-teal-600 outline-none"
                          />
                        </td>

                        {/* キャンセル */}
                        <td className="p-0 border-r border-slate-200 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(row.is_cancelled)}
                            onChange={(e) =>
                              handleUpdateField(row.id, { is_cancelled: e.target.checked })
                            }
                            className="w-4 h-4 accent-rose-600 cursor-pointer"
                          />
                        </td>

                        {/* 削除 */}
                        <td className="p-0 text-center">
                          <button
                            onClick={() => handleDeleteRow(row.id)}
                            className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg"
                            title="削除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* スマホ・タブレット用 現場カード一覧 */}
            <div className="lg:hidden space-y-3">
              {filteredDispatches.map((row, idx) => (
                <div
                  key={row.id}
                  className={`rounded-2xl border p-4 shadow-sm ${
                    row.is_cancelled
                      ? 'bg-rose-50/70 border-rose-200'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <span className="inline-block text-xs font-extrabold text-slate-400 mr-2">
                        #{idx + 1}
                      </span>
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${getMachineBadgeColor(
                          row.requested_model
                        )}`}
                      >
                        {row.requested_model || '機種未定'}
                      </span>
                      <span className="ml-2 text-xs font-bold text-slate-600">
                        入場 {row.entry_time || '未定'}（{row.shift_type || '昼'}）
                      </span>
                    </div>
                    <button
                      onClick={() => openJobModal(row)}
                      className="px-3 py-1.5 rounded-xl bg-teal-700 text-white font-bold text-xs shadow-sm"
                    >
                      詳細・売上
                    </button>
                  </div>

                  <div className="font-extrabold text-lg text-slate-900">
                    {row.site_name || '（現場名未入力）'}
                  </div>
                  <div className="text-sm font-bold text-slate-600 mt-0.5">
                    {row.customer_name || '（得意先未入力）'}
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-sm">
                    <div className="font-bold text-slate-800">
                      {row.operator_name
                        ? `オペ: ${row.operator_name}`
                        : row.supplier_name
                        ? `庸車: ${row.supplier_name}`
                        : 'オペ・庸車 未割当'}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopyRow(row)}
                        className="p-2 rounded-lg border border-slate-200 text-slate-600"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteRow(row.id)}
                        className="p-2 rounded-lg border border-rose-200 text-rose-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {/* 詳細・売上・庸車・作業指示モーダル */}
      {selectedJob && (
        <div className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-3 md:p-6">
          <div className="bg-slate-50 w-full max-w-4xl max-h-[92vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
            {/* モーダルヘッダー */}
            <div className="bg-white px-5 py-4 border-b border-slate-200 flex items-start justify-between">
              <div>
                <div className="text-xs font-extrabold text-teal-700">
                  {selectedJob.customer_name || '得意先未入力'}
                </div>
                <h2 className="text-xl md:text-2xl font-black text-slate-900">
                  {selectedJob.site_name || '現場詳細・売上登録'}
                </h2>
                <div className="text-xs font-bold text-slate-500 mt-0.5">
                  {formatJapaneseMonthDay(selectedJob.work_date)}（{getWeekday(selectedJob.work_date)}）{' '}
                  {getRokuyo(selectedJob.work_date)}
                </div>
              </div>
              <button
                onClick={() => setSelectedJob(null)}
                className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* タブ切り替え */}
            <div className="bg-white px-5 pt-2 border-b border-slate-200 flex gap-2">
              {[
                { key: 'sales', label: '売上詳細・付帯明細' },
                { key: 'hire', label: '庸車・日程変更' },
                { key: 'operator', label: 'オペレーター作業指示' },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setJobTab(t.key as any)}
                  className={`px-4 py-2.5 text-sm font-extrabold border-b-2 transition ${
                    jobTab === t.key
                      ? 'border-teal-600 text-teal-800'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* モーダルボディ */}
            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              {jobTab === 'sales' && (
                <>
                  {/* 作業時間セクション（休憩1時間自動控除） */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200">
                    <h3 className="font-extrabold text-sm text-slate-800 mb-1">作業時間</h3>
                    <p className="text-xs text-slate-500 mb-3">
                      8:00〜17:00は昼休憩1時間を含むため、実働8時間として自動計算されます。
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">開始時間</label>
                        <input
                          type="text"
                          value={selectedJob.start_time || ''}
                          onChange={(e) => {
                            const st = e.target.value;
                            const hrs = calculateWorkHours(st, selectedJob.end_time || '');
                            setSelectedJob({
                              ...selectedJob,
                              start_time: st,
                              work_hours: hrs !== null ? hrs : selectedJob.work_hours,
                            });
                          }}
                          className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">終了時間</label>
                        <input
                          type="text"
                          value={selectedJob.end_time || ''}
                          onChange={(e) => {
                            const et = e.target.value;
                            const hrs = calculateWorkHours(selectedJob.start_time || '', et);
                            setSelectedJob({
                              ...selectedJob,
                              end_time: et,
                              work_hours: hrs !== null ? hrs : selectedJob.work_hours,
                            });
                          }}
                          className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">実働時間（h）</label>
                        <input
                          type="number"
                          step="0.5"
                          value={selectedJob.work_hours ?? ''}
                          onChange={(e) =>
                            setSelectedJob({
                              ...selectedJob,
                              work_hours: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                        />
                      </div>
                    </div>
                    {(selectedJob.work_hours ?? 0) > 8 && (
                      <div className="mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs font-bold text-amber-900 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        8時間を超えた {Math.round(((selectedJob.work_hours ?? 0) - 8) * 10) / 10} 時間分は、下の「付帯売上明細」に残業として追加してください。
                      </div>
                    )}
                  </div>

                  {/* 基本料金（8時間） */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200">
                    <h3 className="font-extrabold text-sm text-slate-800 mb-3">基本料金（8時間）</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">
                          8時間基本単価（円）
                        </label>
                        <input
                          type="number"
                          value={selectedJob.unit_price ?? ''}
                          placeholder="例: 45000"
                          onChange={(e) =>
                            setSelectedJob({
                              ...selectedJob,
                              unit_price: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          className="w-full h-11 px-3 rounded-xl border border-slate-300 font-extrabold text-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">
                          1時間あたり単価（参考）
                        </label>
                        <div className="h-11 px-3 rounded-xl bg-slate-100 flex items-center font-bold text-slate-700">
                          {selectedJob.unit_price
                            ? `${Math.round(selectedJob.unit_price / 8).toLocaleString()} 円`
                            : '—'}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">
                          売上合計（基本＋付帯）
                        </label>
                        <div className="h-11 px-3 rounded-xl bg-teal-50 border border-teal-200 flex items-center font-black text-lg text-teal-900">
                          {(
                            Number(selectedJob.unit_price || 0) +
                            extras.reduce(
                              (s, e) => s + Number(e.quantity || 0) * Number(e.unit_price || 0),
                              0
                            )
                          ).toLocaleString()}{' '}
                          円
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 付帯売上明細 */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-extrabold text-sm text-slate-800">
                        付帯売上明細（残業・敷鉄板・高速代など）
                      </h3>
                      <button
                        type="button"
                        onClick={() =>
                          setExtras([
                            ...extras,
                            { item_name: '', quantity: 1, unit: '', unit_price: 0, amount: 0, notes: '' },
                          ])
                        }
                        className="text-xs font-bold text-teal-700 hover:underline"
                      >
                        + 行を追加
                      </button>
                    </div>
                    <div className="space-y-2">
                      {extras.map((line, i) => (
                        <div key={i} className="grid grid-cols-12 gap-2 items-center">
                          <input
                            type="text"
                            placeholder="項目名（例: 残業代）"
                            value={line.item_name}
                            onChange={(e) => {
                              const next = [...extras];
                              next[i].item_name = e.target.value;
                              setExtras(next);
                            }}
                            className="col-span-4 h-10 px-2.5 rounded-lg border border-slate-300 text-sm font-bold"
                          />
                          <input
                            type="number"
                            placeholder="数量"
                            value={line.quantity}
                            onChange={(e) => {
                              const next = [...extras];
                              next[i].quantity = Number(e.target.value);
                              setExtras(next);
                            }}
                            className="col-span-2 h-10 px-2 rounded-lg border border-slate-300 text-sm font-bold text-right"
                          />
                          <input
                            type="text"
                            placeholder="単位"
                            value={line.unit}
                            onChange={(e) => {
                              const next = [...extras];
                              next[i].unit = e.target.value;
                              setExtras(next);
                            }}
                            className="col-span-1 h-10 px-2 rounded-lg border border-slate-300 text-sm text-center"
                          />
                          <input
                            type="number"
                            placeholder="単価"
                            value={line.unit_price || ''}
                            onChange={(e) => {
                              const next = [...extras];
                              next[i].unit_price = Number(e.target.value);
                              setExtras(next);
                            }}
                            className="col-span-2 h-10 px-2 rounded-lg border border-slate-300 text-sm font-bold text-right"
                          />
                          <div className="col-span-2 h-10 px-2 rounded-lg bg-slate-100 flex items-center justify-end text-sm font-extrabold">
                            {(Number(line.quantity || 0) * Number(line.unit_price || 0)).toLocaleString()}円
                          </div>
                          <button
                            type="button"
                            onClick={() => setExtras(extras.filter((_, idx) => idx !== i))}
                            className="col-span-1 text-rose-500 hover:text-rose-700 flex justify-center"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {jobTab === 'hire' && (
                <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-4">
                  <h3 className="font-extrabold text-sm text-slate-800">日程変更・現場連絡先・客先設定</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">作業日（日付変更）</label>
                      <input
                        type="date"
                        value={selectedJob.work_date}
                        onChange={(e) =>
                          setSelectedJob({ ...selectedJob, work_date: e.target.value })
                        }
                        className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">入場時間</label>
                      <input
                        type="text"
                        value={selectedJob.entry_time || ''}
                        onChange={(e) =>
                          setSelectedJob({ ...selectedJob, entry_time: e.target.value })
                        }
                        className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">現場名</label>
                      <input
                        type="text"
                        value={selectedJob.site_name || ''}
                        onChange={(e) =>
                          setSelectedJob({ ...selectedJob, site_name: e.target.value })
                        }
                        className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">現場住所</label>
                      <input
                        type="text"
                        value={selectedJob.site_address || ''}
                        onChange={(e) =>
                          setSelectedJob({ ...selectedJob, site_address: e.target.value })
                        }
                        className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">現場担当者</label>
                      <input
                        type="text"
                        value={selectedJob.contact_name || ''}
                        onChange={(e) =>
                          setSelectedJob({ ...selectedJob, contact_name: e.target.value })
                        }
                        className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">担当者携帯TEL</label>
                      <input
                        type="text"
                        value={selectedJob.contact_tel || ''}
                        onChange={(e) =>
                          setSelectedJob({ ...selectedJob, contact_tel: e.target.value })
                        }
                        className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-slate-600 mb-1">
                        真の客先名（同業他社からの庸車受託時）
                      </label>
                      <input
                        type="text"
                        value={selectedJob.end_client_name || ''}
                        onChange={(e) =>
                          setSelectedJob({ ...selectedJob, end_client_name: e.target.value })
                        }
                        className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                  </div>
                </div>
              )}

              {jobTab === 'operator' && (
                <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-4">
                  <h3 className="font-extrabold text-sm text-slate-800">オペレーター作業指示内容</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">作業場所</label>
                      <input
                        type="text"
                        value={selectedJob.work_location || ''}
                        onChange={(e) =>
                          setSelectedJob({ ...selectedJob, work_location: e.target.value })
                        }
                        className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">元請会社</label>
                      <input
                        type="text"
                        value={selectedJob.prime_contractor || ''}
                        onChange={(e) =>
                          setSelectedJob({ ...selectedJob, prime_contractor: e.target.value })
                        }
                        className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-slate-600 mb-1">備考・注意事項</label>
                      <textarea
                        rows={3}
                        value={selectedJob.notes || ''}
                        onChange={(e) =>
                          setSelectedJob({ ...selectedJob, notes: e.target.value })
                        }
                        className="w-full p-3 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* モーダルフッター */}
            <div className="bg-white px-5 py-3.5 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                onClick={() => setSelectedJob(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-300 font-bold text-sm text-slate-700 hover:bg-slate-50"
              >
                閉じる
              </button>
              <button
                onClick={saveJobModal}
                disabled={savingJob}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-teal-700 text-white font-bold text-sm hover:bg-teal-800 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {savingJob ? '保存中...' : 'この内容を保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}