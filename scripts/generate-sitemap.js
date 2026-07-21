#!/usr/bin/env node
/**
 * Generates sitemap.xml + robots.txt at the repo root from:
 *   - index.html                → homepage
 *   - learn/index.json          → the /learn pages
 *   - questions/slugs.json      → every static question page (written by generate-question-pages.js)
 *
 * Run this AFTER scripts/generate-question-pages.js so slugs.json reflects the current
 * set of question pages — this script doesn't recompute slugs itself, it only reads
 * the manifest so the two never disagree about what pages exist.
 *
 * Usage:
 *   node scripts/generate-sitemap.js
 */
const fs = require('fs');
const path = require('path');
const { SITE_URL } = require('./site-config');

const ROOT = path.join(__dirname, '..');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function lastmodOf(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString().slice(0, 10);
  } catch (e) {
    return null;
  }
}

function urlEntry(loc, { priority, lastmod }) {
  let xml = `  <url>\n    <loc>${esc(loc)}</loc>\n`;
  if (lastmod) xml += `    <lastmod>${lastmod}</lastmod>\n`;
  xml += `    <priority>${priority.toFixed(1)}</priority>\n`;
  xml += `  </url>`;
  return xml;
}

function main() {
  const urls = [];

  // Homepage
  urls.push(urlEntry(`${SITE_URL}/`, { priority: 1.0, lastmod: lastmodOf(path.join(ROOT, 'index.html')) }));

  // /learn pages
  const learnIndexPath = path.join(ROOT, 'learn', 'index.json');
  if (!fs.existsSync(learnIndexPath)) {
    console.error('learn/index.json not found — cannot list /learn pages.');
    process.exit(1);
  }
  const learnItems = JSON.parse(fs.readFileSync(learnIndexPath, 'utf8'));
  for (const item of learnItems) {
    const filePath = path.join(ROOT, 'learn', item.file);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠ learn/index.json references "${item.file}" but the file doesn't exist — skipped.`);
      continue;
    }
    urls.push(urlEntry(`${SITE_URL}/learn/${item.file}`, { priority: 0.6, lastmod: lastmodOf(filePath) }));
  }

  // Question pages, from the slug manifest — the same source index.html uses for its links
  const slugsPath = path.join(ROOT, 'questions', 'slugs.json');
  if (!fs.existsSync(slugsPath)) {
    console.error('questions/slugs.json not found — run scripts/generate-question-pages.js first.');
    process.exit(1);
  }
  const slugs = JSON.parse(fs.readFileSync(slugsPath, 'utf8'));
  const slugValues = Object.values(slugs);
  for (const slug of slugValues) {
    const filePath = path.join(ROOT, 'questions', `${slug}.html`);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠ slugs.json references "${slug}" but questions/${slug}.html doesn't exist — skipped.`);
      continue;
    }
    urls.push(urlEntry(`${SITE_URL}/questions/${slug}.html`, { priority: 0.8, lastmod: lastmodOf(filePath) }));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml, 'utf8');

  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
  fs.writeFileSync(path.join(ROOT, 'robots.txt'), robots, 'utf8');

  console.log(`Wrote sitemap.xml — ${urls.length} URL(s) (1 homepage, ${learnItems.length} /learn, ${slugValues.length} questions)`);
  console.log(`Wrote robots.txt — pointing to ${SITE_URL}/sitemap.xml`);
}

main();
