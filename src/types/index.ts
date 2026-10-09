export type TechnicianRole = 'Senior Technician' | 'Field Engineer' | 'Battery Specialist' | 'Electrical Specialist' | 'Trainee';
export type TechnicianStatus = 'Active' | 'Inactive' | 'On Leave' | 'Suspended';
export type Specialisation = 'Electrical' | 'Mechanical' | 'Battery' | 'Controller' | 'Motor' | 'General Fleet' | 'Diagnostics';

export interface Technician {
  id: string; // Internal id or UUID
  employeeId: string; // Unique business key
  name: string;
  phone: string;
  alternatePhone?: string;
  role: TechnicianRole;
  vendor?: string;
  city: string;
  zone?: string;
  specialisation: Specialisation;
  status: TechnicianStatus;
  joinedDate?: string;
  assignedStm?: string; // Senior Technical Manager
  notes?: string;
  startingLatitude?: number;
  startingLongitude?: number;
  defaultDc?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Center {
  id: string;
  name: string; // Business key (e.g. Delhi_PatelNagar_D)
  normalizedName: string; // lowercased & trimmed for matching
  city: string;
  latitude: number;
  longitude: number;
  defaultDc?: string;
  active: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type TicketPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type TicketStatus = 'Open' | 'Assigned' | 'In Progress' | 'Pending Spares' | 'Resolved' | 'Closed';

export interface Ticket {
  id: string;
  ticketId: string; // Unique business key (e.g. INC123)
  vehicleNumber: string;
  vendor?: string;
  location?: string;
  centerName: string;
  issue: string;
  category?: string;
  status: TicketStatus;
  priority: TicketPriority;
  affectedSpare?: string;
  issueType?: string; // Breakdown, Periodic, Software, etc.
  assignedTechnicianId?: string;
  assignedTechnicianName?: string;
  scheduledSlot?: string;
  createdAt: string;
  updatedAt: string;
  isNew?: boolean;
}

export type AttendanceStatus = 'Present' | 'Absent' | 'Half-Day' | 'On Leave';

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  technicianName: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  checkInTime?: string; // HH:mm
  checkOutTime?: string; // HH:mm
  notes?: string;
  verifiedBy?: string;
  updatedAt: string;
}

// ─── Visit Log ────────────────────────────────────────────────────────────────
export type VisitOutcome = 'Resolved' | 'Partial Fix' | 'Pending Spares' | 'Escalated' | 'No Access' | 'Revisit Needed';

export interface VisitLog {
  id: string;
  ticketId: string;          // business key, e.g. INC-1234
  technicianId: string;
  technicianName: string;
  employeeId: string;
  centerName: string;
  vehicleNumber: string;
  visitDate: string;         // YYYY-MM-DD
  checkInTime?: string;      // HH:mm
  checkOutTime?: string;     // HH:mm
  outcome: VisitOutcome;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type ImportType = 'CENTER_CSV' | 'TICKET_CSV' | 'TECHNICIAN_CSV' | 'ATTENDANCE_CSV';
export type ImportStatus = 'COMPLETED' | 'FAILED' | 'PARTIAL';

export interface ImportErrorDetail {
  row: number;
  identifier: string;
  error: string;
  rawData?: Record<string, string>;
}

export interface ImportJob {
  id: string;
  importType: ImportType;
  fileName: string;
  uploadedBy: string;
  uploadedAt: string;
  totalRows: number;
  insertedRows: number;
  updatedRows: number;
  skippedRows: number;
  failedRows: number;
  status: ImportStatus;
  errors?: ImportErrorDetail[];
  observations?: string[];
  newHighPriorityCount?: number;
  missingCentersFound?: string[];
}

export interface DataQualityStats {
  techniciansMissingLocation: number;
  centersMissingCoordinates: number;
  ticketsWithoutCenter: number;
  ticketsWithoutPriority: number;
  ticketsWithoutAssignment: number;
  invalidCoordinates: number;
}

export interface RouteStop {
  stopOrder: number;
  ticketId: string;
  centerName: string;
  vehicleNumber: string;
  issue: string;
  priority: TicketPriority;
  latitude: number;
  longitude: number;
  estimatedArrival: string;
  estimatedDurationMins: number;
}

export interface TechnicianRoutePlan {
  technicianId: string;
  technicianName: string;
  employeeId: string;
  startLat: number;
  startLng: number;
  defaultDc?: string;
  stops: RouteStop[];
  totalDistanceKm: number;
  totalEstimatedMins: number;
  status: 'Draft' | 'Confirmed' | 'In-Transit' | 'Completed';
}
