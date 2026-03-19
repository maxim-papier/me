const app = document.getElementById("app");
const params = new URLSearchParams(window.location.search);
const projectId = params.get("id");

// Reduced motion preference (reactive)
let prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;
window
  .matchMedia("(prefers-reduced-motion: reduce)")
  .addEventListener("change", (e) => {
    prefersReducedMotion = e.matches;
  });

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
  imgEl.onerror = () => {
    picture.remove();
    scheduleLayout(grid);
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

// RAF-debounced layout to avoid reflow per image load
let masonryRAF = null;
function scheduleLayout(grid) {
  if (masonryRAF) return;
  masonryRAF = requestAnimationFrame(() => {
    layoutMasonry(grid);
    masonryRAF = null;
  });
}

function waitForImages(grid) {
  const pictures = grid.querySelectorAll("picture");

  // Defer src assignment — store real URLs in data attributes
  pictures.forEach((pic) => {
    const img = pic.querySelector("img");
    const sources = pic.querySelectorAll("source");
    if (img) {
      img.dataset.src = img.src;
      img.removeAttribute("src");
    }
    sources.forEach((s) => {
      s.dataset.srcset = s.srcset;
      s.removeAttribute("srcset");
    });
  });

  // Load images as they enter viewport
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const pic = entry.target;
        const img = pic.querySelector("img");
        const sources = pic.querySelectorAll("source");

        sources.forEach((s) => {
          if (s.dataset.srcset) {
            s.srcset = s.dataset.srcset;
            delete s.dataset.srcset;
          }
        });

        if (img && img.dataset.src) {
          img.src = img.dataset.src;
          delete img.dataset.src;
          img.addEventListener("load", () => {
            pic.classList.add("loaded");
            scheduleLayout(grid);
          });
        }

        observer.unobserve(pic);
      });
    },
    { rootMargin: "200px" }
  );

  pictures.forEach((pic) => observer.observe(pic));

  // Debounced resize handler
  let resizeRAF = null;
  window.addEventListener("resize", () => {
    if (resizeRAF) cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(() => layoutMasonry(grid));
  });
}

function layoutMasonry(grid) {
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 12;
  grid.querySelectorAll("picture").forEach((pic) => {
    if (pic.style.display === "none") return;
    const img = pic.querySelector("img");
    if (!img) return;
    pic.style.gridRowEnd = "span " + Math.ceil(img.offsetHeight + gap);
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

  // AVIF support: use <picture> with AVIF + WebP sources instead of bare <img>
  const pictureEl = document.createElement("picture");
  pictureEl.className = "lightbox__img-wrapper";
  const sourceAvif = document.createElement("source");
  sourceAvif.type = "image/avif";
  const sourceWebp = document.createElement("source");
  sourceWebp.type = "image/webp";
  const imgEl = document.createElement("img");
  imgEl.className = "lightbox__img";
  pictureEl.append(sourceAvif, sourceWebp, imgEl);
  content.appendChild(pictureEl);

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
  let slides = []; // array of base paths (without extension)
  let currentIndex = 0;
  let triggerEl = null;
  const preloaded = new Set();
  let loadGen = 0; // generation counter for stale decode prevention

  function setSlideSrc(basePath) {
    // Set handlers BEFORE setting src (cached images fire onload synchronously)
    imgEl.onload = () => imgEl.classList.remove("lightbox__img--loading");
    imgEl.onerror = () => imgEl.classList.remove("lightbox__img--loading");
    // Set sources
    sourceAvif.srcset = basePath + ".avif";
    sourceWebp.srcset = basePath + ".webp";
    imgEl.src = basePath + ".webp";
  }

  function preloadSlide(index) {
    // Wrap index for preloading adjacent slides with wrap-around
    const wrappedIndex =
      ((index % slides.length) + slides.length) % slides.length;
    if (preloaded.has(wrappedIndex)) return;
    preloaded.add(wrappedIndex);
    const img = new Image();
    img.src = slides[wrappedIndex] + ".webp";
    img.decode?.().catch(() => {});
  }

  async function updateUI() {
    const gen = ++loadGen;
    imgEl.classList.add("lightbox__img--loading");
    setSlideSrc(slides[currentIndex]);

    // Decode with timeout race — 100ms max, then show anyway
    try {
      await Promise.race([
        imgEl.decode(),
        new Promise((_, r) => setTimeout(() => r("timeout"), 100)),
      ]);
    } catch {
      /* show image anyway */
    }
    if (gen !== loadGen) return; // user already navigated away
    imgEl.classList.remove("lightbox__img--loading");

    // Arrows — always visible for multi-slide (wrap-around, no disabled state)
    const isMulti = slides.length > 1;
    prevBtn.style.display = isMulti ? "" : "none";
    nextBtn.style.display = isMulti ? "" : "none";
    dotsNav.style.display = isMulti ? "" : "none";

    if (isMulti) {
      // Wrap-around: arrows always active
      prevBtn.setAttribute("aria-disabled", "false");
      prevBtn.classList.remove("lightbox__arrow--disabled");
      nextBtn.setAttribute("aria-disabled", "false");
      nextBtn.classList.remove("lightbox__arrow--disabled");

      // Update dot active state (dots created once in open())
      updateDotActive(dotsNav, currentIndex, "lightbox");

      liveRegion.textContent = `Image ${currentIndex + 1} of ${slides.length}`;
      overlay.setAttribute(
        "aria-label",
        `Image ${currentIndex + 1} of ${slides.length}`
      );
    }

    // Preload adjacent (with wrap-around)
    preloadSlide(currentIndex + 1);
    preloadSlide(currentIndex - 1);
  }

  function goTo(index) {
    // Wrap-around with modular arithmetic
    if (slides.length === 0) return;
    currentIndex =
      ((index % slides.length) + slides.length) % slides.length;
    updateUI();
  }

  function setBackgroundInert(inert) {
    document
      .querySelectorAll(".masonry, .project-header, #app")
      .forEach((el) => {
        if (inert) el.setAttribute("inert", "");
        else el.removeAttribute("inert");
      });
  }

  function open(slideUrls, startIndex, trigger) {
    slides = slideUrls;
    currentIndex = startIndex;
    triggerEl = trigger;
    preloaded.clear();
    preloaded.add(currentIndex);

    // Create dots once (not on every navigation)
    if (slides.length > 1) {
      renderDots(dotsNav, slides.length, "lightbox");
    } else {
      dotsNav.replaceChildren();
    }

    updateUI();

    if (slides.length === 1) {
      liveRegion.textContent = "Image viewer";
      overlay.setAttribute("aria-label", "Image viewer");
    }
    overlay.classList.add("lightbox--open");
    setBackgroundInert(true);
    closeBtn.focus();
  }

  function close() {
    overlay.classList.remove("lightbox--open");
    setBackgroundInert(false);
    triggerEl?.focus();
  }

  // Event handlers
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target === content) close();
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
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") goTo(currentIndex - 1);
    if (e.key === "ArrowRight") goTo(currentIndex + 1);
  });

  // Swipe support — adaptive threshold
  let pointerStartX = 0,
    pointerStartY = 0,
    isDragging = false;

  overlay.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    isDragging = true;
    overlay.setPointerCapture(e.pointerId);
  });

  overlay.addEventListener("pointerup", (e) => {
    if (!isDragging) return;
    isDragging = false;
    const dx = e.clientX - pointerStartX;
    const dy = e.clientY - pointerStartY;
    // Adaptive threshold: 15% of viewport width, minimum 50px
    const threshold = Math.max(50, window.innerWidth * 0.15);
    if (Math.abs(dx) < threshold) return;
    if (Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) goTo(currentIndex + 1);
    else goTo(currentIndex - 1);
  });

  overlay.addEventListener("pointercancel", () => {
    isDragging = false;
  });

  // Grid click handler
  grid.addEventListener("click", (e) => {
    const pic = e.target.closest("picture");
    if (!pic) return;

    const slidesData = pic.dataset.slides;
    if (slidesData) {
      // Carousel: open with all slide base paths (AVIF+WebP handled by <picture>)
      let baseSlugs;
      try {
        baseSlugs = JSON.parse(slidesData);
      } catch {
        return;
      }
      open(baseSlugs, 0, pic);
    } else {
      // Single image: extract base path (without extension)
      const webpSource = pic.querySelector("source[type='image/webp']");
      const srcset = webpSource?.srcset || webpSource?.dataset?.srcset;
      if (!srcset) return;
      const basePath = srcset.replace(/\.webp$/, "");
      open([basePath], 0, pic);
    }
  });
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
