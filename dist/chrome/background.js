"use strict";

const browserAPI = typeof browser !== "undefined" ? browser : chrome;

// ---- messaging helper: works with both Firefox's Promise-based onMessage
// and Chrome's callback-based one -----------------------------------------
function addAsyncListener(handler) {
  browserAPI.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    let result;
    try {
      result = handler(msg, sender);
    } catch (err) {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
      return false;
    }
    if (result && typeof result.then === "function") {
      result
        .then((value) => sendResponse(value))
        .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
      return true; // keep the message channel open for the async response
    }
    sendResponse(result);
    return false;
  });
}

// ---- cookie matching -------------------------------------------------------
// cookies.getAll({domain}) in both Firefox and Chrome only matches the given
// domain or ITS subdomains, not the other way around — so a cookie set on
// the parent domain (".example.com") is invisible when you query by the
// tab's exact hostname ("www.example.com"). We fetch everything in the
// relevant cookie store and match manually in the direction we actually
// need: "does this site's hostname fall under the cookie's domain?"
function cookieAppliesToHost(cookie, hostname) {
  const base = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
  return hostname === base || hostname.endsWith("." + base);
}

async function getMatchingCookies(hostname, storeId) {
  const query = storeId ? { storeId } : {};
  let all = [];
  try {
    all = await browserAPI.cookies.getAll(query);
  } catch (e) {
    all = await browserAPI.cookies.getAll({});
  }
  return all.filter((c) => cookieAppliesToHost(c, hostname));
}

async function removeCookies(hostname, storeId) {
  const cookies = await getMatchingCookies(hostname, storeId);
  let removed = 0;
  let failed = 0;
  await Promise.all(
    cookies.map(async (c) => {
      const protocol = c.secure ? "https:" : "http:";
      const cookieDomain = c.domain.startsWith(".") ? c.domain.substring(1) : c.domain;
      const url = `${protocol}//${cookieDomain}${c.path}`;
      try {
        const res = await browserAPI.cookies.remove({
          url,
          name: c.name,
          storeId: c.storeId,
        });
        if (res) removed += 1;
        else failed += 1;
      } catch (e) {
        failed += 1;
      }
    })
  );
  return { found: cookies.length, removed, failed };
}

// ---- in-page inspection / clearing -----------------------------------------
// These run inside the target tab via scripting.executeScript. They must be
// self-contained (no closures over outer variables) since they're
// structured-cloned into the page.
function pageInspectFn() {
  const result = {
    localStorage: 0,
    sessionStorage: 0,
    indexedDB: 0,
    cache: 0,
    indexedDBSupported: false,
    cacheSupported: false,
  };
  try {
    result.localStorage = window.localStorage ? window.localStorage.length : 0;
  } catch (e) {}
  try {
    result.sessionStorage = window.sessionStorage ? window.sessionStorage.length : 0;
  } catch (e) {}

  const tasks = [];
  tasks.push(
    (async () => {
      try {
        if (window.indexedDB && typeof window.indexedDB.databases === "function") {
          result.indexedDBSupported = true;
          const dbs = await window.indexedDB.databases();
          result.indexedDB = dbs ? dbs.length : 0;
        }
      } catch (e) {}
    })()
  );
  tasks.push(
    (async () => {
      try {
        if (window.caches && typeof window.caches.keys === "function") {
          result.cacheSupported = true;
          const keys = await window.caches.keys();
          result.cache = keys ? keys.length : 0;
        }
      } catch (e) {}
    })()
  );

  return Promise.all(tasks).then(() => result);
}

function pageClearFn(doLocal, doSession, doIndexedDB, doCache) {
  const report = {
    localStorage: { attempted: doLocal, cleared: false },
    sessionStorage: { attempted: doSession, cleared: false },
    indexedDB: { attempted: doIndexedDB, supported: false, deleted: 0, failed: 0 },
    cache: { attempted: doCache, supported: false, deleted: 0, failed: 0 },
    serviceWorkersUnregistered: 0,
  };

  if (doLocal) {
    try {
      if (window.localStorage) {
        window.localStorage.clear();
        report.localStorage.cleared = true;
      }
    } catch (e) {}
  }

  if (doSession) {
    try {
      if (window.sessionStorage) {
        window.sessionStorage.clear();
        report.sessionStorage.cleared = true;
      }
    } catch (e) {}
  }

  const tasks = [];

  if (doIndexedDB) {
    tasks.push(
      (async () => {
        try {
          if (window.indexedDB && typeof window.indexedDB.databases === "function") {
            report.indexedDB.supported = true;
            const dbs = await window.indexedDB.databases();
            await Promise.all(
              (dbs || [])
                .filter((d) => d && d.name)
                .map(
                  (d) =>
                    new Promise((resolve) => {
                      try {
                        const req = window.indexedDB.deleteDatabase(d.name);
                        req.onsuccess = () => {
                          report.indexedDB.deleted += 1;
                          resolve();
                        };
                        req.onerror = () => {
                          report.indexedDB.failed += 1;
                          resolve();
                        };
                        req.onblocked = () => {
                          report.indexedDB.failed += 1;
                          resolve();
                        };
                      } catch (e) {
                        report.indexedDB.failed += 1;
                        resolve();
                      }
                    })
                )
            );
          }
        } catch (e) {}
      })()
    );
  }

  if (doCache) {
    tasks.push(
      (async () => {
        try {
          if (window.caches && typeof window.caches.keys === "function") {
            report.cache.supported = true;
            const keys = await window.caches.keys();
            await Promise.all(
              (keys || []).map(async (k) => {
                try {
                  const ok = await window.caches.delete(k);
                  if (ok) report.cache.deleted += 1;
                  else report.cache.failed += 1;
                } catch (e) {
                  report.cache.failed += 1;
                }
              })
            );
          }
        } catch (e) {}
      })()
    );
  }

  // Drop service workers on this origin so they don't silently re-seed
  // caches/IDB right after we clear them.
  tasks.push(
    (async () => {
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(
            (regs || []).map(async (r) => {
              try {
                const ok = await r.unregister();
                if (ok) report.serviceWorkersUnregistered += 1;
              } catch (e) {}
            })
          );
        }
      } catch (e) {}
    })()
  );

  return Promise.all(tasks).then(() => report);
}

async function executeInPage(tabId, fn, args) {
  const results = await browserAPI.scripting.executeScript({
    target: { tabId },
    func: fn,
    args: args || [],
  });
  if (!results || !results[0]) {
    throw new Error("Script injection returned no result — the page may block extensions.");
  }
  if (results[0].error) {
    throw new Error(String(results[0].error));
  }
  return results[0].result;
}

// ---- message handlers -------------------------------------------------------
async function handleInspect(msg) {
  const { tabId, hostname, cookieStoreId } = msg;

  const [cookieInfo, pageCounts] = await Promise.all([
    getMatchingCookies(hostname, cookieStoreId).then((c) => c.length),
    executeInPage(tabId, pageInspectFn, []),
  ]);

  return {
    ok: true,
    counts: {
      cookies: cookieInfo,
      cache: pageCounts.cache,
      indexedDB: pageCounts.indexedDB,
      localStorage: pageCounts.localStorage,
      sessionStorage: pageCounts.sessionStorage,
    },
    capabilities: {
      indexedDB: pageCounts.indexedDBSupported,
      cache: pageCounts.cacheSupported,
    },
  };
}

async function handleClear(msg) {
  const { tabId, hostname, cookieStoreId, types } = msg;
  const selected = new Set(types || []);
  const warnings = [];
  const results = {};

  if (selected.has("cookies")) {
    const r = await removeCookies(hostname, cookieStoreId);
    results.cookies = r;
    if (r.failed > 0) warnings.push(`${r.failed} cookie(s) could not be removed.`);
  }

  const doLocal = selected.has("localStorage");
  const doSession = selected.has("sessionStorage");
  const doIndexedDB = selected.has("indexedDB");
  const doCache = selected.has("cache");

  if (doLocal || doSession || doIndexedDB || doCache) {
    const pageReport = await executeInPage(tabId, pageClearFn, [doLocal, doSession, doIndexedDB, doCache]);
    results.page = pageReport;

    if (doIndexedDB && !pageReport.indexedDB.supported) {
      warnings.push("IndexedDB couldn't be enumerated by this browser — nothing was deleted for it.");
    } else if (doIndexedDB && pageReport.indexedDB.failed > 0) {
      warnings.push(`${pageReport.indexedDB.failed} IndexedDB database(s) failed to delete (likely still open in another tab).`);
    }

    if (doCache && !pageReport.cache.supported) {
      warnings.push("Cache Storage isn't available on this page.");
    } else if (doCache && pageReport.cache.failed > 0) {
      warnings.push(`${pageReport.cache.failed} cache(s) failed to delete.`);
    }
  }

  return { ok: true, results, warnings };
}

addAsyncListener((msg) => {
  if (msg && msg.type === "inspect") return handleInspect(msg);
  if (msg && msg.type === "clear") return handleClear(msg);
  return undefined;
});
