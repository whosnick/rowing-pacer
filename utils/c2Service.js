// utils/c2Service.js

const CONFIG = {
  CLIENT_ID: 'mVm6frPPWxKdETd7BfKUwEEsy4jHzmEbeGRnJgl6',
  CLIENT_SECRET: "R8bo4hPgPpuzltcxaDneaQsPFYFvMSikjQWl93LU",
  REFRESH_TOKEN: "CU4pHxt1vu4c1fvSnvMqunydS71Tq5Dd707NAQC6",
  BASE_URL: 'https://corsproxy.io/?' + encodeURIComponent('https://log-dev.concept2.com/api/users/me/results')
};

async function getAccessToken() {
  const refreshUrl = 'https://corsproxy.io/?' + encodeURIComponent('https://log-dev.concept2.com/oauth/access_token');

  const storedToken = localStorage.getItem('c2_refresh_token');

  const response = await fetch(refreshUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CONFIG.CLIENT_ID,
      client_secret: CONFIG.CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: storedToken || CONFIG.REFRESH_TOKEN
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Token refresh failed (${response.status}): ${data.error_description || data.error || 'Unknown error'}`);
  }
  if (!data.access_token) {
    throw new Error('Token response missing access_token');
  }

  if (data.refresh_token) {
    localStorage.setItem('c2_refresh_token', data.refresh_token);
  }

  return data.access_token;
}

export function buildIntervalBoundaries(workout) {
  if (!workout.intervals) return [];

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
      phase: iv.phase
    });

    if (iv.type === 'time') {
      currentTime += iv.val;
    } else if (iv.type === 'distance') {
      currentDist += iv.val;
    }
  }

  return boundaries;
}

export function buildIntervalData(workout, strokes, boundaries) {
  if (!workout.intervals || workout.intervals.length <= 1) {
    return { intervals: null, strokeData: strokes, totalRestTime: 0, totalRestDist: 0 };
  }

  const intervals = [];
  const capturedSplits = workout.splits || [];
  let totalRestTime = 0;
  let totalRestDist = 0;

  let workIntervalIndex = 0;
  let actualEndTime = 0;
  let actualEndDist = 0;

  for (let i = 0; i < workout.intervals.length; i++) {
    const appInterval = workout.intervals[i];

    if (appInterval.phase === 'rest') continue;

    const boundary = boundaries.find(b => b.index === i);
    const startTime = boundary?.startTime || 0;
    
    const isTimeBased = appInterval.type === 'time';
    
    let intervalStrokes = [];
    if (strokes && strokes.length > 0) {
      if (isTimeBased) {
        const filterStartTime = actualEndTime;
        const filterEndTime = filterStartTime + appInterval.val;
        
        intervalStrokes = strokes.filter(s => {
          const strokeTime = s.t / 10;
          return strokeTime >= filterStartTime && strokeTime < filterEndTime;
        });
        
        actualEndTime = filterEndTime;
        if (intervalStrokes.length > 0) {
          actualEndDist = intervalStrokes[intervalStrokes.length - 1].d / 10;
        }
      } else {
        const filterStartDist = actualEndDist;
        const filterEndDist = filterStartDist + appInterval.val;
        
        intervalStrokes = strokes.filter(s => {
          const strokeDist = s.d / 10;
          return strokeDist >= filterStartDist && strokeDist < filterEndDist;
        });
        
        if (intervalStrokes.length > 0) {
          actualEndDist = intervalStrokes[intervalStrokes.length - 1].d / 10;
          actualEndTime = intervalStrokes[intervalStrokes.length - 1].t / 10;
        } else {
          actualEndDist = filterEndDist;
        }
      }
    }

    const intervalData = {
      type: appInterval.type === 'distance' ? 'distance' : 'time',
      distance: 0,
      time: 0,
      rest_time: 0,
      rest_distance: 0,
    };

    if (appInterval.type === 'distance') {
      intervalData.distance = Math.round(appInterval.val);
    } else {
      intervalData.time = Math.round(appInterval.val * 10);
    }

    const capturedSplit = capturedSplits.find(s => s.splitNumber === workIntervalIndex + 1);
    if (capturedSplit) {
      intervalData.distance = Math.round(capturedSplit.distance || intervalData.distance);
      intervalData.time = Math.round((capturedSplit.time || 0) * 10) || intervalData.time;
    } else if (intervalStrokes.length > 0) {
      const firstStroke = intervalStrokes[0];
      const lastStroke = intervalStrokes[intervalStrokes.length - 1];

      if (appInterval.type === 'distance') {
        intervalData.time = lastStroke.t - firstStroke.t;
      } else {
        intervalData.distance = Math.round((lastStroke.d - firstStroke.d) / 10);
      }

      const avgSPM = intervalStrokes.reduce((sum, s) => sum + (s.spm || 0), 0) / intervalStrokes.length;
      if (avgSPM > 0) intervalData.stroke_rate = Math.round(avgSPM);

      const hrValues = intervalStrokes.filter(s => s.hr && s.hr < 255).map(s => s.hr);
      if (hrValues.length > 0) {
        intervalData.heart_rate = {
          average: Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length),
          ending: hrValues[hrValues.length - 1]
        };
      }
    }

    const nextInterval = workout.intervals[i + 1];
    if (nextInterval && nextInterval.phase === 'rest') {
      if (nextInterval.type === 'time') {
        intervalData.rest_time = Math.round((nextInterval.val || 0) * 10);
        totalRestTime += intervalData.rest_time;
      }
      if (nextInterval.type === 'distance') {
        intervalData.rest_distance = Math.round(nextInterval.val || 0);
        totalRestDist += intervalData.rest_distance;
      }
    }

    intervals.push(intervalData);
    workIntervalIndex++;
  }

  let strokeData = strokes;
  if (strokes && strokes.length > 0) {
    strokeData = [];

    workIntervalIndex = 0;
    actualEndTime = 0;
    actualEndDist = 0;

    for (let i = 0; i < workout.intervals.length; i++) {
      const appInterval = workout.intervals[i];
      if (appInterval.phase === 'rest') continue;

      const isTimeBased = appInterval.type === 'time';
      
      let intervalStrokes = [];
      
      if (isTimeBased) {
        const filterStartTime = actualEndTime;
        const filterEndTime = filterStartTime + appInterval.val;
        
        intervalStrokes = strokes.filter(s => {
          const strokeTime = s.t / 10;
          return strokeTime >= filterStartTime && strokeTime < filterEndTime;
        });
        
        actualEndTime = filterEndTime;
        if (intervalStrokes.length > 0) {
          actualEndDist = intervalStrokes[intervalStrokes.length - 1].d / 10;
        }
      } else {
        const filterStartDist = actualEndDist;
        const filterEndDist = filterStartDist + appInterval.val;
        
        intervalStrokes = strokes.filter(s => {
          const strokeDist = s.d / 10;
          return strokeDist >= filterStartDist && strokeDist < filterEndDist;
        });
        
        if (intervalStrokes.length > 0) {
          actualEndDist = intervalStrokes[intervalStrokes.length - 1].d / 10;
          actualEndTime = intervalStrokes[intervalStrokes.length - 1].t / 10;
        } else {
          actualEndDist = filterEndDist;
        }
      }

      const baseT = intervalStrokes.length > 0 ? intervalStrokes[0].t : 0;
      const baseD = intervalStrokes.length > 0 ? intervalStrokes[0].d : 0;

      intervalStrokes.forEach(s => {
        strokeData.push({
          t: Math.max(0, s.t - baseT),
          d: Math.max(0, s.d - baseD),
          p: s.p,
          spm: s.spm,
          hr: s.hr
        });
      });

      workIntervalIndex++;
    }
  }

  return {
    intervals: intervals.length > 0 ? intervals : null,
    strokeData,
    totalRestTime,
    totalRestDist
  };
}

export async function uploadToConcept2(workout, strokes) {
  const token = await getAccessToken();

  let workoutType = 'JustRow';
  let isIntervalWorkout = false;

  const hasMultipleIntervals = workout.intervals && workout.intervals.length > 1;
  const hasSingleInterval = workout.intervals && workout.intervals.length === 1;

  if (hasMultipleIntervals) {
    workoutType = 'VariableInterval';
    isIntervalWorkout = true;
  } else if (hasSingleInterval) {
    const iv = workout.intervals[0];
    if (iv.type === 'time') {
      workoutType = 'FixedTimeSplits';
    } else if (iv.type === 'distance') {
      workoutType = 'FixedDistanceSplits';
    }
  }

  const heartRateData = {};
  if (workout.avgHR)  heartRateData.average = Math.round(workout.avgHR);
  if (workout.peakHR) heartRateData.max     = Math.round(workout.peakHR);

  const payload = {
    date:         new Date(workout.date).toISOString().slice(0, 19).replace('T', ' '),
    timezone:     Intl.DateTimeFormat().resolvedOptions().timeZone,
    distance:     Math.round(workout.distance),
    time:         Math.round(workout.duration * 10),
    type:         'rower',
    workout_type: workoutType,
    weight_class: 'H',
    comments:     'Uploaded from Rowing Pacer PWA',
  };

  if (workout.avgSPM)    payload.stroke_rate    = Math.round(workout.avgSPM);
  if (workout.strokes)   payload.stroke_count   = Math.round(workout.strokes);
  if (workout.calories)  payload.calories_total = Math.round(workout.calories);
  if (Object.keys(heartRateData).length > 0) payload.heart_rate = heartRateData;

  if (workout.dragFactor) {
    payload.drag_factor = Math.round(workout.dragFactor);
  }

  const boundaries = buildIntervalBoundaries(workout);
  const { intervals: intervalData, strokeData, totalRestTime, totalRestDist } = buildIntervalData(workout, strokes, boundaries);

  if (isIntervalWorkout) {
    payload.rest_time = totalRestTime;
    payload.rest_distance = totalRestDist;
  }

  if (intervalData) {
    payload.workout = { intervals: intervalData };
  }

  if (strokeData && strokeData.length > 0) {
    payload.stroke_data = strokeData.map(s => ({
      t:   s.t,
      d:   s.d,
      p:   s.p,
      spm: s.spm,
      hr:  s.hr
    }));
  }

  console.log('[C2] Upload payload:', JSON.stringify(payload, null, 2));

  const res = await fetch(CONFIG.BASE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
      'Accept':        'application/vnd.c2logbook.v1+json'
    },
    body: JSON.stringify(payload)
  });

  const contentType = res.headers.get('content-type') || '';
  let result;
  if (contentType.includes('application/json')) {
    result = await res.json();
  } else {
    const text = await res.text();
    throw new Error(`Upload failed (HTTP ${res.status}): unexpected response — ${text.slice(0, 100)}`);
  }

  if (!res.ok) {
    throw new Error(result.message || `Upload failed (HTTP ${res.status})`);
  }

  return result.data.id;
}