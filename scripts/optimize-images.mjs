#!/usr/bin/env node
/**
 * Converts source PNGs/JPGs to optimized AVIF + WebP in-place.
 * Walks category subdirectories under assets/images/<project>/.
 * Original source files are deleted after successful conversion.
 *
 * Usage: node scripts/optimize-images.mjs <project-id>
 * Example: node scripts/optimize-images.mjs samexpert
 * No args = process all project folders in assets/images/
 */

import { readdir, mkdir, unlink, stat } from "node:fs/promises";
import { join, parse } from "node:path";
import sharp from "sharp";

const IMAGES_ROOT = "assets/images";
const MAX_WIDTH = 1400;
const AVIF_QUALITY = 65;
const WEBP_QUALITY = 75;

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function processImage(srcPath, outDir, filename) {
  const slug = slugify(parse(filename).name);
  const avifPath = join(outDir, `${slug}.avif`);
  const webpPath = join(outDir, `${slug}.webp`);

  const img = sharp(srcPath);
  const meta = await img.metadata();
  const resized = meta.width > MAX_WIDTH ? img.resize(MAX_WIDTH) : img;

  await Promise.all([
    resized.clone().avif({ quality: AVIF_QUALITY }).toFile(avifPath),
    resized.clone().webp({ quality: WEBP_QUALITY }).toFile(webpPath),
  ]);

  // Delete original source file
  await unlink(srcPath);

  const outMeta = await sharp(avifPath).metadata();
  console.log(`  ✓ ${filename} → ${slug}.avif/.webp (${outMeta.width}×${outMeta.height})`);
  return { slug, width: outMeta.width, height: outMeta.height, cat: null };
}

async function processCategory(projectDir, catDir) {
  const srcDir = join(projectDir, catDir);
  const files = (await readdir(srcDir)).filter((f) => /\.(png|jpe?g)$/i.test(f));

  if (files.length === 0) return [];

  console.log(`  ${catDir}/ (${files.length} images)`);

  const results = [];
  for (const file of files) {
    const r = await processImage(join(srcDir, file), srcDir, file);
    r.cat = catDir;
    results.push(r);
  }
  return results;
}

async function processProject(projectId) {
  const projectDir = join(IMAGES_ROOT, projectId);

  // Find category subdirectories
  const entries = await readdir(projectDir, { withFileTypes: true });
  const catDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  // Also check for loose images in project root (no category)
  const looseFiles = entries.filter((e) => e.isFile() && /\.(png|jpe?g)$/i.test(e.name));

  let total = 0;
  console.log(`\n${projectId}/`);

  // Process each category subdirectory (recursively check for nested dirs too)
  for (const cat of catDirs) {
    // Check for nested subdirs (like PRINT/ inside print/)
    const catPath = join(projectDir, cat);
    const catEntries = await readdir(catPath, { withFileTypes: true });
    const nestedDirs = catEntries.filter((e) => e.isDirectory()).map((e) => e.name);

    // Move files from nested subdirs up to category level
    for (const nested of nestedDirs) {
      const nestedPath = join(catPath, nested);
      const nestedFiles = (await readdir(nestedPath)).filter((f) => /\.(png|jpe?g)$/i.test(f));
      for (const f of nestedFiles) {
        const { rename } = await import("node:fs/promises");
        await rename(join(nestedPath, f), join(catPath, f));
      }
      // Remove empty nested dir
      const { rmdir } = await import("node:fs/promises");
      try { await rmdir(nestedPath); } catch {}
    }

    const results = await processCategory(projectDir, cat);
    total += results.length;
  }

  // Process loose files in project root
  if (looseFiles.length > 0) {
    console.log(`  (root) (${looseFiles.length} images)`);
    for (const entry of looseFiles) {
      await processImage(join(projectDir, entry.name), projectDir, entry.name);
      total++;
    }
  }

  console.log(`  Total: ${total} images`);
  return total;
}

// Main
const args = process.argv.slice(2);
let projectIds;
if (args.length) {
  projectIds = args;
} else {
  projectIds = (await readdir(IMAGES_ROOT, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

let grandTotal = 0;
for (const id of projectIds) {
  grandTotal += await processProject(id);
}

console.log(`\nDone. Processed ${grandTotal} images.`);
