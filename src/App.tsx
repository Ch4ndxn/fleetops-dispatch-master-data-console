import React, { lazy, Suspense, useState, useEffect } from 'react';
import { ImportType, Technician, Center, ImportJob } from './types';
import { subscribeToDataChanges } from './services/storage';

// Subcomponents & Pages
import { OverviewPage } from './components/overview/OverviewPage';

// Modals
import { AddEditTechnicianModal } from './components/technicians/AddEditTechnicianModal';
import { AddEditCenterModal } from './components/centers/AddEditCenterModal';
import { CsvUploadWizardModal } from './components/importer/CsvUploadWizardModal';

// Icons
import {
  LayoutDashboard,
  CalendarCheck,
  ClipboardList,
  AlertCircle,
  Compass,
  CheckSquare,
  Radio,
  Award,
  Users,
  Map,
  Building2,
  UploadCloud,
  History,
  Settings,
  Menu,
  X,
  Bell,
  Search,
  Plus,
  Activity,
  Hexagon,
  Truck,
  Ticket,
  Sparkles,
  Waypoints,
  Route,
  BrainCircuit
} from 'lucide-react';


// ── Robust page loading ─────────────────────────────────────────
// After a new deploy, an already-open app asks for old page files that no longer
// exist (404) and the page would go blank. Reload once to pick up the new version.
function lazyPage<T extends React.ComponentType<any>>(load: () => Promise<{ default: T }>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return lazy(async () => {
    try {
      const mod = await load();
      sessionStorage.removeItem('fo_chunk_reload');
      return mod;
    } catch (err) {
      if (!sessionStorage.getItem('fo_chunk_reload')) {
        sessionStorage.setItem('fo_chunk_reload', '1');
        window.location.reload();
        return new Promise<{ default: T }>(() => {}); // wait for the reload
      }
      throw err;
    }
  });
}

/** Shows a message instead of a blank screen if a page fails to load or crashes. */
class PageErrorBoundary extends React.Component<{ children: React.ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('[FleetOps] Page error:', error); }
  componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-6 p-5 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-900 max-w-xl">
        <div className="font-bold mb-1">This page couldn't load</div>
        <div className="mb-3 text-xs">A new version of the app may have been released. Reloading usually fixes it. Your data is safe.</div>
        <div className="mb-3 text-[11px] font-mono text-amber-700 break-all">{this.state.error.message}</div>
        <button onClick={() => { sessionStorage.removeItem('fo_chunk_reload'); window.location.reload(); }}
          className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700">Reload app</button>
      </div>
    );
  }
}

// Pages load on first visit (was one 1.1 MB bundle with every page)
const AttendancePage = lazyPage(() => import('./components/attendance/AttendancePage').then(m => ({ default: m.AttendancePage })));
const ActiveCasesPage = lazyPage(() => import('./components/tickets/ActiveCasesPage').then(m => ({ default: m.ActiveCasesPage })));
const RoutePlannerPage = lazyPage(() => import('./components/routes/RoutePlannerPage').then(m => ({ default: m.RoutePlannerPage })));
const TicketAssignmentPage = lazyPage(() => import('./components/tickets/TicketAssignmentPage').then(m => ({ default: m.TicketAssignmentPage })));
const LiveTrackingPage = lazyPage(() => import('./components/tracking/LiveTrackingPage').then(m => ({ default: m.LiveTrackingPage })));
const VisitLogPage = lazyPage(() => import('./components/tracking/VisitLogPage').then(m => ({ default: m.VisitLogPage })));
const TechnicianPerformancePage = lazyPage(() => import('./components/performance/TechnicianPerformancePage').then(m => ({ default: m.TechnicianPerformancePage })));
const TechnicianManagement = lazyPage(() => import('./components/technicians/TechnicianManagement').then(m => ({ default: m.TechnicianManagement })));
const CenterManagement = lazyPage(() => import('./components/centers/CenterManagement').then(m => ({ default: m.CenterManagement })));
const ImportDataPage = lazyPage(() => import('./components/importer/ImportDataPage').then(m => ({ default: m.ImportDataPage })));
const ImportHistoryPage = lazyPage(() => import('./components/history/ImportHistoryPage').then(m => ({ default: m.ImportHistoryPage })));
const SettingsPage = lazyPage(() => import('./components/settings/SettingsPage').then(m => ({ default: m.SettingsPage })));
const ConnectionStatusPage = lazyPage(() => import('./components/connections/ConnectionStatusPage').then(m => ({ default: m.ConnectionStatusPage })));
const HexZoneMapPage = lazyPage(() => import('./components/map/HexZoneMapPage').then(m => ({ default: m.HexZoneMapPage })));
const RosterPage = lazyPage(() => import('./components/roster/RosterPage').then(m => ({ default: m.RosterPage })));
const PlannerPage = lazyPage(() => import('./components/planner/PlannerPage').then(m => ({ default: m.PlannerPage })));
const VehiclesPage = lazyPage(() => import('./components/vehicles/VehiclesPage').then(m => ({ default: m.VehiclesPage })));
const TicketsPage = lazyPage(() => import('./components/tickets/TicketsPage').then(m => ({ default: m.TicketsPage })));
const AiAssistantPage = lazyPage(() => import('./components/ai/AiAssistantPage').then(m => ({ default: m.AiAssistantPage })));
const AiRoutePlannerPage = lazyPage(() => import('./components/airouter/AiRoutePlannerPage').then(m => ({ default: m.AiRoutePlannerPage })));
const CityRoutesPage = lazyPage(() => import('./components/cityroutes/CityRoutesPage').then(m => ({ default: m.CityRoutesPage })));
const SmartRoutePlannerPage = lazyPage(() => import('./components/smartrouter/SmartRoutePlannerPage').then(m => ({ default: m.SmartRoutePlannerPage })));
const VroomRosterPage = lazyPage(() => import('./components/vroomroster/VroomRosterPage').then(m => ({ default: m.VroomRosterPage })));
const ClusterRoutesPage = lazyPage(() => import('./components/clusterroutes/ClusterRoutesPage').then(m => ({ default: m.ClusterRoutesPage })));

type NavTab =
  | 'OVERVIEW'
  | 'PLANNER'
  | 'ROSTER'
  | 'ATTENDANCE'
  | 'ACTIVE CASES'
  | 'ROUTE PLANNER'
  | 'TICKET ASSIGNMENT'
  | 'LIVE TRACKING'
  | 'TECHNICIAN PERFORMANCE'
  | 'TECHNICIAN MANAGEMENT'
  | 'CENTER MANAGEMENT'
  | 'IMPORT DATA'
  | 'HISTORY'
  | 'SETTINGS'
  | 'CONNECTIONS'
  | 'HEX ZONE MAP'
  | 'VEHICLES'
  | 'TICKETS'
  | 'AI ASSISTANT'
  | 'AI ROUTE'
  | 'SMART ROUTE'
  | 'CITY ROUTES'
  | 'VROOM ROUTES'
  | 'CLUSTER ROUTES'
  | 'VISIT LOG';

interface NavItem {
  id: NavTab;
  label: string;
  icon: React.ElementType;
  badge?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { id: 'OVERVIEW',      label: 'Overview',      icon: LayoutDashboard },
      { id: 'PLANNER',       label: 'NCR Planner',   icon: Map },
      { id: 'AI ASSISTANT',  label: 'AI Assistant',  icon: Sparkles },
    ],
  },
  {
    label: 'Field',
    items: [
      { id: 'TICKETS',            label: 'Tickets',           icon: Ticket },
      { id: 'ACTIVE CASES',       label: 'Active Cases',      icon: AlertCircle },
      { id: 'TICKET ASSIGNMENT',  label: 'Ticket Assignment', icon: CheckSquare },
      { id: 'VEHICLES',           label: 'Vehicles',          icon: Truck },
      { id: 'ROUTE PLANNER',      label: 'Route Planner',     icon: Compass },
      { id: 'AI ROUTE',           label: 'AI Route',          icon: BrainCircuit },
      { id: 'SMART ROUTE',        label: 'Smart Route',       icon: Sparkles },
      { id: 'CITY ROUTES',        label: 'City Routes',       icon: Waypoints },
      { id: 'VROOM ROUTES',       label: 'VROOM Routes',      icon: Route },
      { id: 'CLUSTER ROUTES',     label: 'Cluster Routes',    icon: Waypoints },
      { id: 'LIVE TRACKING',      label: 'Live Tracking',     icon: Radio },
      { id: 'VISIT LOG',          label: 'Visit Log',         icon: CheckSquare },
      { id: 'HEX ZONE MAP',       label: 'Hex Zone Map',      icon: Hexagon },
    ],
  },
  {
    label: 'People',
    items: [
      { id: 'ROSTER',                  label: 'Roster',               icon: ClipboardList },
      { id: 'ATTENDANCE',              label: 'Attendance',           icon: CalendarCheck },
      { id: 'TECHNICIAN MANAGEMENT',   label: 'Technicians',          icon: Users },
      { id: 'CENTER MANAGEMENT',       label: 'Centers',              icon: Building2 },
      { id: 'TECHNICIAN PERFORMANCE',  label: 'Performance',          icon: Award },
    ],
  },
  {
    label: 'Data',
    items: [
      { id: 'IMPORT DATA',  label: 'Import Data',  icon: UploadCloud },
      { id: 'HISTORY',      label: 'History',      icon: History },
      { id: 'CONNECTIONS',  label: 'Connections',  icon: Activity },
      { id: 'SETTINGS',     label: 'Settings',     icon: Settings },
    ],
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('OVERVIEW');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [, setRerenderTrigger] = useState(0);

  // Global modals triggered from header / quick actions
  const [isAddTechModalOpen, setIsAddTechModalOpen] = useState(false);
  const [isAddCenterModalOpen, setIsAddCenterModalOpen] = useState(false);
  const [uploadModalType, setUploadModalType] = useState<ImportType | null>(null);

  // Toast / Status notification
  const [globalBanner, setGlobalBanner] = useState<string | null>(null);

  // Subscribe to storage changes for reactive re-render
  useEffect(() => {
    const unsubscribe = subscribeToDataChanges(() => {
      setRerenderTrigger(prev => prev + 1);
    });
    return () => unsubscribe();
  }, []);

  const handleOpenUpload = (type: ImportType) => {
    setUploadModalType(type);
  };

  const handleImportSuccess = (job: ImportJob) => {
    setGlobalBanner(`Import completed: ${job.insertedRows} inserted, ${job.updatedRows} updated.`);
    setTimeout(() => setGlobalBanner(null), 5000);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 font-sans text-slate-800">
      {/* Sidebar Navigation (Requirement 26) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-slate-300 flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand / Logo */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm tracking-wider shadow-sm">
              FO
            </div>
            <div>
              <div className="font-bold text-white text-sm tracking-tight leading-tight">
                FleetOps Dispatch
              </div>
              <div className="text-[10px] text-blue-400 font-mono tracking-wider">
                DELHI NCR CONSOLE
              </div>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-3 mb-1 text-[9px] font-bold tracking-widest text-slate-600 uppercase">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id);
                        setSidebarOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold tracking-wide transition-colors ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User / Org badge */}
        <div className="p-3.5 border-t border-slate-800 bg-slate-950/60 text-xs">
          <div className="text-slate-400 text-[11px] font-mono truncate">
            chandanchatterjee4455@gmail.com
          </div>
          <div className="text-emerald-400 font-medium text-[10px] flex items-center gap-1.5 mt-0.5">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></span>
            Ops Supervisor (Active)
          </div>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between shrink-0 shadow-2xs">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-slate-600 hover:text-slate-900 p-1"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm font-bold text-slate-900 tracking-wide">
              {activeTab}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Quick Header Actions */}
            <button
              onClick={() => setIsAddTechModalOpen(true)}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              + Technician
            </button>

            <button
              onClick={() => setIsAddCenterModalOpen(true)}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              + Center
            </button>

            <button
              onClick={() => handleOpenUpload('TICKET_CSV')}
              className="px-3 py-1.5 bg-slate-900 hover:bg-black text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-2xs"
            >
              <UploadCloud className="w-3.5 h-3.5 text-blue-400" />
              <span>Import CSV</span>
            </button>
          </div>
        </header>

        {/* Global Toast Banner */}
        {globalBanner && (
          <div className="bg-emerald-600 text-white px-4 py-2 text-xs font-medium flex items-center justify-between shrink-0 shadow-xs">
            <span>{globalBanner}</span>
            <button
              onClick={() => setGlobalBanner(null)}
              className="text-emerald-200 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {/* Page Content Viewport */}
        <main className={`flex-1 overflow-hidden ${activeTab === 'PLANNER' || activeTab === 'AI ASSISTANT' || activeTab === 'AI ROUTE' || activeTab === 'SMART ROUTE' ? '' : 'overflow-y-auto p-4 sm:p-6 lg:p-8'}`}>
          <PageErrorBoundary resetKey={activeTab}>
          <Suspense fallback={<div className="p-8 text-sm text-slate-400">Loading…</div>}>
          {activeTab === 'OVERVIEW' && (
            <OverviewPage
              onNavigate={(tab) => setActiveTab(tab as NavTab)}
              onOpenAddTechnician={() => setIsAddTechModalOpen(true)}
              onOpenAddCenter={() => setIsAddCenterModalOpen(true)}
              onOpenUploadModal={handleOpenUpload}
            />
          )}

          {activeTab === 'ROSTER' && (
            <RosterPage />
          )}

          {activeTab === 'PLANNER' && (
            <PlannerPage />
          )}

          {activeTab === 'ATTENDANCE' && (
            <AttendancePage onOpenUploadModal={handleOpenUpload} />
          )}

          {activeTab === 'ACTIVE CASES' && (
            <ActiveCasesPage onOpenUploadModal={handleOpenUpload} />
          )}

          {activeTab === 'ROUTE PLANNER' && (
            <RoutePlannerPage />
          )}

          {activeTab === 'TICKET ASSIGNMENT' && (
            <TicketAssignmentPage />
          )}

          {activeTab === 'LIVE TRACKING' && (
            <LiveTrackingPage />
          )}

          {activeTab === 'VISIT LOG' && (
            <VisitLogPage />
          )}

          {activeTab === 'TECHNICIAN PERFORMANCE' && (
            <TechnicianPerformancePage />
          )}

          {activeTab === 'TECHNICIAN MANAGEMENT' && (
            <TechnicianManagement onOpenUploadModal={handleOpenUpload} />
          )}

          {activeTab === 'CENTER MANAGEMENT' && (
            <CenterManagement onOpenUploadModal={handleOpenUpload} />
          )}

          {activeTab === 'IMPORT DATA' && (
            <ImportDataPage onOpenUploadModal={handleOpenUpload} />
          )}

          {activeTab === 'HISTORY' && (
            <ImportHistoryPage />
          )}

          {activeTab === 'SETTINGS' && (
            <SettingsPage />
          )}

          {activeTab === 'CONNECTIONS' && (
            <ConnectionStatusPage />
          )}

          {activeTab === 'HEX ZONE MAP' && (
            <HexZoneMapPage />
          )}

          {activeTab === 'AI ASSISTANT' && (
            <AiAssistantPage />
          )}

          {activeTab === 'AI ROUTE' && (
            <AiRoutePlannerPage />
          )}

          {activeTab === 'SMART ROUTE' && (
            <SmartRoutePlannerPage />
          )}

          {activeTab === 'CITY ROUTES' && <CityRoutesPage />}
          {activeTab === 'VROOM ROUTES' && <CityRoutesPage engine="vroom" />}
          {activeTab === 'CLUSTER ROUTES' && <ClusterRoutesPage />}

          {activeTab === 'TICKETS' && (
            <TicketsPage onOpenUploadModal={handleOpenUpload} />
          )}

          {activeTab === 'VEHICLES' && (
            <VehiclesPage />
          )}
                  </Suspense>
          </PageErrorBoundary>
        </main>
      </div>

      {/* Global Modals */}
      {isAddTechModalOpen && (
        <AddEditTechnicianModal
          isOpen={isAddTechModalOpen}
          onClose={() => setIsAddTechModalOpen(false)}
          onSuccess={(tech) => {
            setIsAddTechModalOpen(false);
            setGlobalBanner(`Technician ${tech.name} (${tech.employeeId}) created successfully.`);
            setTimeout(() => setGlobalBanner(null), 4000);
          }}
        />
      )}

      {isAddCenterModalOpen && (
        <AddEditCenterModal
          isOpen={isAddCenterModalOpen}
          onClose={() => setIsAddCenterModalOpen(false)}
          onSuccess={(center) => {
            setIsAddCenterModalOpen(false);
            setGlobalBanner(`Center ${center.name} created with coordinates [${center.latitude.toFixed(4)}, ${center.longitude.toFixed(4)}].`);
            setTimeout(() => setGlobalBanner(null), 4000);
          }}
        />
      )}

      {uploadModalType && (
        <CsvUploadWizardModal
          isOpen={Boolean(uploadModalType)}
          initialType={uploadModalType}
          onClose={() => setUploadModalType(null)}
          onSuccess={handleImportSuccess}
          onNavigateToCenters={() => {
            setUploadModalType(null);
            setActiveTab('CENTER MANAGEMENT');
          }}
          onNavigateToCases={() => {
            setUploadModalType(null);
            setActiveTab('ACTIVE CASES');
          }}
          onNavigateToRoutes={() => {
            setUploadModalType(null);
            setActiveTab('ROUTE PLANNER');
          }}
        />
      )}
    </div>
  );
}
