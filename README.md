# Brains — Web Clipper

Save any article from the web as a clean markdown file, directly to Google Drive.  
Organize clips by topic. Generate wiki pages from your saved articles using Gemini AI.

---

## Demo Video

[![Watch the demo](https://img.youtube.com/vi/PtTL40bhAK4/0.jpg)](https://youtu.be/PtTL40bhAK4)

---

## There are two audiences for this README

- **End users** — install the extension, click one button, done
- **You (the developer)** — one-time setup before the extension is usable by anyone

---

## User setup (anyone who installs the extension)

### 1. Install

Load unpacked from `chrome://extensions` (dev mode), or install from the Chrome Web Store once published.

### 2. Connect Google Drive

1. Click the Brains icon in the toolbar (or right-click → Options)
2. Click **Browse** under Google Drive Folder
3. A **Google sign-in popup** appears — sign in and allow access
4. Navigate to the folder where you want clips saved → **Select this folder**
5. Click **Save Settings**

That's the only setup users do. No Google Cloud Console, no credentials, no technical steps.

---

## Saving an article

1. Navigate to any article in Chrome
2. Click the **Brains** icon in the toolbar
3. The popup auto-extracts the article — review the title, add tags if you want
4. Click **Save**
5. Done — a success message shows the filename with a link to open it in Drive

The saved file looks like this:

```markdown
---
title: "How Attention Works in Transformers"
url: "https://example.com/attention"
brain: "Inbox"
source_type: "article"
captured_at: "2026-04-16T10:30:00.000Z"
tags: ["AI", "transformers"]
word_count: 2847
---

# How Attention Works in Transformers

[clean article content...]
```

---

## Saving a selection

1. Highlight any text on a page
2. Right-click → **Save selection to Brains**
3. Green badge = saved. Red badge = failed (check service worker console for details).

---

## Gemini API Key (for wiki generation)

Paste your key in Options → Gemini API Key field → Save Settings now, so it's ready when the wiki generation feature ships.

**Get a free key:** [aistudio.google.com](https://aistudio.google.com) → Get API key → Create API key.  
Free tier: 1,500 requests/day, 1M tokens/day.

---

## Developer setup (do this once)

This registers your app with Google so the "Connect to Google Drive" button works.  
Users never see this step — it's baked into the extension before you share it.

### 1. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown → **New Project** → name it `brains` → **Create**
3. Go to **APIs & Services → Library** → search **Google Drive API** → **Enable**

### 2. Load the extension to get its ID

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** → select this folder
4. Copy the extension **ID** shown under the extension name  
   (looks like `abcdefghijklmnopabcdefghijklmnop`)

### 3. Create an OAuth Client ID

1. Go to **APIs & Services → Credentials → + Create Credentials → OAuth 2.0 Client ID**
2. If asked to configure the consent screen first: User type → **External** → fill in app name + your email → Save through all screens → come back here
3. Application type: **Chrome Extension**
4. **Item ID**: paste your extension ID from step 2
5. Click **Create** → copy the generated **Client ID**

### 4. Put the Client ID in the manifest

Open `manifest.json` and replace `YOUR_GOOGLE_OAUTH_CLIENT_ID`:

```json
"oauth2": {
  "client_id": "123456789-abc...apps.googleusercontent.com",
  ...
}
```

Go to `chrome://extensions` → click the **reload icon** on Brains.

That's it. The extension is now ready for anyone to use — including yourself.

---

## Troubleshooting

**"Extraction failed" in popup**  
Chrome blocks content scripts on its own pages (`chrome://`, Chrome Web Store, PDF viewer). Try on any regular article.

**Google sign-in popup doesn't appear when clicking Browse**  
The OAuth Client ID in `manifest.json` is still the placeholder. Complete the developer setup above.

**"No Drive folder configured" warning**  
Open Options and select a folder.

**Badge shows "ERR" on right-click clip**  
`chrome://extensions` → Brains → **Inspect views: service worker** → Console tab.

**Changes to `manifest.json` don't take effect**  
`chrome://extensions` → reload icon on the Brains card.

---

## Saving from iPhone (Safari)

Brains works on iPhone via a free Google Apps Script endpoint + an iOS Shortcut that appears in Safari's Share Sheet.

**Flow:** tap Share in Safari → Save to Brains → pick a brain → file saved to Drive in ~3 seconds.

**Setup takes ~15 minutes:**

→ See **[`google-apps-script/SETUP.md`](google-apps-script/SETUP.md)** for the full step-by-step guide.

The guide covers:
1. Deploying `Code.gs` to Google Apps Script (your free personal endpoint)
2. Testing with `curl`
3. **One shortcut does both** — detects if a URL was shared (→ saves article) or launched standalone (→ opens voice dictation → saves thought). Lives in Safari's Share Sheet and on your Home Screen. "Hey Siri, Save to Brains" works too.

> **Limitation:** The server-side fetch can't run JavaScript, so extraction quality is lower than the Chrome extension for JS-heavy sites. Plain article pages work well.

---

## Saving a thought (voice or text)

Switch to the **Thought** tab in the popup to record an idea without being on an article page.

- **Type** directly into the text area
- **Tap the mic** to dictate — live transcript appears as you speak
- Thoughts are saved to Drive with `source_type: "thought"` and included in wiki generation

Draft is auto-saved if you close the popup mid-thought.

---

## Project structure

```
Week2_Assignment/
├── manifest.json                    # Extension config — OAuth client ID goes here
├── background/
│   └── background.js                # Drive API, OAuth, clip + wiki handler
├── content/
│   └── content-script.js            # Article extraction (Readability + Turndown)
├── popup/
│   ├── popup.html / .js / .css
├── options/
│   ├── options.html / .js / .css
├── voice-capture/
│   ├── capture.html / .js           # Voice capture page (fallback for new tab)
├── google-apps-script/
│   ├── Code.gs                      # Apps Script endpoint for iPhone saving
│   └── SETUP.md                     # iPhone setup guide
├── lib/
│   ├── readability.js               # Mozilla Readability (bundled)
│   └── turndown.js                  # HTML-to-Markdown (bundled)
├── icons/
└── PLAN.md                          # Full product plan
```







