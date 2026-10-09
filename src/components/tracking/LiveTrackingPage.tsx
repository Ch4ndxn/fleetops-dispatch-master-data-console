import React, { useState } from 'react';
import { getCenters, getTechnicians, getTickets, getRoutePlans } from '../../services/storage';
import { LiveMapViewer } from '../map/LiveMapViewer';
import { Activity, MapPin, Radio, Wrench, CheckCircle } from 'lucide-react';

export const LiveTrackingPage: React.FC = () => {
  const centers = getCenters();
  const technicians = getTechnicians();
  const tickets = getTickets();
  const routePlans = getRoutePlans();

  const [selectedTechId, setSelectedTechId] = useState<string | undefined>(undefined);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Radio className="w-5 h-5 text-emerald-600 animate-pulse" />
            LIVE FLEET DISPATCH TRACKING
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time Delhi NCR situational map showing engineer dispatch locations and active incident routes.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping"></span>
          <span className="font-semibold text-slate-700">Live GPS Polling Active</span>
        </div>
      </div>

      {/* Map */}
      <div className="space-y-2">
        <LiveMapViewer
          centers={centers}
          technicians={technicians}
          routePlans={routePlans}
          selectedTechId={selectedTechId}
          height="480px"
        />
      </div>

      {/* Field status cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {technicians.filter(t => t.status === 'Active').map((tech) => {
          const techPlan = routePlans.find(p => p.technicianId === tech.id);
          const isDone = (st?: string) => st === 'Resolved' || st === 'Closed';
          const activeStop = techPlan?.stops.find(st => !isDone(st.ticketStatus));
          const doneCount = techPlan ? techPlan.stops.filter(st => isDone(st.ticketStatus)).length : 0;
          const totalCount = techPlan?.stops.length ?? 0;
          return (
            <div
              key={tech.id}
              onClick={() => setSelectedTechId(selectedTechId === tech.id ? undefined : tech.id)}
              className={`p-4 bg-white rounded-xl border cursor-pointer transition-all ${
                selectedTechId === tech.id ? 'border-blue-600 ring-2 ring-blue-500/20' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-bold text-xs text-slate-900">{tech.name}</div>
                  <div className="text-[11px] text-slate-500">{tech.role} · {tech.city}</div>
                </div>
                <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-semibold">
                  On-Field
                </span>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 text-xs space-y-1">
                <div className="text-slate-600">
                  <span className="text-slate-400">Current Task:</span>{' '}
                  {activeStop
                    ? `${activeStop.centerName} (${activeStop.vehicleNumber})${activeStop.ticketStatus === 'In Progress' ? ' · in progress' : ''}`
                    : totalCount ? 'All visits resolved' : 'Standby at Base Depot'}
                  {totalCount > 0 && <span className="ml-1 text-slate-400">· {doneCount}/{totalCount} done</span>}
                </div>
                <div className="text-slate-500 text-[11px]">
                  <span className="text-slate-400">Base DC:</span> {tech.defaultDc || 'Central Delhi'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
