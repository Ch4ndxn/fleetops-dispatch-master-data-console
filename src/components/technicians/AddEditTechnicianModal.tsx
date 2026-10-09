import React, { useState } from 'react';
import { Technician, TechnicianRole, TechnicianStatus, Specialisation } from '../../types';
import { findTechnicianByEmployeeId, upsertTechnician } from '../../services/storage';
import { isValidPhone, isValidLatitude, isValidLongitude } from '../../services/csvParser';
import { LeafletCoordinatePickerModal } from '../map/LeafletCoordinatePickerModal';
import { UserPlus, UserCheck, X, Check, Globe } from 'lucide-react';
import { localDate } from '../../lib/date';

interface Props {
  isOpen: boolean;
  technicianToEdit?: Technician | null;
  onClose: () => void;
  onSuccess: (tech: Technician, isNew: boolean) => void;
}

const ROLES: TechnicianRole[] = [
  'Senior Technician',
  'Field Engineer',
  'Battery Specialist',
  'Electrical Specialist',
  'Trainee'
];

const SPECIALISATIONS: Specialisation[] = [
  'Electrical',
  'Mechanical',
  'Battery',
  'Controller',
  'Motor',
  'General Fleet',
  'Diagnostics'
];

const STATUSES: TechnicianStatus[] = ['Active', 'Inactive', 'On Leave', 'Suspended'];

export const AddEditTechnicianModal: React.FC<Props> = ({
  isOpen,
  technicianToEdit,
  onClose,
  onSuccess
}) => {
  if (!isOpen) return null;

  const isEditing = Boolean(technicianToEdit);

  const [employeeId, setEmployeeId] = useState(technicianToEdit?.employeeId || '');
  const [name, setName] = useState(technicianToEdit?.name || '');
  const [phone, setPhone] = useState(technicianToEdit?.phone || '');
  const [alternatePhone, setAlternatePhone] = useState(technicianToEdit?.alternatePhone || '');
  const [role, setRole] = useState<TechnicianRole>(technicianToEdit?.role || 'Field Engineer');
  const [vendor, setVendor] = useState(technicianToEdit?.vendor || 'Zen Fleet Ops');
  const [city, setCity] = useState(technicianToEdit?.city || 'Delhi');
  const [zone, setZone] = useState(technicianToEdit?.zone || 'West Delhi');
  const [specialisation, setSpecialisation] = useState<Specialisation>(technicianToEdit?.specialisation || 'General Fleet');
  const [status, setStatus] = useState<TechnicianStatus>(technicianToEdit?.status || 'Active');
  const [joinedDate, setJoinedDate] = useState(technicianToEdit?.joinedDate || localDate());
  const [assignedStm, setAssignedStm] = useState(technicianToEdit?.assignedStm || 'Amit Verma (STM)');
  const [notes, setNotes] = useState(technicianToEdit?.notes || '');
  const [defaultDc, setDefaultDc] = useState(technicianToEdit?.defaultDc || 'Central Delhi DC');
  const [startLat, setStartLat] = useState<string>(
    technicianToEdit?.startingLatitude !== undefined ? String(technicianToEdit.startingLatitude) : '28.6448'
  );
  const [startLng, setStartLng] = useState<string>(
    technicianToEdit?.startingLongitude !== undefined ? String(technicianToEdit.startingLongitude) : '77.1511'
  );

  const [errors, setErrors] = useState<string[]>([]);
  const [showMapPicker, setShowMapPicker] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validationErrors: string[] = [];

    const cleanEmpId = employeeId.trim().toUpperCase();
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const cleanCity = city.trim();

    // 1. Validate Required Fields
    if (!cleanEmpId) validationErrors.push('Employee ID is required.');
    if (!cleanName) validationErrors.push('Technician Name is required.');
    if (!cleanPhone) validationErrors.push('Phone is required.');
    if (!role) validationErrors.push('Role is required.');
    if (!cleanCity) validationErrors.push('City is required.');
    if (!status) validationErrors.push('Status is required.');

    // 2. Validate Employee ID is unique (if creating new or changing ID)
    if (!isEditing || (technicianToEdit && technicianToEdit.employeeId.toUpperCase() !== cleanEmpId)) {
      const existing = findTechnicianByEmployeeId(cleanEmpId);
      if (existing) {
        validationErrors.push(`Employee ID "${cleanEmpId}" already exists for ${existing.name}. Employee ID must be unique.`);
      }
    }

    // 3. Validate Phone Number
    if (cleanPhone && !isValidPhone(cleanPhone)) {
      validationErrors.push('Invalid phone number. Please enter a valid 10 to 13 digit mobile number.');
    }

    if (alternatePhone && !isValidPhone(alternatePhone)) {
      validationErrors.push('Invalid alternate phone number.');
    }

    // 4. Validate Coordinates if provided
    let parsedLat: number | undefined = undefined;
    let parsedLng: number | undefined = undefined;

    if (startLat.trim() !== '') {
      parsedLat = parseFloat(startLat);
      if (!isValidLatitude(parsedLat)) {
        validationErrors.push('Starting Latitude must be a valid number between -90 and +90.');
      }
    }

    if (startLng.trim() !== '') {
      parsedLng = parseFloat(startLng);
      if (!isValidLongitude(parsedLng)) {
        validationErrors.push('Starting Longitude must be a valid number between -180 and +180.');
      }
    }

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors([]);

    // Save technician
    const { technician, isNew } = upsertTechnician({
      id: technicianToEdit?.id,
      employeeId: cleanEmpId,
      name: cleanName,
      phone: cleanPhone,
      alternatePhone: alternatePhone.trim(),
      role,
      vendor: vendor.trim(),
      city: cleanCity,
      zone: zone.trim(),
      specialisation,
      status,
      joinedDate,
      assignedStm: assignedStm.trim(),
      notes: notes.trim(),
      defaultDc: defaultDc.trim(),
      startingLatitude: parsedLat,
      startingLongitude: parsedLng
    });

    onSuccess(technician, isNew);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
        <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-3xl my-6 flex flex-col overflow-hidden max-h-[92vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50 shrink-0">
            <div>
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                {isEditing ? <UserCheck className="w-5 h-5 text-blue-600" /> : <UserPlus className="w-5 h-5 text-blue-600" />}
                {isEditing ? `Edit Technician — ${technicianToEdit?.employeeId}` : '+ Add Technician'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Manage operational workforce credentials, starting location, and skill specialisation.
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
            {errors.length > 0 && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg space-y-1">
                <div className="font-semibold">Please fix the following validation errors:</div>
                <ul className="list-disc list-inside space-y-0.5 text-rose-700">
                  {errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Basic Identity */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Employee ID <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. TECH-1008"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                />
                <span className="text-[11px] text-slate-500">Unique identifier</span>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Technician Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Amit Kumar Sharma"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Contact Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Phone Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="tel"
                  required
                  placeholder="e.g. 9876543210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Alternate Phone
                </label>
                <input
                  type="tel"
                  placeholder="e.g. 9811223344"
                  value={alternatePhone}
                  onChange={(e) => setAlternatePhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Role, Vendor & Status */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Role <span className="text-rose-500">*</span>
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as TechnicianRole)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Vendor / Partner
                </label>
                <input
                  type="text"
                  placeholder="e.g. Zen Fleet Ops, Switch"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Status <span className="text-rose-500">*</span>
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TechnicianStatus)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-slate-500">
                  {status === 'Active' ? 'Eligible for daily attendance' : 'Not available for dispatch'}
                </span>
              </div>
            </div>

            {/* Geography & Specialisation */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  City <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Delhi, Noida, Gurugram"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Zone / Cluster
                </label>
                <input
                  type="text"
                  placeholder="e.g. West Delhi, Sector 83"
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Specialisation
                </label>
                <select
                  value={specialisation}
                  onChange={(e) => setSpecialisation(e.target.value as Specialisation)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {SPECIALISATIONS.map((sp) => (
                    <option key={sp} value={sp}>
                      {sp}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* STM & Joined Date */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Assigned STM (Manager)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Amit Verma (STM)"
                  value={assignedStm}
                  onChange={(e) => setAssignedStm(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Joined Date
                </label>
                <input
                  type="date"
                  value={joinedDate}
                  onChange={(e) => setJoinedDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Starting Location & Default DC (Used by Route Optimizer) */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Starting Location Coordinates & Default DC
                  </h4>
                  <p className="text-xs text-slate-500">
                    The route optimizer strictly uses these coordinates as the technician starting point.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMapPicker(true)}
                  className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
                >
                  <Globe className="w-3.5 h-3.5" />
                  SELECT FROM MAP
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Default DC</label>
                  <input
                    type="text"
                    placeholder="e.g. Central Delhi DC"
                    value={defaultDc}
                    onChange={(e) => setDefaultDc(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Starting Latitude (-90 to +90)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="28.6448"
                    value={startLat}
                    onChange={(e) => setStartLat(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Starting Longitude (-180 to +180)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="77.1511"
                    value={startLng}
                    onChange={(e) => setStartLng(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Operational Notes
              </label>
              <textarea
                rows={2}
                placeholder="Skills, shift notes, vehicle allocation, or restrictions..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                {isEditing ? 'Save Changes' : 'Create Technician'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Map coordinate picker */}
      {showMapPicker && (
        <LeafletCoordinatePickerModal
          isOpen={showMapPicker}
          title={`Set Location for ${name || employeeId || 'Technician'}`}
          initialLat={parseFloat(startLat) || 28.6139}
          initialLng={parseFloat(startLng) || 77.2090}
          locationName={name ? `${name} Base` : 'Technician Base'}
          onSelectCoordinates={(latVal, lngVal) => {
            setStartLat(String(latVal));
            setStartLng(String(lngVal));
          }}
          onClose={() => setShowMapPicker(false)}
        />
      )}
    </>
  );
};
