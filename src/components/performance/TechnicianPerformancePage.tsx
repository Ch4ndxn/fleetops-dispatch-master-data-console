import React from 'react';
import { getTechnicians, getTickets, getAttendance } from '../../services/storage';
import { Award, CheckCircle2, Clock, Wrench, Shield } from 'lucide-react';

export const TechnicianPerformancePage: React.FC = () => {
  const technicians = getTechnicians();
  const tickets = getTickets();
  const attendance = getAttendance();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">TECHNICIAN PERFORMANCE</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Workforce KPIs, first-time-fix rate, daily case throughput, and skill distribution across Delhi NCR.
        </p>
      </div>

      {/* Roster performance table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                <th className="py-3 px-4">Technician</th>
                <th className="py-3 px-4">Specialisation</th>
                <th className="py-3 px-4">Base City / Zone</th>
                <th className="py-3 px-4 text-center">Assigned Cases</th>
                <th className="py-3 px-4 text-center">Resolved Cases</th>
                <th className="py-3 px-4 text-center">Avg Response</th>
                <th className="py-3 px-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {technicians.map((t) => {
                const assigned = tickets.filter(tk => tk.assignedTechnicianId === t.id).length;
                const resolved = tickets.filter(tk => tk.assignedTechnicianId === t.id && tk.status === 'Resolved').length;

                return (
                  <tr key={t.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{t.name}</div>
                      <div className="text-[11px] font-mono text-slate-500">{t.employeeId}</div>
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-medium text-slate-800">{t.specialisation}</span>
                      <div className="text-[11px] text-slate-500">{t.role}</div>
                    </td>

                    <td className="py-3 px-4 text-slate-700">
                      {t.city} ({t.zone || 'Base'})
                    </td>

                    <td className="py-3 px-4 text-center font-mono font-bold text-slate-900">
                      {assigned}
                    </td>

                    <td className="py-3 px-4 text-center font-mono font-bold text-emerald-600">
                      {resolved}
                    </td>

                    <td className="py-3 px-4 text-center font-mono text-slate-600">
                      ~34 mins
                    </td>

                    <td className="py-3 px-4 text-right">
                      <span
                        className={`inline-flex items-center text-[11px] font-semibold ${
                          t.status === 'Active' ? 'text-emerald-700' : 'text-slate-500'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                            t.status === 'Active' ? 'bg-emerald-500' : 'bg-slate-400'
                          }`}
                        />
                        {t.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
