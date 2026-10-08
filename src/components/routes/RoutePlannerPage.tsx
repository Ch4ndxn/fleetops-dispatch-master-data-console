import React, { useState } from 'react';
import { TechnicianRoutePlan } from '../../types';
import {
  getRoutePlans,
  saveRoutePlans,
  getTechnicians,
  getCenters,
  getTickets,
  saveTickets
} from '../../services/storage';
import { planTodayRoutes } from '../../services/routeOptimizer';
import { LiveMapViewer } from '../map/LiveMapViewer';
import {
  Compass,
  CheckCircle2,
  MapPin,
  Clock,
  Car,
  AlertCircle,
  RotateCcw,
  Navigation,
  Layers,
  ArrowRight
} from 'lucide-react';

export const RoutePlannerPage: React.FC = () => {
  const [routePlans, setRoutePlans] = useState<TechnicianRoutePlan[]>(() => getRoutePlans());
  const technicians = getTechnicians();
  const centers = getCenters();
  const tickets = getTickets();

  const [selectedTechId, setSelectedTechId] = useState<string | undefined>(undefined);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handlePlanRoutes = () => {
    setIsOptimizing(true);
    setTimeout(() => {
      const generated = planTodayRoutes();
      saveRoutePlans(generated);
      setRoutePlans(generated);
      setIsOptimizing(false);
      showToast(`Successfully calculated ${generated.length} optimized routes based on technician starting coordinates.`);
    }, 400);
  };

  // Requirement 18: Confirm assignments commits them to tickets without auto-overriding confirmed routes
  const handleConfirmAssignments = () => {
    if (routePlans.length === 0) return;

    const confirmedPlans = routePlans.map(p => ({ ...p, status: 'Confirmed' as const }));
    saveRoutePlans(confirmedPlans);
    setRoutePlans(confirmedPlans);

    // Update tickets with assigned technician
    const allTickets = getTickets();
    const updatedTickets = allTickets.map(tk => {
      for (const plan of routePlans) {
        const foundStop = plan.stops.find(s => s.ticketId === tk.ticketId);
        if (foundStop) {
          return {
            ...tk,
            assignedTechnicianId: plan.technicianId,
            assignedTechnicianName: plan.technicianName,
            status: 'Assigned' as const,
            scheduledSlot: foundStop.estimatedArrival,
            updatedAt: new Date().toISOString()
          };
        }
      }
      return tk;
    });

    saveTickets(updatedTickets);
    showToast('Assignments confirmed! Field technicians notified.');
  };

  const totalAssignedStops = routePlans.reduce((acc, p) => acc + p.stops.length, 0);
  const totalKm = Math.round(routePlans.reduce((acc, p) => acc + p.totalDistanceKm, 0) * 10) / 10;

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toastMessage && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-medium flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-slate-600 text-xs font-bold">
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">ROUTE PLANNER & DISPATCH</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Geospatial clustering algorithm that routes available engineers starting from their configured home/depot base.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {routePlans.length > 0 && (
            <button
              onClick={handleConfirmAssignments}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 shadow-2xs"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              CONFIRM ASSIGNMENTS
            </button>
          )}

          <button
            onClick={handlePlanRoutes}
            disabled={isOptimizing}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold tracking-wide shadow-xs transition-colors flex items-center gap-2"
          >
            <Compass className="w-4 h-4" />
            {isOptimizing ? 'Calculating Routes...' : "PLAN TODAY'S ROUTES"}
          </button>
        </div>
      </div>

      {/* Overview Metrics Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] text-slate-500 font-medium">Active Planned Routes</span>
          <div className="text-xl font-bold text-slate-900 mt-0.5">{routePlans.length}</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] text-slate-500 font-medium">Total Sequenced Stops</span>
          <div className="text-xl font-bold text-blue-600 mt-0.5">{totalAssignedStops} cases</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] text-slate-500 font-medium">Estimated Fleet Distance</span>
          <div className="text-xl font-bold text-slate-900 mt-0.5">{totalKm} km</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] text-slate-500 font-medium">Plan Status</span>
          <div className="text-sm font-bold text-slate-900 mt-1 flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${routePlans.some(p => p.status === 'Confirmed') ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <span>{routePlans.length > 0 ? (routePlans[0].status || 'Draft') : 'No Plan Generated'}</span>
          </div>
        </div>
      </div>

      {/* Interactive Leaflet Map View */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
          <span className="flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-blue-600" />
            Delhi NCR Geospatial Routing Map
          </span>
          {selectedTechId && (
            <button
              onClick={() => setSelectedTechId(undefined)}
              className="text-blue-600 hover:underline"
            >
              Show all technician routes
            </button>
          )}
        </div>

        <LiveMapViewer
          centers={centers}
          technicians={technicians}
          routePlans={routePlans}
          selectedTechId={selectedTechId}
          height="420px"
        />
      </div>

      {/* Technician Route Breakdown Cards */}
      {routePlans.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-3">
          <Navigation className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">No Routes Generated Yet</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Click <strong>PLAN TODAY'S ROUTES</strong> above. The optimizer will match open tickets with active present technicians using their starting locations.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
            Technician Route Plans ({routePlans.length})
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {routePlans.map((plan) => {
              const isSelected = selectedTechId === plan.technicianId;
              return (
                <div
                  key={plan.technicianId}
                  onClick={() => setSelectedTechId(isSelected ? undefined : plan.technicianId)}
                  className={`bg-white rounded-xl border p-4 shadow-2xs transition-all cursor-pointer ${
                    isSelected ? 'border-blue-600 ring-2 ring-blue-500/20' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between pb-3 border-b border-slate-100">
                    <div>
                      <div className="font-bold text-slate-900 text-sm">{plan.technicianName}</div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                        <span className="font-mono">{plan.employeeId}</span>
                        <span>·</span>
                        <span>Base: {plan.defaultDc || 'Central DC'}</span>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                      {plan.stops.length} STOPS
                    </span>
                  </div>

                  {/* Distance & Time stats */}
                  <div className="grid grid-cols-2 gap-2 py-2.5 text-xs border-b border-slate-100 text-slate-600">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Start Location:</span>
                      <span className="font-mono text-[11px] font-medium">{plan.startLat.toFixed(3)}, {plan.startLng.toFixed(3)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Route Distance / ETA:</span>
                      <span className="font-medium text-slate-900">{plan.totalDistanceKm} km · ~{plan.totalEstimatedMins} mins</span>
                    </div>
                  </div>

                  {/* Stop sequence */}
                  <div className="pt-2.5 space-y-1.5">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      Assigned Stops Sequence:
                    </span>
                    {plan.stops.map((stop) => (
                      <div
                        key={stop.stopOrder}
                        className="p-2 bg-slate-50 rounded-lg text-xs flex items-center justify-between border border-slate-100"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-slate-800 text-white font-mono text-[10px] flex items-center justify-center font-bold">
                            {stop.stopOrder}
                          </span>
                          <div>
                            <div className="font-semibold text-slate-900 text-[11px]">
                              {stop.centerName} ({stop.vehicleNumber})
                            </div>
                            <div className="text-[10px] text-slate-500 truncate max-w-[200px]">
                              {stop.issue}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="font-mono text-[11px] font-bold text-blue-600 block">
                            {stop.estimatedArrival}
                          </span>
                          <span className={`text-[10px] font-semibold ${stop.priority === 'CRITICAL' ? 'text-rose-600' : 'text-amber-600'}`}>
                            {stop.priority}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
