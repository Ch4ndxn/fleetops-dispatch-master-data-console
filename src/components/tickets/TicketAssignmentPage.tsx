import React, { useState } from 'react';
import { Ticket, Technician } from '../../types';
import { getTickets, saveTickets, getTechnicians } from '../../services/storage';
import {
  Users,
  Wrench,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Filter,
  Search,
  Building2
} from 'lucide-react';

export const TicketAssignmentPage: React.FC = () => {
  const [tickets, setTickets] = useState<Ticket[]>(() => getTickets());
  const technicians = getTechnicians();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTechId, setSelectedTechId] = useState<string>('ALL');

  const unassignedTickets = tickets.filter(t => !t.assignedTechnicianId && t.status !== 'Resolved' && t.status !== 'Closed');
  const activeTechnicians = technicians.filter(t => t.status === 'Active');

  const handleAssign = (ticketId: string, techId: string) => {
    const tech = technicians.find(t => t.id === techId);
    const updated = tickets.map(t => {
      if (t.id === ticketId) {
        return {
          ...t,
          assignedTechnicianId: techId || undefined,
          assignedTechnicianName: tech?.name || undefined,
          status: 'Assigned' as const,
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    });
    saveTickets(updated);
    setTickets(updated);
  };

  const filteredUnassigned = unassignedTickets.filter(t =>
    t.ticketId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.vehicleNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.centerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.issue.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">TICKET ASSIGNMENT CONSOLE</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Manual & rapid dispatch console for assigning emergency vehicle breakdowns to field engineers.
        </p>
      </div>

      {/* Grid: Unassigned Queue + Technician Workload */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Unassigned tickets list */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-2xs p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                Unassigned Tickets Queue ({unassignedTickets.length})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">Select a technician to assign directly.</p>
            </div>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search unassigned tickets..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
            {filteredUnassigned.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                No unassigned tickets found. All cases are currently allocated!
              </div>
            ) : (
              filteredUnassigned.map((tk) => (
                <div key={tk.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-xs text-blue-600">{tk.ticketId}</span>
                      <span className="font-mono text-xs text-slate-700 font-semibold">{tk.vehicleNumber}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        tk.priority === 'CRITICAL' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {tk.priority}
                      </span>
                    </div>
                    <div className="text-xs text-slate-800 font-medium mt-0.5">{tk.issue}</div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                      <Building2 className="w-3 h-3" />
                      <span>{tk.centerName}</span>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    <select
                      onChange={(e) => {
                        if (e.target.value) handleAssign(tk.id, e.target.value);
                      }}
                      defaultValue=""
                      className="px-2 py-1 text-xs border border-slate-300 rounded-md bg-white font-medium focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="" disabled>Assign To...</option>
                      {activeTechnicians.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.city})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Technician workload capacity */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 shadow-2xs p-5 space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-600" />
              Active Technician Capacity ({activeTechnicians.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Current case distribution across technicians.</p>
          </div>

          <div className="space-y-3">
            {activeTechnicians.map(tech => {
              const assignedCount = tickets.filter(t => t.assignedTechnicianId === tech.id && t.status !== 'Resolved' && t.status !== 'Closed').length;
              return (
                <div key={tech.id} className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-xs text-slate-900">{tech.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {tech.role} · {tech.specialisation} ({tech.city})
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-sm font-bold text-slate-900 block">{assignedCount} cases</span>
                    <span className="text-[10px] text-slate-400 font-medium">
                      {assignedCount >= 4 ? 'High Load' : 'Available'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
