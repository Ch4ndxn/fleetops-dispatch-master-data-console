import React, { useState, useRef } from 'react';
import {
  ImportType,
  ImportJob,
  ImportErrorDetail,
  Center,
  Ticket,
  Technician,
  AttendanceRecord
} from '../../types';
import {
  parseCSV,
  autoMapColumns,
  SYNONYM_MAPS,
  isValidLatitude,
  isValidLongitude,
  isValidPhone,
  normalizeCenterName,
  downloadCSV,
  generateErrorReportCSV
} from '../../services/csvParser';
import {
  getCenters,
  findCenterByName,
  upsertCenter,
  getTickets,
  upsertTicket,
  getTechnicians,
  upsertTechnician,
  upsertAttendanceRecord,
  saveImportJob
} from '../../services/storage';
import {
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle2,
  X,
  ArrowRight,
  Download,
  Building2,
  RotateCcw,
  Plus
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  initialType: ImportType;
  onClose: () => void;
  onSuccess: (job: ImportJob) => void;
  onNavigateToCenters?: () => void;
  onNavigateToCases?: () => void;
  onNavigateToRoutes?: () => void;
}

type WizardStep = 'SELECT_FILE' | 'MAP_COLUMNS' | 'VALIDATE_PREVIEW' | 'COMPLETE';

export const CsvUploadWizardModal: React.FC<Props> = ({
  isOpen,
  initialType,
  onClose,
  onSuccess,
  onNavigateToCenters,
  onNavigateToCases,
  onNavigateToRoutes
}) => {
  if (!isOpen) return null;

  const [importType, setImportType] = useState<ImportType>(initialType);
  const [currentStep, setCurrentStep] = useState<WizardStep>('SELECT_FILE');

  // File state
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parsed CSV data
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRawRows, setCsvRawRows] = useState<Record<string, string>[]>([]);

  // Column Mappings (canonical -> csvHeader)
  const [mappings, setMappings] = useState<Record<string, string>>({});

  // Preview & Validation metrics
  const [validationErrors, setValidationErrors] = useState<ImportErrorDetail[]>([]);
  const [newCount, setNewCount] = useState(0);
  const [updatedCount, setUpdatedCount] = useState(0);
  const [unchangedCount, setUnchangedCount] = useState(0);
  const [missingCenters, setMissingCenters] = useState<string[]>([]);
  const [notInCsvCount, setNotInCsvCount] = useState(0);
  const [newHighPriorityCount, setNewHighPriorityCount] = useState(0);

  // Final job result
  const [completedJob, setCompletedJob] = useState<ImportJob | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Reset wizard
  const resetWizard = () => {
    setFile(null);
    setCsvHeaders([]);
    setCsvRawRows([]);
    setMappings({});
    setValidationErrors([]);
    setNewCount(0);
    setUpdatedCount(0);
    setUnchangedCount(0);
    setMissingCenters([]);
    setNotInCsvCount(0);
    setNewHighPriorityCount(0);
    setCompletedJob(null);
    setCurrentStep('SELECT_FILE');
  };

  // Helper schema type for synonym lookup
  const getSchemaKey = (type: ImportType): keyof typeof SYNONYM_MAPS => {
    switch (type) {
      case 'CENTER_CSV': return 'center';
      case 'TICKET_CSV': return 'ticket';
      case 'TECHNICIAN_CSV': return 'technician';
      case 'ATTENDANCE_CSV': return 'attendance';
    }
  };

  // Handle file drop / select
  const handleFileSelected = (selectedFile: File) => {
    if (!selectedFile.name.endsWith('.csv') && !selectedFile.type.includes('csv')) {
      alert('Please upload a valid .csv file.');
      return;
    }

    setFile(selectedFile);

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = (e.target?.result as string) || '';
      const parsed = parseCSV(content);

      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        alert('The uploaded CSV file is empty or formatted incorrectly.');
        return;
      }

      setCsvHeaders(parsed.headers);
      setCsvRawRows(parsed.rows);

      // Auto map columns
      const schemaKey = getSchemaKey(importType);
      const autoMapped = autoMapColumns(parsed.headers, schemaKey);
      setMappings(autoMapped);

      // Check if all minimum required fields are mapped
      const requiredMissing = getMissingRequiredFields(importType, autoMapped);

      if (requiredMissing.length > 0) {
        setCurrentStep('MAP_COLUMNS');
      } else {
        // Proceed to preview analysis
        runPreImportAnalysis(parsed.rows, autoMapped, importType);
        setCurrentStep('VALIDATE_PREVIEW');
      }
    };
    reader.readAsText(selectedFile);
  };

  const getMissingRequiredFields = (type: ImportType, currentMap: Record<string, string>): string[] => {
    const missing: string[] = [];
    if (type === 'CENTER_CSV') {
      if (!currentMap.name) missing.push('Center Name');
      if (!currentMap.latitude) missing.push('Latitude');
      if (!currentMap.longitude) missing.push('Longitude');
    } else if (type === 'TICKET_CSV') {
      if (!currentMap.ticketId) missing.push('Ticket');
      if (!currentMap.vehicleNumber) missing.push('Vehicle Number');
      if (!currentMap.centerName) missing.push('Center Name');
      if (!currentMap.issue) missing.push('Issue');
      if (!currentMap.status) missing.push('Status');
    } else if (type === 'TECHNICIAN_CSV') {
      if (!currentMap.employeeId) missing.push('Employee ID');
      if (!currentMap.name) missing.push('Technician Name');
      if (!currentMap.phone) missing.push('Phone');
      if (!currentMap.role) missing.push('Role');
      if (!currentMap.city) missing.push('City');
      if (!currentMap.status) missing.push('Status');
    } else if (type === 'ATTENDANCE_CSV') {
      if (!currentMap.employeeId) missing.push('Technician / Emp ID');
      if (!currentMap.date) missing.push('Date');
      if (!currentMap.status) missing.push('Status');
    }
    return missing;
  };

  // Run validation and calculate New vs Updated vs Invalid vs Missing Centers
  const runPreImportAnalysis = (
    rows: Record<string, string>[],
    activeMap: Record<string, string>,
    type: ImportType
  ) => {
    const errors: ImportErrorDetail[] = [];
    let _new = 0;
    let _updated = 0;
    let _unchanged = 0;
    let _highPrio = 0;
    const missingCentersFound = new Set<string>();

    if (type === 'CENTER_CSV') {
      const existingCenters = getCenters();
      rows.forEach((row, idx) => {
        const rawName = row[activeMap.name || ''] || '';
        const rawLat = row[activeMap.latitude || ''] || '';
        const rawLng = row[activeMap.longitude || ''] || '';

        if (!rawName.trim()) {
          errors.push({ row: idx + 2, identifier: `Row ${idx + 2}`, error: 'Center Name is empty', rawData: row });
          return;
        }

        const latNum = parseFloat(rawLat);
        const lngNum = parseFloat(rawLng);

        if (!isValidLatitude(latNum)) {
          errors.push({ row: idx + 2, identifier: rawName, error: `Invalid latitude: "${rawLat}". Must be -90 to +90.`, rawData: row });
          return;
        }

        if (!isValidLongitude(lngNum)) {
          errors.push({ row: idx + 2, identifier: rawName, error: `Invalid longitude: "${rawLng}". Must be -180 to +180.`, rawData: row });
          return;
        }

        const normalized = normalizeCenterName(rawName);
        const match = existingCenters.find(c => c.normalizedName === normalized || normalizeCenterName(c.name) === normalized);

        if (match) {
          if (match.latitude === latNum && match.longitude === lngNum) {
            _unchanged++;
          } else {
            _updated++;
          }
        } else {
          _new++;
        }
      });
    } else if (type === 'TICKET_CSV') {
      const existingTickets = getTickets();
      const existingCenters = getCenters();
      const uploadedTicketIds = new Set<string>();

      rows.forEach((row, idx) => {
        const rawTicketId = row[activeMap.ticketId || ''] || '';
        const rawVeh = row[activeMap.vehicleNumber || ''] || '';
        const rawCenter = row[activeMap.centerName || ''] || '';
        const rawIssue = row[activeMap.issue || ''] || '';
        const rawStatus = row[activeMap.status || ''] || '';
        const rawPrio = (row[activeMap.priority || ''] || 'MEDIUM').toUpperCase();

        if (!rawTicketId.trim()) {
          errors.push({ row: idx + 2, identifier: `Row ${idx + 2}`, error: 'Ticket ID is required', rawData: row });
          return;
        }
        if (!rawVeh.trim()) {
          errors.push({ row: idx + 2, identifier: rawTicketId, error: 'Vehicle Number is required', rawData: row });
          return;
        }
        if (!rawCenter.trim()) {
          errors.push({ row: idx + 2, identifier: rawTicketId, error: 'Center Name is required', rawData: row });
          return;
        }
        if (!rawIssue.trim()) {
          errors.push({ row: idx + 2, identifier: rawTicketId, error: 'Issue is required', rawData: row });
          return;
        }
        if (!rawStatus.trim()) {
          errors.push({ row: idx + 2, identifier: rawTicketId, error: 'Status is required', rawData: row });
          return;
        }

        uploadedTicketIds.add(rawTicketId.trim().toUpperCase());

        // Check center existence in Center Master (Requirement 12 & 13)
        const centerMatch = findCenterByName(rawCenter);
        if (!centerMatch || !centerMatch.latitude || !centerMatch.longitude) {
          missingCentersFound.add(rawCenter.trim());
        }

        if (rawPrio === 'CRITICAL' || rawPrio === 'HIGH') {
          _highPrio++;
        }

        const existing = existingTickets.find(t => t.ticketId.toUpperCase() === rawTicketId.trim().toUpperCase());
        if (existing) {
          if (existing.issue === rawIssue && existing.status === rawStatus && existing.centerName === rawCenter) {
            _unchanged++;
          } else {
            _updated++;
          }
        } else {
          _new++;
        }
      });

      // Requirement 10: Never delete existing tickets absent from today's CSV
      let notInCsv = 0;
      existingTickets.forEach(t => {
        if (!uploadedTicketIds.has(t.ticketId.toUpperCase()) && t.status !== 'Resolved' && t.status !== 'Closed') {
          notInCsv++;
        }
      });
      setNotInCsvCount(notInCsv);
    } else if (type === 'TECHNICIAN_CSV') {
      const existingTechs = getTechnicians();
      rows.forEach((row, idx) => {
        const rawEmpId = row[activeMap.employeeId || ''] || '';
        const rawName = row[activeMap.name || ''] || '';
        const rawPhone = row[activeMap.phone || ''] || '';
        const rawLat = row[activeMap.startingLatitude || ''];
        const rawLng = row[activeMap.startingLongitude || ''];

        if (!rawEmpId.trim()) {
          errors.push({ row: idx + 2, identifier: `Row ${idx + 2}`, error: 'Employee ID is required', rawData: row });
          return;
        }
        if (!rawName.trim()) {
          errors.push({ row: idx + 2, identifier: rawEmpId, error: 'Technician Name is required', rawData: row });
          return;
        }
        if (!isValidPhone(rawPhone)) {
          errors.push({ row: idx + 2, identifier: rawEmpId, error: `Invalid phone number "${rawPhone}"`, rawData: row });
          return;
        }

        if (rawLat && rawLat.trim() && !isValidLatitude(parseFloat(rawLat))) {
          errors.push({ row: idx + 2, identifier: rawEmpId, error: `Invalid Starting Latitude "${rawLat}"`, rawData: row });
          return;
        }
        if (rawLng && rawLng.trim() && !isValidLongitude(parseFloat(rawLng))) {
          errors.push({ row: idx + 2, identifier: rawEmpId, error: `Invalid Starting Longitude "${rawLng}"`, rawData: row });
          return;
        }

        const match = existingTechs.find(t => t.employeeId.toUpperCase() === rawEmpId.trim().toUpperCase());
        if (match) {
          _updated++;
        } else {
          _new++;
        }
      });
    } else if (type === 'ATTENDANCE_CSV') {
      rows.forEach((row, idx) => {
        const rawEmpId = row[activeMap.employeeId || ''] || '';
        const rawDate = row[activeMap.date || ''] || '';
        const rawStatus = row[activeMap.status || ''] || '';

        if (!rawEmpId.trim()) {
          errors.push({ row: idx + 2, identifier: `Row ${idx + 2}`, error: 'Employee ID is required', rawData: row });
          return;
        }
        if (!rawDate.trim()) {
          errors.push({ row: idx + 2, identifier: rawEmpId, error: 'Date is required', rawData: row });
          return;
        }
        if (!rawStatus.trim()) {
          errors.push({ row: idx + 2, identifier: rawEmpId, error: 'Status is required', rawData: row });
          return;
        }
        _new++;
      });
    }

    setValidationErrors(errors);
    setNewCount(_new);
    setUpdatedCount(_updated);
    setUnchangedCount(_unchanged);
    setMissingCenters(Array.from(missingCentersFound));
    setNewHighPriorityCount(_highPrio);
  };

  // Perform transaction execution
  const executeImport = () => {
    setIsProcessing(true);

    const errors: ImportErrorDetail[] = [];
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    const observations: string[] = [];

    try {
      if (importType === 'CENTER_CSV') {
        csvRawRows.forEach((row, idx) => {
          const rawName = (row[mappings.name || ''] || '').trim();
          const rawCity = (row[mappings.city || ''] || 'Delhi').trim();
          const rawLat = parseFloat(row[mappings.latitude || ''] || '');
          const rawLng = parseFloat(row[mappings.longitude || ''] || '');
          const rawDefaultDc = (row[mappings.defaultDc || ''] || '').trim();
          const rawActiveStr = (row[mappings.active || ''] || 'true').trim().toLowerCase();
          const rawActive = rawActiveStr === 'true' || rawActiveStr === 'yes' || rawActiveStr === '1';
          const rawNotes = (row[mappings.notes || ''] || '').trim();

          if (!rawName || !isValidLatitude(rawLat) || !isValidLongitude(rawLng)) {
            errors.push({ row: idx + 2, identifier: rawName || `Row ${idx + 2}`, error: 'Invalid record', rawData: row });
            skipped++;
            return;
          }

          const res = upsertCenter({
            name: rawName,
            city: rawCity,
            latitude: rawLat,
            longitude: rawLng,
            defaultDc: rawDefaultDc || `${rawName} DC`,
            active: rawActive,
            notes: rawNotes
          });

          if (res.isNew) inserted++;
          else updated++;
        });
      } else if (importType === 'TICKET_CSV') {
        csvRawRows.forEach((row, idx) => {
          const rawTicketId = (row[mappings.ticketId || ''] || '').trim().toUpperCase();
          const rawVeh = (row[mappings.vehicleNumber || ''] || '').trim().toUpperCase();
          const rawCenter = (row[mappings.centerName || ''] || '').trim();
          const rawIssue = (row[mappings.issue || ''] || '').trim();
          const rawStatus = (row[mappings.status || ''] || 'Open').trim();
          const rawVendor = (row[mappings.vendor || ''] || 'Zen').trim();
          const rawLocation = (row[mappings.location || ''] || '').trim();
          const rawCat = (row[mappings.category || ''] || 'General').trim();
          const rawSpare = (row[mappings.affectedSpare || ''] || '').trim();
          const rawIssueType = (row[mappings.issueType || ''] || 'Breakdown').trim();
          const rawPriority = ((row[mappings.priority || ''] || 'MEDIUM').toUpperCase() as Ticket['priority']);

          if (!rawTicketId || !rawVeh || !rawCenter || !rawIssue || !rawStatus) {
            errors.push({ row: idx + 2, identifier: rawTicketId || `Row ${idx + 2}`, error: 'Missing required field', rawData: row });
            skipped++;
            return;
          }

          const res = upsertTicket({
            ticketId: rawTicketId,
            vehicleNumber: rawVeh,
            centerName: rawCenter,
            issue: rawIssue,
            status: rawStatus as Ticket['status'],
            vendor: rawVendor,
            location: rawLocation,
            category: rawCat,
            affectedSpare: rawSpare,
            issueType: rawIssueType,
            priority: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(rawPriority) ? rawPriority : 'MEDIUM'
          });

          if (res.isNew) inserted++;
          else updated++;
        });

        if (notInCsvCount > 0) {
          observations.push(`Not present in uploaded file: ${notInCsvCount} existing open tickets maintained safely without deletion.`);
        }
        if (missingCenters.length > 0) {
          observations.push(`Found ${missingCenters.length} centers in tickets missing from Center Master: ${missingCenters.join(', ')}`);
        }
      } else if (importType === 'TECHNICIAN_CSV') {
        csvRawRows.forEach((row, idx) => {
          const rawEmpId = (row[mappings.employeeId || ''] || '').trim().toUpperCase();
          const rawName = (row[mappings.name || ''] || '').trim();
          const rawPhone = (row[mappings.phone || ''] || '').trim();
          const rawAltPhone = (row[mappings.alternatePhone || ''] || '').trim();
          const rawRole = (row[mappings.role || ''] || 'Field Engineer').trim();
          const rawVendor = (row[mappings.vendor || ''] || 'In-House Ops').trim();
          const rawCity = (row[mappings.city || ''] || 'Delhi').trim();
          const rawZone = (row[mappings.zone || ''] || '').trim();
          const rawSpec = (row[mappings.specialisation || ''] || 'General Fleet').trim();
          const rawStatus = (row[mappings.status || ''] || 'Active').trim();
          const rawJoined = (row[mappings.joinedDate || ''] || '').trim();
          const rawStm = (row[mappings.assignedStm || ''] || '').trim();
          const rawNotes = (row[mappings.notes || ''] || '').trim();
          const rawLat = row[mappings.startingLatitude || ''];
          const rawLng = row[mappings.startingLongitude || ''];
          const rawDc = (row[mappings.defaultDc || ''] || '').trim();

          if (!rawEmpId || !rawName || !isValidPhone(rawPhone)) {
            errors.push({ row: idx + 2, identifier: rawEmpId || `Row ${idx + 2}`, error: 'Validation failed', rawData: row });
            skipped++;
            return;
          }

          const parsedLat = rawLat && !isNaN(parseFloat(rawLat)) ? parseFloat(rawLat) : undefined;
          const parsedLng = rawLng && !isNaN(parseFloat(rawLng)) ? parseFloat(rawLng) : undefined;

          const res = upsertTechnician({
            employeeId: rawEmpId,
            name: rawName,
            phone: rawPhone,
            alternatePhone: rawAltPhone,
            role: rawRole as Technician['role'],
            vendor: rawVendor,
            city: rawCity,
            zone: rawZone,
            specialisation: rawSpec as Technician['specialisation'],
            status: rawStatus as Technician['status'],
            joinedDate: rawJoined,
            assignedStm: rawStm,
            notes: rawNotes,
            defaultDc: rawDc,
            startingLatitude: parsedLat,
            startingLongitude: parsedLng
          });

          if (res.isNew) inserted++;
          else updated++;
        });
      } else if (importType === 'ATTENDANCE_CSV') {
        csvRawRows.forEach((row, idx) => {
          const rawEmpId = (row[mappings.employeeId || ''] || '').trim().toUpperCase();
          const rawDate = (row[mappings.date || ''] || '').trim();
          const rawStatus = (row[mappings.status || ''] || 'Present').trim();
          const rawCheckIn = (row[mappings.checkInTime || ''] || '09:00').trim();
          const rawCheckOut = (row[mappings.checkOutTime || ''] || '').trim();
          const rawNotes = (row[mappings.notes || ''] || '').trim();

          if (!rawEmpId || !rawDate || !rawStatus) {
            errors.push({ row: idx + 2, identifier: rawEmpId || `Row ${idx + 2}`, error: 'Missing field', rawData: row });
            skipped++;
            return;
          }

          const res = upsertAttendanceRecord({
            employeeId: rawEmpId,
            date: rawDate,
            status: rawStatus as AttendanceRecord['status'],
            checkInTime: rawCheckIn,
            checkOutTime: rawCheckOut,
            notes: rawNotes
          });

          if (res.isNew) inserted++;
          else updated++;
        });
      }

      const job: ImportJob = {
        id: `job-${Date.now()}`,
        importType,
        fileName: file?.name || 'uploaded_data.csv',
        uploadedBy: 'chandanchatterjee4455@gmail.com',
        uploadedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
        totalRows: csvRawRows.length,
        insertedRows: inserted,
        updatedRows: updated,
        skippedRows: skipped,
        failedRows: errors.length,
        status: errors.length === 0 ? 'COMPLETED' : errors.length < csvRawRows.length ? 'PARTIAL' : 'FAILED',
        errors,
        observations,
        newHighPriorityCount,
        missingCentersFound: missingCenters
      };

      saveImportJob(job);
      setCompletedJob(job);
      setCurrentStep('COMPLETE');
      onSuccess(job);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadErrors = () => {
    if (validationErrors.length === 0) return;
    const csvContent = generateErrorReportCSV(validationErrors);
    downloadCSV(`import_errors_${file?.name || 'report'}.csv`, csvContent);
  };

  // ── Delhi NCR locality → [lat, lng] lookup ──────────────────────
  const NCR_GEO: Record<string, [number, number]> = {
    // Delhi localities
    budhvihar: [28.6992, 77.1268], budh_vihar: [28.6992, 77.1268],
    tughlaqabad: [28.5093, 77.2614], tughlakabd: [28.5093, 77.2614],
    badharpur: [28.5009, 77.2890], badarpur: [28.5009, 77.2890],
    mandoli: [28.7103, 77.3025],
    rohini: [28.7357, 77.1098],
    dwarka: [28.5921, 77.0460],
    janakpuri: [28.6219, 77.0878],
    uttamnagar: [28.6210, 77.0565], uttam_nagar: [28.6210, 77.0565],
    vikaspuri: [28.6368, 77.0713],
    najafgarh: [28.6092, 76.9794],
    narela: [28.8522, 77.0921],
    bawana: [28.8019, 77.0381],
    mundka: [28.6798, 77.0297],
    punjabibagh: [28.6686, 77.1310], punjabi_bagh: [28.6686, 77.1310],
    shahdara: [28.6737, 77.2938],
    patparganj: [28.6271, 77.2936],
    mayurvihar: [28.6123, 77.2939], mayur_vihar: [28.6123, 77.2939],
    laxminagar: [28.6313, 77.2779], laxmi_nagar: [28.6313, 77.2779],
    karolbagh: [28.6514, 77.1906], karol_bagh: [28.6514, 77.1906],
    connaught: [28.6315, 77.2167],
    okhla: [28.5501, 77.2714],
    saket: [28.5244, 77.2167],
    vasantkunj: [28.5205, 77.1577], vasant_kunj: [28.5205, 77.1577],
    mehrauli: [28.5244, 77.1855],
    mahipalpur: [28.5533, 77.1220],
    kapashera: [28.5196, 77.0840],
    bijwasan: [28.5412, 77.0709],
    palam: [28.5921, 77.0873],
    tilak_nagar: [28.6375, 77.0976], tilaknagar: [28.6375, 77.0976],
    subhashnagar: [28.6436, 77.1063],
    tagore_garden: [28.6478, 77.1158], tagoregarden: [28.6478, 77.1158],
    rajouri_garden: [28.6476, 77.1228], rajourigarden: [28.6476, 77.1228],
    moti_nagar: [28.6567, 77.1453], motinagar: [28.6567, 77.1453],
    kirti_nagar: [28.6566, 77.1530], kirtinagar: [28.6566, 77.1530],
    shadipur: [28.6509, 77.1600],
    patel_nagar: [28.6492, 77.1709], patelnagar: [28.6492, 77.1709],
    ramesh_nagar: [28.6498, 77.1326], rameshnagar: [28.6498, 77.1326],
    nangloi: [28.6765, 77.0635],
    nilothi: [28.6918, 77.0474],
    sultanpur_majra: [28.7001, 77.0594],
    hastsal: [28.6609, 77.0531],
    molarband: [28.5073, 77.2952],
    sangam_vihar: [28.5150, 77.2648], sangamvihar: [28.5150, 77.2648],
    govindpuri: [28.5305, 77.2596],
    kalkaji: [28.5361, 77.2588],
    nehru_place: [28.5491, 77.2530], nehruplace: [28.5491, 77.2530],
    lajpat_nagar: [28.5660, 77.2378], lajpatnagar: [28.5660, 77.2378],
    ashram: [28.5717, 77.2503],
    nizamuddin: [28.5882, 77.2517],
    new_friends_colony: [28.5620, 77.2822],
    jasola: [28.5526, 77.2921],
    sarita_vihar: [28.5378, 77.2960], saritavihar: [28.5378, 77.2960],
    // Gurgaon / Gurugram
    jharsa: [28.4595, 77.0266],
    kadipur: [28.3894, 77.0128],
    gurgaon: [28.4595, 77.0266],
    gurugram: [28.4595, 77.0266],
    sohna: [28.2469, 77.0709],
    pataudi: [28.3219, 76.8006],
    manesar: [28.3557, 76.9376],
    faridabad: [28.4089, 77.3178],
    ballabhgarh: [28.3418, 77.3226],
    palwal: [28.1483, 77.3321],
    // Noida / Greater Noida
    noida: [28.5355, 77.3910],
    greater_noida: [28.4745, 77.5040], greaternoida: [28.4745, 77.5040],
    ghaziabad: [28.6692, 77.4538],
    // Rohtak / Sonipat
    sonipat: [28.9931, 77.0151],
    rohtak: [28.8955, 76.6066],
    // Default fallback — central Delhi
    default: [28.6139, 77.2090],
  };

  function resolveCoords(centerName: string): { lat: number; lng: number; city: string } {
    // Normalise: lowercase, remove trailing _D/_DC, replace spaces/- with _
    const norm = centerName
      .toLowerCase()
      .replace(/[_\-\s]+d[c]?$/i, '')   // strip _D, _DC suffix
      .replace(/[\s\-]+/g, '_')
      .replace(/[^a-z0-9_]/g, '');

    // Try full normalised name first, then each segment
    const segments = norm.split('_').filter(Boolean);
    const candidates = [
      norm,
      ...segments.map((_, i) => segments.slice(i).join('_')),
      ...segments,
    ];

    let coords: [number, number] = NCR_GEO.default;
    for (const c of candidates) {
      if (NCR_GEO[c]) { coords = NCR_GEO[c]; break; }
    }

    // Derive city from name
    const upper = centerName.toUpperCase();
    const city =
      upper.includes('GURGAON') || upper.includes('GURUGRAM') ? 'Gurgaon' :
      upper.includes('NOIDA') ? 'Noida' :
      upper.includes('FARIDABAD') ? 'Faridabad' :
      upper.includes('GHAZIABAD') ? 'Ghaziabad' :
      upper.includes('SONIPAT') ? 'Sonipat' :
      upper.includes('ROHTAK') ? 'Rohtak' : 'Delhi';

    return { lat: coords[0], lng: coords[1], city };
  }

  const handleQuickCreateMissingCenters = () => {
    missingCenters.forEach((centerName) => {
      const { lat, lng, city } = resolveCoords(centerName);
      upsertCenter({
        name: centerName,
        city,
        latitude: lat,
        longitude: lng,
        defaultDc: `${centerName} DC`,
        active: true,
        notes: 'Auto-created from ticket import with geocoded coordinates',
      });
    });
    setMissingCenters([]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-3xl my-6 flex flex-col overflow-hidden max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50 shrink-0">
          <div>
            <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Upload className="w-5 h-5 text-blue-600" />
              {importType === 'TICKET_CSV' && 'UPLOAD OPEN TICKETS CSV'}
              {importType === 'CENTER_CSV' && 'UPLOAD CENTER / DC COORDINATES CSV'}
              {importType === 'TECHNICIAN_CSV' && 'UPLOAD TECHNICIANS CSV'}
              {importType === 'ATTENDANCE_CSV' && 'UPLOAD ATTENDANCE CSV'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Strict preview, transaction safety, automatic center detection, and duplicate prevention.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Multi-step Breadcrumb */}
        <div className="px-6 py-2.5 bg-slate-100/70 border-b border-slate-200 flex items-center gap-2 text-xs text-slate-600 shrink-0">
          <span className={`font-semibold ${currentStep === 'SELECT_FILE' ? 'text-blue-600' : 'text-slate-500'}`}>1. Select CSV</span>
          <span>→</span>
          <span className={`font-semibold ${currentStep === 'MAP_COLUMNS' ? 'text-blue-600' : 'text-slate-500'}`}>2. Column Mapping</span>
          <span>→</span>
          <span className={`font-semibold ${currentStep === 'VALIDATE_PREVIEW' ? 'text-blue-600' : 'text-slate-500'}`}>3. Validate & Preview</span>
          <span>→</span>
          <span className={`font-semibold ${currentStep === 'COMPLETE' ? 'text-emerald-600' : 'text-slate-500'}`}>4. Complete</span>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* STEP 1: SELECT FILE */}
          {currentStep === 'SELECT_FILE' && (
            <div className="space-y-5">
              {/* Type Switcher */}
              <div className="flex items-center gap-2 pb-2">
                <span className="text-xs font-semibold text-slate-700">Import Entity:</span>
                <div className="flex gap-1.5 bg-slate-100 p-1 rounded-lg text-xs">
                  <button
                    type="button"
                    onClick={() => setImportType('TICKET_CSV')}
                    className={`px-3 py-1 rounded-md font-medium transition-colors ${importType === 'TICKET_CSV' ? 'bg-white shadow-2xs text-blue-600 font-bold' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    Open Tickets
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportType('CENTER_CSV')}
                    className={`px-3 py-1 rounded-md font-medium transition-colors ${importType === 'CENTER_CSV' ? 'bg-white shadow-2xs text-blue-600 font-bold' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    Centers / DCs
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportType('TECHNICIAN_CSV')}
                    className={`px-3 py-1 rounded-md font-medium transition-colors ${importType === 'TECHNICIAN_CSV' ? 'bg-white shadow-2xs text-blue-600 font-bold' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    Technicians
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportType('ATTENDANCE_CSV')}
                    className={`px-3 py-1 rounded-md font-medium transition-colors ${importType === 'ATTENDANCE_CSV' ? 'bg-white shadow-2xs text-blue-600 font-bold' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    Attendance
                  </button>
                </div>
              </div>

              {/* Drag and Drop Zone (Requirement 16) */}
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleFileSelected(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50/50'
                    : 'border-slate-300 hover:border-slate-400 bg-slate-50/50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileSelected(e.target.files[0]);
                    }
                  }}
                />
                <div className="w-12 h-12 mx-auto mb-3 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                  <Upload className="w-6 h-6" />
                </div>
                <div className="text-sm font-semibold text-slate-800 mb-1">
                  DROP CSV HERE
                </div>
                <div className="text-xs text-slate-500 mb-3">
                  or click to browse your local computer
                </div>
                <span className="inline-block px-3 py-1 bg-white border border-slate-200 text-slate-700 text-xs rounded-md shadow-2xs">
                  Choose CSV File
                </span>
              </div>

              {/* File details if chosen */}
              {file && (
                <div className="p-3 bg-slate-100 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-600" />
                    <span className="font-semibold text-slate-900">{file.name}</span>
                    <span className="text-slate-500">({(file.size / 1024).toFixed(1)} KB)</span>
                  </div>
                  <button
                    onClick={() => { setFile(null); }}
                    className="text-slate-400 hover:text-rose-600 p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: CSV FIELD MAPPING UI (Requirement 11) */}
          {currentStep === 'MAP_COLUMNS' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                <strong>Map CSV Columns to Database Fields:</strong> Some headers in your CSV file require manual confirmation. Map each target database field to the corresponding column header.
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">DATABASE FIELD</th>
                      <th className="py-2.5 px-4 font-semibold text-center w-12">→</th>
                      <th className="py-2.5 px-4 font-semibold">CSV COLUMN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.keys(SYNONYM_MAPS[getSchemaKey(importType)]).map((canonicalKey) => {
                      const isRequired = getMissingRequiredFields(importType, { [canonicalKey]: '' }).length > 0;
                      return (
                        <tr key={canonicalKey} className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-4 font-medium text-slate-800">
                            {canonicalKey}
                            {isRequired && <span className="text-rose-500 ml-1">*</span>}
                          </td>
                          <td className="py-2.5 px-4 text-center text-slate-400 font-bold">→</td>
                          <td className="py-2.5 px-4">
                            <select
                              value={mappings[canonicalKey] || ''}
                              onChange={(e) => {
                                const newMap = { ...mappings, [canonicalKey]: e.target.value };
                                setMappings(newMap);
                              }}
                              className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md bg-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            >
                              <option value="">-- Ignore / Unmapped --</option>
                              {csvHeaders.map(h => (
                                <option key={h} value={h}>{h}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setCurrentStep('SELECT_FILE')}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-100"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const missing = getMissingRequiredFields(importType, mappings);
                    if (missing.length > 0) {
                      alert(`Please map all required fields: ${missing.join(', ')}`);
                      return;
                    }
                    runPreImportAnalysis(csvRawRows, mappings, importType);
                    setCurrentStep('VALIDATE_PREVIEW');
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs flex items-center gap-1.5"
                >
                  Confirm Mappings & Preview
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW & VALIDATION (Requirements 5, 8, 9, 12, 13) */}
          {currentStep === 'VALIDATE_PREVIEW' && (
            <div className="space-y-4">
              {/* Preview Header Banner */}
              <div className="p-4 bg-slate-900 text-white rounded-xl space-y-3 font-mono text-xs">
                <div className="text-sm font-bold text-blue-400">
                  {importType === 'TICKET_CSV' && 'OPEN TICKET IMPORT PREVIEW'}
                  {importType === 'CENTER_CSV' && 'CENTER CSV IMPORT PREVIEW'}
                  {importType === 'TECHNICIAN_CSV' && 'TECHNICIAN CSV IMPORT PREVIEW'}
                  {importType === 'ATTENDANCE_CSV' && 'ATTENDANCE CSV IMPORT PREVIEW'}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 border-t border-slate-800">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Total Rows:</span>
                    <span className="text-lg font-bold text-white">{csvRawRows.length}</span>
                  </div>
                  <div>
                    <span className="text-emerald-400 block text-[11px]">New Records:</span>
                    <span className="text-lg font-bold text-emerald-400">{newCount}</span>
                  </div>
                  <div>
                    <span className="text-amber-400 block text-[11px]">Existing Updated:</span>
                    <span className="text-lg font-bold text-amber-400">{updatedCount}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Unchanged:</span>
                    <span className="text-lg font-bold text-slate-300">{unchangedCount}</span>
                  </div>
                </div>

                {validationErrors.length > 0 && (
                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-rose-400">
                    <span>Invalid Records: {validationErrors.length}</span>
                    <button
                      onClick={handleDownloadErrors}
                      className="px-2 py-1 bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded text-[11px] flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      Download Error Report
                    </button>
                  </div>
                )}
              </div>

              {/* Requirement 19: High Priority Alert */}
              {newHighPriorityCount > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl flex items-center justify-between text-amber-900 text-xs">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>⚠️ {newHighPriorityCount} HIGH / CRITICAL PRIORITY CASES DETECTED in this batch!</span>
                  </div>
                </div>
              )}

              {/* Requirement 12 & 13: Missing Centers Detected in Ticket Import */}
              {missingCenters.length > 0 && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-2.5 text-xs text-rose-900">
                  <div className="flex items-center gap-2 font-bold text-rose-800">
                    <Building2 className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>MISSING CENTER COORDINATES ({missingCenters.length} centers unconfigured)</span>
                  </div>
                  <p className="text-rose-700">
                    The following centers in the ticket CSV do not exist in the Center Master. Without coordinates, the route optimizer cannot compute ETAs:
                  </p>
                  <ol className="list-decimal list-inside space-y-1 font-mono text-[11px] bg-white p-2.5 rounded-lg border border-rose-100">
                    {missingCenters.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ol>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleQuickCreateMissingCenters}
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-md shadow-2xs flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      CREATE MISSING CENTERS
                    </button>
                    {onNavigateToCenters && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onNavigateToCenters();
                        }}
                        className="px-3 py-1.5 bg-white border border-rose-300 text-rose-800 font-semibold rounded-md hover:bg-rose-50"
                      >
                        ADD COORDINATES IN CENTER MASTER
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Requirement 10: Observation for tickets absent in today's file */}
              {notInCsvCount > 0 && (
                <div className="p-3 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-600">
                  <strong>Notice:</strong> {notInCsvCount} active tickets in database are not present in uploaded file. They will be <strong>preserved safely</strong> and not marked closed.
                </div>
              )}

              {/* Invalid records sample preview if any */}
              {validationErrors.length > 0 && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs space-y-1">
                  <div className="font-semibold text-rose-900">Errors identified:</div>
                  <div className="max-h-24 overflow-y-auto space-y-1 font-mono text-[11px] text-rose-700">
                    {validationErrors.slice(0, 5).map((err, i) => (
                      <div key={i}>Row {err.row} ({err.identifier}): {err.error}</div>
                    ))}
                    {validationErrors.length > 5 && <div>...and {validationErrors.length - 5} more errors.</div>}
                  </div>
                </div>
              )}

              {/* Sample 3 rows preview */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">First 3 Rows Preview:</span>
                <div className="border border-slate-200 rounded-lg overflow-x-auto text-[11px]">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <tr>
                        {Object.values(mappings).filter(Boolean).slice(0, 6).map(h => (
                          <th key={h} className="py-2 px-3">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {csvRawRows.slice(0, 3).map((r, i) => (
                        <tr key={i}>
                          {Object.values(mappings).filter(Boolean).slice(0, 6).map(h => (
                            <td key={h} className="py-1.5 px-3 font-mono text-slate-800">{r[h]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={resetWizard}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={executeImport}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {isProcessing ? 'Processing Transaction...' : `IMPORT ${csvRawRows.length - validationErrors.length} RECORDS`}
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: COMPLETED (Requirements 18 & 19) */}
          {currentStep === 'COMPLETE' && completedJob && (
            <div className="space-y-5 text-center py-4">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div>
                <h3 className="text-lg font-bold text-slate-900">Import Processed Successfully</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Database transaction committed. All caches and route planner models refreshed immediately.
                </p>
              </div>

              <div className="max-w-md mx-auto bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-left space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">File:</span>
                  <span className="font-semibold text-slate-800">{completedJob.fileName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">New Records Inserted:</span>
                  <span className="font-bold text-emerald-600">{completedJob.insertedRows}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Existing Records Updated:</span>
                  <span className="font-bold text-amber-600">{completedJob.updatedRows}</span>
                </div>
                {completedJob.failedRows > 0 && (
                  <div className="flex justify-between text-rose-600">
                    <span>Errors / Skipped:</span>
                    <span className="font-bold">{completedJob.failedRows}</span>
                  </div>
                )}
              </div>

              {/* Requirement 18: Post-Import Action Buttons */}
              {importType === 'TICKET_CSV' && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-xs space-y-3">
                  <div className="font-semibold text-blue-900">
                    {completedJob.insertedRows} new tickets imported. Ready for fleet route assignment.
                  </div>
                  <div className="flex items-center justify-center gap-3">
                    {onNavigateToCases && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onNavigateToCases();
                        }}
                        className="px-4 py-2 bg-white border border-blue-300 text-blue-700 font-semibold rounded-lg hover:bg-blue-50 text-xs"
                      >
                        VIEW NEW CASES
                      </button>
                    )}
                    {onNavigateToRoutes && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onNavigateToRoutes();
                        }}
                        className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 text-xs shadow-xs"
                      >
                        OPTIMIZE NEW CASES
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-6 py-2 bg-slate-900 hover:bg-black text-white text-xs font-semibold rounded-lg"
                >
                  Close & View Dashboard
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
