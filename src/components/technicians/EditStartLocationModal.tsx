import React, { useState } from 'react';
import { Technician } from '../../types';
import { LeafletCoordinatePickerModal } from '../map/LeafletCoordinatePickerModal';
import { MapPin, X, Check, Globe } from 'lucide-react';
import { isValidLatitude, isValidLongitude } from '../../services/csvParser';

interface Props {
  isOpen: boolean;
  technician: Technician | null;
  onClose: () => void;
  onSave: (techId: string, lat: number, lng: number, defaultDc?: string) => void;
}

export const EditStartLocationModal: React.FC<Props> = ({
  isOpen,
  technician,
  onClose,
  onSave
}) => {
  if (!isOpen || !technician) return null;

  const [lat, setLat] = useState<string>(
    technician.startingLatitude !== undefined ? String(technician.startingLatitude) : '28.6139'
  );
  const [lng, setLng] = useState<string>(
    technician.startingLongitude !== undefined ? String(technician.startingLongitude) : '77.2090'
  );
  const [defaultDc, setDefaultDc] = useState<string>(technician.defaultDc || '');
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);

    if (!isValidLatitude(latNum)) {
      setError('Latitude must be a valid number between -90 and +90.');
      return;
    }
    if (!isValidLongitude(lngNum)) {
      setError('Longitude must be a valid number between -180 and +180.');
      return;
    }

    onSave(technician.id, latNum, lngNum, defaultDc.trim());
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
        <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
            <div>
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <MapPin className="w-5 h-5 text-blue-600" />
                Edit Start Location
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Set base dispatch coordinates for route optimization
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
          <form onSubmit={handleSave} className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg">
                {error}
              </div>
            )}

            {/* Technician Info Banner */}
            <div className="p-3.5 bg-blue-50 border border-blue-100 rounded-lg text-xs space-y-1">
              <div className="font-semibold text-blue-900 text-sm">{technician.name}</div>
              <div className="text-blue-700 flex items-center gap-2">
                <span>Employee ID: <strong className="font-mono">{technician.employeeId}</strong></span>
                <span>·</span>
                <span>City: {technician.city} ({technician.zone || 'Base'})</span>
              </div>
            </div>

            {/* Default DC */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Default DC / Hub
              </label>
              <input
                type="text"
                placeholder="e.g. Central Delhi DC, Sector 83 DC"
                value={defaultDc}
                onChange={(e) => setDefaultDc(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Starting Latitude & Longitude */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Starting Latitude (-90 to +90)
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Starting Longitude (-180 to +180)
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Select on Map Button */}
            <div>
              <button
                type="button"
                onClick={() => setShowMapPicker(true)}
                className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-medium rounded-lg border border-slate-300 transition-colors flex items-center justify-center gap-2"
              >
                <Globe className="w-4 h-4 text-blue-600" />
                SELECT FROM MAP
              </button>
              <p className="text-xs text-slate-500 mt-1.5 text-center">
                Click on the map or drag the marker to pinpoint exact home/depot location.
              </p>
            </div>

            {/* Summary preview */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 space-y-1">
              <div><strong>Technician:</strong> {technician.name} ({technician.employeeId})</div>
              <div><strong>Starting Location:</strong> {lat && lng ? `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}` : 'Not configured'}</div>
              <div><strong>Default DC:</strong> {defaultDc || 'None specified'}</div>
              <div className="text-emerald-700 text-[11px] pt-1">✓ The route optimizer will use these exact coordinates as the technician starting point.</div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                Save Start Location
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Map picker modal */}
      {showMapPicker && (
        <LeafletCoordinatePickerModal
          isOpen={showMapPicker}
          title={`Pick Start Location for ${technician.name}`}
          initialLat={parseFloat(lat) || 28.6139}
          initialLng={parseFloat(lng) || 77.2090}
          locationName={`${technician.name} Base`}
          onSelectCoordinates={(newLat, newLng) => {
            setLat(String(newLat));
            setLng(String(newLng));
            setError(null);
          }}
          onClose={() => setShowMapPicker(false)}
        />
      )}
    </>
  );
};
