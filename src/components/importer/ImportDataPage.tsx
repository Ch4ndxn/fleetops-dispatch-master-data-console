import React from 'react';
import { ImportType } from '../../types';
import { ImportHistoryPage } from '../history/ImportHistoryPage';
import { downloadCSV } from '../../services/csvParser';
import {
  Upload,
  FileSpreadsheet,
  Download,
  AlertCircle,
  Building2,
  Users,
  CheckSquare,
  Wrench
} from 'lucide-react';

interface Props {
  onOpenUploadModal: (type: ImportType) => void;
}

export const ImportDataPage: React.FC<Props> = ({ onOpenUploadModal }) => {
  // Sample templates for operations users
  const downloadTemplate = (type: ImportType) => {
    if (type === 'CENTER_CSV') {
      const csv = `Center Name,City,Latitude,Longitude,Default DC,Active,Notes
Delhi_PatelNagar_D,Delhi,28.6519,77.1663,Central Delhi DC,true,West Delhi main swap hub
Delhi_Naraina_D,Delhi,28.6289,77.1382,West Delhi DC,true,Industrial fleet depot
Noida_Sector83_D,Noida,28.5145,77.4086,Noida Main DC,true,Sector 83 Phase 2 hub
Delhi_OkhlaPhase3_D,Delhi,28.5362,77.2711,South Delhi DC,true,South Delhi fast depot
Gurugram_UdyogVihar_D,Gurugram,28.5028,77.0878,Gurugram DC,true,Cyber City corridor`;
      downloadCSV('sample_center_dc_template.csv', csv);
    } else if (type === 'TICKET_CSV') {
      const csv = `Ticket,Vehicle Number,Vendor,Location,Center Name,Issue,Category,Status,Affected Spare,Issue Type,Priority
INC123,HR51AB1234,Zen,Delhi,Delhi_PatelNagar_D,Controller communication error,Electrical,Open,Controller,Breakdown,CRITICAL
INC124,HR51AB5678,Switch,Noida,Noida_Sector83_D,Motor phase short circuit,Mechanical,Open,Motor,Breakdown,HIGH
INC125,DL01EV9922,Zen,Delhi,Delhi_Naraina_D,BMS balancing delta over 150mV,Battery,Open,BMS Module,Breakdown,HIGH
INC126,HR26EV3012,Zen,Gurugram,Gurugram_UdyogVihar_D,Throttle loose sensor,Electrical,Open,Throttle Sensor,Periodic,MEDIUM`;
      downloadCSV('sample_open_tickets_template.csv', csv);
    } else if (type === 'TECHNICIAN_CSV') {
      const csv = `Emp ID,Name,Phone,Alt Phone,Role,Vendor,City,Zone,Specialisation,Status,Joined Date,Assigned STM,Notes,Latitude,Longitude,Default DC
TECH-1006,Suresh Raina,9871112233,9871112234,Senior Technician,Zen Fleet Ops,Delhi,South Delhi,Electrical,Active,2024-04-01,Amit Verma,BMS expert,28.5350,77.2600,South Delhi DC
TECH-1007,Manoj Tiwari,9812223344,,Field Engineer,Switch Mobility,Noida,Sector 83,Motor,Active,2024-05-10,Amit Verma,Hub motor certified,28.5200,77.3900,Noida Main DC`;
      downloadCSV('sample_technicians_template.csv', csv);
    } else if (type === 'ATTENDANCE_CSV') {
      const today = new Date().toISOString().split('T')[0];
      const csv = `Technician / Emp ID,Date,Status,Check-In,Check-Out,Note
TECH-1001,${today},Present,08:45,,Central DC morning briefing
TECH-1002,${today},Present,09:00,,Noida DC deployment
TECH-1003,${today},Present,08:50,,South Delhi fast bench
TECH-1004,${today},Present,09:15,,Gurugram corridor`;
      downloadCSV('sample_attendance_template.csv', csv);
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">IMPORT DATA</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Bulk operational data ingestion engine with automatic validation, fuzzy matching, and safe duplicate prevention.
        </p>
      </div>

      {/* 4 Cards (Requirement 27) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: OPEN TICKETS */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs hover:shadow-xs transition-shadow flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">OPEN TICKETS</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Upload daily/open-ticket CSV for dispatch and automated route optimization.
              </p>
            </div>
            <div className="pt-1 text-[11px] text-slate-600 space-y-0.5">
              <div>• Upsert by <code>ticket_id</code></div>
              <div>• Detects missing centers</div>
              <div>• Never deletes absent tickets</div>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100">
            <button
              onClick={() => onOpenUploadModal('TICKET_CSV')}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-colors flex items-center justify-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              UPLOAD CSV
            </button>
            <button
              onClick={() => downloadTemplate('TICKET_CSV')}
              className="w-full py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-[11px] font-medium transition-colors flex items-center justify-center gap-1"
            >
              <Download className="w-3 h-3 text-slate-400" />
              Download Sample CSV
            </button>
          </div>
        </div>

        {/* Card 2: CENTER / DC COORDINATES */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs hover:shadow-xs transition-shadow flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">CENTER / DC COORDINATES</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Upload center latitude/longitude CSV to geocode service stations.
              </p>
            </div>
            <div className="pt-1 text-[11px] text-slate-600 space-y-0.5">
              <div>• Lat: -90 to +90, Lng: -180 to +180</div>
              <div>• Case-insensitive matching</div>
              <div>• Updates existing center coords</div>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100">
            <button
              onClick={() => onOpenUploadModal('CENTER_CSV')}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-colors flex items-center justify-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              UPLOAD CSV
            </button>
            <button
              onClick={() => downloadTemplate('CENTER_CSV')}
              className="w-full py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-[11px] font-medium transition-colors flex items-center justify-center gap-1"
            >
              <Download className="w-3 h-3 text-slate-400" />
              Download Sample CSV
            </button>
          </div>
        </div>

        {/* Card 3: TECHNICIANS */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs hover:shadow-xs transition-shadow flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">TECHNICIANS</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Bulk technician upload with skill domains and starting coordinates.
              </p>
            </div>
            <div className="pt-1 text-[11px] text-slate-600 space-y-0.5">
              <div>• Keyed by <code>Employee ID</code></div>
              <div>• Phone validation</div>
              <div>• Start lat/lng for route engine</div>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100">
            <button
              onClick={() => onOpenUploadModal('TECHNICIAN_CSV')}
              className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-colors flex items-center justify-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              UPLOAD CSV
            </button>
            <button
              onClick={() => downloadTemplate('TECHNICIAN_CSV')}
              className="w-full py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-[11px] font-medium transition-colors flex items-center justify-center gap-1"
            >
              <Download className="w-3 h-3 text-slate-400" />
              Download Sample CSV
            </button>
          </div>
        </div>

        {/* Card 4: ATTENDANCE */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs hover:shadow-xs transition-shadow flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="w-10 h-10 bg-purple-50 text-purple-600 rounded-lg flex items-center justify-center">
              <CheckSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">ATTENDANCE</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Bulk attendance upload to unlock active engineers for route planning.
              </p>
            </div>
            <div className="pt-1 text-[11px] text-slate-600 space-y-0.5">
              <div>• Keyed by <code>Emp ID + Date</code></div>
              <div>• Present / Absent / Half-Day</div>
              <div>• Check-in timestamps</div>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100">
            <button
              onClick={() => onOpenUploadModal('ATTENDANCE_CSV')}
              className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-colors flex items-center justify-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              UPLOAD CSV
            </button>
            <button
              onClick={() => downloadTemplate('ATTENDANCE_CSV')}
              className="w-full py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-[11px] font-medium transition-colors flex items-center justify-center gap-1"
            >
              <Download className="w-3 h-3 text-slate-400" />
              Download Sample CSV
            </button>
          </div>
        </div>
      </div>

      {/* Embedded Import History below as requested in Requirement 27 */}
      <div className="pt-4 border-t border-slate-200">
        <ImportHistoryPage />
      </div>
    </div>
  );
};
