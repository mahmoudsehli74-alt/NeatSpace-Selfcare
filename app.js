/* ════════════════════════════════════════════════════════════════════════
   NeatSpace Selfcare — storefront logic (vanilla ES2020, zero deps)

   URL    : …/?id={product_key}
   DATA   : ./products/{id}.json  (committed by NeatSpace-Core's bridge)

   Dual-schema normalizeDocument(): accepts BOTH
     A) nested bridge.py canonical { key, product:{price,images[]}, … }
     B) flat contract        { id, price, original_price, images[], … }
   Security: ?id whitelisted to [A-Za-z0-9._-]{1,120}; untrusted text renders
   via textContent/createElement ONLY (never innerHTML); images carry
   referrerpolicy="no-referrer"; CTAs are nofollow sponsored noopener.
   ════════════════════════════════════════════════════════════════════════ */

"use strict";

const CONFIG = {
  fetchTimeoutMs: 8000,
  // Public repo whose products/ directory is the live catalog source.
  repo: "mahmoudsehli74-alt/NeatSpace-Selfcare",
  catalogMax: 24,
  catalogCacheTtlMs: 30 * 60 * 1000,
  featuredCount: 6,
  pinterestProfile: "https://www.pinterest.com/",
  angleLabels: {
    "self-care-ritual": "Self-Care Ritual Pick",
    "daily-wellness": "Daily Wellness Essential",
    "spa-night": "Spa-Night Staple",
    "gentle-beauty": "Gentle Beauty Find",
    "mindful-moment": "Mindful Moment",
    "rest-and-reset": "Rest & Reset Pick",
    "cozy-corner": "Cozy Evening Ritual",
    "problem-solver": "Everyday Ease",
  },
};

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">' +
      '<rect width="400" height="400" fill="#ebf1ec"/>' +
      '<path d="M200 150c26 30 42 50 42 74a42 42 0 1 1-84 0c0-24 16-44 42-74z" ' +
      'fill="#d3e0d7"/>' +
      '<text x="200" y="330" text-anchor="middle" font-family="Arial" ' +
      'font-size="15" fill="#9db1a5">image unavailable</text></svg>'
  );

/* ── helpers ──────────────────────────────────────────────────────────── */

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value != null) node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child == null) continue; // conditional children arrive as null — skip
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function sanitizeId(raw) {
  if (!raw || typeof raw !== "string") return null;
  const id = raw.trim();
  return /^[A-Za-z0-9._-]{1,120}$/.test(id) ? id : null;
}

function productIdFromUrl() {
  return sanitizeId(new URLSearchParams(window.location.search).get("id"));
}

async function fetchJson(url, { timeoutMs = CONFIG.fetchTimeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseMoney(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^\d.,]/g, "").replace(/,(\d{2})$/, ".$1").replace(/,/g, "");
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPrice(value, currency) {
  const amount = typeof value === "number" ? value : null; // normalized upstream
  if (!Number.isFinite(amount)) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: currency || "USD", maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function discountPercent(current, original) {
  if (
    Number.isFinite(current) && Number.isFinite(original) &&
    original > current && current >= 0
  ) {
    return `-${Math.round(((original - current) / original) * 100)}%`;
  }
  return null;
}

function angleLabel(angle) {
  if (!angle) return "Wellness Find";
  return CONFIG.angleLabels[angle] ||
    `${angle.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} Essential`;
}

function firstLine(text, max = 150) {
  const line = String(text || "").split(/\.\s+|\n/)[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/* ── dual-schema normalizer (identical to Aesthetics standard) ────────── */

function normalizeDocument(doc) {
  if (!doc || typeof doc !== "object") return null;
  const nestedProduct = doc.product || {};
  const nestedPrice = nestedProduct.price || {};
  const currency =
    nestedPrice.currency || doc.currency || doc.product?.currency || "USD";
  const current = parseMoney(
    nestedPrice.current ?? doc.price_current ?? doc.current_price ?? doc.price
  );
  const original = parseMoney(
    nestedPrice.original ?? doc.original_price ?? doc.was_price
  );
  const imagesRaw =
    (Array.isArray(doc.images) && doc.images.length && doc.images) ||
    (Array.isArray(nestedProduct.images) && nestedProduct.images.length && nestedProduct.images) ||
    [nestedProduct.image || doc.image || null];
  const images = imagesRaw.filter((u) => typeof u === "string" && u.startsWith("http"));
  return {
    key: doc.key || doc.id || "",
    title: doc.title || nestedProduct.title || "Curated Wellness Find",
    description: doc.description || "",
    landingAngle: doc.landing_angle || doc.angle || null,
    hashtags: Array.isArray(doc.hashtags) ? doc.hashtags : [],
    images,
    affiliateUrl:
      typeof doc.affiliate_url === "string" && /^https:\/\//i.test(doc.affiliate_url)
        ? doc.affiliate_url
        : null,
    currency,
    current,
    original,
    disclosure: doc.disclosure || null,
  };
}

/* ── gallery (1:1 tile, dot pagination, lazy neighbor decode) ─────────── */

function buildGallery(images) {
  const track = $("gallery-track");
  const dots = $("gallery-dots");
  const count = $("gallery-count");
  const prev = $("gallery-prev");
  const next = $("gallery-next");
  const slides = [];
  const dotEls = [];

  images.forEach((url, index) => {
    const img = el("img", {
      src: index === 0 ? url : PLACEHOLDER_IMAGE,
      alt: `Self-care product photo ${index + 1}`,
      decoding: "async",
      referrerpolicy: "no-referrer",
      loading: index === 0 ? "eager" : "lazy",
    });
    img.dataset.src = url;
    img.onerror = () => {
      img.src = PLACEHOLDER_IMAGE;
      img.dataset.src = "";
    };
    slides.push(el("div", { class: "gallery__slide" }, img));
    track.appendChild(slides[slides.length - 1]);
    dotEls.push(el("span", { class: "gallery__dot" }));
    dots.appendChild(dotEls[dotEls.length - 1]);
  });

  const total = images.length;
  if (total <= 1) {
    prev.hidden = true;
    next.hidden = true;
    count.hidden = true;
    return;
  }

  let active = 0;
  const setActive = (index) => {
    active = ((index % total) + total) % total;
    dotEls.forEach((dot, i) => dot.classList.toggle("is-active", i === active));
    count.textContent = `${active + 1}/${total}`;
    for (const offset of [0, 1]) {
      const lazy = slides[(active + offset) % total].querySelector("img");
      if (lazy && lazy.dataset.src) {
        lazy.src = lazy.dataset.src;
        lazy.dataset.src = "";
      }
    }
  };

  const goTo = (index) => {
    const target = ((index % total) + total) % total;
    track.scrollTo({ left: slides[target].offsetLeft, behavior: "smooth" });
  };
  prev.addEventListener("click", () => goTo(active - 1 < 0 ? total - 1 : active - 1));
  next.addEventListener("click", () => goTo((active + 1) % total));

  let raf = null;
  track.addEventListener("scroll", () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      const slide = Math.round(track.scrollLeft / track.clientWidth);
      if (slide !== active) setActive(slide);
    });
  });

  setActive(0);
}

/* ── hydration ────────────────────────────────────────────────────────── */

function hydrateProduct(doc) {
  const item = normalizeDocument(doc);
  if (!item) throw new Error("unusable product document");

  $("kicker").textContent = angleLabel(item.landingAngle);
  $("title").textContent = item.title;
  $("description").textContent = item.description;

  $("price").textContent = formatPrice(item.current, item.currency) || "";
  $("price-old").textContent =
    item.original && item.original !== item.current
      ? formatPrice(item.original, item.currency) || ""
      : "";
  const deal = discountPercent(item.current, item.original);
  const badge = $("discount");
  badge.textContent = deal || "";
  badge.hidden = !deal;

  const tags = $("tags");
  (item.hashtags || []).slice(0, 6).forEach((tag) => tags.appendChild(el("li", { text: tag })));
  if (!item.hashtags.length) tags.hidden = true;

  $("cta-price").textContent = formatPrice(item.current, item.currency) || "";
  $("disclosure").textContent =
    item.disclosure || "As an affiliate, we may earn from qualifying purchases.";

  const cta = $("cta");
  if (item.affiliateUrl) {
    cta.href = item.affiliateUrl;
  } else {
    cta.textContent = "Currently Unavailable";
    cta.setAttribute("aria-disabled", "true");
    cta.removeAttribute("href");
  }

  buildGallery(item.images.length ? item.images : [PLACEHOLDER_IMAGE]);

  // Share-preview hydration
  document.title = `${item.title} — NeatSpace Selfcare`;
  $("og-title")?.setAttribute("content", item.title);
  $("og-desc")?.setAttribute(
    "content",
    firstLine(item.description) || "Gently curated self-care finds."
  );
  const hero = item.images[0];
  if (hero) $("og-image")?.setAttribute("content", hero);
}

/* ── root storefront catalog (ported from the Kitchen architecture) ──────
   Enumerates products/*.json via the PUBLIC GitHub Contents API
   (sessionStorage-cached 30 min). textContent only — never innerHTML. */

function catalogSessionKey() {
  return `ns-catalog-${CONFIG.repo}/products`;
}

async function listCatalogKeys() {
  const cached = sessionStorage.getItem(catalogSessionKey());
  if (cached) {
    try {
      const { keys, ts } = JSON.parse(cached);
      if (Array.isArray(keys) && Date.now() - ts < CONFIG.catalogCacheTtlMs) {
        return keys;
      }
    } catch { /* corrupted cache — refetch */ }
  }
  const url = `https://api.github.com/repos/${CONFIG.repo}/contents/products`;
  const files = await fetchJson(url);
  if (!Array.isArray(files)) throw new Error("unexpected catalog listing");
  const keys = files
    .map((f) => (f && f.type === "file" && typeof f.name === "string" ? f.name : ""))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .filter((key) => sanitizeId(key))
    .sort()
    .reverse();
  try {
    sessionStorage.setItem(catalogSessionKey(),
                          JSON.stringify({ keys, ts: Date.now() }));
  } catch { /* private mode */ }
  return keys;
}

function buildCatalogCard(doc) {
  const thumb = doc.images[0] || PLACEHOLDER_IMAGE;
  const deal = discountPercent(doc.current, doc.original);
  const img = el("img", {
    src: thumb, alt: "", loading: "lazy", decoding: "async",
    referrerpolicy: "no-referrer",
    onerror: (e) => { e.target.src = PLACEHOLDER_IMAGE; },
  });
  return el(
    "a",
    { class: "card card--catalog", href: `./?id=${encodeURIComponent(doc.key)}` },
    el("div", { class: "card__thumb" }, img,
      deal ? el("span", { class: "card__deal", text: deal }) : null),
    el("div", { class: "card__body" },
      el("div", { class: "card__title", text: doc.title }),
      el("div", { class: "card__row" },
        el("span", { class: "card__price", text: formatPrice(doc.current, doc.currency) || "See price" }),
        doc.original ? el("span", { class: "card__price-old", text: formatPrice(doc.original, doc.currency) }) : null),
      el("span", { class: "card__cta", text: "Get the Ritual" })
    )
  );
}

async function renderCatalog(keys) {
  const grid = $("catalog-grid");
  const shown = keys.slice(0, CONFIG.catalogMax);
  // STREAM: each card appears the moment its JSON lands — one slow fetch
  // never delays the shelf (live lesson: a stale-etag file held the whole
  // batch for seconds on first visit).
  await Promise.all(shown.map(async (key) => {
    try {
      const doc = normalizeDocument(await fetchJson(`./products/${encodeURIComponent(key)}.json`));
      if (doc && doc.key) grid.appendChild(buildCatalogCard(doc));
    } catch { /* one dead card must never kill the shelf */ }
  }));
  $("catalog-count").textContent =
    grid.children.length ? `${grid.children.length} curated rituals` : "";
  return grid.children.length;
}

async function showStorefront() {
  $("skeleton").hidden = true;
  $("product").hidden = true;
  $("fallback").hidden = true;
  const home = $("storefront");
  home.hidden = false;
  document.title = "NeatSpace Selfcare — Small Rituals, Softer Days";

  let rendered = 0;
  try {
    rendered = await renderCatalog(await listCatalogKeys());
  } catch (error) {
    console.warn("[neatspace] catalog listing failed:", error);
  }
  if (!rendered) {
    $("catalog-empty").hidden = false;
  }
}

/* ── fallback / 404 ───────────────────────────────────────────────────── */

async function showFallback() {
  $("skeleton").hidden = true;
  $("product").hidden = true;
  $("fallback").hidden = false;
  document.title = "NeatSpace Selfcare — Small Rituals, Softer Days";
  try {
    const keys = await fetchJson("./featured.json", { timeoutMs: 4000 });
    if (!Array.isArray(keys) || !keys.length) return;
    const docs = (await Promise.allSettled(
      keys.slice(0, CONFIG.featuredCount).map(sanitizeId).filter(Boolean)
        .map((key) => fetchJson(`./products/${encodeURIComponent(key)}.json`))
    ))
      .filter((r) => r.status === "fulfilled")
      .map((r) => normalizeDocument(r.value))
      .filter(Boolean);
    if (!docs.length) return;
    const grid = $("featured-grid");
    docs.forEach((item) => {
      grid.appendChild(
        el(
          "a",
          { class: "card", href: `./?id=${encodeURIComponent(item.key)}` },
          el("div", { class: "card__thumb" },
            el("img", {
              src: item.images[0] || PLACEHOLDER_IMAGE,
              alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer",
              onerror: (e) => { e.target.src = PLACEHOLDER_IMAGE; },
            })),
          el("div", { class: "card__body" },
            el("div", { class: "card__title", text: item.title }),
            el("div", { class: "card__price", text: formatPrice(item.current, item.currency) || "" }))
        )
      );
    });
    $("featured-wrap").hidden = false;
  } catch {
    /* featured.json optional — the calm hero alone is a complete fallback */
  }
}

function showProduct() {
  $("skeleton").hidden = true;
  $("fallback").hidden = true;
  $("product").hidden = false;
}

/* ── boot ─────────────────────────────────────────────────────────────── */

function init() {
  const id = productIdFromUrl();
  if (!id) {
    // Root visit (bio link): the dynamic catalog, not the 404 hero.
    showStorefront();
    return;
  }
  fetchJson(`./products/${encodeURIComponent(id)}.json`)
    .then((doc) => {
      hydrateProduct(doc);
      showProduct();
    })
    .catch((error) => {
      console.warn(`[neatspace] product ${id} failed to load:`, error);
      showFallback();
    });
}

if (typeof document !== "undefined") init();

/* Node-testable pure exports */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    sanitizeId, parseMoney, formatPrice, discountPercent, angleLabel,
    firstLine, normalizeDocument,
  };
}
