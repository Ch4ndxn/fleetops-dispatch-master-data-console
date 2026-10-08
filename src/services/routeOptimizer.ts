import { Technician, Center, Ticket, TechnicianRoutePlan, RouteStop } from '../types';
import { getCenters, getTechnicians, getTickets, getAttendance } from './storage';

/**
 * Calculates Haversine distance between two coordinates in Kilometers
 */
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightLine = R * c;
  // Apply Delhi NCR city routing detour factor (~1.3x)
  return Math.round(straightLine * 1.3 * 10) / 10;
}

/**
 * Route Optimizer algorithm:
 * Uses technician's starting coordinates (Requirement 2: "The route optimizer must use this location as the technician's starting point")
 * and Center coordinates for tickets to build an optimal sequence.
 */
export function planTodayRoutes(): TechnicianRoutePlan[] {
  const technicians = getTechnicians();
  const centers = getCenters();
  const tickets = getTickets();
  const attendance = getAttendance();
  const today = new Date().toISOString().split('T')[0];

  // Map centers for quick lookup
  const centerMap = new Map<string, Center>();
  centers.forEach(c => {
    centerMap.set(c.normalizedName, c);
    centerMap.set(c.name.trim().toLowerCase(), c);
  });

  // Filter available technicians: Active and Present
  const availableTechs = technicians.filter(t => {
    if (t.status !== 'Active') return false;
    if (t.startingLatitude === undefined || t.startingLongitude === undefined) return false;
    const att = attendance.find(a => a.employeeId.toUpperCase() === t.employeeId.toUpperCase() && a.date === today);
    // If attendance marked, must be Present or Half-Day; if not marked yet, allow active techs
    if (att && att.status !== 'Present' && att.status !== 'Half-Day') return false;
    return true;
  });

  if (availableTechs.length === 0) {
    return [];
  }

  // Filter active tickets that need routing (Open or Assigned)
  const routableTickets = tickets.filter(tk => {
    if (tk.status === 'Resolved' || tk.status === 'Closed') return false;
    const center = centerMap.get(tk.centerName.trim().toLowerCase());
    return Boolean(center && center.latitude && center.longitude);
  });

  // Sort tickets by priority score
  const priorityWeights: Record<string, number> = {
    CRITICAL: 100,
    HIGH: 50,
    MEDIUM: 20,
    LOW: 10
  };

  routableTickets.sort((a, b) => {
    return (priorityWeights[b.priority] || 0) - (priorityWeights[a.priority] || 0);
  });

  // Prepare technician plan buckets
  const plans: TechnicianRoutePlan[] = availableTechs.map(tech => ({
    technicianId: tech.id,
    technicianName: tech.name,
    employeeId: tech.employeeId,
    startLat: tech.startingLatitude!,
    startLng: tech.startingLongitude!,
    defaultDc: tech.defaultDc,
    stops: [],
    totalDistanceKm: 0,
    totalEstimatedMins: 0,
    status: 'Draft'
  }));

  // Distribute tickets to closest technician using greedy heuristic
  const unassigned = [...routableTickets];

  for (const ticket of unassigned) {
    const center = centerMap.get(ticket.centerName.trim().toLowerCase())!;

    // Find closest technician (considering current last stop or start point)
    let bestTechIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      // Cap at 5 cases per technician for realistic daily workload
      if (plan.stops.length >= 5) continue;

      const lastLat = plan.stops.length > 0 ? plan.stops[plan.stops.length - 1].latitude : plan.startLat;
      const lastLng = plan.stops.length > 0 ? plan.stops[plan.stops.length - 1].longitude : plan.startLng;

      const dist = calculateDistanceKm(lastLat, lastLng, center.latitude, center.longitude);
      if (dist < minDistance) {
        minDistance = dist;
        bestTechIndex = i;
      }
    }

    if (minDistance < Infinity) {
      const targetPlan = plans[bestTechIndex];
      const stopOrder = targetPlan.stops.length + 1;
      // Estimate arrival: base 09:30 AM + transit time + 45 min per prior job
      const elapsedMins = 30 + (targetPlan.stops.length * 60) + Math.round(minDistance * 2.5); // ~24 km/h Delhi traffic
      const arrivalHour = Math.floor(9 + elapsedMins / 60);
      const arrivalMinute = elapsedMins % 60;
      const arrivalTimeStr = `${String(arrivalHour).padStart(2, '0')}:${String(arrivalMinute).padStart(2, '0')}`;

      const stop: RouteStop = {
        stopOrder,
        ticketId: ticket.ticketId,
        centerName: ticket.centerName,
        vehicleNumber: ticket.vehicleNumber,
        issue: ticket.issue,
        priority: ticket.priority,
        latitude: center.latitude,
        longitude: center.longitude,
        estimatedArrival: arrivalTimeStr,
        estimatedDurationMins: ticket.priority === 'CRITICAL' ? 60 : 45
      };

      targetPlan.stops.push(stop);
      targetPlan.totalDistanceKm = Math.round((targetPlan.totalDistanceKm + minDistance) * 10) / 10;
      targetPlan.totalEstimatedMins += Math.round(minDistance * 2.5) + stop.estimatedDurationMins;
    }
  }

  return plans;
}
