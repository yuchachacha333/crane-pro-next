'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

// あいうえお順の並びと「行」の対応。濁音・半濁音・小文字は元の文字にまとめる。
export const KANA_ROWS: { row: string; chars: string[] }[] = [
  { row: 'あ', chars: ['あ', 'い', 'う', 'え', 'お'] },
  { row: 'か', chars: ['か', 'き', 'く', 'け', 'こ'] },
  { row: 'さ', chars: ['さ', 'し', 'す', 'せ', 'そ'] },
  { row: 'た', chars: ['た', 'ち', 'つ', 'て', 'と'] },
  { row: 'な', chars: ['な', 'に', 'ぬ', 'ね', 'の'] },
  { row: 'は', chars: ['は', 'ひ', 'ふ', 'へ', 'ほ'] },
  { row: 'ま', chars: ['ま', 'み', 'む', 'め', 'も'] },
  { row: 'や', chars: ['や', 'ゆ', 'よ'] },
  { row: 'ら', chars: ['ら', 'り', 'る', 'れ', 'ろ'] },
  { row: 'わ', chars: ['わ', 'を', 'ん'] },
];

const BASE: Record<string, string> = {};
for (const [base, group] of [
  ['あ', 'ぁあ'],
  ['い', 'ぃい'],
  ['う', 'ぅうゔ'],
  ['え', 'ぇえ'],
  ['お', 'ぉお'],
  ['か', 'かが'],
  ['き', 'きぎ'],
  ['く', 'くぐ'],
  ['け', 'けげ'],
  ['こ', 'こご'],
  ['さ', 'さざ'],
  ['し', 'しじ'],
  ['す', 'すず'],
  ['せ', 'せぜ'],
  ['そ', 'そぞ'],
  ['た', 'ただ'],
  ['ち', 'ちぢ'],
  ['つ', 'っつづ'],
  ['て', 'てで'],
  ['と', 'とど'],
  ['は', 'はばぱ'],
  ['ひ', 'ひびぴ'],
  ['ふ', 'ふぶぷ'],
  ['へ', 'へべぺ'],
  ['ほ', 'ほぼぽ'],
  ['や', 'ゃや'],
  ['ゆ', 'ゅゆ'],
  ['よ', 'ょよ'],
  ['わ', 'ゎわ'],
] as const) {
  for (const char of group) BASE[char] = base;
}
for (const { chars } of KANA_ROWS) for (const char of chars) BASE[char] ??= char;

const CHAR_ORDER = KANA_ROWS.flatMap((r) => r.chars);
const ROW_OF_CHAR: Record<string, string> = {};
for (const { row, chars } of KANA_ROWS) for (const char of chars) ROW_OF_CHAR[char] = row;

export function stripCompany(name: string) {
  return String(name || '')
    .replace(/株式会社|有限会社|合同会社|㈱|㈲|（株）|（有）|\(株\)|\(有\)/g, '')
    .replace(/\s+/g, '')
    .trim();
}

export function toHiragana(value: string) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u30a1-\u30f6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

/** 並び替え用の読み。かなに入っている「カブシキガイシャ」等の会社種別は除く */
export function readingOf(kana: string | undefined, name: string) {
  const reading = toHiragana(kana || '')
    .replace(/かぶしきがいしゃ|ゆうげんがいしゃ|ごうどうがいしゃ|ごうしがいしゃ|がいしゃ/g, '')
    .replace(/[\s　]+/g, '');
  return reading || stripCompany(name) || name;
}

/** 読みの先頭文字（あいうえお…のどれか。それ以外は「他」） */
export function headOf(sortText: string) {
  const first = toHiragana(sortText).replace(/^[\s・「」『』ー-]+/, '')[0] || '';
  const base = BASE[first];
  return base && ROW_OF_CHAR[base] ? base : '他';
}

export function useTouchPad() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse), (max-width: 1023px)');
    const apply = () => setTouch(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);
  return touch;
}

export type SheetItem = {
  id: string;
  label: string;
  sub?: string;
  /** 並び替え用の読み（かな）。無ければ label */
  sort: string;
  /** 検索対象の文字（結合済み） */
  haystack: string;
};

export function makeHaystack(...parts: (string | undefined)[]) {
  return parts
    .filter(Boolean)
    .map((part) => toHiragana(String(part)).toLowerCase())
    .join('\n');
}

function compare(a: SheetItem, b: SheetItem) {
  const ga = headOf(a.sort);
  const gb = headOf(b.sort);
  const ia = ga === '他' ? 999 : CHAR_ORDER.indexOf(ga);
  const ib = gb === '他' ? 999 : CHAR_ORDER.indexOf(gb);
  if (ia !== ib) return ia - ib;
  return toHiragana(a.sort).localeCompare(toHiragana(b.sort), 'ja');
}

/**
 * スマホ・iPad 用の全画面の選択画面。
 * あかさたな → あいうえお の2段で絞り込み、読みの順に並べて表示する。
 */
export default function PickerSheet({
  title,
  items,
  current,
  kana = true,
  onPick,
  onClose,
  onFreeText,
  onCreate,
}: {
  title: string;
  items: SheetItem[];
  current?: string;
  kana?: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
  onFreeText?: (text: string) => void;
  onCreate?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [row, setRow] = useState('');
  const [ch, setCh] = useState('');

  // 背面のスクロールを止める
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const sorted = useMemo(() => [...items].sort(compare), [items]);

  const shown = useMemo(() => {
    const q = toHiragana(query).toLowerCase().trim();
    if (q) return sorted.filter((item) => item.haystack.includes(q));
    if (!kana || !row) return sorted;
    return sorted.filter((item) => {
      const head = headOf(item.sort);
      if (row === '他') return head === '他';
      if (ROW_OF_CHAR[head] !== row) return false;
      return !ch || head === ch;
    });
  }, [sorted, query, kana, row, ch]);

  const rowChars = KANA_ROWS.find((r) => r.row === row)?.chars ?? [];
  const groups: { head: string; items: SheetItem[] }[] = [];
  for (const item of shown) {
    const head = kana ? headOf(item.sort) : '';
    const last = groups[groups.length - 1];
    if (last && last.head === head) last.items.push(item);
    else groups.push({ head, items: [item] });
  }

  const chip = (active: boolean) =>
    `h-12 rounded-xl text-lg font-black ${active ? 'bg-teal-700 text-white' : 'bg-slate-200 text-black'}`;

  return createPortal(
    <div
      data-name-picker
      className="fixed inset-0 z-[120] flex h-dvh max-h-dvh flex-col bg-white text-black pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
      <div className="shrink-0 border-b-2 border-slate-300 px-3 pb-3 pt-3">
        <h2 className="mb-2 text-xl font-black text-black">{title}</h2>
        <input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setRow('');
            setCh('');
          }}
          placeholder="文字で探す（名前・カナ・漢字・英字）"
          autoComplete="off"
          className="h-12 w-full rounded-xl border-2 border-slate-400 bg-white px-3 text-lg font-bold text-black placeholder:text-slate-500"
        />
        {onFreeText && query.trim() && (
          <button
            type="button"
            onClick={() => onFreeText(query.trim())}
            className="mt-2 h-12 w-full rounded-xl bg-slate-900 px-3 text-base font-black text-white"
          >
            「{query.trim()}」をそのまま入力
          </button>
        )}
        {kana && !query.trim() && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-6 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setRow('');
                  setCh('');
                }}
                className={chip(!row)}
              >
                全
              </button>
              {[...KANA_ROWS.map((r) => r.row), '他'].map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    setRow(label);
                    setCh('');
                  }}
                  className={chip(row === label)}
                >
                  {label}
                </button>
              ))}
            </div>
            {rowChars.length > 0 && (
              <div className="grid grid-cols-6 gap-1.5">
                <button type="button" onClick={() => setCh('')} className={chip(!ch)}>
                  {row}行
                </button>
                {rowChars.map((char) => (
                  <button key={char} type="button" onClick={() => setCh(char)} className={chip(ch === char)}>
                    {char}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <p className="mt-2 text-sm font-bold text-slate-700">{shown.length}件（読みの順）</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {groups.map((group) => (
          <section key={group.head || 'all'}>
            {group.head && (
              <div className="sticky top-0 z-10 bg-slate-800 px-4 py-1 text-base font-black text-white">{group.head}</div>
            )}
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onPick(item.id)}
                className={`block min-h-14 w-full border-b border-slate-300 px-4 py-2.5 text-left active:bg-teal-100 ${
                  current && (item.label === current || item.id === current) ? 'bg-teal-50' : ''
                }`}
              >
                <span className="block text-lg font-black leading-snug text-black">{item.label}</span>
                {item.sub ? <span className="block text-sm font-bold leading-snug text-slate-700">{item.sub}</span> : null}
              </button>
            ))}
          </section>
        ))}
        {shown.length === 0 && <p className="px-4 py-6 text-base font-bold text-slate-700">該当がありません</p>}
      </div>

      <div className="flex shrink-0 gap-2 border-t-2 border-slate-300 bg-white p-3">
        {onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="h-14 flex-1 rounded-xl bg-teal-700 px-3 text-lg font-black text-white"
          >
            新規登録
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="h-14 flex-1 rounded-xl border-2 border-slate-700 px-3 text-lg font-black text-black"
        >
          閉じる
        </button>
      </div>
    </div>,
    document.body
  );
}
