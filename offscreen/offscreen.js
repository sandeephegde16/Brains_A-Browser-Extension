// Offscreen document — handles microphone + speech recognition.
// Runs persistently while recording; popup sends startVoice/stopVoice,
// receives voiceStarted / voiceResult / voiceError / voiceStopped broadcasts.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition    = null;
let running        = false;
let errorOccurred  = false; // prevent voiceStopped from overriding voiceError in popup

function startCapture() {
  if (!SR) {
    broadcast("voiceError", { error: "not-supported" });
    return;
  }

  recognition = new SR();
  recognition.continuous     = true;
  recognition.interimResults = true;
  recognition.lang           = navigator.language || "en-US";

  recognition.onstart = () => {
    running = true;
    broadcast("voiceStarted", {});
  };

  recognition.onresult = (event) => {
    let finalText = "";
    let interim   = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalText += event.results[i][0].transcript;
      } else {
        interim += event.results[i][0].transcript;
      }
    }
    broadcast("voiceResult", { finalText, interim });
  };

  recognition.onerror = (event) => {
    if (event.error === "no-speech") {
      if (running) safeRestart();
      return;
    }
    errorOccurred = true;
    running       = false;
    broadcast("voiceError", { error: event.error });
  };

  recognition.onend = () => {
    if (running) {
      safeRestart(); // auto-restart on Chrome's ~60s timeout
    } else if (!errorOccurred) {
      broadcast("voiceStopped", {});
    }
    errorOccurred = false;
  };

  try {
    recognition.start();
  } catch (err) {
    broadcast("voiceError", { error: err.message });
  }
}

function safeRestart() {
  try {
    if (recognition) recognition.start();
  } catch (_) {}
}

function stopCapture() {
  running = false;
  if (recognition) {
    try { recognition.stop(); } catch (_) {}
    recognition = null;
  }
}

function broadcast(action, payload) {
  chrome.runtime.sendMessage({ action, ...payload }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== "offscreen") return;
  if (msg.action === "startVoice") startCapture();
  if (msg.action === "stopVoice")  stopCapture();
});
