// @ts-nocheck
/* eslint-disable */
/**
 * NCR L3 Technician Planner engine — ported from the standalone
 * "NCR_L3_Technician_Planner" HTML. Logic and UI are kept as in the original;
 * the hardcoded DC / ticket / technician arrays are replaced by data passed in
 * from the database, and edits are reported through `hooks` so they persist.
 */
import * as L from 'leaflet';

const GLOBALS = ["applyAttendance", "assignTechnicians", "atClearErr", "buildHexClusters", "buildRoster", "buildTicketDashboard", "buildTrackerCardHTML", "calcRouteTime", "clearAllOverrides", "closeAddTech", "closeManageTechs", "confirmAddTech", "currentParams", "drawDCMarkers", "drawHexClusters", "drawHomeMarkers", "drawRoutes", "drawSpare", "editTechZone", "exportAttendance", "exportTracker", "filterTickets", "findOptimalSpareHubs", "flyToDC", "focusTech", "getStatusColor", "getStatusIcon", "haversineKm", "hexCenter", "hexVertices", "initAttendance", "initMap", "initTicketTracker", "latLonToHex", "markAllPresent", "nearestNeighbor", "onTechChange", "openAddTech", "openManageTechs", "reassignDropdownHTML", "reassignTicket", "rebuild", "recomputeTicketData", "removeTech", "renderAttendList", "renderAttendRow", "renderManageTechList", "renderTrackerCard", "renderTrackerList", "renderTrackerTechFilters", "restoreAllTickets", "routeDistance", "setAttendStatus", "setTicketNote", "setTicketStatus", "setTrackerFilter", "setTrackerTechFilter", "showToast", "switchView", "toXY", "toggleCard", "toggleTicket", "twoOpt", "updateAttendSummary", "updateTicketTabLabel", "updateTrackerSummary"];

export function mountNcrPlanner(__root, __data, __hooks, __savedLocal) {
const __state = { attActive: null };

// ═══════════════════════════════════════════════════════
//  DATA
// ═══════════════════════════════════════════════════════
let ALL_DCS = __data.dcs;
let OPEN_TICKETS = __data.tickets;

// Build lookup maps
let DC_MAP = {};
ALL_DCS.forEach(dc => { DC_MAP[dc.c] = dc; });

// Mutable set of excluded ticket IDs
const excludedTickets = new Set();

// Manual reassignment overrides: ticketId → techIndex (0-based)
// Manual assignments: ticketId → technician _id. Mirrors ticket.assignedTechnicianId in the database.
const manualOverrides = {};

function reassignTicket(ticketId, techIdx) {
  // techIdx is a position in TODAY's working list (the dropdown), not in the full team
  const tech = (techIdx === '' || techIdx === null || !lastAssignment) ? null : lastAssignment.techs[parseInt(techIdx)];
  if(!tech) {
    delete manualOverrides[ticketId];
  } else {
    manualOverrides[ticketId] = tech._id;
  }
  __hooks.onReassign && __hooks.onReassign(ticketId, tech ? { _id: tech._id, name: tech.name } : null);
  rebuild();
  if(currentView === 'tickets') buildTicketDashboard(tktFilter);
}

// Ticket → DC coords lookup (static, all tickets)
const TICKET_DC_COORDS = {};
OPEN_TICKETS.forEach(t => {
  const dc = DC_MAP[t.center];
  if (dc) TICKET_DC_COORDS[t.ticket] = { lat: dc.lat, lon: dc.lon, dc: t.center };
});

// Reactive derived structures — call recomputeTicketData() after toggling exclusions
let TICKETS_BY_DC = {};
let ACTIVE_DCS = [];

function recomputeTicketData() {
  TICKETS_BY_DC = {};
  OPEN_TICKETS.forEach(t => {
    if (excludedTickets.has(t.ticket)) return;
    if (!TICKETS_BY_DC[t.center]) TICKETS_BY_DC[t.center] = [];
    TICKETS_BY_DC[t.center].push(t);
  });
  ACTIVE_DCS = Object.keys(TICKETS_BY_DC);
}
recomputeTicketData();

function toggleTicket(ticketId) {
  if (excludedTickets.has(ticketId)) excludedTickets.delete(ticketId);
  else excludedTickets.add(ticketId);
  __saveLocal();
  recomputeTicketData();
  rebuild();
  buildTicketDashboard(tktFilter);
}

function restoreAllTickets() {
  excludedTickets.clear();
  __saveLocal();
  recomputeTicketData();
  rebuild();
  buildTicketDashboard(tktFilter);
  updateTicketTabLabel();
}

// Tech colors
const TECH_COLORS = [
  '#E63946','#2196F3','#FF9800','#4CAF50','#9C27B0',
  '#00BCD4','#FF5722','#607D8B','#8BC34A','#F06292',
  '#03A9F4','#CDDC39'
];

// Real L3 Technicians with home base coordinates
// Zone is used to bias cluster assignment toward their area
let REAL_TECHS = __data.techs.map(t => ({ ...t, zones2: t.zones2 || [t.zone] }));

let TECH_AVATARS = REAL_TECHS.map(t => t.name.slice(0,2).toUpperCase());

// ═══════════════════════════════════════════════════════
//  MATH UTILITIES
// ═══════════════════════════════════════════════════════

function haversineKm(a, b) {
  const R=6371, t=Math.PI/180;
  const dlat=(b.lat-a.lat)*t, dlon=(b.lon-a.lon)*t;
  const x=Math.sin(dlat/2)**2+Math.cos(a.lat*t)*Math.cos(b.lat*t)*Math.sin(dlon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

// Convert lat/lon to flat x/y in km (using reference point)
const REF = { lat: 28.57, lon: 77.18 }; // NCR center
function toXY(dc) {
  const kmPerDegLat = 111.0;
  const kmPerDegLon = 111.0 * Math.cos(REF.lat * Math.PI / 180);
  return {
    x: (dc.lon - REF.lon) * kmPerDegLon,
    y: (dc.lat - REF.lat) * kmPerDegLat
  };
}

// ═══════════════════════════════════════════════════════
//  HEXAGONAL GRID CLUSTERING
// ═══════════════════════════════════════════════════════

function latLonToHex(lat, lon, hexRadius) {
  // Convert to flat XY, then to hex grid coordinates
  const kmPerDegLat = 111.0;
  const kmPerDegLon = 111.0 * Math.cos(REF.lat * Math.PI / 180);
  const x = (lon - REF.lon) * kmPerDegLon;
  const y = (lat - REF.lat) * kmPerDegLat;
  
  // Axial hex coordinates
  const q = (2/3 * x) / hexRadius;
  const r = (-1/3 * x + Math.sqrt(3)/3 * y) / hexRadius;
  
  // Round to nearest hex
  let qr = Math.round(q), rr = Math.round(r), sr = Math.round(-q-r);
  const dq=Math.abs(qr-q), dr=Math.abs(rr-r), ds=Math.abs(sr-(-q-r));
  if(dq>dr&&dq>ds) qr=-rr-sr;
  else if(dr>ds) rr=-qr-sr;
  return `${qr},${rr}`;
}

function hexCenter(q, r, hexRadius) {
  const kmPerDegLat = 111.0;
  const kmPerDegLon = 111.0 * Math.cos(REF.lat * Math.PI / 180);
  const x = hexRadius * (3/2 * q);
  const y = hexRadius * (Math.sqrt(3)/2 * q + Math.sqrt(3) * r);
  return {
    lat: REF.lat + y / kmPerDegLat,
    lon: REF.lon + x / kmPerDegLon
  };
}

function hexVertices(centerLat, centerLon, hexRadius) {
  const kmPerDegLat = 111.0;
  const kmPerDegLon = 111.0 * Math.cos(REF.lat * Math.PI / 180);
  const pts = [];
  for(let i=0; i<6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30);
    const dx = hexRadius * Math.cos(angle);
    const dy = hexRadius * Math.sin(angle);
    pts.push([centerLat + dy/kmPerDegLat, centerLon + dx/kmPerDegLon]);
  }
  return pts;
}

function buildHexClusters(hexRadius) {
  const clusters = {};
  // Only visit DCs that have at least one active (non-excluded) open ticket
  const ticketDCs = ALL_DCS.filter(dc => (TICKETS_BY_DC[dc.c] || []).length > 0);
  ticketDCs.forEach(dc => {
    const key = latLonToHex(dc.lat, dc.lon, hexRadius);
    if(!clusters[key]) {
      clusters[key] = { key, dcs: [], tickets: [], hexKey: key };
    }
    clusters[key].dcs.push(dc);
    const dcTickets = TICKETS_BY_DC[dc.c] || [];
    clusters[key].tickets.push(...dcTickets);
  });
  
  // Add hex center coords
  Object.keys(clusters).forEach(key => {
    const [q,r] = key.split(',').map(Number);
    const center = hexCenter(q, r, hexRadius);
    clusters[key].centerLat = center.lat;
    clusters[key].centerLon = center.lon;
    clusters[key].q = q;
    clusters[key].r = r;
  });
  
  return Object.values(clusters);
}

// ═══════════════════════════════════════════════════════
//  ROUTE OPTIMIZER (nearest-neighbor + 2-opt)
// ═══════════════════════════════════════════════════════

function nearestNeighbor(dcs) {
  if(dcs.length <= 1) return dcs.slice();
  const visited = new Set([0]);
  const route = [dcs[0]];
  while(route.length < dcs.length) {
    const last = route[route.length-1];
    let bestIdx=-1, bestDist=Infinity;
    dcs.forEach((dc, i) => {
      if(!visited.has(i)) {
        const d = haversineKm({lat:last.lat,lon:last.lon},{lat:dc.lat,lon:dc.lon});
        if(d < bestDist) { bestDist=d; bestIdx=i; }
      }
    });
    visited.add(bestIdx);
    route.push(dcs[bestIdx]);
  }
  return route;
}

function routeDistance(route) {
  let d=0;
  for(let i=1;i<route.length;i++) d+=haversineKm({lat:route[i-1].lat,lon:route[i-1].lon},{lat:route[i].lat,lon:route[i].lon});
  return d;
}

function twoOpt(route) {
  if(route.length < 4) return route;
  let best = route.slice(), improved = true;
  while(improved) {
    improved = false;
    for(let i=0;i<best.length-1;i++) {
      for(let j=i+2;j<best.length;j++) {
        const newRoute = best.slice(0,i+1).concat(best.slice(i+1,j+1).reverse(),best.slice(j+1));
        if(routeDistance(newRoute) < routeDistance(best)-0.001) { best=newRoute; improved=true; }
      }
    }
  }
  return best;
}

function calcRouteTime(route, params) {
  const speed = params.speed, svcMin = params.svc;
  let totalKm = routeDistance(route);
  let driveMin = totalKm / speed * 60;
  let serviceMin = route.length * svcMin;
  // Extra time for DCs with multiple tickets
  route.forEach(dc => {
    const tks = TICKETS_BY_DC[dc.c] || [];
    if(tks.length > 1) serviceMin += (tks.length - 1) * 15;
  });
  return { totalKm: Math.round(totalKm*10)/10, totalMin: Math.round(driveMin+serviceMin), driveMin: Math.round(driveMin), serviceMin: Math.round(serviceMin) };
}

// ═══════════════════════════════════════════════════════
//  TECHNICIAN ASSIGNMENT
// ═══════════════════════════════════════════════════════

function assignTechnicians(numTechs, params) {
  const hexRadius = params.hexRadius;
  const clusters = buildHexClusters(hexRadius);
  const shiftMinutes = params.shift * 60;
  
  // Sort clusters by number of tickets DESC, then DCs DESC
  clusters.sort((a,b) => (b.tickets.length - a.tickets.length) || (b.dcs.length - a.dcs.length));
  
  // Use real named technicians, filtered by attendance
  // If attendance has been applied, respect absent flags; otherwise use slider
  let activeTechs;
  if(__state.attActive && __state.attActive.length > 0) {
    activeTechs = __state.attActive
      .filter(i => i < REAL_TECHS.length)
      .map(i => REAL_TECHS[i]);
    // Half-day: reduce shift for those techs (applied via params override below)
  } else {
    activeTechs = REAL_TECHS.slice(0, numTechs);
  }
  const techs = activeTechs.map((rt, i) => {
    // Find original index in REAL_TECHS for attendance lookup
    const origIdx = REAL_TECHS.indexOf(rt);
    const attStatus = (attendance[origIdx]||{}).status || 'present';
    const timeIn = (attendance[origIdx]||{}).timeIn || '09:00';
    // Half-day: halve the shift; also adjust shift start for late arrivals
    let shiftMins = params.shift * 60;
    if(attStatus === 'halfday') shiftMins = Math.floor(shiftMins / 2);
    // Late arrival penalty: reduce available shift by late minutes
    const [inH, inM] = timeIn.split(':').map(Number);
    const lateMin = Math.max(0, (inH*60+inM) - 9*60); // later than 9 AM
    shiftMins = Math.max(0, shiftMins - lateMin);

    return {
      id: i+1,
      _id: rt._id,
      color: TECH_COLORS[i % TECH_COLORS.length],
      name: rt.name,
      zone: rt.zone,
      zones2: rt.zones2 || [rt.zone],
      homeLat: rt.homeLat,
      homeLon: rt.homeLon,
      attStatus,
      timeIn,
      shiftMins,
      clusters: [], dcs: [], tickets: [], totalMin: 0
    };
  });
  
  // Greedy assignment: balanced load first, proximity as soft tiebreaker
  // Normalise ticket count across all clusters for scoring
  const maxTickets = Math.max(1, ...clusters.map(c => c.tickets.length));
  const totalClusters = clusters.length;

  clusters.forEach((cluster, clIdx) => {
    let bestTech = null, bestScore = -Infinity;

    techs.forEach(tech => {
      // ── 1. Load balance: prefer tech with fewest tickets so far ──
      // Express as fraction of fair share: each tech should get ~totalClusters/numTechs clusters
      const fairShare = totalClusters / techs.length;
      const overloaded = tech.clusters.length / Math.max(fairShare, 1); // 0=empty, 1=full, >1=overloaded
      const loadScore = (1 - overloaded) * 100; // dominant term

      // ── 2. Capacity: skip if shift is full ──
      const estTime = cluster.dcs.length * params.svc +
        (cluster.dcs.length > 1 ? routeDistance(cluster.dcs.map(d=>({lat:d.lat,lon:d.lon}))) / params.speed * 60 : 0);
      const available = (tech.shiftMins || shiftMinutes) - tech.totalMin;
      if(available < estTime * 0.3) return; // skip truly full techs

      // ── 3. Proximity: home base distance (soft tiebreaker, capped) ──
      const homeDist = haversineKm(
        {lat: tech.homeLat, lon: tech.homeLon},
        {lat: cluster.centerLat, lon: cluster.centerLon}
      );
      const proximityScore = Math.min(15, 15 / (1 + homeDist * 0.15)); // max 15 pts

      // ── 4. Continuity: prefer techs already nearby ──
      let continuityScore = 0;
      if(tech.clusters.length > 0) {
        const last = tech.clusters[tech.clusters.length - 1];
        const d = haversineKm(
          {lat: last.centerLat, lon: last.centerLon},
          {lat: cluster.centerLat, lon: cluster.centerLon}
        );
        continuityScore = Math.min(10, 10 / (1 + d * 0.2)); // max 10 pts
      }

      const score = loadScore + proximityScore + continuityScore;
      if(score > bestScore) { bestScore = score; bestTech = tech; }
    });

    // Fallback: if all techs are full, give to least loaded
    if(!bestTech) {
      bestTech = techs.reduce((a, b) => a.totalMin <= b.totalMin ? a : b);
    }

    if(bestTech) {
      bestTech.clusters.push(cluster);
      bestTech.dcs.push(...cluster.dcs);
      bestTech.tickets.push(...cluster.tickets);
      const estKm = cluster.dcs.length > 1 ? routeDistance(cluster.dcs.map(d=>({lat:d.lat,lon:d.lon}))) : 0;
      bestTech.totalMin += cluster.dcs.length * params.svc + estKm / params.speed * 60;
    }
  });
  
  // ── Apply manual overrides ──
  // For each overridden ticket, move it (and its DC if no other tickets remain there) 
  // from its auto-assigned tech to the chosen tech.
  Object.entries(manualOverrides).forEach(([ticketId, techId]) => {
    const targetTech = techs.find(t => t._id === techId);
    if(!targetTech) return; // assigned tech isn't working today → plan it automatically
    const ticket = OPEN_TICKETS.find(t => t.ticket === ticketId);
    if(!ticket || excludedTickets.has(ticketId)) return;

    // Remove from current owner
    techs.forEach(tech => {
      const tIdx = tech.tickets.findIndex(t => t.ticket === ticketId);
      if(tIdx === -1) return;
      tech.tickets.splice(tIdx, 1);
      // If DC has no more tickets under this tech, remove the DC too
      const dcName = ticket.center;
      const dcStillNeeded = tech.tickets.some(t => t.center === dcName);
      if(!dcStillNeeded) {
        const dIdx = tech.dcs.findIndex(d => d.c === dcName);
        if(dIdx !== -1) tech.dcs.splice(dIdx, 1);
      }
    });

    // Add to target tech
    targetTech.tickets.push(ticket);
    const dcObj = DC_MAP[ticket.center];
    if(dcObj && !targetTech.dcs.some(d => d.c === ticket.center)) {
      targetTech.dcs.push(dcObj);
    }
  });

  // ── Optimize routes within each tech's DCs ──
  techs.forEach(tech => {
    if(tech.dcs.length > 1) {
      const dcsMapped = tech.dcs.map(dc => ({...dc}));
      const nn = nearestNeighbor(dcsMapped);
      tech.route = twoOpt(nn);
    } else {
      tech.route = tech.dcs.slice();
    }
    tech.routeStats = calcRouteTime(tech.route, params);
  });
  
  return { techs, clusters };
}

// ═══════════════════════════════════════════════════════
//  SPARE VEHICLE OPTIMIZER
// ═══════════════════════════════════════════════════════

function findOptimalSpareHubs() {
  // 1 spare vehicle per 20 vehicles in the fleet
  const totalVehicles = ALL_DCS.reduce((s, dc) => s + (dc.v || []).length, 0);
  const numSpares = Math.max(1, Math.ceil(totalVehicles / 20));

  const activeDCPoints = ACTIVE_DCS.map(name => DC_MAP[name]).filter(Boolean);
  if(activeDCPoints.length === 0) return { hubs: [], totalVehicles, numSpares };

  // Score every DC as a candidate hub: minimize avg dist to uncovered ticket DCs
  // Use greedy k-medoid: pick hubs one by one, each covering nearest ticket DCs
  const hubs = [];
  let uncovered = activeDCPoints.slice();

  for(let h = 0; h < numSpares; h++) {
    let bestDC = null, bestScore = Infinity;
    ALL_DCS.forEach(cand => {
      let totalDist = 0;
      uncovered.forEach(dc => {
        totalDist += haversineKm({lat:cand.lat,lon:cand.lon},{lat:dc.lat,lon:dc.lon});
      });
      const avgDist = uncovered.length > 0 ? totalDist / uncovered.length : 0;
      const vehicleBonus = (cand.v || []).length * 1.5;
      const score = avgDist - vehicleBonus;
      if(score < bestScore) { bestScore = score; bestDC = cand; }
    });
    if(!bestDC) break;

    // Assign each ticket DC to its nearest hub (for coverage stats)
    const dists = uncovered.map(dc => haversineKm({lat:bestDC.lat,lon:bestDC.lon},{lat:dc.lat,lon:dc.lon}));
    const avgDist = dists.length ? dists.reduce((s,d)=>s+d,0)/dists.length : 0;
    const maxDist = dists.length ? Math.max(...dists) : 0;
    const within15 = dists.filter(d=>d<=15).length;
    const vehiclesAtHub = (bestDC.v || []).length;

    hubs.push({
      dc: bestDC,
      avgDist: Math.round(avgDist*10)/10,
      maxDist: Math.round(maxDist*10)/10,
      within15,
      vehiclesAtHub,
      hubNumber: h + 1
    });

    // Remove covered DCs (those closest to this hub vs remaining)
    // Simple: remove DCs within avg radius of this hub to spread coverage
    const coverRadius = Math.max(avgDist, 10);
    uncovered = uncovered.filter(dc =>
      haversineKm({lat:bestDC.lat,lon:bestDC.lon},{lat:dc.lat,lon:dc.lon}) > coverRadius
    );
    if(uncovered.length === 0) break;
  }

  return { hubs, totalVehicles, numSpares };
}

// ═══════════════════════════════════════════════════════
//  MAP SETUP
// ═══════════════════════════════════════════════════════
let map, hexLayer, routeLayer, dcLayer, spareLayer, homeLayer, activeHexLayers={};

function initMap() {
  map = L.map(__root.querySelector('#map'), { zoomSnap:.5, maxZoom:18 });
  
  const tiles = {
    'Streets': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'&copy; Esri'}),
    'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:18,attribution:'&copy; Esri'}),
    'OSM': L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:19,attribution:'&copy; OpenStreetMap, CARTO'})
  };
  tiles['Streets'].addTo(map);
  L.control.layers(tiles, {}, {position:'topright'}).addTo(map);
  L.control.scale({imperial:false}).addTo(map);
  
  hexLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  dcLayer = L.layerGroup().addTo(map);
  spareLayer = L.layerGroup().addTo(map);
  homeLayer = L.layerGroup().addTo(map);
  drawHomeMarkers();
  
  map.fitBounds([[28.18, 76.87], [28.85, 77.65]]);
}

function drawHexClusters(clusters, techAssignment) {
  hexLayer.clearLayers();
  
  // Build cluster→tech map
  const clusterTechMap = {};
  techAssignment.techs.forEach(tech => {
    tech.clusters.forEach(cl => {
      clusterTechMap[cl.key] = tech;
    });
  });
  
  clusters.forEach(cluster => {
    const tech = clusterTechMap[cluster.key];
    const color = tech ? tech.color : '#999';
    const hasTickets = cluster.tickets.length > 0;
    
    const verts = hexVertices(cluster.centerLat, cluster.centerLon, currentParams().hexRadius);
    const poly = L.polygon(verts, {
      color: color, fillColor: color,
      weight: hasTickets ? 2.5 : 1,
      opacity: hasTickets ? 0.9 : 0.35,
      fillOpacity: hasTickets ? 0.18 : 0.06,
      dashArray: tech ? null : '4 4'
    });
    
    if(hasTickets) {
      const techNum = tech ? tech.id : '?';
      poly.bindTooltip(`Cluster · Tech ${techNum} · ${cluster.dcs.length} DCs · ${cluster.tickets.length} tickets`, {sticky:true});
    }
    
    hexLayer.addLayer(poly);
  });
}

function drawHomeMarkers() {
  homeLayer.clearLayers();
  REAL_TECHS.forEach((t, i) => {
    const color = TECH_COLORS[i % TECH_COLORS.length];
    const initials = t.name.slice(0,2).toUpperCase();
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:26px;height:26px;background:${color};border:2px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.3);">
               <span style="transform:rotate(45deg);color:#fff;font-size:8px;font-weight:800;">${initials}</span>
             </div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 26]
    });
    const m = L.marker([t.homeLat, t.homeLon], { icon });
    m.bindTooltip(`🏠 ${t.name} · ${t.zone}`, { direction:'top', offset:[0,-28] });
    m.bindPopup(`<div class="mpop"><h3 style="color:${color}">🏠 ${t.name}</h3><div class="mpop-meta">${t.zone}</div><div style="margin-top:4px;font-size:11px;color:#555;">Home base · ${t.homeLat.toFixed(4)}, ${t.homeLon.toFixed(4)}</div></div>`);
    homeLayer.addLayer(m);
  });
}

function drawDCMarkers(techAssignment) {
  dcLayer.clearLayers();

  // Build tech color lookup
  const dcTechColor = {};
  techAssignment.techs.forEach(tech => {
    tech.dcs.forEach(d => { dcTechColor[d.c] = tech.color; });
  });

  // Only draw DCs that have at least one active open ticket
  ALL_DCS.forEach(dc => {
    const tks = TICKETS_BY_DC[dc.c] || [];
    if(tks.length === 0) return; // skip DCs with no open tickets

    const techColor = dcTechColor[dc.c] || '#6B7280';
    const sz = 18 + Math.min(tks.length - 1, 3) * 4;
    // Determine aggregate ticket status for this DC
    const dcStatuses = tks.map(t => (ticketStatus[t.ticket]||{}).status || 'assigned');
    const allClosed  = dcStatuses.every(s=>s==='closed');
    const anyClosed  = dcStatuses.some(s=>s==='closed');
    const anyVisited = dcStatuses.some(s=>s==='visited');
    const markerBg   = allClosed ? '#10B981' : anyVisited ? '#F59E0B' : techColor;
    const markerBorder = allClosed ? '#065F46' : anyVisited ? '#92400E' : '#fff';
    const statusOverlay = allClosed ? '✓' : anyVisited ? '👁' : tks.length;
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:${sz}px;height:${sz}px;background:${markerBg};border:2.5px solid ${markerBorder};border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:${allClosed||anyVisited?11:10}px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.35);${allClosed?'opacity:.7':''}">${statusOverlay}</div>`,
      iconSize: [sz, sz], iconAnchor: [sz/2, sz/2]
    });
    const m = L.marker([dc.lat, dc.lon], {icon});

    const days = d => d.breakdown_date ? Math.floor((Date.now()-new Date(d.breakdown_date))/86400000) : 0;
    const tkRows = tks.map(t => {
      const d = days(t);
      const ageCol = d>=7?'#DC2626':d>=3?'#D97706':'#16A34A';
      return `<div class="tk" style="border-top:1px solid #eee;padding:5px 0;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <b style="font-size:11px;color:#0E6B6E;">${t.ticket}</b>
          <span style="font-size:10px;font-weight:700;color:${ageCol};background:${ageCol}18;padding:1px 5px;border-radius:6px;">${d}d</span>
        </div>
        <div style="font-size:12px;font-weight:600;margin-top:2px;">🚲 ${t.vehicle}</div>
        <div style="font-size:11px;color:#555;margin-top:1px;">${t.category||'—'} · ${t.issue_type||'—'}</div>
        <div style="font-size:11px;color:#777;margin-top:1px;">${t.issue}</div>
        <div style="font-size:10px;color:#999;margin-top:1px;">📅 ${t.breakdown_date||'—'}</div>
      </div>`;
    }).join('');

    const assignedTo = techAssignment.techs.find(tech => tech.dcs.some(d=>d.c===dc.c));
    m.bindPopup(`<div class="mpop">
      <h3>${dc.c.replace(/_/g,' ').replace(/ D$/,'').replace(/ NDC$/,'').trim()}</h3>
      <div class="mpop-meta">${dc.city} · ${tks.length} open ticket${tks.length>1?'s':''}${assignedTo?` · <b style="color:${assignedTo.color}">${assignedTo.name}</b>`:''}</div>
      ${tkRows}
    </div>`, {maxWidth:300});
    dcLayer.addLayer(m);
  });
}

function drawRoutes(techAssignment) {
  routeLayer.clearLayers();
  
  techAssignment.techs.forEach(tech => {
    if(!tech.route || tech.route.length < 2) return;
    const coords = tech.route.map(dc => [dc.lat, dc.lon]);
    const line = L.polyline(coords, {
      color: tech.color, weight: 2.5, opacity: .75, dashArray: '6 4'
    });
    routeLayer.addLayer(line);
    
    // Numbered stop markers on route
    tech.route.forEach((dc, idx) => {
      const tks = TICKETS_BY_DC[dc.c] || [];
      const hasTk = tks.length > 0;
      if(!hasTk) return; // Only mark DCs with tickets in route labels
      const icon = L.divIcon({
        className:'',
        html:`<div style="position:absolute;top:-10px;left:8px;background:${tech.color};color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:10px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3)">T${tech.id}-${idx+1}</div>`,
        iconSize:[1,1], iconAnchor:[0,0]
      });
      routeLayer.addLayer(L.marker([dc.lat,dc.lon],{icon}));
    });
  });
}

function drawSpare(spareResult) {
  spareLayer.clearLayers();
  if(!spareResult || !spareResult.hubs || spareResult.hubs.length === 0) return;

  const hubColors = ['#D97706','#7C3AED','#0891B2','#059669','#DC2626','#DB2777'];

  spareResult.hubs.forEach((hub, i) => {
    const dc = hub.dc;
    const color = hubColors[i % hubColors.length];

    // Coverage circle
    L.circle([dc.lat, dc.lon], {
      radius: hub.avgDist * 1000,
      color: color,
      fillColor: color,
      fillOpacity: 0.07,
      weight: 1.5,
      dashArray: '6,4'
    }).addTo(spareLayer);

    // Marker
    const icon = L.divIcon({
      className: '',
      html: `<div style="background:${color};border:3px solid #fff;padding:4px 8px;border-radius:8px;color:#fff;font-size:10.5px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.4);">🚐 SPARE ${hub.hubNumber}</div>`,
      iconAnchor: [36, 14]
    });
    const m = L.marker([dc.lat, dc.lon], {icon});
    m.bindPopup(`<div class="mpop">
      <h3 style="color:${color}">🚐 Spare Hub ${hub.hubNumber}</h3>
      <div class="mpop-meta">${dc.c.replace(/_/g,' ').replace(/ D$/,'').replace(/ NDC$/,'').trim()} · ${dc.city}</div>
      <div style="margin-top:6px;font-size:12px;line-height:1.8;">
        🚲 Vehicles at DC: <b>${hub.vehiclesAtHub}</b><br>
        📍 Avg dist to ticket DCs: <b>${hub.avgDist} km</b><br>
        📍 Farthest ticket DC: <b>${hub.maxDist} km</b><br>
        ✅ DCs within 15 km: <b>${hub.within15}</b>
      </div>
    </div>`);
    m.addTo(spareLayer);
  });
}

// ═══════════════════════════════════════════════════════
//  UI RENDERING
// ═══════════════════════════════════════════════════════

function currentParams() {
  return {
    shift: parseFloat(document.getElementById('p-shift').value) || 8,
    speed: parseFloat(document.getElementById('p-speed').value) || 20,
    svc: parseFloat(document.getElementById('p-svc').value) || 45,
    hexRadius: parseFloat(document.getElementById('p-hex').value) || 8,
  };
}

function buildRoster(techAssignment) {
  const roster = document.getElementById('roster');
  roster.innerHTML = '';
  
  // Update hex legend
  const legend = document.getElementById('hex-legend');
  legend.innerHTML = techAssignment.techs.map((tech,i) => {
    const active = tech.clusters.length > 0;
    const displayName = tech.name || `Tech ${tech.id}`;
    return `<span class="hex-chip ${active?'active':''}" style="color:${tech.color};border-color:${tech.color};background:${tech.color}18;" onclick="focusTech(${tech.id})">
      <span class="hex-dot" style="background:${tech.color}"></span>
      ${displayName} (${tech.tickets.length}🎫)
    </span>`;
  }).join('');
  
  // Build roster cards
  techAssignment.techs.forEach((tech, i) => {
    const card = document.createElement('div');
    card.className = 'tech-card';
    card.id = `tech-card-${tech.id}`;
    
    const hasWork = tech.route && tech.route.length > 0;
    const busyPct = Math.min(100, Math.round(tech.totalMin / (currentParams().shift*60) * 100));
    
    // Build route list
    let routeRows = '';
    if(hasWork && tech.route) {
      tech.route.forEach((dc, stopIdx) => {
        const tks = TICKETS_BY_DC[dc.c] || [];
        // All stops now have tickets — only ticket DCs are routed
        const urgencyColor = (tks) => {
          if(!tks.length) return '#9CA3AF';
          const d = tks[0].breakdown_date;
          const days = d ? Math.floor((Date.now()-new Date(d))/(86400000)) : 0;
          return days >= 7 ? '#DC2626' : days >= 3 ? '#D97706' : '#16A34A';
        };
        routeRows += `<div class="ticket-row" onclick="flyToDC(${dc.lat},${dc.lon})">
          <div style="display:flex;align-items:flex-start;gap:8px;">
            <div style="min-width:22px;height:22px;background:${tech.color};border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:700;flex-shrink:0;margin-top:1px;">${stopIdx+1}</div>
            <div style="flex:1;min-width:0;">
              <div class="tr-dc" style="font-weight:700;font-size:12.5px;">${dc.c.replace(/_/g,' ').replace(/ D$/,'').replace(/ NDC$/,'').trim()}</div>
              ${tks.length > 0 ? tks.map(tk => {
                const days = tk.breakdown_date ? Math.floor((Date.now()-new Date(tk.breakdown_date))/(86400000)) : 0;
                const ageColor = days >= 7 ? '#DC2626' : days >= 3 ? '#D97706' : '#16A34A';
                const catIcon = tk.category==='Break Down'?'🔴':tk.category==='Accidental'?'⚠️':tk.category==='Running Repair'?'🔧':'📋';
                const severity = ({Minor:'🟡 Minor',Medium:'🟠 Medium',Major:'🔴 Major'})[tk.issue_type] || (tk.issue_type||'');
                return `<div style="margin-top:5px;padding:8px 10px;background:${tech.color}10;border-left:3px solid ${tech.color};border-radius:0 6px 6px 0;">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;">
                    <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--accent);font-weight:600;">${tk.ticket}${tk.month_rep>1?` <span style="color:var(--red);font-size:9px;">🔁${tk.month_rep}x</span>`:''}</span>
                    <div style="display:flex;align-items:center;gap:5px;">
                      <span style="font-size:10px;font-weight:600;color:${ageColor};background:${ageColor}18;padding:1px 6px;border-radius:8px;">${days}d</span>
                      <span style="font-size:9px;font-weight:700;color:${tk.tat_breach==='YES'?'var(--red)':'var(--green)'};">${tk.tat_breach==='YES'?'🔴 BREACH':tk.tat_breach==='NO'?'✅':''}</span>
                      <button onclick="event.stopPropagation();toggleTicket('${tk.ticket}')" style="font-size:9.5px;font-weight:700;padding:2px 7px;border-radius:6px;border:none;cursor:pointer;background:var(--red2);color:var(--red);">🚫</button>
                    </div>
                  </div>
                  <div style="margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span style="font-size:11.5px;font-weight:700;color:var(--text);">🚲 ${tk.vehicle}</span>
                    <span style="font-size:10.5px;font-weight:600;color:var(--text2);">${catIcon} ${tk.category||'—'}</span>
                    <span style="font-size:10px;color:var(--text3);">${severity}</span>
                  </div>
                  <div style="margin-top:4px;font-size:11.5px;color:var(--text2);line-height:1.4;">${tk.issue}</div>
                  <div style="margin-top:3px;font-size:10px;color:var(--text3);line-height:1.7;">
                    📅 ${tk.breakdown_date||'—'} · ⏱ ${tk.downtime||0}d · 🪣 ${tk.bucket||'—'}
                    ${tk.penalty_cost>0?`<br>💰 Penalty: ₹${tk.penalty_cost} (${tk.penalty_days}d)`:''}
                    ${tk.affected_spare?`· 🔧 ${tk.affected_spare}`:''}
                    ${tk.quotation>0?`<br>💼 Quotation: ₹${tk.quotation} ${tk.ev_remark?'· '+tk.ev_remark:''}`:''}
                    ${tk.stm?`<br>👤 STM: <b>${tk.stm}</b>${tk.sm?' · SM: <b>'+tk.sm+'</b>':''}`:''}
                  </div>
                  ${reassignDropdownHTML(tk.ticket, techAssignment.techs.indexOf(tech), techAssignment.techs)}
                </div>`;
              }).join('') : '<div style="font-size:11px;color:var(--text3);margin-top:2px;padding:4px 0;">✅ No open tickets · patrol stop</div>'}
            </div>
          </div>
        </div>`;
      });
    }
    
    card.innerHTML = `
      <div class="tech-card-hdr" onclick="toggleCard(${tech.id})">
        <div class="tech-avatar" style="background:${tech.color}20;color:${tech.color}">${TECH_AVATARS[i]}</div>
        <div class="tech-info">
          <div class="tech-name" style="color:${tech.color}">${tech.name || 'Tech '+tech.id}
            ${tech.attStatus==='halfday' ? `<span style="font-size:9px;background:var(--amb2);color:var(--amber);padding:1px 5px;border-radius:4px;font-weight:700;margin-left:3px;">½ HALF DAY</span>` : ''}
            ${tech.zones2 && tech.zones2.length > 1
              ? `<span style="font-size:10px;font-weight:400;opacity:.7">· ${tech.zones2[0]} <span style="background:${tech.color};color:#fff;padding:0px 4px;border-radius:4px;font-size:9px;margin:0 2px;">+1</span> ${tech.zones2[1]}</span>`
              : `<span style="font-size:10px;font-weight:400;opacity:.7">· ${tech.zone||''}</span>`
            }</div>
          <div class="tech-meta">
            <span>📍 ${tech.route?.length || 0} stops</span>
            <span>🎫 ${tech.tickets.length} tickets</span>
            ${tech.routeStats ? `<span>🛣 ${tech.routeStats.totalKm} km</span>` : ''}
            ${tech.routeStats ? `<span>⏱ ${Math.round(tech.routeStats.totalMin/60*10)/10}h</span>` : ''}
          </div>
          <div style="margin-top:5px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${busyPct}%;background:${tech.color};border-radius:2px;transition:width .3s;"></div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;">
          <span class="tech-badge" style="background:${tech.color}20;color:${tech.color}">${busyPct}%</span>
          <span class="tech-expand" id="expand-${tech.id}">›</span>
        </div>
      </div>
      <div class="tech-body" id="body-${tech.id}">
        <div class="route-header">
          <span>🗺 Route order (tap to fly to DC)</span>
          <span style="margin-left:auto;">${tech.routeStats ? tech.routeStats.totalKm+' km · '+Math.round(tech.routeStats.totalMin)+'m' : ''}</span>
        </div>
        ${routeRows || '<div style="padding:12px;color:var(--text3);font-size:12px;">No DCs assigned in this shift</div>'}
      </div>`;
    
    roster.appendChild(card);
  });
}

function toggleCard(id) {
  const body = document.getElementById('body-'+id);
  const expand = document.getElementById('expand-'+id);
  body.classList.toggle('open');
  if(expand) expand.classList.toggle('open');
}

function focusTech(id) {
  // Expand that tech card
  const body = document.getElementById('body-'+id);
  const expand = document.getElementById('expand-'+id);
  if(body && !body.classList.contains('open')) {
    body.classList.add('open');
    if(expand) expand.classList.add('open');
  }
  document.getElementById('tech-card-'+id)?.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function flyToDC(lat, lon) {
  map.flyTo([lat, lon], 15, {duration:0.8});
}

// ═══════════════════════════════════════════════════════
//  MAIN REBUILD
// ═══════════════════════════════════════════════════════

let lastAssignment = null;

function rebuild() {
  const numTechs = parseInt(document.getElementById('tech-slider').value);
  const params = currentParams();
  
  const assignment = assignTechnicians(numTechs, params);
  lastAssignment = assignment;
  
  // Show active tech names
  const recTechs = Math.ceil(ACTIVE_DCS.length / 4);
  const activeNames = REAL_TECHS.slice(0, numTechs).map(t=>t.name).join(', ');
  document.getElementById('rec-tech').textContent = numTechs === REAL_TECHS.length ? 'Full team' : `Rec: ${recTechs}`;
  
  // Update topbar stats
  document.getElementById('stat-techs').textContent = numTechs;
  const activeTicketCount = OPEN_TICKETS.length - excludedTickets.size;
  document.getElementById('stat-tickets').textContent = activeTicketCount;
  const sub = document.getElementById('topbar-sub');
  if(sub) sub.textContent = `${numTechs} Technician${numTechs>1?'s':''} • ${activeTicketCount} Active Tickets • Delhi NCR`;
  document.getElementById('stat-clusters').textContent = assignment.clusters.length;
  
  // Summary
  const totalDCsAssigned = assignment.techs.reduce((s,t)=>s+t.dcs.length,0);
  const totalTickets = assignment.techs.reduce((s,t)=>s+t.tickets.length,0);
  const ticketDCCount = ACTIVE_DCS.length || 1;
  const coverage = Math.round(totalDCsAssigned / ticketDCCount * 100);
  document.getElementById('sg-assigned').textContent = totalDCsAssigned;
  document.getElementById('sg-tickets').textContent = totalTickets;
  document.getElementById('sg-coverage').textContent = coverage+'%';
  
  // Spare vehicle
  const spare = findOptimalSpareHubs();
  const hubColors = ['#D97706','#7C3AED','#0891B2','#059669','#DC2626','#DB2777'];
  document.getElementById('spare-ratio').textContent = `· ${spare.totalVehicles} vehicles → ${spare.numSpares} spare${spare.numSpares>1?'s':''}`;
  document.getElementById('spare-hubs-list').innerHTML = spare.hubs.map((h,i) =>
    `<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
      <span style="background:${hubColors[i%hubColors.length]};color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;white-space:nowrap;">HUB ${h.hubNumber}</span>
      <span style="font-weight:600;color:var(--text);">${h.dc.c.replace(/_/g,' ').replace(/ D$/,'').replace(/ NDC$/,'').trim()}</span>
      <span style="font-size:10px;color:var(--text3);">(${h.dc.city})</span>
    </div>`
  ).join('') || 'No active ticket DCs';
  document.getElementById('spare-meta').textContent = spare.hubs.length > 0
    ? `Avg coverage radius ${(spare.hubs.reduce((s,h)=>s+h.avgDist,0)/spare.hubs.length).toFixed(1)} km · tap hub marker for details`
    : '';
  
  // Map
  drawHexClusters(assignment.clusters, assignment);
  drawDCMarkers(assignment);
  drawRoutes(assignment);
  drawHomeMarkers();
  drawSpare(spare);
  
  // Roster
  buildRoster(assignment);
  
  document.getElementById('roster-sub').textContent = `${numTechs} technician${numTechs>1?'s':''} · ${totalTickets} tickets to close today`;
  updateTicketTabLabel();
}

function onTechChange(val) {
  __state.attActive = null; // manual slider override clears attendance filter
  __state.sliderOverride = true; // keep the user's choice across database refreshes
  document.getElementById('tech-val').textContent = val;
  rebuild();
}

// ═══════════════════════════════════════════════════════
//  VIEW SWITCHING & TICKET DASHBOARD
// ═══════════════════════════════════════════════════════

let currentView = 'roster';
let tktFilter = 'all';

function switchView(v) {
  currentView = v;
  const viewDisplay = { roster:'block', tickets:'block', tracker:'flex', attend:'flex' };
  ['roster','tickets','tracker','attend'].forEach(id => {
    const el = document.getElementById('view-'+id);
    const isActive = id === v;
    el.style.display = isActive ? viewDisplay[id] : 'none';
    el.classList.toggle('v-active', isActive);
    document.getElementById('tab-'+id).classList.toggle('active', isActive);
  });
  if(v==='tickets') buildTicketDashboard(tktFilter);
  if(v==='tracker') renderTrackerList();
  if(map) setTimeout(() => map.invalidateSize(), 60);
  if(v==='attend') {
    // Set date header
    const d = new Date();
    document.getElementById('attend-date').textContent =
      d.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    renderAttendList();
  }
}

function reassignDropdownHTML(ticketId, currentTechIdx, allTechs) {
  const isOverridden = ticketId in manualOverrides;
  const options = allTechs.map((t, i) =>
    `<option value="${i}" ${i === currentTechIdx ? 'selected' : ''}>${t.name} · ${t.zone}</option>`
  ).join('');
  return `<div class="reassign-row">
    <span class="reassign-label">↪ Assign to</span>
    <select class="reassign-select ${isOverridden ? 'overridden' : ''}"
      onchange="reassignTicket('${ticketId}', this.value)"
      onclick="event.stopPropagation()">
      ${options}
    </select>
    ${isOverridden ? `<span class="override-badge">✎ Manual</span>` : ''}
  </div>`;
}

function clearAllOverrides() {
  const ids = Object.keys(manualOverrides);
  if(!ids.length) return;
  if(!confirm(`Clear ${ids.length} assignment${ids.length>1?'s':''}? The tickets become unassigned and are planned automatically.`)) return;
  ids.forEach(k => delete manualOverrides[k]);
  __hooks.onClearAssignments && __hooks.onClearAssignments(ids);
  rebuild();
  if(currentView === 'tickets') buildTicketDashboard(tktFilter);
}

function updateTicketTabLabel() {
  const total = OPEN_TICKETS.length;
  const active = total - excludedTickets.size;
  const tab = document.getElementById('tab-tickets');
  if(tab) tab.textContent = active < total ? `🎫 Tickets (${active}/${total})` : `🎫 Tickets (${total})`;
}

function filterTickets(f, btn) {
  tktFilter = f;
  document.querySelectorAll('.tkt-filter-btn').forEach(b=>b.classList.remove('sel'));
  btn.classList.add('sel');
  buildTicketDashboard(f);
}

function buildTicketDashboard(filter) {
  const container = document.getElementById('tkt-table');
  const techAssign = lastAssignment;

  // Build ticket→tech lookup from current assignment
  const ticketTech = {};
  if(techAssign) {
    techAssign.techs.forEach(tech => {
      tech.tickets.forEach(tk => { ticketTech[tk.ticket] = tech; });
    });
  }

  const excluded = excludedTickets;
  const active = OPEN_TICKETS.length - excluded.size;
  const overrideCount = Object.keys(manualOverrides).length;
  const countBar = document.getElementById('tkt-count-bar');
  if(countBar) countBar.textContent = `${active} active · ${excluded.size} removed · ${overrideCount} manually reassigned`;

  // Show/hide restore button
  const restoreBtn = document.getElementById('restore-btn');
  if(restoreBtn) restoreBtn.style.display = excluded.size > 0 ? '' : 'none';

  // Show/hide clear overrides button
  const clearBtn = document.getElementById('clear-overrides-btn');
  if(clearBtn) clearBtn.style.display = overrideCount > 0 ? '' : 'none';

  let tickets = OPEN_TICKETS.slice();
  if(filter === 'Break Down') tickets = tickets.filter(t=>t.category==='Break Down');
  else if(filter === 'Running Repair') tickets = tickets.filter(t=>t.category==='Running Repair');
  else if(filter === 'Accidental') tickets = tickets.filter(t=>t.category==='Accidental');
  else if(filter === 'excluded') tickets = tickets.filter(t=>excluded.has(t.ticket));
  else if(filter === 'old') tickets = tickets.filter(t=>{
    const days = t.breakdown_date ? Math.floor((Date.now()-new Date(t.breakdown_date))/(86400000)) : 0;
    return days >= 7;
  });

  // Sort: excluded last, then oldest first
  tickets.sort((a,b) => {
    const ae = excluded.has(a.ticket), be = excluded.has(b.ticket);
    if(ae !== be) return ae ? 1 : -1;
    const da = a.breakdown_date ? new Date(a.breakdown_date) : new Date(0);
    const db = b.breakdown_date ? new Date(b.breakdown_date) : new Date(0);
    return da - db;
  });

  if(!tickets.length) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px;">No tickets match this filter</div>';
    return;
  }

  container.innerHTML = tickets.map(tk => {
    const isExcluded = excluded.has(tk.ticket);
    const days = tk.breakdown_date ? Math.floor((Date.now()-new Date(tk.breakdown_date))/(86400000)) : 0;
    const ageColor = days >= 7 ? '#DC2626' : days >= 3 ? '#D97706' : '#16A34A';
    const ageBg = days >= 7 ? '#FEF2F2' : days >= 3 ? '#FFFBEB' : '#F0FDF4';
    const catIcon = tk.category==='Break Down'?'🔴':tk.category==='Accidental'?'⚠️':tk.category==='Running Repair'?'🔧':'📋';
    const severity = tk.issue_type==='Minor'?{c:'#D97706',b:'#FFFBEB',l:'Minor'}:
                     tk.issue_type==='Medium'?{c:'#EA580C',b:'#FFF7ED',l:'Medium'}:
                     {c:'#DC2626',b:'#FEF2F2',l:'Major'};
    const tech = ticketTech[tk.ticket];
    const dc = DC_MAP[tk.center];
    const tId = tk.ticket.replace(/[^a-zA-Z0-9]/g,'_');

    return `<div class="tkt-card${isExcluded?' excluded':''}" id="tktcard-${tId}">
      <div class="tkt-card-hdr">
        <div style="flex:1;min-width:0;cursor:pointer;" onclick="flyToDC(${dc?dc.lat:0},${dc?dc.lon:0})">
          <div style="font-family:'JetBrains Mono',monospace;font-size:10.5px;color:${isExcluded?'var(--text3)':'var(--accent)'};font-weight:700;">${isExcluded?'🚫 ':''} ${tk.ticket}</div>
          <div style="font-size:12.5px;font-weight:700;color:var(--text);margin-top:1px;">${(tk.center||'').replace(/_/g,' ').replace(/ D$/,'').replace(/ NDC$/,'').trim()}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
          ${!isExcluded ? `<span class="age-chip" style="color:${ageColor};background:${ageBg};">${days}d old</span>` : ''}
          ${!isExcluded && tech ? `<span class="assignee-chip" style="background:${tech.color}20;color:${tech.color};">${tech.name}${tk.ticket in manualOverrides ? ' ✎' : ''}</span>` : ''}
          <button class="toggle-tkt-btn ${isExcluded?'restore':'remove'}" onclick="toggleTicket('${tk.ticket}')">
            ${isExcluded ? '↩ Restore' : '🚫 Remove'}
          </button>
        </div>
      </div>
      ${!isExcluded ? `<div class="tkt-card-body">
        <div class="tkt-row">
          <span class="tkt-label">🚲 Vehicle</span>
          <span class="tkt-val" style="font-weight:700;">${tk.vehicle}</span>
        </div>
        <div class="tkt-row">
          <span class="tkt-label">📂 Category</span>
          <span class="tkt-val">${catIcon} ${tk.category||'—'} &nbsp;
            <span style="font-size:10px;font-weight:600;padding:1px 6px;border-radius:6px;background:${severity.b};color:${severity.c};">${severity.l}</span>
          </span>
        </div>
        <div class="tkt-row">
          <span class="tkt-label">📝 Issue</span>
          <span class="tkt-val" style="color:var(--text2);">${tk.issue}</span>
        </div>
        <div class="tkt-row">
          <span class="tkt-label">📅 Since</span>
          <span class="tkt-val" style="color:var(--text3);">${tk.breakdown_date||'—'} &nbsp;·&nbsp; ⏱ ${tk.downtime||0}d &nbsp;·&nbsp; 🪣 ${tk.bucket||'—'}</span>
        </div>
        <div class="tkt-row">
          <span class="tkt-label">⚠️ TAT</span>
          <span class="tkt-val">
            <span style="font-weight:700;color:${tk.tat_breach==='YES'?'#DC2626':tk.tat_breach==='NO'?'#16A34A':'#9CA3AF'}">${tk.tat_breach==='YES'?'🔴 Breached':tk.tat_breach==='NO'?'✅ On Time':'— not recorded'}</span>
            ${tk.penalty_cost>0?`&nbsp;·&nbsp; <span style="font-weight:700;color:#DC2626;">💰 ₹${tk.penalty_cost}</span>`:''}
            ${tk.penalty_days>0?`&nbsp;·&nbsp; ${tk.penalty_days}d penalty`:''}
            ${tk.affected_spare?`&nbsp;·&nbsp; 🔧 ${tk.affected_spare}`:''}
          </span>
        </div>
        ${tk.quotation>0?`<div class="tkt-row"><span class="tkt-label">💼 Quotation</span><span class="tkt-val" style="font-weight:600;">₹${tk.quotation.toLocaleString('en-IN')} ${tk.ev_remark?'· <span style="color:var(--amber)">'+tk.ev_remark+'</span>':''}</span></div>`:''}
        ${tk.stm||tk.sm?`<div class="tkt-row"><span class="tkt-label">👤 POC</span><span class="tkt-val" style="color:var(--text2);">${tk.stm?'STM: <b>'+tk.stm+'</b>':''} ${tk.sm?'· SM: <b>'+tk.sm+'</b>':''}</span></div>`:''}
        ${tk.month_rep>1?`<div class="tkt-row"><span class="tkt-label">🔁 Repeat</span><span class="tkt-val" style="color:var(--red);font-weight:700;">${tk.month_rep}x this month ⚠️</span></div>`:''}
        <div style="padding-top:6px;border-top:1px dashed var(--border);margin-top:4px;">
          ${reassignDropdownHTML(tk.ticket, lastAssignment ? lastAssignment.techs.findIndex(t=>t.tickets.some(x=>x.ticket===tk.ticket)) : -1, lastAssignment ? lastAssignment.techs : [])}
        </div>
      </div>` : `<div style="padding:6px 10px 8px;font-size:11px;color:var(--text3);">Excluded from today's planning — technician routes recalculated.</div>`}
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════
//  TICKET TRACKER
// ═══════════════════════════════════════════════════════

// ticketStatus[ticketId] = { status:'assigned'|'visited'|'closed', ts:{assigned,visited,closed}, note:'' }
const ticketStatus = {};
let trackerFilter = 'all';
let trackerTechFilter = 'all';

function initTicketTracker() {
  // Default all active tickets to 'assigned'
  OPEN_TICKETS.forEach(tk => {
    if(!ticketStatus[tk.ticket]) {
      ticketStatus[tk.ticket] = { status:'assigned', ts:{assigned: new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}, note:'' };
    }
  });
}

function setTicketNote(ticketId, note) {
  if(!ticketStatus[ticketId]) ticketStatus[ticketId] = { status:'assigned', ts:{}, note:'' };
  ticketStatus[ticketId].note = note;
  __saveLocal();
}

function setTicketStatus(ticketId, newStatus) {
  if(!ticketStatus[ticketId]) ticketStatus[ticketId] = { status:'assigned', ts:{}, note:'' };
  ticketStatus[ticketId].status = newStatus;
  __hooks.onTicketStatus && __hooks.onTicketStatus(ticketId, newStatus);
  if(!ticketStatus[ticketId].ts[newStatus]) {
    ticketStatus[ticketId].ts[newStatus] = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
  }
  __saveLocal();
  // Re-render just this card
  renderTrackerCard(ticketId);
  updateTrackerSummary();
  // Redraw map marker color
  if(lastAssignment) { drawDCMarkers(lastAssignment); }
}

function setTrackerFilter(f, el) {
  trackerFilter = f;
  document.querySelectorAll('.pipeline-col').forEach(c => c.classList.remove('active-col'));
  el.classList.add('active-col');
  renderTrackerList();
}

function setTrackerTechFilter(f, el) {
  trackerTechFilter = f;
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('sel'));
  el.classList.add('sel');
  renderTrackerList();
}

function updateTrackerSummary() {
  const counts = { assigned:0, visited:0, closed:0 };
  OPEN_TICKETS.forEach(tk => {
    const s = (ticketStatus[tk.ticket]||{}).status || 'assigned';
    counts[s] = (counts[s]||0) + 1;
  });
  const total = OPEN_TICKETS.length;
  const closed = counts.closed;
  document.getElementById('tp-num-all').textContent = total;
  document.getElementById('tp-num-assigned').textContent = counts.assigned;
  document.getElementById('tp-num-visited').textContent = counts.visited;
  document.getElementById('tp-num-closed').textContent = counts.closed;
  const pct = total > 0 ? Math.round(closed/total*100) : 0;
  const bar = document.getElementById('tracker-progress-bar');
  if(bar) bar.style.width = pct + '%';
}

function renderTrackerTechFilters() {
  if(!lastAssignment) return;
  const bar = document.getElementById('tracker-tech-filters');
  if(!bar) return;
  bar.innerHTML = lastAssignment.techs.map(tech =>
    `<div class="tf-btn" onclick="setTrackerTechFilter('${tech.name}',this)" style="border-color:${tech.color};color:${tech.color};">${tech.name}</div>`
  ).join('');
}

function getStatusIcon(s) {
  return s==='closed' ? '✅' : s==='visited' ? '🟡' : '🔵';
}
function getStatusColor(s) {
  return s==='closed' ? '#10B981' : s==='visited' ? '#F59E0B' : '#3B82F6';
}

function renderTrackerCard(ticketId) {
  const el = document.getElementById(`tcard-${ticketId.replace(/[^a-zA-Z0-9]/g,'_')}`);
  if(!el) return;
  const tk = OPEN_TICKETS.find(t=>t.ticket===ticketId);
  if(!tk) return;
  el.innerHTML = buildTrackerCardHTML(tk);
}

function buildTrackerCardHTML(tk) {
  const ts = ticketStatus[tk.ticket] || { status:'assigned', ts:{}, note:'' };
  const s = ts.status;
  const sc = getStatusColor(s);
  const dc = DC_MAP[tk.center];
  const days = tk.breakdown_date ? Math.floor((Date.now()-new Date(tk.breakdown_date))/86400000) : 0;
  const ageCol = days>=7?'#DC2626':days>=3?'#D97706':'#16A34A';
  const catIcon = tk.category==='Break Down'?'🔴':tk.category==='Accidental'?'⚠️':tk.category==='Running Repair'?'🔧':'📋';

  // Find assigned tech
  let tech = null;
  if(lastAssignment) tech = lastAssignment.techs.find(t=>t.tickets.some(x=>x.ticket===tk.ticket));

  // Timestamps trail
  const tsTrail = ['assigned','visited','closed'].filter(st=>ts.ts[st])
    .map(st=>`${getStatusIcon(st)} ${st.charAt(0).toUpperCase()+st.slice(1)}: ${ts.ts[st]}`).join(' · ');

  return `
    <div class="tracker-card-top">
      <!-- Status pill -->
      <div style="display:flex;flex-direction:column;align-items:center;gap:5px;flex-shrink:0;">
        <div class="tracker-status-pill">
          <button class="tsp-btn ${s==='assigned'?'active-assigned':''}" onclick="setTicketStatus('${tk.ticket}','assigned')">🔵</button>
          <button class="tsp-btn ${s==='visited'?'active-visited':''}" onclick="setTicketStatus('${tk.ticket}','visited')">🟡</button>
          <button class="tsp-btn ${s==='closed'?'active-closed':''}" onclick="setTicketStatus('${tk.ticket}','closed')">✅</button>
        </div>
        <span style="font-size:9px;font-weight:700;color:${sc};">${s.toUpperCase()}</span>
      </div>
      <!-- Info -->
      <div class="tracker-info">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span class="tracker-id">${tk.ticket}</span>
          <span style="font-size:10px;font-weight:700;color:${ageCol};background:${ageCol}18;padding:1px 5px;border-radius:6px;">${days}d old</span>
          ${tech ? `<span class="tracker-tech-chip" style="background:${tech.color}20;color:${tech.color};">${tech.name}</span>` : ''}
        </div>
        <div class="tracker-dc" style="cursor:pointer;" onclick="flyToDC(${dc?dc.lat:0},${dc?dc.lon:0})">${(tk.center||'').replace(/_/g,' ').replace(/ D$/,'').replace(/ NDC$/,'').trim()} 📍</div>
        <div class="tracker-meta">${catIcon} ${tk.category||'—'} &nbsp;·&nbsp; 🚲 ${tk.vehicle} &nbsp;·&nbsp; ${tk.issue}</div>
        <div class="tracker-meta" style="margin-top:2px;">
          ⏱ ${tk.downtime||0}d &nbsp;·&nbsp; 🪣 ${tk.bucket||'—'}
          ${tk.tat_breach==='YES'?'&nbsp;·&nbsp; <span style="color:#DC2626;font-weight:700;">🔴 TAT Breach</span>':''}
          ${tk.penalty_cost>0?`&nbsp;·&nbsp; <span style="color:#DC2626;font-weight:700;">💰 ₹${tk.penalty_cost}</span>`:''}
          ${tk.affected_spare?`&nbsp;·&nbsp; 🔧 ${tk.affected_spare}`:''}
        </div>
        ${tsTrail ? `<div class="tracker-ts">${tsTrail}</div>` : ''}
      </div>
    </div>
    <!-- Note -->
    <div class="tracker-note-row">
      <input class="tracker-note-inp" placeholder="Add visit note…" value="${(ts.note||'').replace(/"/g,'&quot;')}"
        onchange="setTicketNote('${tk.ticket}', this.value)">
    </div>
  `;
}

function renderTrackerList() {
  initTicketTracker();
  renderTrackerTechFilters();
  updateTrackerSummary();

  let tickets = OPEN_TICKETS.filter(tk => !excludedTickets.has(tk.ticket));

  // Status filter
  if(trackerFilter !== 'all') {
    tickets = tickets.filter(tk => (ticketStatus[tk.ticket]||{}).status === trackerFilter);
  }

  // Tech filter
  if(trackerTechFilter !== 'all' && lastAssignment) {
    const techObj = lastAssignment.techs.find(t=>t.name===trackerTechFilter);
    if(techObj) {
      const techTicketIds = new Set(techObj.tickets.map(t=>t.ticket));
      tickets = tickets.filter(tk => techTicketIds.has(tk.ticket));
    }
  }

  // Sort: assigned first, then visited, then closed; within each by age
  const order = { assigned:0, visited:1, closed:2 };
  tickets.sort((a,b) => {
    const sa = order[(ticketStatus[a.ticket]||{}).status||'assigned'];
    const sb = order[(ticketStatus[b.ticket]||{}).status||'assigned'];
    if(sa !== sb) return sa - sb;
    const da = a.breakdown_date ? new Date(a.breakdown_date) : new Date();
    const db = b.breakdown_date ? new Date(b.breakdown_date) : new Date();
    return da - db;
  });

  const list = document.getElementById('tracker-list');
  if(!list) return;

  if(tickets.length === 0) {
    list.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text3);font-size:13px;">No tickets match this filter</div>`;
    return;
  }

  list.innerHTML = tickets.map(tk => {
    const s = (ticketStatus[tk.ticket]||{}).status || 'assigned';
    const sc = getStatusColor(s);
    return `<div class="tracker-card" id="tcard-${tk.ticket.replace(/[^a-zA-Z0-9]/g,'_')}" style="border-left:3px solid ${sc};">
      ${buildTrackerCardHTML(tk)}
    </div>`;
  }).join('');
}

function exportTracker() {
  const rows = ['Ticket,DC,Vehicle,Category,Issue,Assigned To,Status,Time Assigned,Time Visited,Time Closed,Note'];
  OPEN_TICKETS.forEach(tk => {
    const ts = ticketStatus[tk.ticket] || {};
    const tech = lastAssignment ? lastAssignment.techs.find(t=>t.tickets.some(x=>x.ticket===tk.ticket)) : null;
    rows.push([
      tk.ticket, tk.center, tk.vehicle, tk.category||'',
      `"${tk.issue}"`, tech?tech.name:'Unassigned',
      ts.status||'assigned',
      ts.ts?.assigned||'', ts.ts?.visited||'', ts.ts?.closed||'',
      `"${ts.note||''}"`
    ].join(','));
  });
  const blob = new Blob([rows.join('\n')], {type:'text/csv'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `ticket_tracker_${new Date().toLocaleDateString('en-CA')}.csv`;
  a.click();
}

// ═══════════════════════════════════════════════════════
//  ATTENDANCE
// ═══════════════════════════════════════════════════════

// attendance[i] = { status: 'present'|'absent'|'halfday', timeIn: '09:00', note: '' }
const attendance = {};

function initAttendance() {
  REAL_TECHS.forEach((t, i) => {
    if(!attendance[i]) {
      attendance[i] = { status: 'present', timeIn: '09:00', note: '' };
    }
  });
}

function setAttendStatus(idx, status) {
  if(!attendance[idx]) attendance[idx] = { status, timeIn: '09:00', note: '' };
  attendance[idx].status = status;
  attendance[idx].__dirty = true;
  renderAttendRow(idx);
  updateAttendSummary();
}

function renderAttendRow(idx) {
  const row = document.getElementById(`attend-row-${idx}`);
  if(!row) return;
  const a = attendance[idx] || { status:'present', timeIn:'09:00', note:'' };
  const t = REAL_TECHS[idx];
  const color = ['#E63946','#2196F3','#FF9800','#4CAF50','#9C27B0','#00BCD4','#FF5722','#607D8B','#8BC34A','#F06292','#03A9F4','#CDDC39'][idx % 12];
  const s = a.status;

  row.style.opacity = s === 'absent' ? '0.45' : '1';
  row.innerHTML = `
    <div class="attend-avatar" style="background:${color}20;color:${color};">${t.name.slice(0,2).toUpperCase()}</div>
    <div class="attend-name">
      <div class="attend-name-text">${t.name} ${s==='absent'?'<span style="font-size:9px;background:var(--red2);color:var(--red);padding:1px 5px;border-radius:4px;font-weight:700;">ABSENT</span>':s==='halfday'?'<span style="font-size:9px;background:var(--amb2);color:var(--amber);padding:1px 5px;border-radius:4px;font-weight:700;">HALF DAY</span>':''}</div>
      <div class="attend-zone-text">${t.zone}</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
      <div class="attend-status-btns">
        <button class="status-btn ${s==='present'?'present':'inactive'}" onclick="setAttendStatus(${idx},'present')">✓ Present</button>
        <button class="status-btn ${s==='halfday'?'halfday':'inactive'}" onclick="setAttendStatus(${idx},'halfday')">½ Half</button>
        <button class="status-btn ${s==='absent'?'absent':'inactive'}" onclick="setAttendStatus(${idx},'absent')">✕ Absent</button>
      </div>
      <div style="display:flex;gap:5px;align-items:center;">
        <input class="attend-time" type="time" value="${a.timeIn||'09:00'}"
          ${s==='absent'?'disabled':''} 
          onchange="attendance[${idx}].timeIn=this.value;attendance[${idx}].__dirty=true"
          title="Time In">
        <input class="attend-note" type="text" value="${a.note||''}" placeholder="Note…"
          onchange="attendance[${idx}].note=this.value;attendance[${idx}].__dirty=true"
          title="Note">
      </div>
    </div>
  `;
}

function renderAttendList() {
  initAttendance();
  const list = document.getElementById('attend-list');
  if(!list) return;
  // Ensure new techs have entries
  REAL_TECHS.forEach((t,i) => {
    if(!attendance[i]) attendance[i] = { status:'present', timeIn:'09:00', note:'' };
  });
  list.innerHTML = REAL_TECHS.map((t,i) =>
    `<div class="attend-row" id="attend-row-${i}"></div>`
  ).join('');
  REAL_TECHS.forEach((_, i) => renderAttendRow(i));
  updateAttendSummary();
}

function updateAttendSummary() {
  const counts = { present:0, absent:0, halfday:0 };
  REAL_TECHS.forEach((_, i) => {
    const s = (attendance[i]||{}).status || 'present';
    counts[s] = (counts[s]||0) + 1;
  });
  const active = counts.present + counts.halfday;
  document.getElementById('att-present').textContent = counts.present;
  document.getElementById('att-absent').textContent = counts.absent;
  document.getElementById('att-halfday').textContent = counts.halfday;
  document.getElementById('att-active').textContent = active;
}

function markAllPresent() {
  REAL_TECHS.forEach((_, i) => {
    attendance[i] = { ...(attendance[i]||{}), status:'present', timeIn:'09:00', __dirty:true };
  });
  renderAttendList();
}

function applyAttendance() {
  // Count active (present + halfday)
  const activeTechIndices = REAL_TECHS.map((_, i) => i)
    .filter(i => (attendance[i]||{}).status !== 'absent');

  // Adjust slider to reflect active count
  const activeCount = activeTechIndices.length;
  const slider = document.getElementById('tech-slider');
  slider.value = Math.min(activeCount, REAL_TECHS.length);

  // Store active indices for assignTechnicians to use
  __state.attActive = activeTechIndices;
  __state.sliderOverride = false;
  __hooks.onApplyAttendance && __hooks.onApplyAttendance(REAL_TECHS.map((t, i) => ({ tech: t, ...(attendance[i] || {}) })));
  Object.values(attendance).forEach(a => { if (a) delete a.__dirty; });
  rebuild();
  switchView('roster');
  showToast(`✓ Routes rebuilt · ${activeCount} techs active`);
}

function exportAttendance() {
  const today = new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const rows = ['Name,Zone,Status,Time In,Note'];
  REAL_TECHS.forEach((t,i) => {
    const a = attendance[i] || {};
    rows.push(`"${t.name}","${t.zone}","${a.status||'present'}","${a.timeIn||''}","${a.note||''}"`);
  });
  const blob = new Blob([`Attendance Report - ${today}\n\n`+rows.join('\n')], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `attendance_${new Date().toLocaleDateString('en-CA')}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════
//  ADD / MANAGE TECHNICIANS
// ═══════════════════════════════════════════════════════

function openAddTech() {
  // Clear fields
  ['at-name','at-lat','at-lon','at-zone','at-zone2'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('at-err').style.display = 'none';
  document.getElementById('add-tech-modal').style.display = 'flex';
}

function closeAddTech(e) {
  if(e && e.target !== document.getElementById('add-tech-modal')) return;
  document.getElementById('add-tech-modal').style.display = 'none';
}

function atClearErr() { document.getElementById('at-err').style.display = 'none'; }

function confirmAddTech() {
  const name = document.getElementById('at-name').value.trim();
  const zone = document.getElementById('at-zone').value.trim();
  const zone2 = document.getElementById('at-zone2').value.trim();
  const lat = parseFloat(document.getElementById('at-lat').value);
  const lon = parseFloat(document.getElementById('at-lon').value);

  if(!name || isNaN(lat) || isNaN(lon) || lat < 27 || lat > 30 || lon < 76 || lon > 78) {
    document.getElementById('at-err').style.display = 'block';
    return;
  }

  const zones2 = zone2 ? [zone || zone2, zone2] : [zone || 'NCR'];
  __hooks.onAddTech && __hooks.onAddTech({ name, zone: zones2.join(' → '), lat, lon });
  REAL_TECHS.push({
    name,
    zone: zones2.join(' → '),
    zones2,
    homeLat: lat,
    homeLon: lon
  });

  // Update slider max
  const slider = document.getElementById('tech-slider');
  slider.max = REAL_TECHS.length;
  slider.value = REAL_TECHS.length;
  document.getElementById('tech-val').textContent = REAL_TECHS.length;
  document.querySelector('.tc-meta span:last-child').textContent = `All ${REAL_TECHS.length} techs`;

  document.getElementById('add-tech-modal').style.display = 'none';
  rebuild();
  showToast(`👷 ${name} added to team!`);
}

function openManageTechs() {
  renderManageTechList();
  document.getElementById('manage-techs-modal').style.display = 'flex';
}

function closeManageTechs(e) {
  if(e && e.target !== document.getElementById('manage-techs-modal')) return;
  document.getElementById('manage-techs-modal').style.display = 'none';
}

function renderManageTechList() {
  const hubColors = ['#E63946','#2196F3','#FF9800','#4CAF50','#9C27B0','#00BCD4','#FF5722','#607D8B','#8BC34A','#F06292','#03A9F4','#CDDC39'];
  document.getElementById('manage-tech-list').innerHTML = REAL_TECHS.map((t, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);">
      <div style="width:28px;height:28px;border-radius:50%;background:${hubColors[i%hubColors.length]}20;color:${hubColors[i%hubColors.length]};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;">${t.name.slice(0,2).toUpperCase()}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:var(--text);">${t.name}</div>
        <div style="font-size:11px;color:var(--text3);">${t.zone} · ${t.homeLat.toFixed(4)}, ${t.homeLon.toFixed(4)}</div>
      </div>
      <button onclick="editTechZone(${i})" style="font-size:10px;padding:3px 8px;border-radius:6px;border:1.5px solid var(--border);background:var(--bg);color:var(--text2);cursor:pointer;">✎ Edit</button>
      <button onclick="removeTech(${i})" style="font-size:10px;padding:3px 8px;border-radius:6px;border:1.5px solid var(--red);background:var(--red2);color:var(--red);cursor:pointer;">✕</button>
    </div>
  `).join('');
}

function removeTech(idx) {
  const name = REAL_TECHS[idx].name;
  if(!confirm(`Remove ${name} from the team? They will be marked Inactive in the database.`)) return;
  __hooks.onRemoveTech && __hooks.onRemoveTech(REAL_TECHS[idx]);
  const __removedId = REAL_TECHS[idx]._id;
  REAL_TECHS.splice(idx, 1);

  // Clean overrides for removed tech
  const removedId = __removedId;
  Object.keys(manualOverrides).forEach(tk => { if(manualOverrides[tk] === removedId) delete manualOverrides[tk]; });

  const slider = document.getElementById('tech-slider');
  slider.max = REAL_TECHS.length;
  if(parseInt(slider.value) > REAL_TECHS.length) slider.value = REAL_TECHS.length;
  document.getElementById('tech-val').textContent = slider.value;
  document.querySelector('.tc-meta span:last-child').textContent = `All ${REAL_TECHS.length} techs`;

  renderManageTechList();
  rebuild();
  showToast(`${name} removed from team.`);
}

function editTechZone(idx) {
  const t = REAL_TECHS[idx];
  const newName = prompt('Name:', t.name);
  if(newName === null) return;
  const newZone = prompt('Zone / Area:', t.zone);
  if(newZone === null) return;
  const newLat = prompt('Home Latitude:', t.homeLat);
  if(newLat === null) return;
  const newLon = prompt('Home Longitude:', t.homeLon);
  if(newLon === null) return;

  const lat = parseFloat(newLat), lon = parseFloat(newLon);
  if(isNaN(lat) || isNaN(lon)) { alert('Invalid coordinates'); return; }

  REAL_TECHS[idx] = { ...t, name: newName.trim()||t.name, zone: newZone.trim()||t.zone, homeLat: lat, homeLon: lon };
  __hooks.onEditTech && __hooks.onEditTech(REAL_TECHS[idx]);
  renderManageTechList();
  rebuild();
  showToast(`✎ ${REAL_TECHS[idx].name} updated.`);
}

function showToast(msg) {
  let toast = __root.querySelector('#app-toast');
  if(!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'toast';
    __root.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

// ═══════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════



// ── persistence of planner-only state (per day, this browser) ──
function __saveLocal() {
  const tracker = {};
  Object.entries(ticketStatus).forEach(([tk, v]) => { tracker[tk] = { ts: v.ts, note: v.note }; });
  __hooks.saveLocal && __hooks.saveLocal({ excluded: [...excludedTickets], tracker });
}
function __restoreLocal(saved) {
  if (!saved) return;
  (saved.excluded || []).forEach(id => excludedTickets.add(id));
  Object.entries(saved.tracker || {}).forEach(([tk, v]) => {
    ticketStatus[tk] = { status: (ticketStatus[tk] || {}).status || 'assigned', ts: v.ts || {}, note: v.note || '' };
  });
}
function __applyDbState(data) {
  Object.keys(manualOverrides).forEach(k => delete manualOverrides[k]);
  Object.entries(data.assignments || {}).forEach(([tk, techId]) => {
    if (REAL_TECHS.some(t => t._id === techId)) manualOverrides[tk] = techId;
  });
  // Tracker status comes from the ticket in the database
  Object.entries(data.ticketStatus || {}).forEach(([tk, st]) => {
    if (!ticketStatus[tk]) ticketStatus[tk] = { status: st, ts: {}, note: '' };
    else ticketStatus[tk].status = st;
    const now = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    if (!ticketStatus[tk].ts[st]) ticketStatus[tk].ts[st] = now;
  });
  // Attendance comes from the database (unless being edited here)
  REAL_TECHS.forEach((t, i) => {
    const a = (data.attendance || {})[t._id];
    if (a && !(attendance[i] && attendance[i].__dirty)) attendance[i] = { ...a };
  });
  if (__state.sliderOverride) return; // user picked a technician count with the slider — respect it
  const anyMarked = REAL_TECHS.some(t => (data.attendance || {})[t._id]);
  __state.attActive = anyMarked
    ? REAL_TECHS.map((_, i) => i).filter(i => (attendance[i] || {}).status !== 'absent')
    : null;
}
function __syncHeaderStatics() {
  const s = __root.querySelector('#tech-slider');
  if (s) {
    s.max = Math.max(1, REAL_TECHS.length);
    if (__state.sliderOverride) { if (parseInt(s.value) > REAL_TECHS.length) s.value = REAL_TECHS.length; }
    else if (__state.attActive) s.value = __state.attActive.length;
    else if (!s.dataset.touched || parseInt(s.value) > REAL_TECHS.length) s.value = REAL_TECHS.length;
    __root.querySelector('#tech-val').textContent = s.value;
  }
  const last = __root.querySelector('.tc-meta span:last-child');
  if (last) last.textContent = `All ${REAL_TECHS.length} techs`;
  const dcs = __root.querySelector('#stat-dcs'); if (dcs) dcs.textContent = ALL_DCS.length;
}

/** Replace data with a fresh copy from the database and re-render, keeping UI state. */
function update(data) {
  const prevIds = REAL_TECHS.map(t => t._id);
  const prevAtt = {}; prevIds.forEach((id, i) => { if (attendance[i]) prevAtt[id] = attendance[i]; });

  ALL_DCS = data.dcs; OPEN_TICKETS = data.tickets; REAL_TECHS = data.techs.map(t => ({ ...t, zones2: t.zones2 || [t.zone] }));
  DC_MAP = {}; ALL_DCS.forEach(dc => { DC_MAP[dc.c] = dc; });
  TECH_AVATARS = REAL_TECHS.map(t => t.name.slice(0,2).toUpperCase());

  Object.keys(attendance).forEach(k => delete attendance[k]);
  REAL_TECHS.forEach((t, i) => { if (prevAtt[t._id]) attendance[i] = prevAtt[t._id]; });

  initAttendance(); initTicketTracker();
  __applyDbState(data);
  recomputeTicketData();
  __syncHeaderStatics();
  rebuild();
  if (currentView === 'tickets') buildTicketDashboard(tktFilter);
  if (currentView === 'tracker') { renderTrackerTechFilters && renderTrackerTechFilters(); renderTrackerList(); updateTrackerSummary(); }
  if (currentView === 'attend') { renderAttendList(); updateAttendSummary(); }
}

// expose handlers used by inline onclick= attributes
const exposed = { applyAttendance, assignTechnicians, atClearErr, buildHexClusters, buildRoster, buildTicketDashboard, buildTrackerCardHTML, calcRouteTime, clearAllOverrides, closeAddTech, closeManageTechs, confirmAddTech, currentParams, drawDCMarkers, drawHexClusters, drawHomeMarkers, drawRoutes, drawSpare, editTechZone, exportAttendance, exportTracker, filterTickets, findOptimalSpareHubs, flyToDC, focusTech, getStatusColor, getStatusIcon, haversineKm, hexCenter, hexVertices, initAttendance, initMap, initTicketTracker, latLonToHex, markAllPresent, nearestNeighbor, onTechChange, openAddTech, openManageTechs, reassignDropdownHTML, reassignTicket, rebuild, recomputeTicketData, removeTech, renderAttendList, renderAttendRow, renderManageTechList, renderTrackerCard, renderTrackerList, renderTrackerTechFilters, restoreAllTickets, routeDistance, setAttendStatus, setTicketNote, setTicketStatus, setTrackerFilter, setTrackerTechFilter, showToast, switchView, toXY, toggleCard, toggleTicket, twoOpt, updateAttendSummary, updateTicketTabLabel, updateTrackerSummary, ticketStatus, attendance };
Object.assign(window, exposed);

// ── BOOT ──
initAttendance();
initTicketTracker();
__restoreLocal(__savedLocal);
__applyDbState(__data);
recomputeTicketData();
initMap();
__syncHeaderStatics();
__root.querySelector('#tech-slider').addEventListener('input', e => { e.target.dataset.touched = '1'; });
rebuild();
setTimeout(() => { if (REAL_TECHS.length) toggleCard(1); }, 600);
const ro = new ResizeObserver(() => map && map.invalidateSize());
ro.observe(__root.querySelector('#map'));

return {
  update,
  destroy() {
    ro.disconnect();
    try { map && map.remove(); } catch {}
    Object.keys(exposed).forEach(k => { if (window[k] === exposed[k]) delete window[k]; });
  },
};
}
