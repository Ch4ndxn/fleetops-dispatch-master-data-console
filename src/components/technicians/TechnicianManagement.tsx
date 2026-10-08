import React, { useState, useMemo } from 'react';
import { Technician } from '../../types';
import { getTechnicians, deleteTechnician, upsertTechnician } from '../../services/storage';
import { AddEditTechnicianModal } from './AddEditTechnicianModal';
import { EditStartLocationModal } from './EditStartLocationModal';
import { generateCSV, downloadCSV } from '../../services/csvParser';
import {
  UserPlus,
  MapPin,
  Search,
  Filter,
  Download,
  Upload,
  Edit2,
  Trash2,
  Phone,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

interface Props {
  onOpenUploadModal: (type: 'TECHNICIAN_CSV') => void;
}

export const TechnicianManagement: React.FC<Props> = ({ onOpenUploadModal }) => {
  const [technicians, setTechnicians] = useState<Technician[]>(() => getTechnicians());
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [cityFilter, setCityFilter] = useState('ALL');

  // Modal states
  const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
  const [editingTech, setEditingTech] = useState<Technician | null>(null);

  const [isStartLocationModalOpen, setIsStartLocationModalOpen] = useState(false);
  const [selectedTechForLocation, setSelectedTechForLocation] = useState<Technician | null>(null);

  // Success / notification message
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4500);
  };

  const refreshList = () => {
    setTechnicians(getTechnicians());
  };

  const handleOpenAdd = () => {
    setEditingTech(null);
    setIsAddEditModalOpen(true);
  };

  const handleOpenEdit = (tech: Technician) => {
    setEditingTech(tech);
    setIsAddEditModalOpen(true);
  };

  const handleOpenEditLocation = (tech: Technician) => {
    setSelectedTechForLocation(tech);
    setIsStartLocationModalOpen(true);
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete technician "${name}"? This action cannot be undone.`)) {
      deleteTechnician(id);
      refreshList();
      showNotification(`Technician "${name}" removed successfully.`);
    }
  };

  const handleSavedTechnician = (savedTech: Technician, isNew: boolean) => {
    setIsAddEditModalOpen(false);
    refreshList();
    showNotification(
      isNew
        ? `Technician ${savedTech.name} (${savedTech.employeeId}) created successfully and is available for operations!`
        : `Technician ${savedTech.name} updated successfully.`
    );
  };

  const handleSaveStartLocation = (techId: string, lat: number, lng: number, defaultDc?: string) => {
    const tech = technicians.find(t => t.id === techId);
    if (tech) {
      upsertTechnician({
        ...tech,
        startingLatitude: lat,
        startingLongitude: lng,
        defaultDc: defaultDc || tech.defaultDc
      });
      refreshList();
      showNotification(`Starting location for ${tech.name} updated to [${lat.toFixed(4)}, ${lng.toFixed(4)}]. Optimizer will route from here.`);
    }
  };

  const handleExportCSV = () => {
    const csv = generateCSV(technicians, [
      { key: 'employeeId', header: 'Emp ID' },
      { key: 'name', header: 'Name' },
      { key: 'phone', header: 'Phone' },
      { key: 'alternatePhone', header: 'Alt Phone' },
      { key: 'role', header: 'Role' },
      { key: 'vendor', header: 'Vendor' },
      { key: 'city', header: 'City' },
      { key: 'zone', header: 'Zone' },
      { key: 'specialisation', header: 'Specialisation' },
      { key: 'status', header: 'Status' },
      { key: 'joinedDate', header: 'Joined Date' },
      { key: 'assignedStm', header: 'Assigned STM' },
      { key: 'notes', header: 'Notes' },
      { key: 'startingLatitude', header: 'Latitude' },
      { key: 'startingLongitude', header: 'Longitude' },
      { key: 'defaultDc', header: 'Default DC' }
    ]);
    downloadCSV(`technician_master_${new Date().toISOString().split('T')[0]}.csv`, csv);
  };

  // Filtered list
  const filteredTechnicians = useMemo(() => {
    return technicians.filter(tech => {
      const matchSearch =
        tech.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tech.employeeId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tech.phone.includes(searchTerm) ||
        (tech.zone && tech.zone.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchStatus = statusFilter === 'ALL' || tech.status === statusFilter;
      const matchCity = cityFilter === 'ALL' || tech.city.toLowerCase() === cityFilter.toLowerCase();

      return matchSearch && matchStatus && matchCity;
    });
  }, [technicians, searchTerm, statusFilter, cityFilter]);

  // Unique cities for filter
  const uniqueCities = useMemo(() => {
    return Array.from(new Set(technicians.map(t => t.city).filter(Boolean)));
  }, [technicians]);

  return (
    <div className="space-y-6">
      {/* Notification Toast */}
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

      {/* Header & Main Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Technician Management</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage field engineers, starting locations for route planning, skills, and daily dispatch availability.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleExportCSV}
            className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-2xs"
            title="Download technician master as CSV"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>

          <button
            onClick={() => onOpenUploadModal('TECHNICIAN_CSV')}
            className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-2xs"
          >
            <Upload className="w-3.5 h-3.5 text-blue-600" />
            Upload CSV
          </button>

          <button
            onClick={handleOpenAdd}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold tracking-wide shadow-xs transition-colors flex items-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            + ADD TECHNICIAN
          </button>
        </div>
      </div>

      {/* Filters & Search Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by technician name, employee ID, phone or zone..."
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
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="Active">Active</option>
            <option value="On Leave">On Leave</option>
            <option value="Inactive">Inactive</option>
          </select>

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
        </div>
      </div>

      {/* Technicians Data Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                <th className="py-3 px-4">Emp ID</th>
                <th className="py-3 px-4">Technician Name</th>
                <th className="py-3 px-4">Role & Specialisation</th>
                <th className="py-3 px-4">City / Zone</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Starting Location (Optimizer Base)</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredTechnicians.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No technicians found matching current filters.
                  </td>
                </tr>
              ) : (
                filteredTechnicians.map((tech) => {
                  const hasCoords = tech.startingLatitude !== undefined && tech.startingLongitude !== undefined;

                  return (
                    <tr key={tech.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Emp ID */}
                      <td className="py-3 px-4 font-mono font-bold text-slate-900">
                        {tech.employeeId}
                      </td>

                      {/* Name & Vendor */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{tech.name}</div>
                        <div className="text-[11px] text-slate-500">{tech.vendor || 'In-House Ops'}</div>
                      </td>

                      {/* Role & Spec */}
                      <td className="py-3 px-4">
                        <div className="text-slate-800">{tech.role}</div>
                        <div className="text-[11px] text-slate-500">{tech.specialisation}</div>
                      </td>

                      {/* City / Zone */}
                      <td className="py-3 px-4">
                        <div className="text-slate-800">{tech.city}</div>
                        <div className="text-[11px] text-slate-500">{tech.zone || 'General Zone'}</div>
                      </td>

                      {/* Contact */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1 font-mono text-slate-800">
                          <Phone className="w-3 h-3 text-slate-400" />
                          {tech.phone}
                        </div>
                        {tech.alternatePhone && (
                          <div className="text-[11px] text-slate-400 font-mono">
                            Alt: {tech.alternatePhone}
                          </div>
                        )}
                      </td>

                      {/* Starting Location (Optimizer Base) */}
                      <td className="py-3 px-4">
                        {hasCoords ? (
                          <div>
                            <div className="font-mono text-[11px] text-slate-900 font-medium">
                              {tech.startingLatitude?.toFixed(4)}, {tech.startingLongitude?.toFixed(4)}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {tech.defaultDc || 'No default DC'}
                            </div>
                          </div>
                        ) : (
                          <div className="text-rose-600 font-medium text-[11px] flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            Missing Coordinates
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center text-[11px] font-semibold ${
                            tech.status === 'Active'
                              ? 'text-emerald-700'
                              : tech.status === 'On Leave'
                              ? 'text-amber-700'
                              : 'text-slate-500'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                              tech.status === 'Active'
                                ? 'bg-emerald-500'
                                : tech.status === 'On Leave'
                                ? 'bg-amber-500'
                                : 'bg-slate-400'
                            }`}
                          />
                          {tech.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* EDIT START LOCATION button (Requirement 2) */}
                          <button
                            onClick={() => handleOpenEditLocation(tech)}
                            className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-md font-semibold text-[11px] transition-colors flex items-center gap-1"
                            title="Edit starting location coordinates for route optimization"
                          >
                            <MapPin className="w-3 h-3" />
                            EDIT START LOCATION
                          </button>

                          <button
                            onClick={() => handleOpenEdit(tech)}
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors"
                            title="Edit technician details"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleDelete(tech.id, tech.name)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                            title="Delete technician"
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

        {/* Footer info */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between">
          <span>Showing {filteredTechnicians.length} of {technicians.length} technicians</span>
          <span>{technicians.filter(t => t.status === 'Active').length} active for dispatch</span>
        </div>
      </div>

      {/* Add / Edit Technician Modal */}
      {isAddEditModalOpen && (
        <AddEditTechnicianModal
          isOpen={isAddEditModalOpen}
          technicianToEdit={editingTech}
          onClose={() => setIsAddEditModalOpen(false)}
          onSuccess={handleSavedTechnician}
        />
      )}

      {/* Edit Start Location Modal (Requirement 2) */}
      {isStartLocationModalOpen && (
        <EditStartLocationModal
          isOpen={isStartLocationModalOpen}
          technician={selectedTechForLocation}
          onClose={() => setIsStartLocationModalOpen(false)}
          onSave={handleSaveStartLocation}
        />
      )}
    </div>
  );
};
