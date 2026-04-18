# Brains — Browser Extension
### Detailed Build Plan

**Product:** A standalone browser extension that lets you save any article from the web as a
raw markdown file, organized into topic-based "brains" (folders), with on-demand wiki
generation powered by Gemini AI.

**Platforms:**
- Chrome (Mac / Windows / Android) — native extension
- iPhone Safari — iOS Shortcut + Google Apps Script endpoint
- Safari Mac — future (Safari Web Extension conversion via Xcode)

**Storage:** Google Drive (cross-device, free 15 GB)
**LLM:** Gemini 2.0 Flash (free tier — 1,500 req/day, 1M tokens/day)
**Distribution:** Chrome Web Store

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [How It Works](#2-how-it-works)
3. [Architecture](#3-architecture)
4. [Google Drive Folder Structure](#4-google-drive-folder-structure)
5. [File Formats](#5-file-formats)
6. [Chrome Extension — Deep Dive](#6-chrome-extension--deep-dive)
7. [Google Apps Script — Deep Dive](#7-google-apps-script--deep-dive)
8. [iOS Shortcut — Deep Dive](#8-ios-shortcut--deep-dive)
9. [Gemini Integration](#9-gemini-integration)
10. [First-Time Setup Flow](#10-first-time-setup-flow)
11. [Implementation Phases](#11-implementation-phases)
12. [Chrome Web Store Submission](#12-chrome-web-store-submission)
13. [Tech Stack Summary](#13-tech-stack-summary)
14. [Open Questions / Future](#14-open-questions--future)

---

## 1. Product Vision

Most knowledge management tools (Notion, Obsidian, Readwise) are either too heavy, require
subscriptions, or lock your data in proprietary formats. Brains is different:

- **Your data, your Drive.** Everything lives as plain `.md` files in Google Drive. No
  proprietary database, no lock-in. Open in any text editor.
- **Topic-scoped knowledge.** Separate brains for separate domains — AI, Software Testing,
  Agriculture. No single overwhelming inbox.
- **Raw → Wiki pipeline.** Saving is instant (no LLM). Wiki generation is on-demand and
  synthesizes knowledge across all raw files in a brain using Gemini.
- **Cross-device without an app.** Chrome extension on desktop, iOS Shortcut on iPhone.
  No App Store required.

**Target user:** Researchers, students, lifelong learners who read a lot on the web and
want to build a structured personal knowledge base without paying for SaaS tools.

---

## 2. How It Works

### Saving an article (Chrome — 2 clicks)

```
User reads article in Chrome
        ↓
Clicks extension icon in toolbar
        ↓
Popup appears (pre-filled title, brain selector, optional tags)
        ↓
content.js runs Readability.js on the page → clean article HTML
Turndown.js converts HTML → Markdown   (no LLM, instant)
        ↓
User clicks Save
        ↓
background.js uploads file to Google Drive:
  Brains/{brain}/raw/{slug}_{YYYYMMDD}.md
        ↓
Popup shows: "Saved to AI ✓"
```

### Saving an article (iPhone Safari — 3 taps)

```
User reads article in Safari
        ↓
Taps Share button → "Save to Brains" (iOS Shortcut)
        ↓
Shortcut shows brain menu → user picks "AI"
        ↓
Shortcut POSTs { url, brain } to Google Apps Script endpoint
        ↓
Apps Script:
  1. Fetches article HTML from URL
  2. Strips to clean text
  3. Converts to markdown
  4. Saves to Drive: Brains/AI/raw/{slug}_{date}.md
        ↓
Shortcut notification: "Saved to AI ✓"
```

### Generating a wiki (on-demand)

```
User opens extension popup → clicks "Generate Wiki" tab
Selects brain → clicks "Generate"
        ↓
background.js:
  1. Lists all .md files in Brains/{brain}/raw/ via Drive API
  2. Reads content of each file (or up to token limit)
  3. Sends to Gemini 2.0 Flash:
       "Extract concepts from these articles.
        For each concept, write a wiki page."
  4. Parses Gemini response → individual wiki pages
  5. Uploads each page to Brains/{brain}/wiki/{concept}.md
        ↓
Popup: "Generated 12 wiki pages ✓"
```

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    USER INTERFACES                          │
│                                                             │
│  ┌──────────────────┐          ┌──────────────────────┐    │
│  │  Chrome Extension │          │    iOS Shortcut       │    │
│  │  (popup + content │          │  (Share Sheet → POST) │    │
│  │   script)         │          └──────────┬───────────┘    │
│  └────────┬──────────┘                     │                │
│           │                                │                │
└───────────┼────────────────────────────────┼────────────────┘
            │                                │
            │ Drive API (OAuth)              │ HTTPS POST
            │                                │
            ▼                                ▼
┌───────────────────────┐      ┌─────────────────────────────┐
│    Google Drive       │      │    Google Apps Script       │
│                       │◄─────│    (free serverless fn)     │
│  Brains/              │      │    deployed as web app      │
│    AI/                │      │                             │
│      raw/  *.md       │      │  doPost(e):                 │
│      wiki/ *.md       │      │    fetch URL                │
│    Testing/           │      │    → markdown               │
│      raw/             │      │    → save to Drive          │
│      wiki/            │      └─────────────────────────────┘
└───────────┬───────────┘
            │
            │ (Gemini API call from background.js)
            ▼
┌─────────────────────────────┐
│    Gemini 2.0 Flash API     │
│    (free tier, Google AI)   │
│                             │
│  Input:  raw/*.md content   │
│  Output: wiki pages (JSON)  │
└─────────────────────────────┘
```

### Component responsibilities

| Component | Language | Runs on | Responsibility |
|-----------|----------|---------|----------------|
| `popup.js` | JS | Browser | UI: brain select, title, tags, save/wiki buttons |
| `content.js` | JS | Page | Article extraction via Readability.js |
| `background.js` | JS | Service worker | Drive API calls, Gemini API calls |
| `options.js` | JS | Browser | First-time setup, brain management |
| Google Apps Script | JS | Google servers | iPhone: fetch URL, convert, save to Drive |
| iOS Shortcut | Apple Shortcuts | iPhone | Trigger Apps Script, show brain menu |

---

## 4. Google Drive Folder Structure

```
Google Drive/
└── Brains/                          ← root folder created on first setup
    ├── _config.json                 ← list of brains + metadata
    ├── AI/
    │   ├── raw/
    │   │   ├── attention-mechanism_20260412.md
    │   │   ├── transformer-paper_20260413.md
    │   │   └── karpathy-llm-video_20260415.md
    │   └── wiki/
    │       ├── attention-mechanism.md
    │       ├── transformer-architecture.md
    │       └── positional-encoding.md
    ├── SoftwareTesting/
    │   ├── raw/
    │   └── wiki/
    └── Agriculture/
        ├── raw/
        └── wiki/
```

### `_config.json` (managed by extension)

```json
{
  "version": 1,
  "brains": [
    {
      "id": "ai",
      "name": "AI",
      "created_at": "2026-04-12T10:00:00Z",
      "raw_count": 24,
      "wiki_count": 12,
      "last_synced": "2026-04-15T22:00:00Z"
    },
    {
      "id": "software-testing",
      "name": "SoftwareTesting",
      "created_at": "2026-04-14T09:00:00Z",
      "raw_count": 8,
      "wiki_count": 0,
      "last_synced": null
    }
  ]
}
```

---

## 5. File Formats

### Raw file (`raw/{slug}_{date}.md`)

```markdown
---
title: "The Illustrated Transformer"
url: "https://jalammar.github.io/illustrated-transformer/"
brain: "AI"
source_type: "article"
captured_at: "2026-04-12T10:30:00Z"
tags: ["transformer", "attention", "NLP"]
word_count: 3200
---

# The Illustrated Transformer

Jay Alammar

...clean article text in markdown...
```

### Wiki page (`wiki/{concept}.md`)

```markdown
---
title: "Transformer Architecture"
brain: "AI"
aliases: ["transformers", "encoder-decoder", "attention model"]
sources:
  - "raw/illustrated-transformer_20260412.md"
  - "raw/attention-is-all-you-need_20260413.md"
generated_at: "2026-04-15T22:00:00Z"
tags: ["NLP", "deep learning", "architecture"]
---

# Transformer Architecture

## Core Idea
...

## Key Components
- [[Attention Mechanism]]
- [[Positional Encoding]]
- [[Multi-Head Attention]]

## How It Works
...

## Common Misconceptions
...

## Key Papers & Sources
- Vaswani et al. (2017) — "Attention Is All You Need"
- The Illustrated Transformer — Jay Alammar
```

---

## 6. Chrome Extension — Deep Dive

### Manifest (MV3)

```json
{
  "manifest_version": 3,
  "name": "Brains",
  "version": "1.0.0",
  "description": "Save any article to your personal knowledge brain. Powered by Google Drive.",
  "permissions": [
    "activeTab",
    "scripting",
    "storage",
    "identity"
  ],
  "host_permissions": [
    "https://www.googleapis.com/*",
    "https://generativelanguage.googleapis.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": { "32": "icons/icon32.png" }
  },
  "options_page": "options/options.html",
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["libs/Readability.js", "content/content.js"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### File Structure

```
brains-extension/
├── manifest.json
├── popup/
│   ├── popup.html              ← main UI
│   └── popup.js                ← brain select, save, wiki generate
├── background/
│   └── background.js           ← Drive API, Gemini API, file ops
├── content/
│   └── content.js              ← article extraction, listens for messages
├── options/
│   ├── options.html            ← setup + brain management
│   └── options.js              ← OAuth, Gemini key, create/delete brains
├── libs/
│   ├── Readability.js          ← Mozilla article extractor (vendored)
│   └── turndown.js             ← HTML → Markdown (vendored)
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

### Popup UI — States

**State 1: Not set up**
```
┌────────────────────────────┐
│  🧠 Brains                 │
│                            │
│  Welcome! Connect Google   │
│  Drive to get started.     │
│                            │
│  [  Set Up (1 min)  ]      │
└────────────────────────────┘
```

**State 2: Ready to save**
```
┌────────────────────────────┐
│  🧠 Brains          [⚙]   │
│  ──────────────────────    │
│  Brain:  [  AI         ▾]  │
│  Title:  [The Illustrated…]│
│  Tags:   [transformer, NLP]│
│                            │
│  [       Save Raw      ]   │
│  [    Generate Wiki    ]   │
└────────────────────────────┘
```

**State 3: After save**
```
┌────────────────────────────┐
│  🧠 Brains                 │
│                            │
│  ✓ Saved to AI/raw         │
│  attention-is-all-you…md   │
│                            │
│  [     Save Another    ]   │
└────────────────────────────┘
```

### background.js — Key Functions

```javascript
// Google Drive OAuth (uses chrome.identity)
async function getDriveToken()

// Ensure Brains/AI/raw/ folder path exists in Drive
async function ensureFolderPath(brain)

// Upload a .md file to Drive
async function uploadToDrive(brain, filename, content)

// List all raw files in a brain
async function listRawFiles(brain)

// Read file content from Drive
async function readFileContent(fileId)

// Call Gemini API with raw file contents
async function generateWiki(brain)

// Parse Gemini response into individual wiki pages
function parseWikiResponse(geminiOutput)

// Read/write _config.json from Drive
async function readConfig()
async function writeConfig(config)
```

### content.js — Article Extraction

```javascript
// Listens for message from popup.js
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.action === 'extract') {
    // Clone document so Readability doesn't modify the page
    const docClone = document.cloneNode(true);
    const reader = new Readability(docClone);
    const article = reader.parse();

    // article.title, article.content (HTML), article.byline
    const turndown = new TurndownService({ headingStyle: 'atx' });
    const markdown = turndown.turndown(article.content);

    respond({
      title: article.title,
      markdown: markdown,
      url: window.location.href,
      wordCount: article.length
    });
  }
});
```

---

## 7. Google Apps Script — Deep Dive

### Purpose

Acts as a free, always-on HTTPS endpoint for the iOS Shortcut. Receives a URL + brain name,
fetches the article, converts to markdown, saves to the user's Drive.

### Deployment

1. Go to [script.google.com](https://script.google.com)
2. Create new project → paste the script
3. Deploy → New deployment → Web app
   - Execute as: **Me**
   - Who has access: **Anyone** (or "Anyone with the link")
4. Copy the deployment URL (looks like `https://script.google.com/macros/s/ABC.../exec`)
5. Paste this URL into the iOS Shortcut

### Script (`Code.gs`)

```javascript
const BRAINS_ROOT = "Brains"; // folder name in Drive root

function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    const url = params.url;
    const brain = params.brain || "Inbox";
    const tags = params.tags || [];

    // Fetch article
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const html = response.getContentText();

    // Extract title from <title> tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : url;

    // Basic HTML → Markdown conversion
    const markdown = htmlToMarkdown(html, title);

    // Build file content with frontmatter
    const slug = slugify(title);
    const date = Utilities.formatDate(new Date(), "UTC", "yyyyMMdd");
    const filename = `${slug}_${date}.md`;

    const frontmatter = [
      "---",
      `title: "${title}"`,
      `url: "${url}"`,
      `brain: "${brain}"`,
      `source_type: "article"`,
      `captured_at: "${new Date().toISOString()}"`,
      `tags: [${tags.map(t => `"${t}"`).join(", ")}]`,
      "---",
      "",
    ].join("\n");

    const fileContent = frontmatter + markdown;

    // Save to Drive
    const folder = ensureFolderPath(`${BRAINS_ROOT}/${brain}/raw`);
    folder.createFile(filename, fileContent, MimeType.PLAIN_TEXT);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, filename }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// GET endpoint: return list of brains (for Shortcut brain picker)
function doGet(e) {
  const root = getDriveFolder(BRAINS_ROOT);
  const folders = root.getFolders();
  const brains = [];
  while (folders.hasNext()) {
    brains.push(folders.next().getName());
  }
  return ContentService
    .createTextOutput(JSON.stringify({ brains }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Ensure nested folder path exists, create if not
function ensureFolderPath(path) {
  const parts = path.split("/");
  let current = DriveApp.getRootFolder();
  for (const part of parts) {
    const found = current.getFoldersByName(part);
    current = found.hasNext() ? found.next() : current.createFolder(part);
  }
  return current;
}

// Slug: "Hello World! 2026" → "hello-world-2026"
function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 60);
}

// Minimal HTML → Markdown (strips tags, preserves headings + paragraphs)
function htmlToMarkdown(html, title) {
  // Remove script/style blocks
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n")
    .replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n")
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")
    .replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`")
    .replace(/<[^>]+>/g, "")           // strip remaining tags
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")        // collapse excess blank lines
    .trim();

  return `# ${title}\n\n${text}`;
}
```

> **Note:** The Apps Script HTML→Markdown is intentionally simple (no Readability.js — that
> library requires a DOM). Quality is good enough for raw files. The Chrome extension uses
> full Readability.js for much better extraction.

---

## 8. iOS Shortcut — Deep Dive

### What it does

Appears in Safari's Share Sheet. User taps it, picks a brain, and the article URL is sent
to the Apps Script endpoint. The endpoint handles fetching + saving.

### Shortcut steps

```
[Shortcut: "Save to Brains"]

Trigger: Share Sheet (accepts: URLs, web pages)

Step 1: Get the shared URL
  → Shortcut input = URL from Safari

Step 2: Get list of brains
  → URL: GET https://script.google.com/macros/s/ABC.../exec
  → Parse JSON response → extract "brains" array

Step 3: Choose from list
  → Prompt: "Save to which brain?"
  → Options: [list from Step 2]
  → Result stored as: chosen_brain

Step 4: POST to Apps Script
  → URL: POST https://script.google.com/macros/s/ABC.../exec
  → Body (JSON):
      {
        "url": [Shortcut Input],
        "brain": [chosen_brain]
      }
  → Headers: Content-Type: application/json

Step 5: Show result
  → If response.ok = true:
       Notification: "Saved to [chosen_brain] ✓"
  → Else:
       Alert: "Failed: [response.error]"
```

### Installation instructions for users (in README)

1. Open Shortcuts app on iPhone
2. Tap "+" to create new shortcut
3. Add the steps above (or import via iCloud link we provide)
4. Tap shortcut → Settings → Show in Share Sheet → ON
5. In Safari, tap Share → "Save to Brains"

---

## 9. Gemini Integration

### API details

- **Model:** `gemini-2.0-flash` (free tier)
- **Free limits:** 15 RPM, 1M tokens/day, 1,500 requests/day
- **API key:** from [aistudio.google.com](https://aistudio.google.com) (free, 30 seconds)
- **Called from:** `background.js` in the Chrome extension (client-side)

### Wiki generation prompt

```
You are a knowledge synthesizer. I have saved {N} articles to my "{brain}" brain.

Your task:
1. Read all the articles below
2. Identify the key concepts across them (aim for 5-15 concepts)
3. For each concept, write a structured wiki page in markdown

Rules:
- Each wiki page must have: title, ## Core Idea, ## Key Details,
  ## Common Misconceptions (if any), ## Related Concepts, ## Sources
- Use [[Concept Name]] syntax to link related concepts
- Be concise but comprehensive
- Do not invent information not present in the sources

Return your response as a JSON array:
[
  {
    "title": "Concept Name",
    "slug": "concept-name",
    "content": "full markdown content of wiki page"
  },
  ...
]

--- ARTICLES ---

{for each raw file: filename + content}
```

### Token budget management

A brain with many raw files may exceed Gemini's context window. Strategy:

1. Count tokens across all raw files before sending
2. If under 800k tokens → send all at once
3. If over → chunk by concept clusters:
   - First pass: extract concept list from titles + first 200 words of each file
   - Second pass: for each concept, send only the files that mention it
4. Merge results

### Gemini call from background.js

```javascript
async function callGemini(prompt, apiKey) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,       // low temp for factual synthesis
          maxOutputTokens: 8192,
        }
      })
    }
  );
  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}
```

---

## 10. First-Time Setup Flow

### Step 1 — Install extension
User installs from Chrome Web Store. Extension icon appears in toolbar.

### Step 2 — Click icon → "Set Up"
Options page opens automatically on first install.

### Step 3 — Connect Google Drive
```
[Connect Google Drive]
  → chrome.identity.launchWebAuthFlow
  → Google OAuth consent screen
     Scopes requested:
       - https://www.googleapis.com/auth/drive.file
         (access only files created by this extension)
  → Token stored in chrome.storage.local
```

> Using `drive.file` scope (not full Drive access) — extension can only see files it
> created. This is important for Chrome Web Store approval and user trust.

### Step 4 — Add Gemini API key
```
Get your free API key at aistudio.google.com → [Open link]

[Paste API key here: ________________________________]

[Verify key]  → makes a test call to Gemini
```

### Step 5 — Create first brain
```
Name your first brain (e.g. "AI", "Work", "Recipes"):
[________________________]

[Create Brain]
```

Done. Extension is ready. Total time: ~2 minutes.

### Subsequent brains (from options page)
- Options page lists all brains (read from `_config.json` in Drive)
- "Add Brain" button → name input → creates folder in Drive + updates config

---

## 11. Implementation Phases

### Phase 1 — Skeleton + Article Extraction (Days 1-2)

**Goal:** Extension installed, can extract article from any page, shows in popup.

Tasks:
- [ ] Create repo `brains-extension`
- [ ] Write `manifest.json` (MV3, permissions, content scripts)
- [ ] Vendor `Readability.js` and `turndown.js` (copy from their repos, no npm)
- [ ] Write `content.js` — extract article, return title + markdown + url
- [ ] Write `popup.html` — brain dropdown (hardcoded for now), title field, Save button
- [ ] Write `popup.js` — send message to content.js, display extracted content
- [ ] Test: load unpacked extension in Chrome, visit any article, click icon

**Deliverable:** Can extract any article and see the markdown in the popup.

---

### Phase 2 — Google Drive Integration (Days 3-5)

**Goal:** Clicking Save actually uploads the `.md` file to Drive.

Tasks:
- [ ] Write `options.html` + `options.js` skeleton
- [ ] Implement OAuth flow in `background.js` using `chrome.identity`
  - Register app in Google Cloud Console (OAuth 2.0 client ID)
  - Add client ID to manifest
  - Store access token in `chrome.storage.local`
  - Handle token refresh
- [ ] Implement Drive API calls in `background.js`:
  - `ensureFolderPath(path)` — creates nested folders if missing
  - `uploadFile(folderId, filename, content)` — multipart upload
  - `listFiles(folderId)` — list raw/ contents
  - `readFile(fileId)` — get file content
- [ ] Implement `_config.json` read/write
- [ ] Wire popup Save button → content extraction → Drive upload
- [ ] Test: save real article, verify file appears in Drive with correct frontmatter

**Deliverable:** Full save flow works end-to-end. File in Drive.

---

### Phase 3 — Brain Management (Day 6)

**Goal:** Multiple brains, switch between them, create new ones.

Tasks:
- [ ] Options page: list brains (from `_config.json`), "Add Brain" button
- [ ] Create brain → create folder in Drive + update `_config.json`
- [ ] Delete brain → confirm dialog (does not delete Drive files, just removes from config)
- [ ] Popup brain dropdown — populated from `_config.json` (cached in `chrome.storage.local`)
- [ ] Last used brain remembered across sessions
- [ ] Test: create 3 brains, switch between them, save articles to each

**Deliverable:** Brain management works. Popup shows correct brains.

---

### Phase 4 — Gemini Integration + Wiki Generation (Days 7-9)

**Goal:** "Generate Wiki" button synthesizes wiki pages from raw files.

Tasks:
- [ ] Options page: Gemini API key input + "Verify" button
- [ ] Store key in `chrome.storage.local` (never sent to any server except Gemini)
- [ ] `background.js: generateWiki(brain)`:
  - List raw files in brain
  - Read contents (with token budget check)
  - Build prompt
  - Call Gemini API
  - Parse JSON response
  - Upload wiki pages to Drive
- [ ] Popup "Generate Wiki" button → progress indicator → success message
- [ ] Handle errors gracefully (API key invalid, rate limit, empty brain)
- [ ] Test: save 5+ articles to a brain, generate wiki, verify pages in Drive

**Deliverable:** Wiki generation works. Pages appear in `wiki/` folder in Drive.

---

### Phase 5 — Google Apps Script + iOS Shortcut (Day 10)

**Goal:** iPhone can save articles via Share Sheet.

Tasks:
- [x] Write and deploy `Code.gs` to Google Apps Script → `google-apps-script/Code.gs`
- [x] Test Apps Script via curl:
  ```bash
  curl -L -X POST "https://script.google.com/macros/s/ABC.../exec" \
    -H "Content-Type: application/json" \
    -d '{"url":"https://example.com","brain":"AI"}'
  ```
- [x] Write iOS Shortcut steps → `google-apps-script/SETUP.md`
- [ ] Test: share any Safari page → file appears in Drive (requires deployment)
- [x] Write user-facing setup instructions → `google-apps-script/SETUP.md`
- [ ] (Optional) Create shareable iCloud Shortcut link

**Deliverable:** iPhone save flow works. Apps Script endpoint live.

---

### Phase 6 — Polish + Chrome Web Store (Days 11-14)

**Goal:** Extension is ready for public.

Tasks:
- [ ] Design proper icons (16, 32, 48, 128px) — use Figma or similar
- [ ] Error states in popup (not authenticated, Drive error, no brains yet)
- [ ] Loading states (spinner while saving, progress bar for wiki gen)
- [ ] Keyboard shortcut to open popup (`Alt+B`)
- [ ] Options page: "View Drive folder" button (opens Drive in new tab)
- [ ] Write `README.md` (install guide, Apps Script setup, Shortcut setup)
- [ ] Write `PRIVACY.md` (no data collected, Drive scope explanation)
- [ ] Record demo video (required for Chrome Store)
- [ ] Create Chrome Web Store developer account ($5 one-time fee)
- [ ] Package extension (zip)
- [ ] Submit to Chrome Web Store
  - Fill store listing: name, description, screenshots, category
  - Wait for review (typically 1-3 business days)

---

## 12. Chrome Web Store Submission

### Requirements checklist

- [ ] All permissions justified in store listing
- [ ] `drive.file` scope used (not full drive) — easier approval
- [ ] Privacy policy URL (can be a GitHub page)
- [ ] At least 1 screenshot (1280x800 or 640x400)
- [ ] Short description (132 chars max)
- [ ] Long description (clear, no keyword stuffing)
- [ ] Demo video (YouTube link, highly recommended)
- [ ] `$5` one-time developer registration fee

### Store listing copy (draft)

**Name:** Brains — Web Clipper

**Short description:**
Save any article as markdown to Google Drive. Organize by topic. Generate wiki pages with AI.

**Category:** Productivity

**Privacy policy URL:** `https://github.com/{user}/brains-extension/blob/main/PRIVACY.md`

---

## 13. Tech Stack Summary

| Concern | Choice | Why |
|---------|--------|-----|
| Extension framework | Chrome MV3, vanilla JS | No build step, fast, simple |
| Article extraction | Readability.js (Mozilla) | Best-in-class, MIT license |
| HTML → Markdown | Turndown.js | Lightweight, configurable, MIT |
| Storage | Google Drive API | Cross-device, free, user owns data |
| Auth | `chrome.identity` OAuth | Built-in, no external auth library |
| LLM | Gemini 2.0 Flash | Free tier generous, same Google account |
| iPhone endpoint | Google Apps Script | Free, serverless, same Google account |
| iPhone trigger | iOS Shortcut | No App Store, native Share Sheet |
| Package manager | None (vendored libs) | No build step needed |

### Dependencies (all vendored, no npm)

- `Readability.js` — [github.com/mozilla/readability](https://github.com/mozilla/readability)
- `turndown.js` — [github.com/mixmark-io/turndown](https://github.com/mixmark-io/turndown)

---

## 14. Open Questions / Future

### v2 ideas
- **Offline queue:** Save to extension local storage when offline, sync to Drive when back online
- **Tags autocomplete:** Suggest tags based on existing tags across brains
- **Selection save:** Right-click selected text → save just the selection (not full article)
- **Safari Mac:** Convert via `xcrun safari-web-extension-converter` + distribute via Mac App Store
- **Firefox support:** Minimal changes needed (MV3 compatible with minor tweaks)
- **Obsidian sync:** Option to sync wiki/ folder to Obsidian vault instead of Drive

### Known limitations (v1)
- Wiki generation requires manual trigger (not automatic)
- Apps Script HTML extraction is basic (no Readability.js on server side)
- iPhone must be on internet (can't queue for later)
- Gemini API key stored in `chrome.storage.local` (encrypted by Chrome, acceptable for v1)
- No full-text search across brains (use Drive's built-in search or download folder to Obsidian)

### Connection back to Shruti (Week1_Assignment)
When ready to reconnect, the Shruti Python app reads from the same Drive folder
(synced locally via Google Drive Desktop). No code changes to the extension needed —
the folder structure is the shared contract between the two projects.

```python
# In Shruti's config.py
BRAINS_DIR = Path.home() / "Google Drive" / "My Drive" / "Brains"
```

---

*Plan version 1.0 — April 2026*
*Extension: standalone, no backend required*
*Repository: brains-extension (separate repo from Shruti)*
