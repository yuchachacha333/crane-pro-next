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

function matches(item: NameItem, raw: string) {
  const text = raw.normalize('NFKC').trim();
  if (!text) return false;
  const folded = text.toLowerCase();
  const hira = toHiragana(text);
  const name = String(item.name || '');
  const stripped = stripCompany(name);
  const kana = toHiragana(item.kana || '');
  const word = String(item.searchWord || '').normalize('NFKC').toLowerCase();
  return (
    name.toLowerCase().includes(folded) ||
    stripped.toLowerCase().includes(folded) ||
    toHiragana(name).includes(hira) ||
    toHiragana(stripped).includes(hira) ||
    kana.includes(hira) ||
    (word.length > 0 && (word.startsWith(folded) || word.includes(folded)))
  );
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
  freeText,
  onSelect,
}: {
  value: string;
  items: NameItem[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  freeText?: boolean;
  onSelect: (name: string) => void;
}) {
  const touch = useTouchPad();
  const box = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [row, setRow] = useState<(typeof ROWS)[number] | ''>('');
  const [place, setPlace] = useState({ top: 0, left: 0, width: 280 });

  const filterText = freeText ? value : query;
  const found = useMemo(() => {
    const text = filterText.trim();
    if (!text) return [];
    return items.filter((item) => matches(item, text)).slice(0, 40);
  }, [filterText, items]);

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
      const target = event.target instanceof Element ? event.target : (event.target as Node | null)?.parentElement;
      if (target && box.current?.contains(target)) return;
      if (target?.closest('[data-name-picker]')) return;
      setOpen(false);
      setShowAll(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function choose(name: string) {
    onSelect(name);
    setQuery('');
    setOpen(false);
    setShowAll(false);
    setRow('');
  }

  const browsing = showAll || (Boolean(freeText) && !filterText.trim() && !row);
  const list = browsing ? items.slice(0, 80) : !filterText.trim() ? byRow : found;
  const waiting = touch && !filterText.trim() && !row && !showAll;

  return (
    <div ref={box} className="relative min-w-0 w-full">
      <input
        type="text"
        value={freeText ? value : open ? query : value}
        placeholder={placeholder || '名前・カナ・漢字・英字'}
        disabled={disabled}
        autoComplete="off"
        onFocus={(event) => {
          if (disabled) return;
          setOpen(true);
          placeList();
          if (!freeText) {
            setQuery(value);
            event.currentTarget.select();
          }
        }}
        onChange={(event) => {
          setShowAll(false);
          setRow('');
          if (freeText) onSelect(event.target.value);
          else setQuery(event.target.value);
          setOpen(true);
          placeList();
        }}
        className={`${className || ''} ${freeText ? 'pr-8' : ''}`}
      />
      {freeText && (
        <button
          type="button"
          disabled={disabled}
          aria-label="候補一覧"
          onMouseDown={(event) => {
            event.preventDefault();
            if (disabled) return;
            setShowAll(true);
            setRow('');
            setOpen(true);
            placeList();
          }}
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md text-xs font-extrabold text-slate-600 hover:bg-slate-100"
        >
          ▼
        </button>
      )}
      {open &&
        createPortal(
          <div
            data-name-picker
            className="fixed z-[80] max-h-80 overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl"
            style={{ top: place.top, left: place.left, width: Math.min(Math.max(place.width, 280), window.innerWidth - 16) }}
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
                      setShowAll(false);
                    }}
                    className={`h-10 rounded-lg text-sm font-extrabold ${row === label ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-800'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
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
            {waiting && <p className="px-3 py-3 text-xs font-bold text-slate-400">文字を入力するか、あかさたなを押してください</p>}
            {!waiting && list.length === 0 && <p className="px-3 py-3 text-xs font-bold text-slate-400">該当がありません</p>}
          </div>,
          document.body
        )}
    </div>
  );
}
