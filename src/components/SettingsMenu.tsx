import React, { useState, useRef, useEffect } from 'react';
import { Settings, Shield, LogIn, LogOut, Sun, Moon, Target, CheckCircle2, ChevronRight, User, Cloud, CloudOff, RefreshCw, Sliders, Zap } from 'lucide-react';
import { useLanguage } from '../lib/i18n';
import type { User as FirebaseUser } from 'firebase/auth';
import type { SensitivityLevel } from '../lib/mlService';

interface SettingsMenuProps {
  user: FirebaseUser | null;
  onSignIn: () => void;
  onSignInAsGuest?: () => void;
  onSignOut: () => void;
  onOpenSecurityModal: (tab?: 'medical' | 'privacy' | 'cookies' | 'security') => void;
  isHighContrast: boolean;
  onToggleHighContrast: () => void;
  onOpenCalibration: () => void;
  isCalibrating?: boolean;
  hasOffsets?: boolean;
  firebaseStatus?: { connected: boolean; latencyMs?: number; checking: boolean; error?: string };
  onTestFirebase?: () => void;
  sensitivity?: SensitivityLevel;
  sensitivityMultiplier?: number;
  onChangeSensitivity?: (level: SensitivityLevel) => void;
  onChangeSensitivityMultiplier?: (mult: number) => void;
}

export const SettingsMenu: React.FC<SettingsMenuProps> = ({
  user,
  onSignIn,
  onSignInAsGuest,
  onSignOut,
  onOpenSecurityModal,
  isHighContrast,
  onToggleHighContrast,
  onOpenCalibration,
  isCalibrating = false,
  hasOffsets = false,
  firebaseStatus,
  onTestFirebase,
  sensitivity = 'normal',
  sensitivityMultiplier = 1.35,
  onChangeSensitivity,
  onChangeSensitivityMultiplier,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { t } = useLanguage();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={menuRef}>
      {/* Settings Icon Button in the Left Corner */}
      <button
        id="header-settings-button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`relative flex items-center justify-center w-8 h-8 rounded-md border transition-all duration-150 shadow-2xs ${
          isOpen
            ? 'bg-slate-200 text-slate-900 border-slate-300 dark:bg-slate-800 dark:text-white dark:border-slate-700'
            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-slate-900 dark:bg-slate-800/90 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700 dark:hover:text-white'
        }`}
        title={t('settings') || 'Settings & Security'}
        aria-label="Application Settings"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Settings
          size={16}
          className={`transition-transform duration-200 ${
            isOpen ? 'rotate-90 text-sky-700 dark:text-sky-400' : ''
          }`}
        />
        {user && (
          <span
            className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900"
            title="User Signed In"
          />
        )}
      </button>

      {/* Settings Dropdown Popover */}
      {isOpen && (
        <div
          id="header-settings-dropdown"
          role="menu"
          aria-label="Settings Menu"
          className="absolute left-0 mt-2 w-84 sm:w-92 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl z-50 p-3 text-slate-800 dark:text-slate-200 divide-y divide-slate-100 dark:divide-slate-800 animate-in fade-in duration-100 max-h-[85vh] overflow-y-auto"
        >
          {/* Menu Header */}
          <div className="pb-2.5 px-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-5 h-5 rounded bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 flex items-center justify-center text-sky-700 dark:text-sky-400">
                  <Settings size={12} />
                </div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                  {t('settings') || 'Settings'}
                </h3>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                v2.5 Sec
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Account sync, cloud connectivity & sensitivity tuning
            </p>
          </div>

          {/* SECTION 1: Cloud & Connectivity Status */}
          <div className="py-2.5 px-1 space-y-2">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <span className="flex items-center gap-1">
                <Cloud size={11} /> Firebase Firestore
              </span>
              <button
                onClick={() => onTestFirebase && onTestFirebase()}
                disabled={firebaseStatus?.checking}
                className="text-[10px] text-sky-700 dark:text-sky-400 hover:underline flex items-center gap-0.5 font-mono normal-case disabled:opacity-50"
                title="Ping Firestore database"
              >
                <RefreshCw size={10} className={firebaseStatus?.checking ? "animate-spin" : ""} />
                {firebaseStatus?.checking ? "Testing..." : "Ping Status"}
              </button>
            </div>

            <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${firebaseStatus?.connected ? 'bg-emerald-500 ring-2 ring-emerald-200 dark:ring-emerald-950' : firebaseStatus?.checking ? 'bg-amber-400 animate-pulse' : 'bg-rose-500'}`} />
                <div>
                  <div className="text-xs font-medium text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <span>{firebaseStatus?.connected ? 'Firestore Connected' : firebaseStatus?.checking ? 'Checking Connection...' : 'Offline / Reconnecting'}</span>
                    {firebaseStatus?.latencyMs !== undefined && (
                      <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-1 py-0.2 rounded border border-emerald-200 dark:border-emerald-800">
                        {firebaseStatus.latencyMs}ms
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    {firebaseStatus?.connected 
                      ? 'Secure remote storage active for patient sessions' 
                      : firebaseStatus?.error || 'Local cache enabled — data auto-syncs when online'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: Account / Authentication */}
          <div className="py-2.5 px-1 space-y-2">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <span>{t('account') || 'Account & Sync'}</span>
              {user && (
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400 font-medium normal-case font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  {user.isAnonymous ? 'GUEST CLOUD' : 'AUTHENTICATED'}
                </span>
              )}
            </div>

            {user ? (
              <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 overflow-hidden">
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || 'User'}
                      className="w-7 h-7 rounded-full border border-slate-300 dark:border-slate-600 shrink-0"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 flex items-center justify-center shrink-0">
                      <User size={14} />
                    </div>
                  )}
                  <div className="truncate text-left">
                    <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                      {user.displayName || (user.isAnonymous ? 'Clinical Guest' : 'Clinical User')}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate font-mono">
                      {user.email || `ID: ${user.uid.slice(0, 10)}...`}
                    </p>
                  </div>
                </div>

                <button
                  id="settings-signout-btn"
                  onClick={() => {
                    onSignOut();
                    setIsOpen(false);
                  }}
                  className="px-2 py-1 rounded text-xs font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 transition-colors flex items-center gap-1 shrink-0"
                  title="Sign out of account"
                >
                  <LogOut size={12} />
                  <span>{t('signOut') || 'Sign Out'}</span>
                </button>
              </div>
            ) : (
              <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-2">
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-tight">
                  Sign in to securely store patient sessions in Firestore with ownership validation.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <button
                    id="settings-signin-btn"
                    onClick={() => {
                      onSignIn();
                      setIsOpen(false);
                    }}
                    className="py-1.5 px-2 bg-sky-700 hover:bg-sky-800 text-white text-xs font-medium rounded-md shadow-2xs transition-colors flex items-center justify-center gap-1.5"
                    title="Sign in with Google OAuth"
                  >
                    <LogIn size={13} />
                    <span>Google Sign In</span>
                  </button>

                  <button
                    id="settings-guest-btn"
                    onClick={() => {
                      if (onSignInAsGuest) onSignInAsGuest();
                      setIsOpen(false);
                    }}
                    className="py-1.5 px-2 bg-white hover:bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 text-xs font-medium rounded-md shadow-2xs transition-colors flex items-center justify-center gap-1.5"
                    title="Sign in anonymously with full Firestore sync (bypasses popup restrictions)"
                  >
                    <Zap size={13} className="text-amber-500" />
                    <span>Guest Cloud</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* SECTION 3: Sensitivity Optimization */}
          <div className="py-2.5 px-1 space-y-2">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <span className="flex items-center gap-1">
                <Sliders size={11} /> Tremor Sensitivity Tuning
              </span>
              <span className="font-mono text-sky-700 dark:text-sky-400 normal-case">
                Multiplier: {sensitivityMultiplier.toFixed(2)}x
              </span>
            </div>

            {/* Presets */}
            <div className="grid grid-cols-3 gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-md text-xs">
              {(['low', 'normal', 'high'] as const).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => onChangeSensitivity && onChangeSensitivity(lvl)}
                  className={`py-1 rounded text-[11px] font-medium transition-all ${
                    sensitivity === lvl
                      ? 'bg-sky-700 text-white shadow-2xs font-semibold'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                  title={
                    lvl === 'low'
                      ? 'Low (Dampened - 2.0x): Strongly filters handwriting and voluntary arm movement'
                      : lvl === 'normal'
                      ? 'Normal (Optimized - 1.35x): Calibrated clinical baseline for Parkinsonian tremor'
                      : 'High (Sensitive - 0.9x): Picks up subtle micro-oscillations'
                  }
                >
                  {lvl === 'low' ? 'Low (Writing)' : lvl === 'normal' ? 'Normal (Opt)' : 'High (Fine)'}
                </button>
              ))}
            </div>

            {/* Fine Tuning Continuous Slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                <span>More Sensitive (0.5x)</span>
                <span>Dampened / Writing Filter (3.0x)</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="3.0"
                step="0.05"
                value={sensitivityMultiplier}
                onChange={(e) => onChangeSensitivityMultiplier && onChangeSensitivityMultiplier(parseFloat(e.target.value))}
                className="w-full accent-sky-700 dark:accent-sky-500 cursor-pointer h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg"
              />
              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                Higher values suppress voluntary pen strokes and normal hand movement. Lower values detect subtle micro-tremors.
              </p>
            </div>
          </div>

          {/* SECTION 4: Security & Clinical Privacy */}
          <div className="py-2.5 px-1 space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <span>{t('security') || 'Security & Compliance'}</span>
            </div>

            <button
              id="settings-security-btn"
              onClick={() => {
                onOpenSecurityModal('medical');
                setIsOpen(false);
              }}
              className="w-full p-2 rounded-md text-left bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors group flex items-center justify-between"
            >
              <div className="flex items-start gap-2">
                <div className="p-1 rounded bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-800/50 shrink-0 mt-0.5">
                  <Shield size={13} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white">
                      Security & Policies
                    </span>
                    <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-mono border border-emerald-200 dark:border-emerald-800">
                      ZERO TRACKING
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
                    Medical disclaimer, client ML & storage controls
                  </p>
                </div>
              </div>
              <ChevronRight
                size={13}
                className="text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0"
              />
            </button>
          </div>

          {/* SECTION 5: System Preferences */}
          <div className="pt-2.5 px-1 space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <span>Preferences</span>
            </div>

            {/* Theme Toggle */}
            <div className="flex items-center justify-between p-2 rounded-md bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded bg-slate-200/70 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300">
                  {isHighContrast ? <Moon size={13} /> : <Sun size={13} />}
                </div>
                <div>
                  <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                    Theme Mode
                  </span>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    {isHighContrast ? 'Dark Mode' : 'Light Mode'}
                  </p>
                </div>
              </div>
              <button
                onClick={onToggleHighContrast}
                className="px-2 py-0.5 text-xs font-medium rounded bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors shadow-2xs"
              >
                {isHighContrast ? t('light') || 'Light' : t('dark') || 'Dark'}
              </button>
            </div>

            {/* Sensor Calibration Shortcut */}
            <div className="flex items-center justify-between p-2 rounded-md bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400">
                  <Target size={13} className={isCalibrating ? 'animate-spin' : ''} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      Sensor Zeroing
                    </span>
                    {hasOffsets && (
                      <CheckCircle2 size={11} className="text-emerald-600" />
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    {hasOffsets ? 'Hardware tared' : 'Factory baselines'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  onOpenCalibration();
                  setIsOpen(false);
                }}
                className="px-2 py-0.5 text-xs font-medium rounded bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors shadow-2xs"
              >
                Calibrate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

