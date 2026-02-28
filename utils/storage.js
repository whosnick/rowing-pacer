// utils/storage.js - IndexedDB storage layer for Rowing Pacer

const DB_NAME = 'RowingPacerDB';
const DB_VERSION = 3;

let db = null;

/**
 * Initialize IndexedDB database
 * @returns {Promise<IDBDatabase>}
 */
export async function initDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      console.log('[Storage] IndexedDB initialized');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Programs store (workout templates)
      if (!database.objectStoreNames.contains('programs')) {
        const programsStore = database.createObjectStore('programs', { keyPath: 'id' });
        programsStore.createIndex('name', 'name', { unique: false });
        programsStore.createIndex('isFavorite', 'isFavorite', { unique: false });
        programsStore.createIndex('created', 'created', { unique: false });
        console.log('[Storage] Created programs store');
      }

      // Workouts store (completed workout metadata)
      if (!database.objectStoreNames.contains('workouts')) {
        const workoutsStore = database.createObjectStore('workouts', { keyPath: 'id' });
        workoutsStore.createIndex('date', 'date', { unique: false });
        workoutsStore.createIndex('name', 'name', { unique: false });
        console.log('[Storage] Created workouts store');
      }

      // BLE Data store (raw datapoints)
      if (!database.objectStoreNames.contains('bleData')) {
        const bleStore = database.createObjectStore('bleData', { 
          keyPath: ['workoutId', 'timestamp', 'type']
        });
        bleStore.createIndex('workoutId', 'workoutId', { unique: false });
        bleStore.createIndex('type', 'type', { unique: false });
        bleStore.createIndex('workoutId_type', ['workoutId', 'type'], { unique: false });
        console.log('[Storage] Created bleData store');
      }

      // Telemetry Chunks store (1 Hz downsampled data)
      if (!database.objectStoreNames.contains('telemetryChunks')) {
        const chunkStore = database.createObjectStore('telemetryChunks', { keyPath: 'id' });
        chunkStore.createIndex('byWorkout', 'workoutId', { unique: false });
        console.log('[Storage] Created telemetryChunks store');
      }

      // Workout Sessions store (workout metadata)
      if (!database.objectStoreNames.contains('workoutSessions')) {
        const sessionStore = database.createObjectStore('workoutSessions', { keyPath: 'id' });
        sessionStore.createIndex('startedAt', 'startedAt', { unique: false });
        console.log('[Storage] Created workoutSessions store');
      }
    };
  });
}

/**
 * Check if IndexedDB is available and initialized
 * @returns {boolean}
 */
function isDBReady() {
  return db !== null;
}

/**
 * Migrate data from LocalStorage to IndexedDB
 * Call this once after initDB()
 */
export async function migrateFromLocalStorage() {
  const migrationKey = 'indexedDBMigrationComplete';
  
  if (localStorage.getItem(migrationKey) === 'true') {
    console.log('[Storage] Migration already completed');
    return;
  }

  console.log('[Storage] Starting migration from LocalStorage...');

  try {
    // Migrate programs
    const customWorkouts = localStorage.getItem('customWorkouts');
    if (customWorkouts) {
      const programs = JSON.parse(customWorkouts);
      const programArray = Object.values(programs);
      
      for (const program of programArray) {
        await saveProgram(program);
      }
      console.log(`[Storage] Migrated ${programArray.length} programs`);
    }

    // Migrate workout history
    const workoutHistory = localStorage.getItem('workoutHistory');
    if (workoutHistory) {
      const workouts = JSON.parse(workoutHistory);
      
      for (const workout of workouts) {
        await saveWorkout(workout);
      }
      console.log(`[Storage] Migrated ${workouts.length} workouts`);
    }

    // Mark migration complete
    localStorage.setItem(migrationKey, 'true');
    console.log('[Storage] Migration complete');
  } catch (error) {
    console.error('[Storage] Migration failed:', error);
    throw error;
  }
}

// ============================================================================
// PROGRAMS
// ============================================================================

/**
 * Save or update a program
 * @param {Object} program
 */
export async function saveProgram(program) {
  if (isDBReady()) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['programs'], 'readwrite');
      const store = transaction.objectStore('programs');
      const request = store.put(program);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } else {
    // Fallback to LocalStorage
    const storageKey = 'customWorkouts';
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    saved[program.id] = program;
    localStorage.setItem(storageKey, JSON.stringify(saved));
    return program.id;
  }
}

/**
 * Get a single program by ID
 * @param {string} id
 */
export async function getProgram(id) {
  if (isDBReady()) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['programs'], 'readonly');
      const store = transaction.objectStore('programs');
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } else {
    // Fallback to LocalStorage
    const storageKey = 'customWorkouts';
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return saved[id] || null;
  }
}

/**
 * Get all programs
 * @returns {Promise<Array>}
 */
export async function getAllPrograms() {
  if (isDBReady()) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['programs'], 'readonly');
      const store = transaction.objectStore('programs');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } else {
    // Fallback to LocalStorage
    const storageKey = 'customWorkouts';
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return Object.values(saved);
  }
}

/**
 * Delete a program
 * @param {string} id
 */
export async function deleteProgram(id) {
  if (isDBReady()) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['programs'], 'readwrite');
      const store = transaction.objectStore('programs');
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } else {
    // Fallback to LocalStorage
    const storageKey = 'customWorkouts';
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    if (saved[id]) {
      delete saved[id];
      localStorage.setItem(storageKey, JSON.stringify(saved));
    }
  }
}

// ============================================================================
// WORKOUTS
// ============================================================================

/**
 * Save or update a workout
 * @param {Object} workout
 */
export async function saveWorkout(workout) {
  if (isDBReady()) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['workouts'], 'readwrite');
      const store = transaction.objectStore('workouts');
      const request = store.put(workout);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } else {
    // Fallback to LocalStorage
    const history = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    history.unshift(workout);
    if (history.length > 50) history.pop();
    localStorage.setItem('workoutHistory', JSON.stringify(history));
    return workout.id;
  }
}

/**
 * Get a single workout by ID
 * @param {number} id
 */
export async function getWorkout(id) {
  if (isDBReady()) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['workouts'], 'readonly');
      const store = transaction.objectStore('workouts');
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } else {
    // Fallback to LocalStorage
    const history = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    return history.find(w => w.id === id) || null;
  }
}

/**
 * Get all workouts sorted by date (newest first)
 * @param {number} limit - Maximum number of workouts to return
 * @returns {Promise<Array>}
 */
export async function getAllWorkouts(limit = 50) {
  if (isDBReady()) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['workouts'], 'readonly');
      const store = transaction.objectStore('workouts');
      const index = store.index('date');
      const request = index.openCursor(null, 'prev');
      
      const workouts = [];
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && workouts.length < limit) {
          workouts.push(cursor.value);
          cursor.continue();
        } else {
          resolve(workouts);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  } else {
    // Fallback to LocalStorage
    const history = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    return history.slice(0, limit);
  }
}

/**
 * Delete a workout and all its BLE data
 * @param {number} id
 */
export async function deleteWorkout(id) {
  if (isDBReady()) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['workouts', 'bleData'], 'readwrite');
      
      // Delete workout
      const workoutStore = transaction.objectStore('workouts');
      workoutStore.delete(id);
      
      // Delete associated BLE data
      const bleStore = transaction.objectStore('bleData');
      const index = bleStore.index('workoutId');
      const request = index.openCursor(IDBKeyRange.only(id));
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          bleStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } else {
    // Fallback to LocalStorage
    let history = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    history = history.filter(w => w.id !== id);
    localStorage.setItem('workoutHistory', JSON.stringify(history));
  }
}

/**
 * Delete oldest workouts if over limit
 * @param {number} maxWorkouts - Maximum number of workouts to keep
 */
export async function enforceWorkoutLimit(maxWorkouts = 50) {
  const workouts = await getAllWorkouts();
  
  if (workouts.length > maxWorkouts) {
    const toDelete = workouts.slice(maxWorkouts);
    
    for (const workout of toDelete) {
      await deleteWorkout(workout.id);
    }
    
    console.log(`[Storage] Deleted ${toDelete.length} old workouts`);
  }
}

// ============================================================================
// BLE DATA
// ============================================================================

/**
 * Save multiple BLE data points in bulk
 * @param {Array} dataPoints
 */
export async function saveBleData(workoutId, strokeArray) {
  if (!db) return;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['bleData'], 'readwrite');
    const store = transaction.objectStore('bleData');
    
    const record = {
      workoutId: workoutId,
      timestamp: Date.now(),
      type: 'concept2_strokes', 
      data: strokeArray         
    };

    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all BLE data for a workout
 * @param {number} workoutId
 * @returns {Promise<Array>} Array of BLE data points sorted by timestamp
 */
export async function getBleDataForWorkout(workoutId) {
  if (isDBReady()) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['bleData'], 'readonly');
      const store = transaction.objectStore('bleData');
      const index = store.index('workoutId');
      const request = index.openCursor(IDBKeyRange.only(workoutId));
      
      const dataPoints = [];
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          dataPoints.push(cursor.value);
          cursor.continue();
        } else {
          // Sort by timestamp
          dataPoints.sort((a, b) => a.timestamp - b.timestamp);
          resolve(dataPoints);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  } else {
    // LocalStorage fallback - return empty array
    return [];
  }
}

// ============================================================================
// WORKOUT SESSIONS (metadata)
// ============================================================================

/**
 * Create a new workout session record
 * @param {string} workoutId
 * @param {Object} initialData - { programId, startedAt }
 */
export async function createWorkoutSession(workoutId, initialData = {}) {
  if (isDBReady()) {
    const session = {
      id: workoutId,
      startedAt: initialData.startedAt || Date.now(),
      finishedAt: null,
      programId: initialData.programId || null,
      summary: null,
      chunkCount: 0,
      strokeCount: 0,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['workoutSessions'], 'readwrite');
      const store = transaction.objectStore('workoutSessions');
      const request = store.put(session);

      request.onsuccess = () => resolve(session);
      request.onerror = () => reject(request.error);
    });
  } else {
    console.warn('[Storage] Cannot create workout session - IndexedDB not ready');
    return null;
  }
}

/**
 * Update an existing workout session
 * @param {string} workoutId
 * @param {Object} patch - Fields to update (finishedAt, summary, chunkCount, strokeCount)
 */
export async function updateWorkoutSession(workoutId, patch) {
  if (isDBReady()) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['workoutSessions'], 'readwrite');
      const store = transaction.objectStore('workoutSessions');
      const getRequest = store.get(workoutId);

      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        if (!existing) {
          console.warn('[Storage] Workout session not found:', workoutId);
          resolve(null);
          return;
        }

        const updated = { ...existing, ...patch };
        const putRequest = store.put(updated);
        putRequest.onsuccess = () => resolve(updated);
        putRequest.onerror = () => reject(putRequest.error);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  } else {
    console.warn('[Storage] Cannot update workout session - IndexedDB not ready');
    return null;
  }
}

/**
 * Get a workout session by ID
 * @param {string} workoutId
 */
export async function getWorkoutSession(workoutId) {
  if (isDBReady()) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['workoutSessions'], 'readonly');
      const store = transaction.objectStore('workoutSessions');
      const request = store.get(workoutId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } else {
    return null;
  }
}

// ============================================================================
// UTILITY
// ============================================================================

/**
 * Clear all data (for testing/debugging)
 */
export async function clearAllData() {
  if (isDBReady()) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        ['programs', 'workouts', 'bleData', 'telemetryChunks', 'workoutSessions'],
        'readwrite'
      );

      transaction.objectStore('programs').clear();
      transaction.objectStore('workouts').clear();
      transaction.objectStore('bleData').clear();
      transaction.objectStore('telemetryChunks').clear();
      transaction.objectStore('workoutSessions').clear();

      transaction.oncomplete = () => {
        console.log('[Storage] All data cleared');
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  } else {
    // Clear LocalStorage fallback data
    localStorage.removeItem('customWorkouts');
    localStorage.removeItem('workoutHistory');
    console.log('[Storage] LocalStorage data cleared');
  }
}
