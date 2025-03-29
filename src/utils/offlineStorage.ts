/**
 * Utility functions for handling offline data storage using IndexedDB
 */

// IndexedDB database name and version
export const DB_NAME = 'nesttask_offline_db';
export const DB_VERSION = 3; // Update version to 3

// Store names for different types of data
export const STORES = {
  TASKS: 'tasks',
  ROUTINES: 'routines',
  USER_DATA: 'userData',
  COURSES: 'courses',
  MATERIALS: 'materials',
  TEACHERS: 'teachers'
};

/**
 * Initialize the IndexedDB database
 */
export const openDatabase = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event: Event) => {
      console.error('Error opening IndexedDB', event);
      reject('Error opening IndexedDB');
    };

    request.onsuccess = (event: Event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      resolve(db);
    };

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        // Initial schema setup
        if (!db.objectStoreNames.contains(STORES.TASKS)) {
          db.createObjectStore(STORES.TASKS, { keyPath: 'id' });
          console.log('Created tasks store');
        }
        if (!db.objectStoreNames.contains(STORES.ROUTINES)) {
          db.createObjectStore(STORES.ROUTINES, { keyPath: 'id' });
          console.log('Created routines store');
        }
        if (!db.objectStoreNames.contains(STORES.USER_DATA)) {
          db.createObjectStore(STORES.USER_DATA, { keyPath: 'id' });
          console.log('Created userData store');
        }
      }
      
      if (oldVersion < 2) {
        // Version 2 schema updates
        if (!db.objectStoreNames.contains(STORES.COURSES)) {
          db.createObjectStore(STORES.COURSES, { keyPath: 'id' });
          console.log('Created courses store');
        }
        if (!db.objectStoreNames.contains(STORES.MATERIALS)) {
          db.createObjectStore(STORES.MATERIALS, { keyPath: 'id' });
          console.log('Created materials store');
        }
      }
      
      if (oldVersion < 3) {
        // Version 3 schema updates
        if (!db.objectStoreNames.contains(STORES.TEACHERS)) {
          db.createObjectStore(STORES.TEACHERS, { keyPath: 'id' });
          console.log('Created teachers store');
        }
      }
    };
  });
};

/**
 * Save data to IndexedDB
 * @param storeName The name of the store to save data to
 * @param data The data to save
 */
export async function saveToIndexedDB(storeName: string, data: any): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      
      // If data is an array, add each item individually
      if (Array.isArray(data)) {
        data.forEach(item => {
          store.put(item);
        });
      } else {
        // Otherwise, add the single item
        store.put(data);
      }
      
      transaction.oncomplete = () => {
        resolve();
      };
      
      transaction.onerror = (event) => {
        console.error(`Error saving to ${storeName}:`, (event.target as IDBTransaction).error);
        reject((event.target as IDBTransaction).error);
      };
    });
  } catch (error) {
    console.error('IndexedDB save error:', error);
    throw error;
  }
}

/**
 * Get all data from a store in IndexedDB
 * @param storeName The name of the store to get data from
 */
export async function getAllFromIndexedDB(storeName: string): Promise<any[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      
      request.onsuccess = () => {
        resolve(request.result);
      };
      
      request.onerror = (event) => {
        console.error(`Error getting data from ${storeName}:`, (event.target as IDBRequest).error);
        reject((event.target as IDBRequest).error);
      };
    });
  } catch (error) {
    console.error('IndexedDB get error:', error);
    return [];
  }
}

/**
 * Get a specific item by ID from IndexedDB
 * @param storeName The name of the store to get data from
 * @param id The ID of the item to get
 */
export async function getByIdFromIndexedDB(storeName: string, id: string): Promise<any> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(id);
      
      request.onsuccess = () => {
        resolve(request.result);
      };
      
      request.onerror = (event) => {
        console.error(`Error getting item from ${storeName}:`, (event.target as IDBRequest).error);
        reject((event.target as IDBRequest).error);
      };
    });
  } catch (error) {
    console.error('IndexedDB get by ID error:', error);
    return null;
  }
}

/**
 * Delete data from IndexedDB
 * @param storeName The name of the store to delete data from
 * @param id The ID of the item to delete
 */
export async function deleteFromIndexedDB(storeName: string, id: string): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);
      
      request.onsuccess = () => {
        resolve();
      };
      
      request.onerror = (event) => {
        console.error(`Error deleting from ${storeName}:`, (event.target as IDBRequest).error);
        reject((event.target as IDBRequest).error);
      };
    });
  } catch (error) {
    console.error('IndexedDB delete error:', error);
    throw error;
  }
}

/**
 * Clear all data from a store in IndexedDB
 * @param storeName The name of the store to clear
 */
export async function clearIndexedDBStore(storeName: string): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();
      
      request.onsuccess = () => {
        console.log(`Successfully cleared ${storeName} store`);
        resolve();
      };
      
      request.onerror = (event) => {
        console.error(`Error clearing ${storeName}:`, (event.target as IDBRequest).error);
        reject((event.target as IDBRequest).error);
      };
    });
  } catch (error) {
    console.error('IndexedDB clear error:', error);
    throw error;
  }
}

/**
 * Clear all data for a specific user from a store in IndexedDB
 * @param storeName The name of the store to clear
 * @param userId The ID of the user whose data should be cleared
 */
export async function clearUserDataFromStore(storeName: string, userId: string): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.openCursor();
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          // If this item belongs to the user, delete it
          if (cursor.value.userId === userId) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          // Done processing all items
          console.log(`Successfully cleared user ${userId} data from ${storeName} store`);
          resolve();
        }
      };
      
      request.onerror = (event) => {
        console.error(`Error clearing user data from ${storeName}:`, (event.target as IDBRequest).error);
        reject((event.target as IDBRequest).error);
      };
      
      transaction.oncomplete = () => {
        resolve();
      };
    });
  } catch (error) {
    console.error('IndexedDB clear user data error:', error);
    throw error;
  }
}

/**
 * Refresh all IndexedDB data for a user
 * @param userId The ID of the user whose data should be refreshed
 */
export async function refreshUserCache(userId: string): Promise<void> {
  try {
    // Clear localStorage cache timestamps
    Object.keys(localStorage).forEach(key => {
      if (key.includes('_last_fetched') && key.includes(userId)) {
        localStorage.removeItem(key);
      }
    });
    
    // Clear IndexedDB user data
    await clearUserDataFromStore(STORES.TASKS, userId);
    
    console.log(`Successfully refreshed cache for user ${userId}`);
  } catch (error) {
    console.error('Error refreshing user cache:', error);
    throw error;
  }
} 