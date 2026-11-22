'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type NameItem = {
  id: string;
  name: string;
  kana?: string;
  searchWord?: string;
};

const ROWS = ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ', '他'] as const;

const ROW_OF: Record<string, (typeof ROWS)[number]> = {};
for (const [row, chars] of [
  ['あ', 'あいうえお'],
  ['か', 'かきくけこがぎぐげご'],
  ['さ', 'さしすせそざじずぜぞ'],
  ['た', 'たちつてとだぢづでど'],
  ['な', 'なにぬねの'],
  ['は', 'はひふへほばびぶべぼぱぴぷぺぽ'],
  ['ま', 'まみむめも'],
  ['や', 'やゆよ'],
  ['ら', 'らりるれろ'],
  ['わ', 'わをん'],
] as const) {
  for (const char of chars) ROW_OF[char] = row;
}

function stripCompany(name: string) {
  return String(name || '')
    .replace(/株式会社|有限会社|合同会社|㈱|㈲|（株）|（有）|\(株\)|\(有\)/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function toHiragana(value: string) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u30a1-\u30f6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

function rowOf(item: NameItem) {
  const source = toHiragana(item.kana || stripCompany(item.name));
  const head = source.replace(/^[ぁぃぅぇぉっゃゅょ]/, '')[0] || '';
  return ROW_OF[head] || '他';
}

function useTouchPad() {
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

export default function NamePicker({
  value,
  items,
  placeholder,
  disabled,
  className,
  onSelect,
}: {
  value: string;
  items: NameItem[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onSelect: (name: string) => void;
}) {
  const touch = useTouchPad();
  const box = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<(typeof ROWS)[number] | ''>('');
  const [place, setPlace] = useState({ top: 0, left: 0, width: 280 });

  const latin = /^[a-zA-Z]+$/.test(query.trim());
  const matches = useMemo(() => {
    const text = query.trim();
    if (!text) return [];
    const folded = text.toLowerCase();
    return items
      .filter((item) => {
        const word = String(item.searchWord || '').toLowerCase();
        const name = stripCompany(item.name).toLowerCase();
        const kana = toHiragana(item.kana || '');
        if (latin) return word.startsWith(folded) || name.includes(folded) || kana.includes(folded);
        return name.includes(text) || String(item.name || '').includes(text) || kana.includes(toHiragana(text));
      })
      .slice(0, 40);
  }, [items, latin, query]);

  const byRow = useMemo(() => {
    if (!row) return [];
    return items.filter((item) => rowOf(item) === row).slice(0, 80);
  }, [items, row]);

  function placeList() {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    setPlace({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 280) });
  }

  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      const target = event.target as Node;
      if (box.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.('[data-name-picker]')) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function choose(name: string) {
    onSelect(name);
    setQuery('');
    setOpen(false);
    setRow('');
  }

  const list = touch && !query ? byRow : matches;
  const hint = latin && query.trim().length < 3 ? '検索ワードは3文字入れてください' : '';

  return (
    <div ref={box} className="relative min-w-0 w-full">
      <input
        type="text"
        value={open && !touch ? query : value}
        placeholder={touch ? placeholder || 'あかさたなから選ぶ' : placeholder || '検索ワード3文字'}
        disabled={disabled}
        readOnly={touch}
        autoComplete="off"
        onFocus={() => {
          if (disabled) return;
          setOpen(true);
          placeList();
          if (!touch) setQuery('');
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          placeList();
        }}
        className={className}
      />
      {open &&
        createPortal(
          <div
            data-name-picker
            className="fixed z-[80] max-h-80 overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl"
            style={{ top: place.top, left: place.left, width: touch ? Math.min(place.width, window.innerWidth - 16) : place.width }}
          >
            {touch && (
              <div className="grid grid-cols-6 gap-1 p-2">
                {ROWS.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setRow(label);
                      setQuery('');
                    }}
                    className={`h-10 rounded-lg text-sm font-extrabold ${row === label ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-800'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {hint && <p className="px-3 py-2 text-xs font-bold text-slate-500">{hint}</p>}
            {list.map((item) => (
              <button
                key={item.id}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(item.name);
                }}
                className="block w-full px-3 py-2 text-left hover:bg-teal-50"
              >
                <span className="block text-sm font-bold text-slate-900">{stripCompany(item.name) || item.name}</span>
                {item.searchWord ? <span className="block text-[11px] font-medium text-slate-500">{item.searchWord}</span> : null}
              </button>
            ))}
            {!hint && list.length === 0 && <p className="px-3 py-3 text-xs font-bold text-slate-400">該当がありません</p>}
          </div>,
          document.body
        )}
    </div>
  );
}
