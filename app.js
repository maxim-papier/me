const app = document.getElementById("app");
const params = new URLSearchParams(window.location.search);
const projectId = params.get("id");
const EAGER_COUNT = 6; // 2 rows × 3 cols on desktop — must be before routing (TDZ)

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

  // Filters: All | projects... | categories...
  const nav = document.createElement("nav");
  nav.className = "filter";

  const allBtn = document.createElement("button");
  allBtn.className = "filter-btn active";
  allBtn.dataset.filter = "all";
  allBtn.dataset.filterType = "all";
  allBtn.textContent = "All";
  nav.appendChild(allBtn);

  // Project filters
  for (const [id, name] of Object.entries(projectMap)) {
    const btn = document.createElement("button");
    btn.className = "filter-btn";
    btn.dataset.filter = id;
    btn.dataset.filterType = "project";
    btn.textContent = name;
    nav.appendChild(btn);
  }

  // Separator
  const sep = document.createElement("span");
  sep.className = "filter-sep";
  nav.appendChild(sep);

  // Category filters
  for (const [key, label] of Object.entries(categoryMap)) {
    const btn = document.createElement("button");
    btn.className = "filter-btn";
    btn.dataset.filter = key;
    btn.dataset.filterType = "category";
    btn.textContent = label;
    nav.appendChild(btn);
  }

  header.appendChild(nav);
  app.before(header);

  // Masonry grid
  const grid = document.createElement("main");
  grid.className = "masonry";

  const pictures = allImages.map((img) => {
    const basePath = `assets/images/${img.projectId}`;
    const picture = createPicture(img, basePath, grid);
    picture.dataset.project = img.projectId;
    return picture;
  });

  // Shuffle
  for (let i = pictures.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pictures[i], pictures[j]] = [pictures[j], pictures[i]];
  }

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
  const pictures = project.images.map((img) =>
    createPicture(img, basePath, grid)
  );

  for (let i = pictures.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pictures[i], pictures[j]] = [pictures[j], pictures[i]];
  }

  pictures.forEach((pic, i) => {
    pic.style.setProperty("--i", i);
    grid.appendChild(pic);
  });

  app.replaceWith(grid);
  waitForImages(grid);
  initLightbox(grid);
}

// --- Picture element factory ---

function createPicture(img, basePath, grid) {
  const picture = document.createElement("picture");
  picture.dataset.cat = img.cat;
  picture.dataset.slug = img.slug;

  const isCarousel = img.slides && img.slides.length > 1;
  let coverAvif, coverWebp;

  if (img.slides) {
    // Carousel: cover = first slide inside subfolder
    coverAvif = `${basePath}/${img.cat}/${img.slug}/${img.slides[0]}.avif`;
    coverWebp = `${basePath}/${img.cat}/${img.slug}/${img.slides[0]}.webp`;
    // Store slide base paths for lightbox (without extension)
    picture.dataset.group = img.slug;
    picture.dataset.slides = JSON.stringify(
      img.slides.map((s) => `${basePath}/${img.cat}/${img.slug}/${s}`)
    );
  } else {
    // Single image
    coverAvif = `${basePath}/${img.cat}/${img.slug}.avif`;
    coverWebp = `${basePath}/${img.cat}/${img.slug}.webp`;
  }

  const sourceAvif = document.createElement("source");
  sourceAvif.srcset = coverAvif;
  sourceAvif.type = "image/avif";

  const sourceWebp = document.createElement("source");
  sourceWebp.srcset = coverWebp;
  sourceWebp.type = "image/webp";

  const imgEl = document.createElement("img");
  imgEl.src = coverWebp;
  imgEl.alt = "";
  imgEl.loading = "lazy";
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

  return picture;
}

// --- Shared helpers ---

function waitForImages(grid) {
  // Pre-calculate masonry layout from w/h data (one pass, no per-image reflows)
  layoutMasonry(grid);

  // Mark above-the-fold images as eager (by viewport position, not array index)
  const viewportHeight = window.innerHeight;
  const pictures = grid.querySelectorAll("picture");
  let eagerCount = 0;

  for (const pic of pictures) {
    if (pic.style.display === "none") continue;
    if (eagerCount >= EAGER_COUNT) break;
    const rect = pic.getBoundingClientRect();
    if (rect.top < viewportHeight) {
      const img = pic.querySelector("img");
      if (img) {
        img.loading = "eager";
        if (eagerCount === 0) img.fetchPriority = "high";
      }
      pic.classList.add("eager");
      eagerCount++;
    }
  }

  // Observe image load for .loaded class (animation trigger)
  pictures.forEach((pic) => {
    const img = pic.querySelector("img");
    if (!img) return;
    const onReady = () => pic.classList.add("loaded");
    if (img.complete && img.naturalHeight > 0) {
      onReady();
    } else {
      img.addEventListener("load", onReady, { once: true });
      img.addEventListener("error", () => {
        pic.remove();
        layoutMasonry(grid);
      }, { once: true });
    }
  });

  // Safety: if images haven't shown after 3s, force them visible
  setTimeout(() => {
    pictures.forEach((pic) => {
      if (!pic.classList.contains("loaded") && !pic.classList.contains("eager")) {
        pic.classList.add("loaded");
      }
    });
  }, 3000);

  // Debounced resize handler (200ms)
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => layoutMasonry(grid), 200);
  });
}

function layoutMasonry(grid) {
  const colCount = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
  const columnWidth = grid.offsetWidth / colCount;
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 12;

  grid.querySelectorAll("picture").forEach((pic) => {
    if (pic.style.display === "none") return;
    const img = pic.querySelector("img");
    if (!img) return;

    // Pre-calculate from w/h HTML attributes (not img.width which returns rendered px)
    const w = parseInt(img.getAttribute("width"));
    const h = parseInt(img.getAttribute("height"));
    if (w && h) {
      const renderedHeight = columnWidth / w * h;
      pic.style.gridRowEnd = "span " + Math.ceil(renderedHeight + gap);
    } else {
      // Fallback for images without dimensions
      pic.style.gridRowEnd = "span " + Math.ceil(img.offsetHeight + gap);
    }
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

  // Set slide directly (no transition) — used for initial open and reduced motion
  async function setSlideImmediate(index) {
    const gen = ++loadGen;
    currentIndex = wrapIndex(index);
    currentSlide.classList.add("lightbox__slide--loading");
    setSlideSrc(currentSlide, slides[currentIndex]);

    try {
      await Promise.race([
        currentSlide.querySelector("img").decode(),
        new Promise((_, r) => setTimeout(() => r("timeout"), 100)),
      ]);
    } catch { /* show anyway */ }
    if (gen !== loadGen) return;
    currentSlide.classList.remove("lightbox__slide--loading");

    // Reset transforms
    currentSlide.style.transform = "";
    currentSlide.style.transition = "";
    incomingSlide.style.transform = "translateX(100%)";
    clearSlideSrc(incomingSlide);

    updateChrome();
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

    if (dragState === STATE_SETTLING) {
      // Rapid swipe: cancel current transition, force to idle
      ++transitionGen;
      forceToIdle();
      // Delay 1 frame for Safari compositor flush
      requestAnimationFrame(() => startDrag(e));
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
    document
      .querySelectorAll(".masonry, .project-header, #app")
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
      const srcset = webpSource?.srcset || webpSource?.dataset?.srcset;
      if (srcset) open([srcset.replace(/\.webp$/, "")], 0, pic);
    }
  }

  function close() {
    ++transitionGen;
    forceToIdle();
    overlay.classList.remove("lightbox--open");
    document.body.style.overflow = "";
    setBackgroundInert(false);
    triggerEl?.focus();
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
    }
    if (e.key === "ArrowLeft") goTo(currentIndex - 1);
    if (e.key === "ArrowRight") goTo(currentIndex + 1);
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
