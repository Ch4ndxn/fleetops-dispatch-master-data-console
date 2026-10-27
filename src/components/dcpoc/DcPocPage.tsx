import React, { useState, useMemo } from 'react';
import { DC_POC_DATA, DcPocEntry } from './dcPocData';
import { Search, Phone, User, Building2, MapPin, ChevronDown, ChevronUp } from 'lucide-react';

const CITIES = ['All', ...Array.from(new Set(DC_POC_DATA.map(d => d.city))).sort()];

function PhoneLink({ phone, label }: { phone: string; label: string }) {
  if (!phone) return <span className="text-gray-400 text-xs">—</span>;
  return (
    <a
      href={`tel:+91${phone}`}
      className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm font-mono transition-colors"
      title={`Call ${label}`}
    >
      <Phone size={12} />
      {phone}
    </a>
  );
}

function WaLink({ phone, label }: { phone: string; label: string }) {
  if (!phone) return null;
  const url = `https://wa.me/91${phone}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-green-400 hover:text-green-300 text-xs transition-colors ml-2"
      title={`WhatsApp ${label}`}
    >
      <span>WA</span>
    </a>
  );
}

function DcCard({ entry }: { entry: DcPocEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden hover:border-blue-600 transition-colors">
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start justify-between gap-3 p-4 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-semibold text-sm truncate">{entry.center}</span>
            <span className="text-xs bg-blue-900/60 text-blue-300 px-2 py-0.5 rounded-full flex-shrink-0">{entry.city}</span>
          </div>
          <div className="flex items-center gap-1 mt-1">
            <User size={12} className="text-orange-400 flex-shrink-0" />
            <span className="text-orange-300 text-xs font-medium">POC: {entry.poc || '—'}</span>
            {entry.pocPhone && (
              <span className="text-gray-500 text-xs ml-1">· {entry.pocPhone}</span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 text-gray-400 mt-1">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-gray-700 px-4 pb-4 pt-3 space-y-3">
          {/* Address */}
          {entry.address && entry.address !== 'nan' && (
            <div className="flex items-start gap-2">
              <MapPin size={13} className="text-gray-400 mt-0.5 flex-shrink-0" />
              <span className="text-gray-300 text-xs leading-relaxed">{entry.address}</span>
            </div>
          )}

          {/* Central POC */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-orange-900/20 border border-orange-800/40 rounded-lg p-3">
              <div className="text-orange-400 text-xs font-semibold uppercase tracking-wide mb-2">Central POC</div>
              <div className="text-white text-sm font-medium">{entry.poc || '—'}</div>
              <div className="flex items-center mt-1">
                <PhoneLink phone={entry.pocPhone} label={entry.poc} />
                <WaLink phone={entry.pocPhone} label={entry.poc} />
              </div>
            </div>

            {/* TL */}
            <div className="bg-blue-900/20 border border-blue-800/40 rounded-lg p-3">
              <div className="text-blue-400 text-xs font-semibold uppercase tracking-wide mb-2">Team Leader</div>
              <div className="text-white text-sm font-medium">{entry.tl || '—'}</div>
              <div className="flex items-center mt-1">
                <PhoneLink phone={entry.tlPhone} label={entry.tl} />
                <WaLink phone={entry.tlPhone} label={entry.tl} />
              </div>
            </div>

            {/* ATL */}
            <div className="bg-purple-900/20 border border-purple-800/40 rounded-lg p-3">
              <div className="text-purple-400 text-xs font-semibold uppercase tracking-wide mb-2">Asst. Team Leader</div>
              <div className="text-white text-sm font-medium">{entry.atl || '—'}</div>
              <div className="flex items-center mt-1">
                <PhoneLink phone={entry.atlPhone} label={entry.atl} />
                <WaLink phone={entry.atlPhone} label={entry.atl} />
              </div>
            </div>
          </div>

          {/* Coords if available */}
          {entry.lat && entry.lng && (
            <a
              href={`https://maps.google.com/?q=${entry.lat},${entry.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-blue-400 transition-colors"
            >
              <MapPin size={11} />
              {entry.lat.toFixed(5)}, {entry.lng.toFixed(5)} · Open in Maps
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function DcPocPage() {
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('All');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return DC_POC_DATA.filter(d => {
      if (cityFilter !== 'All' && d.city !== cityFilter) return false;
      if (!q) return true;
      return (
        d.center.toLowerCase().includes(q) ||
        d.poc.toLowerCase().includes(q) ||
        d.tl.toLowerCase().includes(q) ||
        d.atl.toLowerCase().includes(q) ||
        d.city.toLowerCase().includes(q) ||
        d.pocPhone.includes(q) ||
        d.tlPhone.includes(q) ||
        d.atlPhone.includes(q)
      );
    });
  }, [search, cityFilter]);

  // Group by city
  const grouped = useMemo(() => {
    const map: Record<string, DcPocEntry[]> = {};
    for (const d of filtered) {
      if (!map[d.city]) map[d.city] = [];
      map[d.city].push(d);
    }
    return map;
  }, [filtered]);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 px-4 py-3">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <Building2 size={20} className="text-blue-400" />
            <h1 className="text-lg font-bold text-white">DC POC Directory</h1>
            <span className="text-xs text-gray-400 bg-gray-800 px-2 py-1 rounded-full">
              {filtered.length} of {DC_POC_DATA.length} centers
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            {/* Search */}
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search center, POC name, phone..."
                className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* City filter */}
            <select
              value={cityFilter}
              onChange={e => setCityFilter(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 sm:w-44"
            >
              {CITIES.map(c => (
                <option key={c} value={c}>{c === 'All' ? 'All Cities' : c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-4 space-y-6">
        {Object.keys(grouped).sort().map(city => (
          <div key={city}>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-base font-semibold text-blue-300">{city}</h2>
              <span className="text-xs text-gray-500">({grouped[city].length} centers)</span>
              <div className="flex-1 h-px bg-gray-700" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {grouped[city].map((entry, i) => (
                <DcCard key={`${entry.center}-${i}`} entry={entry} />
              ))}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-20 text-gray-500">
            <Building2 size={40} className="mx-auto mb-3 opacity-30" />
            <p>No centers found for "{search}"</p>
          </div>
        )}
      </div>
    </div>
  );
}
