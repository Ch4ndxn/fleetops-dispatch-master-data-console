import React, { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import { Search, MapPin, Check, X, Compass } from 'lucide-react';
import { isValidLatitude, isValidLongitude } from '../../services/csvParser';

interface Props {
  isOpen: boolean;
  title: string;
  initialLat?: number;
  initialLng?: number;
  locationName?: string;
  onSelectCoordinates: (lat: number, lng: number) => void;
  onClose: () => void;
}

// Popular Delhi NCR quick hubs for fast ops picking
const DELHI_NCR_HOTSPOTS = [
  { name: 'Patel Nagar Hub (West Delhi)', lat: 28.6519, lng: 77.1663 },
  { name: 'Naraina Industrial Hub (West Delhi)', lat: 28.6289, lng: 77.1382 },
  { name: 'Okhla Phase 3 Hub (South Delhi)', lat: 28.5362, lng: 77.2711 },
  { name: 'Sector 83 / Phase 2 (Noida)', lat: 28.5145, lng: 77.4086 },
  { name: 'Udyog Vihar Hub (Gurugram)', lat: 28.5028, lng: 77.0878 },
  { name: 'Sector 24 Hub (Faridabad)', lat: 28.3752, lng: 77.3155 },
  { name: 'Mayapuri Industrial Area', lat: 28.6341, lng: 77.1192 },
  { name: 'Rohini Sector 16 (North Delhi)', lat: 28.7298, lng: 77.1186 },
  { name: 'Dwarka Sector 21 (South-West)', lat: 28.5524, lng: 77.0583 },
  { name: 'Connaught Place (Central)', lat: 28.6315, lng: 77.2167 }
];

export const LeafletCoordinatePickerModal: React.FC<Props> = ({
  isOpen,
  title,
  initialLat = 28.6139,
  initialLng = 77.2090,
  locationName,
  onSelectCoordinates,
  onClose
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const [currentLat, setCurrentLat] = useState<number>(initialLat || 28.6139);
  const [currentLng, setCurrentLng] = useState<number>(initialLng || 77.2090);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [coordError, setCoordError] = useState<string | null>(null);

  // Initialize or update coordinates when modal opens
  useEffect(() => {
    if (isOpen) {
      const validLat = isValidLatitude(initialLat) ? Number(initialLat) : 28.6139;
      const validLng = isValidLongitude(initialLng) ? Number(initialLng) : 77.2090;
      setCurrentLat(validLat);
      setCurrentLng(validLng);
      setCoordError(null);
    }
  }, [isOpen, initialLat, initialLng]);

  // Leaflet map lifecycle
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current) return;

    // Small delay to ensure modal container has dimensions in DOM
    const timer = setTimeout(() => {
      if (!mapContainerRef.current) return;

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      // Default Leaflet icon fix for Vite/bundlers
      const customIcon = L.divIcon({
        className: 'custom-leaflet-marker',
        html: `
          <div style="background-color: #2563eb; width: 34px; height: 34px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.3);">
            <div style="width: 10px; height: 10px; background: white; border-radius: 50%; transform: rotate(45deg);"></div>
          </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 34],
        popupAnchor: [0, -34]
      });

      const map = L.map(mapContainerRef.current, {
        center: [currentLat, currentLng],
        zoom: 12,
        zoomControl: true
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map);

      const marker = L.marker([currentLat, currentLng], {
        draggable: true,
        icon: customIcon
      }).addTo(map);

      marker.bindPopup(`<strong>${locationName || 'Selected Location'}</strong><br/>Lat: ${currentLat.toFixed(5)}, Lng: ${currentLng.toFixed(5)}`).openPopup();

      // Marker drag event
      marker.on('dragend', (e) => {
        const markerEvent = e.target as L.Marker;
        const pos = markerEvent.getLatLng();
        const lat = Math.round(pos.lat * 100000) / 100000;
        const lng = Math.round(pos.lng * 100000) / 100000;
        setCurrentLat(lat);
        setCurrentLng(lng);
        marker.setPopupContent(`<strong>${locationName || 'Selected Location'}</strong><br/>Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`);
      });

      // Map click event
      map.on('click', (e: L.LeafletMouseEvent) => {
        const lat = Math.round(e.latlng.lat * 100000) / 100000;
        const lng = Math.round(e.latlng.lng * 100000) / 100000;
        setCurrentLat(lat);
        setCurrentLng(lng);
        marker.setLatLng([lat, lng]);
        marker.setPopupContent(`<strong>${locationName || 'Selected Location'}</strong><br/>Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`).openPopup();
      });

      mapInstanceRef.current = map;
      markerRef.current = marker;

      // Force recalculation of map container size
      map.invalidateSize();
    }, 120);

    return () => {
      clearTimeout(timer);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [isOpen]);

  const updateCoordinates = (lat: number, lng: number) => {
    setCurrentLat(lat);
    setCurrentLng(lng);
    setCoordError(null);
    if (mapInstanceRef.current && markerRef.current) {
      mapInstanceRef.current.setView([lat, lng], 14);
      markerRef.current.setLatLng([lat, lng]);
      markerRef.current.setPopupContent(`<strong>${locationName || 'Selected Location'}</strong><br/>Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`).openPopup();
    }
  };

  const handleManualLatChange = (val: string) => {
    const num = parseFloat(val);
    if (!isNaN(num)) {
      setCurrentLat(num);
      if (num < -90 || num > 90) {
        setCoordError('Latitude must be between -90 and +90');
      } else {
        setCoordError(null);
        if (mapInstanceRef.current && markerRef.current && isValidLongitude(currentLng)) {
          markerRef.current.setLatLng([num, currentLng]);
          mapInstanceRef.current.panTo([num, currentLng]);
        }
      }
    }
  };

  const handleManualLngChange = (val: string) => {
    const num = parseFloat(val);
    if (!isNaN(num)) {
      setCurrentLng(num);
      if (num < -180 || num > 180) {
        setCoordError('Longitude must be between -180 and +180');
      } else {
        setCoordError(null);
        if (mapInstanceRef.current && markerRef.current && isValidLatitude(currentLat)) {
          markerRef.current.setLatLng([currentLat, num]);
          mapInstanceRef.current.panTo([currentLat, num]);
        }
      }
    }
  };

  const handleSearchNominatim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    setCoordError(null);

    // Check if query matches local Delhi NCR hotspots first for instant response
    const matchedPreset = DELHI_NCR_HOTSPOTS.find(h =>
      h.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
    );

    if (matchedPreset) {
      updateCoordinates(matchedPreset.lat, matchedPreset.lng);
      setSearching(false);
      return;
    }

    try {
      const endpoint = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        searchQuery + ', Delhi NCR, India'
      )}&limit=1`;
      const res = await fetch(endpoint, {
        headers: { 'Accept-Language': 'en' }
      });
      const data = await res.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        updateCoordinates(lat, lon);
      } else {
        setCoordError('No location found. Please click directly on the map or pick a nearby hub.');
      }
    } catch {
      setCoordError('Search service unavailable. Please click directly on the map.');
    } finally {
      setSearching(false);
    }
  };

  const handleSave = () => {
    if (!isValidLatitude(currentLat)) {
      setCoordError('Invalid Latitude. Value must be between -90 and +90.');
      return;
    }
    if (!isValidLongitude(currentLng)) {
      setCoordError('Invalid Longitude. Value must be between -180 and +180.');
      return;
    }
    onSelectCoordinates(currentLat, currentLng);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-4xl flex flex-col overflow-hidden max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div>
            <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-blue-600" />
              {title}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Click anywhere on the map or drag the blue marker to pinpoint exact latitude and longitude.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Hotspots Bar */}
        <div className="p-4 border-b border-slate-200 bg-white space-y-3">
          <form onSubmit={handleSearchNominatim} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search location in Delhi NCR (e.g., Patel Nagar, Sector 83 Noida, Okhla Phase 3)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={searching}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 shrink-0"
            >
              <Compass className="w-4 h-4" />
              {searching ? 'Locating...' : 'Locate'}
            </button>
          </form>

          {/* Quick presets for Delhi NCR */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs text-slate-600">
            <span className="font-medium text-slate-500 shrink-0">Quick Hubs:</span>
            {DELHI_NCR_HOTSPOTS.slice(0, 6).map((spot) => (
              <button
                key={spot.name}
                type="button"
                onClick={() => updateCoordinates(spot.lat, spot.lng)}
                className="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 border border-slate-200 rounded-md whitespace-nowrap transition-colors"
              >
                {spot.name.split(' (')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Interactive Map Container */}
        <div className="relative flex-1 min-h-[380px] bg-slate-100">
          <div ref={mapContainerRef} className="w-full h-[380px] z-10" />
          <div className="absolute top-3 right-3 z-20 bg-white/95 backdrop-blur-xs px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm text-xs font-mono text-slate-700">
            Click map or drag marker
          </div>
        </div>

        {/* Display Latitude / Longitude & Coordinates Controls */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200">
          {coordError && (
            <div className="mb-3 px-3 py-2 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg">
              {coordError}
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="grid grid-cols-2 gap-3 max-w-md">
              <div>
                <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1">
                  Latitude (-90 to +90)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={currentLat}
                    onChange={(e) => handleManualLatChange(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1">
                  Longitude (-180 to +180)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={currentLng}
                    onChange={(e) => handleManualLngChange(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                Save Coordinates
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
