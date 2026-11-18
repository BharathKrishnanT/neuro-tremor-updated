import React, { useState, useEffect } from 'react';
import { Shield, Check, Info } from 'lucide-react';
import { useLanguage } from '../lib/i18n';

interface ConsentBannerProps {
  onOpenSecurityModal: (tab?: 'medical' | 'privacy' | 'cookies' | 'security') => void;
}

const CONSENT_STORAGE_KEY = 'neurotremor_privacy_accepted';

export const ConsentBanner: React.FC<ConsentBannerProps> = ({ onOpenSecurityModal }) => {
  const [isVisible, setIsVisible] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    try {
      const accepted = localStorage.getItem(CONSENT_STORAGE_KEY);
      if (!accepted) {
        setIsVisible(true);
      }
    } catch (e) {
      // In case localStorage is blocked
      setIsVisible(false);
    }
  }, []);

  const handleAccept = () => {
    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, 'true');
    } catch (e) {}
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 p-3 sm:p-3.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 shadow-lg transition-all">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-slate-700 dark:text-slate-300">
        <div className="flex items-start gap-2.5">
          <div className="p-1.5 rounded-md bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-800 shrink-0 mt-0.5">
            <Shield size={15} />
          </div>
          <div className="space-y-0.5">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {t('privacyBannerTitle') || "Zero Tracking, Privacy & Clinical Decision Support Notice"}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              NeuroTremor processes telemetry locally via edge ML and utilizes only functional local storage for sensor offsets and language. This tool is for investigational screening and does not replace medical diagnosis.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
          <button
            onClick={() => onOpenSecurityModal('medical')}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5"
          >
            <Info size={13} />
            <span>{t('learnMore') || "Review Policies"}</span>
          </button>
          <button
            onClick={handleAccept}
            className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-900 text-white dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-100 shadow-2xs transition-colors flex items-center gap-1.5"
          >
            <Check size={13} />
            <span>{t('acceptAndProceed') || "Acknowledge"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
