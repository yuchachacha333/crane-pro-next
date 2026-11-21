'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

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
  className?: string;
};

export default function SuggestInput({
  value,
  placeholder,
  options,
  onChange,
  onPick,
  className,
}: SuggestInputProps) {
  const [open, setOpen] = useState(false);
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
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={box} className="relative min-w-0 w-full flex-1">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        className={className}
      />
      {open && shown.length > 0 && (
        <ul className="absolute left-0 top-full z-30 mt-1 max-h-64 w-[min(360px,80vw)] overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
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
        </ul>
      )}
    </div>
  );
}
