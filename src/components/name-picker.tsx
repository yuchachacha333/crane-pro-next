'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PickerSheet, { makeHaystack, readingOf, stripCompany, toHiragana, useTouchPad, type SheetItem } from './picker-sheet';

export type NameItem = {
  id: string;
  name: string;
  kana?: string;
  searchWord?: string;
};

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

export default function NamePicker({
  value,
  items,
  placeholder,
  disabled,
  className,
  freeText,
  title,
  onSelect,
}: {
  value: string;
  items: NameItem[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  freeText?: boolean;
  title?: string;
  onSelect: (name: string) => void;
}) {
  const touch = useTouchPad();
  const box = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [place, setPlace] = useState({ top: 0, left: 0, width: 280 });

  const filterText = freeText ? value : query;
  const found = useMemo(() => {
    const text = filterText.trim();
    if (!text) return [];
    return items.filter((item) => matches(item, text)).slice(0, 40);
  }, [filterText, items]);

  const sheetItems = useMemo<SheetItem[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        label: stripCompany(item.name) || item.name,
        sub: item.searchWord || undefined,
        sort: readingOf(item.kana, item.name),
        haystack: makeHaystack(item.name, stripCompany(item.name), item.kana, item.searchWord),
      })),
    [items]
  );
  const nameById = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items]);

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
    setSheet(false);
  }

  const browsing = showAll || (Boolean(freeText) && !filterText.trim());
  const list = browsing ? items.slice(0, 80) : found;

  // スマホ・iPad: 画面いっぱいの専用選択画面
  if (touch) {
    return (
      <div ref={box} className="relative min-w-0 w-full">
        <input
          type="text"
          readOnly
          value={value}
          placeholder={placeholder || 'タップして選ぶ'}
          disabled={disabled}
          onClick={() => !disabled && setSheet(true)}
          className={`${className || ''} cursor-pointer`}
        />
        {sheet && (
          <PickerSheet
            title={title || placeholder || '選択'}
            items={sheetItems}
            current={value}
            onPick={(id) => choose(nameById.get(id) || '')}
            onFreeText={freeText ? (text) => choose(text) : undefined}
            onClose={() => setSheet(false)}
          />
        )}
      </div>
    );
  }

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
            {list.length === 0 && (
              <p className="px-3 py-3 text-xs font-bold text-slate-400">
                {filterText.trim() ? '該当がありません' : '文字を入力してください'}
              </p>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
