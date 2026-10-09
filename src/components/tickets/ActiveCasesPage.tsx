import React, { useState, useMemo } from 'react';
import { Ticket, TicketPriority, TicketStatus } from '../../types';
import { getTickets, saveTickets, getTechnicians, getCenters } from '../../services/storage';
import { generateCSV, downloadCSV } from '../../services/csvParser';
import {
  Wrench,
  Upload,
  Download,
  Search,
  Filter,
  AlertTriangle,
  CheckCircle2,
  Clock,
  User,
  Building2
} from 'lucide-react';
import { localDate } from '../../lib/date';

interface Props {
  onOpenUploadModal: (type: 'TICKET_CSV') => void;
  onNavigateToCenterMaster?: () => void;
}

export const ActiveCasesPage: React.FC<Props> = ({ onOpenUploadModal }) => {
  const [tickets, setTickets] = useState<Ticket[]>(() => getTickets());
  const technicians = getTechnicians();
  const centers = getCenters();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [centerFilter, setCenterFilter] = useState('ALL');

  const refreshTickets = () => {
    setTickets(getTickets());
  };

  const handleUpdateStatus = (ticketId: string, newStatus: TicketStatus) => {
    const updated = tickets.map(t => (t.id === ticketId ? { ...t, status: newStatus, updatedAt: new Date().toISOString() } : t));
    saveTickets(updated);
    setTickets(updated);
  };

  const handleAssignTechnician = (ticketId: string, techId: string) => {
    const tech = technicians.find(t => t.id === techId);
    const updated = tickets.map(t => {
      if (t.id === ticketId) {
        return {
          ...t,
          assignedTechnicianId: techId || undefined,
          assignedTechnicianName: tech?.name || undefined,
          status: (techId ? 'Assigned' : 'Open') as TicketStatus,
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    });
    saveTickets(updated);
    setTickets(updated);
  };

  const handleExportCSV = () => {
    const csv = generateCSV(tickets, [
      { key: 'ticketId', header: 'Ticket' },
      { key: 'vehicleNumber', header: 'Vehicle Number' },
      { key: 'vendor', header: 'Vendor' },
      { key: 'location', header: 'Location' },
      { key: 'centerName', header: 'Center Name' },
      { key: 'issue', header: 'Issue' },
      { key: 'category', header: 'Category' },
      { key: 'status', header: 'Status' },
      { key: 'priority', header: 'Priority' },
      { key: 'assignedTechnicianName', header: 'Assigned Technician' }
    ]);
    downloadCSV(`active_cases_${localDate()}.csv`, csv);
  };

  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      const matchSearch =
        t.ticketId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.vehicleNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.issue.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.centerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (t.assignedTechnicianName && t.assignedTechnicianName.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchStatus = statusFilter === 'ALL' || t.status === statusFilter;
      const matchPriority = priorityFilter === 'ALL' || t.priority === priorityFilter;
      const matchCenter = centerFilter === 'ALL' || t.centerName === centerFilter;

      return matchSearch && matchStatus && matchPriority && matchCenter;
    });
  }, [tickets, searchTerm, statusFilter, priorityFilter, centerFilter]);

  const uniqueCenters = Array.from(new Set(tickets.map(t => t.centerName).filter(Boolean)));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">ACTIVE CASES & INCIDENTS</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time fleet ticket queue ingested from daily operations CSVs or ERP pipelines.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleExportCSV}
            className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-2xs"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>

          <button
            onClick={() => onOpenUploadModal('TICKET_CSV')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold tracking-wide shadow-xs transition-colors flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            UPLOAD OPEN TICKETS
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search tickets by ID, vehicle reg, issue or center..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Status</option>
            <option value="Open">Open</option>
            <option value="Assigned">Assigned</option>
            <option value="In Progress">In Progress</option>
            <option value="Resolved">Resolved</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Priorities</option>
            <option value="CRITICAL">CRITICAL</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>

          <select
            value={centerFilter}
            onChange={(e) => setCenterFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Centers</option>
            {uniqueCenters.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tickets Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                <th className="py-3 px-4">Ticket</th>
                <th className="py-3 px-4">Vehicle & Vendor</th>
                <th className="py-3 px-4">Center / DC</th>
                <th className="py-3 px-4">Issue Description</th>
                <th className="py-3 px-4">Priority</th>
                <th className="py-3 px-4">Assigned Engineer</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Quick Update</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No tickets found matching current filters.
                  </td>
                </tr>
              ) : (
                filteredTickets.map((tk) => {
                  return (
                    <tr key={tk.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Ticket */}
                      <td className="py-3 px-4 font-mono font-bold text-blue-600">
                        {tk.ticketId}
                      </td>

                      {/* Vehicle & Vendor */}
                      <td className="py-3 px-4">
                        <div className="font-mono font-semibold text-slate-900">{tk.vehicleNumber}</div>
                        <div className="text-[11px] text-slate-500">{tk.vendor || 'Fleet OEM'}</div>
                      </td>

                      {/* Center */}
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900 flex items-center gap-1">
                          <Building2 className="w-3 h-3 text-slate-400" />
                          <span>{tk.centerName}</span>
                        </div>
                        <div className="text-[11px] text-slate-500">{tk.location || 'Delhi NCR'}</div>
                      </td>

                      {/* Issue */}
                      <td className="py-3 px-4 max-w-xs">
                        <div className="text-slate-900 font-medium truncate">{tk.issue}</div>
                        <div className="text-[11px] text-slate-500">
                          {tk.category || 'Maintenance'} · {tk.affectedSpare || 'General'}
                        </div>
                      </td>

                      {/* Priority */}
                      <td className="py-3 px-4">
                        <span
                          className={`font-semibold text-[11px] uppercase tracking-wide px-2 py-0.5 rounded ${
                            tk.priority === 'CRITICAL'
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : tk.priority === 'HIGH'
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : tk.priority === 'MEDIUM'
                              ? 'bg-blue-50 text-blue-800 border border-blue-200'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {tk.priority}
                        </span>
                      </td>

                      {/* Assigned Tech */}
                      <td className="py-3 px-4">
                        <select
                          value={tk.assignedTechnicianId || ''}
                          onChange={(e) => handleAssignTechnician(tk.id, e.target.value)}
                          className="px-2 py-1 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">-- Unassigned --</option>
                          {technicians.filter(t => t.status === 'Active').map(t => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t.employeeId})
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4">
                        <select
                          value={tk.status}
                          onChange={(e) => handleUpdateStatus(tk.id, e.target.value as TicketStatus)}
                          className="px-2 py-1 text-xs border border-slate-300 rounded-md bg-white font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="Open">Open</option>
                          <option value="Assigned">Assigned</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Resolved">Resolved</option>
                          <option value="Closed">Closed</option>
                        </select>
                      </td>

                      {/* Quick Update */}
                      <td className="py-3 px-4 text-right">
                        {tk.status !== 'Resolved' ? (
                          <button
                            onClick={() => handleUpdateStatus(tk.id, 'Resolved')}
                            className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded text-[11px] font-semibold transition-colors"
                          >
                            Mark Resolved
                          </button>
                        ) : (
                          <span className="text-emerald-600 text-[11px] font-medium flex items-center justify-end gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Completed
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between">
          <span>Showing {filteredTickets.length} cases</span>
          <span>{tickets.filter(t => !t.assignedTechnicianId && t.status !== 'Resolved').length} unassigned cases</span>
        </div>
      </div>
    </div>
  );
};
