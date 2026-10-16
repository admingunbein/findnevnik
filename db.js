(function (global) {
  'use strict';

  const DB_NAME = 'findnevnik-pwa';
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('expenses')) {
          const store = db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
          store.createIndex('spentAt', 'spentAt', { unique: false });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('recurringKey', 'recurringKey', { unique: true });
        }
        if (!db.objectStoreNames.contains('subscriptions')) {
          db.createObjectStore('subscriptions', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(storeName, mode, callback) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let callbackResult;
      try {
        callbackResult = callback(store, transaction);
      } catch (err) {
        reject(err);
        return;
      }
      transaction.oncomplete = () => resolve(callbackResult);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
    });
  }

  async function getAll(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function getById(storeName, id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(Number(id));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function addExpense(expense) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction('expenses', 'readwrite').objectStore('expenses').add(expense);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function putExpense(expense) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction('expenses', 'readwrite').objectStore('expenses').put(expense);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteExpense(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction('expenses', 'readwrite').objectStore('expenses').delete(Number(id));
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function addSubscription(sub) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction('subscriptions', 'readwrite').objectStore('subscriptions').add(sub);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function putSubscription(sub) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction('subscriptions', 'readwrite').objectStore('subscriptions').put(sub);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteSubscription(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction('subscriptions', 'readwrite').objectStore('subscriptions').delete(Number(id));
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function getRecurringKey(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const index = db.transaction('expenses', 'readonly').objectStore('expenses').index('recurringKey');
      const req = index.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function setSetting(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction('settings', 'readwrite').objectStore('settings').put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function getSetting(key, fallback = null) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction('settings', 'readonly').objectStore('settings').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearStore(name) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(name, 'readwrite').objectStore(name).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function exportAll() {
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      expenses: await getAll('expenses'),
      subscriptions: await getAll('subscriptions'),
      settings: await getAll('settings'),
    };
  }

  async function importAll(payload) {
    if (!payload || !Array.isArray(payload.expenses) || !Array.isArray(payload.subscriptions)) {
      throw new Error('Некорректный файл резервной копии');
    }
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['expenses', 'subscriptions', 'settings'], 'readwrite');
      const expStore = transaction.objectStore('expenses');
      const subStore = transaction.objectStore('subscriptions');
      const setStore = transaction.objectStore('settings');
      expStore.clear();
      subStore.clear();
      setStore.clear();
      for (const item of payload.expenses) expStore.put(item);
      for (const item of payload.subscriptions) subStore.put(item);
      for (const item of (payload.settings || [])) setStore.put(item);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Import aborted'));
    });
  }

  global.FinDB = {
    openDb,
    getAll,
    getById,
    addExpense,
    putExpense,
    deleteExpense,
    addSubscription,
    putSubscription,
    deleteSubscription,
    getRecurringKey,
    setSetting,
    getSetting,
    exportAll,
    importAll,
    clearStore,
  };
})(window);
