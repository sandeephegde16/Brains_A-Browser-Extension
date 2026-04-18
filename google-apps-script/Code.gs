// Brains — Google Apps Script endpoint
// Deployed as a Web App (Execute as: Me, Access: Anyone)
// Used by the iOS Shortcut to save articles and thoughts to Google Drive.
//
// Endpoints:
//   GET  ?action=brains                        → returns list of brain names for the Shortcut picker
//   POST { url, brain, tags? }                 → fetches article, converts to markdown, saves to Drive
//   POST { thought, brain, title?, tags? }     → saves raw thought text directly to Drive

// ── Configuration ────────────────────────────────────────────────────────────

const BRAINS_ROOT_NAME = "Brains"; // must match the folder Chrome extension created

// Optional secret token. If set, every request must include ?token=VALUE.
// Leave empty ("") to disable (fine for personal use — the URL is already obscure).
const SECRET_TOKEN = "";

// ── Entry points ──────────────────────────────────────────────────────────────

function doGet(e) {
  if (!authOk(e)) return forbidden();

  const action = e.parameter.action || "brains";

  if (action === "brains") {
    try {
      const root = getBrainsRoot();
      if (!root) return jsonResponse({ brains: [] });

      const folders = root.getFolders();
      const brains  = [];
      while (folders.hasNext()) brains.push(folders.next().getName());
      brains.sort();
      return jsonResponse({ ok: true, brains });
    } catch (err) {
      return jsonResponse({ ok: false, error: err.message, brains: [] });
    }
  }

  return jsonResponse({ ok: false, error: "Unknown action: " + action });
}

function doPost(e) {
  if (!authOk(e)) return forbidden();

  try {
    const params = JSON.parse(e.postData.contents);
    const brain  = (params.brain || "").trim();
    const tags   = Array.isArray(params.tags) ? params.tags : [];

    if (!brain) return jsonResponse({ ok: false, error: "brain is required" });

    // ── Thought (raw text, no URL to fetch) ───────────────────────────────────
    if (params.thought) {
      const text  = params.thought.trim();
      if (!text)  return jsonResponse({ ok: false, error: "thought text is empty" });

      const dateLabel   = Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd");
      const title       = (params.title || "").trim() || ("Thought – " + dateLabel);
      const capturedAt  = new Date().toISOString();
      const wordCount   = text.trim().split(/\s+/).filter(Boolean).length;
      const tagsList    = tags.map(function(t) { return '"' + t + '"'; }).join(", ");

      const slug     = slugify(title);
      const date     = Utilities.formatDate(new Date(), "UTC", "yyyyMMdd");
      const filename = slug + "_" + date + ".md";

      const frontmatter = [
        "---",
        'title: "' + title.replace(/"/g, '\\"') + '"',
        'url: ""',
        'brain: "' + brain + '"',
        'source_type: "thought"',
        'captured_at: "' + capturedAt + '"',
        'tags: [' + tagsList + ']',
        'word_count: ' + wordCount,
        "---",
        ""
      ].join("\n");

      const rawFolder = ensureFolderPath([BRAINS_ROOT_NAME, brain, "raw"]);
      rawFolder.createFile(filename, frontmatter + text, MimeType.PLAIN_TEXT);

      return jsonResponse({ ok: true, filename: filename, brain: brain, wordCount: wordCount });
    }

    // ── Article (fetch URL) ───────────────────────────────────────────────────
    const url = (params.url || "").trim();
    if (!url) return jsonResponse({ ok: false, error: "url or thought is required" });

    // Fetch article HTML
    let html;
    try {
      const resp = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects:    true,
        headers: {
          // Pretend to be a browser so sites don't block the request
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
                        "AppleWebKit/537.36 (KHTML, like Gecko) " +
                        "Chrome/124.0.0.0 Safari/537.36"
        }
      });
      if (resp.getResponseCode() >= 400) {
        return jsonResponse({ ok: false, error: "Could not fetch URL (HTTP " + resp.getResponseCode() + ")" });
      }
      html = resp.getContentText();
    } catch (fetchErr) {
      return jsonResponse({ ok: false, error: "Fetch failed: " + fetchErr.message });
    }

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const rawTitle   = titleMatch ? titleMatch[1].trim() : url;
    const title      = decodeEntities(rawTitle).replace(/\s+/g, " ").trim();

    // Convert HTML → Markdown
    const markdown  = htmlToMarkdown(html);
    const wordCount = markdown.trim().split(/\s+/).filter(Boolean).length;

    // Build file
    const slug     = slugify(title);
    const date     = Utilities.formatDate(new Date(), "UTC", "yyyyMMdd");
    const filename = slug + "_" + date + ".md";

    const capturedAt  = new Date().toISOString();
    const tagsList    = tags.map(function(t) { return '"' + t + '"'; }).join(", ");

    const frontmatter = [
      "---",
      'title: "' + title.replace(/"/g, '\\"') + '"',
      'url: "' + url + '"',
      'brain: "' + brain + '"',
      'source_type: "article"',
      'captured_at: "' + capturedAt + '"',
      'tags: [' + tagsList + ']',
      'word_count: ' + wordCount,
      "---",
      ""
    ].join("\n");

    const fileContent = frontmatter + markdown;

    // Save to Drive: Brains/{brain}/raw/{filename}
    const rawFolder = ensureFolderPath([BRAINS_ROOT_NAME, brain, "raw"]);
    rawFolder.createFile(filename, fileContent, MimeType.PLAIN_TEXT);

    return jsonResponse({ ok: true, filename: filename, brain: brain, wordCount: wordCount });

  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ── Drive helpers ─────────────────────────────────────────────────────────────

function getBrainsRoot() {
  const results = DriveApp.getRootFolder().getFoldersByName(BRAINS_ROOT_NAME);
  return results.hasNext() ? results.next() : null;
}

// Walk path segments, creating folders that don't exist. Returns the leaf folder.
function ensureFolderPath(segments) {
  var current = DriveApp.getRootFolder();
  for (var i = 0; i < segments.length; i++) {
    var name    = segments[i];
    var results = current.getFoldersByName(name);
    current = results.hasNext() ? results.next() : current.createFolder(name);
  }
  return current;
}

// ── HTML → Markdown ───────────────────────────────────────────────────────────

function htmlToMarkdown(html) {
  var text = html;

  // Remove entire unwanted blocks first (scripts, styles, nav, etc.)
  var removeBlocks = ["script","style","nav","header","footer","aside","iframe","noscript","svg","figure"];
  removeBlocks.forEach(function(tag) {
    text = text.replace(new RegExp("<" + tag + "[^>]*>[\\s\\S]*?<\\/" + tag + ">", "gi"), " ");
  });

  // Preserve code blocks before general tag stripping
  text = text.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, function(_, code) {
    return "\n```\n" + decodeEntities(code).trim() + "\n```\n\n";
  });
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, function(_, code) {
    return "\n```\n" + decodeEntities(code).trim() + "\n```\n\n";
  });

  // Headings
  text = text
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n")
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n\n#### $1\n\n")
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n\n##### $1\n\n")
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n\n###### $1\n\n");

  // Block elements
  text = text
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n\n$1\n\n")
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "\n> $1\n\n")
    .replace(/<hr[^>]*\/?>/gi, "\n\n---\n\n")
    .replace(/<br[^>]*\/?>/gi, "\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<\/[uo]l>/gi, "\n\n");

  // Inline formatting
  text = text
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*")
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // Links and images
  text = text
    .replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<img[^>]+src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)")
    .replace(/<img[^>]+alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, "![$1]($2)")
    .replace(/<img[^>]+src="([^"]*)"[^>]*\/?>/gi, "![]($1)");

  // Strip all remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  text = decodeEntities(text);

  // Normalise whitespace
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, function(_, code) { return String.fromCharCode(parseInt(code, 10)); })
    .replace(/&[a-z]{2,6};/g, "");
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\x00-\x7F]/g, "")    // strip non-ASCII
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 60);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function authOk(e) {
  if (!SECRET_TOKEN) return true;
  return (e.parameter.token === SECRET_TOKEN);
}

function forbidden() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: "Unauthorized" }))
    .setMimeType(ContentService.MimeType.JSON);
}
