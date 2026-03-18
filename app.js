const app = document.getElementById("app");
const params = new URLSearchParams(window.location.search);
const projectId = params.get("id");

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
      logo.className = "clients-bar__logo" + (project.logoRound ? " clients-bar__logo--round" : "");
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
      allImages.push({ ...img, projectId: project.id, projectName: project.name });
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
    const picture = document.createElement("picture");
    picture.dataset.cat = img.cat;
    picture.dataset.project = img.projectId;

    const basePath = `assets/images/${img.projectId}`;

    const sourceAvif = document.createElement("source");
    sourceAvif.srcset = `${basePath}/${img.cat}/${img.slug}.avif`;
    sourceAvif.type = "image/avif";

    const sourceWebp = document.createElement("source");
    sourceWebp.srcset = `${basePath}/${img.cat}/${img.slug}.webp`;
    sourceWebp.type = "image/webp";

    const imgEl = document.createElement("img");
    imgEl.src = `${basePath}/${img.cat}/${img.slug}.webp`;
    imgEl.alt = "";
    imgEl.loading = "lazy";
    imgEl.onerror = () => {
      picture.remove();
      layoutMasonry(grid);
    };

    picture.append(sourceAvif, sourceWebp, imgEl);
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
    nav.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
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
      nav.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
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
  const pictures = project.images.map((img) => {
    const picture = document.createElement("picture");
    picture.dataset.cat = img.cat;

    const sourceAvif = document.createElement("source");
    sourceAvif.srcset = `${basePath}/${img.cat}/${img.slug}.avif`;
    sourceAvif.type = "image/avif";

    const sourceWebp = document.createElement("source");
    sourceWebp.srcset = `${basePath}/${img.cat}/${img.slug}.webp`;
    sourceWebp.type = "image/webp";

    const imgEl = document.createElement("img");
    imgEl.src = `${basePath}/${img.cat}/${img.slug}.webp`;
    imgEl.alt = "";
    imgEl.loading = "lazy";
    imgEl.onerror = () => {
      picture.remove();
      layoutMasonry(grid);
    };

    picture.append(sourceAvif, sourceWebp, imgEl);
    return picture;
  });

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

// --- Shared helpers ---

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
            layoutMasonry(grid);
          });
        }

        observer.unobserve(pic);
      });
    },
    { rootMargin: "200px" }
  );

  pictures.forEach((pic) => observer.observe(pic));
  window.addEventListener("resize", () => layoutMasonry(grid));
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

// --- Lightbox ---

function initLightbox(grid) {
  const overlay = document.createElement("div");
  overlay.className = "lightbox";
  const img = document.createElement("img");
  overlay.appendChild(img);
  document.body.appendChild(overlay);

  function close() {
    overlay.classList.remove("lightbox--open");
  }

  overlay.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  grid.addEventListener("click", (e) => {
    const pic = e.target.closest("picture");
    if (!pic) return;
    const source = pic.querySelector("source[type='image/avif']") || pic.querySelector("source");
    img.src = source ? source.srcset : pic.querySelector("img").src;
    overlay.classList.add("lightbox--open");
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
