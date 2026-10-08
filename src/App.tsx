import React, { useState, useEffect } from 'react';
import { ImportType, Technician, Center, ImportJob } from './types';
import { subscribeToDataChanges } from './services/storage';

// Subcomponents & Pages
import { OverviewPage } from './components/overview/OverviewPage';
import { AttendancePage } from './components/attendance/AttendancePage';
import { ActiveCasesPage } from './components/tickets/ActiveCasesPage';
import { RoutePlannerPage } from './components/routes/RoutePlannerPage';
import { TicketAssignmentPage } from './components/tickets/TicketAssignmentPage';
import { LiveTrackingPage } from './components/tracking/LiveTrackingPage';
import { TechnicianPerformancePage } from './components/performance/TechnicianPerformancePage';
import { TechnicianManagement } from './components/technicians/TechnicianManagement';
import { CenterManagement } from './components/centers/CenterManagement';
import { ImportDataPage } from './components/importer/ImportDataPage';
import { ImportHistoryPage } from './components/history/ImportHistoryPage';
import { SettingsPage } from './components/settings/SettingsPage';
import { ConnectionStatusPage } from './components/connections/ConnectionStatusPage';
import { HexZoneMapPage } from './components/map/HexZoneMapPage';
import { RosterPage } from './components/roster/RosterPage';
import { PlannerPage } from './components/planner/PlannerPage';
import { VehiclesPage } from './components/vehicles/VehiclesPage';
import { TicketsPage } from './components/tickets/TicketsPage';
import { AiAssistantPage } from './components/ai/AiAssistantPage';

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
  Sparkles
} from 'lucide-react';

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
  | 'AI ASSISTANT';

interface NavItem {
  id: NavTab;
  label: string;
  icon: React.ElementType;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'OVERVIEW', label: 'OVERVIEW', icon: LayoutDashboard },
  { id: 'PLANNER', label: 'NCR PLANNER', icon: Map },
  { id: 'AI ASSISTANT', label: 'AI ASSISTANT', icon: Sparkles },
  { id: 'TICKETS', label: 'TICKETS', icon: Ticket },
  { id: 'VEHICLES', label: 'VEHICLES', icon: Truck },
  { id: 'HEX ZONE MAP', label: 'HEX ZONE MAP', icon: Hexagon },
  { id: 'ROSTER', label: 'ROSTER', icon: ClipboardList },
  { id: 'ATTENDANCE', label: 'ATTENDANCE', icon: CalendarCheck },
  { id: 'ACTIVE CASES', label: 'ACTIVE CASES', icon: AlertCircle },
  { id: 'ROUTE PLANNER', label: 'ROUTE PLANNER', icon: Compass },
  { id: 'TICKET ASSIGNMENT', label: 'TICKET ASSIGNMENT', icon: CheckSquare },
  { id: 'LIVE TRACKING', label: 'LIVE TRACKING', icon: Radio },
  { id: 'TECHNICIAN PERFORMANCE', label: 'TECHNICIAN PERFORMANCE', icon: Award },
  { id: 'TECHNICIAN MANAGEMENT', label: 'TECHNICIAN MANAGEMENT', icon: Users },
  { id: 'CENTER MANAGEMENT', label: 'CENTER MANAGEMENT', icon: Building2 },
  { id: 'IMPORT DATA', label: 'IMPORT DATA', icon: UploadCloud },
  { id: 'HISTORY', label: 'HISTORY', icon: History },
  { id: 'SETTINGS', label: 'SETTINGS', icon: Settings },
  { id: 'CONNECTIONS', label: 'CONNECTIONS', icon: Activity },
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
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {NAV_ITEMS.map((item) => {
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
        <main className={`flex-1 overflow-hidden ${activeTab === 'PLANNER' || activeTab === 'AI ASSISTANT' ? '' : 'overflow-y-auto p-4 sm:p-6 lg:p-8'}`}>
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

          {activeTab === 'TICKETS' && (
            <TicketsPage onOpenUploadModal={handleOpenUpload} />
          )}

          {activeTab === 'VEHICLES' && (
            <VehiclesPage />
          )}
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
