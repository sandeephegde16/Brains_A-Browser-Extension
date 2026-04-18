// Background service worker — Drive API, OAuth, clip handler, context menus, brain management

// ─── Context menu setup ───────────────────────────────────────────────────────

// Rebuild "Save selection to Brain ▶ BrainName" sub-menu from brainsCache.
// Called on install, and whenever the brain list changes.
let rebuildInProgress = false;
async function rebuildContextMenuBrains() {
  if (rebuildInProgress) return;
  rebuildInProgress = true;
  await new Promise(resolve => chrome.contextMenus.removeAll(resolve));

  chrome.contextMenus.create({
    id: "brains-parent",
    title: "Save selection to Brain",
    contexts: ["selection"]
  });

  const { brainsCache = [] } = await chrome.storage.local.get("brainsCache");

  if (brainsCache.length === 0) {
    chrome.contextMenus.create({
      id: "brains-none",
      parentId: "brains-parent",
      title: "No brains — open Options to create one",
      contexts: ["selection"],
      enabled: false
    });
    return;
  }

  for (const brain of brainsCache) {
    chrome.contextMenus.create({
      id: `brain-${brain.id}`,
      parentId: "brains-parent",
      title: brain.name,
      contexts: ["selection"]
    });
  }
  rebuildInProgress = false;
}

chrome.runtime.onInstalled.addListener(() => rebuildContextMenuBrains());

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.menuItemId.startsWith("brain-")) return;
  const brainId = info.menuItemId.slice("brain-".length);

  try {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["lib/readability.js", "lib/turndown.js", "content/content-script.js"]
      });
    } catch (_) { /* already injected */ }

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return null;

        const container = document.createElement("div");
        for (let i = 0; i < sel.rangeCount; i++) {
          container.appendChild(sel.getRangeAt(i).cloneContents());
        }

        const imageUrls = [];
        for (const img of container.querySelectorAll("img[src]")) {
          const src = img.src;
          if (src.startsWith("http://") || src.startsWith("https://")) {
            imageUrls.push(src);
          }
        }

        const turndown = new TurndownService({
          headingStyle: "atx",
          codeBlockStyle: "fenced",
          bulletListMarker: "-",
          emDelimiter: "*"
        });
        return {
          markdown: turndown.turndown(container.innerHTML),
          title: document.title,
          imageUrls: [...new Set(imageUrls)]
        };
      }
    });

    if (!result?.result) return;

    await handleClip({
      title: result.result.title,
      markdown: result.result.markdown,
      url: tab.url,
      clippedDate: new Date().toISOString().slice(0, 10),
      tags: [],
      imageUrls: result.result.imageUrls || [],
      brainId
    });

    chrome.action.setBadgeText({ text: "OK", tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#28a745", tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: tab.id }), 2000);
  } catch (err) {
    chrome.action.setBadgeText({ text: "ERR", tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#dc3545", tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: tab.id }), 3000);
    console.error("Save selection failed:", err);
  }
});

// ─── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "clip") {
    // Keep service worker alive during long uploads (e.g. many images)
    const keepalive = setInterval(
      () => chrome.storage.local.set({ _clipKeepalive: Date.now() }),
      20000
    );
    handleClip(message.data)
      .then(result => {
        clearInterval(keepalive);
        try { sendResponse({ success: true, ...result }); } catch (_) { /* popup already closed */ }
      })
      .catch(err => {
        clearInterval(keepalive);
        try { sendResponse({ success: false, error: err.message }); } catch (_) { /* popup already closed */ }
      });
    return true;
  }
  if (message.action === "getHistory") {
    getClipHistory()
      .then(history => sendResponse({ success: true, history }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.action === "setupBrains") {
    setupBrains()
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.action === "getBrains") {
    getBrains()
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.action === "createBrain") {
    createBrain(message.name)
      .then(brain => sendResponse({ success: true, brain }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.action === "deleteBrain") {
    deleteBrain(message.brainId)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.action === "generateWiki") {
    const brainId = message.brainId;

    chrome.storage.local.set({ wikiProgress: { brainId, state: "generating", ts: Date.now() } });

    // Keep service worker alive during Drive + Gemini calls
    const keepalive = setInterval(
      () => chrome.storage.local.set({ _wikiKeepalive: Date.now() }),
      20000
    );

    generateWiki(brainId)
      .then(result => {
        clearInterval(keepalive);
        chrome.storage.local.set({ wikiProgress: { brainId, state: "done", ...result, ts: Date.now() } });
        try { sendResponse({ success: true, ...result }); } catch (_) { /* popup already closed */ }
      })
      .catch(err => {
        clearInterval(keepalive);
        chrome.storage.local.set({ wikiProgress: { brainId, state: "error", error: err.message, ts: Date.now() } });
        try { sendResponse({ success: false, error: err.message }); } catch (_) { /* popup already closed */ }
      });

    return true;
  }
  if (message.action === "startVoice") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const injectable = tab?.url && !/^(chrome|chrome-extension|about|data):/.test(tab.url);

        if (!injectable) {
          const captureTab = await chrome.tabs.create({
            url: chrome.runtime.getURL("voice-capture/capture.html"),
            active: true
          });
          capturePageTabId = captureTab.id;
          try { sendResponse({ success: true, captureTab: true }); } catch (_) {}
          return;
        }

        voiceTabId = tab.id;
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: csVoiceStart });
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
  if (message.action === "startVoiceRelay") {
    // Called by the capture page: find a real website tab, briefly activate it
    // (so Chrome can show the mic permission bar), inject csVoiceStart, then
    // switch back to the capture page once recognition starts.
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        const isInjectable = t => t.url && !/^(chrome|chrome-extension|about|data):/.test(t.url);
        const relay = all.find(t => t.id !== capturePageTabId && isInjectable(t));

        if (!relay) {
          sendResponse({ success: false, error: "no-relay-tab" });
          return;
        }

        voiceTabId = relay.id;
        await chrome.tabs.update(relay.id, { active: true });
        await new Promise(r => setTimeout(r, 250));
        await chrome.scripting.executeScript({ target: { tabId: relay.id }, func: csVoiceStart });
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
  if (message.action === "voiceStarted" && capturePageTabId) {
    // Content script confirmed mic is live — switch focus back to the capture page.
    setTimeout(() => {
      chrome.tabs.update(capturePageTabId, { active: true }).catch(() => {});
    }, 500);
  }
  if (message.action === "stopVoice") {
    (async () => {
      if (voiceTabId !== null) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: voiceTabId }, func: csVoiceStop });
        } catch (_) {}
        voiceTabId = null;
      }
      try { sendResponse({ success: true }); } catch (_) {}
    })();
    return true;
  }
});

// ─── Voice: content-script speech recognition ────────────────────────────────
// Injected into the active tab. Chrome shows its standard mic permission bar
// for that website — once per site, then remembered permanently by Chrome.
let voiceTabId     = null;
let capturePageTabId = null;

function csVoiceStart() {
  if (window._brainsRec) { window._brainsRec.stop(); window._brainsRec = null; }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { chrome.runtime.sendMessage({ action: "voiceError", error: "not-supported" }); return; }

  const rec          = new SR();
  rec.continuous     = true;
  rec.interimResults = true;
  rec.lang           = navigator.language || "en-US";
  window._brainsRec  = rec;

  rec.onstart  = () => chrome.runtime.sendMessage({ action: "voiceStarted" });

  rec.onresult = (event) => {
    let finalText = "", interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
      else                          interim   += event.results[i][0].transcript;
    }
    chrome.runtime.sendMessage({ action: "voiceResult", finalText, interim });
  };

  rec.onerror = (event) => {
    if (event.error === "no-speech") return;
    window._brainsRec = null;
    chrome.runtime.sendMessage({ action: "voiceError", error: event.error });
  };

  rec.onend = () => {
    if (window._brainsRec) { try { rec.start(); } catch (_) {} }
    else chrome.runtime.sendMessage({ action: "voiceStopped" });
  };

  try { rec.start(); } catch (e) {
    window._brainsRec = null;
    chrome.runtime.sendMessage({ action: "voiceError", error: e.message });
  }
}

function csVoiceStop() {
  if (window._brainsRec) { window._brainsRec.stop(); window._brainsRec = null; }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
const TOKEN_BUFFER_MS = 5 * 60 * 1000;

async function getAuthToken(interactive = false) {
  const { driveAccessToken: cached, driveTokenExpiry: expiry } =
    await chrome.storage.local.get(["driveAccessToken", "driveTokenExpiry"]);

  if (cached && expiry && Date.now() < expiry - TOKEN_BUFFER_MS) {
    return cached;
  }

  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, async (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message ?? "AUTH_FAILED"));
        return;
      }
      await chrome.storage.local.set({
        driveAccessToken: token,
        driveTokenExpiry: Date.now() + 55 * 60 * 1000,
      });
      resolve(token);
    });
  });
}

async function invalidateToken() {
  const { driveAccessToken: stale } = await chrome.storage.local.get("driveAccessToken");
  if (stale) {
    await new Promise(res => chrome.identity.removeCachedAuthToken({ token: stale }, res));
  }
  await chrome.storage.local.set({ driveAccessToken: null, driveTokenExpiry: 0 });
}

// Drive fetch wrapper — injects auth header, retries once on 401
async function driveRequest(url, options = {}, _retried = false) {
  const token = await getAuthToken(false);
  const resp = await fetch(url, {
    ...options,
    headers: { ...(options.headers ?? {}), Authorization: `Bearer ${token}` }
  });
  if (resp.status === 401 && !_retried) {
    await invalidateToken();
    return driveRequest(url, options, true);
  }
  return resp;
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get({
      defaultTags: "",
      includeImages: true,
      geminiApiKey: ""
    }, resolve);
  });
}

// ─── Clip history ──────────────────────────────────────────────────────────────
async function getClipHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ clipHistory: [] }, (data) => resolve(data.clipHistory));
  });
}

async function addToClipHistory(entry) {
  const history = await getClipHistory();
  history.unshift(entry);
  if (history.length > 10) history.length = 10;
  return new Promise((resolve) => {
    chrome.storage.local.set({ clipHistory: history }, resolve);
  });
}

// ─── Brain management ─────────────────────────────────────────────────────────

// Find an existing Drive folder by name + parent, or create it. Returns folder ID.
async function findOrCreateFolder(name, parentId, token) {
  const safeName   = name.replace(/'/g, "\\'");
  const safeParent = parentId.replace(/'/g, "\\'");
  const query = `name='${safeName}' and '${safeParent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (resp.ok) {
    const data = await resp.json();
    if (data.files?.length > 0) return data.files[0].id;
  }
  const createResp = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] })
    }
  );
  if (!createResp.ok) throw new Error(`Failed to create folder "${name}": ${createResp.status}`);
  return (await createResp.json()).id;
}

// Get or create the Brains/ root folder. Caches the ID locally.
async function getBrainsFolderId(token) {
  const { brainsFolderId } = await chrome.storage.local.get("brainsFolderId");
  if (brainsFolderId) return brainsFolderId;
  const id = await findOrCreateFolder("Brains", "root", token);
  await chrome.storage.local.set({ brainsFolderId: id });
  return id;
}

// One-time migration from global _config.json to local brainsCache.
// Reads old config if present, rebuilds brainsCache with folderId as brain ID.
// Clears old config keys from local storage — does NOT touch Drive files.
async function migrateFromConfig() {
  const { configFileId, configCache } =
    await chrome.storage.local.get(["configFileId", "configCache"]);
  if (!configFileId) return;

  let config = configCache;
  if (!config?.brains) {
    try {
      const resp = await driveRequest(
        `https://www.googleapis.com/drive/v3/files/${configFileId}?alt=media`
      );
      if (resp.ok) config = await resp.json();
    } catch (_) {}
  }

  if (!config?.brains?.length) {
    await chrome.storage.local.remove(["configFileId", "configCache"]);
    return;
  }

  const newCache = config.brains
    .filter(b => b.folderId)
    .map(b => ({
      id:            b.folderId,
      name:          b.name,
      folderId:      b.folderId,
      rawFolderId:   b.rawFolderId  || null,
      wikiFolderId:  b.wikiFolderId || null
    }));

  await chrome.storage.local.set({ brainsCache: newCache });
  await chrome.storage.local.remove(["configFileId", "configCache"]);
  console.log(`Brains: migrated ${newCache.length} brain(s) from _config.json`);
}

// Connect to Drive (OAuth only). Drive folders are created lazily on first brain.
async function setupBrains() {
  const { setupComplete } = await chrome.storage.local.get("setupComplete");
  if (setupComplete) return await getBrains();

  await getAuthToken(true); // trigger OAuth consent
  await chrome.storage.local.set({ setupComplete: true });
  return { setupComplete: true, brains: [] };
}

// List brains from Drive subfolders of Brains/. Refreshes local brainsCache.
// Falls back to cache if Drive is unreachable (e.g. offline).
async function getBrains() {
  const { setupComplete } = await chrome.storage.local.get("setupComplete");
  if (!setupComplete) return { setupComplete: false, brains: [] };

  // One-time migration from old _config.json architecture
  await migrateFromConfig();

  try {
    const token = await getAuthToken(false);
    const brainsFolderId = await getBrainsFolderId(token);

    const query = `'${brainsFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const resp = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&orderBy=createdTime&pageSize=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) throw new Error(`Failed to list brains (${resp.status})`);
    const data = await resp.json();

    const { brainsCache = [] } = await chrome.storage.local.get("brainsCache");

    // Merge Drive list with local cache (cache carries rawFolderId/wikiFolderId for speed)
    const brains = (data.files || []).map(f => {
      const cached = brainsCache.find(c => c.id === f.id);
      return cached
        ? { ...cached, name: f.name }
        : { id: f.id, name: f.name, folderId: f.id };
    });

    await chrome.storage.local.set({ brainsCache: brains });
    rebuildContextMenuBrains(); // keep right-click submenu in sync
    return { setupComplete: true, brains };
  } catch (err) {
    // Fall back to local cache on Drive error
    const { brainsCache = [] } = await chrome.storage.local.get("brainsCache");
    return { setupComplete: true, brains: brainsCache };
  }
}

// Create a brain: Drive folder + raw/ + wiki/ subfolders, update local cache.
// No Drive JSON files are created — Drive folders are the source of truth.
async function createBrain(name) {
  if (!name?.trim()) throw new Error("Brain name cannot be empty");
  const trimmed = name.trim();

  const token = await getAuthToken(false);
  const brainsFolderId = await getBrainsFolderId(token);

  const { brainsCache = [] } = await chrome.storage.local.get("brainsCache");
  if (brainsCache.some(b => b.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`A brain named "${trimmed}" already exists`);
  }

  const brainFolderId = await findOrCreateFolder(trimmed, brainsFolderId, token);
  const rawFolderId   = await findOrCreateFolder("raw",   brainFolderId,  token);
  const wikiFolderId  = await findOrCreateFolder("wiki",  brainFolderId,  token);

  const brain = {
    id: brainFolderId,
    name: trimmed,
    folderId: brainFolderId,
    rawFolderId,
    wikiFolderId
  };
  await chrome.storage.local.set({ brainsCache: [...brainsCache, brain] });
  rebuildContextMenuBrains(); // keep right-click submenu in sync
  return brain;
}

// Remove a brain from local cache. Drive folders are preserved — data stays safe.
async function deleteBrain(brainId) {
  const { brainsCache = [] } = await chrome.storage.local.get("brainsCache");
  await chrome.storage.local.set({
    brainsCache: brainsCache.filter(b => b.id !== brainId)
  });
  rebuildContextMenuBrains(); // keep right-click submenu in sync
}

// ─── Main clip handler ────────────────────────────────────────────────────────
async function handleClip({ title, markdown, url, clippedDate, tags = [], imageUrls = [], brainId, sourceType = "article" }) {
  const settings = await getSettings();
  const { setupComplete } = await chrome.storage.local.get("setupComplete");

  if (!setupComplete) {
    throw new Error("Brains not set up. Open Options to connect to Drive.");
  }

  const { brainsCache = [] } = await chrome.storage.local.get("brainsCache");
  let brain = brainId ? brainsCache.find(b => b.id === brainId) : null;
  if (!brain) brain = brainsCache[0]; // context-menu fallback: use first brain
  if (!brain) throw new Error("No brains configured. Open Options to create one.");

  const token = await getAuthToken(true);

  // rawFolderId may be absent from cache after a cache clear — resolve from Drive
  if (!brain.rawFolderId) {
    brain = {
      ...brain,
      rawFolderId:  await findOrCreateFolder("raw",  brain.folderId, token),
      wikiFolderId: await findOrCreateFolder("wiki", brain.folderId, token)
    };
    const { brainsCache: bc = [] } = await chrome.storage.local.get("brainsCache");
    await chrome.storage.local.set({ brainsCache: bc.map(b => b.id === brain.id ? brain : b) });
  }

  const slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  const dateStr    = clippedDate.replace(/-/g, "");
  const filename   = `${slug}_${dateStr}.md`;
  const capturedAt = new Date().toISOString();
  const wordCount  = markdown.split(/\s+/).filter(Boolean).length;

  const defaultTags = settings.defaultTags
    ? settings.defaultTags.split(",").map(t => t.trim()).filter(Boolean)
    : [];
  const allTags = [...new Set([...defaultTags, ...tags])];

  let updatedMarkdown = markdown;
  const uploadedImages = [];
  if (settings.includeImages && imageUrls.length > 0) {
    const imageFolder = await getOrCreateImageFolder(brain.rawFolderId, token);
    for (const imgUrl of imageUrls) {
      try {
        const result = await uploadImageToDrive(imgUrl, imageFolder, token);
        if (result) {
          uploadedImages.push(result);
          updatedMarkdown = updatedMarkdown.split(imgUrl).join(`images/${result.name}`);
        }
      } catch (err) {
        console.warn("Failed to upload image:", imgUrl, err);
      }
    }
  }

  const frontmatter = [
    "---",
    `title: "${title.replace(/"/g, '\\"')}"`,
    `url: "${url}"`,
    `brain: "${brain.name}"`,
    `source_type: "${sourceType}"`,
    `captured_at: "${capturedAt}"`,
    `tags: [${allTags.map(t => `"${t}"`).join(", ")}]`,
    `word_count: ${wordCount}`,
    uploadedImages.length > 0 ? `images: ${uploadedImages.length}` : null,
    "---",
    "",
  ].filter(line => line !== null).join("\n");

  const file = await saveFileToDrive(
    filename, frontmatter + updatedMarkdown, brain.rawFolderId, token
  );

  await addToClipHistory({
    title,
    url,
    fileName:    file.name,
    fileId:      file.id,
    webViewLink: file.webViewLink,
    clippedDate,
    imageCount:  uploadedImages.length,
    brainName:   brain.name
  });

  return {
    fileId:      file.id,
    fileName:    file.name,
    webViewLink: file.webViewLink,
    imageCount:  uploadedImages.length,
    brainName:   brain.name
  };
}

// ─── Gemini wiki generation ───────────────────────────────────────────────────

const WIKI_MODEL = "gemini-3-flash-preview";

async function callGemini(prompt, apiKey, jsonMode = false) {
  const MAX_RETRIES = 3;
  let lastErr;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 2000 * attempt)); // 2s, 4s
    }

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${WIKI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 32768,
            temperature: 0.3,
            ...(jsonMode ? { responseMimeType: "application/json" } : {})
          }
        })
      }
    );

    if (resp.ok) return resp.json();

    if (resp.status === 429) throw new Error("RATE_LIMIT");
    if (resp.status === 400) throw new Error("BAD_REQUEST");

    // 503 / 502 / 504 — transient; retry
    if (resp.status === 503 || resp.status === 502 || resp.status === 504) {
      lastErr = new Error(`Gemini unavailable (${resp.status}), retrying…`);
      continue;
    }

    throw new Error(`Gemini error (${resp.status})`);
  }

  throw new Error(`Gemini is unavailable (server overloaded). Try again in a moment.`);
}

// Robust JSON parser — handles markdown code blocks Gemini sometimes wraps output in.
function parseGeminiJson(geminiData) {
  const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const block = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (block) { try { return JSON.parse(block[1]); } catch {} }
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  console.warn("parseGeminiJson failed:", text.slice(0, 300));
  return null;
}

function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

// Upsert a markdown file in Drive: update if exists, create if not.
async function upsertTextFile(filename, content, folderId, token) {
  const safeFilename = filename.replace(/'/g, "\\'");
  const query = `name='${safeFilename}' and '${folderId}' in parents and trashed=false`;
  const searchResp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = await searchResp.json();

  if (searchData.files?.length > 0) {
    const fileId = searchData.files[0].id;
    const resp = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,name,webViewLink`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/markdown; charset=UTF-8" },
        body: content
      }
    );
    if (!resp.ok) throw new Error(`Failed to update "${filename}": ${resp.status}`);
    return resp.json();
  }

  const boundary = "-------brains_upsert";
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({ name: filename, mimeType: "text/markdown", parents: [folderId] }),
    `--${boundary}`,
    "Content-Type: text/markdown; charset=UTF-8",
    "",
    content,
    `--${boundary}--`
  ].join("\r\n");

  const resp = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    }
  );
  if (!resp.ok) throw new Error(`Failed to create "${filename}": ${resp.status}`);
  return resp.json();
}

function buildIndexContent(brainName, concepts, updatedAt) {
  return [
    "---",
    `brain: "${brainName}"`,
    `updated_at: "${updatedAt}"`,
    `concepts: ${concepts.length}`,
    "---",
    "",
    `# ${brainName} — Wiki`,
    "",
    `_${concepts.length} concept${concepts.length !== 1 ? "s" : ""} · updated ${updatedAt.slice(0, 10)}_`,
    "",
    "## Pages",
    "",
    ...concepts.map(c => {
      if (!c.updated_at) return `- [${c.title}](${c.slug}.md)`;
      // ISO format from this run: "2026-04-17T13:44:58.434Z" → "2026-04-17 13:44"
      // Display format carried from previous index: "2026-04-17 13:44" → used as-is
      const display = c.updated_at.includes("T")
        ? c.updated_at.slice(0, 16).replace("T", " ")
        : c.updated_at;
      return `- [${c.title}](${c.slug}.md) — ${display}`;
    }),
    ""
  ].join("\n");
}

// Read _index.md and extract last_synced + concept list.
// Returns { last_synced: ISO string | null, concepts: [{slug, title}] }
async function readIndexMd(wikiFolderId, token) {
  const safe = wikiFolderId.replace(/'/g, "\\'");
  const query = `name='_index.md' and '${safe}' in parents and trashed=false`;
  const searchResp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!searchResp.ok) return { last_synced: null, concepts: [] };
  const searchData = await searchResp.json();
  if (!searchData.files?.length) return { last_synced: null, concepts: [] };

  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${searchData.files[0].id}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) return { last_synced: null, concepts: [] };

  const text = await resp.text();
  const tsMatch   = text.match(/^updated_at:\s*"(.+)"/m);
  const last_synced = tsMatch ? tsMatch[1] : null;
  const concepts  = parseIndexConcepts(text);
  return { last_synced, concepts };
}

// Parse the ## Pages section of _index.md into [{slug, title, updated_at}].
// Preserves existing timestamps so untouched concepts keep their date across runs.
function parseIndexConcepts(text) {
  const concepts = [];
  for (const line of text.split("\n")) {
    // matches: - [Title](slug.md) — 2026-04-17 13:44   (timestamp optional)
    const m = line.match(/^\s*-\s+\[(.+?)\]\((.+?)\.md\)(?:\s+[—–]\s+(.+))?/);
    if (m) concepts.push({ title: m[1], slug: m[2], updated_at: m[3]?.trim() || null });
  }
  return concepts;
}

// ─── Wiki generation ──────────────────────────────────────────────────────────
async function generateWiki(brainId) {
  const settings = await getSettings();
  if (!settings.geminiApiKey) throw new Error("NO_GEMINI_KEY");

  const { brainsCache = [] } = await chrome.storage.local.get("brainsCache");
  let brain = brainsCache.find(b => b.id === brainId);
  if (!brain) throw new Error("Brain not found.");

  const token = await getAuthToken(false);

  // Resolve rawFolderId / wikiFolderId from Drive if cache is empty (after cache clear)
  if (!brain.rawFolderId || !brain.wikiFolderId) {
    brain = {
      ...brain,
      rawFolderId:  await findOrCreateFolder("raw",  brain.folderId, token),
      wikiFolderId: await findOrCreateFolder("wiki", brain.folderId, token)
    };
    const { brainsCache: bc = [] } = await chrome.storage.local.get("brainsCache");
    await chrome.storage.local.set({ brainsCache: bc.map(b => b.id === brainId ? brain : b) });
  }

  const wikiFolderId = brain.wikiFolderId;

  // 1. Read _index.md — single call gives us both last_synced and concept list
  const { last_synced, concepts: existingConcepts } = await readIndexMd(wikiFolderId, token);
  const isFirstRun = existingConcepts.length === 0;

  // 2. List all current wiki files — used for slug→fileId map AND orphan cleanup later.
  //    Doing this once avoids N individual file-lookup calls during the append loop.
  const wikiFiles = await listWikiFiles(wikiFolderId);
  const slug2fileId = {};
  for (const f of wikiFiles) {
    if (f.name.endsWith(".md") && f.name !== "_index.md") {
      slug2fileId[f.name.slice(0, -3)] = f.id; // "neural-networks.md" → "neural-networks"
    }
  }

  // 3. List raw clips — first run: all; merge run: only new since last_synced
  let clipQuery = `'${brain.rawFolderId}' in parents and trashed=false`;
  if (!isFirstRun && last_synced) {
    const since = last_synced.replace(/\.\d{3}Z$/, "Z");
    clipQuery += ` and createdTime > '${since}'`;
  }
  const listResp = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(clipQuery)}&fields=files(id,name)&orderBy=createdTime desc&pageSize=50`
  );
  if (!listResp.ok) throw new Error(`Failed to list clips (${listResp.status})`);
  const listData = await listResp.json();
  const files = (listData.files || []).filter(f => f.name.endsWith(".md"));

  if (isFirstRun && files.length === 0)
    throw new Error("No clips in this brain yet. Save some articles first.");

  // No new clips since last generation — nothing to merge
  if (!isFirstRun && files.length === 0) {
    return {
      conceptCount: existingConcepts.length,
      newCount:     0,
      updatedCount: 0,
      clipCount:    0,
      wikiLink:     `https://drive.google.com/drive/folders/${wikiFolderId}`
    };
  }

  // 4. Download clips, cap at char budget
  const CHAR_BUDGET = isFirstRun ? 500_000 : 200_000;
  const clips = [];
  let totalChars = 0;

  for (const file of files) {
    if (totalChars >= CHAR_BUDGET) break;
    try {
      const fileResp = await driveRequest(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`
      );
      if (!fileResp.ok) continue;
      const text = await fileResp.text();
      clips.push(`### ${file.name}\n\n${text}`);
      totalChars += text.length;
    } catch (err) {
      console.warn(`Skipped ${file.name}:`, err);
    }
  }

  if (clips.length === 0) throw new Error("Could not read any clips.");

  const now = new Date().toISOString();
  const updatedConcepts = [];

  if (isFirstRun) {
    // ── First run: full synthesis ─────────────────────────────────────────
    const geminiData = await callGemini(
      buildFullSynthesisPrompt(brain.name, clips), settings.geminiApiKey, true
    );
    if (geminiData.candidates?.[0]?.finishReason === "MAX_TOKENS")
      throw new Error("Gemini response was truncated (output too long). Try with fewer clips.");
    const parsed = parseGeminiJson(geminiData);
    if (!parsed) {
      const snippet = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.slice(0, 120) || "(empty)";
      throw new Error(`Gemini did not return valid concept pages. Raw: ${snippet}`);
    }

    for (const page of (parsed.pages || [])) {
      if (!page.title || !page.content) continue;
      const rawSlug = (page.slug && page.slug.trim() && page.slug !== "undefined")
        ? page.slug : page.title;
      const slug = slugify(rawSlug);
      if (!slug) continue;
      const footer = buildPageFooter(
        mergeRelated([], page.related), mergeSources([], page.sources)
      );
      const body = footer ? `${page.content}\n\n${footer}` : page.content;
      const fileContent = [
        "---",
        `title: "${page.title.replace(/"/g, '\\"')}"`,
        `brain: "${brain.name}"`,
        `updated_at: "${now}"`,
        "---", "", body
      ].join("\n");
      try {
        const file = await upsertTextFile(`${slug}.md`, fileContent, wikiFolderId, token);
        updatedConcepts.push({ slug, title: page.title, fileId: file.id, updated_at: now });
      } catch (err) { console.warn(`Failed to upsert ${slug}.md:`, err); }
    }

  } else {
    // ── Merge run: index-only append ──────────────────────────────────────
    const geminiData = await callGemini(
      buildAppendPrompt(brain.name, clips, existingConcepts), settings.geminiApiKey, true
    );
    if (geminiData.candidates?.[0]?.finishReason === "MAX_TOKENS")
      throw new Error("Gemini response was truncated. Try with fewer clips.");
    const parsed = parseGeminiJson(geminiData);

    // 5a. Create brand-new concept pages
    for (const page of (parsed?.create || [])) {
      if (!page.title || !page.content) continue;
      const rawSlug = (page.slug && page.slug.trim() && page.slug !== "undefined")
        ? page.slug : page.title;
      const slug = slugify(rawSlug);
      if (!slug) continue;
      const footer = buildPageFooter(
        mergeRelated([], page.related), mergeSources([], page.sources)
      );
      const body = footer ? `${page.content}\n\n${footer}` : page.content;
      const fileContent = [
        "---",
        `title: "${page.title.replace(/"/g, '\\"')}"`,
        `brain: "${brain.name}"`,
        `updated_at: "${now}"`,
        "---", "", body
      ].join("\n");
      try {
        const file = await upsertTextFile(`${slug}.md`, fileContent, wikiFolderId, token);
        updatedConcepts.push({ slug, title: page.title, fileId: file.id, updated_at: now });
      } catch (err) { console.warn(`Failed to create ${slug}.md:`, err); }
    }

    // 5b. Append new sections to existing pages.
    //     Use slug2fileId (from wiki folder listing above) to find each file.
    //     Parse footer from file content to merge related/sources without registry.
    for (const item of (parsed?.append || [])) {
      if (!item.slug || !item.section) continue;
      const slug = slugify(item.slug);
      if (!slug) continue;
      const existingConcept = existingConcepts.find(c => c.slug === slug);
      if (!existingConcept) {
        console.warn(`Append target "${slug}" not in index, skipping`);
        continue;
      }
      const fileId = slug2fileId[slug];
      if (!fileId) {
        console.warn(`File for "${slug}" not found in wiki folder, skipping`);
        continue;
      }
      try {
        const resp = await driveRequest(
          `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
        );
        if (!resp.ok) continue;
        const fileText = await resp.text();
        const { related: existingRelated, sources: existingSources } = parsePageFooter(fileText);
        const existingBody = stripPageFooter(fileText);
        const newBody      = existingBody + "\n\n" + item.section.trim();
        const mergedRelated  = mergeRelated(existingRelated, item.related);
        const mergedSources  = mergeSources(existingSources, item.sources);
        const footer = buildPageFooter(mergedRelated, mergedSources);
        const fileContent = [
          "---",
          `title: "${existingConcept.title.replace(/"/g, '\\"')}"`,
          `brain: "${brain.name}"`,
          `updated_at: "${now}"`,
          "---", "",
          footer ? `${newBody}\n\n${footer}` : newBody
        ].join("\n");
        const file = await upsertTextFile(`${slug}.md`, fileContent, wikiFolderId, token);
        updatedConcepts.push({ slug, title: existingConcept.title, fileId: file.id, updated_at: now });
      } catch (err) { console.warn(`Failed to append to ${slug}.md:`, err); }
    }
  }

  if (updatedConcepts.length === 0 && existingConcepts.length === 0) {
    throw new Error("Failed to write any concept pages to Drive. Check the console for details.");
  }

  // 6. Merge updated concepts into full list
  const mergedConcepts = mergeConceptLists(existingConcepts, updatedConcepts);

  // 7. Rebuild _index.md — this is the ONLY persistence needed (no config file)
  await upsertTextFile(
    "_index.md", buildIndexContent(brain.name, mergedConcepts, now), wikiFolderId, token
  );

  // 8. Delete orphan wiki pages — use the folder listing from step 2 (no extra API call)
  try {
    const knownFilenames = new Set(mergedConcepts.map(c => `${c.slug}.md`));
    const orphans = wikiFiles.filter(
      f => f.name.endsWith(".md") && f.name !== "_index.md" && !knownFilenames.has(f.name)
    );
    for (const orphan of orphans) {
      try {
        await driveRequest(
          `https://www.googleapis.com/drive/v3/files/${orphan.id}`,
          { method: "DELETE" }
        );
      } catch (err) {
        console.warn(`Failed to delete orphan ${orphan.name}:`, err);
      }
    }
  } catch (err) {
    console.warn("Orphan cleanup failed:", err);
  }

  const existingSlugs = new Set(existingConcepts.map(c => c.slug));
  const newCount     = updatedConcepts.filter(c => !existingSlugs.has(c.slug)).length;
  const changedCount = updatedConcepts.filter(c =>  existingSlugs.has(c.slug)).length;

  return {
    conceptCount: mergedConcepts.length,
    newCount,
    updatedCount: changedCount,
    clipCount:    clips.length,
    wikiLink:     `https://drive.google.com/drive/folders/${wikiFolderId}`
  };
}

// List all files in the wiki folder (used for slug→fileId map + orphan cleanup).
async function listWikiFiles(wikiFolderId) {
  const safe = wikiFolderId.replace(/'/g, "\\'");
  const resp = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${safe}' in parents and trashed=false`)}&fields=files(id,name)&pageSize=200`
  );
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.files || [];
}

function buildFullSynthesisPrompt(brainName, clips) {
  return `You are building a personal knowledge wiki for a topic area called "${brainName}".

Below are ${clips.length} article clip${clips.length !== 1 ? "s" : ""}. Analyse all the content and identify independent knowledge concepts worth their own wiki pages.

Return a JSON object with this exact shape (the values below are FORMAT EXAMPLES ONLY — replace entirely with content derived from the clips):
{
  "pages": [
    {
      "slug": "sourdough-baking",
      "title": "Sourdough Baking",
      "content": "## Overview\n\nContent here using ## and ### headings.",
      "related": [
        { "title": "Fermentation Science", "slug": "fermentation-science", "reason": "starter cultures rely on controlled fermentation" }
      ],
      "sources": ["beginner-bread-guide_20260101.md"]
    }
  ]
}

Rules:
- Create 2–8 concept pages — one per distinct, self-contained idea or theme
- If there is only one clip, create as many pages as the content genuinely supports
- Each page should stand alone and be useful without reading the others
- Synthesise and connect information across clips rather than summarising a single article
- Slugs: lowercase, hyphens only, max 40 chars
- "related": list OTHER pages in this response that are meaningfully connected; include a short phrase explaining the relationship
- "sources": list the clip filenames (from the ### headers below) that contributed to this page
- Return only the JSON object — no extra explanation

--- CLIPS START ---

${clips.join("\n\n---\n\n")}

--- CLIPS END ---`;
}

// Merge run prompt: new clips + index list (no page content sent to Gemini).
function buildAppendPrompt(brainName, clips, existingConcepts) {
  const indexList = existingConcepts.map(c => `- ${c.slug}: "${c.title}"`).join("\n");

  return `You maintain a concept-based wiki for "${brainName}".

Existing pages (slugs and titles — you do NOT have their content):
${indexList}

New clips to integrate:
--- CLIPS START ---
${clips.join("\n\n---\n\n")}
--- CLIPS END ---

Your tasks:
1. For each existing page the new clips add knowledge to: return only the NEW SECTION(S) to append. Do not rewrite or repeat existing content.
2. For any concept in the clips with no home in the existing pages: return a full new page.

Return JSON (FORMAT EXAMPLES ONLY — replace entirely with content from the clips):
{
  "append": [
    {
      "slug": "sourdough-baking",
      "section": "## Autolyse Technique\n\nNew markdown content to append to this page.",
      "related": [{ "title": "Fermentation Science", "slug": "fermentation-science", "reason": "autolyse relies on enzymatic activity" }],
      "sources": ["advanced-bread_20260101.md"]
    }
  ],
  "create": [
    {
      "slug": "knife-skills",
      "title": "Knife Skills",
      "content": "## Overview\n\nFull page content using ## and ### headings.",
      "related": [{ "title": "Sourdough Baking", "slug": "sourdough-baking", "reason": "both are foundational kitchen skills" }],
      "sources": ["home-cooking-guide_20260101.md"]
    }
  ]
}

Rules:
- "append.slug": must be a slug from the existing pages list above
- "append.section": new content only — do NOT repeat anything the page already contains
- "create": only for concepts with no home in any existing page
- If the clips add nothing new, return { "append": [], "create": [] }
- Slugs: lowercase, hyphens only, max 40 chars
- "related"/"sources": only new entries not already recorded for that page
- Return only the JSON — no extra explanation`;
}

// Merge updated/new concepts into existing list. Existing entries not touched this
// run are kept as-is (preserves index stability across runs).
function mergeConceptLists(existing, updated) {
  const merged = existing.map(c => ({ ...c }));
  for (const concept of updated) {
    const idx = merged.findIndex(c => c.slug === concept.slug);
    if (idx >= 0) {
      merged[idx] = { ...merged[idx], ...concept };
    } else {
      merged.push(concept);
    }
  }
  return merged;
}

// ─── Wiki page footer helpers ─────────────────────────────────────────────────

// Strip footer before appending new content so Gemini never sees it.
function stripPageFooter(content) {
  const idx = content.search(/\n## Related Pages\s*\n|\n## Sources\s*\n/);
  return idx !== -1 ? content.slice(0, idx).trimEnd() : content;
}

// Parse existing ## Related Pages and ## Sources sections from file content.
// Used during merge appends — avoids storing related/sources in any registry file.
function parsePageFooter(content) {
  const related = [];
  const sources = [];

  const relatedMatch = content.match(/\n## Related Pages\s*\n([\s\S]*?)(?=\n## |\s*$)/);
  if (relatedMatch) {
    for (const line of relatedMatch[1].split("\n")) {
      const m = line.match(/^\s*-\s+\[\[(.+?)\]\](?:\s+[—–]\s+(.+))?/);
      if (m) related.push({ title: m[1].trim(), slug: slugify(m[1].trim()), reason: m[2]?.trim() });
    }
  }

  const sourcesMatch = content.match(/\n## Sources\s*\n([\s\S]*?)(?=\n## |\s*$)/);
  if (sourcesMatch) {
    for (const line of sourcesMatch[1].split("\n")) {
      const m = line.match(/^\s*-\s+(.+?)(?:\s+\(scanned .+\))?\s*$/);
      if (m && m[1].trim()) sources.push(m[1].trim());
    }
  }

  return { related, sources };
}

function mergeRelated(existing, incoming) {
  const merged = (existing || []).map(r => ({ ...r }));
  for (const rel of (incoming || [])) {
    if (!rel.title || !rel.slug) continue;
    if (!merged.some(r => r.slug === rel.slug)) merged.push(rel);
  }
  return merged;
}

function mergeSources(existing, incoming) {
  const seen = new Set(existing || []);
  for (const src of (incoming || [])) { if (src) seen.add(src); }
  return [...seen];
}

// Builds ## Related Pages and ## Sources footer using Obsidian [[wiki link]] syntax.
function buildPageFooter(related, sources) {
  const lines = [];

  if (related?.length > 0) {
    lines.push("## Related Pages", "");
    for (const rel of related) {
      if (!rel.title) continue;
      lines.push(`- [[${rel.title}]]${rel.reason ? ` — ${rel.reason}` : ""}`);
    }
    lines.push("");
  }

  if (sources?.length > 0) {
    lines.push("## Sources", "");
    for (const src of sources) {
      const m = src.match(/_(\d{4})(\d{2})(\d{2})\.md$/);
      const date = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
      lines.push(date ? `- ${src} (scanned ${date})` : `- ${src}`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : "";
}

// ─── Image helpers ─────────────────────────────────────────────────────────────
async function getOrCreateImageFolder(parentFolderId, token) {
  const query = `name='images' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchResp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (searchResp.ok) {
    const data = await searchResp.json();
    if (data.files?.length > 0) return data.files[0].id;
  }

  const resp = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "images",
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentFolderId]
      })
    }
  );
  if (!resp.ok) throw new Error("Failed to create images folder");
  return (await resp.json()).id;
}

async function uploadImageToDrive(imageUrl, folderId, token) {
  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) {
    console.warn(`Image fetch failed (${imgResp.status}): ${imageUrl}`);
    return null;
  }

  const contentType = imgResp.headers.get("content-type") || "image/png";
  const blob = await imgResp.arrayBuffer();

  const urlPath  = new URL(imageUrl).pathname;
  const baseName = urlPath.split("/").pop().split("?")[0] || "image.png";
  const hashBuf  = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(imageUrl));
  const hashHex  = [...new Uint8Array(hashBuf)]
    .map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 8);
  const dotIdx     = baseName.lastIndexOf(".");
  const imgFilename = dotIdx > 0
    ? `${baseName.slice(0, dotIdx)}-${hashHex}${baseName.slice(dotIdx)}`
    : `${baseName}-${hashHex}`;

  const boundary  = "-------img_boundary_" + Date.now();
  const metaStr   = JSON.stringify({ name: imgFilename, parents: [folderId] });
  const encoder   = new TextEncoder();
  const metaPart  = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaStr}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
  );
  const endPart = encoder.encode(`\r\n--${boundary}--`);

  const body = new Uint8Array(metaPart.length + blob.byteLength + endPart.length);
  body.set(metaPart, 0);
  body.set(new Uint8Array(blob), metaPart.length);
  body.set(endPart, metaPart.length + blob.byteLength);

  const resp = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    }
  );
  if (!resp.ok) {
    console.warn(`Drive image upload failed (${resp.status}): ${imgFilename}`);
    return null;
  }
  return resp.json();
}

// ─── Save markdown to Drive ────────────────────────────────────────────────────
async function saveFileToDrive(filename, markdownContent, folderId, token) {
  const boundary = "-------brains_boundary";
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({ name: filename, mimeType: "text/markdown", parents: [folderId] }),
    `--${boundary}`,
    "Content-Type: text/markdown; charset=UTF-8",
    "",
    markdownContent,
    `--${boundary}--`
  ].join("\r\n");

  const resp = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    }
  );
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Drive API error (${resp.status}): ${err}`);
  }
  return resp.json();
}
