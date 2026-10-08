import React, { useState } from 'react';
import { ImportJob } from '../../types';
import { getImportJobs } from '../../services/storage';
import { generateErrorReportCSV, downloadCSV } from '../../services/csvParser';
import {
  History,
  FileText,
  CheckCircle2,
  AlertCircle,
  Download,
  X,
  Building2,
  Calendar,
  User,
  Search
} from 'lucide-react';

export const ImportHistoryPage: React.FC = () => {
  const [jobs] = useState<ImportJob[]>(() => getImportJobs());
  const [selectedJob, setSelectedJob] = useState<ImportJob | null>(null);
  const [filterType, setFilterType] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredJobs = jobs.filter(j => {
    const matchType = filterType === 'ALL' || j.importType === filterType;
    const matchSearch =
      j.fileName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      j.uploadedBy.toLowerCase().includes(searchTerm.toLowerCase());
    return matchType && matchSearch;
  });

  const handleDownloadErrors = (job: ImportJob) => {
    if (!job.errors || job.errors.length === 0) return;
    const csvContent = generateErrorReportCSV(job.errors);
    downloadCSV(`errors_${job.fileName}`, csvContent);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">IMPORT HISTORY</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Audit trail of all master data batch ingestions: tickets, center coordinates, technician roster, and attendance records.
        </p>
      </div>

      {/* Filter toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by file name or uploader..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Type:</span>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Types</option>
            <option value="TICKET_CSV">Ticket CSV</option>
            <option value="CENTER_CSV">Center CSV</option>
            <option value="TECHNICIAN_CSV">Technician CSV</option>
            <option value="ATTENDANCE_CSV">Attendance CSV</option>
          </select>
        </div>
      </div>

      {/* Table Requirement 15 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">File</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4 text-right">Rows</th>
                <th className="py-3 px-4 text-right">Added</th>
                <th className="py-3 px-4 text-right">Updated</th>
                <th className="py-3 px-4 text-right">Failed</th>
                <th className="py-3 px-4">Uploaded By</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500">
                    No import jobs found.
                  </td>
                </tr>
              ) : (
                filteredJobs.map((job) => (
                  <tr
                    key={job.id}
                    onClick={() => setSelectedJob(job)}
                    className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                  >
                    {/* Date */}
                    <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                      {job.uploadedAt}
                    </td>

                    {/* File */}
                    <td className="py-3 px-4 font-medium text-slate-900 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className="truncate max-w-xs">{job.fileName}</span>
                    </td>

                    {/* Type */}
                    <td className="py-3 px-4">
                      <span className="font-mono text-[11px] text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                        {job.importType}
                      </span>
                    </td>

                    {/* Rows */}
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                      {job.totalRows}
                    </td>

                    {/* Added */}
                    <td className="py-3 px-4 text-right font-mono text-emerald-600 font-semibold">
                      +{job.insertedRows}
                    </td>

                    {/* Updated */}
                    <td className="py-3 px-4 text-right font-mono text-amber-600">
                      {job.updatedRows}
                    </td>

                    {/* Failed */}
                    <td className="py-3 px-4 text-right font-mono text-rose-600">
                      {job.failedRows > 0 ? job.failedRows : '0'}
                    </td>

                    {/* Uploaded By */}
                    <td className="py-3 px-4 text-slate-600 text-[11px] truncate max-w-[160px]">
                      {job.uploadedBy}
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-flex items-center text-[11px] font-semibold ${
                          job.status === 'COMPLETED'
                            ? 'text-emerald-700'
                            : job.status === 'PARTIAL'
                            ? 'text-amber-700'
                            : 'text-rose-700'
                        }`}
                      >
                        {job.status === 'COMPLETED' && <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-500" />}
                        {job.status !== 'COMPLETED' && <AlertCircle className="w-3.5 h-3.5 mr-1 text-amber-500" />}
                        {job.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detailed Modal when a job is clicked */}
      {selectedJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
              <div>
                <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <History className="w-5 h-5 text-blue-600" />
                  Import Job Details — {selectedJob.id}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Uploaded at {selectedJob.uploadedAt} by {selectedJob.uploadedBy}
                </p>
              </div>
              <button
                onClick={() => setSelectedJob(null)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-500 block text-[11px]">Total Rows:</span>
                  <span className="font-bold text-slate-900 text-base">{selectedJob.totalRows}</span>
                </div>
                <div>
                  <span className="text-emerald-600 block text-[11px]">Inserted:</span>
                  <span className="font-bold text-emerald-600 text-base">+{selectedJob.insertedRows}</span>
                </div>
                <div>
                  <span className="text-amber-600 block text-[11px]">Updated:</span>
                  <span className="font-bold text-amber-600 text-base">{selectedJob.updatedRows}</span>
                </div>
                <div>
                  <span className="text-rose-600 block text-[11px]">Failed / Skipped:</span>
                  <span className="font-bold text-rose-600 text-base">{selectedJob.failedRows}</span>
                </div>
              </div>

              {selectedJob.observations && selectedJob.observations.length > 0 && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 space-y-1">
                  <div className="font-semibold">System Observations:</div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {selectedJob.observations.map((obs, i) => (
                      <li key={i}>{obs}</li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedJob.missingCentersFound && selectedJob.missingCentersFound.length > 0 && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-rose-600" />
                    Missing Centers in Master:
                  </div>
                  <div className="font-mono text-[11px]">
                    {selectedJob.missingCentersFound.join(', ')}
                  </div>
                </div>
              )}

              {selectedJob.errors && selectedJob.errors.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-rose-800">Errors Breakdown ({selectedJob.errors.length}):</span>
                    <button
                      onClick={() => handleDownloadErrors(selectedJob)}
                      className="px-2.5 py-1 bg-white border border-rose-300 text-rose-700 rounded text-[11px] font-medium hover:bg-rose-50 flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      Download Error CSV
                    </button>
                  </div>
                  <div className="max-h-40 overflow-y-auto border border-rose-200 bg-rose-50/50 p-2.5 rounded-lg space-y-1 font-mono text-[11px] text-rose-800">
                    {selectedJob.errors.map((e, idx) => (
                      <div key={idx}>Row {e.row} ({e.identifier}): {e.error}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setSelectedJob(null)}
                className="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
