// One-time mic permission setup for Brains extension.
// Must run in a visible tab (chrome-extension:// origin) so Chrome shows its
// permission dialogs. Both getUserMedia AND webkitSpeechRecognition need to be
// granted separately — granting one does not grant the other in Chrome.

const content = document.getElementById("content");

function show(html) { content.innerHTML = html; }

function errorOut(msg) {
  show(`<h1 class="error-text">Setup failed</h1>
        <p>${msg}</p>
        <div class="note">
          <strong>Check these settings:</strong><br>
          1. <strong>Chrome:</strong> go to <code>chrome://settings/content/microphone</code>
             and make sure <em>"Sites can ask to use your microphone"</em> is ON.<br><br>
          2. <strong>Mac:</strong> System Preferences → Privacy &amp; Security → Microphone
             → ensure Google Chrome is enabled.
        </div>`);
  chrome.runtime.sendMessage({ action: "micSetupDone", success: false, error: "setup-failed" });
}

(async () => {
  // ── Step 1: getUserMedia ─────────────────────────────────────────────────────
  show(`<div class="arrow">↑</div>
        <div class="step-indicator">Step 1 of 2</div>
        <h1>Allow microphone access</h1>
        <p>Look for the permission bar <strong>at the top of this tab</strong> and click <strong>Allow</strong>.</p>`);

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
  } catch (err) {
    errorOut(err.name === "NotAllowedError"
      ? "Microphone access was denied. Make sure Chrome has permission to use the mic (see below)."
      : `Unexpected error: ${err.name} — ${err.message}`);
    return;
  }

  // ── Step 2: webkitSpeechRecognition ──────────────────────────────────────────
  // Chrome treats speech-recognition permission separately from getUserMedia.
  // We start (and immediately stop) a recognition session here so Chrome records
  // the grant for this origin — the offscreen document reuses it silently.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (SR) {
    show(`<div class="arrow">↑</div>
          <div class="step-indicator">Step 2 of 2</div>
          <h1>Allow speech recognition</h1>
          <p>Chrome will show <strong>another permission bar at the top</strong>.
             Click <strong>Allow</strong> once more — this is the last time.</p>`);

    await new Promise((resolve) => {
      const r = new SR();
      r.continuous     = false;
      r.interimResults = false;
      let done         = false;

      const finish = () => { if (!done) { done = true; resolve(); } };

      r.onstart  = () => { setTimeout(() => { try { r.stop(); } catch(_){} }, 400); };
      r.onend    = finish;
      r.onerror  = (e) => {
        // no-speech / aborted just means it started fine but heard nothing — that's OK
        if (e.error !== "not-allowed" && e.error !== "service-not-allowed") { finish(); return; }
        errorOut("Speech recognition access was denied. Click Allow when Chrome asks at the top of this tab.");
        done = true;
      };

      try { r.start(); } catch(e) { finish(); }
    });
  }

  // ── Done ─────────────────────────────────────────────────────────────────────
  await chrome.storage.local.set({ voiceMicGranted: true });
  chrome.runtime.sendMessage({ action: "micSetupDone", success: true });

  show(`<div style="font-size:36px;margin-bottom:14px;">✓</div>
        <h1 class="success">All set!</h1>
        <p>Microphone access granted. This tab will close — return to the Brains extension and tap the mic to start recording.</p>`);

  setTimeout(() => window.close(), 2000);
})();
