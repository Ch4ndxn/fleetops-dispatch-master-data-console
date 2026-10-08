import React, { useState } from 'react';
import { Technician, AttendanceRecord, AttendanceStatus } from '../../types';
import { getTechnicians, getAttendance, upsertAttendanceRecord } from '../../services/storage';
import { generateCSV, downloadCSV } from '../../services/csvParser';
import {
  CalendarCheck,
  CheckCircle,
  XCircle,
  Clock,
  Upload,
  Download,
  Search,
  Filter,
  UserCheck
} from 'lucide-react';

interface Props {
  onOpenUploadModal: (type: 'ATTENDANCE_CSV') => void;
}

export const AttendancePage: React.FC<Props> = ({ onOpenUploadModal }) => {
  const [technicians] = useState<Technician[]>(() => getTechnicians());
  const [attendanceList, setAttendanceList] = useState<AttendanceRecord[]>(() => getAttendance());
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [searchTerm, setSearchTerm] = useState('');

  const refreshAttendance = () => {
    setAttendanceList(getAttendance());
  };

  const handleUpdateStatus = (tech: Technician, newStatus: AttendanceStatus) => {
    const existing = attendanceList.find(a => a.employeeId.toUpperCase() === tech.employeeId.toUpperCase() && a.date === selectedDate);
    const nowTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

    upsertAttendanceRecord({
      employeeId: tech.employeeId,
      technicianName: tech.name,
      date: selectedDate,
      status: newStatus,
      checkInTime: newStatus === 'Present' || newStatus === 'Half-Day' ? (existing?.checkInTime || nowTime) : '',
      notes: existing?.notes || `Status marked as ${newStatus}`
    });

    refreshAttendance();
  };

  const handleExportCSV = () => {
    const csv = generateCSV(attendanceList, [
      { key: 'employeeId', header: 'Technician / Emp ID' },
      { key: 'technicianName', header: 'Technician Name' },
      { key: 'date', header: 'Date' },
      { key: 'status', header: 'Status' },
      { key: 'checkInTime', header: 'Check-In' },
      { key: 'checkOutTime', header: 'Check-Out' },
      { key: 'notes', header: 'Note' }
    ]);
    downloadCSV(`attendance_${selectedDate}.csv`, csv);
  };

  // Only active technicians are eligible for attendance (Requirement 1 & 22)
  const activeTechnicians = technicians.filter(t => t.status === 'Active');

  const filteredTechnicians = activeTechnicians.filter(t =>
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.employeeId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.city.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">ATTENDANCE ROSTER</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Mark daily shift check-ins. Active present technicians are automatically unlocked for route planner dispatch.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white shadow-2xs"
          />

          <button
            onClick={handleExportCSV}
            className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-2xs"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>

          <button
            onClick={() => onOpenUploadModal('ATTENDANCE_CSV')}
            className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-2xs"
          >
            <Upload className="w-3.5 h-3.5" />
            UPLOAD ATTENDANCE CSV
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search active technicians..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Active roster: {activeTechnicians.length} technicians
        </div>
      </div>

      {/* Attendance Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                <th className="py-3 px-4">Emp ID</th>
                <th className="py-3 px-4">Technician Name</th>
                <th className="py-3 px-4">Base DC / Zone</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Check-In</th>
                <th className="py-3 px-4">Current Status</th>
                <th className="py-3 px-4 text-right">Quick Mark Attendance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredTechnicians.map((tech) => {
                const record = attendanceList.find(
                  a => a.employeeId.toUpperCase() === tech.employeeId.toUpperCase() && a.date === selectedDate
                );
                const status = record?.status || 'Absent';

                return (
                  <tr key={tech.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-slate-900">
                      {tech.employeeId}
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{tech.name}</div>
                      <div className="text-[11px] text-slate-500">{tech.role} · {tech.specialisation}</div>
                    </td>

                    <td className="py-3 px-4 text-slate-700">
                      <div>{tech.defaultDc || 'Central Hub'}</div>
                      <div className="text-[11px] text-slate-500">{tech.city} ({tech.zone || 'Base'})</div>
                    </td>

                    <td className="py-3 px-4 text-slate-600 font-mono">
                      {selectedDate}
                    </td>

                    <td className="py-3 px-4 font-mono text-slate-800">
                      {record?.checkInTime ? (
                        <span className="flex items-center gap-1 text-emerald-700 font-medium">
                          <Clock className="w-3 h-3 text-emerald-500" />
                          {record.checkInTime}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center text-[11px] font-semibold ${
                          status === 'Present'
                            ? 'text-emerald-700'
                            : status === 'Half-Day'
                            ? 'text-amber-700'
                            : status === 'On Leave'
                            ? 'text-blue-700'
                            : 'text-slate-500'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                            status === 'Present'
                              ? 'bg-emerald-500'
                              : status === 'Half-Day'
                              ? 'bg-amber-500'
                              : status === 'On Leave'
                              ? 'bg-blue-500'
                              : 'bg-slate-400'
                          }`}
                        />
                        {status}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleUpdateStatus(tech, 'Present')}
                          className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                            status === 'Present'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700'
                          }`}
                        >
                          Present
                        </button>

                        <button
                          onClick={() => handleUpdateStatus(tech, 'Half-Day')}
                          className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                            status === 'Half-Day'
                              ? 'bg-amber-600 text-white'
                              : 'bg-slate-100 hover:bg-amber-50 text-slate-700 hover:text-amber-700'
                          }`}
                        >
                          Half-Day
                        </button>

                        <button
                          onClick={() => handleUpdateStatus(tech, 'Absent')}
                          className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                            status === 'Absent'
                              ? 'bg-slate-700 text-white'
                              : 'bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-700'
                          }`}
                        >
                          Absent
                        </button>
                      </div>
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
