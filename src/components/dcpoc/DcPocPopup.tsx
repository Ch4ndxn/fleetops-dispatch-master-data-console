/**
 * DcPocPopup — lightweight contact card for a DC center.
 * Renders inline (as a floating popup) when a center name is clicked.
 * Usage:
 *   <DcPocTrigger centerName={ticket.centerName} />
 */
import React, { useState, useRef, useEffect } from 'react';
import { DC_POC_DATA } from './dcPocData';
import { Phone, X, User, Building2, ExternalLink } from 'lucide-react';

function findPoc(centerName: string) {
  if (!centerName) return null;
  const norm = centerName.trim().toLowerCase();
  // exact match first
  let match = DC_POC_DATA.find(d => d.center.toLowerCase() === norm);
  if (!match) {
    // fuzzy: strip trailing _D/_H etc and try contains
    const base = norm.replace(/[_\s]+(d|h|w|c)$/, '');
    match = DC_POC_DATA.find(d => d.center.toLowerCase().includes(base));
  }
  return match ?? null;
}

function ContactRow({ label, name, phone, color }: {
  label: string;
  name: string;
  phone: string;
  color: string;
}) {
  if (!name && !phone) return null;
  return (
    <div className={`rounded-lg p-2.5 ${color}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider mb-1 opacity-70">{label}</div>
      <div className="font-medium text-sm">{name || '—'}</div>
      {phone ? (
        <div className="flex items-center gap-2 mt-1">
          <a
            href={`tel:+91${phone}`}
            className="flex items-center gap-1 text-xs font-mono hover:underline"
          >
            <Phone size={11} /> {phone}
          </a>
          <a
            href={`https://wa.me/91${phone}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] bg-green-600/30 text-green-300 px-1.5 py-0.5 rounded hover:bg-green-600/50 transition-colors"
          >
            WA
          </a>
        </div>
      ) : (
        <div className="text-xs opacity-50 mt-1">No number</div>
      )}
    </div>
  );
}

interface Props {
  centerName: string;
  /** Optional extra class on the trigger button */
  className?: string;
}

export function DcPocTrigger({ centerName, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const poc = findPoc(centerName);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className={`relative inline-block ${className}`} ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 hover:text-blue-600 transition-colors text-left group"
        title={poc ? `POC: ${poc.poc} · TL: ${poc.tl}` : 'No POC data found'}
      >
        <Building2 size={12} className="text-slate-400 group-hover:text-blue-500 flex-shrink-0" />
        <span className="truncate">{centerName}</span>
        {poc && (
          <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-green-500 ml-0.5" title="POC data available" />
        )}
      </button>

      {open && (
        <div className="absolute z-50 left-0 top-full mt-1 w-72 bg-gray-900 border border-gray-600 rounded-xl shadow-2xl text-white overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-700 bg-gray-800">
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{centerName}</div>
              {poc && <div className="text-[11px] text-gray-400">{poc.city}</div>}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="flex-shrink-0 p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors ml-2"
            >
              <X size={14} />
            </button>
          </div>

          {poc ? (
            <div className="p-3 space-y-2">
              <ContactRow
                label="Central POC"
                name={poc.poc}
                phone={poc.pocPhone}
                color="bg-orange-900/30 text-orange-100 border border-orange-800/30"
              />
              <ContactRow
                label="Team Leader"
                name={poc.tl}
                phone={poc.tlPhone}
                color="bg-blue-900/30 text-blue-100 border border-blue-800/30"
              />
              <ContactRow
                label="Asst. Team Leader"
                name={poc.atl}
                phone={poc.atlPhone}
                color="bg-purple-900/30 text-purple-100 border border-purple-800/30"
              />
              {poc.lat && poc.lng && (
                <a
                  href={`https://maps.google.com/?q=${poc.lat},${poc.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-blue-400 transition-colors mt-1"
                >
                  <ExternalLink size={10} /> Open in Maps
                </a>
              )}
            </div>
          ) : (
            <div className="px-3 py-4 text-center">
              <User size={24} className="mx-auto text-gray-600 mb-2" />
              <div className="text-sm text-gray-400">No POC data for this center</div>
              <div className="text-[11px] text-gray-600 mt-1">Check DC POC tab for full directory</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
