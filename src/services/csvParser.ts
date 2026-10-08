import { ImportErrorDetail } from '../types';

/**
 * Robust CSV parser that handles quotes, line breaks, commas and spaces
 */
export function parseCSV(csvText: string): { headers: string[]; rows: Record<string, string>[] } {
  const cleanText = csvText.replace(/^\uFEFF/, '').trim(); // Remove UTF-8 BOM
  if (!cleanText) {
    return { headers: [], rows: [] };
  }

  const lines = splitCSVLines(cleanText);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const rawHeaders = parseCSVLine(lines[0]);
  const headers = rawHeaders.map(h => h.trim());

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(lines[i]);
    const rowObj: Record<string, string> = {};
    headers.forEach((h, index) => {
      rowObj[h] = (values[index] !== undefined ? values[index].trim() : '');
    });
    rows.push(rowObj);
  }

  return { headers, rows };
}

function splitCSVLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let insideQuote = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (insideQuote && text[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        insideQuote = !insideQuote;
        current += char;
      }
    } else if ((char === '\n' || char === '\r') && !insideQuote) {
      if (char === '\r' && text[i + 1] === '\n') {
        i++;
      }
      lines.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

/**
 * Normalize center name as per Requirement 6:
 * - Leading/trailing spaces
 * - Multiple spaces collapsed to single space
 * - Case-insensitive normalization
 * - Standardize underscore or hyphen spacing if needed
 */
export function normalizeCenterName(name: string): string {
  if (!name) return '';
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Validate latitude: -90 to +90
 */
export function isValidLatitude(val: number | string | undefined | null): boolean {
  if (val === undefined || val === null || val === '') return false;
  const num = typeof val === 'number' ? val : parseFloat(val);
  return !isNaN(num) && num >= -90 && num <= 90;
}

/**
 * Validate longitude: -180 to +180
 */
export function isValidLongitude(val: number | string | undefined | null): boolean {
  if (val === undefined || val === null || val === '') return false;
  const num = typeof val === 'number' ? val : parseFloat(val);
  return !isNaN(num) && num >= -180 && num <= 180;
}

/**
 * Validate phone number (simple international/Indian 10-digit mobile check)
 */
export function isValidPhone(phone: string): boolean {
  if (!phone) return false;
  const cleaned = phone.replace(/[\s\-\+\(\)]/g, '');
  return cleaned.length >= 10 && cleaned.length <= 13 && /^\d+$/.test(cleaned);
}

/**
 * Convert data records to CSV string
 */
export function generateCSV<T extends object>(data: T[], columns?: { key: keyof T; header: string }[]): string {
  if (data.length === 0) return '';
  const headers = columns ? columns.map(c => c.header) : Object.keys(data[0]);
  const keys = columns ? columns.map(c => c.key) : Object.keys(data[0]) as (keyof T)[];

  const escapeCSVValue = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [
    headers.map(escapeCSVValue).join(','),
    ...data.map(row => keys.map(k => escapeCSVValue(row[k])).join(','))
  ];

  return lines.join('\n');
}

/**
 * Trigger client-side file download for CSV
 */
export function downloadCSV(filename: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generate CSV error report string
 */
export function generateErrorReportCSV(errors: ImportErrorDetail[]): string {
  const rows = errors.map(err => ({
    RowNumber: err.row,
    Identifier: err.identifier,
    ErrorMessage: err.error,
    RawData: err.rawData ? JSON.stringify(err.rawData) : ''
  }));
  return generateCSV(rows);
}

/**
 * Field mappings synonym dictionary for automatic column matching
 */
export const SYNONYM_MAPS = {
  ticket: {
    ticketId: ['ticket', 'ticket_id', 'ticket id', 'incident', 'inc_id', 'incident_id', 'case', 'case_id', 'ticket no', 'ticket_no'],
    vehicleNumber: ['vehicle number', 'vehicle no', 'vehicle_number', 'veh_no', 'reg_no', 'reg no', 'registration', 'vin'],
    centerName: ['center name', 'center', 'center_name', 'hub', 'hub_name', 'dc', 'dc_name', 'station'],
    issue: ['issue', 'issue description', 'problem', 'complaint', 'defect', 'issue_description', 'description'],
    status: ['status', 'ticket status', 'state', 'current status'],
    vendor: ['vendor', 'vendor name', 'partner', 'oem'],
    location: ['location', 'city', 'zone', 'area'],
    category: ['category', 'issue category', 'dept'],
    affectedSpare: ['affected spare', 'spare', 'spare part', 'part', 'component'],
    issueType: ['issue type', 'type', 'service type', 'breakdown type'],
    priority: ['priority', 'severity', 'urgency', 'prio']
  },
  center: {
    name: ['center name', 'center', 'hub', 'name', 'center_name', 'dc name', 'dc'],
    city: ['city', 'location', 'region'],
    latitude: ['latitude', 'lat', 'y', 'lat_coord'],
    longitude: ['longitude', 'long', 'lng', 'lon', 'x', 'lng_coord'],
    defaultDc: ['default dc', 'default_dc', 'dc', 'hub_dc', 'parent dc'],
    active: ['active', 'status', 'is_active', 'enabled'],
    notes: ['notes', 'remarks', 'description']
  },
  technician: {
    employeeId: ['employee id', 'emp id', 'empid', 'emp_id', 'id', 'tech id'],
    name: ['technician name', 'name', 'tech name', 'full name', 'employee name'],
    phone: ['phone', 'mobile', 'contact', 'phone number', 'cell'],
    alternatePhone: ['alternate phone', 'alt phone', 'alt contact', 'secondary phone'],
    role: ['role', 'designation', 'position'],
    vendor: ['vendor', 'agency', 'contractor'],
    city: ['city', 'base city', 'location'],
    zone: ['zone', 'region', 'area', 'territory'],
    specialisation: ['specialisation', 'specialization', 'skills', 'skill', 'domain'],
    status: ['status', 'tech status', 'active'],
    joinedDate: ['joined date', 'doj', 'joining date', 'hire date'],
    assignedStm: ['assigned stm', 'stm', 'manager', 'lead', 'supervisor'],
    notes: ['notes', 'remarks'],
    startingLatitude: ['starting latitude', 'start lat', 'latitude', 'lat'],
    startingLongitude: ['starting longitude', 'start long', 'start lng', 'longitude', 'lng']
  },
  attendance: {
    employeeId: ['employee id', 'emp id', 'empid', 'emp_id', 'technician id', 'id'],
    date: ['date', 'attendance date', 'day'],
    status: ['status', 'attendance status', 'attendance'],
    checkInTime: ['check-in', 'check in', 'in time', 'checkin', 'start time'],
    checkOutTime: ['check-out', 'check out', 'out time', 'checkout', 'end time'],
    notes: ['notes', 'remarks', 'reason']
  }
};

/**
 * Attempt to match uploaded CSV column names to canonical target fields
 */
export function autoMapColumns(uploadedHeaders: string[], schemaType: keyof typeof SYNONYM_MAPS): Record<string, string> {
  const dictionary = SYNONYM_MAPS[schemaType];
  const mappings: Record<string, string> = {}; // canonicalKey -> uploadedHeader

  for (const [canonicalKey, synonyms] of Object.entries(dictionary)) {
    const foundHeader = uploadedHeaders.find(h => {
      const lower = h.trim().toLowerCase();
      return (
        synonyms.includes(lower) ||
        lower.replace(/[^a-z0-9]/g, '') === canonicalKey.toLowerCase()
      );
    });

    if (foundHeader) {
      mappings[canonicalKey] = foundHeader;
    }
  }

  return mappings;
}
