const app = document.getElementById("app");
const params = new URLSearchParams(window.location.search);
const projectId = params.get("id");
const adminMode = params.get("edit") === "1";

// Reduced motion preference (reactive)
let prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;
window
  .matchMedia("(prefers-reduced-motion: reduce)")
  .addEventListener("change", (e) => {
    prefersReducedMotion = e.matches;
  });

// --- Drag physics helpers (must be before routing code — classes aren't hoisted) ---

class VelocityTracker {
  constructor() {
    this.history = [];
  }
  add(x, time) {
    this.history.push({ x, time });
    const cutoff = time - 100;
    while (this.history.length > 5 || this.history[0]?.time < cutoff)
      this.history.shift();
  }
  get() {
    const h = this.history;
    if (h.length < 2) return 0;
    const dt = h[h.length - 1].time - h[0].time;
    if (dt === 0) return 0;
    return (h[h.length - 1].x - h[0].x) / dt;
  }
  reset() {
    this.history = [];
  }
}

function shouldSnap(displacement, velocity, containerWidth) {
  const VELOCITY_THRESHOLD = 0.5;
  const DISTANCE_THRESHOLD = 0.35;
  const velocityOK = Math.abs(velocity) > VELOCITY_THRESHOLD;
  const distanceOK =
    Math.abs(displacement) > containerWidth * DISTANCE_THRESHOLD;
  const sameDirection =
    Math.sign(displacement) === Math.sign(velocity) || velocity === 0;
  return (velocityOK || distanceOK) && sameDirection;
}

function springAnimate({ from, to, velocity = 0, stiffness = 200, damping = 20, onUpdate, onComplete }) {
  let position = from;
  let v = velocity;
  let lastTime = performance.now();
  let rafId = null;
  function tick(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.064);
    lastTime = now;
    const force = -stiffness * (position - to) - damping * v;
    v += force * dt;
    position += v * dt;
    onUpdate(position);
    if (Math.abs(position - to) < 0.5 && Math.abs(v) < 0.1) {
      onUpdate(to);
      onComplete?.();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
  return () => { if (rafId) cancelAnimationFrame(rafId); };
}

function rubberBand(offset, dimension) {
  return (1 - 1 / ((offset * 0.55) / dimension + 1)) * dimension;
}

// --- Curation flags (admin-only liked/hidden state) ---
// Snapshot model: localStorage holds a full map, not a diff. On first entry
// into admin mode, seed from published flags. All edits are absolute.

const LS_KEY = "portfolio:flags";

function getPublishedFlags() {
  return (typeof flags === "object" && flags) ? flags : {};
}

function loadLocalSnapshot() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw == null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveLocalSnapshot(obj) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  } catch (e) {
    console.error("localStorage full or unavailable", e);
  }
  updateUnsavedIndicator();
}

function clearLocalSnapshot() {
  localStorage.removeItem(LS_KEY);
  updateUnsavedIndicator();
}

// Single source of active flags. Public: published only. Admin: localStorage
// (seeded from published on first entry).
function activeFlags() {
  if (!adminMode) return getPublishedFlags();
  const local = loadLocalSnapshot();
  if (local !== null) return local;
  const seeded = { ...getPublishedFlags() };
  saveLocalSnapshot(seeded);
  return seeded;
}

function keyFor(projectId, cat, slug) {
  return `${projectId}/${cat}/${slug}`;
}

function writeFlag(current, key, newState) {
  const next = { ...current };
  if (newState === "normal") delete next[key];
  else next[key] = newState;
  saveLocalSnapshot(next);
  return next;
}

function isDirty() {
  const local = loadLocalSnapshot();
  if (local === null) return false;
  const pub = getPublishedFlags();
  const keys = new Set([...Object.keys(local), ...Object.keys(pub)]);
  for (const k of keys) if (local[k] !== pub[k]) return true;
  return false;
}

// Admin overlay template — built once, cloned per picture
const _adminOverlayTemplate = (() => {
  const t = document.createElement("template");
  t.innerHTML = `
    <div class="admin-overlay">
      <button class="admin-btn admin-btn--like" data-action="like" aria-label="Toggle like">♡</button>
      <button class="admin-btn admin-btn--hide" data-action="hide" aria-label="Toggle hide">✕</button>
    </div>
  `.trim();
  return t;
})();

function adminOverlayClone() {
  return _adminOverlayTemplate.content.firstElementChild.cloneNode(true);
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Wires admin UI (grid click handler, cross-tab sync, admin-bar) into the current render.
// Safe no-op outside admin mode. Called once per render from renderAll / renderProject / renderIndex.
function initAdminMode(grid) {
  if (!adminMode) return;

  if (grid) {
    // Capture-phase listener runs BEFORE the existing grid click that opens lightbox
    grid.addEventListener("click", (e) => {
      const btn = e.target.closest(".admin-btn");
      if (!btn) return;
      e.stopPropagation();
      const picture = btn.closest("picture");
      const action = btn.dataset.action;
      const key = keyFor(picture.dataset.project, picture.dataset.cat, picture.dataset.slug);
      const current = picture.dataset.flag || "normal";
      const next = (action === "like")
        ? (current === "liked" ? "normal" : "liked")
        : (current === "hidden" ? "normal" : "hidden");

      const active = activeFlags();
      writeFlag(active, key, next);

      if (next === "normal") picture.removeAttribute("data-flag");
      else picture.dataset.flag = next;
    }, true);

    // Cross-tab sync — rescue from silent data loss when two admin tabs are open.
    window.addEventListener("storage", (e) => {
      if (e.key !== LS_KEY) return;
      const map = activeFlags();
      grid.querySelectorAll("picture").forEach((pic) => {
        const key = keyFor(pic.dataset.project, pic.dataset.cat, pic.dataset.slug);
        const state = map[key];
        if (state === "liked" || state === "hidden") pic.dataset.flag = state;
        else pic.removeAttribute("data-flag");
      });
      updateUnsavedIndicator();
    });
  }

  renderAdminBar();
  preserveAdminInLinks();
}

function renderAdminBar() {
  // Idempotent — remove any existing bar before re-rendering
  document.querySelector(".admin-bar")?.remove();

  const bar = document.createElement("div");
  bar.className = "admin-bar";
  bar.innerHTML = `
    <span class="admin-bar__indicator" id="admin-indicator"></span>
    <button class="admin-bar__btn" id="admin-export">Export flags</button>
    <button class="admin-bar__btn admin-bar__btn--danger" id="admin-reset">Reset to published</button>
  `;
  document.body.appendChild(bar);

  document.getElementById("admin-export").addEventListener("click", exportFlags);
  document.getElementById("admin-reset").addEventListener("click", resetLocalFlags);
  updateUnsavedIndicator();
}

function exportFlags() {
  const snapshot = loadLocalSnapshot() ?? getPublishedFlags();
  const out = {};
  for (const [k, v] of Object.entries(snapshot)) {
    if (v === "liked" || v === "hidden") out[k] = v;
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "flags.json";
  a.click();
  URL.revokeObjectURL(url);
}

// No confirm — solo-user tool; extra click per use is friction without value.
function resetLocalFlags() {
  clearLocalSnapshot();
  location.reload();
}

function updateUnsavedIndicator() {
  const indicator = document.getElementById("admin-indicator");
  if (!indicator) return;
  const dirty = isDirty();
  indicator.textContent = dirty ? "unsaved" : "saved";
  indicator.classList.toggle("admin-bar__indicator--dirty", dirty);
}

// Propagate ?edit=1 through internal links so navigating to another page keeps admin mode on.
function preserveAdminInLinks() {
  if (!adminMode) return;
  document.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (!href) return;
    if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//")) return;
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    if (href.includes("edit=1")) return;
    const sep = href.includes("?") ? "&" : "?";
    a.setAttribute("href", href + sep + "edit=1");
  });
}

// Public: filter hidden, partition [liked, normal], shuffle each, concat.
// Admin: return images shuffled (preserves existing "fresh on every load" feel, no filter).
// Images may carry img.projectId (renderAll) or inherit defaultProjectId (renderProject).
function applyCuration(images, defaultProjectId, flagsMap) {
  if (adminMode) {
    return { images: shuffleInPlace(images.slice()), stateByKey: flagsMap };
  }
  const liked = [];
  const normal = [];
  for (const img of images) {
    const pid = img.projectId || defaultProjectId;
    const state = flagsMap[`${pid}/${img.cat}/${img.slug}`];
    if (state === "hidden") continue;
    if (state === "liked") liked.push(img);
    else normal.push(img);
  }
  shuffleInPlace(liked);
  shuffleInPlace(normal);
  return { images: liked.concat(normal), stateByKey: flagsMap };
}

// Determine which page to render
if (window.location.pathname.includes("project.html")) {
  if (!projectId) {
    window.location.href = "index.html";
  } else if (projectId === "all") {
    renderAll();
  } else {
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      renderNotFound();
    } else {
      renderProject(project);
    }
  }
} else {
  renderIndex();
}

// --- Index page ---

function renderIndex() {
  app.classList.add("index");

  // Hero section
  const hero = document.createElement("section");
  hero.className = "hero";
  hero.innerHTML = `
    <h1 class="hero__name">Maxim Brykov<br>(Papier)</h1>
    <p class="hero__role">multidisciplinary<br>visual designer</p>
  `;
  app.appendChild(hero);

  // Clients bar
  const bar = document.createElement("section");
  bar.className = "clients-bar";

  const label = document.createElement("span");
  label.className = "clients-bar__label";
  label.textContent = "Clients:";
  bar.appendChild(label);

  for (const project of projects) {
    const item = document.createElement("a");
    item.className = "clients-bar__item";
    item.href = `project.html?id=${project.id}`;

    if (project.logo) {
      const logo = document.createElement("img");
      logo.className =
        "clients-bar__logo" +
        (project.logoRound ? " clients-bar__logo--round" : "");
      logo.src = project.logo;
      logo.alt = project.name;
      logo.width = 32;
      logo.height = 32;
      item.appendChild(logo);
    }

    const name = document.createElement("span");
    name.className = "clients-bar__name";
    name.textContent = project.name;
    item.appendChild(name);

    bar.appendChild(item);
  }

  // Separator + Show all
  const sep = document.createElement("span");
  sep.className = "clients-bar__sep";
  bar.appendChild(sep);

  const showAll = document.createElement("a");
  showAll.className = "clients-bar__show-all";
  showAll.href = "project.html?id=all";
  showAll.textContent = "Show all";
  bar.appendChild(showAll);

  app.appendChild(bar);

  // Prefetch project pages on hover — by the time user clicks, page is cached
  bar.addEventListener("pointerenter", (e) => {
    const link = e.target.closest("a[href]");
    if (!link || link._prefetched) return;
    link._prefetched = true;
    const hint = document.createElement("link");
    hint.rel = "prefetch";
    hint.href = link.href;
    document.head.appendChild(hint);
  }, true);

  // LinkedIn link
  const linkedin = document.createElement("a");
  linkedin.className = "index__footer";
  linkedin.href = "https://www.linkedin.com/in/maxim-brykov-15bbb72b/";
  linkedin.target = "_blank";
  linkedin.rel = "noopener";
  linkedin.textContent = "Linkedin";
  app.appendChild(linkedin);

  initAdminMode(null);
}

// --- All projects page ---

function renderAll() {
  document.title = "All Projects";

  // Collect all images with project info
  const allImages = [];
  for (const project of projects) {
    for (const img of project.images) {
      allImages.push({
        ...img,
        projectId: project.id,
        projectName: project.name,
      });
    }
  }

  // Collect unique categories across all projects and project names for filters
  const categoryMap = {};
  const projectMap = {};
  for (const project of projects) {
    if (project.images.length === 0) continue;
    projectMap[project.id] = project.name;
    for (const [key, label] of Object.entries(project.categories)) {
      if (!categoryMap[key]) categoryMap[key] = label;
    }
  }

  // Header
  const header = document.createElement("header");
  header.className = "project-header";

  const backLink = document.createElement("a");
  backLink.href = "index.html";
  backLink.innerHTML = "&larr; Back";
  header.appendChild(backLink);

  // Filters: All | categories... | projects...
  const nav = document.createElement("nav");
  nav.className = "filter";

  // Category group (work types + All)
  const catGroup = document.createElement("div");
  catGroup.className = "filter-group";
  const catLabel = document.createElement("span");
  catLabel.className = "filter-label";
  catLabel.textContent = "Work";
  catGroup.appendChild(catLabel);

  const catChips = document.createElement("div");
  catChips.className = "filter-chips";

  const allBtn = document.createElement("button");
  allBtn.className = "filter-btn active";
  allBtn.dataset.filter = "all";
  allBtn.dataset.filterType = "all";
  allBtn.textContent = "All";
  catChips.appendChild(allBtn);

  for (const [key, label] of Object.entries(categoryMap)) {
    const btn = document.createElement("button");
    btn.className = "filter-btn";
    btn.dataset.filter = key;
    btn.dataset.filterType = "category";
    btn.textContent = label;
    catChips.appendChild(btn);
  }
  catGroup.appendChild(catChips);
  nav.appendChild(catGroup);

  // Separator
  const sep = document.createElement("span");
  sep.className = "filter-sep";
  nav.appendChild(sep);

  // Project group (brands)
  const projGroup = document.createElement("div");
  projGroup.className = "filter-group";
  const projLabel = document.createElement("span");
  projLabel.className = "filter-label";
  projLabel.textContent = "Brand";
  projGroup.appendChild(projLabel);

  const projChips = document.createElement("div");
  projChips.className = "filter-chips";

  for (const [id, name] of Object.entries(projectMap)) {
    const btn = document.createElement("button");
    btn.className = "filter-btn";
    btn.dataset.filter = id;
    btn.dataset.filterType = "project";
    btn.textContent = name;
    projChips.appendChild(btn);
  }
  projGroup.appendChild(projChips);
  nav.appendChild(projGroup);

  header.appendChild(nav);
  app.before(header);

  // Masonry grid
  const grid = document.createElement("main");
  grid.className = "masonry";

  // Curation: applyCuration handles hidden filter, liked-tier promotion, and shuffle-within-tier
  const flagsMap = activeFlags();
  const { images: curatedImages } = applyCuration(allImages, null, flagsMap);

  const pictures = curatedImages.map((img) => {
    const basePath = `assets/images/${img.projectId}`;
    return createPicture(img, basePath, grid, img.projectId, flagsMap);
  });

  pictures.forEach((pic, i) => {
    pic.style.setProperty("--i", i);
    grid.appendChild(pic);
  });

  // Filter handler
  nav.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    const filter = btn.dataset.filter;
    const filterType = btn.dataset.filterType;
    nav
      .querySelectorAll(".filter-btn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    grid.querySelectorAll("picture").forEach((pic) => {
      let show = false;
      if (filter === "all") show = true;
      else if (filterType === "project") show = pic.dataset.project === filter;
      else if (filterType === "category") show = pic.dataset.cat === filter;
      pic.style.display = show ? "" : "none";
      if (!show) pic.style.gridRowEnd = "";
    });
    layoutMasonry(grid);
  });

  app.replaceWith(grid);
  waitForImages(grid);
  initLightbox(grid);
  initAdminMode(grid);
}

// --- Single project page ---

function renderProject(project) {
  document.title = project.name;

  const header = document.createElement("header");
  header.className = "project-header";

  const backLink = document.createElement("a");
  backLink.href = "index.html";
  backLink.innerHTML = "&larr; Back";
  header.appendChild(backLink);

  const catKeys = Object.keys(project.categories);
  if (catKeys.length > 1) {
    const nav = document.createElement("nav");
    nav.className = "filter";

    const allBtn = document.createElement("button");
    allBtn.className = "filter-btn active";
    allBtn.dataset.filter = "all";
    allBtn.textContent = "All";
    nav.appendChild(allBtn);

    for (const [key, label] of Object.entries(project.categories)) {
      const btn = document.createElement("button");
      btn.className = "filter-btn";
      btn.dataset.filter = key;
      btn.textContent = label;
      nav.appendChild(btn);
    }

    nav.addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-btn");
      if (!btn) return;
      const filter = btn.dataset.filter;
      nav
        .querySelectorAll(".filter-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      grid.querySelectorAll("picture").forEach((pic) => {
        const show = filter === "all" || pic.dataset.cat === filter;
        pic.style.display = show ? "" : "none";
        if (!show) pic.style.gridRowEnd = "";
      });
      layoutMasonry(grid);
    });

    header.appendChild(nav);
  }

  app.before(header);

  const grid = document.createElement("main");
  grid.className = "masonry";

  const basePath = `assets/images/${project.id}`;
  const flagsMap = activeFlags();
  const { images: curatedImages } = applyCuration(project.images, project.id, flagsMap);

  const pictures = curatedImages.map((img) =>
    createPicture(img, basePath, grid, project.id, flagsMap)
  );

  pictures.forEach((pic, i) => {
    pic.style.setProperty("--i", i);
    grid.appendChild(pic);
  });

  app.replaceWith(grid);
  waitForImages(grid);
  initLightbox(grid);
  initAdminMode(grid);
}

// --- Picture element factory ---

function createPicture(img, basePath, grid, projectId, flagsMap) {
  const picture = document.createElement("picture");
  picture.dataset.cat = img.cat;
  picture.dataset.slug = img.slug;
  picture.dataset.project = projectId;

  if (adminMode && flagsMap) {
    const state = flagsMap[`${projectId}/${img.cat}/${img.slug}`];
    if (state === "liked" || state === "hidden") picture.dataset.flag = state;
  }

  const isCarousel = img.slides && img.slides.length > 1;
  let coverBase; // path without extension — used to build srcset with size variants

  if (img.slides) {
    // Carousel: cover = first slide inside subfolder
    coverBase = `${basePath}/${img.cat}/${img.slug}/${img.slides[0]}`;
    // Store slide base paths for lightbox (without extension, 1400w base only)
    picture.dataset.group = img.slug;
    picture.dataset.slides = JSON.stringify(
      img.slides.map((s) => `${basePath}/${img.cat}/${img.slug}/${s}`)
    );
  } else {
    // Single image
    coverBase = `${basePath}/${img.cat}/${img.slug}`;
  }

  // Size variants mirror publish.mjs THUMB_WIDTHS: 800w, plus 1400w base (no suffix).
  // sizes mirrors style.css breakpoints: 1-col ≤600px, 2-col 601–1200px, 3-col ≥1201px.
  const sizes = "(max-width: 600px) 100vw, (max-width: 1200px) 50vw, 33vw";

  const sourceAvif = document.createElement("source");
  sourceAvif.srcset = `${coverBase}-800.avif 800w, ${coverBase}.avif 1400w`;
  sourceAvif.sizes = sizes;
  sourceAvif.type = "image/avif";

  const sourceWebp = document.createElement("source");
  sourceWebp.srcset = `${coverBase}-800.webp 800w, ${coverBase}.webp 1400w`;
  sourceWebp.sizes = sizes;
  sourceWebp.type = "image/webp";

  const imgEl = document.createElement("img");
  imgEl.src = `${coverBase}.webp`; // 1400w fallback for browsers that ignore srcset
  imgEl.alt = "";
  imgEl.loading = "lazy";
  imgEl.decoding = "async";
  if (img.w && img.h) {
    imgEl.width = img.w;
    imgEl.height = img.h;
  }
  imgEl.onerror = () => {
    picture.remove();
    layoutMasonry(grid);
  };

  picture.append(sourceAvif, sourceWebp, imgEl);

  // Badge for carousels with 2+ slides — SVG icon + count
  if (isCarousel) {
    const badge = document.createElement("span");
    badge.className = "slide-badge";
    badge.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="13" height="20" rx="2"/><path d="M19 4v16"/><path d="M22 7v10"/></svg> ' +
      img.slides.length;
    picture.appendChild(badge);
  }

  if (adminMode) {
    picture.appendChild(adminOverlayClone());
  }

  return picture;
}

// --- Shared helpers ---

function waitForImages(grid) {
  // Pre-calculate masonry layout from w/h data (one pass, no per-image reflows)
  layoutMasonry(grid);

  // Mark above-the-fold images as eager (by viewport position, not array index)
  const viewportHeight = window.innerHeight;
  const pictures = grid.querySelectorAll("picture");
  let firstEager = true;

  for (const pic of pictures) {
    if (pic.style.display === "none") continue;
    if (pic.getBoundingClientRect().top >= viewportHeight) continue;
    const img = pic.querySelector("img");
    if (img) {
      img.loading = "eager";
      if (firstEager) { img.fetchPriority = "high"; firstEager = false; }
    }
    pic.classList.add("loaded"); // instant visibility for above-the-fold
  }

  // Observe image load for .loaded class (animation trigger for lazy images)
  pictures.forEach((pic) => {
    if (pic.classList.contains("loaded")) return;
    const img = pic.querySelector("img");
    if (!img) return;
    const onReady = () => pic.classList.add("loaded");
    if (img.complete && img.naturalHeight > 0) {
      onReady();
    } else {
      img.addEventListener("load", onReady, { once: true });
    }
  });

  // Debounced resize handler (200ms) — one-shot, assumes full page reloads
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => layoutMasonry(grid), 200);
  });
}

function layoutMasonry(grid) {
  const colCount = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
  const columnWidth = grid.offsetWidth / colCount;
  if (columnWidth <= 0) return;
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 12;

  grid.querySelectorAll("picture").forEach((pic) => {
    if (pic.style.display === "none") return;
    const img = pic.querySelector("img");
    if (!img) return;
    const w = parseInt(img.getAttribute("width"));
    const h = parseInt(img.getAttribute("height"));
    if (!w || !h) return;
    pic.style.gridRowEnd = "span " + Math.ceil(columnWidth / w * h + gap);
  });
}

// --- Shared dot helpers ---

function renderDots(container, count, classPrefix) {
  container.replaceChildren();
  for (let i = 0; i < count; i++) {
    const dot = document.createElement("button");
    dot.className = `${classPrefix}__dot`;
    dot.setAttribute("aria-label", `Go to image ${i + 1}`);
    dot.dataset.index = i;
    container.appendChild(dot);
  }
}

function updateDotActive(container, activeIndex, classPrefix) {
  for (const dot of container.children) {
    dot.classList.toggle(
      `${classPrefix}__dot--active`,
      +dot.dataset.index === activeIndex
    );
  }
}

// --- Lightbox ---

function initLightbox(grid) {
  // Build lightbox DOM
  const overlay = document.createElement("div");
  overlay.className = "lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Image viewer");

  const content = document.createElement("div");
  content.className = "lightbox__content";

  // Stage: container for two slides (current + incoming) for slide transitions
  const stage = document.createElement("div");
  stage.className = "lightbox__stage";

  function createSlideEl() {
    const pic = document.createElement("picture");
    pic.className = "lightbox__slide";
    const sAvif = document.createElement("source");
    sAvif.type = "image/avif";
    const sWebp = document.createElement("source");
    sWebp.type = "image/webp";
    const img = document.createElement("img");
    img.className = "lightbox__slide-img";
    pic.append(sAvif, sWebp, img);
    return pic;
  }

  const slideA = createSlideEl();
  const slideB = createSlideEl();
  slideA.classList.add("lightbox__slide--current");
  slideB.classList.add("lightbox__slide--incoming");
  stage.append(slideA, slideB);
  content.appendChild(stage);

  const closeBtn = document.createElement("button");
  closeBtn.className = "lightbox__close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";

  const prevBtn = document.createElement("button");
  prevBtn.className = "lightbox__arrow lightbox__arrow--prev";
  prevBtn.setAttribute("aria-label", "Previous image");
  prevBtn.textContent = "";

  const nextBtn = document.createElement("button");
  nextBtn.className = "lightbox__arrow lightbox__arrow--next";
  nextBtn.setAttribute("aria-label", "Next image");
  nextBtn.textContent = "";

  const dotsNav = document.createElement("div");
  dotsNav.className = "lightbox__dots";

  const liveRegion = document.createElement("div");
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.className = "sr-only";

  content.append(prevBtn, nextBtn);
  overlay.append(closeBtn, content, dotsNav, liveRegion);
  document.body.appendChild(overlay);

  // State
  let slides = [];
  let currentIndex = 0;
  let triggerEl = null;
  const preloaded = new Set();
  let loadGen = 0;

  // Slide elements — current and incoming swap roles after each transition
  let currentSlide = slideA;
  let incomingSlide = slideB;

  function setSlideSrc(slideEl, basePath) {
    const img = slideEl.querySelector("img");
    const avif = slideEl.querySelector('source[type="image/avif"]');
    const webp = slideEl.querySelector('source[type="image/webp"]');
    // Set handlers BEFORE src (cached images fire onload synchronously)
    img.onload = () => slideEl.classList.remove("lightbox__slide--loading");
    img.onerror = () => slideEl.classList.remove("lightbox__slide--loading");
    avif.srcset = basePath + ".avif";
    webp.srcset = basePath + ".webp";
    img.src = basePath + ".webp";
  }

  function clearSlideSrc(slideEl) {
    slideEl.querySelectorAll("source").forEach((s) => (s.srcset = ""));
    slideEl.querySelector("img").removeAttribute("src");
  }

  function preloadSlide(index) {
    const wi = ((index % slides.length) + slides.length) % slides.length;
    if (preloaded.has(wi)) return;
    preloaded.add(wi);
    const img = new Image();
    img.src = slides[wi] + ".webp";
    img.decode?.().catch(() => {});
  }

  function wrapIndex(i) {
    return ((i % slides.length) + slides.length) % slides.length;
  }

  // Update UI elements (dots, arrows, aria) without changing the slide image
  function updateChrome() {
    const isMulti = slides.length > 1;
    prevBtn.style.display = isMulti ? "" : "none";
    nextBtn.style.display = isMulti ? "" : "none";
    dotsNav.style.display = isMulti ? "" : "none";

    if (isMulti) {
      updateDotActive(dotsNav, currentIndex, "lightbox");
      liveRegion.textContent = `Image ${currentIndex + 1} of ${slides.length}`;
      overlay.setAttribute(
        "aria-label",
        `Image ${currentIndex + 1} of ${slides.length}`
      );
    }

    preloadSlide(currentIndex + 1);
    preloadSlide(currentIndex - 1);
  }

  // --- Drag state machine ---
  const STATE_IDLE = 0;
  const STATE_DRAGGING = 1;
  const STATE_SETTLING = 2;

  let dragState = STATE_IDLE;
  let dragStartX = 0;
  let dragDx = 0;
  let dragDirection = 0; // -1 = prev, 1 = next
  let dragTargetIndex = -1;
  let transitionGen = 0;
  let settlingTimeout = null;
  let cancelSpring = null;
  const velocity = new VelocityTracker();

  function forceToIdle() {
    if (cancelSpring) { cancelSpring(); cancelSpring = null; }
    if (settlingTimeout) { clearTimeout(settlingTimeout); settlingTimeout = null; }
    currentSlide.style.transition = "";
    currentSlide.style.transform = "";
    currentSlide.style.willChange = "";
    incomingSlide.style.transition = "";
    incomingSlide.style.transform = "translateX(100%)";
    incomingSlide.style.willChange = "";
    clearSlideSrc(incomingSlide);
    overlay.classList.remove("lightbox--dragging");
    dragState = STATE_IDLE;
  }

  function swapSlides() {
    // Swap roles
    const tmp = currentSlide;
    currentSlide = incomingSlide;
    incomingSlide = tmp;
    // Update classes
    currentSlide.classList.add("lightbox__slide--current");
    currentSlide.classList.remove("lightbox__slide--incoming");
    incomingSlide.classList.add("lightbox__slide--incoming");
    incomingSlide.classList.remove("lightbox__slide--current");
  }

  function animateSlide(direction) {
    // direction: -1 = show prev, 1 = show next
    if (slides.length <= 1) return;

    const targetIndex = wrapIndex(currentIndex + direction);
    const stageWidth = stage.offsetWidth;

    // Prepare incoming slide
    setSlideSrc(incomingSlide, slides[targetIndex]);
    incomingSlide.style.transition = "none";
    incomingSlide.style.transform = `translateX(${direction * stageWidth}px)`;
    // Force reflow to apply initial position
    incomingSlide.offsetHeight; // eslint-disable-line no-unused-expressions

    if (prefersReducedMotion) {
      // Instant swap — no animation
      currentIndex = targetIndex;
      swapSlides();
      currentSlide.style.transform = "";
      clearSlideSrc(incomingSlide);
      incomingSlide.style.transform = "translateX(100%)";
      updateChrome();
      return;
    }

    dragState = STATE_SETTLING;
    const gen = ++transitionGen;

    currentSlide.style.transition = "transform 0.3s ease-out";
    incomingSlide.style.transition = "transform 0.3s ease-out";
    currentSlide.style.transform = `translateX(${-direction * stageWidth}px)`;
    incomingSlide.style.transform = "translateX(0)";

    settlingTimeout = setTimeout(() => {
      if (dragState === STATE_SETTLING && transitionGen === gen) finishSettle(targetIndex, gen);
    }, 500);

    incomingSlide.addEventListener(
      "transitionend",
      function handler(e) {
        if (e.target !== incomingSlide) return;
        incomingSlide.removeEventListener("transitionend", handler);
        if (gen !== transitionGen) return;
        finishSettle(targetIndex, gen);
      }
    );
  }

  function finishSettle(targetIndex, gen) {
    if (settlingTimeout) { clearTimeout(settlingTimeout); settlingTimeout = null; }
    if (gen !== transitionGen) return;

    currentIndex = targetIndex;
    swapSlides();

    currentSlide.style.transition = "";
    currentSlide.style.transform = "";
    currentSlide.style.willChange = "";
    incomingSlide.style.transition = "";
    incomingSlide.style.transform = "translateX(100%)";
    incomingSlide.style.willChange = "";
    clearSlideSrc(incomingSlide);
    overlay.classList.remove("lightbox--dragging");

    dragState = STATE_IDLE;
    updateChrome();
  }

  // Pointer event handlers for drag
  function onPointerDown(e) {
    if (e.target.closest("button")) return;
    if (slides.length <= 1) return;
    // Only drag on the image/stage area, not the overlay background
    if (!e.target.closest(".lightbox__content")) return;

    if (dragState === STATE_SETTLING) {
      // Rapid swipe: cancel current transition, force to idle
      const gen = ++transitionGen;
      forceToIdle();
      // Delay 1 frame for Safari compositor flush; guard against new pointer arriving first
      requestAnimationFrame(() => {
        if (transitionGen !== gen) return;
        startDrag(e);
      });
      return;
    }

    if (dragState !== STATE_IDLE) return;
    startDrag(e);
  }

  function startDrag(e) {
    dragState = STATE_DRAGGING;
    dragStartX = e.clientX;
    dragDx = 0;
    dragDirection = 0;
    dragTargetIndex = -1;
    velocity.reset();
    velocity.add(e.clientX, e.timeStamp);

    currentSlide.style.willChange = "transform";
    incomingSlide.style.willChange = "transform";
    currentSlide.style.transition = "none";
    incomingSlide.style.transition = "none";

    overlay.classList.add("lightbox--dragging");
    overlay.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (dragState !== STATE_DRAGGING) return;
    dragDx = e.clientX - dragStartX;
    velocity.add(e.clientX, e.timeStamp);

    const stageWidth = stage.offsetWidth;
    const dir = dragDx < 0 ? 1 : -1; // 1 = next, -1 = prev
    const targetIndex = wrapIndex(currentIndex + dir);

    // Load incoming slide if direction changed
    if (dir !== dragDirection) {
      dragDirection = dir;
      dragTargetIndex = targetIndex;
      setSlideSrc(incomingSlide, slides[targetIndex]);
    }

    // Translate both slides
    currentSlide.style.transform = `translateX(${dragDx}px)`;
    incomingSlide.style.transform = `translateX(${dragDx + dir * -1 * stageWidth}px)`;
  }

  function onPointerUp(e) {
    if (dragState !== STATE_DRAGGING) return;
    velocity.add(e.clientX, e.timeStamp);
    const vx = velocity.get();
    const stageWidth = stage.offsetWidth;

    if (shouldSnap(dragDx, vx, stageWidth) && dragTargetIndex >= 0) {
      // Commit to slide change
      const dir = dragDirection;
      dragState = STATE_SETTLING;
      const gen = ++transitionGen;

      if (prefersReducedMotion) {
        finishSettle(dragTargetIndex, gen);
        return;
      }

      currentSlide.style.transition = "transform 0.3s ease-out";
      incomingSlide.style.transition = "transform 0.3s ease-out";
      currentSlide.style.transform = `translateX(${dir * -1 * stageWidth}px)`;
      incomingSlide.style.transform = "translateX(0)";

      settlingTimeout = setTimeout(() => {
        if (dragState === STATE_SETTLING && transitionGen === gen) finishSettle(dragTargetIndex, gen);
      }, 500);

      incomingSlide.addEventListener(
        "transitionend",
        function handler(ev) {
          if (ev.target !== incomingSlide) return;
          incomingSlide.removeEventListener("transitionend", handler);
          if (gen !== transitionGen) return;
          finishSettle(dragTargetIndex, gen);
        }
      );
    } else {
      // Bounce back with spring
      dragState = STATE_SETTLING;
      const gen = ++transitionGen;
      const stageW = stageWidth;

      if (prefersReducedMotion) {
        forceToIdle();
        return;
      }

      const vxPxPerSec = vx * 1000;
      cancelSpring = springAnimate({
        from: dragDx,
        to: 0,
        velocity: vxPxPerSec,
        stiffness: 300,
        damping: 25,
        onUpdate(x) {
          currentSlide.style.transform = `translateX(${x}px)`;
          if (dragDirection !== 0) {
            incomingSlide.style.transform = `translateX(${x + dragDirection * -1 * stageW}px)`;
          }
        },
        onComplete() {
          cancelSpring = null;
          if (gen === transitionGen) forceToIdle();
        },
      });
    }
  }

  function onPointerCancel() {
    if (dragState === STATE_DRAGGING || dragState === STATE_SETTLING) {
      ++transitionGen;
      forceToIdle();
    }
  }

  // Track whether the pointer moved (to distinguish click from drag)
  let pointerMoved = false;

  overlay.addEventListener("pointerdown", (e) => {
    pointerMoved = false;
    onPointerDown(e);
  });
  overlay.addEventListener("pointermove", (e) => {
    if (dragState === STATE_DRAGGING && Math.abs(e.clientX - dragStartX) > 5) {
      pointerMoved = true;
    }
    onPointerMove(e);
  });
  overlay.addEventListener("pointerup", onPointerUp);
  overlay.addEventListener("pointercancel", onPointerCancel);

  // Navigation functions
  function goTo(index) {
    if (slides.length === 0) return;
    if (dragState !== STATE_IDLE) return;
    const target = wrapIndex(index);
    if (target === currentIndex) return;

    const diff = target - currentIndex;
    // Determine shortest direction for wrap-around
    let direction;
    if (Math.abs(diff) <= slides.length / 2) {
      direction = diff > 0 ? 1 : -1;
    } else {
      direction = diff > 0 ? -1 : 1;
    }
    animateSlide(direction);
  }

  function setBackgroundInert(inert) {
    // .admin-bar is included so L/X keydown doesn't shadow focus when an admin-bar
    // button had focus before the lightbox opened.
    document
      .querySelectorAll(".masonry, .project-header, #app, .admin-bar")
      .forEach((el) => {
        if (inert) el.setAttribute("inert", "");
        else el.removeAttribute("inert");
      });
  }

  function openDOM(slideUrls, startIndex) {
    slides = slideUrls;
    preloaded.clear();

    // Reset slide elements
    currentSlide = slideA;
    incomingSlide = slideB;
    slideA.classList.add("lightbox__slide--current");
    slideA.classList.remove("lightbox__slide--incoming");
    slideB.classList.add("lightbox__slide--incoming");
    slideB.classList.remove("lightbox__slide--current");

    forceToIdle();

    // Create dots once
    if (slides.length > 1) {
      renderDots(dotsNav, slides.length, "lightbox");
    } else {
      dotsNav.replaceChildren();
    }

    currentIndex = wrapIndex(startIndex);
    preloaded.add(currentIndex);
    setSlideSrc(currentSlide, slides[currentIndex]);
    currentSlide.style.transform = "";
    incomingSlide.style.transform = "translateX(100%)";
    clearSlideSrc(incomingSlide);

    updateChrome();

    if (slides.length === 1) {
      liveRegion.textContent = "Image viewer";
      overlay.setAttribute("aria-label", "Image viewer");
    }
    overlay.classList.add("lightbox--open");
    document.body.style.overflow = "hidden";
    setBackgroundInert(true);
    closeBtn.focus();
  }

  function open(slideUrls, startIndex, trigger) {
    triggerEl = trigger;
    openDOM(slideUrls, startIndex);
    // Deep link: update URL hash with image slug
    const slug = trigger?.dataset?.slug;
    if (slug) {
      const project = trigger.dataset.project;
      const fragment = project
        ? `${encodeURIComponent(project)}/${encodeURIComponent(slug)}`
        : encodeURIComponent(slug);
      history.replaceState(null, "", `#img=${fragment}`);
    }
  }

  // Extract slide URLs from a picture element and open lightbox
  function openFromPicture(pic) {
    const slidesData = pic.dataset.slides;
    if (slidesData) {
      try {
        open(JSON.parse(slidesData), 0, pic);
      } catch {}
    } else {
      const webpSource = pic.querySelector("source[type='image/webp']");
      const srcset = webpSource?.srcset;
      if (srcset) open([srcset.replace(/\.webp$/, "")], 0, pic);
    }
  }

  function close() {
    ++transitionGen;
    forceToIdle();
    overlay.classList.remove("lightbox--open");
    document.body.style.overflow = "";
    setBackgroundInert(false);
    if (triggerEl?.isConnected) triggerEl.focus();
    // Deep link: clear hash
    if (location.hash.startsWith("#img=")) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  // Event handlers
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });
  overlay.addEventListener("click", (e) => {
    if (dragState !== STATE_IDLE) return;
    // Don't close if user was dragging/swiping
    if (pointerMoved) return;
    // Close on click anywhere except nav buttons (arrows, dots)
    if (e.target.closest("button")) return;
    close();
  });

  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    goTo(currentIndex - 1);
  });
  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    goTo(currentIndex + 1);
  });

  dotsNav.addEventListener("click", (e) => {
    const dot = e.target.closest(".lightbox__dot");
    if (!dot) return;
    e.stopPropagation();
    goTo(Number(dot.dataset.index));
  });

  document.addEventListener("keydown", (e) => {
    if (!overlay.classList.contains("lightbox--open")) return;

    if (e.key === "Escape") {
      // Prevent browser from exiting fullscreen — close lightbox first
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowLeft") { goTo(currentIndex - 1); return; }
    if (e.key === "ArrowRight") { goTo(currentIndex + 1); return; }

    // Admin curation shortcuts — only when ?edit=1 active, lightbox has a trigger,
    // drag state machine is idle, and target isn't an editable input.
    if (!adminMode || !triggerEl) return;
    if (dragState !== STATE_IDLE) return;
    if (e.target.isContentEditable || e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    const k = e.key.toLowerCase();
    if (k !== "l" && k !== "x") return;

    e.preventDefault();
    const key = keyFor(triggerEl.dataset.project, triggerEl.dataset.cat, triggerEl.dataset.slug);
    const current = triggerEl.dataset.flag || "normal";
    const next = (k === "l")
      ? (current === "liked" ? "normal" : "liked")
      : (current === "hidden" ? "normal" : "hidden");

    const active = activeFlags();
    writeFlag(active, key, next);

    if (next === "normal") triggerEl.removeAttribute("data-flag");
    else triggerEl.dataset.flag = next;
  });

  // Grid click handler
  grid.addEventListener("click", (e) => {
    const pic = e.target.closest("picture");
    if (!pic || pic.closest(".lightbox")) return;
    openFromPicture(pic);
  });

  // Deep link: open lightbox if URL has #img=slug or #img=project/slug
  const hashMatch = location.hash.match(/^#img=(.+)/);
  if (hashMatch) {
    const raw = decodeURIComponent(hashMatch[1]);
    const slashIdx = raw.indexOf("/");
    let selector;
    if (slashIdx !== -1) {
      // Format: project/slug (used in "all" view)
      const project = raw.slice(0, slashIdx);
      const slug = raw.slice(slashIdx + 1);
      selector = `picture[data-project="${CSS.escape(project)}"][data-slug="${CSS.escape(slug)}"]`;
    } else {
      selector = `picture[data-slug="${CSS.escape(raw)}"]`;
    }
    const pic = grid.querySelector(selector);
    if (pic) openFromPicture(pic);
  }
}

function renderNotFound() {
  document.title = "Not Found";
  app.innerHTML = `
    <div class="index" style="text-align:center">
      <p style="color:var(--color-muted);margin-bottom:16px">Project not found</p>
      <a href="index.html" style="color:var(--color-text);text-decoration:none">&larr; Back to projects</a>
    </div>
  `;
}
