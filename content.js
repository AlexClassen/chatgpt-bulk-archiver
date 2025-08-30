// ========== Config ==========
const BATCH_SIZE = 8;
const LIST_LIMIT = 50;

// ========== UI (dark-mode friendly) ==========
function ensureStyle() {
  if (document.getElementById("cgpt-style")) return;
  const css = `
  :root{--bg:rgba(255,255,255,.92);--fg:#111;--bd:rgba(0,0,0,.15);--sh:0 8px 24px rgba(0,0,0,.25);--b1:#111;--b1fg:#fff;--b2:transparent;--b2fg:#111;--ac:#7aa2ff}
  @media(prefers-color-scheme:dark){:root{--bg:rgba(22,22,22,.92);--fg:#eaeaea;--bd:rgba(255,255,255,.12);--sh:0 8px 28px rgba(0,0,0,.6);--b1:#eaeaea;--b1fg:#111;--b2:transparent;--b2fg:#eaeaea;--ac:#90b6ff}}
  #cgpt-fab{position:fixed;bottom:18px;right:18px;z-index:2147483647;padding:10px 14px;border-radius:12px;border:1px solid var(--bd);background:var(--bg);color:var(--fg);box-shadow:var(--sh);font:500 14px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;backdrop-filter:blur(6px);cursor:pointer}
  #cgpt-fab:hover{outline:2px solid var(--ac);outline-offset:2px}
  .cgpt-back{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:2147483646}
  .cgpt-modal{width:min(760px,92vw);max-height:80vh;overflow:hidden;background:var(--bg);color:var(--fg);border:1px solid var(--bd);border-radius:16px;box-shadow:var(--sh);display:grid;grid-template-rows:auto 1fr auto}
  .cgpt-modal header,.cgpt-modal footer{padding:14px 16px;border-bottom:1px solid var(--bd)}
  .cgpt-modal footer{border-bottom:none;border-top:1px solid var(--bd);display:flex;gap:10px;justify-content:flex-end}
  .cgpt-body{padding:14px 16px;overflow:auto}
  .cgpt-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .cgpt-sub{opacity:.8;font-size:12px}
  .cgpt-btn{padding:10px 14px;border-radius:10px;border:1px solid var(--bd);background:var(--b1);color:var(--b1fg);cursor:pointer;font:600 14px system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .cgpt-btn.secondary{background:var(--b2);color:var(--b2fg)}
  .cgpt-btn:disabled{opacity:.6;cursor:not-allowed}
  .cgpt-text{width:100%;min-height:240px;resize:vertical;background:transparent;color:var(--fg);border:1px solid var(--bd);border-radius:10px;padding:10px;font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  `;
  const s = document.createElement("style");
  s.id = "cgpt-style"; s.textContent = css; document.documentElement.appendChild(s);
}
function fab() {
  let b = document.getElementById("cgpt-fab");
  if (!b) {
    b = document.createElement("button");
    b.id = "cgpt-fab";
    b.textContent = "List & Archive";
    b.onclick = () => openModal().catch(console.error);
    document.documentElement.appendChild(b);
  }
  return b;
}
function buildModal() {
  const back = document.createElement("div"); back.className = "cgpt-back";
  const m = document.createElement("div"); m.className = "cgpt-modal";
  const h = document.createElement("header");
  h.innerHTML = `<div class="cgpt-row"><strong>Conversations (unarchived)</strong><span class="cgpt-sub" id="cgpt-count"></span></div>`;
  const body = document.createElement("div"); body.className = "cgpt-body";
  body.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:10px;">
      <button class="cgpt-btn secondary" id="cgpt-copy">Copy IDs</button>
      <button class="cgpt-btn secondary" id="cgpt-refresh">Refresh</button>
      <span class="cgpt-sub" id="cgpt-source"></span>
    </div>
    <textarea id="cgpt-ids" class="cgpt-text" readonly spellcheck="false"></textarea>`;
  const f = document.createElement("footer");
  f.innerHTML = `
    <button class="cgpt-btn secondary" id="cgpt-close">Close</button>
    <button class="cgpt-btn" id="cgpt-archive">Archive all</button>`;
  m.append(h, body, f); back.appendChild(m); document.documentElement.appendChild(back);
  return back;
}
function close(back){ back?.remove(); }

// ========== Token ==========
async function getBearer() {
  const { bearer } = await chrome.storage.local.get("bearer");
  return bearer || null;
}

// ========== API helpers ==========
async function apiGET(path, params = {}, bearer) {
  const url = new URL(path, location.origin);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url.toString(), {
    credentials: "include",
    headers: { "authorization": bearer }
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}
async function apiPATCH_Archive(id, bearer) {
  const url = new URL(`/backend-api/conversation/${id}`, location.origin);
  const res = await fetch(url.toString(), {
    method: "PATCH",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "authorization": bearer
    },
    body: JSON.stringify({ is_archived: true })
  });
  if (!res.ok) throw new Error(`PATCH ${id} -> ${res.status}`);
  try { return await res.json(); } catch { return {}; }
}

// ========== Listing ==========
async function listIdsAPI(bearer, { archived = false } = {}) {
  const ids = [];
  let offset = 0;
  while (true) {
    const data = await apiGET("/backend-api/conversations", { offset, limit: LIST_LIMIT, order: "updated", archived }, bearer);
    const items = data.items || data.conversations || [];
    for (const it of items) if (it?.id) ids.push(it.id);
    const hasMore = data.has_more === true ||
      (typeof data.total === "number" && offset + LIST_LIMIT < data.total) ||
      items.length === LIST_LIMIT;
    if (!hasMore) break;
    offset += LIST_LIMIT;
    await new Promise(r => setTimeout(r, 120)); // soft throttle
  }
  return ids;
}

// Optional DOM fallback
function extractIdsDOM(root = document) {
  const ids = new Set();
  const re = /\/c\/([^/?#]+)/i;
  root.querySelectorAll("a[href*='/c/']").forEach(a => {
    const href = a.getAttribute("href") || "";
    const m = href.match(re);
    if (m && m[1]) ids.add(m[1]);
  });
  return Array.from(ids);
}

// ========== Archiving ==========
async function archiveAll(ids, bearer, setBusy) {
  let ok = 0, fail = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    setBusy?.(`Archiving ${i + 1}–${i + batch.length} / ${ids.length}…`);
    await Promise.all(batch.map(async id => {
      try { await apiPATCH_Archive(id, bearer); ok++; }
      catch { fail++; }
    }));
    await new Promise(r => setTimeout(r, 250));
  }
  return { ok, fail };
}

// ========== Modal flow ==========
async function openModal() {
  ensureStyle(); const b = fab();
  if (b.dataset.running === "1") return; b.dataset.running = "1";

  const back = buildModal();
  const idsArea = back.querySelector("#cgpt-ids");
  const count = back.querySelector("#cgpt-count");
  const src = back.querySelector("#cgpt-source");
  const btnCopy = back.querySelector("#cgpt-copy");
  const btnRefresh = back.querySelector("#cgpt-refresh");
  const btnClose = back.querySelector("#cgpt-close");
  const btnArchive = back.querySelector("#cgpt-archive");

  async function load() {
    idsArea.value = "Loading IDs…";
    btnArchive.disabled = true;

    const bearer = await getBearer();
    if (!bearer) {
      idsArea.value = "No token captured yet. Interact with ChatGPT (send a message, refresh), then click Refresh.";
      src.textContent = "source: none (missing token)";
      count.textContent = "";
      return { ids: [], bearer: null, source: "None" };
    }

    // API first
    let ids = [];
    try {
      ids = await listIdsAPI(bearer, { archived: false });
      src.textContent = "source: API";
    } catch {
      // fallback DOM
      ids = extractIdsDOM(document);
      src.textContent = "source: DOM (API failed)";
    }

    idsArea.value = ids.join("\n");
    count.textContent = `${ids.length} conversations`;
    btnArchive.disabled = ids.length === 0;
    return { ids, bearer };
  }

  let state = await load();

  btnCopy.onclick = async () => {
    try { await navigator.clipboard.writeText(idsArea.value); btnCopy.textContent = "Copied!"; setTimeout(()=>btnCopy.textContent="Copy IDs", 1200); }
    catch { idsArea.select(); document.execCommand("copy"); }
  };
  btnRefresh.onclick = async () => { state = await load(); };
  btnClose.onclick = () => { close(back); b.dataset.running = "0"; };

  btnArchive.onclick = async () => {
    if (!state.bearer || state.ids.length === 0) return;
    btnArchive.disabled = true; btnRefresh.disabled = true; btnCopy.disabled = true; btnClose.disabled = true;
    const setBusy = (t) => { count.textContent = t; };
    const { ok, fail } = await archiveAll(state.ids, state.bearer, setBusy);
    count.textContent = `Done. Archived ${ok}/${state.ids.length}${fail ? `, ${fail} failed` : ""}.`;
    btnArchive.textContent = "Close"; btnArchive.classList.add("secondary"); btnArchive.disabled = false;
    btnArchive.onclick = () => { close(back); b.dataset.running = "0"; };
  };
}

// ========== Boot ==========
(function init() {
  ensureStyle(); fab();
  new MutationObserver(() => { ensureStyle(); fab(); })
    .observe(document.documentElement, { childList: true, subtree: true });
})();
