import React, { useState } from 'react';
import { Center } from '../../types';
import { upsertCenter } from '../../services/storage';
import { isValidLatitude, isValidLongitude, normalizeCenterName } from '../../services/csvParser';
import { LeafletCoordinatePickerModal } from '../map/LeafletCoordinatePickerModal';
import { Building2, X, Check, Globe } from 'lucide-react';

interface Props {
  isOpen: boolean;
  centerToEdit?: Center | null;
  onClose: () => void;
  onSuccess: (center: Center, isNew: boolean) => void;
}

export const AddEditCenterModal: React.FC<Props> = ({
  isOpen,
  centerToEdit,
  onClose,
  onSuccess
}) => {
  if (!isOpen) return null;

  const isEditing = Boolean(centerToEdit);

  const [name, setName] = useState(centerToEdit?.name || '');
  const [city, setCity] = useState(centerToEdit?.city || 'Delhi');
  const [lat, setLat] = useState<string>(
    centerToEdit?.latitude !== undefined ? String(centerToEdit.latitude) : '28.6519'
  );
  const [lng, setLng] = useState<string>(
    centerToEdit?.longitude !== undefined ? String(centerToEdit.longitude) : '77.1663'
  );
  const [defaultDc, setDefaultDc] = useState(centerToEdit?.defaultDc || '');
  const [active, setActive] = useState(centerToEdit?.active !== undefined ? centerToEdit.active : true);
  const [notes, setNotes] = useState(centerToEdit?.notes || '');

  const [errors, setErrors] = useState<string[]>([]);
  const [showMapPicker, setShowMapPicker] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validationErrors: string[] = [];

    const cleanName = name.trim();
    if (!cleanName) {
      validationErrors.push('Center Name is required.');
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);

    if (isNaN(latNum) || !isValidLatitude(latNum)) {
      validationErrors.push('Invalid Latitude. Must be a number between -90 and +90.');
    }

    if (isNaN(lngNum) || !isValidLongitude(lngNum)) {
      validationErrors.push('Invalid Longitude. Must be a number between -180 and +180.');
    }

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors([]);

    const { center, isNew } = upsertCenter({
      id: centerToEdit?.id,
      name: cleanName,
      city: city.trim() || 'Delhi',
      latitude: latNum,
      longitude: lngNum,
      defaultDc: defaultDc.trim() || `${cleanName} DC`,
      active,
      notes: notes.trim()
    });

    onSuccess(center, isNew);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
        <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl my-6 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
            <div>
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-600" />
                {isEditing ? `Edit Center — ${centerToEdit?.name}` : '+ Add Center / DC'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure operational center hub coordinates for automated ticket dispatch.
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
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {errors.length > 0 && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg space-y-1">
                <div className="font-semibold">Validation Errors:</div>
                <ul className="list-disc list-inside space-y-0.5">
                  {errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Center Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Center Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Delhi_PatelNagar_D or Noida_Sector83_D"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-[11px] text-slate-500">
                Normalized matching automatically handles spaces & case: <code>{normalizeCenterName(name || 'Center_Name')}</code>
              </span>
            </div>

            {/* City & Default DC */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  City
                </label>
                <input
                  type="text"
                  placeholder="e.g. Delhi, Noida, Gurugram"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Default DC
                </label>
                <input
                  type="text"
                  placeholder="e.g. Central Delhi DC"
                  value={defaultDc}
                  onChange={(e) => setDefaultDc(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Coordinates Section with Map Picker (Requirement 3 & 4) */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Geographic Coordinates <span className="text-rose-500">*</span>
                  </span>
                  <p className="text-[11px] text-slate-500">
                    Required for distance calculations and route optimization.
                  </p>
                </div>
                {/* SELECT LOCATION ON MAP button */}
                <button
                  type="button"
                  onClick={() => setShowMapPicker(true)}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5"
                >
                  <Globe className="w-3.5 h-3.5" />
                  SELECT LOCATION ON MAP
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Latitude (-90 to +90) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Longitude (-180 to +180) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={lng}
                    onChange={(e) => setLng(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="text-[11px] text-slate-500">
                Operations tip: Click <strong>SELECT LOCATION ON MAP</strong> to search Delhi NCR landmarks, drag the marker, and instantly pin the exact location.
              </div>
            </div>

            {/* Active Status & Notes */}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded-sm border-slate-300 focus:ring-blue-500"
                />
                Active (Available for routing)
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Operational Notes
              </label>
              <textarea
                rows={2}
                placeholder="Gate entry instructions, contact person, or operating hours..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
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
                {isEditing ? 'Save Center' : 'Create Center'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Map Picker Modal */}
      {showMapPicker && (
        <LeafletCoordinatePickerModal
          isOpen={showMapPicker}
          title={`Pin Location for ${name || 'Center'}`}
          initialLat={parseFloat(lat) || 28.6519}
          initialLng={parseFloat(lng) || 77.1663}
          locationName={name || 'Service Center'}
          onSelectCoordinates={(newLat, newLng) => {
            setLat(String(newLat));
            setLng(String(newLng));
          }}
          onClose={() => setShowMapPicker(false)}
        />
      )}
    </>
  );
};
