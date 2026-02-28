let zoneTimeTracking = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

export function initZoneTracking() {
  zoneTimeTracking = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
}

export function updateZoneTime(zone) {
  if (zone && zoneTimeTracking[zone.zone] !== undefined) {
    zoneTimeTracking[zone.zone] += 1;
  }
}

export function getZoneDistribution(totalSeconds) {
  if (!totalSeconds) return null;
  return Object.entries(zoneTimeTracking).map(([zone, seconds]) => ({
    zone: parseInt(zone),
    seconds,
    percentage: Math.round((seconds / totalSeconds) * 100),
  }));
}

export function resetZoneTracking() {
  initZoneTracking();
  console.log('[ZoneTracker] Zone tracking reset');
}

let recoveryStartZone = null;
let recoveryStartHR = null;
let recoveryStartTime = null;
let recoverySkipped = false;
let recoverySkipReason = null;
let _currentHR = null;

export function setCurrentHR(hr) {
  _currentHR = hr;
}

export function startHRRecoveryMeasurement(currentZone) {
  if (recoveryStartTime !== null && !recoverySkipped) {
    const elapsed = Math.floor((Date.now() - recoveryStartTime) / 1000);
    if (elapsed < 60) return true;
  }
if (currentZone && currentZone.zone <= 1) {
    recoverySkipped = true;
    recoverySkipReason = 'Intensity too low to measure recovery';
    return false;
  }

  // LOCK IN THE ZONE HERE
  recoveryStartZone = currentZone ? currentZone.zone : 0; 
  recoveryStartHR = _currentHR;
  recoveryStartTime = Date.now();
  recoverySkipped = false;
  recoverySkipReason = null;
  
  return true;
}

export function getHRRecoveryStatus() {
  if (recoverySkipped) return { status: 'skipped', reason: recoverySkipReason };
  if (recoveryStartHR === null) return { status: 'not_started' };

  const elapsed = Math.floor((Date.now() - recoveryStartTime) / 1000);
  
  if (elapsed < 60) {
    return { 
        status: 'measuring', 
        remaining: Math.max(0, 60 - elapsed), 
        startHR: recoveryStartHR 
    };
  }

  return {
    status: 'complete',
    startHR: recoveryStartHR,
    currentHR: _currentHR,
    recovery: recoveryStartHR - (_currentHR || 0),
    startZone: recoveryStartZone // PASS THIS TO THE UI
  };
}

export function resetHRRecovery() {
  recoveryStartHR = null;
  recoveryStartTime = null;
  recoveryStartZone = null; // <--- Add this line
  recoverySkipped = false;
  recoverySkipReason = null;
  _currentHR = null;
  console.log('[ZoneTracker] HR recovery state fully reset');
}
