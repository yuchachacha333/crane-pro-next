'use client';

import React, { useEffect, useMemo, useState } from 'react';
import AppSidebar from '@/components/app-sidebar';
import { buildAttendance, payrollClosingMonth, payrollPeriod, type AttendanceJob, type OperatorMaster } from '@/lib/attendance';
import { formatJapaneseMonthDay, getTodayIso, getWeekday } from '@/lib/crane-utils';
import { getDefaultCompany, supabase } from '@/lib/supabase';

function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function hoursOf(value: number) {
  return `${Math.round(value * 10) / 10}h`;
}

function money(value: number) {
  return `¥${Math.round(value).toLocaleString('ja-JP')}`;
}

function PayAmount({ pay, planned, workedDays }: { pay: number | null; planned: number | null; workedDays?: number }) {
  if (pay == null) return <>未設定</>;
  return (
    <>
      <div>{money(pay)}</div>
      {planned ? (
        <div className="text-xs font-bold text-sky-800">
          {workedDays != null ? `${workedDays}日分　` : ''}予定分 {money(planned)}
        </div>
      ) : null}
    </>
  );
}

function WithPlanned({ total, planned }: { total: string; planned?: string }) {
  return (
    <>
      <div>{total}</div>
      {planned && <div className="text-xs font-bold text-sky-800">（内予定 {planned}）</div>}
    </>
  );
}

export default function AttendanceClient() {
  const [companyId, setCompanyId] = useState('');
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [today, setToday] = useState('');
  const [month, setMonth] = useState('');
  const [operators, setOperators] = useState<OperatorMaster[]>([]);
  const [jobs, setJobs] = useState<AttendanceJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [wageColumnMissing, setWageColumnMissing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const iso = getTodayIso();
    setToday(iso);
    setMonth(payrollClosingMonth(iso));
    getDefaultCompany()
      .then((company) => {
        setCompanyId(company.id);
        setCompanyName(company.name);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const apply = (rows: OperatorMaster[], missingWageColumn: boolean, queryError?: string) => {
      if (cancelled) return;
      if (queryError) setError(queryError);
      else setOperators(rows);
      setWageColumnMissing(missingWageColumn);
    };
    supabase
      .from('operators')
      .select('code, name, sort_order, daily_wage')
      .eq('company_id', companyId)
      .order('sort_order', { ascending: true })
      .then(({ data, error: queryError }) => {
        if (cancelled) return;
        if (queryError && /daily_wage/i.test(queryError.message)) {
          supabase
            .from('operators')
            .select('code, name, sort_order')
            .eq('company_id', companyId)
            .order('sort_order', { ascending: true })
            .then(({ data: plain, error: plainError }) => {
              apply((plain ?? []) as OperatorMaster[], true, plainError?.message);
            });
          return;
        }
        apply((data ?? []) as OperatorMaster[], false, queryError?.message);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  useEffect(() => {
    if (!companyId || !month) return;
    let cancelled = false;
    setLoading(true);
    setOpen(null);
    const period = payrollPeriod(month);
    if (!period) return;
    const { start, end } = period;
    supabase
      .from('dispatches')
      .select(
        'id, work_date, operator_code, operator_name, supplier_name, is_cancelled, shift_type, start_time, end_time, work_hours, site_name, customer_name, requested_model'
      )
      .eq('company_id', companyId)
      .gte('work_date', start)
      .lte('work_date', end)
      .order('work_date', { ascending: true })
      .then(({ data, error: queryError }) => {
        if (cancelled) return;
        if (queryError) {
          setError(queryError.message);
          setJobs([]);
        } else {
          setError('');
          setJobs((data ?? []) as AttendanceJob[]);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, month]);

  const period = month ? payrollPeriod(month) : null;
  const people = useMemo(
    () => (today && companyName != null ? buildAttendance(operators, jobs, today, companyName) : []),
    [operators, jobs, today, companyName]
  );
  const worked = people.filter((person) => person.dayCount > 0);
  const totals = useMemo(
    () => ({
      people: worked.length,
      days: worked.reduce((sum, person) => sum + person.dayCount, 0),
      scheduledDays: worked.reduce((sum, person) => sum + person.scheduledDays, 0),
      hours: Math.round(worked.reduce((sum, person) => sum + person.hours, 0) * 10) / 10,
      scheduledHours: Math.round(worked.reduce((sum, person) => sum + person.scheduledHours, 0) * 10) / 10,
      overtime: Math.round(worked.reduce((sum, person) => sum + person.overtime, 0) * 10) / 10,
      scheduledOvertime: Math.round(worked.reduce((sum, person) => sum + person.scheduledOvertime, 0) * 10) / 10,
      night: worked.reduce((sum, person) => sum + person.nightDays, 0),
      scheduledNight: worked.reduce((sum, person) => sum + person.scheduledNightDays, 0),
      missing: worked.reduce((sum, person) => sum + person.missingJobs, 0),
      pay: worked.reduce((sum, person) => sum + (person.pay ?? 0), 0),
      scheduledPay: worked.reduce((sum, person) => sum + (person.scheduledPay ?? 0), 0),
      unsetWage: worked.filter((person) => person.dailyWage == null).length,
    }),
    [worked]
  );

  const th = 'border border-slate-500 px-3 py-2 font-extrabold whitespace-nowrap text-sm';
  const td = 'border border-slate-300 px-3 py-2.5 whitespace-nowrap';

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col md:flex-row">
      <AppSidebar active="attendance" />
      <main className="flex-1 min-w-0 p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">出勤・給与</h1>
            <p className="text-sm text-slate-600 mt-1">
              自社オペレーターの給与月度です。20日締め（前月21日〜当月20日）で集計します。今日までの日を出勤、明日以降を予定として、出勤合計の内数で出します。給与は、従業員ごとの日給に今日までの出勤日数を掛けた額です。予定の日は給与に入れず、予定分として別に出します。日給が空の山科重機工業の従業員は2万円です。同じ日に配車が複数あっても1日分で、残業では割り増しません。キャンセルと庸車は除きます。
            </p>
            {wageColumnMissing && (
              <p className="mt-1 text-sm font-bold text-amber-800">
                従業員ごとの日給を保存するには、Supabaseで supabase/operator_daily_wage.sql を実行してください。それまでは山科重機工業の日給2万円で計算します。
              </p>
            )}
            {period && (
              <p className="mt-1 text-base font-black text-slate-800">
                {Number(period.end.slice(5, 7))}月度　{formatJapaneseMonthDay(period.start)}〜{formatJapaneseMonthDay(period.end)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="h-14 w-14 rounded-2xl border-2 border-slate-400 bg-white text-xl font-black">
              ◀
            </button>
            <input
              type="month"
              value={month}
              onChange={(event) => event.target.value && setMonth(event.target.value)}
              className="h-14 min-w-44 rounded-2xl border-2 border-slate-400 bg-white px-4 text-xl font-black text-black"
            />
            <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} className="h-14 w-14 rounded-2xl border-2 border-slate-400 bg-white text-xl font-black">
              ▶
            </button>
          </div>
        </div>

        {error && <p className="mb-3 text-sm font-bold text-rose-700">{error}</p>}

        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {[
            { label: '出勤した従業員', value: `${totals.people}人`, sub: `マスタ ${operators.length}人` },
            { label: '出勤合計', value: `${totals.days}日`, sub: totals.scheduledDays ? `内予定 ${totals.scheduledDays}日` : '予定はありません' },
            {
              label: '給与',
              value: totals.people > 0 && totals.unsetWage === totals.people ? '未設定' : money(totals.pay),
              sub: [totals.scheduledPay ? `予定分 ${money(totals.scheduledPay)}` : '今日までの出勤 × 日給', totals.unsetWage ? `単価未設定 ${totals.unsetWage}人` : ''].filter(Boolean).join('　'),
            },
            { label: '実働時間', value: hoursOf(totals.hours), sub: totals.scheduledHours ? `内予定 ${hoursOf(totals.scheduledHours)}` : '' },
            { label: '残業', value: hoursOf(totals.overtime), sub: totals.scheduledOvertime ? `内予定 ${hoursOf(totals.scheduledOvertime)}` : '1日8時間を超えた分' },
            { label: '夜勤', value: `${totals.night}日`, sub: [totals.scheduledNight ? `内予定 ${totals.scheduledNight}日` : '', totals.missing ? `時間未入力 ${totals.missing}件` : ''].filter(Boolean).join('　') },
          ].map((card) => (
            <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-extrabold text-slate-600">{card.label}</div>
              <div className="mt-1 text-2xl font-black text-black">{card.value}</div>
              {card.sub && <div className="text-xs font-bold text-slate-600">{card.sub}</div>}
            </div>
          ))}
        </div>

        {loading && <p className="mb-3 text-sm font-bold text-slate-600">集計しています...</p>}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-base">
              <thead>
                <tr className="bg-slate-800 text-left text-white">
                  <th className={th}>従業員</th>
                  <th className={`${th} text-right`}>日給</th>
                  <th className={`${th} text-right`}>出勤合計</th>
                  <th className={`${th} text-right`}>給与</th>
                  <th className={`${th} text-right`}>実働</th>
                  <th className={`${th} text-right`}>所定内</th>
                  <th className={`${th} text-right`}>残業</th>
                  <th className={`${th} text-right`}>夜勤</th>
                  <th className={`${th} text-right`}>配車</th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => {
                  const isOpen = open === person.key;
                  return (
                    <React.Fragment key={person.key}>
                      <tr onClick={() => setOpen(isOpen ? null : person.key)} className="cursor-pointer border-t border-slate-200 hover:bg-teal-50">
                        <td className={`${td} font-black`}>
                          {isOpen ? '▼' : '▶'} {person.name}
                          {person.code && <span className="ml-2 text-xs font-bold text-slate-500">{person.code}</span>}
                          {!person.registered && <span className="ml-2 text-xs font-bold text-rose-700">マスタ未登録</span>}
                          {person.dayCount === 0 && <span className="ml-2 text-xs font-bold text-slate-500">出勤なし</span>}
                        </td>
                        <td className={`${td} text-right font-black`}>{person.dailyWage == null ? '未設定' : money(person.dailyWage)}</td>
                        <td className={`${td} text-right font-black`}>
                          <WithPlanned total={`${person.dayCount}日`} planned={person.scheduledDays ? `${person.scheduledDays}日` : undefined} />
                        </td>
                        <td className={`${td} text-right font-black`}>
                          <PayAmount pay={person.pay} planned={person.scheduledPay} workedDays={person.workedDays} />
                        </td>
                        <td className={`${td} text-right font-bold`}>
                          <WithPlanned total={hoursOf(person.hours)} planned={person.scheduledHours ? hoursOf(person.scheduledHours) : undefined} />
                        </td>
                        <td className={`${td} text-right font-bold`}>{hoursOf(person.regular)}</td>
                        <td className={`${td} text-right font-bold`}>
                          {person.overtime ? (
                            <WithPlanned total={hoursOf(person.overtime)} planned={person.scheduledOvertime ? hoursOf(person.scheduledOvertime) : undefined} />
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className={`${td} text-right font-bold`}>
                          {person.nightDays ? (
                            <WithPlanned total={`${person.nightDays}日`} planned={person.scheduledNightDays ? `${person.scheduledNightDays}日` : undefined} />
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className={`${td} text-right font-bold`}>
                          {person.jobCount}
                          {person.missingJobs > 0 && <span className="ml-1 text-xs text-amber-800">時間未入力{person.missingJobs}</span>}
                        </td>
                      </tr>
                      {isOpen &&
                        person.days.map((day) => (
                          <tr key={`${person.key}-${day.date}`} className={`text-sm ${day.scheduled ? 'bg-sky-50' : 'bg-slate-50'}`}>
                            <td className="border border-slate-300 py-2 pl-8 pr-3">
                              <div className="font-bold">
                                {formatJapaneseMonthDay(day.date)}（{getWeekday(day.date)}）
                                {day.scheduled && <span className="ml-2 text-xs font-black text-sky-800">予定</span>}
                                {day.night && <span className="ml-2 text-xs font-black text-indigo-800">夜勤</span>}
                              </div>
                              {day.jobs.map((job) => (
                                <div key={job.id} className="text-xs font-bold text-slate-600">
                                  {job.site || '現場未入力'}
                                  {job.customer ? `　${job.customer}` : ''}
                                  {job.model ? `　${job.model}` : ''}
                                  {`　${job.shift}`}
                                  {(job.start || job.end) && `　${job.start || '—'}〜${job.end || '—'}`}
                                  {job.hours == null ? '　時間未入力' : `　${hoursOf(job.hours)}`}
                                </div>
                              ))}
                            </td>
                            <td className="border border-slate-300" />
                            <td className="border border-slate-300" />
                            <td className={`${td} text-right font-bold ${day.scheduled ? 'text-sky-800' : ''}`}>
                              {person.dailyWage == null ? '—' : day.scheduled ? `予定 ${money(person.dailyWage)}` : money(person.dailyWage)}
                            </td>
                            <td className={`${td} text-right font-bold`}>{hoursOf(day.hours)}</td>
                            <td className={`${td} text-right font-bold`}>{hoursOf(day.regular)}</td>
                            <td className={`${td} text-right font-bold`}>{day.overtime ? hoursOf(day.overtime) : '—'}</td>
                            <td className={`${td} text-right font-bold`}>{day.night ? '夜' : '昼'}</td>
                            <td className={`${td} text-right font-bold`}>{day.jobs.length}</td>
                          </tr>
                        ))}
                      {isOpen && person.days.length === 0 && (
                        <tr className="bg-slate-50 text-sm">
                          <td colSpan={9} className="border border-slate-300 px-8 py-3 font-bold text-slate-600">
                            この月の配車はありません。
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {!loading && companyName != null && people.length === 0 && (
                  <tr>
                    <td colSpan={9} className="border border-slate-300 px-4 py-6 text-sm font-bold text-slate-600">
                      オペレーターマスタがまだありません。マスタ台帳で自社の従業員を登録すると、ここに出ます。
                    </td>
                  </tr>
                )}
              </tbody>
              {worked.length > 0 && (
                <tfoot>
                  <tr className="border-t-4 border-slate-800 bg-slate-50 font-black">
                    <td className={td}>合計</td>
                    <td className={td} />
                    <td className={`${td} text-right`}>
                      <WithPlanned total={`${totals.days}日`} planned={totals.scheduledDays ? `${totals.scheduledDays}日` : undefined} />
                    </td>
                    <td className={`${td} text-right`}>
                      <PayAmount pay={totals.unsetWage === worked.length ? null : totals.pay} planned={totals.scheduledPay} />
                    </td>
                    <td className={`${td} text-right`}>
                      <WithPlanned total={hoursOf(totals.hours)} planned={totals.scheduledHours ? hoursOf(totals.scheduledHours) : undefined} />
                    </td>
                    <td className={`${td} text-right`}>{hoursOf(Math.round(worked.reduce((sum, person) => sum + person.regular, 0) * 10) / 10)}</td>
                    <td className={`${td} text-right`}>
                      <WithPlanned total={hoursOf(totals.overtime)} planned={totals.scheduledOvertime ? hoursOf(totals.scheduledOvertime) : undefined} />
                    </td>
                    <td className={`${td} text-right`}>
                      <WithPlanned total={`${totals.night}日`} planned={totals.scheduledNight ? `${totals.scheduledNight}日` : undefined} />
                    </td>
                    <td className={`${td} text-right`}>{worked.reduce((sum, person) => sum + person.jobCount, 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
