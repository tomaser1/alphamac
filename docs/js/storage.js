// storage.js: saves finished games on the phone with IndexedDB.
//
// why not localStorage (which the settings use)? it only holds about 5 MB,
// and a year of daily quant games with per-problem times could fill that.
// IndexedDB is the browser's built-in database and holds far more.
//
// IndexedDB's own api is callback-based and clunky, so these few functions
// wrap it in promises. a promise is a value that arrives later, and `await`
// waits for it, much like python's asyncio.

const DB_NAME = "alphamac";
const STORE = "games";

let dbPromise = null;

// opens the database once and reuses it after that
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      // only runs the very first time: creates the "games" table,
      // where every game gets an auto-numbered id
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

// runs fn(store) inside a transaction, then gives back the request's result
async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

// resolves with the new game's id
function saveGame(game) {
  return withStore("readwrite", (store) => store.add(game));
}

// resolves with every saved game, oldest first
function loadGames() {
  return withStore("readonly", (store) => store.getAll());
}

// removes every saved game (settings aren't touched)
function clearGames() {
  return withStore("readwrite", (store) => store.clear());
}

// asks the browser not to clear our data when the phone is low on space.
// best effort: the browser may say no.
function requestPersistence() {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
}

// ---------- backup ----------

// takes the games already in memory (not loaded fresh) on purpose: ios only
// opens the share sheet if it's called straight away after your tap
async function exportGames(games) {
  const json = JSON.stringify({
    app: "alphamac",
    version: 1,
    exportedAt: new Date().toISOString(),
    games,
  });
  const name = `alphamac-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: "application/json" });

  // on iphone: the share sheet, which has "save to files"
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file] });
    return;
  }

  // everywhere else: a normal download
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// adds games from a backup file, skipping any that are already saved.
// a game counts as the same if it ended at the same moment.
async function importGames(file) {
  const data = JSON.parse(await file.text());
  const incoming = Array.isArray(data) ? data : data.games;
  if (!Array.isArray(incoming)) throw new Error("not an alphamac backup");

  const existing = new Set((await loadGames()).map((g) => g.date));
  const fresh = incoming
    .filter((g) => g && g.date && g.mode && Array.isArray(g.problems) && !existing.has(g.date))
    .map(({ id, ...game }) => game); // drop the old id; the database hands out new ones

  await withStore("readwrite", (store) => {
    fresh.forEach((game) => store.add(game));
  });
  return { added: fresh.length, skipped: incoming.length - fresh.length };
}
