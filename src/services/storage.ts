import {
  Technician,
  Center,
  Ticket,
  AttendanceRecord,
  ImportJob,
  DataQualityStats,
  TechnicianRoutePlan,
  TicketPriority,
  ImportType
} from '../types';
import { normalizeCenterName, isValidLatitude, isValidLongitude } from './csvParser';

const STORAGE_KEYS = {
  TECHNICIANS: 'fleetops_technicians_v2',
  CENTERS: 'fleetops_centers_v2',
  TICKETS: 'fleetops_tickets_v2',
  ATTENDANCE: 'fleetops_attendance_v2',
  IMPORT_JOBS: 'fleetops_import_jobs_v2',
  ROUTES: 'fleetops_routes_v2',
};

// Delhi NCR Initial Hubs
const INITIAL_CENTERS: Center[] = [
  {
    id: 'dc-1',
    name: 'Delhi_PatelNagar_D',
    normalizedName: normalizeCenterName('Delhi_PatelNagar_D'),
    city: 'Delhi',
    latitude: 28.6519,
    longitude: 77.1663,
    defaultDc: 'Central Delhi DC',
    active: true,
    notes: 'Major West-Central Delhi service and swap hub',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'dc-2',
    name: 'Delhi_Naraina_D',
    normalizedName: normalizeCenterName('Delhi_Naraina_D'),
    city: 'Delhi',
    latitude: 28.6289,
    longitude: 77.1382,
    defaultDc: 'West Delhi DC',
    active: true,
    notes: 'Industrial area hub with heavy commercial EV throughput',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'dc-3',
    name: 'Noida_Sector83_D',
    normalizedName: normalizeCenterName('Noida_Sector83_D'),
    city: 'Noida',
    latitude: 28.5145,
    longitude: 77.4086,
    defaultDc: 'Noida Main DC',
    active: true,
    notes: 'Key Expressway and Phase-2 distribution station',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'dc-4',
    name: 'Delhi_OkhlaPhase3_D',
    normalizedName: normalizeCenterName('Delhi_OkhlaPhase3_D'),
    city: 'Delhi',
    latitude: 28.5362,
    longitude: 77.2711,
    defaultDc: 'South Delhi DC',
    active: true,
    notes: 'High-density quick-repair and battery diagnostics facility',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'dc-5',
    name: 'Gurugram_UdyogVihar_D',
    normalizedName: normalizeCenterName('Gurugram_UdyogVihar_D'),
    city: 'Gurugram',
    latitude: 28.5028,
    longitude: 77.0878,
    defaultDc: 'Gurugram DC',
    active: true,
    notes: 'Cyber City and Industrial fleet support center',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'dc-6',
    name: 'Faridabad_Sector24_D',
    normalizedName: normalizeCenterName('Faridabad_Sector24_D'),
    city: 'Faridabad',
    latitude: 28.3752,
    longitude: 77.3155,
    defaultDc: 'Faridabad DC',
    active: true,
    notes: 'South NCR logistics and 3-wheeler repair depot',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

const INITIAL_TECHNICIANS: Technician[] = [
  {
    id: 'tech-1',
    employeeId: 'TECH-1001',
    name: 'Rajesh Sharma',
    phone: '9876543210',
    alternatePhone: '9876543219',
    role: 'Senior Technician',
    vendor: 'Zen Fleet Ops',
    city: 'Delhi',
    zone: 'West Delhi',
    specialisation: 'Electrical',
    status: 'Active',
    joinedDate: '2023-04-12',
    assignedStm: 'Amit Verma (STM)',
    notes: 'Expert in BMS and wiring harnesses',
    startingLatitude: 28.6448,
    startingLongitude: 77.1511,
    defaultDc: 'Central Delhi DC',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'tech-2',
    employeeId: 'TECH-1002',
    name: 'Vikram Singh',
    phone: '9812345678',
    alternatePhone: '9812345670',
    role: 'Field Engineer',
    vendor: 'Zen Fleet Ops',
    city: 'Noida',
    zone: 'Sector 83 / Expressway',
    specialisation: 'Motor',
    status: 'Active',
    joinedDate: '2023-08-01',
    assignedStm: 'Amit Verma (STM)',
    notes: 'Motor replacement & gearbox expert',
    startingLatitude: 28.5355,
    startingLongitude: 77.3910,
    defaultDc: 'Noida Main DC',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'tech-3',
    employeeId: 'TECH-1003',
    name: 'Sunil Kumar Yadav',
    phone: '9823456789',
    role: 'Battery Specialist',
    vendor: 'Switch Mobility',
    city: 'Delhi',
    zone: 'South Delhi',
    specialisation: 'Battery',
    status: 'Active',
    joinedDate: '2024-01-15',
    assignedStm: 'Deepak Rao (STM)',
    notes: 'Cell balancing & high-voltage safety certified',
    startingLatitude: 28.5284,
    startingLongitude: 77.2655,
    defaultDc: 'South Delhi DC',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'tech-4',
    employeeId: 'TECH-1004',
    name: 'Mohammad Tariq',
    phone: '9834567890',
    role: 'Field Engineer',
    vendor: 'Zen Fleet Ops',
    city: 'Gurugram',
    zone: 'Udyog Vihar',
    specialisation: 'Controller',
    status: 'Active',
    joinedDate: '2024-02-10',
    assignedStm: 'Deepak Rao (STM)',
    notes: 'ECU flashing and throttle recalibration',
    startingLatitude: 28.4988,
    startingLongitude: 77.0850,
    defaultDc: 'Gurugram DC',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'tech-5',
    employeeId: 'TECH-1005',
    name: 'Pooja Rawat',
    phone: '9845678901',
    role: 'Field Engineer',
    vendor: 'Zen Fleet Ops',
    city: 'Delhi',
    zone: 'North / West Delhi',
    specialisation: 'Diagnostics',
    status: 'On Leave',
    joinedDate: '2024-03-01',
    assignedStm: 'Amit Verma (STM)',
    notes: 'On medical leave till Friday',
    startingLatitude: 28.6692,
    startingLongitude: 77.1554,
    defaultDc: 'Central Delhi DC',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

const INITIAL_TICKETS: Ticket[] = [
  {
    id: 't-101',
    ticketId: 'INC-701',
    vehicleNumber: 'DL01EV1024',
    vendor: 'Zen',
    location: 'West Delhi',
    centerName: 'Delhi_PatelNagar_D',
    issue: 'Controller communication failure / vehicle limp mode',
    category: 'Electrical',
    status: 'Open',
    priority: 'CRITICAL',
    affectedSpare: 'Controller 48V',
    issueType: 'Breakdown',
    assignedTechnicianId: 'tech-1',
    assignedTechnicianName: 'Rajesh Sharma',
    createdAt: '2026-10-07T08:30:00Z',
    updatedAt: '2026-10-07T08:30:00Z'
  },
  {
    id: 't-102',
    ticketId: 'INC-702',
    vehicleNumber: 'UP16EV4482',
    vendor: 'Switch',
    location: 'Noida',
    centerName: 'Noida_Sector83_D',
    issue: 'BLDC motor phase short circuit, high vibration',
    category: 'Mechanical',
    status: 'Open',
    priority: 'HIGH',
    affectedSpare: 'Hub Motor Assembly',
    issueType: 'Breakdown',
    assignedTechnicianId: 'tech-2',
    assignedTechnicianName: 'Vikram Singh',
    createdAt: '2026-10-07T09:15:00Z',
    updatedAt: '2026-10-07T09:15:00Z'
  },
  {
    id: 't-103',
    ticketId: 'INC-703',
    vehicleNumber: 'DL04EV8890',
    vendor: 'Zen',
    location: 'South Delhi',
    centerName: 'Delhi_OkhlaPhase3_D',
    issue: 'BMS cut-off under 40% SoC, cell delta >150mV',
    category: 'Battery',
    status: 'Assigned',
    priority: 'HIGH',
    affectedSpare: 'BMS Module',
    issueType: 'Breakdown',
    assignedTechnicianId: 'tech-3',
    assignedTechnicianName: 'Sunil Kumar Yadav',
    createdAt: '2026-10-07T09:40:00Z',
    updatedAt: '2026-10-07T09:40:00Z'
  },
  {
    id: 't-104',
    ticketId: 'INC-704',
    vehicleNumber: 'HR26EV3012',
    vendor: 'Zen',
    location: 'Gurugram',
    centerName: 'Gurugram_UdyogVihar_D',
    issue: 'Throttle potentiometer erratic response',
    category: 'Electrical',
    status: 'Open',
    priority: 'MEDIUM',
    affectedSpare: 'Throttle Sensor',
    issueType: 'Periodic',
    assignedTechnicianId: 'tech-4',
    assignedTechnicianName: 'Mohammad Tariq',
    createdAt: '2026-10-07T10:10:00Z',
    updatedAt: '2026-10-07T10:10:00Z'
  },
  {
    id: 't-105',
    ticketId: 'INC-705',
    vehicleNumber: 'DL01EV9911',
    vendor: 'Zen',
    location: 'West Delhi',
    centerName: 'Delhi_Naraina_D',
    issue: 'Brake cut-off switch loose contact',
    category: 'Mechanical',
    status: 'Open',
    priority: 'LOW',
    affectedSpare: 'Brake Switch',
    issueType: 'Periodic',
    createdAt: '2026-10-07T10:30:00Z',
    updatedAt: '2026-10-07T10:30:00Z'
  }
];

const INITIAL_IMPORT_JOBS: ImportJob[] = [
  {
    id: 'job-init-1',
    importType: 'CENTER_CSV',
    fileName: 'delhi_ncr_master_centers_oct2026.csv',
    uploadedBy: 'chandanchatterjee4455@gmail.com',
    uploadedAt: '2026-10-07 09:00:00',
    totalRows: 6,
    insertedRows: 6,
    updatedRows: 0,
    skippedRows: 0,
    failedRows: 0,
    status: 'COMPLETED',
    observations: ['All 6 Delhi NCR centers geocoded and verified']
  },
  {
    id: 'job-init-2',
    importType: 'TICKET_CSV',
    fileName: 'daily_fleet_open_tickets_07oct.csv',
    uploadedBy: 'chandanchatterjee4455@gmail.com',
    uploadedAt: '2026-10-07 10:45:00',
    totalRows: 5,
    insertedRows: 5,
    updatedRows: 0,
    skippedRows: 0,
    failedRows: 0,
    status: 'COMPLETED',
    newHighPriorityCount: 3,
    observations: ['5 tickets ingested with 3 critical/high breakdown cases']
  }
];

// Event listeners for real-time reactivity in the app
type StorageListener = () => void;
const listeners = new Set<StorageListener>();

export function subscribeToDataChanges(callback: StorageListener): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notifyDataChanged() {
  listeners.forEach(cb => {
    try {
      cb();
    } catch (e) {
      console.error('Storage listener error:', e);
    }
  });
}

// Helper to get from LocalStorage with defaults
function getItem<T>(key: string, defaultVal: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultVal;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading ${key} from storage:`, err);
    return defaultVal;
  }
}

function setItem<T>(key: string, val: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(val));
    notifyDataChanged();
  } catch (err) {
    console.error(`Error saving ${key} to storage:`, err);
  }
}

// ==================== CENTERS ====================

export function getCenters(): Center[] {
  return getItem<Center[]>(STORAGE_KEYS.CENTERS, INITIAL_CENTERS);
}

export function saveCenters(centers: Center[]): void {
  setItem(STORAGE_KEYS.CENTERS, centers);
}

export function findCenterByName(name: string): Center | undefined {
  const normalized = normalizeCenterName(name);
  const centers = getCenters();
  return centers.find(c => c.normalizedName === normalized || normalizeCenterName(c.name) === normalized);
}

export function upsertCenter(centerInput: Partial<Center> & { name: string; latitude: number; longitude: number }): { center: Center; isNew: boolean } {
  const centers = getCenters();
  const normalized = normalizeCenterName(centerInput.name);
  const existingIndex = centers.findIndex(c => c.normalizedName === normalized || normalizeCenterName(c.name) === normalized);

  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    const existing = centers[existingIndex];
    const updated: Center = {
      ...existing,
      ...centerInput,
      normalizedName: normalized,
      updatedAt: now
    };
    centers[existingIndex] = updated;
    saveCenters(centers);
    return { center: updated, isNew: false };
  } else {
    const newCenter: Center = {
      id: centerInput.id || `dc-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: centerInput.name.trim(),
      normalizedName: normalized,
      city: centerInput.city || 'Delhi',
      latitude: Number(centerInput.latitude),
      longitude: Number(centerInput.longitude),
      defaultDc: centerInput.defaultDc || `${centerInput.name} DC`,
      active: centerInput.active !== undefined ? Boolean(centerInput.active) : true,
      notes: centerInput.notes || '',
      createdAt: now,
      updatedAt: now
    };
    centers.push(newCenter);
    saveCenters(centers);
    return { center: newCenter, isNew: true };
  }
}

export function deleteCenter(id: string): void {
  const centers = getCenters().filter(c => c.id !== id);
  saveCenters(centers);
}

// ==================== TECHNICIANS ====================

export function getTechnicians(): Technician[] {
  return getItem<Technician[]>(STORAGE_KEYS.TECHNICIANS, INITIAL_TECHNICIANS);
}

export function saveTechnicians(technicians: Technician[]): void {
  setItem(STORAGE_KEYS.TECHNICIANS, technicians);
}

export function findTechnicianByEmployeeId(empId: string): Technician | undefined {
  if (!empId) return undefined;
  const clean = empId.trim().toLowerCase();
  return getTechnicians().find(t => t.employeeId.trim().toLowerCase() === clean);
}

export function upsertTechnician(techInput: Partial<Technician> & { employeeId: string; name: string }): { technician: Technician; isNew: boolean } {
  const technicians = getTechnicians();
  const cleanEmpId = techInput.employeeId.trim().toUpperCase();
  const existingIndex = technicians.findIndex(t => t.employeeId.trim().toUpperCase() === cleanEmpId);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    const existing = technicians[existingIndex];
    const updated: Technician = {
      ...existing,
      ...techInput,
      employeeId: cleanEmpId,
      updatedAt: now
    };
    technicians[existingIndex] = updated;
    saveTechnicians(technicians);
    return { technician: updated, isNew: false };
  } else {
    const newTech: Technician = {
      id: techInput.id || `tech-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      employeeId: cleanEmpId,
      name: techInput.name.trim(),
      phone: techInput.phone || '',
      alternatePhone: techInput.alternatePhone || '',
      role: techInput.role || 'Field Engineer',
      vendor: techInput.vendor || 'In-House Ops',
      city: techInput.city || 'Delhi',
      zone: techInput.zone || 'Central',
      specialisation: techInput.specialisation || 'General Fleet',
      status: techInput.status || 'Active',
      joinedDate: techInput.joinedDate || new Date().toISOString().split('T')[0],
      assignedStm: techInput.assignedStm || '',
      notes: techInput.notes || '',
      startingLatitude: techInput.startingLatitude,
      startingLongitude: techInput.startingLongitude,
      defaultDc: techInput.defaultDc || '',
      createdAt: now,
      updatedAt: now
    };
    technicians.push(newTech);
    saveTechnicians(technicians);
    return { technician: newTech, isNew: true };
  }
}

export function deleteTechnician(id: string): void {
  const techs = getTechnicians().filter(t => t.id !== id);
  saveTechnicians(techs);
}

// ==================== TICKETS ====================

export function getTickets(): Ticket[] {
  return getItem<Ticket[]>(STORAGE_KEYS.TICKETS, INITIAL_TICKETS);
}

export function saveTickets(tickets: Ticket[]): void {
  setItem(STORAGE_KEYS.TICKETS, tickets);
}

/**
 * Upsert Ticket (Requirement 9 & 10: ticket_id is business key; DO NOT duplicate; NEVER delete tickets during import)
 */
export function upsertTicket(ticketInput: Partial<Ticket> & { ticketId: string; vehicleNumber: string; centerName: string }): { ticket: Ticket; isNew: boolean } {
  const tickets = getTickets();
  const cleanTicketId = ticketInput.ticketId.trim().toUpperCase();
  const existingIndex = tickets.findIndex(t => t.ticketId.trim().toUpperCase() === cleanTicketId);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    const existing = tickets[existingIndex];
    // Update allowed fields, maintain assignment if not specified
    const updated: Ticket = {
      ...existing,
      ...ticketInput,
      ticketId: cleanTicketId,
      updatedAt: now
    };
    tickets[existingIndex] = updated;
    saveTickets(tickets);
    return { ticket: updated, isNew: false };
  } else {
    const newTicket: Ticket = {
      id: ticketInput.id || `ticket-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      ticketId: cleanTicketId,
      vehicleNumber: ticketInput.vehicleNumber.trim().toUpperCase(),
      vendor: ticketInput.vendor || 'Zen',
      location: ticketInput.location || '',
      centerName: ticketInput.centerName.trim(),
      issue: ticketInput.issue || 'General Maintenance',
      category: ticketInput.category || 'Mechanical',
      status: ticketInput.status || 'Open',
      priority: ticketInput.priority || 'MEDIUM',
      affectedSpare: ticketInput.affectedSpare || '',
      issueType: ticketInput.issueType || 'Breakdown',
      assignedTechnicianId: ticketInput.assignedTechnicianId,
      assignedTechnicianName: ticketInput.assignedTechnicianName,
      scheduledSlot: ticketInput.scheduledSlot,
      createdAt: now,
      updatedAt: now,
      isNew: true
    };
    tickets.unshift(newTicket);
    saveTickets(tickets);
    return { ticket: newTicket, isNew: true };
  }
}

export function deleteTicket(id: string): void {
  const tickets = getTickets().filter(t => t.id !== id);
  saveTickets(tickets);
}

// ==================== ATTENDANCE ====================

export function getAttendance(): AttendanceRecord[] {
  const today = new Date().toISOString().split('T')[0];
  const defaultAttendance: AttendanceRecord[] = [
    {
      id: 'att-1',
      employeeId: 'TECH-1001',
      technicianName: 'Rajesh Sharma',
      date: today,
      status: 'Present',
      checkInTime: '08:45',
      checkOutTime: '',
      notes: 'Morning shift reported at Central DC',
      verifiedBy: 'Ops Supervisor',
      updatedAt: new Date().toISOString()
    },
    {
      id: 'att-2',
      employeeId: 'TECH-1002',
      technicianName: 'Vikram Singh',
      date: today,
      status: 'Present',
      checkInTime: '09:00',
      checkOutTime: '',
      notes: 'On-site at Sector 83 DC',
      verifiedBy: 'Ops Supervisor',
      updatedAt: new Date().toISOString()
    },
    {
      id: 'att-3',
      employeeId: 'TECH-1003',
      technicianName: 'Sunil Kumar Yadav',
      date: today,
      status: 'Present',
      checkInTime: '08:50',
      notes: 'South Delhi battery bench',
      verifiedBy: 'Ops Supervisor',
      updatedAt: new Date().toISOString()
    },
    {
      id: 'att-4',
      employeeId: 'TECH-1004',
      technicianName: 'Mohammad Tariq',
      date: today,
      status: 'Present',
      checkInTime: '09:10',
      notes: 'Gurugram fleet check',
      verifiedBy: 'Ops Supervisor',
      updatedAt: new Date().toISOString()
    },
    {
      id: 'att-5',
      employeeId: 'TECH-1005',
      technicianName: 'Pooja Rawat',
      date: today,
      status: 'On Leave',
      notes: 'Approved sick leave',
      verifiedBy: 'Ops Supervisor',
      updatedAt: new Date().toISOString()
    }
  ];
  return getItem<AttendanceRecord[]>(STORAGE_KEYS.ATTENDANCE, defaultAttendance);
}

export function saveAttendance(records: AttendanceRecord[]): void {
  setItem(STORAGE_KEYS.ATTENDANCE, records);
}

export function upsertAttendanceRecord(record: Partial<AttendanceRecord> & { employeeId: string; date: string }): { record: AttendanceRecord; isNew: boolean } {
  const list = getAttendance();
  const cleanEmpId = record.employeeId.trim().toUpperCase();
  const targetDate = record.date.trim();

  const existingIndex = list.findIndex(r => r.employeeId.toUpperCase() === cleanEmpId && r.date === targetDate);
  const now = new Date().toISOString();

  // Find tech name
  const tech = findTechnicianByEmployeeId(cleanEmpId);
  const techName = record.technicianName || tech?.name || cleanEmpId;

  if (existingIndex >= 0) {
    const existing = list[existingIndex];
    const updated: AttendanceRecord = {
      ...existing,
      ...record,
      technicianName: techName,
      employeeId: cleanEmpId,
      date: targetDate,
      updatedAt: now
    };
    list[existingIndex] = updated;
    saveAttendance(list);
    return { record: updated, isNew: false };
  } else {
    const newRecord: AttendanceRecord = {
      id: record.id || `att-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      employeeId: cleanEmpId,
      technicianName: techName,
      date: targetDate,
      status: record.status || 'Present',
      checkInTime: record.checkInTime || '09:00',
      checkOutTime: record.checkOutTime || '',
      notes: record.notes || '',
      verifiedBy: record.verifiedBy || 'System Admin',
      updatedAt: now
    };
    list.unshift(newRecord);
    saveAttendance(list);
    return { record: newRecord, isNew: true };
  }
}

// ==================== IMPORT HISTORY ====================

export function getImportJobs(): ImportJob[] {
  return getItem<ImportJob[]>(STORAGE_KEYS.IMPORT_JOBS, INITIAL_IMPORT_JOBS);
}

export function saveImportJob(job: ImportJob): void {
  const jobs = getImportJobs();
  const existingIdx = jobs.findIndex(j => j.id === job.id);
  if (existingIdx >= 0) {
    jobs[existingIdx] = job;
  } else {
    jobs.unshift(job);
  }
  setItem(STORAGE_KEYS.IMPORT_JOBS, jobs);
}

// ==================== DATA QUALITY AUDIT ====================

export function computeDataQuality(): DataQualityStats {
  const technicians = getTechnicians();
  const centers = getCenters();
  const tickets = getTickets();

  let techniciansMissingLocation = 0;
  technicians.forEach(t => {
    if (
      t.startingLatitude === undefined ||
      t.startingLongitude === undefined ||
      !isValidLatitude(t.startingLatitude) ||
      !isValidLongitude(t.startingLongitude)
    ) {
      techniciansMissingLocation++;
    }
  });

  let centersMissingCoordinates = 0;
  let invalidCoordinates = 0;

  centers.forEach(c => {
    if (c.latitude === undefined || c.longitude === undefined || isNaN(c.latitude) || isNaN(c.longitude)) {
      centersMissingCoordinates++;
    } else if (!isValidLatitude(c.latitude) || !isValidLongitude(c.longitude)) {
      invalidCoordinates++;
    }
  });

  let ticketsWithoutCenter = 0;
  let ticketsWithoutPriority = 0;
  let ticketsWithoutAssignment = 0;

  tickets.forEach(tk => {
    if (!tk.centerName || tk.centerName.trim() === '') {
      ticketsWithoutCenter++;
    }
    if (!tk.priority) {
      ticketsWithoutPriority++;
    }
    if (!tk.assignedTechnicianId && tk.status !== 'Resolved' && tk.status !== 'Closed') {
      ticketsWithoutAssignment++;
    }
  });

  return {
    techniciansMissingLocation,
    centersMissingCoordinates,
    ticketsWithoutCenter,
    ticketsWithoutPriority,
    ticketsWithoutAssignment,
    invalidCoordinates
  };
}

// ==================== ROUTE PLANS ====================

export function getRoutePlans(): TechnicianRoutePlan[] {
  return getItem<TechnicianRoutePlan[]>(STORAGE_KEYS.ROUTES, []);
}

export function saveRoutePlans(plans: TechnicianRoutePlan[]): void {
  setItem(STORAGE_KEYS.ROUTES, plans);
}

// Reset/Seed to fresh Delhi NCR dataset if needed
export function resetToDemoData(): void {
  setItem(STORAGE_KEYS.CENTERS, INITIAL_CENTERS);
  setItem(STORAGE_KEYS.TECHNICIANS, INITIAL_TECHNICIANS);
  setItem(STORAGE_KEYS.TICKETS, INITIAL_TICKETS);
  setItem(STORAGE_KEYS.IMPORT_JOBS, INITIAL_IMPORT_JOBS);
  localStorage.removeItem(STORAGE_KEYS.ROUTES);
  localStorage.removeItem(STORAGE_KEYS.ATTENDANCE);
  notifyDataChanged();
}
