// Voice capture page — fallback when the active tab is non-injectable (new tab, etc.).
// Background finds a real website tab, briefly activates it for the mic permission
// prompt, injects csVoiceStart there, then switches back here.
// Results arrive as chrome.runtime messages from that tab's content script.

const micWrap      = document.getElementById("mic-wrap");
const statusEl     = document.getElementById("status");
const transcriptEl = document.getElementById("transcript");
const interimEl    = document.getElementById("interim");
const wordCountEl  = document.getElementById("word-count");
const brainSelect  = document.getElementById("brain-select");
const doneBtn      = document.getElementById("done-btn");
const cancelBtn    = document.getElementById("cancel-btn");
const saveStatus   = document.getElementById("save-status");

let accumulated = "";

function updateWordCount() {
  const n = accumulated.trim().split(/\s+/).filter(Boolean).length;
  wordCountEl.textContent = n > 0 ? `${n} word${n !== 1 ? "s" : ""}` : "";
}

// ── Load brains into selector ────────────────────────────────────────────────
chrome.runtime.sendMessage({ action: "getBrains" }, (response) => {
  brainSelect.innerHTML = "";
  if (!response?.success || !response.brains?.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No brains configured";
    brainSelect.appendChild(opt);
    return;
  }
  response.brains.forEach(brain => {
    const opt = document.createElement("option");
    opt.value = brain.id;
    opt.textContent = brain.name;
    brainSelect.appendChild(opt);
  });
  // Pre-select whatever was last used in the popup
  chrome.storage.local.get("lastBrainId", ({ lastBrainId }) => {
    if (lastBrainId) brainSelect.value = lastBrainId;
  });
});

// ── Voice messages from csVoiceStart in the relay tab ───────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.action) {
    case "voiceStarted":
      statusEl.textContent = "Listening…";
      statusEl.className   = "";
      micWrap.classList.add("recording");
      doneBtn.disabled = !accumulated; // enable once there's something to save
      break;

    case "voiceResult":
      if (msg.finalText) {
        const sep = accumulated && !accumulated.endsWith(" ") ? " " : "";
        accumulated += sep + msg.finalText.trim();
        transcriptEl.textContent = accumulated;
        updateWordCount();
        transcriptEl.parentElement.scrollTop = transcriptEl.parentElement.scrollHeight;
        doneBtn.disabled = false;
      }
      interimEl.textContent = msg.interim || "";
      break;

    case "voiceError":
      micWrap.classList.remove("recording");
      interimEl.textContent = "";
      statusEl.className = "error";
      if (msg.error === "not-allowed" || msg.error === "service-not-allowed") {
        statusEl.textContent = "Mic access denied on the relay tab — grant permission there and try again.";
      } else if (msg.error === "not-supported") {
        statusEl.textContent = "Speech recognition not supported in this browser.";
      } else {
        statusEl.textContent = `Error: ${msg.error}`;
      }
      break;

    case "voiceStopped":
      interimEl.textContent = "";
      micWrap.classList.remove("recording");
      break;
  }
});

// ── Ask background to relay voice through an injectable tab ─────────────────
chrome.runtime.sendMessage({ action: "startVoiceRelay" }, (response) => {
  if (chrome.runtime.lastError || !response?.success) {
    statusEl.textContent = response?.error === "no-relay-tab"
      ? "Open any webpage in another tab, then try again."
      : `Error: ${response?.error || "Could not start recording"}`;
    statusEl.className = "error";
    micWrap.classList.remove("recording");
    return;
  }
  statusEl.textContent = "Waiting for mic permission on the other tab…";
});

// ── Save ─────────────────────────────────────────────────────────────────────
doneBtn.addEventListener("click", () => {
  const brainId = brainSelect.value;
  const content = accumulated.trim();
  if (!content) { window.close(); return; }
  if (!brainId) {
    saveStatus.textContent = "Please select a brain first.";
    saveStatus.className = "error";
    saveStatus.style.display = "block";
    return;
  }

  chrome.runtime.sendMessage({ action: "stopVoice" });

  doneBtn.disabled    = true;
  cancelBtn.disabled  = true;
  saveStatus.style.display = "block";
  saveStatus.className = "";
  saveStatus.textContent = "Saving…";

  const today     = new Date().toISOString().slice(0, 10);
  const dateLabel = new Date().toLocaleDateString();

  chrome.runtime.sendMessage(
    {
      action: "clip",
      data: {
        title:       `Thought – ${dateLabel}`,
        markdown:    content,
        url:         "",
        clippedDate: today,
        tags:        [],
        imageUrls:   [],
        brainId,
        sourceType:  "thought"
      }
    },
    (response) => {
      if (response?.success) {
        saveStatus.className = "success";
        saveStatus.textContent = `Saved to ${response.brainName} ✓`;
        setTimeout(() => window.close(), 1200);
      } else {
        saveStatus.className = "error";
        saveStatus.textContent = response?.error || "Save failed";
        doneBtn.disabled   = false;
        cancelBtn.disabled = false;
      }
    }
  );
});

cancelBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "stopVoice" });
  window.close();
});
