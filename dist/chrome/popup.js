(() => {
  "use strict";

  const browserAPI = typeof browser !== "undefined" ? browser : chrome;

  const els = {
    faviconImg: document.getElementById("favicon"),
    domain: document.getElementById("domain"),
    protocol: document.getElementById("protocol"),
    unsupported: document.getElementById("unsupported"),
    loading: document.getElementById("loading"),
    content: document.getElementById("content"),
    items: document.getElementById("items"),
    totalLabel: document.getElementById("total-label"),
    clearBtn: document.getElementById("clear-btn"),
    confirmRow: document.getElementById("confirm-row"),
    confirmCount: document.getElementById("confirm-count"),
    confirmDomain: document.getElementById("confirm-domain"),
    cancelBtn: document.getElementById("cancel-btn"),
    confirmBtn: document.getElementById("confirm-btn"),
    doneRow: document.getElementById("done-row"),
    doneIcon: document.getElementById("done-icon"),
    doneText: document.getElementById("done-text"),
    doneNote: document.getElementById("done-note"),
  };

  const TYPES = [
    { key: "cookies", label: "Cookies" },
    { key: "cache", label: "Cache Storage" },
    { key: "indexedDB", label: "IndexedDB" },
    { key: "localStorage", label: "Local Storage" },
    { key: "sessionStorage", label: "Session Storage" },
  ];

  let state = {
    tabId: null,
    hostname: null,
    cookieStoreId: null,
    counts: {},
  };

  function fmtCount(n, singular, plural) {
    if (n === 0) return `No ${plural}`;
    if (n === 1) return `1 ${singular}`;
    return `${n} ${plural}`;
  }

  function countLabel(key, n) {
    switch (key) {
      case "cookies": return fmtCount(n, "cookie", "cookies");
      case "cache": return fmtCount(n, "cache", "caches");
      case "indexedDB": return fmtCount(n, "database", "databases");
      case "localStorage": return fmtCount(n, "item", "items");
      case "sessionStorage": return fmtCount(n, "item", "items");
      default: return "";
    }
  }

  function showState(name) {
    els.unsupported.classList.toggle("hidden", name !== "unsupported");
    els.loading.classList.toggle("hidden", name !== "loading");
    els.content.classList.toggle("hidden", name !== "content");
  }

  async function getActiveTab() {
    const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0];
  }

  function isSupportedUrl(url) {
    return /^https?:\/\//i.test(url);
  }

  function sendToBackground(msg) {
    return browserAPI.runtime.sendMessage(msg);
  }

  function renderItems() {
    els.items.innerHTML = "";
    let total = 0;

    TYPES.forEach(({ key, label }) => {
      const n = state.counts[key] || 0;
      total += n;

      const li = document.createElement("li");
      li.className = "item" + (n === 0 ? " empty" : "");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `chk-${key}`;
      checkbox.checked = n > 0;
      checkbox.disabled = n === 0;
      checkbox.dataset.key = key;
      checkbox.addEventListener("change", updateClearButton);

      const labelWrap = document.createElement("label");
      labelWrap.className = "item-label";
      labelWrap.setAttribute("for", `chk-${key}`);

      const nameEl = document.createElement("span");
      nameEl.className = "item-name";
      nameEl.textContent = label;

      const countEl = document.createElement("span");
      countEl.className = "item-count";
      countEl.textContent = countLabel(key, n);

      labelWrap.appendChild(nameEl);
      labelWrap.appendChild(countEl);

      li.appendChild(checkbox);
      li.appendChild(labelWrap);
      li.addEventListener("click", (e) => {
        if (e.target === checkbox) return;
        if (checkbox.disabled) return;
        checkbox.checked = !checkbox.checked;
        updateClearButton();
      });

      els.items.appendChild(li);
    });

    els.totalLabel.textContent =
      total === 0 ? "Nothing to clear" : `${total} item${total === 1 ? "" : "s"} found for this site`;

    updateClearButton();
  }

  function getSelectedKeys() {
    return TYPES.map((t) => t.key).filter((key) => {
      const chk = document.getElementById(`chk-${key}`);
      return chk && chk.checked && !chk.disabled;
    });
  }

  function updateClearButton() {
    const selected = getSelectedKeys();
    els.clearBtn.disabled = selected.length === 0;
  }

  function labelForKeys(keys) {
    const names = keys.map((k) => TYPES.find((t) => t.key === k).label.toLowerCase());
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  }

  function openConfirm() {
    const selected = getSelectedKeys();
    if (selected.length === 0) return;
    els.confirmDomain.textContent = state.hostname;
    els.confirmCount.textContent = labelForKeys(selected);
    els.clearBtn.classList.add("hidden");
    els.confirmRow.classList.remove("hidden");
  }

  function closeConfirm() {
    els.confirmRow.classList.add("hidden");
    els.clearBtn.classList.remove("hidden");
  }

  function showDone({ ok, text, note, isError }) {
    els.confirmRow.classList.add("hidden");
    els.content.classList.add("hidden");
    els.doneRow.classList.remove("hidden");
    els.doneRow.classList.toggle("is-error", !!isError);
    els.doneIcon.textContent = isError ? "!" : "✓";
    els.doneText.textContent = text;
    if (note) {
      els.doneNote.textContent = note;
      els.doneNote.classList.remove("hidden");
    } else {
      els.doneNote.classList.add("hidden");
    }
  }

  async function performClear() {
    const selected = getSelectedKeys();
    els.confirmBtn.disabled = true;
    els.confirmBtn.textContent = "Deleting…";
    els.cancelBtn.disabled = true;

    let response;
    try {
      response = await sendToBackground({
        type: "clear",
        tabId: state.tabId,
        hostname: state.hostname,
        cookieStoreId: state.cookieStoreId,
        types: selected,
      });
    } catch (e) {
      response = { ok: false, error: String((e && e.message) || e) };
    }

    if (!response || !response.ok) {
      showDone({
        isError: true,
        text: "Something went wrong",
        note: (response && response.error) || "Check the browser console for details.",
      });
      return;
    }

    const warnings = response.warnings || [];
    showDone({
      ok: true,
      text: `Cleared data for ${state.hostname}`,
      note: warnings.length ? warnings.join(" ") : null,
    });

    // Refresh counts in the background so re-opening the popup shows the
    // real post-clear state rather than stale numbers.
    if (!warnings.length) {
      setTimeout(() => window.close(), 1400);
    }
  }

  async function init() {
    showState("loading");

    const tab = await getActiveTab();
    if (!tab || !tab.url || !isSupportedUrl(tab.url)) {
      showState("unsupported");
      els.clearBtn.disabled = true;
      return;
    }

    const url = new URL(tab.url);
    state.tabId = tab.id;
    state.hostname = url.hostname;
    state.cookieStoreId = tab.cookieStoreId || null;

    els.domain.textContent = state.hostname;
    els.protocol.textContent = url.protocol === "https:" ? "Secure connection" : "Not secure";
    if (tab.favIconUrl) {
      els.faviconImg.src = tab.favIconUrl;
    } else {
      els.faviconImg.style.visibility = "hidden";
    }

    let response;
    try {
      response = await sendToBackground({
        type: "inspect",
        tabId: state.tabId,
        hostname: state.hostname,
        cookieStoreId: state.cookieStoreId,
      });
    } catch (e) {
      response = { ok: false, error: String((e && e.message) || e) };
    }

    if (!response || !response.ok) {
      showState("unsupported");
      els.unsupported.querySelector("p").textContent =
        "Couldn't read this site's data.";
      const sub = els.unsupported.querySelector(".muted");
      if (sub) sub.textContent = (response && response.error) || "Try reloading the page and reopening this popup.";
      return;
    }

    state.counts = response.counts;
    renderItems();
    showState("content");
  }

  els.clearBtn.addEventListener("click", openConfirm);
  els.cancelBtn.addEventListener("click", closeConfirm);
  els.confirmBtn.addEventListener("click", performClear);

  document.addEventListener("DOMContentLoaded", init);
  if (document.readyState !== "loading") init();
})();
