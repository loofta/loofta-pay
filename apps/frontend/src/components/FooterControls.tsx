'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Globe, DollarSign, Check, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect, useCallback, useId } from 'react';

// Add new locales here when ready
const LOCALE_OPTIONS = [
  { value: 'en', label: 'English', flag: '🇺🇸' },
  { value: 'pt-BR', label: 'Português (BR)', flag: '🇧🇷' },
  { value: 'fr', label: 'Français', flag: '🇫🇷' },
  { value: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { value: 'it', label: 'Italiano', flag: '🇮🇹' },
  { value: 'tr', label: 'Türkçe', flag: '🇹🇷' },
  { value: 'zh-CN', label: '中文（简体）', flag: '🇨🇳' },
  { value: 'ko', label: '한국어', flag: '🇰🇷' },
  { value: 'ja', label: '日本語', flag: '🇯🇵' },
  { value: 'id', label: 'Bahasa Indonesia', flag: '🇮🇩' },
  { value: 'fil', label: 'Filipino', flag: '🇵🇭' },
  { value: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { value: 'ar', label: 'العربية', flag: '🇸🇦' },
  { value: 'hi', label: 'हिन्दी', flag: '🇮🇳' },
] as const;

export function LocalePicker({ dropDirection = 'up' }: { dropDirection?: 'up' | 'down' } = {}) {
  const locale = useLocale();
  const t = useTranslations('Footer');
  const [open, setOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const listId = `${uid}-list`;

  const currentOption = LOCALE_OPTIONS.find(o => o.value === locale) ?? LOCALE_OPTIONS[0];
  const currentIdx = LOCALE_OPTIONS.findIndex(o => o.value === locale);

  const switchLocale = useCallback((newLocale: string) => {
    document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    window.location.reload();
  }, []);

  const openMenu = useCallback(() => {
    setOpen(true);
    setFocusedIdx(currentIdx >= 0 ? currentIdx : 0);
  }, [currentIdx]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setFocusedIdx(-1);
    triggerRef.current?.focus();
  }, []);

  // Close on outside click / outside touch
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open, closeMenu]);

  // Scroll focused item into view inside the list
  useEffect(() => {
    if (focusedIdx < 0 || !listRef.current) return;
    const item = listRef.current.children[focusedIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [focusedIdx]);

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openMenu();
    }
  };

  const handleListKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        closeMenu();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIdx(i => Math.min(i + 1, LOCALE_OPTIONS.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIdx(i => Math.max(i - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setFocusedIdx(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusedIdx(LOCALE_OPTIONS.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIdx >= 0) {
          switchLocale(LOCALE_OPTIONS[focusedIdx].value);
        }
        break;
      case 'Tab':
        closeMenu();
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={t('language')}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        className={[
          'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
          'border transition-colors duration-150 select-none cursor-pointer',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30',
          open
            ? 'border-white/20 bg-white/[0.07] text-slate-200'
            : 'border-white/10 bg-transparent text-slate-400 hover:border-white/20 hover:text-slate-200',
        ].join(' ')}
      >
        <Globe className="h-4 w-4 text-slate-500 shrink-0" aria-hidden="true" />
        <span aria-hidden="true" className="leading-none">{currentOption.flag}</span>
        <span className="hidden sm:inline">{currentOption.label}</span>
        <ChevronDown
          aria-hidden="true"
          className={[
            'h-3.5 w-3.5 text-slate-500 transition-transform duration-200 shrink-0',
            open ? 'rotate-180' : '',
          ].join(' ')}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={t('language')}
          aria-activedescendant={focusedIdx >= 0 ? `${uid}-opt-${focusedIdx}` : undefined}
          tabIndex={-1}
          onKeyDown={handleListKeyDown}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role
          autoFocus
          className={[
            dropDirection === 'down' ? 'absolute top-full left-0 mt-2 z-50' : 'absolute bottom-full left-0 mb-2 z-50',
            'w-52 max-h-64 overflow-y-auto overscroll-contain',
            'rounded-xl border border-white/[0.1]',
            'bg-[#0d0f16] shadow-[0_-4px_32px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.04)]',
            'py-1 focus:outline-none',
          ].join(' ')}
        >
          {LOCALE_OPTIONS.map((opt, i) => {
            const selected = opt.value === locale;
            const focused = i === focusedIdx;
            return (
              <li
                key={opt.value}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setFocusedIdx(i)}
                onClick={() => switchLocale(opt.value)}
                className={[
                  'flex items-center gap-3 px-3 py-2.5 cursor-pointer text-sm',
                  'transition-colors duration-75',
                  focused ? 'bg-white/[0.07]' : '',
                  selected ? 'text-slate-100' : 'text-slate-400',
                ].join(' ')}
              >
                <span aria-hidden="true" className="text-base leading-none w-5 text-center shrink-0">
                  {opt.flag}
                </span>
                <span className="flex-1 min-w-0 truncate">{opt.label}</span>
                {selected && (
                  <Check className="h-3.5 w-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function FooterControls() {
  const t = useTranslations('Footer');

  return (
    <div className="flex flex-wrap items-center gap-3 mt-8 pt-6 border-t border-gray-800">
      <LocalePicker />

      {/* Currency — single option, visually disabled */}
      <div
        aria-label={t('currency')}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm border border-white/10 text-slate-500 opacity-60 cursor-not-allowed select-none"
      >
        <DollarSign className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>USD</span>
      </div>
    </div>
  );
}
