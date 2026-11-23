'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PickerSheet, { makeHaystack, useTouchPad, type SheetItem } from './picker-sheet';

export type SuggestOption = {
  id: string;
  value: string;
  hint?: string;
};

type SuggestInputProps = {
  value: string;
  placeholder?: string;
  options: SuggestOption[];
  onChange: (value: string) => void;
  onPick: (option: SuggestOption) => void;
  onCreate?: () => void;
  className?: string;
  title?: string;
};

export default function SuggestInput({
  value,
  placeholder,
  options,
  onChange,
  onPick,
  onCreate,
  className,
  title,
}: SuggestInputProps) {
  const touch = useTouchPad();
  const [sheet, setSheet] = useState(false);
  const sheetItems = useMemo<SheetItem[]>(
    () =>
      options.map((option) => ({
        id: option.id,
        label: option.value,
        sub: option.hint,
        sort: option.value,
        haystack: makeHaystack(option.value, option.hint),
      })),
    [options]
  );
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ top: 0, left: 0, width: 280 });
  const box = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const query = value.trim();
    const matched = query
      ? options.filter((option) => `${option.value} ${option.hint || ''}`.includes(query))
      : options;
    return matched.slice(0, 30);
  }, [options, value]);

  useEffect(() => {
    function close(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : (event.target as Node | null)?.parentElement;
      if (target && box.current?.contains(target)) return;
      if (target?.closest('[data-suggest-list]')) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  function placeList() {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    setPlace({ top: rect.bottom + 4, left: Math.max(8, rect.left), width: Math.max(rect.width, 280) });
  }

  if (touch) {
    return (
      <div ref={box} className="relative min-w-0 w-full flex-1">
        <input
          type="text"
          readOnly
          value={value}
          placeholder={placeholder || 'タップして選ぶ'}
          onClick={() => setSheet(true)}
          className={`${className || ''} cursor-pointer`}
        />
        {sheet && (
          <PickerSheet
            title={title || placeholder || '選択'}
            items={sheetItems}
            current={value}
            kana={false}
            onPick={(id) => {
              const option = options.find((o) => o.id === id);
              if (option) onPick(option);
              setSheet(false);
            }}
            onFreeText={(text) => {
              onChange(text);
              setSheet(false);
            }}
            onCreate={onCreate ? () => { onCreate(); setSheet(false); } : undefined}
            onClose={() => setSheet(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div ref={box} className="relative min-w-0 w-full flex-1">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => {
          placeList();
          setOpen(true);
        }}
        onChange={(event) => {
          onChange(event.target.value);
          placeList();
          setOpen(true);
        }}
        className={className}
      />
      {open &&
        (shown.length > 0 || onCreate) &&
        createPortal(
          <ul
            data-suggest-list
            className="fixed z-[80] max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl"
            style={{ top: place.top, left: place.left, width: Math.min(place.width, window.innerWidth - 16) }}
          >
            {shown.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onPick(option);
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-2 text-left hover:bg-teal-50"
                >
                  <span className="block text-sm font-bold text-slate-900">{option.value}</span>
                  {option.hint ? <span className="block text-[11px] font-medium text-slate-500">{option.hint}</span> : null}
                </button>
              </li>
            ))}
            {onCreate && (
              <li>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onCreate();
                    setOpen(false);
                  }}
                  className="block w-full border-t border-slate-100 px-3 py-2 text-left text-sm font-extrabold text-teal-800 hover:bg-teal-50"
                >
                  新規登録
                </button>
              </li>
            )}
          </ul>,
          document.body
        )}
    </div>
  );
}
