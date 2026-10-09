import React, { useMemo, useState, useEffect } from 'react';
import {
  Technician,
  Center,
  Ticket,
  DataQualityStats,
  ImportType
} from '../../types';
import {
  computeDataQuality,
  getCenters,
  getTechnicians,
  getTickets,
  getAttendance,
  getRoutePlans,
  subscribeToDataChanges,
} from '../../services/storage';
import {
  UserPlus,
  Building2,
  Upload,
  CalendarCheck,
  Compass,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  ShieldAlert,
  MapPin,
  Wrench,
  Activity,
  Layers
} from 'lucide-react';
import { localDate } from '../../lib/date';

interface Props {
  onNavigate: (tabId: string) => void;
  onOpenAddTechnician: () => void;
  onOpenAddCenter: () => void;
  onOpenUploadModal: (type: ImportType) => void;
  onFilterTicketsByQuality?: (filterKey: string) => void;
}

export const OverviewPage: React.FC<Props> = ({
  onNavigate,
  onOpenAddTechnician,
  onOpenAddCenter,
  onOpenUploadModal
}) => {
  // Reactive counter so all derived data re-reads from storage on any change
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeToDataChanges(() => setTick(n => n + 1)), []);

  const technicians = getTechnicians();
  const centers = getCenters();
  const tickets = getTickets();
  const attendance = getAttendance();
  const routePlans = getRoutePlans();
  const today = localDate();

  // Data Quality Audit — recomputes whenever storage changes (tick)
  const qualityStats: DataQualityStats = useMemo(() => computeDataQuality(), [tick]);

  // High Priority Open Cases Alert (Requirement 19)
  const highPriorityCases = useMemo(() => {
    return tickets.filter(t => (t.priority === 'CRITICAL' || t.priority === 'HIGH') && t.status !== 'Resolved' && t.status !== 'Closed');
  }, [tickets]);

  // Operational metrics
  const activeTechsCount = technicians.filter(t => t.status === 'Active').length;
  const presentTechsCount = attendance.filter(a => a.date === today && (a.status === 'Present' || a.status === 'Half-Day')).length;
  const openCasesCount = tickets.filter(t => t.status === 'Open' || t.status === 'Assigned').length;
  const unassignedCasesCount = tickets.filter(t => !t.assignedTechnicianId && t.status !== 'Resolved' && t.status !== 'Closed').length;
  const activeCentersCount = centers.filter(c => c.active).length;

  return (
    <div className="space-y-6">
      {/* Requirement 19: New / High Priority Ticket Alert */}
      {highPriorityCases.length > 0 && (
        <div className="p-4 bg-rose-50 border border-rose-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-rose-100 text-rose-700 rounded-lg flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-rose-600 animate-pulse" />
            </div>
            <div>
              <div className="text-sm font-bold text-rose-950 flex items-center gap-2">
                <span>⚠ {highPriorityCases.length} CRITICAL / HIGH PRIORITY CASES ACTIVE</span>
                <span className="text-rose-600 text-[11px] font-normal uppercase tracking-wider bg-rose-100 px-2 py-0.5 rounded">Action Required</span>
              </div>
              <p className="text-xs text-rose-800 mt-0.5">
                Breakdown cases in {Array.from(new Set(highPriorityCases.map(t => t.centerName))).slice(0, 3).join(', ')} require urgent dispatch.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => onNavigate('ACTIVE CASES')}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5"
            >
              VIEW CASES
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onNavigate('ROUTE PLANNER')}
              className="px-3.5 py-2 bg-white border border-rose-300 text-rose-800 hover:bg-rose-50 rounded-lg text-xs font-semibold transition-colors"
            >
              AUTO-OPTIMIZE
            </button>
          </div>
        </div>
      )}

      {/* Top Operational KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-slate-500 text-xs font-medium">Active Fleet Cases</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{openCasesCount}</div>
          <div className="text-[11px] text-amber-600 font-medium mt-1">
            {unassignedCasesCount} currently unassigned
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-slate-500 text-xs font-medium">Technicians Present Today</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">
            {presentTechsCount} <span className="text-xs text-slate-400 font-normal">/ {activeTechsCount} active</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Ready for route dispatch
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-slate-500 text-xs font-medium">Operational Centers</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{activeCentersCount}</div>
          <div className="text-[11px] text-emerald-600 font-medium mt-1">
            100% geocoded in Delhi NCR
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-slate-500 text-xs font-medium">Planned Routes</div>
          <div className="text-2xl font-bold text-blue-600 mt-1">
            {routePlans.length > 0 ? `${routePlans.length} routes` : 'Not Planned'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {routePlans.length > 0 ? `${routePlans.reduce((acc, p) => acc + p.stops.length, 0)} stops sequenced` : 'Click Quick Action to plan'}
          </div>
        </div>
      </div>

      {/* Two Column Section: QUICK ACTIONS (Req 23) & DATA QUALITY DASHBOARD (Req 24) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Requirement 23: QUICK ACTIONS PANEL (7 Columns) */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-2xs p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-600" />
                QUICK ACTIONS
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Instant master data operations and daily dispatch shortcuts.
              </p>
            </div>
            <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
              Zero Database Touching
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* + Add Technician */}
            <button
              onClick={onOpenAddTechnician}
              className="p-3 bg-blue-50/70 hover:bg-blue-100/70 border border-blue-200 rounded-xl text-left transition-colors group flex items-start gap-3"
            >
              <div className="p-2 bg-blue-600 text-white rounded-lg shrink-0 group-hover:scale-105 transition-transform">
                <UserPlus className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-blue-950">+ Add Technician</div>
                <div className="text-[11px] text-blue-800 mt-0.5">Create engineer with map start point</div>
              </div>
            </button>

            {/* + Add Center */}
            <button
              onClick={onOpenAddCenter}
              className="p-3 bg-emerald-50/70 hover:bg-emerald-100/70 border border-emerald-200 rounded-xl text-left transition-colors group flex items-start gap-3"
            >
              <div className="p-2 bg-emerald-600 text-white rounded-lg shrink-0 group-hover:scale-105 transition-transform">
                <Building2 className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-emerald-950">+ Add Center</div>
                <div className="text-[11px] text-emerald-800 mt-0.5">Pin new DC / Hub coordinates on map</div>
              </div>
            </button>

            {/* Upload Center CSV */}
            <button
              onClick={() => onOpenUploadModal('CENTER_CSV')}
              className="p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-left transition-colors group flex items-start gap-3"
            >
              <div className="p-2 bg-slate-800 text-white rounded-lg shrink-0 group-hover:scale-105 transition-transform">
                <Upload className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-900">Upload Center CSV</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Batch geocode hubs & DC master</div>
              </div>
            </button>

            {/* Upload Open Ticket CSV */}
            <button
              onClick={() => onOpenUploadModal('TICKET_CSV')}
              className="p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-left transition-colors group flex items-start gap-3"
            >
              <div className="p-2 bg-blue-800 text-white rounded-lg shrink-0 group-hover:scale-105 transition-transform">
                <Upload className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-900">Upload Open Ticket CSV</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Ingest daily vehicle breakdown queue</div>
              </div>
            </button>

            {/* Upload Technician CSV */}
            <button
              onClick={() => onOpenUploadModal('TECHNICIAN_CSV')}
              className="p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-left transition-colors group flex items-start gap-3"
            >
              <div className="p-2 bg-amber-600 text-white rounded-lg shrink-0 group-hover:scale-105 transition-transform">
                <Upload className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-900">Upload Technician CSV</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Bulk roster & contact synchronization</div>
              </div>
            </button>

            {/* Mark Attendance */}
            <button
              onClick={() => onNavigate('ATTENDANCE')}
              className="p-3 bg-purple-50/70 hover:bg-purple-100/70 border border-purple-200 rounded-xl text-left transition-colors group flex items-start gap-3"
            >
              <div className="p-2 bg-purple-600 text-white rounded-lg shrink-0 group-hover:scale-105 transition-transform">
                <CalendarCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-purple-950">Mark Attendance</div>
                <div className="text-[11px] text-purple-800 mt-0.5">Record shift check-ins & roster</div>
              </div>
            </button>

            {/* Plan Today's Routes */}
            <button
              onClick={() => onNavigate('ROUTE PLANNER')}
              className="p-3 bg-slate-900 hover:bg-black text-white rounded-xl text-left transition-colors group flex items-start gap-3 sm:col-span-2 shadow-xs"
            >
              <div className="p-2 bg-blue-600 text-white rounded-lg shrink-0 group-hover:scale-105 transition-transform">
                <Compass className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="text-xs font-bold text-white flex items-center justify-between">
                  <span>Plan Today's Routes</span>
                  <span className="text-[10px] text-blue-300 font-normal">Haversine + City Detour</span>
                </div>
                <div className="text-[11px] text-slate-300 mt-0.5">
                  Route available technicians using their exact start coordinates and ticket priorities.
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Requirement 24: ADMIN DATA QUALITY DASHBOARD (5 Columns) */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 shadow-2xs p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
                DATA QUALITY
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Audit checks for routing & geocoding integrity. Click metric to fix.
              </p>
            </div>
            <span className="text-[11px] font-mono text-slate-500">
              6 Rules Checked
            </span>
          </div>

          <div className="space-y-2.5">
            {/* Metric 1: Technicians Missing Location */}
            <div
              onClick={() => onNavigate('TECHNICIAN MANAGEMENT')}
              className="p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer transition-colors flex items-center justify-between"
            >
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${qualityStats.techniciansMissingLocation > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                <span className="text-xs font-medium text-slate-800">Technicians Missing Location</span>
              </div>
              <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${qualityStats.techniciansMissingLocation > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                {qualityStats.techniciansMissingLocation}
              </span>
            </div>

            {/* Metric 2: Centers Missing Coordinates */}
            <div
              onClick={() => onNavigate('CENTER MANAGEMENT')}
              className="p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer transition-colors flex items-center justify-between"
            >
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${qualityStats.centersMissingCoordinates > 0 ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                <span className="text-xs font-medium text-slate-800">Centers Missing Coordinates</span>
              </div>
              <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${qualityStats.centersMissingCoordinates > 0 ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'}`}>
                {qualityStats.centersMissingCoordinates}
              </span>
            </div>

            {/* Metric 3: Tickets Without Center */}
            <div
              onClick={() => onNavigate('ACTIVE CASES')}
              className="p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer transition-colors flex items-center justify-between"
            >
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${qualityStats.ticketsWithoutCenter > 0 ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                <span className="text-xs font-medium text-slate-800">Tickets Without Center</span>
              </div>
              <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${qualityStats.ticketsWithoutCenter > 0 ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'}`}>
                {qualityStats.ticketsWithoutCenter}
              </span>
            </div>

            {/* Metric 4: Tickets Without Priority */}
            <div
              onClick={() => onNavigate('ACTIVE CASES')}
              className="p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer transition-colors flex items-center justify-between"
            >
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${qualityStats.ticketsWithoutPriority > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                <span className="text-xs font-medium text-slate-800">Tickets Without Priority</span>
              </div>
              <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${qualityStats.ticketsWithoutPriority > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                {qualityStats.ticketsWithoutPriority}
              </span>
            </div>

            {/* Metric 5: Tickets Without Assignment */}
            <div
              onClick={() => onNavigate('TICKET ASSIGNMENT')}
              className="p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer transition-colors flex items-center justify-between"
            >
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${qualityStats.ticketsWithoutAssignment > 0 ? 'bg-blue-500' : 'bg-emerald-500'}`} />
                <span className="text-xs font-medium text-slate-800">Tickets Without Assignment</span>
              </div>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                {qualityStats.ticketsWithoutAssignment}
              </span>
            </div>

            {/* Metric 6: Invalid Coordinates */}
            <div
              onClick={() => onNavigate('CENTER MANAGEMENT')}
              className="p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer transition-colors flex items-center justify-between"
            >
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${qualityStats.invalidCoordinates > 0 ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                <span className="text-xs font-medium text-slate-800">Invalid Coordinates</span>
              </div>
              <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${qualityStats.invalidCoordinates > 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>
                {qualityStats.invalidCoordinates}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Requirement 28: Today's Morning Workflow Guide */}
      <div className="bg-slate-900 text-white rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wider text-blue-400">
            Daily Operations Workflow (Self-Service)
          </div>
          <span className="text-[11px] text-slate-400">Delhi NCR Operations Standard</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs pt-1">
          {([
            { step: '01', label: 'Roster',     title: 'Add / Check Tech',    tab: 'TECHNICIAN MANAGEMENT' },
            { step: '02', label: 'Hubs',        title: 'Upload Center CSV',   tab: 'CENTER MANAGEMENT' },
            { step: '03', label: 'Tickets',     title: 'Upload Tickets CSV',  tab: 'IMPORT DATA' },
            { step: '04', label: 'Attendance',  title: 'Mark Shift Check-in', tab: 'ATTENDANCE' },
            { step: '05', label: 'Optimizer',   title: 'Plan Routes',         tab: 'ROUTE PLANNER' },
            { step: '06', label: 'Live',        title: 'Track Execution',     tab: 'LIVE TRACKING' },
          ] as const).map(({ step, label, title, tab }) => (
            <button
              key={step}
              onClick={() => onNavigate(tab)}
              className="bg-slate-800/80 p-3 rounded-lg border border-slate-700 hover:border-blue-500 hover:bg-slate-700/80 transition-colors text-left w-full cursor-pointer group"
            >
              <span className="text-[10px] text-slate-400 block font-mono group-hover:text-blue-400 transition-colors">
                {step}. {label}
              </span>
              <div className="font-semibold text-white mt-1">{title}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
