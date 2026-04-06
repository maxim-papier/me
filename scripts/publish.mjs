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

import { readdir, mkdir, unlink, writeFile, readFile, rmdir, stat } from "node:fs/promises";
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
const AVIF_QUALITY = 65;
const WEBP_QUALITY = 75;

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
  const avifPath = join(outDir, `${slug}.avif`);
  const webpPath = join(outDir, `${slug}.webp`);

  const img = sharp(buffer);
  const meta = await img.metadata();
  const resized = meta.width > MAX_WIDTH ? img.resize(MAX_WIDTH) : img;

  await Promise.all([
    resized.clone().avif({ quality: AVIF_QUALITY }).toFile(avifPath),
    resized.clone().webp({ quality: WEBP_QUALITY }).toFile(webpPath),
  ]);

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

      // Loose .webp files → single images
      const looseFiles = catEntries
        .filter((e) => e.isFile() && e.name.endsWith(".webp"))
        .map((e) => e.name)
        .sort();

      for (const file of looseFiles) {
        const slug = parse(file).name;
        const meta = await sharp(join(catPath, file)).metadata();
        images.push({ slug, cat, w: meta.width, h: meta.height });
      }

      // Subdirectories → carousel groups
      const groupDirs = catEntries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();

      for (const groupName of groupDirs) {
        const groupPath = join(catPath, groupName);
        const slides = (await readdir(groupPath))
          .filter((f) => f.endsWith(".webp"))
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
    await writeFile(file, html);
  }
  console.log(`✓ Cache-busted HTML files (${version})`);
}

// --- Main ---

const { total: optimized, newProjects, newCategories } = await processInbox();

if (optimized > 0) {
  console.log(`\nOptimized ${optimized} new images.`);
}

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
