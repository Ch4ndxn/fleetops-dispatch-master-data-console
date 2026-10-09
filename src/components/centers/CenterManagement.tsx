import React, { useEffect, useState, useMemo } from 'react';
import { Center } from '../../types';
import { getCenters, deleteCenter, upsertCenter, subscribeToDataChanges } from '../../services/storage';
import { AddEditCenterModal } from './AddEditCenterModal';
import { LeafletCoordinatePickerModal } from '../map/LeafletCoordinatePickerModal';
import { generateCSV, downloadCSV } from '../../services/csvParser';
import {
  Building2,
  Plus,
  Upload,
  Download,
  Search,
  Filter,
  Globe,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { localDate } from '../../lib/date';

interface Props {
  onOpenUploadModal: (type: 'CENTER_CSV') => void;
  onNavigateToImport?: () => void;
}

export const CenterManagement: React.FC<Props> = ({ onOpenUploadModal }) => {
  const [centers, setCenters] = useState<Center[]>(() => getCenters());

  // Live: re-read whenever data changes anywhere (other tabs, other devices)
  useEffect(() => subscribeToDataChanges(() => { setCenters(getCenters()); }), []);
  const [searchTerm, setSearchTerm] = useState('');
  const [cityFilter, setCityFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Modal states
  const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
  const [editingCenter, setEditingCenter] = useState<Center | null>(null);

  // Quick map viewer / edit coordinate state
  const [mapPickerTargetCenter, setMapPickerTargetCenter] = useState<Center | null>(null);

  // Notification state
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4500);
  };

  const refreshList = () => {
    setCenters(getCenters());
  };

  const handleOpenAdd = () => {
    setEditingCenter(null);
    setIsAddEditModalOpen(true);
  };

  const handleOpenEdit = (center: Center) => {
    setEditingCenter(center);
    setIsAddEditModalOpen(true);
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Are you sure you want to remove center "${name}"? Existing tickets referencing this center may lose routing coordinates.`)) {
      deleteCenter(id);
      refreshList();
      showNotification(`Center "${name}" deleted.`);
    }
  };

  const handleSavedCenter = (center: Center, isNew: boolean) => {
    setIsAddEditModalOpen(false);
    refreshList();
    showNotification(
      isNew
        ? `Center "${center.name}" successfully created with coordinates [${center.latitude.toFixed(4)}, ${center.longitude.toFixed(4)}]!`
        : `Center "${center.name}" updated successfully.`
    );
  };

  // Requirement 20: Bulk Center Coordinate Update
  // DOWNLOAD CENTER MASTER CSV
  const handleDownloadMasterCSV = () => {
    const csv = generateCSV(centers, [
      { key: 'name', header: 'Center Name' },
      { key: 'city', header: 'City' },
      { key: 'latitude', header: 'Latitude' },
      { key: 'longitude', header: 'Longitude' },
      { key: 'defaultDc', header: 'Default DC' },
      { key: 'active', header: 'Active' },
      { key: 'notes', header: 'Notes' }
    ]);
    downloadCSV(`center_dc_master_${localDate()}.csv`, csv);
  };

  const handleMapCoordinatesSaved = (lat: number, lng: number) => {
    if (mapPickerTargetCenter) {
      upsertCenter({
        ...mapPickerTargetCenter,
        latitude: lat,
        longitude: lng
      });
      refreshList();
      showNotification(`Updated coordinates for "${mapPickerTargetCenter.name}" to [${lat.toFixed(4)}, ${lng.toFixed(4)}].`);
    }
  };

  const filteredCenters = useMemo(() => {
    return centers.filter(c => {
      const matchSearch =
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.defaultDc && c.defaultDc.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchCity = cityFilter === 'ALL' || c.city.toLowerCase() === cityFilter.toLowerCase();
      const matchStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' && c.active) ||
        (statusFilter === 'INACTIVE' && !c.active);

      return matchSearch && matchCity && matchStatus;
    });
  }, [centers, searchTerm, cityFilter, statusFilter]);

  const uniqueCities = useMemo(() => {
    return Array.from(new Set(centers.map(c => c.city).filter(Boolean)));
  }, [centers]);

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between shadow-sm transition-all ${
            notification.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2.5 text-sm font-medium">
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <span>{notification.message}</span>
          </div>
          <button
            onClick={() => setNotification(null)}
            className="text-slate-400 hover:text-slate-600 text-xs uppercase font-bold tracking-wider ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">CENTER / DC MANAGEMENT</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Master depot & charging hub coordinates. Powers automatic ticket assignment and route optimization across Delhi NCR.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* DOWNLOAD CENTER MASTER CSV (Requirement 20) */}
          <button
            onClick={handleDownloadMasterCSV}
            className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-2xs"
            title="Download CSV to edit coordinates in Excel"
          >
            <Download className="w-3.5 h-3.5" />
            DOWNLOAD CENTER MASTER CSV
          </button>

          {/* UPLOAD CENTER CSV (Requirement 5) */}
          <button
            onClick={() => onOpenUploadModal('CENTER_CSV')}
            className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-2xs"
          >
            <Upload className="w-3.5 h-3.5 text-blue-600" />
            UPLOAD CENTER CSV
          </button>

          {/* + ADD CENTER (Requirement 3) */}
          <button
            onClick={handleOpenAdd}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold tracking-wide shadow-xs transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            + ADD CENTER
          </button>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search centers by name, city or default DC..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Filter className="w-3.5 h-3.5" />
            <span>Filter:</span>
          </div>

          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Cities</option>
            {uniqueCities.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active Centers</option>
            <option value="INACTIVE">Inactive Centers</option>
          </select>
        </div>
      </div>

      {/* Centers Table as specified in Requirement 3 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                <th className="py-3 px-4">Center</th>
                <th className="py-3 px-4">City</th>
                <th className="py-3 px-4 text-right">Latitude</th>
                <th className="py-3 px-4 text-right">Longitude</th>
                <th className="py-3 px-4">Default DC</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredCenters.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No centers found matching criteria. Click <strong>+ ADD CENTER</strong> or upload CSV.
                  </td>
                </tr>
              ) : (
                filteredCenters.map((c) => {
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Center Name */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{c.name}</span>
                        </div>
                        {c.notes && <div className="text-[11px] text-slate-500 truncate max-w-xs">{c.notes}</div>}
                      </td>

                      {/* City */}
                      <td className="py-3 px-4 text-slate-800">
                        {c.city}
                      </td>

                      {/* Latitude */}
                      <td className="py-3 px-4 text-right font-mono font-medium text-slate-900">
                        {c.latitude?.toFixed(4)}
                      </td>

                      {/* Longitude */}
                      <td className="py-3 px-4 text-right font-mono font-medium text-slate-900">
                        {c.longitude?.toFixed(4)}
                      </td>

                      {/* Default DC */}
                      <td className="py-3 px-4 text-slate-700">
                        {c.defaultDc || '—'}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center text-[11px] font-semibold ${
                            c.active ? 'text-emerald-700' : 'text-slate-500'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                              c.active ? 'bg-emerald-500' : 'bg-slate-400'
                            }`}
                          />
                          {c.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      {/* Buttons: EDIT & SELECT LOCATION ON MAP (Requirement 3) */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* SELECT LOCATION ON MAP */}
                          <button
                            onClick={() => setMapPickerTargetCenter(c)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-700 rounded-md font-semibold text-[11px] transition-colors flex items-center gap-1 border border-slate-200"
                            title="Interactive Leaflet map coordinate picker"
                          >
                            <Globe className="w-3 h-3 text-blue-600" />
                            SELECT LOCATION ON MAP
                          </button>

                          {/* EDIT */}
                          <button
                            onClick={() => handleOpenEdit(c)}
                            className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-md font-semibold text-[11px] transition-colors flex items-center gap-1"
                          >
                            <Edit2 className="w-3 h-3 text-slate-500" />
                            EDIT
                          </button>

                          {/* DELETE */}
                          <button
                            onClick={() => handleDelete(c.id, c.name)}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                            title="Delete center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table summary */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between">
          <span>Showing {filteredCenters.length} centers in master database</span>
          <span className="text-emerald-700 font-medium">All centers verified with valid geocodes</span>
        </div>
      </div>

      {/* Add / Edit Center Modal */}
      {isAddEditModalOpen && (
        <AddEditCenterModal
          isOpen={isAddEditModalOpen}
          centerToEdit={editingCenter}
          onClose={() => setIsAddEditModalOpen(false)}
          onSuccess={handleSavedCenter}
        />
      )}

      {/* Standalone Map coordinate picker for quick update */}
      {mapPickerTargetCenter && (
        <LeafletCoordinatePickerModal
          isOpen={Boolean(mapPickerTargetCenter)}
          title={`Update Coordinates — ${mapPickerTargetCenter.name}`}
          initialLat={mapPickerTargetCenter.latitude}
          initialLng={mapPickerTargetCenter.longitude}
          locationName={mapPickerTargetCenter.name}
          onSelectCoordinates={handleMapCoordinatesSaved}
          onClose={() => setMapPickerTargetCenter(null)}
        />
      )}
    </div>
  );
};
