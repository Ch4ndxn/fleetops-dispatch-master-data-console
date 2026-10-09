import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search, Download, Upload, Edit2, Trash2, Plus,
  ChevronUp, ChevronDown, X, Check, CheckSquare, Square,
  ChevronLeft, ChevronRight, AlertCircle, Clock, CheckCircle2, User, Filter
} from 'lucide-react';
import { Ticket, TicketStatus, TicketPriority, Technician, Center } from '../../types';
import { getTickets, saveTickets, getTechnicians, getCenters, newId, subscribeToDataChanges } from '../../services/storage';
import { generateCSV, downloadCSV } from '../../services/csvParser';

interface Props {
  onOpenUploadModal: (type: 'TICKET_CSV') => void;
}

const STATUSES: TicketStatus[] = ['Open', 'Assigned', 'In Progress', 'Pending Spares', 'Resolved', 'Closed'];
const PRIORITIES: TicketPriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const PAGE_SIZE = 25;

const PRIORITY_CLASSES: Record<TicketPriority, string> = {
  CRITICAL: 'bg-rose-100 text-rose-700 border border-rose-200',
  HIGH: 'bg-orange-100 text-orange-700 border border-orange-200',
  MEDIUM: 'bg-amber-100 text-amber-700 border border-amber-200',
  LOW: 'bg-slate-100 text-slate-600 border border-slate-200',
};

const STATUS_CLASSES: Record<TicketStatus, string> = {
  'Open': 'bg-blue-100 text-blue-700',
  'Assigned': 'bg-violet-100 text-violet-700',
  'In Progress': 'bg-cyan-100 text-cyan-700',
  'Pending Spares': 'bg-orange-100 text-orange-700',
  'Resolved': 'bg-emerald-100 text-emerald-700',
  'Closed': 'bg-slate-100 text-slate-500',
};

const ISSUE_TYPES = ['Breakdown', 'Periodic', 'Software', 'Battery', 'Other'];

type SortKey = 'ticketId' | 'vehicleNumber' | 'centerName' | 'priority' | 'status' | 'createdAt';
type SortDir = 'asc' | 'desc';

const emptyTicket = (): Partial<Ticket> => ({
  ticketId: `TKT-${Date.now().toString().slice(-6)}`,
  vehicleNumber: '',
  vendor: '',
  location: '',
  centerName: '',
  issue: '',
  category: '',
  issueType: '',
  status: 'Open',
  priority: 'MEDIUM',
  affectedSpare: '',
  assignedTechnicianId: '',
  assignedTechnicianName: '',
  scheduledSlot: '',
});

export const TicketsPage: React.FC<Props> = ({ onOpenUploadModal }) => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'ALL'>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | 'ALL'>('ALL');
  const [centerFilter, setCenterFilter] = useState('ALL');
  const [assigneeFilter, setAssigneeFilter] = useState('ALL');

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Pagination
  const [page, setPage] = useState(1);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Bulk actions
  const [bulkAssignId, setBulkAssignId] = useState('');
  const [bulkStatus, setBulkStatus] = useState<TicketStatus | ''>('');

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editTicket, setEditTicket] = useState<Partial<Ticket>>(emptyTicket());
  const [isNew, setIsNew] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Quick status dropdown
  const [quickStatusId, setQuickStatusId] = useState<string | null>(null);

  useEffect(() => {
    const load = () => { setTickets(getTickets()); setTechnicians(getTechnicians()); };
    load();
    return subscribeToDataChanges(load); // live: changes from any tab or device
  }, []);

  const centerOptions = useMemo(() => {
    const set = new Set(tickets.map(t => t.centerName).filter(Boolean));
    return Array.from(set).sort();
  }, [tickets]);

  const filtered = useMemo(() => {
    let list = [...tickets];

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        t.ticketId?.toLowerCase().includes(q) ||
        t.vehicleNumber?.toLowerCase().includes(q) ||
        t.centerName?.toLowerCase().includes(q) ||
        t.issue?.toLowerCase().includes(q) ||
        t.assignedTechnicianName?.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'ALL') list = list.filter(t => t.status === statusFilter);
    if (priorityFilter !== 'ALL') list = list.filter(t => t.priority === priorityFilter);
    if (centerFilter !== 'ALL') list = list.filter(t => t.centerName === centerFilter);
    if (assigneeFilter === 'Unassigned') list = list.filter(t => !t.assignedTechnicianId);
    else if (assigneeFilter !== 'ALL') list = list.filter(t => t.assignedTechnicianName === assigneeFilter);

    const priorityOrder: Record<TicketPriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const statusOrder: Record<TicketStatus, number> = { Open: 0, Assigned: 1, 'In Progress': 2, 'Pending Spares': 3, Resolved: 4, Closed: 5 };

    list.sort((a, b) => {
      let av: string | number = '';
      let bv: string | number = '';
      if (sortKey === 'priority') { av = priorityOrder[a.priority]; bv = priorityOrder[b.priority]; }
      else if (sortKey === 'status') { av = statusOrder[a.status]; bv = statusOrder[b.status]; }
      else { av = (a[sortKey] ?? '') as string; bv = (b[sortKey] ?? '') as string; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [tickets, search, statusFilter, priorityFilter, centerFilter, assigneeFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const persist = useCallback((updated: Ticket[]) => {
    setTickets(updated);
    saveTickets(updated);
  }, []);

  // Sorting
  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => (
    sortKey === col
      ? sortDir === 'asc' ? <ChevronUp size={13} className="inline ml-0.5" /> : <ChevronDown size={13} className="inline ml-0.5" />
      : <ChevronUp size={13} className="inline ml-0.5 opacity-20" />
  );

  // Selection
  const allPageIds = paginated.map(t => t.id);
  const allSelected = allPageIds.length > 0 && allPageIds.every(id => selected.has(id));
  const someSelected = allPageIds.some(id => selected.has(id));

  const toggleAll = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) allPageIds.forEach(id => next.delete(id));
      else allPageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const toggleRow = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Bulk actions
  const handleBulkAssign = () => {
    if (!bulkAssignId) return;
    const tech = technicians.find(t => t.id === bulkAssignId);
    const updated = tickets.map(t =>
      selected.has(t.id)
        ? { ...t, assignedTechnicianId: tech?.id ?? '', assignedTechnicianName: tech ? `${tech.name}` : '', status: 'Assigned' as TicketStatus, updatedAt: new Date().toISOString() }
        : t
    );
    persist(updated);
    setSelected(new Set());
    setBulkAssignId('');
  };

  const handleBulkStatus = () => {
    if (!bulkStatus) return;
    const updated = tickets.map(t =>
      selected.has(t.id)
        ? { ...t, status: bulkStatus as TicketStatus, updatedAt: new Date().toISOString() }
        : t
    );
    persist(updated);
    setSelected(new Set());
    setBulkStatus('');
  };

  const handleExportSelected = () => {
    const rows = tickets.filter(t => selected.has(t.id));
    const csv = generateCSV(rows);
    downloadCSV(csv, `tickets-selected-${Date.now()}.csv`);
  };

  const handleExportFiltered = () => {
    const csv = generateCSV(filtered);
    downloadCSV(csv, `tickets-export-${Date.now()}.csv`);
  };

  // Quick status
  const handleQuickStatus = (ticketId: string, status: TicketStatus) => {
    const updated = tickets.map(t =>
      t.id === ticketId ? { ...t, status, updatedAt: new Date().toISOString() } : t
    );
    persist(updated);
    setQuickStatusId(null);
  };

  // Modal
  const openCreate = () => {
    setEditTicket(emptyTicket());
    setIsNew(true);
    setDeleteConfirm(false);
    setModalOpen(true);
  };

  const openEdit = (ticket: Ticket) => {
    setEditTicket({ ...ticket });
    setIsNew(false);
    setDeleteConfirm(false);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setDeleteConfirm(false);
  };

  const handleModalSave = () => {
    const now = new Date().toISOString();
    if (isNew) {
      const newTicket: Ticket = {
        id: newId("ticket"),
        ticketId: editTicket.ticketId ?? `TKT-${Date.now().toString().slice(-6)}`,
        vehicleNumber: editTicket.vehicleNumber ?? '',
        vendor: editTicket.vendor,
        location: editTicket.location,
        centerName: editTicket.centerName ?? '',
        issue: editTicket.issue ?? '',
        category: editTicket.category,
        status: editTicket.status ?? 'Open',
        priority: editTicket.priority ?? 'MEDIUM',
        affectedSpare: editTicket.affectedSpare,
        issueType: editTicket.issueType,
        assignedTechnicianId: editTicket.assignedTechnicianId,
        assignedTechnicianName: editTicket.assignedTechnicianName,
        scheduledSlot: editTicket.scheduledSlot,
        createdAt: now,
        updatedAt: now,
        isNew: true,
      };
      persist([newTicket, ...tickets]);
    } else {
      const updated = tickets.map(t =>
        t.id === editTicket.id ? { ...t, ...editTicket, updatedAt: now } as Ticket : t
      );
      persist(updated);
    }
    closeModal();
  };

  const handleModalDelete = () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    const updated = tickets.filter(t => t.id !== editTicket.id);
    persist(updated);
    closeModal();
  };

  const handleTechChange = (techId: string) => {
    const tech = technicians.find(t => t.id === techId);
    setEditTicket(prev => ({
      ...prev,
      assignedTechnicianId: techId,
      assignedTechnicianName: tech ? tech.name : '',
    }));
  };

  // Stats
  const stats = useMemo(() => ({
    total: tickets.length,
    open: tickets.filter(t => t.status === 'Open').length,
    inProgress: tickets.filter(t => t.status === 'In Progress').length,
    resolved: tickets.filter(t => t.status === 'Resolved' || t.status === 'Closed').length,
    critical: tickets.filter(t => t.priority === 'CRITICAL').length,
  }), [tickets]);

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('ALL');
    setPriorityFilter('ALL');
    setCenterFilter('ALL');
    setAssigneeFilter('ALL');
    setPage(1);
  };

  const techNames = useMemo(() => {
    const names = new Set(tickets.map(t => t.assignedTechnicianName).filter(Boolean));
    return Array.from(names).sort() as string[];
  }, [tickets]);

  return (
    <div className="min-h-screen bg-slate-50 p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">TICKETS</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage, assign and edit field tickets</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search tickets..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="pl-8 pr-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg w-52 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={() => onOpenUploadModal('TICKET_CSV')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Upload size={14} /> Import CSV
          </button>
          <button
            onClick={handleExportFiltered}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Download size={14} /> Export CSV
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            <Plus size={14} /> New Ticket
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'Total', value: stats.total, color: 'text-slate-800' },
          { label: 'Open', value: stats.open, color: 'text-blue-700' },
          { label: 'In Progress', value: stats.inProgress, color: 'text-cyan-700' },
          { label: 'Resolved / Closed', value: stats.resolved, color: 'text-emerald-700' },
          { label: 'Critical', value: stats.critical, color: 'text-rose-700' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className={`text-3xl font-bold ${s.color}`} style={{ fontFamily: 'JetBrains Mono, monospace' }}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-1 font-medium">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-1">Status</span>
          {(['ALL', ...STATUSES] as const).map(s => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s as typeof statusFilter); setPage(1); }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                statusFilter === s
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
            >{s}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-1">Priority</span>
          {(['ALL', ...PRIORITIES] as const).map(p => (
            <button
              key={p}
              onClick={() => { setPriorityFilter(p as typeof priorityFilter); setPage(1); }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                priorityFilter === p
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
            >{p}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={centerFilter}
            onChange={e => { setCenterFilter(e.target.value); setPage(1); }}
            className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Centers</option>
            {centerOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={assigneeFilter}
            onChange={e => { setAssigneeFilter(e.target.value); setPage(1); }}
            className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Assignees</option>
            <option value="Unassigned">Unassigned</option>
            {techNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <X size={12} /> Clear filters
          </button>
          <span className="text-xs text-slate-400 ml-auto">{filtered.length} tickets</span>
        </div>
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-blue-800">{selected.size} selected</span>
          <div className="flex items-center gap-1.5">
            <select
              value={bulkAssignId}
              onChange={e => setBulkAssignId(e.target.value)}
              className="text-xs border border-blue-300 rounded px-2 py-1 bg-white focus:outline-none"
            >
              <option value="">Assign To...</option>
              {technicians.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button
              onClick={handleBulkAssign}
              disabled={!bulkAssignId}
              className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >Apply</button>
          </div>
          <div className="flex items-center gap-1.5">
            <select
              value={bulkStatus}
              onChange={e => setBulkStatus(e.target.value as TicketStatus)}
              className="text-xs border border-blue-300 rounded px-2 py-1 bg-white focus:outline-none"
            >
              <option value="">Change Status...</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={handleBulkStatus}
              disabled={!bulkStatus}
              className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >Apply</button>
          </div>
          <button
            onClick={handleExportSelected}
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-blue-700 border border-blue-300 rounded hover:bg-blue-100 transition-colors"
          >
            <Download size={12} /> Export Selected
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-600 border border-slate-300 rounded hover:bg-slate-50 transition-colors ml-auto"
          >
            <X size={12} /> Deselect All
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="w-10 px-3 py-3 text-left">
                  <button onClick={toggleAll} className="text-slate-400 hover:text-slate-700">
                    {allSelected ? <CheckSquare size={15} className="text-blue-600" /> : someSelected ? <CheckSquare size={15} className="text-blue-300" /> : <Square size={15} />}
                  </button>
                </th>
                {([
                  { label: 'Ticket ID', key: 'ticketId' as SortKey },
                  { label: 'Vehicle', key: 'vehicleNumber' as SortKey },
                  { label: 'Center', key: 'centerName' as SortKey },
                  { label: 'Issue', key: null },
                  { label: 'Category', key: null },
                  { label: 'Priority', key: 'priority' as SortKey },
                  { label: 'Status', key: 'status' as SortKey },
                  { label: 'Assigned Tech', key: null },
                  { label: 'Slot', key: null },
                  { label: 'Actions', key: null },
                ]).map(col => (
                  <th
                    key={col.label}
                    onClick={() => col.key && handleSort(col.key)}
                    className={`px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap ${col.key ? 'cursor-pointer hover:text-slate-800 select-none' : ''}`}
                  >
                    {col.label}{col.key && <SortIcon col={col.key} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-16 text-slate-400">
                    <AlertCircle size={32} className="mx-auto mb-2 opacity-30" />
                    <div className="text-sm">No tickets found</div>
                  </td>
                </tr>
              ) : paginated.map(ticket => (
                <tr
                  key={ticket.id}
                  className={`hover:bg-slate-50 transition-colors ${selected.has(ticket.id) ? 'bg-blue-50/40' : ''}`}
                >
                  <td className="px-3 py-2.5">
                    <button onClick={() => toggleRow(ticket.id)} className="text-slate-400 hover:text-slate-700">
                      {selected.has(ticket.id)
                        ? <CheckSquare size={15} className="text-blue-600" />
                        : <Square size={15} />}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-800 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {ticket.isNew && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0" title="New" />
                      )}
                      {ticket.ticketId}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-medium text-slate-800 whitespace-nowrap">{ticket.vehicleNumber}</td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{ticket.centerName}</td>
                  <td className="px-3 py-2.5 text-slate-600" style={{ maxWidth: 200 }}>
                    <div className="truncate" title={ticket.issue}>{ticket.issue}</div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-500 text-xs">{ticket.category ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${PRIORITY_CLASSES[ticket.priority]}`}>
                      {ticket.priority}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASSES[ticket.status]}`}>
                      {ticket.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                    {ticket.assignedTechnicianName
                      ? <span className="flex items-center gap-1"><User size={12} className="text-slate-400" />{ticket.assignedTechnicianName}</span>
                      : <span className="text-slate-300 text-xs">Unassigned</span>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500 text-xs whitespace-nowrap">
                    {ticket.scheduledSlot
                      ? <span className="flex items-center gap-1"><Clock size={11} className="text-slate-400" />{ticket.scheduledSlot}</span>
                      : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(ticket)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="Edit"
                      >
                        <Edit2 size={13} />
                      </button>
                      <div className="relative">
                        <button
                          onClick={() => setQuickStatusId(quickStatusId === ticket.id ? null : ticket.id)}
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                          title="Quick status"
                        >
                          <ChevronDown size={13} />
                        </button>
                        {quickStatusId === ticket.id && (
                          <div className="absolute right-0 top-8 z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[150px]">
                            {STATUSES.map(s => (
                              <button
                                key={s}
                                onClick={() => handleQuickStatus(ticket.id, s)}
                                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center justify-between ${ticket.status === s ? 'font-semibold text-blue-700' : 'text-slate-700'}`}
                              >
                                {s}
                                {ticket.status === s && <Check size={11} className="text-blue-600" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/50">
          <div className="text-xs text-slate-500">
            Showing {Math.min((page - 1) * PAGE_SIZE + 1, filtered.length)}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={15} />
            </button>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) pageNum = i + 1;
              else if (page <= 4) pageNum = i + 1;
              else if (page >= totalPages - 3) pageNum = totalPages - 6 + i;
              else pageNum = page - 3 + i;
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-7 h-7 text-xs rounded font-medium transition-colors ${page === pageNum ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-200'}`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Edit / Create Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-end"
          onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative z-10 w-full max-w-lg h-full bg-white shadow-2xl flex flex-col overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
              <div>
                <h2 className="font-semibold text-slate-900">{isNew ? 'New Ticket' : 'Edit Ticket'}</h2>
                {!isNew && (
                  <p className="text-xs text-slate-500 font-mono mt-0.5">{editTicket.ticketId}</p>
                )}
              </div>
              <button onClick={closeModal} className="p-1.5 hover:bg-slate-200 rounded transition-colors">
                <X size={16} className="text-slate-500" />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {isNew && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Ticket ID (auto-generated)</label>
                  <input
                    type="text"
                    value={editTicket.ticketId ?? ''}
                    readOnly
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-500 font-mono"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Vehicle Number</label>
                  <input
                    type="text"
                    value={editTicket.vehicleNumber ?? ''}
                    onChange={e => setEditTicket(p => ({ ...p, vehicleNumber: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Center Name</label>
                  <input
                    type="text"
                    value={editTicket.centerName ?? ''}
                    onChange={e => setEditTicket(p => ({ ...p, centerName: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Vendor</label>
                  <input
                    type="text"
                    value={editTicket.vendor ?? ''}
                    onChange={e => setEditTicket(p => ({ ...p, vendor: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Location</label>
                  <input
                    type="text"
                    value={editTicket.location ?? ''}
                    onChange={e => setEditTicket(p => ({ ...p, location: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Issue</label>
                <textarea
                  value={editTicket.issue ?? ''}
                  onChange={e => setEditTicket(p => ({ ...p, issue: e.target.value }))}
                  rows={3}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Category</label>
                  <input
                    type="text"
                    value={editTicket.category ?? ''}
                    onChange={e => setEditTicket(p => ({ ...p, category: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Issue Type</label>
                  <select
                    value={editTicket.issueType ?? ''}
                    onChange={e => setEditTicket(p => ({ ...p, issueType: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">Select...</option>
                    {ISSUE_TYPES.map(it => <option key={it} value={it}>{it}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Status</label>
                  <select
                    value={editTicket.status ?? 'Open'}
                    onChange={e => setEditTicket(p => ({ ...p, status: e.target.value as TicketStatus }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Priority</label>
                  <select
                    value={editTicket.priority ?? 'MEDIUM'}
                    onChange={e => setEditTicket(p => ({ ...p, priority: e.target.value as TicketPriority }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {PRIORITIES.map(pr => <option key={pr} value={pr}>{pr}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Affected Spare</label>
                  <input
                    type="text"
                    value={editTicket.affectedSpare ?? ''}
                    onChange={e => setEditTicket(p => ({ ...p, affectedSpare: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Scheduled Slot</label>
                  <input
                    type="text"
                    placeholder="e.g. 10:30"
                    value={editTicket.scheduledSlot ?? ''}
                    onChange={e => setEditTicket(p => ({ ...p, scheduledSlot: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Assigned Technician</label>
                <select
                  value={editTicket.assignedTechnicianId ?? ''}
                  onChange={e => handleTechChange(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Unassigned</option>
                  {technicians.map(t => (
                    <option key={t.id} value={t.id}>{t.name}{(t as any).empId ? ` (${(t as any).empId})` : ''}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Modal footer */}
            <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={handleModalSave}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Check size={14} /> {isNew ? 'Create Ticket' : 'Save Changes'}
                </button>
                <button
                  onClick={closeModal}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
              {!isNew && (
                <div>
                  {!deleteConfirm ? (
                    <button
                      onClick={handleModalDelete}
                      className="flex items-center gap-1.5 text-xs text-rose-500 hover:text-rose-700 transition-colors"
                    >
                      <Trash2 size={12} /> Delete Ticket
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                      <AlertCircle size={13} className="text-rose-500 flex-shrink-0" />
                      <span className="text-xs text-rose-700 flex-1">Are you sure? This cannot be undone.</span>
                      <button
                        onClick={handleModalDelete}
                        className="px-2 py-0.5 bg-rose-600 text-white text-xs rounded hover:bg-rose-700 transition-colors"
                      >Confirm</button>
                      <button
                        onClick={() => setDeleteConfirm(false)}
                        className="px-2 py-0.5 border border-rose-300 text-rose-600 text-xs rounded hover:bg-rose-100 transition-colors"
                      >Cancel</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Click outside to close quick status */}
      {quickStatusId && (
        <div className="fixed inset-0 z-40" onClick={() => setQuickStatusId(null)} />
      )}
    </div>
  );
};
