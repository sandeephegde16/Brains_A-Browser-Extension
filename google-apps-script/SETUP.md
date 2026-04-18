# iPhone Setup — Google Apps Script + iOS Shortcut

Two steps: deploy the backend, then build the iOS Shortcut.  
Total time: ~15 minutes.

---

## Step 1 — Deploy the Google Apps Script

This creates a free HTTPS endpoint that fetches articles from URLs and saves them to your Drive.  
**Use the same Google account your Brains Drive folder lives in.**

### 1a. Create the project

1. Open [script.google.com](https://script.google.com)
2. Click **New project**
3. Click **Untitled project** (top left) → rename to `Brains - iOS Endpoint`
4. Delete the default `function myFunction() {}` placeholder in the editor

### 1b. Paste the script

1. Open `Code.gs` from this folder — select all and copy
2. Paste into the Apps Script editor
3. Save with **⌘S**

### 1c. Deploy as a web app

1. Click **Deploy** → **New deployment**
2. Click the **gear icon ⚙** next to "Select type" → choose **Web app**
3. Set:
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
4. Click **Deploy** → **Authorize access** → sign in → Allow
5. Copy the **Web app URL** — it looks like:
   ```
   https://script.google.com/macros/s/AKfycby.../exec
   ```

### 1d. Test the endpoint

```bash
# Should return your list of brains
curl -L "https://script.google.com/macros/s/YOUR_ID/exec?action=brains"

# Should save an article to your "AI" brain
curl -L -X POST "https://script.google.com/macros/s/YOUR_ID/exec" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)","brain":"AI"}'
```

Expected responses:
```json
{"ok":true,"brains":["AI","SoftwareTesting"]}
{"ok":true,"filename":"transformer-deep-learning_20260418.md","brain":"AI","wordCount":1842}
```

Check Drive: **Brains → AI → raw** — the file should be there.

> **Note:** Apps Script always redirects once before responding. `-L` tells curl to follow it.

---

## Step 2 — Build the iOS Shortcut

**One shortcut does both** — it detects how it was triggered:
- Launched from **Safari Share Sheet** → saves the article
- Launched **standalone** (Home Screen / Siri) → opens voice dictation → saves as a thought

### Create and configure the shortcut

1. Open the **Shortcuts** app on your iPhone
2. Tap **+** (top right)
3. Tap the title → rename to **Save to Brains** → Done
4. Tap the **ⓘ icon** (bottom centre)
   - Enable **Add to Share Sheet** → set Input types to **URLs** and **Web pages**
   - Enable **Add to Home Screen**
   - Tap Done

---

### Add these 9 actions in order

Tap the search bar at the bottom to find each action by name.

---

**Action 1 — Fetch your brain list**

Search: `Get contents of URL` → tap it

URL (with `?action=brains`):
```
https://script.google.com/macros/s/YOUR_ID/exec?action=brains
```
Method: GET. Leave everything else as-is.

---

**Action 2 — Parse the response**

Search: `Get dictionary from input` → tap it

Nothing to configure.

---

**Action 3 — Extract the brains list**

Search: `Get dictionary value` → tap it

- Key: `brains`
- Dictionary: **Dictionary**

---

**Action 4 — Pick a brain**

Search: `Choose from list` → tap it

- List: **Dictionary Value**
- Prompt: `Save to which brain?`

---

**Action 5 — Check if a URL was shared**

Search: `If` → tap it

- Tap the first field (input) → tap `{x}` → **Shortcut Input**
- Condition: **has any value**

---

**Action 6 — (inside If) Save the article**

After you add the `If` action (Action 5), the editor shows a structure like this:

```
┌─ If [Shortcut Input] has any value ─┐
│  ← add actions here (inside If)     │
├─ Otherwise ─────────────────────────┤
│  ← add actions here (inside Else)   │
└─ End If ────────────────────────────┘
```

Tap the **"+"  Add Action** button that appears **inside the If block** (above the "Otherwise" line).

Search: `Get contents of URL` → tap it

**Set the URL field** — type or paste:
```
https://script.google.com/macros/s/YOUR_ID/exec
```
(This is the same base URL as Action 1 but without `?action=brains`)

**Tap "Show More"** — a small grey link at the bottom of the action card. This reveals extra fields.

You'll now see:
- **Method** — tap it → change from `GET` to **`POST`**
- **Request Body** — tap it → change from `Form` to **`JSON`**

After selecting JSON, a section called **"JSON Body"** appears with an **"Add new field"** button.

**Add field 1 — the URL to save:**
1. Tap **Add new field** → choose **Text**
2. In the **Key** box: type `url`
3. In the **Value** box: tap it → you'll see a cursor + a small **`{x}`** token button at the right of the keyboard bar
4. Tap **`{x}`** → a variable picker slides up
5. Scroll up to find **Shortcut Input** → tap it
6. The value field now shows a blue pill that says **"Shortcut Input"**

**Add field 2 — which brain:**
1. Tap **Add new field** again → choose **Text**
2. **Key**: `brain`
3. **Value**: tap the field → tap **`{x}`** → scroll to find **Chosen Item** (from Action 4) → tap it
4. Value field shows a blue pill: **"Chosen Item"**

The finished action card looks like:
```
Get contents of "https://...exec"
  Method: POST
  Body: JSON
    url:   [Shortcut Input]
    brain: [Chosen Item]
```

---

**Action 7 — (inside Otherwise) Dictate the thought**

Tap the **"+" Add Action** button inside the **Otherwise block** (below the "Otherwise" line, above "End If").

Search: `Dictate text` → tap it

- Language: **Default** (leave as-is)

No other configuration needed. This opens a microphone overlay when the shortcut runs standalone.

---

**Action 8 — (inside Otherwise) Save the thought**

Still inside the **Otherwise block**, tap **Add Action** again (below the Dictate Text card).

Search: `Get contents of URL` → tap it

**URL:**
```
https://script.google.com/macros/s/YOUR_ID/exec
```

Tap **Show More** → same steps as Action 6:
- Method → **POST**
- Request Body → **JSON**

**Add field 1 — the thought text:**
1. Tap **Add new field** → **Text**
2. Key: `thought`
3. Value: tap field → tap **`{x}`** → find **Dictated Text** (from Action 7) → tap it

**Add field 2 — which brain:**
1. Tap **Add new field** → **Text**
2. Key: `brain`
3. Value: tap field → tap **`{x}`** → find **Chosen Item** (from Action 4) → tap it

---

**Action 9 — Show confirmation** (after the End If block)

Tap **Add Action** below the **"End If"** line (outside both blocks).

Search: `Show notification` → tap it

- Title: tap the field and type: `Saved to Brains`

---

**What the full shortcut looks like when done:**

```
[1] Get contents of URL  (GET  .../exec?action=brains)
[2] Get dictionary from input
[3] Get dictionary value  key: brains
[4] Choose from list  "Save to which brain?"
[5] If [Shortcut Input] has any value
      [6] Get contents of URL  (POST .../exec  {url, brain})
    Otherwise
      [7] Dictate text
      [8] Get contents of URL  (POST .../exec  {thought, brain})
    End If
[9] Show notification  "Saved to Brains"
```

---

### How to use it

**Save an article from Safari:**
Share → Save to Brains → pick brain → done

**Capture a voice thought from anywhere:**
Tap the shortcut on your Home Screen → speak → tap Done → pick brain → done

**Hands-free via Siri:**
"Hey Siri, Save to Brains" → immediately opens dictation

---

### Test it

- **Article mode:** tap ▶ (Play) in the editor → paste any article URL when prompted → pick brain → check Drive
- **Thought mode:** tap the shortcut on your Home Screen → speak → pick brain → check Drive

---

## Re-deploying after code changes

If you ever update `Code.gs`:
1. **Deploy → Manage deployments**
2. Click the pencil ✏ on your deployment
3. Change version to **New version** → **Deploy**

The URL stays the same — no Shortcut changes needed.

---

## Optional: add a secret token for extra security

By default, anyone with your endpoint URL can POST to it. The URL is already a 60-char random string, so this is fine for personal use. If you want an extra layer:

1. In `Code.gs`, set: `const SECRET_TOKEN = "pick-any-random-string";`
2. Redeploy (New version)
3. In the Shortcut, append `?token=your-string` to both URLs in Actions 1 and 5

Requests without the token return `{"ok":false,"error":"Unauthorized"}`.

---

## Known limitations

- JS-heavy sites (Twitter, paywalled articles) won't extract well — the server fetch can't run JavaScript. The Chrome extension uses Readability.js which is much better.
- No image upload from iOS — images stay as remote URLs in the markdown.
- Apps Script has a 20-second fetch timeout — very slow sites may fail.
