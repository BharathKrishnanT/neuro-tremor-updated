import React, { useState, useRef, useEffect } from 'react';
import { Languages, ChevronDown, Check } from 'lucide-react';
import { useLanguage, LANGUAGES, LanguageCode } from '../lib/i18n';

export const LanguageSelector: React.FC = () => {
  const { lang, setLang, t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentLangObj = LANGUAGES.find((l) => l.code === lang) || LANGUAGES[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-xs font-medium shadow-2xs"
        title={t('selectLanguage')}
      >
        <Languages size={14} className="text-sky-700 dark:text-sky-400" />
        <span className="text-xs mr-0.5">{currentLangObj.flag}</span>
        <span className="hidden md:inline">{currentLangObj.nativeName}</span>
        <ChevronDown size={12} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-lg z-50 py-1 max-h-72 overflow-y-auto">
          <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <span>{t('language')}</span>
            <Languages size={11} />
          </div>
          {LANGUAGES.map((item) => {
            const isSelected = item.code === lang;
            return (
              <button
                key={item.code}
                onClick={() => {
                  setLang(item.code as LanguageCode);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left transition-colors ${
                  isSelected
                    ? 'bg-sky-50 text-sky-800 font-medium dark:bg-sky-950/40 dark:text-sky-300'
                    : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <span className="text-sm">{item.flag}</span>
                  <div>
                    <span className="block font-medium leading-none">{item.nativeName}</span>
                    <span className="block text-[10px] text-slate-400 dark:text-slate-500 leading-tight mt-0.5">{item.name}</span>
                  </div>
                </div>
                {isSelected && <Check size={13} className="text-sky-700 dark:text-sky-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
