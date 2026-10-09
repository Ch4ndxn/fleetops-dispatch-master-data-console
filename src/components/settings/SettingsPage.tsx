import React, { useState } from 'react';
import { resetToDemoData, getCenters, getTechnicians, getTickets, getImportJobs } from '../../services/storage';
import { RotateCcw, Database, ShieldCheck, Download, CheckCircle2 } from 'lucide-react';
import { localDate } from '../../lib/date';

export const SettingsPage: React.FC = () => {
  const [toast, setToast] = useState<string | null>(null);

  const handleReset = () => {
    if (confirm('Reset application to pristine Delhi NCR operational demo state? This will repopulate standard DCs, active technicians, and tickets.')) {
      resetToDemoData();
      setToast('System reset to Delhi NCR master demo data successfully!');
      setTimeout(() => setToast(null), 4000);
    }
  };

  const handleExportFullBackup = () => {
    const backup = {
      centers: getCenters(),
      technicians: getTechnicians(),
      tickets: getTickets(),
      importJobs: getImportJobs(),
      exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fleetops_master_backup_${localDate()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Toast */}
      {toast && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{toast}</span>
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">SYSTEM SETTINGS & MASTER BACKUP</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Database health, local storage persistence engine, and emergency reset controls.
        </p>
      </div>

      {/* Requirement 25 Card: Operations Self-Sufficiency Principle */}
      <div className="p-5 bg-blue-50 border border-blue-200 rounded-xl text-xs space-y-2 text-blue-950">
        <div className="flex items-center gap-2 font-bold text-sm text-blue-900">
          <ShieldCheck className="w-4 h-4 text-blue-600" />
          Zero SQL / Zero Database Editing Philosophy
        </div>
        <p className="text-blue-800 leading-relaxed">
          Operations managers are fully autonomous. All daily workflows—including adding new engineers,
          geocoding Delhi NCR charging centers on an interactive map, and bulk CSV ingestion—are executed directly in the UI with instant validation and transactional error rollbacks.
        </p>
      </div>

      {/* Database State Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5 space-y-4">
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
          <Database className="w-4 h-4 text-slate-600" />
          Operational Master Store Status
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-slate-500 block">Centers / DCs:</span>
            <span className="font-bold text-base text-slate-900">{getCenters().length}</span>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-slate-500 block">Technicians:</span>
            <span className="font-bold text-base text-slate-900">{getTechnicians().length}</span>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-slate-500 block">Tickets:</span>
            <span className="font-bold text-base text-slate-900">{getTickets().length}</span>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-slate-500 block">Import Jobs:</span>
            <span className="font-bold text-base text-slate-900">{getImportJobs().length}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleExportFullBackup}
            className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-2xs"
          >
            <Download className="w-3.5 h-3.5" />
            Download Complete System Backup (JSON)
          </button>
        </div>
      </div>

      {/* Reset to Demo Data */}
      <div className="bg-white rounded-xl border border-rose-200 shadow-2xs p-5 space-y-3">
        <h2 className="text-sm font-bold text-rose-900 uppercase tracking-wide flex items-center gap-2">
          <RotateCcw className="w-4 h-4 text-rose-600" />
          Reset Demo Data
        </h2>
        <p className="text-xs text-slate-600">
          Restore initial Delhi NCR sample centers (Patel Nagar, Naraina, Noida Sector 83, Okhla, Gurugram, Faridabad), certified technicians, and open breakdown incidents.
        </p>
        <button
          onClick={handleReset}
          className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition-colors"
        >
          Reset Master Data to Defaults
        </button>
      </div>
    </div>
  );
};
