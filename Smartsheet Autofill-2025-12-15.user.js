// ==UserScript==
// @name         Smartsheet Autofill
// @namespace    pr-smartsheet-clipper
// @version      2025-12-15
// @description  Extract article metadata + (optional) AI classification via QuickSuite (no-backend) and open a prefilled Smartsheet form. Articles must be unpaywalled.
// @author       John Pena
// @match        *://*/*
// @exclude      https://app.smartsheet.com/*
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  "use strict";

  // =========================
  // CONFIG YOU MUST SET
  // =========================
  const FORM_URL = "https://app.smartsheet.com/b/form/0b54b933eaa840eca15f837246cba5b9";
  const QUICKSUITE_URL = "https://us-east-1.quicksight.aws.amazon.com/sn/start/home"; // TODO: paste internal QuickSuite URL
  const ARTICLE_TEXT_CHARS = 20000;

  // =========================
  // UI CONFIG
  // =========================
  // Raise both buttons ~2 inches (CSS assumes 96px per inch)
  const UI_RAISE_PX = 192;

  // =========================
  // YES/NO VALUES (MUST MATCH FORM EXACTLY)
  // =========================
  const YES_VALUE = "Yes";
  const NO_VALUE = "No";

  // =========================
  // SMARTHSHEET FIELD LABELS (MUST MATCH EXACTLY)
  // =========================
  const FIELD = {
    date: "Date of Publication",
    country: "Country",
    headline: "Headline",
    publication: "Publication",
    author: "Journalist Name",
    url: "Link",

    // Existing AI fields
    adsEvent: "Ads Event",
    adsAnnouncement: "Amazon Ads Campaign or Announcement",
    tags: "Tags",
    storyClassification: "Story Classification",
    keyMessagePullThrough: "Key message pull-through",

    // Industry bodies (question label must match EXACTLY)
    industryBodiesQ: "Does this story feature Amazon's involvement with industry bodies?",
    industryBodyName: "Industry body or association",

    // Customer/partner success story
    customerPartnerSuccessQ: "Does this story feature a customer and/or partner success story?",
    customerNamesSuccess: "Customer Names for Success Story",
    partnerNamesSuccess: "Partner Names for Success Story",

    // AI innovation story + spokesperson
    aiInnovationStoryQ: "Is this an AI Innovation Story?",
    spokesperson: "Spokesperson",
  };

  // Default .com sites to United States (must match dropdown option exactly)
  const DEFAULT_COUNTRY_FOR_DOTCOM = "United States";

  // =========================
  // ALLOWED OPTIONS (so AI returns only valid dropdown values)
  // =========================
  const ADS_EVENTS = [
    "Accelerate",
    "Amazon Publishers Summit",
    "Cannes",
    "CES",
    "China Joy",
    "DMEXCO",
    "unBoxed (US)",
    "unBoxed (in-country)",
    "Upfront (US)",
    "Upfront (in-country)",
    "IAB",
    "Mobile World Congress",
    "TwitchCon",
  ];

  // MUST match EXACT spelling/capitalization from your screenshot
  const TAGS = [
    "Amazon Marketing Cloud (AMC)",
    "Demand Side Platform (DSP)",
    "Amazon Autos: B2B",
    "Amazon Autos: Consumer",
    "Amazon Live",
    "Amazon Publisher Services (APS)",
    "Brand Innovation Lab (BIL)",
    "Corporate reputation/cause",
    "CreativeX",
    "Fire TV advertising",
    "Ground Truth Blog",
    "Live Sports",
    "IMDB",
    "MX Player",
    "Prime Video ads (PVa)",
    "Privacy",
    "Retail industry advertising",
    "Ad Relevance",
    "Sponsored Products",
    "Sponsored TV",
    "SMB/seller",
    "Streaming",
    "Sustainability",
    "Twitch advertising",
    "3P announcement",
    "Thought leadership",
  ];

  // MUST match EXACT as shown in your Smartsheet dropdown
  const STORY_CLASSIFICATION_OPTIONS = [
    "Agenda-setting",
    "Signature",
    "Owned (About Amazon or A20M)",
    "Other",
    "Non-Traditional: Podcast",
    "Non-Traditional: Newsletter / Substack",
    "Non-Traditional: Other",
    "Ad load/density",
  ];

  // MUST match EXACT as shown in your key messages screenshot
  const KEY_MESSAGES = [
    "Amazon Ads offers full funnel advertising at scale",
    "Amazon Ads is a leader in AI",
    "Amazon offers extensive reach and impact with its streaming offer",
    "Amazon Ads customers benefit from a full suite of ad tech, measurement, and analytics",
  ];

  // MUST match EXACT as shown in your spokesperson dropdown screenshot
  const SPOKESPERSONS = [
    "Alan Moss",
    "Carlos Fanjul",
    "Carolina Piber",
    "Chantal Rossi Badia",
    "Chris Wilson",
    "Christopher Walton",
    "Claire Paull",
    "Danielle Carney",
    "David Amodio",
    "Eric Abi Younes",
    "Flavia Spinelli",
    "Gemma Battenbough",
    "Girish Prabhu",
    "Hernando Cortes",
    "Jacqui Hewitt",
    "Jay Richman",
    "Jose Escudero",
    "Kapil Sharma",
    "Karan Bedi",
    "Kasey Jamison",
    "Kate McCagg",
    "Katie Field",
    "Kelly MacLean",
    "Kendra Hum",
    "Marina Guida",
    "Mario Patino",
    "Mohamad Itani",
    "Phil Christer",
    "Rayan Karaky",
    "Salmeh Vakilian",
    "Santiago Loizaga",
    "Takuhiro Nakamura",
    "Tamir Bar-Haim",
    "Tetsu Ishii",
    "Tong Yang",
    "Uri Gorodzinsky",
    "Willie Pang",
    "Yiping Cheng",
    "Yongming Liu",
    "Yukie Takamura",
  ];

  // =========================
  // SHOW BUTTONS ONLY ON LIKELY NEWS ARTICLE PAGES
  // =========================
  function hasJsonLdArticleType() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const s of scripts) {
      const raw = s.textContent?.trim();
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed : [parsed];

        for (const item of items) {
          const graph = item?.["@graph"];
          const nodes = graph ? (Array.isArray(graph) ? graph : [graph]) : [item];

          for (const n of nodes) {
            const t = n?.["@type"];
            const types = Array.isArray(t) ? t : (t ? [t] : []);
            if (types.some(x => /^(NewsArticle|Article|ReportageNewsArticle|BlogPosting)$/i.test(String(x)))) {
              return true;
            }
          }
        }
      } catch {}
    }
    return false;
  }

  function hasOgArticleSignals() {
    const ogType = (document.querySelector('meta[property="og:type"]')?.content || "").toLowerCase();
    if (ogType === "article") return true;
    if (document.querySelector('meta[property^="article:"]')) return true;
    return false;
  }

  function isLikelyNewsArticlePage() {
    const host = (location.hostname || "").toLowerCase();
    const BLOCKED_HOSTS = [
      "outlook.office.com",
      "outlook.live.com",
      "mail.google.com",
      "docs.google.com",
      "drive.google.com",
      "calendar.google.com",
      "teams.microsoft.com",
      "slack.com",
      "app.smartsheet.com",
    ];
    if (BLOCKED_HOSTS.some(h => host === h || host.endsWith("." + h))) return false;

    if (document.querySelector("article")) return true;
    if (hasOgArticleSignals()) return true;
    if (hasJsonLdArticleType()) return true;

    const h1 = document.querySelector("h1");
    const timeEl =
      document.querySelector("time[datetime]") ||
      document.querySelector('meta[property="article:published_time"]') ||
      document.querySelector('meta[name="parsely-pub-date"]') ||
      document.querySelector('meta[itemprop="datePublished"]');

    const mainText = (document.querySelector("main")?.innerText || document.body?.innerText || "")
      .replace(/\s+/g, " ")
      .trim();

    if (h1 && timeEl && mainText.length > 2000) return true;

    return false;
  }

  // =========================
  // URL
  // =========================
  function getCanonicalUrl() {
    const canon = document.querySelector('link[rel="canonical"]')?.href;
    return canon || location.href;
  }

  // =========================
  // HEADLINE
  // =========================
  function cleanHeadline(s) {
    return (s || "").replace(/\s+/g, " ").replace(/^\s*By\s+/i, "").trim();
  }

  function stripOutletSuffix(s) {
    return (s || "").replace(/\s+(?:\||-|\u2014)\s+[^|-\u2014]{2,}\s*$/, "").trim();
  }

  function looksLikeHeadline(s) {
    const t = cleanHeadline(s);
    if (!t) return false;
    if (t.length < 12) return false;
    if (/^(home|news|opinion|subscribe|sign in|sign up|newsletter)$/i.test(t)) return false;
    return true;
  }

  function getHeadline() {
    const h1Candidates = Array.from(document.querySelectorAll("article h1, main article h1, main h1, h1"))
      .map(el => cleanHeadline(el.innerText))
      .filter(looksLikeHeadline);

    if (h1Candidates.length) return h1Candidates.sort((a, b) => b.length - a.length)[0];

    const og = cleanHeadline(document.querySelector('meta[property="og:title"]')?.content);
    if (looksLikeHeadline(og)) return stripOutletSuffix(og);

    const tw = cleanHeadline(document.querySelector('meta[name="twitter:title"]')?.content);
    if (looksLikeHeadline(tw)) return stripOutletSuffix(tw);

    return cleanHeadline(stripOutletSuffix(document.title || ""));
  }

  // =========================
  // JSON-LD helper (author / publication / date)
  // =========================
  function cleanAuthor(s) {
    return (s || "").replace(/^\s*By\s+/i, "").replace(/\s+/g, " ").trim();
  }

  function parseJsonLdNewsArticle() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    const out = { authorNames: [], publisherName: "", datePublished: "" };

    for (const s of scripts) {
      const raw = s.textContent?.trim();
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed : [parsed];

        for (const item of items) {
          const graph = item?.["@graph"];
          const nodes = graph ? (Array.isArray(graph) ? graph : [graph]) : [item];

          for (const n of nodes) {
            const type = n?.["@type"];
            const types = Array.isArray(type) ? type : [type];
            if (!types.includes("NewsArticle") && !types.includes("Article") && !types.includes("ReportageNewsArticle")) continue;

            const p = n?.publisher;
            if (p?.name && !out.publisherName) out.publisherName = String(p.name).trim();

            const a = n?.author;
            const arr = Array.isArray(a) ? a : (a ? [a] : []);
            for (const x of arr) {
              if (typeof x === "string") out.authorNames.push(cleanAuthor(x));
              else if (x?.name) out.authorNames.push(cleanAuthor(x.name));
            }

            if (!out.datePublished && n?.datePublished) out.datePublished = String(n.datePublished).trim();
          }
        }
      } catch {}
    }

    out.authorNames = Array.from(new Set(out.authorNames.filter(Boolean)));
    return out;
  }

  // =========================
  // AUTHOR
  // =========================
  function getAuthor() {
    const meta =
      document.querySelector('meta[name="author"]')?.content ||
      document.querySelector('meta[property="article:author"]')?.content ||
      document.querySelector('meta[name="parsely-author"]')?.content;

    if (meta) return cleanAuthor(meta);

    const rel = document.querySelector('[rel="author"]')?.textContent;
    if (rel) return cleanAuthor(rel);

    const { authorNames } = parseJsonLdNewsArticle();
    return authorNames.join(", ");
  }

  // =========================
  // PUBLICATION
  // =========================
  function getPublication() {
    const meta =
      document.querySelector('meta[property="og:site_name"]')?.content ||
      document.querySelector('meta[name="application-name"]')?.content ||
      document.querySelector('meta[name="twitter:site"]')?.content;

    if (meta) return String(meta).replace(/^@/, "").trim();

    const { publisherName } = parseJsonLdNewsArticle();
    if (publisherName) return publisherName;

    return location.hostname.replace(/^www\./, "");
  }

  // =========================
  // DATE -> MM/DD/YYYY
  // =========================
  function normalizeDateToMMDDYYYY(raw) {
    if (!raw) return "";

    const m = String(raw).match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (m) return `${m[2]}/${m[3]}/${m[1]}`;

    const d = new Date(raw);
    if (isNaN(d.getTime())) return "";

    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }

  function getDateOfPublication() {
    const meta =
      document.querySelector('meta[property="article:published_time"]')?.content ||
      document.querySelector('meta[name="parsely-pub-date"]')?.content ||
      document.querySelector('meta[name="pubdate"]')?.content ||
      document.querySelector('meta[name="publish_date"]')?.content ||
      document.querySelector('meta[itemprop="datePublished"]')?.content;

    const normalizedMeta = normalizeDateToMMDDYYYY(meta);
    if (normalizedMeta) return normalizedMeta;

    const timeEl =
      document.querySelector("article time[datetime]") ||
      document.querySelector("main time[datetime]") ||
      document.querySelector("time[datetime]");

    const normalizedTime = normalizeDateToMMDDYYYY(timeEl?.getAttribute("datetime"));
    if (normalizedTime) return normalizedTime;

    const { datePublished } = parseJsonLdNewsArticle();
    return normalizeDateToMMDDYYYY(datePublished);
  }

  // =========================
  // COUNTRY
  // =========================
  const COUNTRY_BY_SUFFIX = [
    [".co.uk", "United Kingdom"],
    [".com.au", "Australia"],
    [".com.br", "Brazil"],
    [".com.mx", "Mexico"],
  ];

  const COUNTRY_BY_TLD = {
    ".ar": "Argentina",
    ".au": "Australia",
    ".be": "Belgium",
    ".br": "Brazil",
    ".ca": "Canada",
    ".cl": "Chile",
    ".cn": "China",
    ".co": "Colombia",
    ".dk": "Denmark",
    ".fr": "France",
    ".de": "Germany",
    ".in": "India",
    ".it": "Italy",
    ".jp": "Japan",
    ".mx": "Mexico",
    ".nl": "Netherlands",
    ".no": "Norway",
    ".es": "Spain",
    ".se": "Sweden",
    ".tr": "Turkey",
    ".uk": "United Kingdom",
  };

  const MENA_TLDS = new Set([
    ".ae", ".sa", ".qa", ".kw", ".bh", ".om", ".ye",
    ".jo", ".lb", ".il", ".ps",
    ".eg", ".ma", ".dz", ".tn", ".ly", ".sd",
  ]);

  function getCountry() {
    const host = (location.hostname || "").toLowerCase();

    for (const [suffix, country] of COUNTRY_BY_SUFFIX) {
      if (host.endsWith(suffix)) return country;
    }

    for (const tld of MENA_TLDS) {
      if (host.endsWith(tld)) return "MENA";
    }

    const tldMatch = host.match(/\.[a-z]{2,}$/i);
    const tld = tldMatch ? tldMatch[0] : "";
    if (tld && COUNTRY_BY_TLD[tld]) return COUNTRY_BY_TLD[tld];

    const firstLabel = host.split(".")[0];
    const subdomainMap = {
      uk: "United Kingdom",
      us: "United States",
      ca: "Canada",
      au: "Australia",
      fr: "France",
      de: "Germany",
      it: "Italy",
      es: "Spain",
      nl: "Netherlands",
      no: "Norway",
      se: "Sweden",
      dk: "Denmark",
      be: "Belgium",
      in: "India",
      jp: "Japan",
      cn: "China",
      mx: "Mexico",
      br: "Brazil",
      ar: "Argentina",
      cl: "Chile",
      co: "Colombia",
      tr: "Turkey",
    };
    if (subdomainMap[firstLabel]) return subdomainMap[firstLabel];

    if (host.endsWith(".com")) return DEFAULT_COUNTRY_FOR_DOTCOM;

    return "";
  }

  // =========================
  // HELPERS / NORMALIZERS
  // =========================
  function normalizeYesNo(v) {
    if (typeof v === "boolean") return v ? YES_VALUE : NO_VALUE;
    const s = String(v || "").trim().toLowerCase();
    if (["yes", "y", "true", "1"].includes(s)) return YES_VALUE;
    if (["no", "n", "false", "0"].includes(s)) return NO_VALUE;
    return "";
  }

  function normalizeAdsEvent(aiObj) {
    if (!aiObj?.yes) return "";
    const name = String(aiObj?.event_name || "").trim();
    return ADS_EVENTS.includes(name) ? name : "";
  }

  function normalizeAnnouncement(aiObj) {
    if (!aiObj?.yes) return "";
    const name = String(aiObj?.name || "").trim();
    return name || "";
  }

  function normalizeTags(rawArr) {
    const allowed = new Set(TAGS);
    const arr = Array.isArray(rawArr) ? rawArr.map(String).map(s => s.trim()).filter(Boolean) : [];
    return Array.from(new Set(arr.filter(x => allowed.has(x))));
  }

  function normalizeKeyMessage(rawVal) {
    const v = String(rawVal || "").trim();
    return KEY_MESSAGES.includes(v) ? v : "";
  }

  function normalizeSpokesperson(rawVal) {
    const v = String(rawVal || "").trim();
    return SPOKESPERSONS.includes(v) ? v : "";
  }

  function normalizeStoryClassification(rawArr) {
    const arr = Array.isArray(rawArr) ? rawArr.map(String).map(s => s.trim()).filter(Boolean) : [];
    const allowed = new Set(STORY_CLASSIFICATION_OPTIONS);

    const cleaned = Array.from(new Set(arr.filter(x => allowed.has(x))));

    // Hard exclusives
    if (cleaned.includes("Owned (About Amazon or A20M)")) return ["Owned (About Amazon or A20M)"];
    if (cleaned.includes("Ad load/density")) return ["Ad load/density"];

    const nonTraditional = cleaned.filter(x => x.startsWith("Non-Traditional:"));
    const primary = cleaned.filter(x => !x.startsWith("Non-Traditional:"));

    if (nonTraditional.length) {
      const nt = nonTraditional[0];
      const p = primary.find(x => x === "Signature" || x === "Agenda-setting" || x === "Other");
      return p ? [p, nt] : [nt];
    }

    if (cleaned.includes("Signature")) return ["Signature"];
    if (cleaned.includes("Agenda-setting")) return ["Agenda-setting"];
    if (cleaned.includes("Other")) return ["Other"];

    return cleaned.slice(0, 1);
  }

  function normalizeNameList(raw) {
    if (Array.isArray(raw)) {
      const parts = raw.map(String).map(s => s.trim()).filter(Boolean);
      return Array.from(new Set(parts)).join(", ");
    }
    return String(raw || "").trim();
  }

  // =========================
  // ARTICLE TEXT (for AI prompt)
  // =========================
  function getArticleTextForAI(maxChars = ARTICLE_TEXT_CHARS) {
    const el =
      document.querySelector("article") ||
      document.querySelector("main article") ||
      document.querySelector("main") ||
      document.body;

    const text = (el?.innerText || "").replace(/\s+/g, " ").trim();
    return text.slice(0, maxChars);
  }

  // =========================
  // AI PROMPT + QUICKSUITE FLOW
  // =========================
  function buildQuickSuitePrompt(base) {
    return `
Return ONLY valid JSON (no markdown, no commentary).

Inputs:
Headline: ${base.headline}
URL: ${base.url}
Publication: ${base.publication}
Date: ${base.date}
Country: ${base.country}
ArticleText: ${base.articleText}

Return JSON with exactly these keys:
{
  "ads_event": {"yes": true/false, "event_name": ""},
  "amazon_ads_campaign_or_announcement": {"yes": true/false, "name": ""},
  "tags": [],
  "story_classification": [],
  "key_message_pull_through": "",

  "industry_bodies": {"yes": true/false, "industry_body_or_association": ""},
  "customer_partner_success": {
    "yes": true/false,
    "customer_names": [],
    "partner_names": []
  },
  "ai_innovation_story": true/false,
  "spokesperson": ""
}

General rules:
- If you are unsure, leave fields blank rather than guessing (except yes/no where you can answer "No" if clearly absent).
- For any field that uses an allowed list, return ONLY exact strings from the allowed list.

Story Classification rules:
- story_classification must be an array containing ONLY items from the Allowed Story Classification list.
- In most cases, return exactly ONE selection.
- The ONLY time you should return TWO selections is when it is Non-Traditional:
  - Include exactly ONE of:
    "Non-Traditional: Podcast" OR "Non-Traditional: Newsletter / Substack" OR "Non-Traditional: Other"
  - AND include exactly ONE of: "Signature" OR "Agenda-setting" OR "Other"
- If the story is in an owned channel (About Amazon / A20M / advertising.amazon.com) select ONLY:
  ["Owned (About Amazon or A20M)"]
- Ad load/density:
  - Select "Ad load/density" when and ONLY when the article focuses on the AMOUNT of ads in Amazon products/services
    (e.g., "too many ads on Prime Video" or an article about the number of ads on Prime Video).
  - If you select "Ad load/density", it MUST be the ONLY selection in story_classification.
- "Agenda-setting": rare, high-investment placement intended to influence/shift a key narrative (often exclusive-style, many stakeholders).
- "Signature": positive/neutral; Amazon/brand is the key takeaway in the headline/subhead; key message pull-through in first 2–3 paragraphs.
- "Other": important story that isn't Agenda-setting or Signature.
- Non-traditional placements can still be Signature/Agenda-setting/Other; in that case return TWO selections (one primary + one non-traditional).

Ads Event rules:
- Only select an event if the story is SIGNIFICANTLY tied to that event AND Amazon's presence at the event is a focus
  (e.g., Amazon keynote, Amazon product launch at the event, Amazon Ads compared directly vs another company at the event).
- A simple mention of an event name is NOT enough.
- If not clearly tied, set ads_event.yes=false and event_name="".

Amazon Ads Campaign or Announcement rules:
- Only set yes and provide a name if the story is SIGNIFICANTLY tied to a specific campaign/announcement/product launch.
- If you are not confident, leave it blank (yes=false, name="").

Tags rules (select-all-that-apply):
- tags must be an array containing ONLY items from the Allowed Tags list (exact spelling/capitalization).
- Only select tags when the topic is a FOCUS of the article, not a one-off mention or a list.
- Amazon Autos tagging:
  - Car-buying experience -> "Amazon Autos: Consumer"
  - Advertising offering -> "Amazon Autos: B2B"
  - Both if both are meaningfully covered.
- Corporate reputation/cause:
  - Use for critical/skeptical/negative coverage cycles about Amazon Ads offerings.
- CreativeX:
  - Use when the article focuses on Amazon Ads GenAI creative tools (audio/video/image) or CreativeX-owned initiatives.
- Ground Truth Blog:
  - Use for owned blog-post style explainers on aboutamazon.com or advertising.amazon.com.
- Privacy:
  - Use when privacy is a focus/concern of the story.
- Retail industry advertising:
  - Use for retail media / other retailers using Amazon ad tech for sponsored products on their sites.
- Ad Relevance:
  - Use when ad relevance is a focus.
- 3P announcement:
  - Use for third-party partnership announcements with Amazon.
- Thought leadership:
  - Use for stories centered on what Amazon Ads executives think (interviews, Q&A, podcast transcript).

Key message pull-through rules (single-select):
- key_message_pull_through must be either "" OR exactly one item from the Allowed Key Messages list.
- Select one ONLY if the article contains language VERY CLOSE to verbatim to one key message.
- If not near-verbatim, return "".

Industry bodies rules:
- industry_bodies.yes = true ONLY if there is a significant mention of Amazon's involvement with an advertising/marketing industry body.
- If yes, set industry_body_or_association to the industry body name EXACTLY as it appears in the article.
- If no, set industry_bodies.yes = false and industry_body_or_association = "".

Customer/partner success story rules:
- customer_partner_success.yes = true if the coverage features a customer or partner success anecdote, interview/quote, or prominent focus.
- Incidental mentions do NOT qualify.
- If yes:
  - customer_names: array of customer advertiser names prominently featured in the success story.
  - partner_names: array of partners working with Amazon on an initiative prominently featured.
- If no, return empty arrays.

AI Innovation Story rules:
- ai_innovation_story = true ONLY if the article highlights Amazon as a leader in AI for advertisers.
- Mentions of AI inside a product announcement do NOT qualify unless AI leadership is a clear focus.

Spokesperson rules:
- spokesperson must be either "" OR exactly one name from the Allowed Spokesperson list.
- Select a spokesperson only if an Amazon Ads spokesperson is featured (quoted/interviewed/prominent), not just mentioned.

Allowed Ads Events (choose ONLY from this list):
${JSON.stringify(ADS_EVENTS)}

Allowed Tags (choose ONLY from this list):
${JSON.stringify(TAGS)}

Allowed Story Classification (choose ONLY from this list):
${JSON.stringify(STORY_CLASSIFICATION_OPTIONS)}

Allowed Key Messages (choose ONLY from this list):
${JSON.stringify(KEY_MESSAGES)}

Allowed Spokesperson (choose ONLY from this list):
${JSON.stringify(SPOKESPERSONS)}
    `.trim();
  }

  function runAiStep1() {
    if (!QUICKSUITE_URL || QUICKSUITE_URL.includes("<PASTE_QUICKSUITE_URL_HERE>")) {
      alert("Set QUICKSUITE_URL at the top of the script first.");
      return;
    }

    const base = collectBasePayload();
    const articleText = getArticleTextForAI();
    const promptText = buildQuickSuitePrompt({ ...base, articleText });

    GM_setClipboard(promptText, "text");
    window.open(QUICKSUITE_URL, "_blank", "noopener,noreferrer");
    alert("AI prompt copied to clipboard. Paste into QuickSuite, run it, copy ONLY the JSON output, then click 'Step 2'.");
  }

  function promptForAiJson() {
    const txt = prompt("Paste the JSON output from QuickSuite (JSON only):");
    if (!txt) return null;
    try {
      return JSON.parse(txt);
    } catch {
      alert("Invalid JSON. Make sure you copied ONLY the JSON (no markdown/code fences).");
      return null;
    }
  }

  // =========================
  // PAYLOAD + PREFILL
  // =========================
  function collectBasePayload() {
    return {
      headline: getHeadline(),
      url: getCanonicalUrl(),
      author: getAuthor(),
      publication: getPublication(),
      date: getDateOfPublication(),
      country: getCountry(),
    };
  }

  // Smartsheet multi-select prefills often require repeated query params.
  function setMulti(params, label, arr) {
    if (!label) return;
    if (!Array.isArray(arr) || arr.length === 0) return;
    for (const v of arr.map(String).map(s => s.trim()).filter(Boolean)) {
      params.append(label, v);
    }
  }

  function buildPrefillUrl({ headline, url, author, publication, date, country, ai }) {
    const params = new URLSearchParams();

    // Base fields
    if (headline) params.set(FIELD.headline, headline);
    if (url) params.set(FIELD.url, url);
    if (author) params.set(FIELD.author, author);
    if (publication) params.set(FIELD.publication, publication);
    if (date) params.set(FIELD.date, date);
    if (country) params.set(FIELD.country, country);

    // AI fields
    if (ai) {
      const story = normalizeStoryClassification(ai.story_classification);
      if (story.length) setMulti(params, FIELD.storyClassification, story);

      const tags = normalizeTags(ai.tags);
      if (tags.length) setMulti(params, FIELD.tags, tags);

      const km = normalizeKeyMessage(ai.key_message_pull_through);
      if (km) params.set(FIELD.keyMessagePullThrough, km);

      const ev = normalizeAdsEvent(ai.ads_event);
      if (ev) params.set(FIELD.adsEvent, ev);

      const ann = normalizeAnnouncement(ai.amazon_ads_campaign_or_announcement);
      if (ann) params.set(FIELD.adsAnnouncement, ann);

      // Industry bodies: question MUST be exactly "Yes"/"No"
      const industryYesNo = normalizeYesNo(ai.industry_bodies?.yes);
      if (industryYesNo) params.set(FIELD.industryBodiesQ, industryYesNo);

      const industryBody = String(ai.industry_bodies?.industry_body_or_association || "").trim();
      if (industryYesNo === YES_VALUE && industryBody) {
        params.set(FIELD.industryBodyName, industryBody);
      }

      const cpsYesNo = normalizeYesNo(ai.customer_partner_success?.yes);
      if (cpsYesNo) params.set(FIELD.customerPartnerSuccessQ, cpsYesNo);

      if (cpsYesNo === YES_VALUE) {
        const customerNames = normalizeNameList(ai.customer_partner_success?.customer_names);
        const partnerNames = normalizeNameList(ai.customer_partner_success?.partner_names);
        if (customerNames) params.set(FIELD.customerNamesSuccess, customerNames);
        if (partnerNames) params.set(FIELD.partnerNamesSuccess, partnerNames);
      }

      const aiInnovYesNo = normalizeYesNo(ai.ai_innovation_story);
      if (aiInnovYesNo) params.set(FIELD.aiInnovationStoryQ, aiInnovYesNo);

      const sp = normalizeSpokesperson(ai.spokesperson);
      if (sp) params.set(FIELD.spokesperson, sp);
    }

    return `${FORM_URL}?${params.toString()}`;
  }

  function runAiStep2() {
    const ai = promptForAiJson();
    if (!ai) return;

    const base = collectBasePayload();

    // Copy TSV (base) for safety
    const tsv = `${base.headline}\t${base.url}\t${base.author}\t${base.publication}\t${base.date}\t${base.country}`;
    GM_setClipboard(tsv, "text");

    window.open(buildPrefillUrl({ ...base, ai }), "_blank", "noopener,noreferrer");
  }

  // =========================
  // BUTTONS
  // =========================
  function makeButton(label, bottomPx, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.setAttribute("aria-label", label);

    b.style.setProperty("position", "fixed", "important");
    b.style.setProperty("z-index", "2147483647", "important");
    b.style.setProperty("right", "16px", "important");
    b.style.setProperty("bottom", `${bottomPx}px`, "important");

    b.style.setProperty("padding", "10px 14px", "important");
    b.style.setProperty("border-radius", "10px", "important");
    b.style.setProperty("border", "1px solid rgba(0,0,0,.25)", "important");
    b.style.setProperty("background", "#ffffff", "important");

    b.style.setProperty("color", "#111111", "important");
    b.style.setProperty("font-family", "system-ui, -apple-system, Segoe UI, Roboto, Arial", "important");
    b.style.setProperty("font-size", "14px", "important");
    b.style.setProperty("font-weight", "700", "important");
    b.style.setProperty("line-height", "1.2", "important");
    b.style.setProperty("letter-spacing", "0.2px", "important");
    b.style.setProperty("white-space", "nowrap", "important");

    b.style.setProperty("cursor", "pointer", "important");
    b.style.setProperty("box-shadow", "0 6px 18px rgba(0,0,0,.15)", "important");

    b.addEventListener("click", onClick);
    document.documentElement.appendChild(b);
  }

  // Only show buttons on pages that look like news/articles
  if (isLikelyNewsArticlePage()) {
    const STEP2_BOTTOM_PX = 16 + UI_RAISE_PX; // lower button
    const STEP1_BOTTOM_PX = 64 + UI_RAISE_PX; // higher button

    makeButton("Step 1", STEP1_BOTTOM_PX, runAiStep1);
    makeButton("Step 2", STEP2_BOTTOM_PX, runAiStep2);
  }

})();
