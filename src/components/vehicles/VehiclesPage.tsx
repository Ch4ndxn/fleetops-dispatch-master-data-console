/**
 * VehiclesPage — NCR Vehicle Fleet Registry
 * All 160 vehicles from NCR_VEHICLE.xlsx
 * Features: search, filter by city/month/brand/flag, summary cards, sortable table, CSV export
 */

import React, { useState, useMemo } from 'react';
import {
  Search, Download, AlertTriangle, CheckCircle2,
  FileWarning, Car, MapPin, Calendar, Filter, X,
} from 'lucide-react';
import RAW_VEHICLES from '../../data/ncrVehicles.json';

// ── Types ─────────────────────────────────────────────────────────────
interface Vehicle {
  contractNo: string;
  actualNo: string;
  deployedMonth: string;
  check: string;
  contractStart: string;
  chassisNo: string;
  center: string;
  city: string;
  cityType: string;
  cluster: string;
  brand: string;
  hasMismatch: boolean;
  noContract: boolean;
  noChassis: boolean;
}

const VEHICLES = RAW_VEHICLES as Vehicle[];

// ── City colour map ───────────────────────────────────────────────────
const CITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Delhi:     { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' },
  Gurgaon:   { bg: '#F0FDF4', text: '#16A34A', border: '#BBF7D0' },
  Noida:     { bg: '#FFF7ED', text: '#EA580C', border: '#FED7AA' },
  Faridabad: { bg: '#FDF4FF', text: '#9333EA', border: '#E9D5FF' },
  Ghaziabad: { bg: '#FFFBEB', text: '#D97706', border: '#FDE68A' },
  Palwal:    { bg: '#F0F9FF', text: '#0284C7', border: '#BAE6FD' },
  Sohna:     { bg: '#FFF1F2', text: '#E11D48', border: '#FECDD3' },
};

const MONTH_ORDER = ['Mar','Apr','May','Jun','Jul','Aug','Sep','Oct'];

// ── Helpers ───────────────────────────────────────────────────────────
function CityBadge({ city }: { city: string }) {
  const c = CITY_COLORS[city] || { bg: '#F8FAFC', text: '#64748B', border: '#E2E8F0' };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: c.bg, color: c.text, border: `1px solid ${c.border}`, whiteSpace: 'nowrap' }}>
      {city}
    </span>
  );
}

function StatCard({ label, value, sub, color, icon }: { label: string; value: number | string; sub?: string; color: string; icon: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</span>
        <span style={{ color }}>{icon}</span>
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#94A3B8' }}>{sub}</div>}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────
export function VehiclesPage() {
  const [search, setSearch] = useState('');
  const [filterCity, setFilterCity] = useState('All');
  const [filterMonth, setFilterMonth] = useState('All');
  const [filterBrand, setFilterBrand] = useState('All');
  const [filterFlag, setFilterFlag] = useState<'all' | 'mismatch' | 'no_contract' | 'no_chassis'>('all');
  const [sortCol, setSortCol] = useState<keyof Vehicle>('contractNo');
  const [sortAsc, setSortAsc] = useState(true);

  // Summary stats
  const stats = useMemo(() => {
    const cityCount: Record<string, number> = {};
    const monthCount: Record<string, number> = {};
    VEHICLES.forEach(v => {
      cityCount[v.city] = (cityCount[v.city] || 0) + 1;
      monthCount[v.deployedMonth] = (monthCount[v.deployedMonth] || 0) + 1;
    });
    return {
      total: VEHICLES.length,
      mismatches: VEHICLES.filter(v => v.hasMismatch).length,
      noContract: VEHICLES.filter(v => v.noContract).length,
      noChassis: VEHICLES.filter(v => v.noChassis).length,
      cityCount,
      monthCount,
    };
  }, []);

  // Unique filter values
  const cities = ['All', ...Object.keys(CITY_COLORS).filter(c => stats.cityCount[c])];
  const months = ['All', ...MONTH_ORDER.filter(m => stats.monthCount[m])];
  const brands = ['All', ...Array.from(new Set(VEHICLES.map(v => v.brand))).sort()];

  // Filter + search + sort
  const filtered = useMemo(() => {
    let list = VEHICLES.filter(v => {
      if (filterCity !== 'All' && v.city !== filterCity) return false;
      if (filterMonth !== 'All' && v.deployedMonth !== filterMonth) return false;
      if (filterBrand !== 'All' && v.brand !== filterBrand) return false;
      if (filterFlag === 'mismatch' && !v.hasMismatch) return false;
      if (filterFlag === 'no_contract' && !v.noContract) return false;
      if (filterFlag === 'no_chassis' && !v.noChassis) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          v.contractNo.toLowerCase().includes(q) ||
          v.actualNo.toLowerCase().includes(q) ||
          v.chassisNo.toLowerCase().includes(q) ||
          v.center.toLowerCase().includes(q) ||
          v.city.toLowerCase().includes(q)
        );
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      const av = String(a[sortCol] ?? '');
      const bv = String(b[sortCol] ?? '');
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return list;
  }, [search, filterCity, filterMonth, filterBrand, filterFlag, sortCol, sortAsc]);

  const handleSort = (col: keyof Vehicle) => {
    if (sortCol === col) setSortAsc(p => !p);
    else { setSortCol(col); setSortAsc(true); }
  };

  const exportCSV = () => {
    const headers = ['Contract No','Actual No','Deployed Month','Contract Start','Chassis No','Center','City','Brand','Mismatch','No Contract','No Chassis'];
    const rows = filtered.map(v => [
      v.contractNo, v.actualNo, v.deployedMonth, v.contractStart,
      v.chassisNo, v.center, v.city, v.brand,
      v.hasMismatch ? 'YES' : '', v.noContract ? 'YES' : '', v.noChassis ? 'YES' : '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'ncr-vehicles.csv';
    a.click();
  };

  const ThCell = ({ col, label }: { col: keyof Vehicle; label: string }) => (
    <th
      onClick={() => handleSort(col)}
      style={{ padding: '9px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.5px', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none', background: sortCol === col ? '#F0F9F9' : '#F8FAFC', borderBottom: '2px solid #E2E8F0' }}
    >
      {label} {sortCol === col ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  );

  const hasActiveFilters = filterCity !== 'All' || filterMonth !== 'All' || filterBrand !== 'All' || filterFlag !== 'all' || search;

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', color: '#1E293B' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A' }}>NCR Vehicle Fleet</div>
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>Delhi NCR · All 160 vehicles in contract</div>
        </div>
        <button
          onClick={exportCSV}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, padding: '8px 16px', borderRadius: 10, border: '1.5px solid #0E6B6E', color: '#0E6B6E', background: '#ECFDF5', cursor: 'pointer' }}
        >
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Summary stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard label="Total Vehicles" value={stats.total} sub="Delhi NCR fleet" color="#0E6B6E" icon={<Car size={16} />} />
        <StatCard label="No. Mismatches" value={stats.mismatches} sub="Contract vs actual" color="#F97316" icon={<AlertTriangle size={16} />} />
        <StatCard label="No Contract" value={stats.noContract} sub="Pending creation" color="#EF4444" icon={<FileWarning size={16} />} />
        <StatCard label="No Chassis" value={stats.noChassis} sub="Missing chassis no." color="#8B5CF6" icon={<AlertTriangle size={16} />} />
      </div>

      {/* City breakdown pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        {Object.entries(stats.cityCount).sort((a,b) => b[1]-a[1]).map(([city, count]) => {
          const c = CITY_COLORS[city] || { bg:'#F8FAFC', text:'#64748B', border:'#E2E8F0' };
          return (
            <div
              key={city}
              onClick={() => setFilterCity(filterCity === city ? 'All' : city)}
              style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:20, background: c.bg, border:`1.5px solid ${filterCity === city ? c.text : c.border}`, cursor:'pointer', transition:'border-color .15s' }}
            >
              <span style={{ fontWeight: 700, fontSize: 12, color: c.text }}>{city}</span>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:800, color:c.text, background:'rgba(0,0,0,.06)', borderRadius:20, padding:'1px 6px' }}>{count}</span>
            </div>
          );
        })}
      </div>

      {/* Filters row */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:16, alignItems:'center' }}>
        {/* Search */}
        <div style={{ position:'relative', flex:'1', minWidth:200 }}>
          <Search size={13} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'#94A3B8' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search vehicle no., chassis, center…"
            style={{ width:'100%', paddingLeft:30, paddingRight:10, paddingTop:8, paddingBottom:8, fontSize:12, border:'1.5px solid #E2E8F0', borderRadius:10, outline:'none', boxSizing:'border-box', background:'#fff', color:'#1E293B' }}
          />
        </div>

        {/* Month filter */}
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ fontSize:11, fontWeight:700, padding:'8px 10px', borderRadius:10, border:'1.5px solid #E2E8F0', background:'#fff', color:'#475569', cursor:'pointer' }}>
          {months.map(m => <option key={m}>{m}</option>)}
        </select>

        {/* Brand filter */}
        <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)} style={{ fontSize:11, fontWeight:700, padding:'8px 10px', borderRadius:10, border:'1.5px solid #E2E8F0', background:'#fff', color:'#475569', cursor:'pointer' }}>
          {brands.map(b => <option key={b}>{b}</option>)}
        </select>

        {/* Flag filters */}
        {([
          { key: 'all', label: 'All' },
          { key: 'mismatch', label: `⚠ Mismatches (${stats.mismatches})` },
          { key: 'no_contract', label: `📄 No Contract (${stats.noContract})` },
          { key: 'no_chassis', label: `🔩 No Chassis (${stats.noChassis})` },
        ] as const).map(f => (
          <button
            key={f.key}
            onClick={() => setFilterFlag(f.key)}
            style={{ fontSize:11, fontWeight:700, padding:'7px 12px', borderRadius:10, border:`1.5px solid ${filterFlag === f.key ? '#0E6B6E' : '#E2E8F0'}`, color: filterFlag === f.key ? '#0E6B6E' : '#64748B', background: filterFlag === f.key ? '#ECFDF5' : '#fff', cursor:'pointer' }}
          >
            {f.label}
          </button>
        ))}

        {/* Clear filters */}
        {hasActiveFilters && (
          <button
            onClick={() => { setSearch(''); setFilterCity('All'); setFilterMonth('All'); setFilterBrand('All'); setFilterFlag('all'); }}
            style={{ fontSize:11, fontWeight:700, padding:'7px 10px', borderRadius:10, border:'1.5px solid #FCA5A5', color:'#EF4444', background:'#FEF2F2', cursor:'pointer', display:'flex', alignItems:'center', gap:4 }}
          >
            <X size={11} /> Clear
          </button>
        )}
      </div>

      {/* Results count */}
      <div style={{ fontSize:11, color:'#94A3B8', marginBottom:10 }}>
        Showing <span style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:'#0E6B6E' }}>{filtered.length}</span> of {VEHICLES.length} vehicles
      </div>

      {/* Table */}
      <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:12, overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr>
                <ThCell col="contractNo" label="Contract No." />
                <ThCell col="actualNo" label="Actual No." />
                <ThCell col="deployedMonth" label="Month" />
                <ThCell col="contractStart" label="Contract Start" />
                <ThCell col="chassisNo" label="Chassis No." />
                <ThCell col="center" label="Center" />
                <ThCell col="city" label="City" />
                <ThCell col="brand" label="Brand" />
                <th style={{ padding:'9px 12px', fontSize:10, fontWeight:700, color:'#64748B', textTransform:'uppercase', letterSpacing:'.5px', background:'#F8FAFC', borderBottom:'2px solid #E2E8F0', whiteSpace:'nowrap' }}>Flags</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v, i) => (
                <tr key={v.contractNo + i} style={{ borderBottom:'1px solid #F1F5F9', background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                  {/* Contract No */}
                  <td style={{ padding:'10px 12px', fontFamily:"'JetBrains Mono',monospace", fontWeight:700, fontSize:11, color:'#1E293B', whiteSpace:'nowrap' }}>
                    {v.contractNo}
                  </td>
                  {/* Actual No */}
                  <td style={{ padding:'10px 12px', fontFamily:"'JetBrains Mono',monospace", fontSize:11, whiteSpace:'nowrap' }}>
                    {v.actualNo ? (
                      <span style={{ color: v.hasMismatch ? '#F97316' : v.actualNo.toLowerCase() === 'zen' ? '#8B5CF6' : '#64748B', fontWeight: v.hasMismatch ? 700 : 400 }}>
                        {v.actualNo}
                      </span>
                    ) : (
                      <span style={{ color:'#CBD5E1' }}>—</span>
                    )}
                  </td>
                  {/* Month */}
                  <td style={{ padding:'10px 12px' }}>
                    <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, background:'#F1F5F9', color:'#475569' }}>{v.deployedMonth || '—'}</span>
                  </td>
                  {/* Contract Start */}
                  <td style={{ padding:'10px 12px', fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'#94A3B8', whiteSpace:'nowrap' }}>
                    {v.contractStart || '—'}
                  </td>
                  {/* Chassis */}
                  <td style={{ padding:'10px 12px', fontFamily:"'JetBrains Mono',monospace", fontSize:10, color: v.noChassis ? '#EF4444' : '#475569', whiteSpace:'nowrap' }}>
                    {v.chassisNo || <span style={{ color:'#EF4444', fontWeight:700 }}>MISSING</span>}
                  </td>
                  {/* Center */}
                  <td style={{ padding:'10px 12px', fontSize:11, color:'#475569', maxWidth:200, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {v.center}
                  </td>
                  {/* City */}
                  <td style={{ padding:'10px 12px' }}>
                    <CityBadge city={v.city} />
                  </td>
                  {/* Brand */}
                  <td style={{ padding:'10px 12px' }}>
                    <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:20, background: v.brand === 'Zepto' ? '#EFF6FF' : v.brand === 'Gemopai' ? '#FFF7ED' : '#F8FAFC', color: v.brand === 'Zepto' ? '#2563EB' : v.brand === 'Gemopai' ? '#EA580C' : '#94A3B8', border:`1px solid ${v.brand === 'Zepto' ? '#BFDBFE' : v.brand === 'Gemopai' ? '#FED7AA' : '#E2E8F0'}` }}>
                      {v.brand}
                    </span>
                  </td>
                  {/* Flags */}
                  <td style={{ padding:'10px 12px' }}>
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                      {v.hasMismatch && <span title="Contract/Actual number mismatch" style={{ fontSize:9, fontWeight:800, padding:'2px 6px', borderRadius:4, background:'#FFF7ED', color:'#EA580C', border:'1px solid #FED7AA' }}>MISMATCH</span>}
                      {v.noContract && <span title="Contract not created" style={{ fontSize:9, fontWeight:800, padding:'2px 6px', borderRadius:4, background:'#FEF2F2', color:'#EF4444', border:'1px solid #FECACA' }}>NO CONTRACT</span>}
                      {v.noChassis && <span title="No chassis number" style={{ fontSize:9, fontWeight:800, padding:'2px 6px', borderRadius:4, background:'#F5F3FF', color:'#7C3AED', border:'1px solid #DDD6FE' }}>NO CHASSIS</span>}
                      {!v.hasMismatch && !v.noContract && !v.noChassis && <CheckCircle2 size={13} color="#10B981" />}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding:'40px', textAlign:'center', color:'#CBD5E1', fontSize:13 }}>No vehicles match the current filters</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Month deployment timeline */}
      <div style={{ marginTop:20, background:'#fff', border:'1px solid #E2E8F0', borderRadius:12, padding:'16px 20px' }}>
        <div style={{ fontSize:12, fontWeight:700, color:'#64748B', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:12 }}>Deployment Timeline</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {MONTH_ORDER.filter(m => stats.monthCount[m]).map(month => {
            const count = stats.monthCount[month] || 0;
            const pct = Math.round((count / stats.total) * 100);
            return (
              <div key={month} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, flex:1, minWidth:50 }}>
                <div style={{ width:'100%', background:'#F1F5F9', borderRadius:6, overflow:'hidden', height:50, display:'flex', alignItems:'flex-end' }}>
                  <div style={{ width:'100%', background: filterMonth === month ? '#0E6B6E' : '#CBD5E1', height:`${Math.max(pct * 1.5, 6)}%`, transition:'height .3s', cursor:'pointer', borderRadius:'4px 4px 0 0' }} onClick={() => setFilterMonth(filterMonth === month ? 'All' : month)} />
                </div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:800, color:'#475569' }}>{count}</div>
                <div style={{ fontSize:9, color:'#94A3B8', fontWeight:600 }}>{month}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
