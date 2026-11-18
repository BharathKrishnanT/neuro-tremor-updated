import React, { useState, useEffect } from 'react';
import {
  Shield,
  Lock,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  X,
  Database,
  EyeOff,
  Cookie,
  Cpu,
  Server,
  RefreshCw,
} from 'lucide-react';
import { useLanguage } from '../lib/i18n';
import { BackendHealthStatus, fetchBackendHealth } from '../lib/backendApi';

interface SecurityPrivacyModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'medical' | 'privacy' | 'cookies' | 'security';
  isDark?: boolean;
}

export const SecurityPrivacyModal: React.FC<SecurityPrivacyModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'medical',
}) => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'medical' | 'privacy' | 'cookies' | 'security'>(
    defaultTab
  );
  const [cacheCleared, setCacheCleared] = useState(false);
  const [backendHealth, setBackendHealth] = useState<BackendHealthStatus | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(defaultTab);
      refreshBackendTelemetry();
    }
  }, [isOpen, defaultTab]);

  const refreshBackendTelemetry = async () => {
    setLoadingHealth(true);
    const status = await fetchBackendHealth();
    setBackendHealth(status);
    setLoadingHealth(false);
  };

  if (!isOpen) return null;

  const handleClearLocalStorage = () => {
    try {
      localStorage.removeItem('neurotremor_calibration_offsets');
      localStorage.removeItem('neuro_theme');
      localStorage.removeItem('neurotremor_lang');
      localStorage.removeItem('neurotremor_privacy_accepted');
      setCacheCleared(true);
      setTimeout(() => setCacheCleared(false), 3000);
    } catch (e) {
      console.error('Failed to clear local storage', e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="security-modal-title"
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden transition-all"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-800">
              <Shield size={18} />
            </div>
            <div>
              <h2
                id="security-modal-title"
                className="text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                {t('securityPrivacyTitle') || 'Security, Scalability & Clinical Governance'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                NeuroTremor Quantitative Motor Assessment Architecture
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 px-5 bg-slate-50/40 dark:bg-slate-950/20 overflow-x-auto">
          <button
            onClick={() => setActiveTab('medical')}
            className={`py-2.5 px-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'medical'
                ? 'border-amber-600 text-amber-700 dark:text-amber-400'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <AlertTriangle size={13} />
            <span>{t('medicalDisclaimerTab') || 'Medical Disclaimer'}</span>
          </button>
          <button
            onClick={() => setActiveTab('privacy')}
            className={`py-2.5 px-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'privacy'
                ? 'border-sky-700 text-sky-700 dark:text-sky-400'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Lock size={13} />
            <span>{t('dataPrivacyTab') || 'Data Privacy Policy'}</span>
          </button>
          <button
            onClick={() => setActiveTab('cookies')}
            className={`py-2.5 px-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'cookies'
                ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Cookie size={13} />
            <span>{t('cookieStorageTab') || 'Cookies & Storage'}</span>
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`py-2.5 px-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'security'
                ? 'border-slate-800 text-slate-900 dark:border-slate-300 dark:text-slate-100'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Server size={13} />
            <span>Backend Security & Scalability</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 text-sm text-slate-700 dark:text-slate-300 space-y-4">
          {activeTab === 'medical' && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 text-xs sm:text-sm leading-relaxed">
                <div className="flex items-center gap-2 font-bold mb-1.5 text-amber-800 dark:text-amber-300">
                  <AlertTriangle size={16} />
                  <span>Important Medical Notice & Non-Diagnostic Status</span>
                </div>
                NeuroTremor is an investigational clinical decision-support and quantitative motion
                analysis utility designed to measure IMU acceleration, pronation-supination angular
                velocity, and isometric FSR grip pressure. It is{' '}
                <strong>NOT an FDA, CE, or CDSCO cleared diagnostic medical device</strong>.
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  1. Differential Tremor & Grip Force Methodology
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  The platform decomposes kinematic signals into the Parkinsonian resting/re-emergent
                  band (3.5–6.5 Hz) and the Essential/postural kinetic band (6.5–12.0 Hz), alongside
                  pronation-supination rotational ratios and isometric grip force decay. These
                  biomarkers assist neurologists in objective tracking alongside formal MDS-UPDRS
                  physical examination.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  2. Clinical Supervision Required
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  Never modify dopaminergic or anti-tremor medication dosages based solely on
                  automated telemetry readouts without evaluation by a board-certified neurologist.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'privacy' && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60 text-sky-900 dark:text-sky-200 text-xs sm:text-sm leading-relaxed">
                <div className="flex items-center gap-2 font-bold mb-1 text-sky-800 dark:text-sky-300">
                  <Lock size={16} />
                  <span>Privacy by Design & Zero Commercial Trackers</span>
                </div>
                Your kinematic streams, differential classifications, and exported PDF reports
                belong strictly to your clinical workspace.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
                  <div className="flex items-center gap-2 font-semibold text-xs text-slate-900 dark:text-slate-200 mb-1">
                    <Cpu size={14} className="text-sky-600" />
                    Edge + Verifiable Server Pipeline
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Real-time 7-channel CNN inference runs in your browser sandbox, paired with
                    stateless HMAC-SHA256 verification on the application backend.
                  </p>
                </div>
                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
                  <div className="flex items-center gap-2 font-semibold text-xs text-slate-900 dark:text-slate-200 mb-1">
                    <Database size={14} className="text-emerald-600" />
                    Zero-Trust Firestore Isolation
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    All stored sessions enforce strict per-owner read/write rules (`resource.data.userId == request.auth.uid`) and regex document ID guards.
                  </p>
                </div>
                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
                  <div className="flex items-center gap-2 font-semibold text-xs text-slate-900 dark:text-slate-200 mb-1">
                    <EyeOff size={14} className="text-teal-600" />
                    No Ad Beacons or Telemetry Brokers
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Zero third-party analytics pixels or behavioral trackers are loaded.
                  </p>
                </div>
                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
                  <div className="flex items-center gap-2 font-semibold text-xs text-slate-900 dark:text-slate-200 mb-1">
                    <Shield size={14} className="text-rose-600" />
                    Right to Erasure
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Clinicians can permanently purge individual or batch sessions from Firestore and
                    local storage at any time.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'cookies' && (
            <div className="space-y-4">
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                NeuroTremor utilizes strictly functional local storage keys to persist hardware
                calibration offsets and display preferences:
              </p>

              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden text-xs">
                <table className="w-full text-left">
                  <thead className="bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 font-semibold">
                    <tr>
                      <th className="p-2.5">Storage Key</th>
                      <th className="p-2.5">Purpose</th>
                      <th className="p-2.5">Retention</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                    <tr>
                      <td className="p-2.5 font-bold text-slate-800 dark:text-slate-200">
                        neurotremor_calibration_offsets
                      </td>
                      <td className="p-2.5 font-sans">
                        Stores IMU & FSR zero-tare calibration baselines
                      </td>
                      <td className="p-2.5 font-sans">Persistent</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-bold text-slate-800 dark:text-slate-200">
                        neurotremor_sensitivity_mult
                      </td>
                      <td className="p-2.5 font-sans">
                        Stores clinician sensitivity threshold multiplier
                      </td>
                      <td className="p-2.5 font-sans">Persistent</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-bold text-slate-800 dark:text-slate-200">
                        neuro_theme / neurotremor_lang
                      </td>
                      <td className="p-2.5 font-sans">
                        Stores Light/Dark contrast mode and UI language
                      </td>
                      <td className="p-2.5 font-sans">Persistent</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800">
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-200">
                    Reset Local Client Storage
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Clears all cached calibration offsets and UI preferences.
                  </div>
                </div>
                <button
                  onClick={handleClearLocalStorage}
                  className="px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 text-rose-700 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800/40 transition-colors whitespace-nowrap"
                >
                  <Trash2 size={13} />
                  <span>{cacheCleared ? 'Cleared!' : 'Clear Local Storage'}</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Hardened Backend Security & Scalability Telemetry
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Real-time status from Express API gateway (`/api/v1/health`)
                  </p>
                </div>
                <button
                  onClick={refreshBackendTelemetry}
                  className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw size={12} className={loadingHealth ? 'animate-spin' : ''} />
                  <span>Refresh Status</span>
                </button>
              </div>

              {backendHealth && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono tabular-nums text-xs">
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase">Rate Limiter</div>
                    <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                      {backendHealth.security.rateLimitPerMin} req/min
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase">Verified Sessions</div>
                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {backendHealth.scalability.totalVerifiedSessions}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase">Blocked Floods</div>
                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {backendHealth.scalability.totalBlockedRequests}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase">Server Heap</div>
                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {backendHealth.scalability.heapUsedMb} MB
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2 text-xs">
                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-slate-800 dark:text-slate-200 font-mono">
                      Token-Bucket Rate Limiting & Flood Protection:
                    </strong>{' '}
                    Per-IP sliding token buckets (`X-RateLimit-Limit`, `Retry-After`) protect
                    biomarker compute endpoints from volumetric DoS attacks.
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-slate-800 dark:text-slate-200 font-mono">
                      HMAC-SHA256 Session Integrity Signing:
                    </strong>{' '}
                    Every recorded session is cryptographically signed by `/api/v1/analyze-biomarkers`
                    to guarantee tamper-evident clinical auditability.
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-slate-800 dark:text-slate-200 font-mono">
                      Scalable Telemetry Downsampling:
                    </strong>{' '}
                    High-frequency 200Hz streams are bounded and downsampled before cloud storage to
                    prevent Firestore 1MB document exhaustion while preserving spectral accuracy.
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-slate-800 dark:text-slate-200 font-mono">
                      Zero-Trust Firestore Security Rules:
                    </strong>{' '}
                    Default-deny catch-all, strict field allowlists (`hasOnly`), regex ID validation,
                    and mandatory owner-filtered list queries.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-mono">
            <Lock size={12} className="text-emerald-600 dark:text-emerald-400" />
            <span>HMAC-SHA256 & TLS HARDENED RUNTIME</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md bg-slate-800 hover:bg-slate-900 text-white dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-100 font-medium text-xs transition-colors shadow-2xs"
          >
            {t('close') || 'Understood & Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
