#!/usr/bin/env node
/**
 * Publishes images from inbox/ to the portfolio.
 *
 * 1. Scans inbox/{project}/{category}/ for PNG/JPG files
 * 2. Optimizes to AVIF + WebP in assets/images/{project}/{category}/
 * 3. Regenerates data/projects.js from filesystem
 * 4. Cleans up inbox
 *
 * Usage: node scripts/publish.mjs
 */

import { readdir, mkdir, unlink, readFile, writeFile, rmdir, stat } from "node:fs/promises";
import { join, parse } from "node:path";
import sharp from "sharp";

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

async function uniqueSlug(slug, usedSlugs) {
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

async function optimizeImage(srcPath, outDir, filename, usedSlugs) {
  const baseSlug = slugify(parse(filename).name);
  const slug = await uniqueSlug(baseSlug, usedSlugs);
  const avifPath = join(outDir, `${slug}.avif`);
  const webpPath = join(outDir, `${slug}.webp`);

  const img = sharp(srcPath);
  const meta = await img.metadata();
  const resized = meta.width > MAX_WIDTH ? img.resize(MAX_WIDTH) : img;

  await Promise.all([
    resized.clone().avif({ quality: AVIF_QUALITY }).toFile(avifPath),
    resized.clone().webp({ quality: WEBP_QUALITY }).toFile(webpPath),
  ]);

  await unlink(srcPath);

  const outMeta = await sharp(avifPath).metadata();
  console.log(`  ✓ ${filename} → ${slug}.avif/.webp (${outMeta.width}×${outMeta.height})`);
  return slug;
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
    const projectInbox = join(INBOX, projectId);
    const entries = await readdir(projectInbox, { withFileTypes: true });
    const catDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    // Detect new project
    const isNewProject = !PROJECT_META[projectId];
    if (isNewProject) {
      const fileCount = await countImages(projectInbox);
      newProjects.push({ id: projectId, categories: catDirs, fileCount });
      console.log(`\n⚠ NEW PROJECT: ${projectId}/ (${fileCount} images in ${catDirs.length} categories: ${catDirs.join(", ")})`);
      console.log(`  → Skipped. Add to PROJECT_META in publish.mjs first, or let Claude handle it.`);
      continue;
    }

    console.log(`\n${projectId}/`);

    for (const cat of catDirs) {
      const srcDir = join(projectInbox, cat);

      // Detect new category
      const isNewCategory = !PROJECT_META[projectId].categoryLabels[cat];
      if (isNewCategory) {
        const fileCount = await countImages(srcDir);
        newCategories.push({ projectId, category: cat, fileCount });
        console.log(`  ⚠ NEW CATEGORY: ${cat}/ (${fileCount} images) — not in PROJECT_META`);
        console.log(`    → Skipped. Needs a label in PROJECT_META.categoryLabels.`);
        continue;
      }

      // Scan for loose files and @-carousel folders
      const catEntries = await readdir(srcDir, { withFileTypes: true });
      const looseFiles = catEntries.filter((e) => e.isFile() && /\.(png|jpe?g)$/i.test(e.name));
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
          .filter((f) => /\.(png|jpe?g)$/i.test(f))
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
        try { await rmdir(carouselDir); } catch {}
      }

      // Keep category and project folders for future use
    }
  }

  return { total, newProjects, newCategories };
}

async function countImages(dir) {
  let count = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      count += await countImages(join(dir, e.name));
    } else if (/\.(png|jpe?g)$/i.test(e.name)) {
      count++;
    }
  }
  return count;
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
        images.push({ slug: parse(file).name, cat });
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
        images.push({ slug: groupName, cat, slides });
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
      if (img.slides) {
        lines.push(`      { slug: ${JSON.stringify(img.slug)}, cat: ${JSON.stringify(img.cat)}, slides: ${JSON.stringify(img.slides)} },`);
      } else {
        lines.push(`      { slug: ${JSON.stringify(img.slug)}, cat: ${JSON.stringify(img.cat)} },`);
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

// --- Main ---

const { total: optimized, newProjects, newCategories } = await processInbox();

if (optimized > 0) {
  console.log(`\nOptimized ${optimized} new images.`);
}

await regenerateData();

// Summary with warnings for Claude / user
if (newProjects.length > 0 || newCategories.length > 0) {
  console.log("\n" + "=".repeat(60));
  console.log("⚠ ACTION REQUIRED — items skipped:");
  for (const p of newProjects) {
    console.log(`  NEW PROJECT: "${p.id}" (${p.fileCount} images, categories: ${p.categories.join(", ")})`);
    console.log(`    → Add entry to PROJECT_META in scripts/publish.mjs`);
    console.log(`    → Provide: name, logo path, category labels`);
  }
  for (const c of newCategories) {
    console.log(`  NEW CATEGORY: "${c.category}" in project "${c.projectId}" (${c.fileCount} images)`);
    console.log(`    → Add "${c.category}" to PROJECT_META["${c.projectId}"].categoryLabels`);
  }
  console.log("=".repeat(60));
  console.log("\nRe-run after updating PROJECT_META to process skipped items.");
} else {
  console.log("\nDone. Ready to commit and push.");
}
