#!/usr/bin/env node
/**
 * Publishes images from inbox/ to the portfolio.
 *
 * 1. Scans inbox/{project}/{category}/ for PNG/JPG/WebP files and @-prefixed PDF carousels
 * 2. Renders PDF pages to images via pdfjs-dist + @napi-rs/canvas
 * 3. Optimizes to AVIF + WebP in assets/images/{project}/{category}/
 * 4. Regenerates data/projects.js from filesystem
 * 5. Cleans up inbox
 *
 * Usage: node scripts/publish.mjs
 */

import { readdir, mkdir, unlink, writeFile, readFile, rmdir, rename, stat } from "node:fs/promises";
import { join, parse } from "node:path";
import sharp from "sharp";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";

function isSafeDirName(name) {
  return /^[@a-zA-Z0-9_-]+$/.test(name);
}

const INBOX = "inbox";
const IMAGES_ROOT = "assets/images";
const DATA_FILE = "data/projects.js";
const MAX_WIDTH = 1400;
const THUMB_WIDTHS = [800];
const SIZE_SUFFIX_RE = new RegExp(`-(?:${THUMB_WIDTHS.join("|")})\\.(?:avif|webp)$`);
const AVIF_QUALITY = 65;
const WEBP_QUALITY = 75;

// Curation flags pipeline
const INBOX_FLAGS_JSON = join(INBOX, "flags.json");
const DATA_FLAGS_JSON = "data/flags.json";   // Source of truth
const DATA_FLAGS_JS = "data/flags.js";        // Browser wrapper
const ARCHIVE_ROOT = "archive";
const KEY_SEGMENT = /^[@a-zA-Z0-9_-]+$/;

// Project metadata — edit here to add new projects
const PROJECT_META = {
  samexpert: {
    name: "SAMexpert",
    logo: "assets/logos/samexpert.png",
    categoryLabels: {
      articles: "Articles",
      "social-media": "Social Media",
      yt: "YouTube",
    },
  },
  licensehawk: {
    name: "LicenseHawk",
    logo: "assets/logos/licensehawk.svg",
    logoRound: true,
    categoryLabels: {
      articles: "Articles",
      "social-media": "Social Media",
      yt: "YouTube",
    },
  },
  brc: {
    name: "Barclay Rae",
    logo: "assets/logos/barclayray.png",
    categoryLabels: {
      "social-media": "Social Media",
      yt: "YouTube",
      print: "Print",
    },
  },
  itsmtools: {
    name: "ITSM.Tools",
    logo: "assets/logos/itsmtools.svg",
    categoryLabels: {
      articles: "Articles",
      "social-media": "Social Media",
    },
  },
};

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function dirExists(path) {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

function uniqueSlug(slug, usedSlugs) {
  if (!usedSlugs.has(slug)) {
    usedSlugs.add(slug);
    return slug;
  }
  let i = 2;
  while (usedSlugs.has(`${slug}-${i}`)) i++;
  const unique = `${slug}-${i}`;
  usedSlugs.add(unique);
  return unique;
}

async function optimizeBuffer(buffer, outDir, slug) {
  const pipeline = sharp(buffer);
  const meta = await pipeline.metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Cannot read dimensions for slug: ${slug}`);
  }

  // Always generate base (capped at MAX_WIDTH via withoutEnlargement); thumbs only if smaller than source
  const widths = [MAX_WIDTH, ...THUMB_WIDTHS.filter((w) => w < meta.width)];

  const tasks = [];
  for (const w of widths) {
    const suffix = w === MAX_WIDTH ? "" : `-${w}`;
    tasks.push(
      pipeline.clone()
        .resize({ width: w, withoutEnlargement: true })
        .avif({ quality: AVIF_QUALITY })
        .toFile(join(outDir, `${slug}${suffix}.avif`))
    );
    tasks.push(
      pipeline.clone()
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toFile(join(outDir, `${slug}${suffix}.webp`))
    );
  }
  await Promise.all(tasks);

  // Verify base outputs are non-empty
  const avifPath = join(outDir, `${slug}.avif`);
  const webpPath = join(outDir, `${slug}.webp`);
  const [avifStat, webpStat] = await Promise.all([stat(avifPath), stat(webpPath)]);
  if (avifStat.size === 0 || webpStat.size === 0) {
    throw new Error(`Output file is empty for slug: ${slug}`);
  }

  const outWidth = Math.min(meta.width, MAX_WIDTH);
  const outHeight = meta.width > MAX_WIDTH
    ? Math.round(meta.height * (MAX_WIDTH / meta.width))
    : meta.height;
  return { slug, width: outWidth, height: outHeight };
}

async function optimizeImage(srcPath, outDir, filename, usedSlugs) {
  const baseSlug = slugify(parse(filename).name);
  const slug = uniqueSlug(baseSlug, usedSlugs);

  const buffer = await readFile(srcPath);
  const result = await optimizeBuffer(buffer, outDir, slug);
  await unlink(srcPath);

  console.log(`  ✓ ${filename} → ${slug}.avif/.webp (${result.width}×${result.height})`);
  return slug;
}

const PDF_RENDER_SCALE = 150 / 72; // 150 DPI — enough for 1400px output with quality headroom
const MAX_PDF_PAGES = 50;

async function renderPdfToSlides(pdfPath, outDir) {
  const data = new Uint8Array(await readFile(pdfPath));
  const standardFontDataUrl = new URL(
    "../node_modules/pdfjs-dist/standard_fonts/",
    import.meta.url
  ).href;
  const pdf = await getDocument({ data, useSystemFonts: true, standardFontDataUrl }).promise;

  if (pdf.numPages > MAX_PDF_PAGES) {
    pdf.destroy();
    throw new Error(`PDF has ${pdf.numPages} pages, limit is ${MAX_PDF_PAGES}`);
  }

  if (pdf.numPages === 0) {
    pdf.destroy();
    return 0;
  }

  await mkdir(outDir, { recursive: true });
  const pad = Math.max(2, String(pdf.numPages).length);

  console.log(`  (${pdf.numPages} pages → rendering...)`);
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });

    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    const ctx = canvas.getContext("2d");

    await page.render({ canvasContext: ctx, viewport }).promise;
    const buffer = canvas.toBuffer("image/png");
    page.cleanup();

    const slideName = String(i).padStart(pad, "0");
    const result = await optimizeBuffer(buffer, outDir, slideName);
    console.log(`    ✓ page ${i} → ${slideName}.avif/.webp (${result.width}×${result.height})`);
  }

  const count = pdf.numPages;
  pdf.destroy();
  return count;
}

// --- Step 1: Process inbox ---

async function processInbox() {
  if (!(await dirExists(INBOX))) {
    console.log("No inbox/ folder found.");
    return { total: 0, newProjects: [], newCategories: [] };
  }

  const projects = await readdir(INBOX, { withFileTypes: true });
  const projectDirs = projects.filter((e) => e.isDirectory()).map((e) => e.name);

  if (projectDirs.length === 0) {
    console.log("Inbox is empty.");
    return { total: 0, newProjects: [], newCategories: [] };
  }

  let total = 0;
  const newProjects = [];
  const newCategories = [];

  for (const projectId of projectDirs) {
    if (!isSafeDirName(projectId)) {
      console.warn(`\n⚠ Skipping unsafe directory name: ${projectId}`);
      continue;
    }
    const projectInbox = join(INBOX, projectId);
    const entries = await readdir(projectInbox, { withFileTypes: true });
    const catDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    // Detect new project
    const isNewProject = !PROJECT_META[projectId];
    if (isNewProject) {
      newProjects.push({ id: projectId, categories: catDirs });
      console.log(`\n⚠ NEW PROJECT: ${projectId}/ (categories: ${catDirs.join(", ")})`);
      console.log(`  → Skipped. Add to PROJECT_META in publish.mjs first, or let Claude handle it.`);
      continue;
    }

    console.log(`\n${projectId}/`);

    for (const cat of catDirs) {
      if (!isSafeDirName(cat)) {
        console.warn(`  ⚠ Skipping unsafe category name: ${cat}`);
        continue;
      }
      const srcDir = join(projectInbox, cat);

      // Detect new category
      const isNewCategory = !PROJECT_META[projectId].categoryLabels[cat];
      if (isNewCategory) {
        newCategories.push({ projectId, category: cat });
        console.log(`  ⚠ NEW CATEGORY: ${cat}/ — not in PROJECT_META`);
        console.log(`    → Skipped. Needs a label in PROJECT_META.categoryLabels.`);
        continue;
      }

      // Scan for loose files and @-carousel folders
      const catEntries = await readdir(srcDir, { withFileTypes: true });
      const looseFiles = catEntries.filter((e) => e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name));
      const subDirs = catEntries.filter((e) => e.isDirectory());

      // Process loose images (single images, as before)
      if (looseFiles.length > 0) {
        const outDir = join(IMAGES_ROOT, projectId, cat);
        await mkdir(outDir, { recursive: true });
        // Pre-populate with existing slugs to avoid overwriting
        const usedSlugs = new Set(
          (await readdir(outDir)).filter((f) => f.endsWith(".avif")).map((f) => parse(f).name)
        );
        console.log(`  ${cat}/ (${looseFiles.length} images)`);
        for (const entry of looseFiles) {
          await optimizeImage(join(srcDir, entry.name), outDir, entry.name, usedSlugs);
          total++;
        }
      }

      // Process @-prefixed carousel folders
      for (const sub of subDirs) {
        if (!sub.name.startsWith("@")) {
          console.log(`  ⚠ ${cat}/${sub.name}/ — folder without @ prefix, skipped`);
          continue;
        }

        const carouselDir = join(srcDir, sub.name);
        const slideFiles = (await readdir(carouselDir))
          .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
          .sort();

        if (slideFiles.length === 0) {
          console.log(`  ⚠ ${cat}/${sub.name}/ — empty @-folder, skipped`);
          continue;
        }

        const carouselSlug = slugify(sub.name.slice(1)); // remove @ prefix
        const outDir = join(IMAGES_ROOT, projectId, cat, carouselSlug);
        await mkdir(outDir, { recursive: true });

        // Pre-populate with existing slide slugs
        const usedSlideSlugs = new Set(
          (await readdir(outDir)).filter((f) => f.endsWith(".avif")).map((f) => parse(f).name)
        );
        console.log(`  ${cat}/${sub.name}/ (${slideFiles.length} slides → ${carouselSlug}/)`);
        for (const file of slideFiles) {
          await optimizeImage(join(carouselDir, file), outDir, file, usedSlideSlugs);
          total++;
        }

        // Clean up carousel folder (temporary, unlike category folders)
        try { await rmdir(carouselDir); } catch (e) {
          if (e.code !== "ENOTEMPTY" && e.code !== "ENOENT") console.warn(`  ⚠ Could not remove ${carouselDir}: ${e.message}`);
        }
      }

      // Process @-prefixed PDF files as carousels
      const pdfFiles = catEntries.filter(
        (e) => e.isFile() && e.name.startsWith("@") && /\.pdf$/i.test(e.name)
      );

      for (const pdfEntry of pdfFiles) {
        const pdfName = pdfEntry.name;
        const carouselSlug = slugify(parse(pdfName).name.slice(1)); // remove @ prefix, strip extension

        if (!carouselSlug) {
          console.warn(`  ⚠ ${cat}/${pdfName} — could not derive slug, skipped`);
          continue;
        }

        // Check collision with existing carousel in assets
        const outDir = join(IMAGES_ROOT, projectId, cat, carouselSlug);
        if (await dirExists(outDir)) {
          const existing = (await readdir(outDir)).filter((f) => f.endsWith(".avif"));
          if (existing.length > 0) {
            console.warn(`  ⚠ ${cat}/${pdfName} — carousel "${carouselSlug}" already exists in assets, skipped`);
            continue;
          }
        }

        const pdfPath = join(srcDir, pdfName);
        let slideCount;
        try {
          slideCount = await renderPdfToSlides(pdfPath, outDir);
        } catch (e) {
          console.warn(`  ⚠ ${cat}/${pdfName} — failed to render PDF: ${e.message}`);
          continue; // leave PDF in inbox
        }

        if (slideCount === 0) {
          console.warn(`  ⚠ ${cat}/${pdfName} — PDF has no pages, skipped`);
          continue;
        }

        total += slideCount;
        await unlink(pdfPath);
      }

      // Keep category and project folders for future use
    }
  }

  return { total, newProjects, newCategories };
}

// --- Step 1.5: Backfill missing thumb variants ---

async function walkBaseAvifs(root) {
  const result = [];
  async function recurse(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        await recurse(p);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".avif") &&
        !SIZE_SUFFIX_RE.test(entry.name)
      ) {
        result.push(p);
      }
    }
  }
  await recurse(root);
  return result;
}

async function ensureBackfill() {
  if (!(await dirExists(IMAGES_ROOT))) return;

  const baseAvifs = await walkBaseAvifs(IMAGES_ROOT);
  let generated = 0;

  for (const basePath of baseAvifs) {
    for (const w of THUMB_WIDTHS) {
      const avifThumb = basePath.replace(/\.avif$/, `-${w}.avif`);
      const webpThumb = basePath.replace(/\.avif$/, `-${w}.webp`);

      let bothExist = false;
      try {
        await Promise.all([stat(avifThumb), stat(webpThumb)]);
        bothExist = true;
      } catch {
        // at least one missing — generate below
      }
      if (bothExist) continue;

      const buffer = await readFile(basePath);
      const meta = await sharp(buffer).metadata();
      if (!meta.width || meta.width <= w) continue;

      await Promise.all([
        sharp(buffer)
          .resize({ width: w, withoutEnlargement: true })
          .avif({ quality: AVIF_QUALITY })
          .toFile(avifThumb),
        sharp(buffer)
          .resize({ width: w, withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY })
          .toFile(webpThumb),
      ]);

      console.log(`  ✓ backfill: ${basePath} → -${w} variants`);
      generated++;
    }
  }

  if (generated > 0) {
    console.log(`\nBackfilled ${generated} thumb variant(s).`);
  }
}

// --- Step 2: Regenerate data/projects.js from filesystem ---

async function regenerateData() {
  const projectIds = Object.keys(PROJECT_META);
  const projectsData = [];

  for (const id of projectIds) {
    const meta = PROJECT_META[id];
    const projectDir = join(IMAGES_ROOT, id);

    if (!(await dirExists(projectDir))) continue;

    const categories = {};
    const images = [];

    const entries = await readdir(projectDir, { withFileTypes: true });
    const catDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    // Use category order from metadata
    const orderedCats = Object.keys(meta.categoryLabels);
    for (const cat of orderedCats) {
      if (!catDirs.includes(cat)) continue;

      categories[cat] = meta.categoryLabels[cat] || cat;

      const catPath = join(projectDir, cat);
      const catEntries = await readdir(catPath, { withFileTypes: true });

      // Loose .webp files → single images (exclude thumb variants like -800.webp)
      const looseFiles = catEntries
        .filter((e) => e.isFile() && e.name.endsWith(".webp") && !SIZE_SUFFIX_RE.test(e.name))
        .map((e) => e.name)
        .sort();

      for (const file of looseFiles) {
        const slug = parse(file).name;
        const imgMeta = await sharp(join(catPath, file)).metadata();
        images.push({ slug, cat, w: imgMeta.width, h: imgMeta.height });
      }

      // Subdirectories → carousel groups
      const groupDirs = catEntries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();

      for (const groupName of groupDirs) {
        const groupPath = join(catPath, groupName);
        const slides = (await readdir(groupPath))
          .filter((f) => f.endsWith(".webp") && !SIZE_SUFFIX_RE.test(f))
          .map((f) => parse(f).name)
          .sort();

        if (slides.length === 0) continue;
        // w/h from cover (first slide) — only cover matters for masonry grid
        const coverFile = slides[0] + ".webp";
        const coverMeta = await sharp(join(groupPath, coverFile)).metadata();
        images.push({ slug: groupName, cat, slides, w: coverMeta.width, h: coverMeta.height });
      }
    }

    const project = { id, name: meta.name, logo: meta.logo };
    if (meta.logoRound) project.logoRound = true;
    project.categories = categories;
    project.images = images;

    projectsData.push(project);
  }

  // Generate JS
  const lines = ["const projects = ["];
  for (const p of projectsData) {
    lines.push("  {");
    lines.push(`    id: ${JSON.stringify(p.id)},`);
    lines.push(`    name: ${JSON.stringify(p.name)},`);
    lines.push(`    logo: ${JSON.stringify(p.logo)},`);
    if (p.logoRound) lines.push(`    logoRound: true,`);
    lines.push(`    categories: {`);
    for (const [k, v] of Object.entries(p.categories)) {
      lines.push(`      ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
    }
    lines.push(`    },`);
    lines.push(`    images: [`);
    for (const img of p.images) {
      const dims = `, w: ${img.w}, h: ${img.h}`;
      if (img.slides) {
        lines.push(`      { slug: ${JSON.stringify(img.slug)}, cat: ${JSON.stringify(img.cat)}, slides: ${JSON.stringify(img.slides)}${dims} },`);
      } else {
        lines.push(`      { slug: ${JSON.stringify(img.slug)}, cat: ${JSON.stringify(img.cat)}${dims} },`);
      }
    }
    lines.push(`    ],`);
    lines.push(`  },`);
  }
  lines.push("];");
  lines.push("");

  await writeFile(DATA_FILE, lines.join("\n"));
  console.log(`\n✓ ${DATA_FILE} regenerated (${projectsData.reduce((s, p) => s + p.images.length, 0)} images total)`);
}

// --- Step 2.5: Curation flags pipeline ---

async function readPublishedFlagsFile() {
  try {
    return JSON.parse(await readFile(DATA_FLAGS_JSON, "utf-8"));
  } catch (e) {
    if (e.code === "ENOENT") return {};
    console.warn(`⚠ Could not read ${DATA_FLAGS_JSON}: ${e.message} — starting empty`);
    return {};
  }
}

// Security: validates each segment AND checks projectId/cat against PROJECT_META allowlist.
// Blocks path-traversal attempts like "node_modules/sharp/build".
function isValidFlagKey(key) {
  const parts = key.split("/");
  if (parts.length !== 3) return false;
  const [projectId, cat, slug] = parts;
  if (!KEY_SEGMENT.test(projectId) || !KEY_SEGMENT.test(cat) || !KEY_SEGMENT.test(slug)) return false;
  const meta = PROJECT_META[projectId];
  if (!meta) return false;
  if (!(cat in meta.categoryLabels)) return false;
  return true;
}

async function processInboxFlags() {
  let flags = await readPublishedFlagsFile();
  let replaced = false;

  try {
    const raw = await readFile(INBOX_FLAGS_JSON, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("flags.json must be an object");
    }
    flags = {};
    let dropped = 0;
    for (const [key, val] of Object.entries(parsed)) {
      if (val !== "liked" && val !== "hidden") { dropped++; continue; }
      if (!isValidFlagKey(key)) { dropped++; continue; }
      flags[key] = val;
    }
    replaced = true;
    console.log(`✓ inbox/flags.json → ${Object.keys(flags).length} flags loaded${dropped ? ` (${dropped} invalid entries dropped)` : ""}`);
  } catch (e) {
    if (e.code !== "ENOENT") console.warn(`⚠ Could not parse inbox/flags.json: ${e.message} — keeping existing flags`);
  }

  await archiveHiddenFiles(flags);
  const cleaned = await dropStaleKeys(flags);
  await writeFlagsFiles(cleaned);

  if (replaced) await unlink(INBOX_FLAGS_JSON);
  return cleaned;
}

async function archiveHiddenFiles(flags) {
  // Cache directory listings across iterations (fewer syscalls per key)
  const readdirCache = new Map();
  async function cachedReaddir(p) {
    if (readdirCache.has(p)) return readdirCache.get(p);
    try {
      const entries = await readdir(p);
      readdirCache.set(p, entries);
      return entries;
    } catch {
      readdirCache.set(p, null);
      return null;
    }
  }

  for (const [key, state] of Object.entries(flags)) {
    if (state !== "hidden") continue;
    const [projectId, cat, slug] = key.split("/");
    const assetDir = join(IMAGES_ROOT, projectId, cat);
    const archiveDir = join(ARCHIVE_ROOT, projectId, cat);
    const thumbRe = new RegExp(`^${slug}-\\d+\\.(avif|webp)$`);

    const entries = await cachedReaddir(assetDir);
    if (!entries) continue;

    const toMove = entries.filter((f) =>
      f === `${slug}.avif` || f === `${slug}.webp` || thumbRe.test(f)
    );

    if (toMove.length > 0) {
      await mkdir(archiveDir, { recursive: true });
      for (const f of toMove) {
        await rename(join(assetDir, f), join(archiveDir, f));
      }
      readdirCache.delete(assetDir);
      console.log(`  📦 archived ${toMove.length} file(s) for ${key}`);
      continue;
    }

    // Carousel case — subfolder named slug
    const subfolder = join(assetDir, slug);
    try {
      const s = await stat(subfolder);
      if (s.isDirectory()) {
        await mkdir(archiveDir, { recursive: true });
        await rename(subfolder, join(archiveDir, slug));
        console.log(`  📦 archived carousel ${key}`);
      }
    } catch {
      // neither single nor carousel — already archived or never existed, skip silently
    }
  }
}

async function dropStaleKeys(flags) {
  const out = {};
  for (const [key, state] of Object.entries(flags)) {
    const [projectId, cat, slug] = key.split("/");
    const assetDir = join(IMAGES_ROOT, projectId, cat);
    const archiveDir = join(ARCHIVE_ROOT, projectId, cat);

    const candidates = [
      join(assetDir, `${slug}.avif`),
      join(archiveDir, `${slug}.avif`),
      join(assetDir, slug),
      join(archiveDir, slug),
    ];

    let exists = false;
    for (const p of candidates) {
      try {
        await stat(p);
        exists = true;
        break;
      } catch { /* next */ }
    }

    if (exists) out[key] = state;
  }
  const dropped = Object.keys(flags).length - Object.keys(out).length;
  if (dropped > 0) console.log(`  🧹 dropped ${dropped} stale flag key(s)`);
  return out;
}

async function writeFlagsFiles(flags) {
  await mkdir("data", { recursive: true });
  const jsonBody = JSON.stringify(flags, null, 2);
  await writeFile(DATA_FLAGS_JSON, jsonBody);
  // Defense-in-depth: escape '<' for XSS safety even though keys/values are validated
  const safeBody = jsonBody.replace(/</g, "\\u003c");
  const js = `// Auto-generated by scripts/publish.mjs. Do not edit. Source: data/flags.json\nconst flags = ${safeBody};\n`;
  await writeFile(DATA_FLAGS_JS, js);
  console.log(`✓ ${DATA_FLAGS_JSON} + ${DATA_FLAGS_JS} regenerated (${Object.keys(flags).length} flags)`);
}

// --- Step 3: Cache-bust projects.js in HTML files ---

async function cacheBustHTML() {
  const version = `v=${Date.now()}`;
  const htmlFiles = ["index.html", "project.html"];

  for (const file of htmlFiles) {
    let html = await readFile(file, "utf-8");
    html = html.replace(
      /src="data\/projects\.js[^"]*"/,
      `src="data/projects.js?${version}"`
    );
    html = html.replace(
      /src="data\/flags\.js[^"]*"/,
      `src="data/flags.js?${version}"`
    );
    html = html.replace(
      /src="app\.js[^"]*"/,
      `src="app.js?${version}"`
    );
    await writeFile(file, html);
  }
  console.log(`✓ Cache-busted HTML files (${version})`);
}

// --- Main ---

const { total: optimized, newProjects, newCategories } = await processInbox();

if (optimized > 0) {
  console.log(`\nOptimized ${optimized} new images.`);
}

// Curation flags: archive hidden files BEFORE ensureBackfill/regenerateData so:
//   (a) backfill doesn't waste work on soon-to-be-archived files
//   (b) regenerateData naturally omits archived content from data/projects.js
await processInboxFlags();
await ensureBackfill();
await regenerateData();
await cacheBustHTML();

// Summary with warnings for Claude / user
if (newProjects.length > 0 || newCategories.length > 0) {
  console.log("\n" + "=".repeat(60));
  console.log("⚠ ACTION REQUIRED — items skipped:");
  for (const p of newProjects) {
    console.log(`  NEW PROJECT: "${p.id}" (categories: ${p.categories.join(", ")})`);
    console.log(`    → Add entry to PROJECT_META in scripts/publish.mjs`);
    console.log(`    → Provide: name, logo path, category labels`);
  }
  for (const c of newCategories) {
    console.log(`  NEW CATEGORY: "${c.category}" in project "${c.projectId}"`);
    console.log(`    → Add "${c.category}" to PROJECT_META["${c.projectId}"].categoryLabels`);
  }
  console.log("=".repeat(60));
  console.log("\nRe-run after updating PROJECT_META to process skipped items.");
} else {
  console.log("\nDone. Ready to commit and push.");
}
