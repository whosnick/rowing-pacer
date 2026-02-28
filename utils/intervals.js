export function buildIntervalBoundaries(workout) {
  if (!workout?.intervals) return [];

  const boundaries = [];
  let currentTime = 0;
  let currentDist = 0;

  for (let i = 0; i < workout.intervals.length; i++) {
    const iv = workout.intervals[i];
    boundaries.push({
      index: i,
      startTime: currentTime,
      startDist: currentDist,
      type: iv.type,
      target: iv.target || iv.val,
      phase: iv.phase,
    });

    if (iv.type === 'time') currentTime += iv.val;
    if (iv.type === 'distance') currentDist += iv.val;
  }

  return boundaries;
}
