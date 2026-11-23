'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Printer,
  Copy,
  ClipboardPaste,
  Trash2,
  CheckCircle2,
  Clock,
  Users,
  MapPin,
  AlertTriangle,
  Search,
  X,
  Save,
  Wrench,
} from 'lucide-react';
import AppSidebar from '@/components/app-sidebar';
import ContactRegisterDialog, { type ContactDraft } from '@/components/contact-register-dialog';
import SiteRegisterDialog, { type SiteDraft } from '@/components/site-register-dialog';
import PrintPreview, { type PrintKind } from '@/components/print-preview';
import SuggestInput, { type SuggestOption } from '@/components/suggest-input';
import NamePicker from '@/components/name-picker';
import AttachDialog from '@/components/attach-dialog';
import WhiteMapDialog from '@/components/white-map';
import NearbyPartners, { type CallNumber, type NearbyPartner } from '@/components/nearby-partners';
import { supabase, getDefaultCompanyId } from '@/lib/supabase';
import { sameCode, sameParty, partyKey } from '@/lib/party-name';
import { toHalfwidthTime } from '@/lib/time-text';
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
  client_job_code?: string;
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
  request_notes?: string;
  supplier_code: string;
  supplier_name: string;
  is_dispatched: boolean;
  is_cancelled: boolean;
  contact_code: string;
  contact_name: string;
  contact_tel: string;
  purchase_amount?: number | null;
  supplier_contact_code?: string;
  supplier_contact_name?: string;
  supplier_contact_tel?: string;
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

type ContactPerson = {
  id: string;
  code: string;
  customer_code: string;
  customer_name: string;
  name: string;
  tel: string;
};

function guestCodeOf(site?: { client_site_code?: string; construction_no?: string } | null) {
  return String(site?.client_site_code || site?.construction_no || '').trim();
}

function siteGuestPatch(
  row: { site_code?: string; client_job_code?: string },
  site?: { code?: string; client_site_code?: string; construction_no?: string } | null
) {
  const fromSite = guestCodeOf(site);
  const switched = Boolean(site?.code) && site?.code !== (row.site_code || '');
  if (switched) return { client_job_code: fromSite };
  if (fromSite && !String(row.client_job_code || '').trim()) return { client_job_code: fromSite };
  return {};
}

function isUnassigned(row: Pick<DispatchRecord, 'operator_name' | 'supplier_name' | 'is_cancelled'>) {
  return !row.is_cancelled && !row.operator_name?.trim() && !row.supplier_name?.trim();
}

// 付帯（残業・鉄板・高速代・回送・費用など）にあたる商品マスタ。機械・車両は含めない。
const EXTRA_CATEGORIES = ['付帯', '費用', '回送', '書類', '誘導車', '作業員'];
function isExtraProduct(row: Record<string, any>) {
  const c1 = String(row.category1 || '');
  if (EXTRA_CATEGORIES.includes(c1)) return true;
  return c1 === 'その他' && !String(row.category2 || '') && String(row.product_type || '') === 'クレーン';
}

async function fetchCompanyRows(table: string, companyId: string, orderColumn: string) {
  const pageSize = 1000;
  const rows: Record<string, string>[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('company_id', companyId)
      .order(orderColumn, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as Record<string, string>[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export default function CraneProApp() {
  const [companyId, setCompanyId] = useState<string>('');
  const [boardDate, setBoardDate] = useState<string>('');
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
  const [extraProducts, setExtraProducts] = useState<any[]>([]);
  const [monthCounts, setMonthCounts] = useState<Record<string, number>>({});
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const [printRequest, setPrintRequest] = useState<{ kind: PrintKind; jobId: string } | null>(null);
  const [contacts, setContacts] = useState<ContactPerson[]>([]);
  const [contactsLocked, setContactsLocked] = useState(false);
  const [siteDraft, setSiteDraft] = useState<SiteDraft | null>(null);
  const [contactDraft, setContactDraft] = useState<ContactDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [attachJobId, setAttachJobId] = useState<string | null>(null);
  const [mapTarget, setMapTarget] = useState<{ address: string; date: string; siteName: string } | null>(null);
  const [nearbyTarget, setNearbyTarget] = useState<{ address: string; siteName: string } | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 2600);
  };

  // 今日の日付は描画後に決める。初期描画で new Date() すると Next.js が事前レンダリングを止める。
  // 請求明細の「訂正処理」から来た場合は、その日付の配車を開き、詳細（売上詳細・付帯明細）を自動で開く
  const [pendingJob, setPendingJob] = useState<{ id: string; tab: 'sales' | 'hire' | 'operator' } | null>(null);
  const [backUrl, setBackUrl] = useState('');
  const fromBilling = Boolean(backUrl);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const date = params.get('date') || '';
    const job = params.get('job') || '';
    if (job && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const tab = params.get('tab');
      setBoardDate(date);
      setPendingJob({ id: job, tab: tab === 'hire' || tab === 'operator' ? tab : 'sales' });
      const back = params.get('back') || '';
      setBackUrl(back.startsWith('/billing') ? back : '');
      return;
    }
    setBoardDate(getTodayIso());
  }, []);

  // 初期データ（会社ID・マスタ類）の読み込み
  useEffect(() => {
    async function init() {
      try {
        const cid = await getDefaultCompanyId();
        setCompanyId(cid);

        const [custRows, siteRows, opRows, modRows] = await Promise.all([
          fetchCompanyRows('customers', cid, 'search_word'),
          fetchCompanyRows('sites', cid, 'name'),
          fetchCompanyRows('operators', cid, 'sort_order'),
          fetchCompanyRows('machine_models', cid, 'sort_order'),
        ]);

        setCustomers(custRows);
        setSites(siteRows);
        setOperators(opRows);
        setModels(modRows);
        try {
          const productRows = await fetchCompanyRows('products', cid, 'code');
          setExtraProducts(productRows.filter((row) => String(row.category1 || '') === '付帯'));
        } catch {
          setExtraProducts([]);
        }

        const contactRes = await supabase
          .from('customer_contacts')
          .select('id, code, customer_code, customer_name, name, tel')
          .eq('company_id', cid);
        if (contactRes.error) {
          if (/permission denied/i.test(contactRes.error.message)) setContactsLocked(true);
        } else {
          setContacts((contactRes.data ?? []) as ContactPerson[]);
        }
      } catch (err: any) {
        showToast(err.message || '初期データの読み込みに失敗しました');
      }
    }
    init();
  }, []);

  // 指定日の配車データ取得
  const fetchDispatches = useCallback(async () => {
    if (!companyId || !boardDate) return;
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

  const boardMonth = boardDate.slice(0, 7);
  useEffect(() => {
    if (!companyId || !/^\d{4}-\d{2}$/.test(boardMonth)) return;
    let cancelled = false;
    const year = Number(boardMonth.slice(0, 4));
    const month = Number(boardMonth.slice(5, 7));
    const last = new Date(year, month, 0).getDate();
    const end = `${boardMonth}-${String(last).padStart(2, '0')}`;
    supabase
      .from('dispatches')
      .select('work_date, operator_name, supplier_name, is_cancelled')
      .eq('company_id', companyId)
      .gte('work_date', `${boardMonth}-01`)
      .lte('work_date', end)
      .then(({ data }) => {
        if (cancelled) return;
        const counts: Record<string, number> = {};
        const open: Record<string, boolean> = {};
        for (const row of data ?? []) {
          const day = String(row.work_date);
          counts[day] = (counts[day] ?? 0) + 1;
          if (isUnassigned(row)) open[day] = true;
        }
        setMonthCounts(counts);
        setOpenDays(open);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, boardMonth, dispatches.map((row) => `${row.id}:${isUnassigned(row) ? 1 : 0}`).join(',')]);

  // 追加した行が画面外にあるときは、そこまでなめらかに移動して強調する
  const revealRow = (id: string) => {
    window.setTimeout(() => {
      const el = Array.from(document.querySelectorAll<HTMLElement>('[data-row-id]')).find(
        (node) => node.dataset.rowId === id && node.offsetParent !== null
      );
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.animate([{ boxShadow: '0 0 0 4px rgba(20,184,166,.9)' }, { boxShadow: '0 0 0 0 rgba(20,184,166,0)' }], { duration: 1600 });
    }, 150);
  };

  // 新規配車行の追加
  const handleAddRow = async () => {
    if (!companyId || !boardDate) return;
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
      revealRow(data.id);
      showToast('新規配車行を追加しました');
    }
  };

  // 行のインライン更新（オートセーブ）
  const handleUpdateField = async (id: string, patch: Partial<DispatchRecord>) => {
    // 画面状態を即座に反映
    const nextPatch = { ...patch };
    if (typeof nextPatch.entry_time === 'string') nextPatch.entry_time = toHalfwidthTime(nextPatch.entry_time);
    setDispatches((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const updated = { ...row, ...nextPatch };
        const hasCrewOrMachine = Boolean(
          updated.operator_name?.trim() ||
            updated.supplier_name?.trim() ||
            updated.requested_model?.trim()
        );
        updated.is_dispatched = !updated.is_cancelled && hasCrewOrMachine;
        nextPatch.is_dispatched = updated.is_dispatched;
        return updated;
      })
    );

    const { error } = await supabase.from('dispatches').update(nextPatch).eq('id', id);
    if (error) {
      showToast(
        /client_job_code/i.test(error.message)
          ? '工事コードを保存するには、Supabaseで supabase/dispatch_client_job_code.sql を実行してください'
          : /supplier_contact/i.test(error.message)
            ? '庸車の担当者を保存するには、Supabaseで supabase/dispatch_supplier_contact.sql を実行してください'
            : '保存エラー: ' + error.message
      );
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
    const opened = { ...job };
    if (opened.unit_price == null) {
      const standard = standardPrice(opened.requested_model || '', opened.shift_type || '');
      if (standard != null) opened.unit_price = standard;
    }
    if (opened.purchase_amount == null && opened.supplier_name) {
      const remembered = await latestPurchase(opened.supplier_code || '', opened.supplier_name);
      if (remembered != null) opened.purchase_amount = remembered;
    }
    setSelectedJob(opened);
    setJobTab('sales');
    const { data } = await supabase
      .from('dispatch_extras')
      .select('*')
      .eq('dispatch_id', job.id)
      .order('sort_order', { ascending: true });

    const loaded: ExtraLine[] = (data || []).map((d) => ({
      id: d.id,
      item_name: d.item_name || '',
      quantity: Number(d.quantity ?? 1),
      unit: d.unit || '',
      unit_price: Number(d.unit_price ?? 0),
      amount: Number(d.amount ?? 0),
      notes: d.notes || '',
    }));
    while (loaded.length < 3) {
      loaded.push({ id: undefined, item_name: '', quantity: 1, unit: '', unit_price: 0, amount: 0, notes: '' });
    }
    setExtras(loaded);
  };

  // 請求明細から来た場合は、詳細を閉じたら（保存後も）請求の得意先ページへ戻る
  const openedForFix = React.useRef(false);
  useEffect(() => {
    if (!backUrl) return;
    if (selectedJob) openedForFix.current = true;
    else if (openedForFix.current) window.location.assign(backUrl);
  }, [selectedJob, backUrl]);

  useEffect(() => {
    if (!pendingJob || loading) return;
    const target = dispatches.find((row) => row.id === pendingJob.id);
    if (!target) return;
    setPendingJob(null);
    openJobModal(target).then(() => setJobTab(pendingJob.tab));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJob, loading, dispatches]);

  // 付帯売上マスタ（商品テーブルの「付帯」区分）を並び順どおりに出す
  const extraItems = extraProducts
    .filter((p) => p.name)
    .slice()
    .sort((x, y) => (Number(x.dispatch_sort_order) || 99999) - (Number(y.dispatch_sort_order) || 99999) || String(x.code).localeCompare(String(y.code)))
    .map((p) => ({
      id: String(p.id || p.code),
      name: String(p.name),
      kana: String(p.kana || ''),
      searchWord: p.unit_name && p.unit_name !== 'h' ? `単位: ${p.unit_name}` : '',
    }));

  // 付帯の項目をマスタに新規登録
  const registerExtra = async (index: number) => {
    if (!companyId) return;
    const name = (window.prompt('登録する付帯の名前（例: 残業代、鉄板、高速代）') || '').trim();
    if (!name) return;
    if (extraItems.some((p) => p.name === name)) {
      showToast('同じ名前がすでにあります。一覧から選んでください');
      return;
    }
    const maxCode = extraProducts.reduce((max, p) => Math.max(max, Number(p.code) || 0), 900000);
    const maxSort = extraProducts.reduce((max, p) => Math.max(max, Number(p.dispatch_sort_order) || 0), 0);
    const { data, error } = await supabase
      .from('products')
      .insert({
        company_id: companyId,
        code: String(maxCode + 1),
        name,
        unit_name: '',
        category1: '付帯',
        product_type: 'クレーン',
        dispatch_sort_order: maxSort + 1,
      })
      .select('*')
      .single();
    if (error || !data) {
      showToast('マスタ登録エラー: ' + (error?.message || ''));
      return;
    }
    setExtraProducts((prev) => [...prev, data]);
    setExtras((prev) => {
      const next = [...prev];
      if (next[index]) next[index] = { ...next[index], item_name: name };
      return next;
    });
    showToast(`「${name}」を付帯マスタに登録しました`);
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
      site_code: selectedJob.site_code,
      site_address: selectedJob.site_address,
      contact_code: selectedJob.contact_code,
      contact_name: selectedJob.contact_name,
      contact_tel: selectedJob.contact_tel,
      notes: selectedJob.notes,
      end_client_name: selectedJob.end_client_name,
      work_location: selectedJob.work_location,
      prime_contractor: selectedJob.prime_contractor,
      supplier_code: selectedJob.supplier_code,
      supplier_name: selectedJob.supplier_name,
    };

    const { error } = await supabase.from('dispatches').update(updatePayload).eq('id', selectedJob.id);
    let supplierContactError = '';
    if (!error) {
      const contactSave = await supabase
        .from('dispatches')
        .update({
          supplier_contact_code: selectedJob.supplier_contact_code || '',
          supplier_contact_name: selectedJob.supplier_contact_name || '',
          supplier_contact_tel: selectedJob.supplier_contact_tel || '',
        })
        .eq('id', selectedJob.id);
      if (contactSave.error && /supplier_contact/i.test(contactSave.error.message)) {
        supplierContactError = '庸車の担当者を保存するには、Supabaseで supabase/dispatch_supplier_contact.sql を実行してください';
      } else if (contactSave.error) {
        supplierContactError = contactSave.error.message;
      }
    }

    let purchaseError = '';
    if (!error && selectedJob.supplier_name) {
      const purchaseSave = await supabase
        .from('dispatches')
        .update({ purchase_amount: selectedJob.purchase_amount ?? null })
        .eq('id', selectedJob.id);
      if (purchaseSave.error && /purchase_amount/i.test(purchaseSave.error.message)) {
        if (selectedJob.purchase_amount != null) purchaseError = '仕入金額を保存するには、Supabaseで supabase/dispatch_purchase.sql を実行してください';
      } else if (purchaseSave.error) {
        purchaseError = purchaseSave.error.message;
      }
    }

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

    let clientJobError = '';
    if (!error) {
      const codeSave = await supabase
        .from('dispatches')
        .update({ client_job_code: selectedJob.client_job_code || '' })
        .eq('id', selectedJob.id);
      if (codeSave.error && /client_job_code/i.test(codeSave.error.message)) {
        if ((selectedJob.client_job_code || '').trim()) {
          clientJobError = '工事コードを保存するには、Supabaseで supabase/dispatch_client_job_code.sql を実行してください';
        }
      } else if (codeSave.error) {
        clientJobError = codeSave.error.message;
      }
    }

    let requestNoteError = '';
    if (!error) {
      const noteSave = await supabase
        .from('dispatches')
        .update({ request_notes: selectedJob.request_notes || '' })
        .eq('id', selectedJob.id);
      if (noteSave.error && /request_notes/i.test(noteSave.error.message)) {
        if ((selectedJob.request_notes || '').trim()) {
          requestNoteError = '配車依頼書の備考を保存するには、Supabaseで supabase/dispatch_request_notes.sql を実行してください';
        }
      } else if (noteSave.error) {
        requestNoteError = noteSave.error.message;
      }
    }

    setSavingJob(false);
    if (error) {
      showToast('保存エラー: ' + error.message);
    } else if (purchaseError) {
      showToast(purchaseError);
      fetchDispatches();
    } else if (requestNoteError) {
      showToast(requestNoteError);
      fetchDispatches();
    } else if (clientJobError) {
      showToast(clientJobError);
      fetchDispatches();
    } else if (supplierContactError) {
      showToast(supplierContactError);
      fetchDispatches();
    } else {
      showToast('詳細と売上データを保存しました');
      setSelectedJob(null);
      fetchDispatches();
    }
  };

  // フィルタリング集計
  const counts = {
    all: dispatches.length,
    open: dispatches.filter((d) => isUnassigned(d)).length,
    done: dispatches.filter((d) => !d.is_cancelled && !isUnassigned(d)).length,
  };

  const filteredDispatches = dispatches.filter((d) => {
    if (filter === 'open') return isUnassigned(d);
    if (filter === 'done') return !d.is_cancelled && !isUnassigned(d);
    return true;
  });

  const rokuyoLabel = getRokuyo(boardDate);
  const weekdayLabel = getWeekday(boardDate);
  const relatedParty = (siteName: string, customerName: string) => {
    if (sameParty(siteName, customerName)) return true;
    const siteKey = partyKey(siteName);
    const customerKey = partyKey(customerName);
    if (siteKey.length < 6 || customerKey.length < 6) return false;
    return siteKey.startsWith(customerKey) || customerKey.startsWith(siteKey);
  };
  const peopleFor = (code: string, name: string) =>
    contacts.filter((person) => {
      if (code && person.customer_code && sameCode(person.customer_code, code)) return true;
      if (name && person.customer_name && sameParty(person.customer_name, name)) return true;
      return false;
    });
  const siteChoices = (customerCode: string, customerName: string, typed: string): SuggestOption[] => {
    const query = typed.trim();
    const owned = sites.filter((site) => {
      if (!site?.name || site.name === '名称未設定') return false;
      const codeHit = Boolean(customerCode && site.customer_code && sameCode(site.customer_code, customerCode));
      const nameHit = Boolean(customerName && site.customer_name && relatedParty(site.customer_name, customerName));
      return codeHit || nameHit;
    });
    const hasCustomer = Boolean(customerCode || customerName);
    let pool = hasCustomer ? owned : query ? sites : [];
    if (query) {
      pool = pool.filter((site) => `${site.name || ''} ${site.address || ''}`.includes(query));
    }
    return pool.slice(0, 40).map((site) => ({
      id: site.id,
      value: site.name,
      hint: site.address || '',
    }));
  };
  const customerItems = customers
    .filter((customer) => customer.name)
    .map((customer) => ({
      id: String(customer.code || customer.id),
      name: String(customer.name),
      kana: String(customer.kana || ''),
      searchWord: String(customer.search_word || ''),
      detail: [customer.address1, customer.address2].filter(Boolean).join(' '),
    }));
  const supplierItems = customers
    .filter((customer) => customer.name && String(customer.partner_type || '').includes('仕入'))
    .map((customer) => ({
      id: String(customer.id || customer.code),
      name: String(customer.name),
      kana: String(customer.kana || ''),
      searchWord: String(customer.search_word || ''),
    }));
  const modelItems = models
    .filter((model) => model.name)
    .map((model) => ({
      id: String(model.id || model.code),
      name: String(model.name),
      kana: String(model.kana || ''),
      searchWord: String(model.search_word || model.code || ''),
    }));
  const addressOf = (row: DispatchRecord) => {
    if (row.site_address) return row.site_address;
    const site = sites.find(
      (item) => (row.site_code && item.code === row.site_code) || (row.site_name && item.name === row.site_name)
    );
    return String(site?.address || '');
  };
  const openMap = (row: DispatchRecord) => {
    const address = addressOf(row);
    if (!address) return;
    setMapTarget({ address, date: row.work_date, siteName: row.site_name || '現場' });
  };
  const openNearby = (row: DispatchRecord) => {
    const address = addressOf(row);
    if (!address) return;
    setNearbyTarget({ address, siteName: row.site_name || '現場' });
  };
  const nearbyPartners = useMemo<NearbyPartner[]>(() => {
    const addCall = (calls: CallNumber[], seen: Set<string>, raw: string, person?: string, mobileOnly = false) => {
      const digits = String(raw || '').replace(/\D/g, '');
      if (digits.length < 10 || seen.has(digits)) return;
      const mobile = /^(070|080|090)\d{8}$/.test(digits);
      if (mobileOnly && !mobile) return;
      seen.add(digits);
      calls.push({
        label: mobile ? (person ? `携帯 ${person}` : '携帯') : '電話',
        display: String(raw).trim(),
        digits,
      });
    };
    return customers
      .filter((customer) => customer.name && String(customer.partner_type || '').includes('仕入'))
      .map((customer) => {
        const lat = customer.latitude == null || customer.latitude === '' ? null : Number(customer.latitude);
        const lng = customer.longitude == null || customer.longitude === '' ? null : Number(customer.longitude);
        const calls: CallNumber[] = [];
        const seen = new Set<string>();
        addCall(calls, seen, String(customer.tel || ''));
        addCall(calls, seen, String(customer.tel2 || ''));
        contacts
          .filter(
            (person) =>
              (customer.code && String(person.customer_code || '') === String(customer.code)) ||
              (customer.name && person.customer_name === customer.name)
          )
          .forEach((person) => addCall(calls, seen, person.tel, person.name, true));
        return {
          id: String(customer.id || customer.code),
          name: String(customer.name),
          address: [customer.address1, customer.address2].filter(Boolean).join(' '),
          lat: lat != null && Number.isFinite(lat) ? lat : null,
          lng: lng != null && Number.isFinite(lng) ? lng : null,
          calls,
        };
      });
  }, [contacts, customers]);
  const isOwnOperator = (name: string) =>
    operators.some((op) => String(op.name || '').trim() && String(op.name).trim() === String(name || '').trim());
  const findSite = (row: DispatchRecord) =>
    sites.find((site) => row.site_code && site.code === row.site_code) ||
    sites.find(
      (site) =>
        site.name === row.site_name &&
        (!row.customer_code || !site.customer_code || site.customer_code === row.customer_code)
    ) ||
    sites.find((site) => site.name && site.name === row.site_name);
  const openSiteMaster = (row: DispatchRecord) => {
    const hit = findSite(row);
    setSiteDraft({
      rowId: row.id,
      siteId: hit?.id ? String(hit.id) : undefined,
      name: hit?.name || row.site_name || '',
      customerCode: row.customer_code || hit?.customer_code || '',
      customerName: row.customer_name || hit?.customer_name || '',
      entryTime: row.entry_time || hit?.default_entry_time || '',
      guestCode: row.client_job_code || guestCodeOf(hit),
    });
  };
  const registerSite = (row: DispatchRecord) => openSiteMaster(row);
  const applyCustomer = (row: DispatchRecord, val: string, id?: string) => {
    const hit =
      (id && customers.find((customer) => String(customer.code || customer.id) === id)) ||
      customers.find((customer) => customer.name === val);
    if (!hit) {
      handleUpdateField(row.id, {
        customer_name: val,
        ...(val ? {} : { customer_code: '', contact_code: '', contact_name: '', contact_tel: '' }),
      });
      return;
    }
    const people = peopleFor(hit.code || '', hit.name || '');
    const only = people.length === 1 ? people[0] : null;
    const changed = (hit.code || '') !== (row.customer_code || '');
    handleUpdateField(row.id, {
      customer_name: val,
      customer_code: hit.code || '',
      ...(changed
        ? {
            site_code: '',
            site_name: '',
            client_job_code: '',
            contact_code: only?.code || '',
            contact_name: only?.name || '',
            contact_tel: only?.tel || '',
          }
        : only && !row.contact_name
          ? { contact_code: only.code, contact_name: only.name, contact_tel: only.tel }
          : {}),
    });
  };
  const standardPrice = (modelName: string, shift: string) => {
    const name = modelName.trim();
    if (!name) return null;
    const model = models.find((item) => String(item.name || '').trim() === name);
    if (!model) return null;
    const night = String(shift || '').includes('夜');
    const nightPrice = Number(model.night_standard_price);
    const dayPrice = Number(model.standard_price_a);
    if (night && Number.isFinite(nightPrice) && nightPrice > 0) return nightPrice;
    if (Number.isFinite(dayPrice) && dayPrice > 0) return dayPrice;
    return null;
  };
  const withStandardPrice = (row: DispatchRecord, patch: Partial<DispatchRecord>) => {
    const next = { ...row, ...patch };
    const nextPrice = standardPrice(next.requested_model || '', next.shift_type || '');
    const previousPrice = standardPrice(row.requested_model || '', row.shift_type || '');
    const empty = row.unit_price == null;
    const followedMaster = previousPrice != null && Number(row.unit_price) === previousPrice;
    if (nextPrice != null && (empty || followedMaster)) patch.unit_price = nextPrice;
    return patch;
  };
  const latestPurchase = async (supplierCode: string, supplierName: string) => {
    let query = supabase
      .from('dispatches')
      .select('purchase_amount')
      .not('purchase_amount', 'is', null)
      .order('work_date', { ascending: false })
      .limit(1);
    query = supplierCode ? query.eq('supplier_code', supplierCode) : query.eq('supplier_name', supplierName);
    const { data, error } = await query;
    if (error || data?.[0]?.purchase_amount == null) return null;
    const amount = Number(data[0].purchase_amount);
    return Number.isFinite(amount) ? amount : null;
  };
  const rememberPurchase = (row: DispatchRecord, supplierCode: string, supplierName: string) => {
    if (!supplierName || row.purchase_amount != null) return;
    void latestPurchase(supplierCode, supplierName).then((amount) => {
      if (amount == null) return;
      setDispatches((prev) => {
        const current = prev.find((item) => item.id === row.id);
        if (!current || current.supplier_name !== supplierName || current.purchase_amount != null) return prev;
        return prev.map((item) => (item.id === row.id ? { ...item, purchase_amount: amount } : item));
      });
      void supabase.from('dispatches').update({ purchase_amount: amount }).eq('id', row.id);
    });
  };
  const applySupplier = (row: DispatchRecord, val: string) => {
    const hit = customers.find(
      (customer) => customer.name === val && String(customer.partner_type || '').includes('仕入')
    );
    handleUpdateField(row.id, {
      supplier_name: val,
      supplier_contact_code: '',
      supplier_contact_name: '',
      supplier_contact_tel: '',
      ...(hit
        ? { supplier_code: hit.code || '', operator_name: '', operator_code: '' }
        : val
          ? { operator_name: '', operator_code: '' }
          : { supplier_code: '' }),
    });
    if (val) rememberPurchase(row, hit?.code || '', val);
  };
  const commitSite = (row: DispatchRecord, value: string, site?: (typeof sites)[number]) => {
    const customer = site?.customer_name
      ? customers.find((item) => item.name === site.customer_name)
      : undefined;
    handleUpdateField(row.id, {
      site_name: site?.name || value,
      ...(site
        ? {
            site_code: site.code || '',
            ...(site.customer_name ? { customer_name: site.customer_name } : {}),
            ...(site.customer_code || customer?.code
              ? { customer_code: site.customer_code || customer?.code || '' }
              : {}),
            ...(!row.entry_time && site.default_entry_time
              ? { entry_time: toHalfwidthTime(site.default_entry_time) }
              : {}),
            ...(site.address ? { site_address: site.address } : {}),
            ...(site.contact_name
              ? { contact_name: site.contact_name, contact_tel: site.contact_tel || '', contact_code: '' }
              : {}),
            ...siteGuestPatch(row, site),
          }
        : value
          ? { site_code: '' }
          : { site_code: '' }),
    });
  };
  function openPrint(kind: PrintKind, jobId = '') {
    if (!boardDate) return;
    setPrintRequest({ kind, jobId });
  }

  function contactChooser(
    row: DispatchRecord,
    onPick: (patch: Partial<DispatchRecord>) => void,
    className = 'w-full h-8 px-2 text-xs font-bold bg-teal-50 outline-none',
    party: 'customer' | 'supplier' = 'customer'
  ) {
    const partyCode = party === 'supplier' ? row.supplier_code || '' : row.customer_code || '';
    const partyName = party === 'supplier' ? row.supplier_name || '' : row.customer_name || '';
    const currentCode = party === 'supplier' ? row.supplier_contact_code || '' : row.contact_code || '';
    const currentName = party === 'supplier' ? row.supplier_contact_name || '' : row.contact_name || '';
    const currentTel = party === 'supplier' ? row.supplier_contact_tel || '' : row.contact_tel || '';
    if (!partyName && !partyCode) return null;
    const people = peopleFor(partyCode, partyName);
    const known = people.some((person) => person.code === currentCode);
    const emptyPatch =
      party === 'supplier'
        ? { supplier_contact_code: '', supplier_contact_name: '', supplier_contact_tel: '' }
        : { contact_code: '', contact_name: '', contact_tel: '' };
    return (
      <select
        value={known ? currentCode : currentName ? '__current__' : ''}
        onChange={(event) => {
          const next = event.target.value;
          if (next === '__new__') {
            setContactDraft({
              rowId: row.id,
              customerCode: partyCode,
              customerName: partyName,
              target: party === 'supplier' ? 'supplier' : 'job',
            });
            return;
          }
          if (!next) {
            onPick(emptyPatch);
            return;
          }
          if (next === '__current__') return;
          const person = people.find((item) => item.code === next);
          onPick(
            party === 'supplier'
              ? {
                  supplier_contact_code: person?.code || '',
                  supplier_contact_name: person?.name || '',
                  supplier_contact_tel: person?.tel || '',
                }
              : {
                  contact_code: person?.code || '',
                  contact_name: person?.name || '',
                  contact_tel: person?.tel || '',
                }
          );
        }}
        className={className}
      >
        <option value="">{party === 'supplier' ? '庸車の担当者' : '担当者を選択'}</option>
        {!known && currentName ? (
          <option value="__current__">
            {currentName}
            {currentTel ? ` ${currentTel}` : ''}
          </option>
        ) : null}
        {people.map((person) => (
          <option key={person.id} value={person.code}>
            {person.name} {person.tel}
          </option>
        ))}
        <option value="__new__">新規登録</option>
      </select>
    );
  }
  const monthDays = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(boardDate)) return [];
    const year = Number(boardDate.slice(0, 4));
    const month = Number(boardDate.slice(5, 7));
    const last = new Date(year, month, 0).getDate();
    return Array.from({ length: last }, (_, index) => `${boardDate.slice(0, 7)}-${String(index + 1).padStart(2, '0')}`);
  }, [boardDate]);

  return (
    <>
    <div className={`min-h-screen bg-slate-100 text-slate-900 flex flex-col md:flex-row font-sans ${printRequest ? 'print:hidden' : ''}`}>
      {/* トースト通知 */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white px-5 py-3 rounded-full shadow-xl text-sm font-bold flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-teal-400" />
          {toastMsg}
        </div>
      )}

      <datalist id="operator-names">
        {operators
          .filter((op) => op.name)
          .map((op) => (
            <option key={op.id} value={op.name} />
          ))}
      </datalist>
      <datalist id="customer-names">
        {customers
          .filter((customer) => customer.name)
          .map((customer) => (
            <option key={customer.id} value={customer.name} />
          ))}
      </datalist>
      <datalist id="supplier-names">
        {customers
          .filter((customer) => customer.name && String(customer.partner_type || '').includes('仕入'))
          .map((customer) => (
            <option key={customer.id} value={customer.name} />
          ))}
      </datalist>
      <datalist id="model-names">
        {models
          .filter((model) => model.name)
          .map((model) => (
            <option key={model.id} value={model.name} />
          ))}
      </datalist>
      <datalist id="job-contacts">
        {contacts
          .filter((person) => person.name)
          .map((person) => (
            <option key={person.id} value={person.name}>
              {person.tel}
            </option>
          ))}
      </datalist>

      <AppSidebar active="board" />

      {/* メインコンテンツ */}
      <main className="flex-1 min-w-0 p-4 md:p-6 pb-24">
        {/* 上部アクションバー */}
        <div className="mb-3 md:mb-5">
          {contactsLocked && (
            <p className="mb-2 text-sm font-bold text-amber-800">
              担当者マスタをまだ読めません。Supabase の SQL エディタで supabase/enable_master_access.sql を実行すると、得意先の担当者と携帯番号が出ます。
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 xl:flex-nowrap xl:gap-4">
            <h1 className="order-1 shrink-0 text-xl md:text-3xl font-extrabold text-slate-900 tracking-tight">配車管理</h1>

            <div className="order-2 ml-auto flex shrink-0 items-center gap-1.5 xl:order-3 xl:gap-2">
              {copiedRow && (
                <button
                  onClick={handlePasteRow}
                  aria-label="コピー行を貼り付け"
                  className="inline-flex h-9 items-center gap-1.5 px-2.5 md:h-11 md:px-3.5 rounded-xl bg-amber-100 text-amber-900 border border-amber-300 font-bold text-sm hover:bg-amber-200 transition"
                >
                  <ClipboardPaste className="w-4 h-4" />
                  <span className="hidden xl:inline">コピー行を貼り付け</span>
                </button>
              )}
              <button
                onClick={handleAddRow}
                aria-label="新規配車行追加"
                className="inline-flex h-9 items-center gap-1.5 px-3 md:h-11 md:px-4 rounded-xl bg-[#121826] text-white font-bold text-sm shadow-sm hover:bg-slate-800 transition"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden xl:inline">新規配車行追加</span>
              </button>
              <button
                onClick={() => openPrint('board')}
                aria-label="配車表"
                className="inline-flex h-9 items-center gap-1.5 px-2.5 md:h-11 md:px-3.5 rounded-xl bg-white text-slate-700 border border-slate-300 font-bold text-sm hover:bg-slate-50 transition"
              >
                <Printer className="w-4 h-4" />
                <span className="hidden xl:inline">配車表</span>
              </button>
            </div>

            {/* 日付・曜日・六曜（タップでカレンダー） */}
            <div className="order-3 flex w-full items-center justify-center gap-1.5 xl:order-2 xl:w-auto xl:flex-1 xl:gap-2">
              <button
                onClick={() => setBoardDate(shiftIsoDate(boardDate, -1))}
                className="w-9 h-9 md:w-11 md:h-11 rounded-lg md:rounded-xl border border-slate-300 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-700"
                aria-label="前日"
              >
                <ChevronLeft className="w-4 h-4 md:w-6 md:h-6" />
              </button>

              <label className="relative flex h-9 md:h-11 min-w-0 flex-1 md:flex-none cursor-pointer items-center justify-center gap-1.5 md:gap-3 px-3 md:px-5 rounded-lg md:rounded-xl bg-sky-50 border border-sky-200">
                <span className="text-sm md:text-2xl font-black text-slate-900 leading-none whitespace-nowrap">
                  {boardDate ? formatJapaneseMonthDay(boardDate) : '…'}
                </span>
                <span className="text-xs md:text-base font-bold text-sky-900 leading-none whitespace-nowrap">（{weekdayLabel}）</span>
                {rokuyoLabel && (
                  <span
                    className={`px-1.5 md:px-2.5 py-0.5 rounded-full text-[10px] md:text-sm font-extrabold leading-none ${
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
                <input
                  type="date"
                  value={boardDate}
                  aria-label="カレンダーから日付を選ぶ"
                  onClick={(e) => e.currentTarget.showPicker?.()}
                  onChange={(e) => e.target.value && setBoardDate(e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>

              <button
                onClick={() => setBoardDate(shiftIsoDate(boardDate, 1))}
                className="w-9 h-9 md:w-11 md:h-11 rounded-lg md:rounded-xl border border-slate-300 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-700"
                aria-label="翌日"
              >
                <ChevronRight className="w-4 h-4 md:w-6 md:h-6" />
              </button>

              <button
                onClick={() => setBoardDate(getTodayIso())}
                className="px-3 h-9 md:h-11 rounded-lg md:rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs md:text-sm font-bold text-slate-700"
              >
                今日
              </button>
            </div>
          </div>
        </div>

        {monthDays.length > 0 && (
          <div className="flex flex-nowrap md:flex-wrap gap-1 mb-3 md:mb-4 overflow-x-auto md:overflow-visible pb-1">
            {monthDays.map((day) => {
              const count = monthCounts[day] ?? 0;
              const active = day === boardDate;
              const unassigned = active ? dispatches.some((row) => isUnassigned(row)) : Boolean(openDays[day]);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setBoardDate(day)}
                  className={`h-8 min-w-8 md:h-10 md:min-w-9 shrink-0 px-1 md:px-1.5 rounded-md md:rounded-lg text-[11px] md:text-xs font-extrabold leading-none ${
                    unassigned
                      ? active
                        ? 'bg-amber-400 text-amber-950 ring-2 ring-amber-700'
                        : 'bg-amber-300 text-amber-950 border border-amber-500'
                      : active
                        ? 'bg-[#121826] text-white'
                        : count
                          ? 'bg-teal-50 text-teal-900 border border-teal-200'
                          : 'bg-white text-slate-400 border border-slate-200'
                  }`}
                >
                  <span className="block">{Number(day.slice(8))}</span>
                  <span className="block text-[10px]">{count > 0 ? `${count}件` : ''}</span>
                </button>
              );
            })}
          </div>
        )}

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
                tab.key === 'open'
                  ? filter === 'open'
                    ? 'bg-amber-400 text-amber-950 shadow-sm'
                    : 'bg-amber-100 text-amber-950 border border-amber-300'
                  : filter === tab.key
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
            <p className="text-slate-500 font-bold mb-4">
              この日の配車はありません。
              {Object.keys(openDays).length > 0 ? '黄色の日付は、オペレーターも庸車も空の配車がある日です。' : ''}
            </p>
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
              <table className="w-full min-w-[1180px] border-collapse text-left">
                <thead>
                  <tr className="bg-sky-100/80 border-b-2 border-sky-300 text-slate-800 text-xs font-extrabold">
                    <th className="p-2.5 border-r border-slate-200 w-28">操作</th>
                    <th className="p-2.5 border-r border-slate-200 w-32">オペレーター</th>
                    <th className="p-2.5 border-r border-slate-200 w-40">庸車（仕入先）</th>
                    <th className="p-2.5 border-r border-slate-200 w-44">得意先</th>
                    <th className="p-2.5 border-r border-slate-200 w-52">
                      現場名
                      <span className="mt-0.5 block font-bold text-slate-500">工事コード</span>
                    </th>
                    <th className="p-2.5 border-r border-slate-200 w-32">受付機種</th>
                    <th className="p-2.5 border-r border-slate-200 w-16 text-center">昼夜</th>
                    <th className="p-2.5 border-r border-slate-200 w-20">入場</th>
                    <th className="p-2.5 border-r border-slate-200 w-36">備考</th>
                    <th className="p-2.5 border-r border-slate-200 w-14 text-center">取消</th>
                    <th className="p-2.5 w-12 text-center">削除</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {filteredDispatches.map((row, idx) => {
                    const hasOp = Boolean(row.operator_name?.trim());
                    const hasSup = Boolean(row.supplier_name?.trim());
                    const ownOp = isOwnOperator(row.operator_name || '');
                    const siteAddress = addressOf(row);
                    const badgeColor = getMachineBadgeColor(row.requested_model);

                    const undispatched = isUnassigned(row);
                    return (
                      <tr
                        key={row.id}
                        data-row-id={row.id}
                        className={`transition ${
                          row.is_cancelled
                            ? 'bg-rose-50/60 text-slate-400'
                            : undispatched
                              ? 'bg-amber-100 hover:bg-amber-50'
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
                              onClick={() => setAttachJobId(row.id)}
                              title="添付"
                              className="px-2 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-bold text-xs hover:bg-slate-200"
                            >
                              添付
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
                        <td className={`p-0 border-r border-slate-200 ${ownOp ? 'bg-emerald-400' : ''}`}>
                          <input
                            type="text"
                            list="operator-names"
                            autoComplete="off"
                            disabled={hasSup && !hasOp}
                            value={row.operator_name || ''}
                            placeholder={hasSup ? '庸車指定中' : 'オペ入力'}
                            onChange={(e) => {
                              const val = e.target.value;
                              const hit = operators.find((op) => op.name === val);
                              handleUpdateField(row.id, {
                                operator_name: val,
                                ...(hit
                                  ? {
                                      operator_code: hit.code || '',
                                      supplier_name: '',
                                      supplier_code: '',
                                      supplier_contact_code: '',
                                      supplier_contact_name: '',
                                      supplier_contact_tel: '',
                                    }
                                  : val
                                    ? {
                                        supplier_name: '',
                                        supplier_code: '',
                                        supplier_contact_code: '',
                                        supplier_contact_name: '',
                                        supplier_contact_tel: '',
                                      }
                                    : { operator_code: '' }),
                              });
                            }}
                            className={`w-full h-11 px-2.5 font-bold outline-none focus:ring-2 focus:ring-teal-700 disabled:bg-slate-100 disabled:text-slate-400 ${
                              ownOp ? 'bg-emerald-400 focus:bg-emerald-300' : 'bg-transparent focus:bg-white'
                            }`}
                          />
                        </td>

                        {/* 庸車（オペレーターが入っている場合はロック） */}
                        <td className="p-0 border-r border-slate-200">
                          <NamePicker
                            value={row.supplier_name || ''}
                            items={supplierItems}
                            title="庸車先を選ぶ"
                            disabled={hasOp && !hasSup}
                            placeholder={hasOp ? '自社オペ中' : '名前・カナ・漢字・英字'}
                            onSelect={(name) => applySupplier(row, name)}
                            className="w-full h-11 px-2.5 bg-transparent font-bold focus:bg-white focus:ring-2 focus:ring-teal-600 outline-none disabled:bg-slate-100 disabled:text-slate-400"
                          />
                        </td>

                        {/* 得意先 */}
                        <td className="p-0 border-r border-slate-200">
                          <div className="flex items-center">
                            <NamePicker
                              panel
                              value={row.customer_name || ''}
                              currentId={row.customer_code || ''}
                              items={customerItems}
                              title="得意先を選ぶ"
                              placeholder="タップして選ぶ"
                              onSelect={(name, id) => applyCustomer(row, name, id)}
                              className="w-full h-11 px-2.5 bg-transparent font-bold focus:bg-white focus:ring-2 focus:ring-teal-600 outline-none"
                            />
                          </div>
                          {contactChooser(row, (patch) => handleUpdateField(row.id, patch))}
                        </td>

                        {/* 現場名 */}
                        <td className="p-0 border-r border-slate-200">
                          <div className="flex items-stretch">
                            <div className="min-w-0 flex-1">
                              <SuggestInput
                                value={row.site_name || ''}
                                placeholder="現場名"
                                title="現場を選ぶ"
                                options={siteChoices(row.customer_code || '', row.customer_name || '', row.site_name || '')}
                                onChange={(val) => {
                                  const hit = sites.find(
                                    (site) =>
                                      site.name === val &&
                                      (!row.customer_code || !site.customer_code || site.customer_code === row.customer_code)
                                  );
                                  commitSite(row, val, hit);
                                }}
                                onPick={(option) => {
                                  const hit = sites.find((site) => site.id === option.id);
                                  commitSite(row, hit?.name || option.value, hit);
                                }}
                                onCreate={() => registerSite(row)}
                                className="w-full h-8 px-2.5 bg-transparent font-bold focus:bg-white focus:ring-2 focus:ring-teal-600 outline-none"
                              />
                              <input
                                type="text"
                                value={row.client_job_code || ''}
                                placeholder="工事コード"
                                title="請求書に載せる客先の現場コード・工事コード。マスタの現場コードとは別です。"
                                onChange={(e) => handleUpdateField(row.id, { client_job_code: e.target.value })}
                                className="w-full h-7 border-t border-slate-200 bg-amber-50/80 px-2.5 text-[11px] font-bold text-slate-700 outline-none focus:bg-white"
                              />
                            </div>
                            {(row.site_name?.trim() || addressOf(row)) && (
                              <div className="flex shrink-0 flex-col border-l border-slate-200">
                                {row.site_name?.trim() && (
                                  <button
                                    type="button"
                                    onClick={() => openSiteMaster(row)}
                                    title="現場マスタを開く"
                                    className="h-7 px-1.5 text-[10px] font-extrabold text-teal-800 hover:bg-teal-50"
                                  >
                                    マスタ
                                  </button>
                                )}
                                {addressOf(row) && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openMap(row)}
                                      className="h-6 px-1.5 text-[11px] font-extrabold text-slate-700 hover:bg-slate-100"
                                    >
                                      地図
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openNearby(row)}
                                      className="h-6 px-1.5 text-[11px] font-extrabold text-teal-800 hover:bg-teal-50"
                                    >
                                      探す
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* 受付機種 */}
                        <td className="p-1 border-r border-slate-200">
                          <NamePicker
                            freeText
                            value={row.requested_model || ''}
                            items={modelItems}
                            title="機種を選ぶ"
                            placeholder="選ぶか、直接入力"
                            onSelect={(name) => handleUpdateField(row.id, withStandardPrice(row, { requested_model: name }))}
                            className={`w-full h-9 px-2 rounded-lg border font-extrabold text-xs outline-none focus:ring-2 focus:ring-teal-600 ${badgeColor}`}
                          />
                        </td>

                        {/* 昼夜 */}
                        <td className="p-0 border-r border-slate-200">
                          <select
                            value={row.shift_type || '昼'}
                            onChange={(e) =>
                              handleUpdateField(row.id, withStandardPrice(row, { shift_type: e.target.value }))
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

                        {/* 備考（現場マスタの住所を表示） */}
                        <td className="p-1 border-r border-slate-200 align-top">
                          {siteAddress && (
                            <div className="px-1.5 text-xs font-bold leading-snug text-slate-900 break-all">{siteAddress}</div>
                          )}
                          <input
                            type="text"
                            value={row.notes || ''}
                            placeholder={siteAddress ? '追記' : '備考'}
                            onChange={(e) =>
                              handleUpdateField(row.id, { notes: e.target.value })
                            }
                            className="w-full h-8 px-1.5 bg-transparent text-xs focus:bg-white focus:ring-2 focus:ring-teal-600 outline-none"
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
              {filteredDispatches.map((row, idx) => {
                const hasOp = Boolean(row.operator_name?.trim());
                const hasSup = Boolean(row.supplier_name?.trim());
                const ownOp = isOwnOperator(row.operator_name || '');
                const siteAddress = addressOf(row);
                const fieldClass =
                  'w-full h-10 px-2.5 rounded-lg border border-slate-300 bg-white font-bold text-sm outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-100 disabled:text-slate-400';
                return (
                <div
                  key={row.id}
                  data-row-id={row.id}
                  className={`rounded-2xl border p-4 shadow-sm ${
                    row.is_cancelled
                      ? 'bg-rose-50/70 border-rose-200'
                      : isUnassigned(row)
                        ? 'bg-amber-100 border-amber-300'
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
                        入場 {toHalfwidthTime(row.entry_time) || '未定'}（{row.shift_type || '昼'}）
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setAttachJobId(row.id)}
                        className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-800 font-bold text-xs"
                      >
                        添付
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(editingId === row.id ? null : row.id)}
                        className="px-3 py-1.5 rounded-xl bg-white text-slate-800 border border-slate-300 font-bold text-xs"
                      >
                        {editingId === row.id ? '閉じる' : '編集'}
                      </button>
                      <button
                        onClick={() => openJobModal(row)}
                        className="px-3 py-1.5 rounded-xl bg-teal-700 text-white font-bold text-xs shadow-sm"
                      >
                        詳細・売上
                      </button>
                    </div>
                  </div>

                  {editingId !== row.id && (
                    <div>
                      <div className="font-extrabold text-lg text-slate-900">{row.site_name || '（現場名未入力）'}</div>
                      {row.client_job_code?.trim() && (
                        <div className="text-xs font-black text-slate-500">工事コード {row.client_job_code}</div>
                      )}
                      {siteAddress && <div className="text-sm font-bold text-slate-800 mt-0.5">{siteAddress}</div>}
                      <div className="text-sm font-bold text-slate-600 mt-0.5">{row.customer_name || '（得意先未入力）'}</div>
                      {row.contact_name && (
                        <div className="text-sm font-bold text-teal-800 mt-0.5">
                          担当 {row.contact_name}
                          {row.contact_tel ? ` ${row.contact_tel}` : ''}
                        </div>
                      )}
                      <div className="mt-2 text-sm font-bold text-slate-800">
                        {row.operator_name ? (
                          <span className={ownOp ? 'inline-block rounded-md bg-emerald-400 px-2 py-0.5' : ''}>
                            オペ: {row.operator_name}
                          </span>
                        ) : row.supplier_name ? (
                          `庸車: ${row.supplier_name}`
                        ) : (
                          'オペ・庸車 未割当'
                        )}
                        {row.is_cancelled ? ' / 取消' : ''}
                      </div>
                    </div>
                  )}

                  {editingId === row.id && (
                  <div className="space-y-2">
                    <label className="block">
                      <span className="text-[11px] font-extrabold text-slate-500">得意先</span>
                      <NamePicker
                        panel
                        value={row.customer_name || ''}
                        currentId={row.customer_code || ''}
                        items={customerItems}
                        title="得意先を選ぶ"
                        placeholder="タップして選ぶ"
                        onSelect={(name, id) => applyCustomer(row, name, id)}
                        className={fieldClass}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-extrabold text-slate-500">配車先（現場）</span>
                      <SuggestInput
                        value={row.site_name || ''}
                        placeholder="現場名"
                        title="現場を選ぶ"
                        options={siteChoices(row.customer_code || '', row.customer_name || '', row.site_name || '')}
                        onChange={(val) => {
                          const hit = sites.find(
                            (site) =>
                              site.name === val &&
                              (!row.customer_code || !site.customer_code || site.customer_code === row.customer_code)
                          );
                          commitSite(row, val, hit);
                        }}
                        onPick={(option) => {
                          const hit = sites.find((site) => site.id === option.id);
                          commitSite(row, hit?.name || option.value, hit);
                        }}
                        onCreate={() => registerSite(row)}
                        className={fieldClass}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-extrabold text-slate-500">工事コード（請求書）</span>
                      <input
                        type="text"
                        value={row.client_job_code || ''}
                        placeholder="客先の現場コード・工事コード"
                        title="マスタの現場コードとは別です。請求書の現場名の下に出ます。"
                        onChange={(e) => handleUpdateField(row.id, { client_job_code: e.target.value })}
                        className={fieldClass}
                      />
                    </label>
                    {row.site_name?.trim() && (
                      <button
                        type="button"
                        onClick={() => openSiteMaster(row)}
                        className="h-10 rounded-xl border border-teal-700 px-3 text-xs font-extrabold text-teal-800"
                      >
                        現場マスタを開く
                      </button>
                    )}
                    {contactChooser(row, (patch) => handleUpdateField(row.id, patch), fieldClass)}
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[11px] font-extrabold text-slate-500">オペレーター</span>
                        <input
                          type="text"
                          list="operator-names"
                          autoComplete="off"
                          disabled={hasSup && !hasOp}
                          value={row.operator_name || ''}
                          placeholder={hasSup ? '庸車指定中' : 'オペ入力'}
                          onChange={(e) => {
                            const val = e.target.value;
                            const hit = operators.find((op) => op.name === val);
                            handleUpdateField(row.id, {
                              operator_name: val,
                              ...(hit
                                ? {
                                    operator_code: hit.code || '',
                                    supplier_name: '',
                                    supplier_code: '',
                                    supplier_contact_code: '',
                                    supplier_contact_name: '',
                                    supplier_contact_tel: '',
                                  }
                                : val
                                  ? {
                                      supplier_name: '',
                                      supplier_code: '',
                                      supplier_contact_code: '',
                                      supplier_contact_name: '',
                                      supplier_contact_tel: '',
                                    }
                                  : { operator_code: '' }),
                            });
                          }}
                          className={`${fieldClass} ${ownOp ? 'bg-emerald-400 border-emerald-600' : ''}`}
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] font-extrabold text-slate-500">庸車</span>
                        <NamePicker
                          value={row.supplier_name || ''}
                          items={supplierItems}
                          title="庸車先を選ぶ"
                          disabled={hasOp && !hasSup}
                          placeholder={hasOp ? '自社オペ中' : '名前・カナ・漢字・英字'}
                          onSelect={(name) => applySupplier(row, name)}
                          className={fieldClass}
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[11px] font-extrabold text-slate-500">入場時間</span>
                        <input
                          type="text"
                          value={row.entry_time || ''}
                          placeholder="8:00"
                          onChange={(e) => handleUpdateField(row.id, { entry_time: e.target.value })}
                          className={fieldClass}
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] font-extrabold text-slate-500">時間帯</span>
                        <select
                          value={row.shift_type || '昼'}
                          onChange={(e) => handleUpdateField(row.id, withStandardPrice(row, { shift_type: e.target.value }))}
                          className={fieldClass}
                        >
                          <option value="昼">昼</option>
                          <option value="夜">夜</option>
                        </select>
                      </label>
                    </div>
                    <label className="block">
                      <span className="text-[11px] font-extrabold text-slate-500">受付機種</span>
                      <NamePicker
                        freeText
                        value={row.requested_model || ''}
                        items={modelItems}
                        title="機種を選ぶ"
                        placeholder="選ぶか、直接入力"
                        onSelect={(name) => handleUpdateField(row.id, withStandardPrice(row, { requested_model: name }))}
                        className={fieldClass}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-extrabold text-slate-500">備考</span>
                      {siteAddress && <div className="mb-1 text-sm font-bold text-slate-900">{siteAddress}</div>}
                      <input
                        type="text"
                        value={row.notes || ''}
                        placeholder={siteAddress ? '追記' : '備考'}
                        onChange={(e) => handleUpdateField(row.id, { notes: e.target.value })}
                        className={fieldClass}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm font-bold text-rose-700">
                      <input
                        type="checkbox"
                        checked={Boolean(row.is_cancelled)}
                        onChange={(e) => handleUpdateField(row.id, { is_cancelled: e.target.checked })}
                        className="w-4 h-4 accent-rose-600"
                      />
                      この配車を取り消す
                    </label>
                  </div>
                  )}

                  <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                    {siteAddress && (
                      <>
                        <button
                          type="button"
                          onClick={() => openMap(row)}
                          className="h-11 min-w-16 flex-1 rounded-xl border border-slate-300 bg-white font-extrabold"
                        >
                          地図
                        </button>
                        <button
                          type="button"
                          onClick={() => openNearby(row)}
                          className="h-11 min-w-16 flex-1 rounded-xl bg-slate-900 font-extrabold text-white"
                        >
                          探す
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleCopyRow(row)}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600"
                      title="この行をコピー"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteRow(row.id)}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-rose-200 text-rose-600"
                      title="削除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          </>
        )}
      </main>

      {/* 詳細・売上・庸車・作業指示モーダル */}
      {siteDraft && companyId && (
        <SiteRegisterDialog
          companyId={companyId}
          draft={siteDraft}
          onClose={() => setSiteDraft(null)}
          onCreated={(site) => {
            setSites((current) =>
              [...current.filter((item) => item.id !== site.id), { ...(current.find((item) => item.id === site.id) || {}), ...site }]
                .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja'))
            );
            handleUpdateField(siteDraft.rowId, {
              site_code: site.code,
              site_name: site.name,
              client_job_code: site.client_site_code || '',
              ...(site.address ? { site_address: site.address } : {}),
              ...(site.customer_name ? { customer_name: site.customer_name } : {}),
              ...(site.customer_code ? { customer_code: site.customer_code } : {}),
              ...(site.default_entry_time ? { entry_time: toHalfwidthTime(site.default_entry_time) } : {}),
              ...(site.contact_name
                ? { contact_name: site.contact_name, contact_tel: site.contact_tel, contact_code: '' }
                : {}),
            });
            setSelectedJob((current) =>
              current && current.id === siteDraft.rowId
                ? {
                    ...current,
                    site_code: site.code,
                    site_name: site.name,
                    client_job_code: site.client_site_code || '',
                    ...(site.address ? { site_address: site.address } : {}),
                    ...(site.contact_name ? { contact_name: site.contact_name, contact_tel: site.contact_tel } : {}),
                  }
                : current
            );
            setSiteDraft(null);
            showToast(siteDraft.siteId ? `現場コード ${site.code} を保存しました` : `現場コード ${site.code} を登録しました`);
          }}
        />
      )}
      {contactDraft && companyId && (
        <ContactRegisterDialog
          companyId={companyId}
          draft={contactDraft}
          onClose={() => setContactDraft(null)}
          onCreated={(contact) => {
            setContacts((current) => [...current, contact]);
            const patch =
              contactDraft.target === 'supplier'
                ? {
                    supplier_contact_code: contact.code,
                    supplier_contact_name: contact.name,
                    supplier_contact_tel: contact.tel,
                  }
                : {
                    contact_code: contact.code,
                    contact_name: contact.name,
                    contact_tel: contact.tel,
                  };
            handleUpdateField(contactDraft.rowId, patch);
            setSelectedJob((current) =>
              current && current.id === contactDraft.rowId ? { ...current, ...patch } : current
            );
            setContactDraft(null);
            showToast(`担当者コード ${contact.code} を登録しました`);
          }}
        />
      )}

      {selectedJob && fromBilling && (
        <button
          type="button"
          onClick={() => window.location.assign(backUrl)}
          className="fixed left-2 top-2 z-[200] h-10 rounded-xl bg-teal-700 px-3 text-sm font-black text-white shadow-xl"
        >
          ← 請求明細へ戻る
        </button>
      )}
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
                            { id: undefined, item_name: '', quantity: 1, unit: '', unit_price: 0, amount: 0, notes: '' },
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
                          <div className="col-span-4 min-w-0">
                            <NamePicker
                              freeText
                              value={line.item_name}
                              items={extraItems}
                              title="付帯の項目を選ぶ"
                              placeholder="項目名（選ぶか入力）"
                              onSelect={(name) => {
                                const next = [...extras];
                                next[i] = { ...next[i], item_name: name };
                                const hit = extraProducts.find((p) => p.name === name);
                                if (hit?.unit_name && hit.unit_name !== 'h') next[i].unit = String(hit.unit_name);
                                setExtras(next);
                              }}
                              onCreate={() => registerExtra(i)}
                              className="h-10 w-full px-2.5 rounded-lg border border-slate-300 text-sm font-bold"
                            />
                          </div>
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
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-extrabold text-sm text-slate-800">日程変更・現場連絡先・客先設定</h3>
                    <button
                      type="button"
                      onClick={() => openPrint('request', selectedJob.id)}
                      className="h-9 px-3 rounded-lg border border-slate-300 text-xs font-extrabold"
                    >
                      この行の配車依頼書
                    </button>
                  </div>
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
                          setSelectedJob({ ...selectedJob, entry_time: toHalfwidthTime(e.target.value) })
                        }
                        className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">現場名</label>
                      <SuggestInput
                        value={selectedJob.site_name || ''}
                        placeholder="現場名"
                        title="現場を選ぶ"
                        options={siteChoices(
                          selectedJob.customer_code || '',
                          selectedJob.customer_name || '',
                          selectedJob.site_name || ''
                        )}
                        onChange={(val) => setSelectedJob({ ...selectedJob, site_name: val })}
                        onCreate={() => registerSite(selectedJob)}
                        onPick={(option) => {
                          const hit = sites.find((site) => site.id === option.id);
                          setSelectedJob({
                            ...selectedJob,
                            site_name: hit?.name || option.value,
                            ...(hit
                              ? {
                                  site_code: hit.code || '',
                                  ...(hit.customer_name ? { customer_name: hit.customer_name } : {}),
                                  ...(hit.customer_code ? { customer_code: hit.customer_code } : {}),
                                  ...(hit.address ? { site_address: hit.address } : {}),
                                  ...siteGuestPatch(selectedJob, hit),
                                }
                              : {}),
                          });
                        }}
                        className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                      />
                      {selectedJob.site_name?.trim() && (
                        <button
                          type="button"
                          onClick={() => openSiteMaster(selectedJob)}
                          className="mt-2 h-9 px-3 rounded-lg bg-teal-50 text-teal-900 text-xs font-extrabold"
                        >
                          現場マスタを開く
                        </button>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">工事コード（請求書）</label>
                      <input
                        type="text"
                        value={selectedJob.client_job_code || ''}
                        placeholder="客先の現場コード・工事コード"
                        title="マスタの現場コードとは別です。東栄住宅・住友林業・群峰アクシアなどの請求書に出します。"
                        onChange={(e) => setSelectedJob({ ...selectedJob, client_job_code: e.target.value })}
                        className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">現場住所</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={selectedJob.site_address || ''}
                          placeholder={selectedJob.site_address ? '' : addressOf(selectedJob)}
                          onChange={(e) =>
                            setSelectedJob({ ...selectedJob, site_address: e.target.value })
                          }
                          className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                        />
                        {addressOf(selectedJob) && (
                          <div className="shrink-0 flex flex-col gap-1">
                            <button
                              type="button"
                              onClick={() => openMap(selectedJob)}
                              className="h-11 px-3 rounded-xl border border-slate-300 text-sm font-extrabold"
                            >
                              地図
                            </button>
                            <button
                              type="button"
                              onClick={() => openNearby(selectedJob)}
                              className="h-11 px-3 rounded-xl bg-slate-900 text-white text-sm font-extrabold"
                            >
                              探す
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">庸車（仕入先）</label>
                      <NamePicker
                        value={selectedJob.supplier_name || ''}
                        items={supplierItems}
                        title="庸車先を選ぶ"
                        placeholder="名前・カナ・漢字・英字"
                        onSelect={(name) => {
                          const hit = customers.find(
                            (customer) => customer.name === name && String(customer.partner_type || '').includes('仕入')
                          );
                          const next = {
                            ...selectedJob,
                            supplier_name: name,
                            supplier_code: hit?.code || '',
                            supplier_contact_code: '',
                            supplier_contact_name: '',
                            supplier_contact_tel: '',
                            ...(name ? { operator_name: '', operator_code: '' } : { purchase_amount: null }),
                          };
                          setSelectedJob(next);
                          if (name && selectedJob.purchase_amount == null) {
                            void latestPurchase(hit?.code || '', name).then((amount) => {
                              if (amount == null) return;
                              setSelectedJob((current) =>
                                current && current.id === selectedJob.id && current.supplier_name === name && current.purchase_amount == null
                                  ? { ...current, purchase_amount: amount }
                                  : current
                              );
                            });
                          }
                        }}
                        className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                      />
                    </div>
                    {selectedJob.supplier_name && (
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">仕入金額（税抜・この仕入先の最新額）</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          placeholder="例: 40000"
                          value={selectedJob.purchase_amount ?? ''}
                          onChange={(e) =>
                            setSelectedJob({ ...selectedJob, purchase_amount: e.target.value === '' ? null : Number(e.target.value) })
                          }
                          className="w-full h-11 px-3 rounded-xl border border-slate-300 font-bold"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">現場担当者</label>
                      {contactChooser(
                        selectedJob,
                        (patch) => setSelectedJob({ ...selectedJob, ...patch }),
                        'w-full h-11 px-3 rounded-xl border border-slate-300 font-bold bg-white'
                      )}
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
                      <label className="block text-xs font-bold text-slate-600 mb-1">配車依頼書の備考</label>
                      <textarea
                        rows={3}
                        value={selectedJob.request_notes || ''}
                        placeholder="配車依頼書の備考欄に印刷されます"
                        onChange={(e) => setSelectedJob({ ...selectedJob, request_notes: e.target.value })}
                        className="w-full p-3 rounded-xl border border-slate-300 font-bold"
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
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-extrabold text-sm text-slate-800">オペレーター作業指示内容</h3>
                    <button
                      type="button"
                      onClick={() => openPrint('instruction', selectedJob.id)}
                      className="h-9 px-3 rounded-lg border border-slate-300 text-xs font-extrabold"
                    >
                      この行の作業指示書
                    </button>
                  </div>
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
    {printRequest && (
      <PrintPreview
        kind={printRequest.kind}
        date={
          (printRequest.jobId
            ? (selectedJob?.id === printRequest.jobId ? selectedJob.work_date : dispatches.find((row) => row.id === printRequest.jobId)?.work_date)
            : boardDate) || boardDate
        }
        jobs={
          printRequest.jobId
            ? [
                selectedJob?.id === printRequest.jobId
                  ? selectedJob
                  : dispatches.find((row) => row.id === printRequest.jobId),
              ].filter((row): row is DispatchRecord => Boolean(row))
            : printRequest.kind === 'board'
              ? dispatches
              : dispatches.filter((row) => !row.is_cancelled)
        }
        sites={sites.map((site) => ({
          code: site.code || '',
          name: site.name || '',
          address: site.address || '',
        }))}
        onClose={() => setPrintRequest(null)}
      />
    )}
    {attachJobId && companyId && (
      <AttachDialog companyId={companyId} dispatchId={attachJobId} onClose={() => setAttachJobId(null)} />
    )}
    {mapTarget && (
      <WhiteMapDialog
        address={mapTarget.address}
        date={mapTarget.date}
        siteName={mapTarget.siteName}
        onClose={() => setMapTarget(null)}
      />
    )}
    {nearbyTarget && (
      <NearbyPartners
        address={nearbyTarget.address}
        siteName={nearbyTarget.siteName}
        partners={nearbyPartners}
        onClose={() => setNearbyTarget(null)}
      />
    )}
    </>
  );
}
