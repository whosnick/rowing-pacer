import { log } from './utils.js';

const DB_NAME = 'RowingPacerDB';
const DB_VERSION = 1;
const STORE_NAME = 'workouts';

export const DB = {
    db: null,

    async open() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    // Create store with autoIncrement ID
                    db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
            };

            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve(this.db);
            };

            request.onerror = (e) => {
                log('DB Error: ' + e.target.error);
                reject(e.target.error);
            };
        });
    },

    async saveWorkout(data) {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.add({
                timestamp: Date.now(),
                ...data
            });

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async getAllWorkouts() {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            // Get all, then we will reverse in JS (easier than IDB cursors for small datasets)
            const request = store.getAll();

            request.onsuccess = () => {
                // Sort by ID descending (newest first)
                const res = request.result.sort((a, b) => b.timestamp - a.timestamp);
                resolve(res);
            };
            request.onerror = () => reject(request.error);
        });
    },

    async deleteWorkout(id) {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            store = tx.objectStore(STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    async clearAll() {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
};