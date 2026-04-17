const brainSelect      = document.getElementById("brain-select");
const newBrainRow      = document.getElementById("new-brain-row");
const newBrainInput    = document.getElementById("new-brain-input");
const newBrainConfirm  = document.getElementById("new-brain-confirm");
const newBrainCancel   = document.getElementById("new-brain-cancel");
const wikiBtn          = document.getElementById("wiki-btn");
const wikiStatus       = document.getElementById("wiki-status");
const titleInput       = document.getElementById("title-input");
const tagsInput     = document.getElementById("tags-input");
const tagsList      = document.getElementById("tags-list");
const preview       = document.getElementById("preview");
const clipBtn       = document.getElementById("clip-btn");
const statusArea    = document.getElementById("status-area");
const statusMessage = document.getElementById("status-message");
const driveLink     = document.getElementById("drive-link");
const loading       = document.getElementById("loading");
const loadingText   = document.getElementById("loading-text");
const notConfigured = document.getElementById("status-not-configured");
const openOptions   = document.getElementById("open-options");
const imageInfo     = document.getElementById("image-info");

let extractedData      = null;
let userTags           = [];
let extractionDone     = false;
let brainsReady        = false; // true once brains are loaded and at least one exists
let lastBrainValue     = "";   // restored when user cancels new-brain form

// ─── Tag chip input ───────────────────────────────────────────────────────────
function renderTags() {
  tagsList.innerHTML = "";
  userTags.forEach((tag, idx) => {
    const el = document.createElement("span");
    el.className = "tag";
    el.textContent = tag;
    const remove = document.createElement("span");
    remove.className = "tag-remove";
    remove.textContent = "\u00d7";
    remove.addEventListener("click", () => {
      userTags.splice(idx, 1);
      renderTags();
    });
    el.appendChild(remove);
    tagsList.appendChild(el);
  });
}

tagsInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    const tag = tagsInput.value.trim().replace(/,/g, "");
    if (tag && !userTags.includes(tag)) {
      userTags.push(tag);
      renderTags();
    }
    tagsInput.value = "";
  }
  if (e.key === "Backspace" && !tagsInput.value && userTags.length > 0) {
    userTags.pop();
    renderTags();
  }
});

// ─── Enable clip button once both brains + extraction are ready ───────────────
function maybeEnableClipBtn() {
  if (extractionDone && brainsReady) {
    clipBtn.disabled = false;
  }
}

// ─── Load brains and default tags ─────────────────────────────────────────────
chrome.runtime.sendMessage({ action: "getBrains" }, (response) => {
  if (!response?.success || !response.setupComplete || !response.brains?.length) {
    notConfigured.style.display = "block";
    brainSelect.innerHTML = '<option value="">Not configured</option>';
    return;
  }

  brainSelect.innerHTML = "";
  response.brains.forEach(brain => {
    const opt = document.createElement("option");
    opt.value = brain.id;
    opt.textContent = brain.name;
    brainSelect.appendChild(opt);
  });
  appendNewBrainOption();
  lastBrainValue   = brainSelect.value;
  wikiBtn.disabled = false;

  brainsReady = true;
  maybeEnableClipBtn();
  checkPendingWikiProgress();
});

// Load default tags separately (doesn't require brains to be set up)
chrome.storage.local.get({ defaultTags: "" }, (settings) => {
  if (settings.defaultTags) {
    settings.defaultTags.split(",").map(t => t.trim()).filter(Boolean).forEach(t => {
      if (!userTags.includes(t)) userTags.push(t);
    });
    renderTags();
  }
});

// ─── Inline new-brain form ────────────────────────────────────────────────────
function appendNewBrainOption() {
  const opt = document.createElement("option");
  opt.value = "__new__";
  opt.textContent = "+ New Brain…";
  brainSelect.appendChild(opt);
}

brainSelect.addEventListener("change", () => {
  if (brainSelect.value === "__new__") {
    newBrainRow.style.display = "grid";
    newBrainInput.value = "";
    newBrainInput.focus();
    clipBtn.disabled = true;
    wikiBtn.disabled = true;
  } else {
    lastBrainValue = brainSelect.value;
    wikiBtn.disabled = !brainSelect.value;
    wikiStatus.style.display = "none";
    if (rateLimitTimer) { clearInterval(rateLimitTimer); rateLimitTimer = null; }
    rateLimitRetries = 0;
  }
});

newBrainCancel.addEventListener("click", cancelNewBrain);
newBrainConfirm.addEventListener("click", submitNewBrain);
newBrainInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter")  submitNewBrain();
  if (e.key === "Escape") cancelNewBrain();
});

function cancelNewBrain() {
  newBrainRow.style.display = "none";
  brainSelect.value = lastBrainValue;
  wikiBtn.disabled = !lastBrainValue;
  if (extractionDone && lastBrainValue) clipBtn.disabled = false;
}

function submitNewBrain() {
  const name = newBrainInput.value.trim();
  if (!name) { newBrainInput.focus(); return; }

  newBrainConfirm.disabled    = true;
  newBrainConfirm.textContent = "Adding…";

  chrome.runtime.sendMessage({ action: "createBrain", name }, (response) => {
    newBrainConfirm.disabled    = false;
    newBrainConfirm.textContent = "Add";

    if (!response?.success) {
      showError(response?.error || "Failed to create brain");
      cancelNewBrain();
      return;
    }

    // Insert the new brain before the "+ New Brain…" sentinel option
    const sentinel = brainSelect.querySelector('option[value="__new__"]');
    const opt = document.createElement("option");
    opt.value = response.brain.id;
    opt.textContent = response.brain.name;
    brainSelect.insertBefore(opt, sentinel);

    brainSelect.value  = response.brain.id;
    lastBrainValue     = response.brain.id;
    brainsReady        = true;
    newBrainRow.style.display = "none";
    wikiBtn.disabled   = false;
    maybeEnableClipBtn();
  });
}

openOptions.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// ─── Wiki status helpers ──────────────────────────────────────────────────────
function showWikiResult(result) {
  const link = result.wikiLink
    ? `<a href="${result.wikiLink}" target="_blank" rel="noopener noreferrer">Check in Brain</a>`
    : "";

  const parts = [];
  if (result.newCount > 0)
    parts.push(`${result.newCount} new`);
  if (result.updatedCount > 0)
    parts.push(`${result.updatedCount} updated`);
  if (parts.length === 0)
    parts.push("nothing new");
  parts.push(`${result.clipCount} clip${result.clipCount !== 1 ? "s" : ""}`);

  wikiStatus.style.display = "flex";
  wikiStatus.innerHTML =
    `<span class="wiki-ok">Wiki · ${parts.join(" · ")}</span>${link}`;
}

function showWikiError(code) {
  wikiStatus.style.display = "flex";
  if (code === "NO_GEMINI_KEY") {
    wikiStatus.innerHTML =
      `<span class="wiki-error">No Gemini API key &mdash; ` +
      `<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Get one at AI Studio</a>` +
      `, then <a href="#" id="wiki-open-options">add it in Options</a>.</span>`;
    document.getElementById("wiki-open-options")?.addEventListener("click", (e) => {
      e.preventDefault(); chrome.runtime.openOptionsPage();
    });
  } else if (code === "RATE_LIMIT") {
    startRateLimitCountdown();
  } else if (code === "BAD_REQUEST") {
    wikiStatus.innerHTML =
      `<span class="wiki-error">Invalid API key &mdash; ` +
      `<a href="#" id="wiki-fix-key">Update it in Options</a>.</span>`;
    document.getElementById("wiki-fix-key")?.addEventListener("click", (e) => {
      e.preventDefault(); chrome.runtime.openOptionsPage();
    });
  } else {
    wikiStatus.innerHTML = `<span class="wiki-error">${code || "Wiki generation failed"}</span>`;
  }
}

// Check if wiki was generated (or is generating) while the popup was closed
function checkPendingWikiProgress() {
  chrome.storage.local.get("wikiProgress", ({ wikiProgress }) => {
    if (!wikiProgress) return;
    // Only relevant for the currently selected brain, within the last 10 minutes
    if (wikiProgress.brainId !== brainSelect.value) return;
    if (Date.now() - wikiProgress.ts > 10 * 60 * 1000) return;

    if (wikiProgress.state === "generating") {
      wikiStatus.style.display = "flex";
      wikiStatus.innerHTML = '<div class="spinner"></div><span>Wiki generating in background…</span>';
      wikiBtn.disabled = true;
      // Poll storage until done (popup was reopened mid-run)
      const poll = setInterval(() => {
        chrome.storage.local.get("wikiProgress", ({ wikiProgress: wp }) => {
          if (!wp || wp.state === "generating") return;
          clearInterval(poll);
          wikiBtn.disabled = false;
          if (wp.state === "done") { rateLimitRetries = 0; showWikiResult(wp); }
          else showWikiError(wp.error);
        });
      }, 2000);
    } else if (wikiProgress.state === "done") {
      rateLimitRetries = 0;
      showWikiResult(wikiProgress);
    } else if (wikiProgress.state === "error") {
      showWikiError(wikiProgress.error);
    }
  });
}

// ─── Generate Wiki ────────────────────────────────────────────────────────────
wikiBtn.addEventListener("click", () => {
  const brainId = brainSelect.value;
  if (!brainId || brainId === "__new__") return;

  wikiBtn.disabled         = true;
  wikiStatus.style.display = "flex";
  wikiStatus.innerHTML     = '<div class="spinner"></div><span>Generating wiki…</span>';

  chrome.runtime.sendMessage({ action: "generateWiki", brainId }, (response) => {
    wikiBtn.disabled = false;
    if (!response) return; // popup was closed and reopened — checkPendingWikiProgress handles it

    if (!response.success) {
      showWikiError(response.error);
      return;
    }

    rateLimitRetries = 0;
    showWikiResult(response);
  });
});

// ─── Rate-limit countdown ─────────────────────────────────────────────────────
let rateLimitTimer   = null;
let rateLimitRetries = 0; // reset on success or brain change

function startRateLimitCountdown() {
  if (rateLimitTimer) clearInterval(rateLimitTimer);
  rateLimitRetries++;

  // After 2 back-to-back failures the per-minute window has reset but still fails —
  // most likely daily quota is exhausted. Stop looping and tell the user.
  if (rateLimitRetries >= 2) {
    wikiStatus.style.display = "flex";
    wikiStatus.innerHTML =
      `<span class="wiki-error">Still rate limited — daily quota may be exhausted. ` +
      `<a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer">Check usage in AI Studio</a>. ` +
      `<a href="#" id="wiki-force-retry">Try again</a></span>`;
    document.getElementById("wiki-force-retry")?.addEventListener("click", (e) => {
      e.preventDefault();
      rateLimitRetries = 0;
      wikiBtn.disabled = false;
      wikiBtn.click();
    });
    wikiBtn.disabled = false;
    return;
  }

  let secs = 60;
  const tick = () => {
    wikiStatus.style.display = "flex";
    wikiStatus.innerHTML =
      `<span class="wiki-error">Rate limited &mdash; retrying in ${secs}s…</span>`;
    wikiBtn.disabled = true;

    if (secs <= 0) {
      clearInterval(rateLimitTimer);
      rateLimitTimer = null;
      wikiBtn.disabled = false;
      wikiBtn.click();
    }
    secs--;
  };

  tick();
  rateLimitTimer = setInterval(tick, 1000);
}

// ─── Extract content from the active tab ─────────────────────────────────────
async function extractFromTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["lib/readability.js", "lib/turndown.js", "content/content-script.js"]
    });
  } catch (_) {
    // Scripts may already be injected
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, { action: "extract" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || !response.success) {
        reject(new Error(response?.error || "Failed to extract content"));
        return;
      }
      resolve({ ...response.data, url: tab.url });
    });
  });
}

extractFromTab()
  .then((data) => {
    if (!data) {
      showError("Could not extract content from this page.");
      return;
    }
    extractedData = data;
    titleInput.value = data.title || "";
    preview.value = data.markdown
      ? data.markdown.slice(0, 500) + (data.markdown.length > 500 ? "\n..." : "")
      : "(no content extracted)";

    if (data.imageUrls?.length > 0) {
      imageInfo.textContent = `${data.imageUrls.length} image(s) found — will upload to Drive`;
      imageInfo.style.display = "block";
    }

    extractionDone = true;
    maybeEnableClipBtn();
  })
  .catch((err) => {
    extractionDone = true;
    showError("Extraction failed: " + err.message);
  });

// ─── Clip button ──────────────────────────────────────────────────────────────
clipBtn.addEventListener("click", async () => {
  if (!extractedData) return;

  const brainId = brainSelect.value;
  if (!brainId) {
    showError("Please select a brain first.");
    return;
  }

  clipBtn.disabled = true;
  loading.style.display = "flex";
  statusArea.style.display = "none";
  driveLink.style.display = "none";

  const hasImages = extractedData.imageUrls?.length > 0;
  loadingText.textContent = hasImages ? "Uploading images & saving..." : "Saving...";

  const today = new Date().toISOString().slice(0, 10);

  chrome.runtime.sendMessage(
    {
      action: "clip",
      data: {
        title:       titleInput.value || extractedData.title,
        markdown:    extractedData.markdown,
        url:         extractedData.url,
        clippedDate: today,
        tags:        userTags,
        imageUrls:   extractedData.imageUrls || [],
        brainId
      }
    },
    (response) => {
      loading.style.display = "none";

      if (response?.success) {
        let msg = `Saved to ${response.brainName} as ${response.fileName}`;
        if (response.imageCount > 0) {
          msg += ` (${response.imageCount} image${response.imageCount !== 1 ? "s" : ""} uploaded)`;
        }
        showSuccess(msg);
        if (response.webViewLink) {
          driveLink.href = response.webViewLink;
          driveLink.style.display = "inline-block";
        }
      } else {
        showError(response?.error || "Unknown error");
        clipBtn.disabled = false;
      }
    }
  );
});

// ─── Status helpers ───────────────────────────────────────────────────────────
function showSuccess(msg) {
  statusMessage.textContent = msg;
  statusArea.className      = "status success";
  statusArea.style.display  = "block";
}

function showError(msg) {
  statusMessage.textContent = msg;
  statusArea.className      = "status error";
  statusArea.style.display  = "block";
}
