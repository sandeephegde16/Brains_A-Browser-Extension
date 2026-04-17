const defaultTagsInput = document.getElementById("default-tags");
const geminiKeyInput   = document.getElementById("gemini-key");
const saveBtn          = document.getElementById("save-btn");
const statusEl         = document.getElementById("status");

const connectSection  = document.getElementById("connect-section");
const connectBtn      = document.getElementById("connect-btn");
const connectHint     = document.getElementById("connect-hint");
const brainsSection   = document.getElementById("brains-section");
const brainsList      = document.getElementById("brains-list");
const newBrainName    = document.getElementById("new-brain-name");
const addBrainBtn     = document.getElementById("add-brain-btn");
const brainsHint      = document.getElementById("brains-hint");

// ─── Load saved settings ──────────────────────────────────────────────────────
chrome.storage.local.get({ defaultTags: "", geminiApiKey: "" }, (settings) => {
  defaultTagsInput.value = settings.defaultTags;
  geminiKeyInput.value   = settings.geminiApiKey;
});

// ─── Check whether brains are already set up ──────────────────────────────────
chrome.runtime.sendMessage({ action: "getBrains" }, (response) => {
  if (response?.success && response.setupComplete) {
    showBrainsSection(response.brains);
  } else {
    showConnectSection();
  }
});

// ─── Connect to Drive ─────────────────────────────────────────────────────────
connectBtn.addEventListener("click", () => {
  connectBtn.disabled    = true;
  connectBtn.textContent = "Connecting…";
  connectHint.textContent = "";
  connectHint.style.color = "";

  chrome.runtime.sendMessage({ action: "setupBrains" }, (response) => {
    connectBtn.disabled    = false;
    connectBtn.textContent = "Connect to Drive";

    if (!response?.success) {
      connectHint.textContent = response?.error || "Failed to connect to Drive.";
      connectHint.style.color = "var(--error-ink)";
      return;
    }

    showBrainsSection(response.brains);
  });
});

// ─── Show / hide panels ───────────────────────────────────────────────────────
function showConnectSection() {
  connectSection.style.display = "block";
  brainsSection.style.display  = "none";
}

function showBrainsSection(brains) {
  connectSection.style.display = "none";
  brainsSection.style.display  = "block";
  renderBrainList(brains);
}

// ─── Brain list ───────────────────────────────────────────────────────────────
function renderBrainList(brains) {
  if (!brains || brains.length === 0) {
    brainsList.innerHTML = '<p class="empty-brains">No brains yet. Add one below.</p>';
    return;
  }

  brainsList.innerHTML = "";
  for (const brain of brains) {
    const item = document.createElement("div");
    item.className = "brain-item";
    item.dataset.brainId = brain.id;
    item.innerHTML = `
      <div class="brain-info">
        <span class="brain-name" title="${escapeHtml(brain.name)}">${escapeHtml(brain.name)}</span>
        <span class="brain-meta">Connected</span>
      </div>
      <button type="button" class="brain-delete btn-secondary"
              data-brain-id="${brain.id}"
              data-brain-name="${escapeHtml(brain.name)}"
              title="Remove brain">&times;</button>
    `;
    brainsList.appendChild(item);
  }

  brainsList.querySelectorAll(".brain-delete").forEach(btn => {
    btn.addEventListener("click", () => handleDeleteBrain(btn));
  });
}

function handleDeleteBrain(btn) {
  const { brainId, brainName } = btn.dataset;
  if (!confirm(`Remove brain "${brainName}" from Brains? Drive folders are kept safe.`)) return;

  btn.disabled = true;
  chrome.runtime.sendMessage({ action: "deleteBrain", brainId }, (response) => {
    if (!response?.success) {
      setBrainsHint(response?.error || "Failed to remove brain.", "error");
      btn.disabled = false;
      return;
    }
    const item = brainsList.querySelector(`[data-brain-id="${brainId}"]`);
    if (item) item.remove();
    if (!brainsList.querySelector(".brain-item")) {
      brainsList.innerHTML = '<p class="empty-brains">No brains yet. Add one below.</p>';
    }
  });
}

// ─── Add brain ────────────────────────────────────────────────────────────────
addBrainBtn.addEventListener("click", () => addBrain());
newBrainName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addBrain();
});

function addBrain() {
  const name = newBrainName.value.trim();
  if (!name) { newBrainName.focus(); return; }

  addBrainBtn.disabled    = true;
  addBrainBtn.textContent = "Adding…";
  setBrainsHint("", "");

  chrome.runtime.sendMessage({ action: "createBrain", name }, (response) => {
    addBrainBtn.disabled    = false;
    addBrainBtn.textContent = "Add";

    if (!response?.success) {
      setBrainsHint(response?.error || "Failed to create brain.", "error");
      return;
    }

    newBrainName.value = "";

    // Reload full list so counts and IDs are current
    chrome.runtime.sendMessage({ action: "getBrains" }, (r) => {
      if (r?.success) renderBrainList(r.brains);
    });
  });
}

function setBrainsHint(msg, type) {
  brainsHint.textContent  = msg;
  brainsHint.style.color  =
    type === "error"   ? "var(--error-ink)"   :
    type === "success" ? "var(--success-ink)" : "var(--muted)";
}

// ─── Save tags + API key ──────────────────────────────────────────────────────
saveBtn.addEventListener("click", () => {
  const defaultTags  = defaultTagsInput.value.trim();
  const geminiApiKey = geminiKeyInput.value.trim();

  chrome.storage.local.set({ defaultTags, geminiApiKey }, () => {
    showStatus("Settings saved.", "success");
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

function showStatus(msg, type) {
  statusEl.textContent  = msg;
  statusEl.className    = type;
  statusEl.style.display = "block";
  setTimeout(() => { statusEl.style.display = "none"; }, 3000);
}
