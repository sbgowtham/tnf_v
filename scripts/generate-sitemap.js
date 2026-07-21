#!/usr/bin/env node
/**
 * Generates sitemap.xml + robots.txt at the repo root from:
 *   - questions/index.json + questions/<company>.json → every paginated listing page (/, /questions/page/2.html, ...)
 *   - learn/index.json                                 → the /learn pages
 *   - questions/slugs.json                             → every static question page (written by generate-question-pages.js)
 *   - generate-static-pages.js PAGES                    → about/contact/privacy/terms
 *
 * Run this AFTER scripts/generate-question-pages.js so slugs.json — and the listing
 * page count — reflect the current data. Pagination is recomputed here via the SAME
 * sortEntries/paginateEntries/PAGE_SIZE the page generator uses (imported, not
 * reimplemented), so the sitemap can't disagree with what actually got written to disk.
 *
 * Usage:
 *   node scripts/generate-sitemap.js
 */
const fs = require('fs');
const path = require('path');
const { SITE_URL } = require('./site-config');
const { PAGES: STATIC_PAGES } = require('./generate-static-pages');
const { computeExpected, sortEntries, paginateEntries, pageUrl } = require('./generate-question-pages');

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

  // Paginated listing: page 1 is the homepage, page 2+ are /questions/page/N.html.
  // Priority tapers off after page 1 — later pages are the same content type but less
  // likely to be anyone's entry point.
  const companiesPath = path.join(ROOT, 'questions', 'index.json');
  if (!fs.existsSync(companiesPath)) {
    console.error('questions/index.json not found — cannot compute listing pages.');
    process.exit(1);
  }
  const companies = JSON.parse(fs.readFileSync(companiesPath, 'utf8'));
  const listingPages = paginateEntries(sortEntries(computeExpected(companies)));
  let listingPagesFound = 0;
  for (const p of listingPages) {
    const filePath = p.page === 1
      ? path.join(ROOT, 'index.html')
      : path.join(ROOT, 'questions', 'page', `${p.page}.html`);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠ ${pageUrl(p.page)} doesn't exist yet — skipped. Run scripts/generate-question-pages.js first.`);
      continue;
    }
    listingPagesFound++;
    urls.push(urlEntry(`${SITE_URL}${pageUrl(p.page)}`, {
      priority: p.page === 1 ? 1.0 : 0.5,
      lastmod: lastmodOf(filePath),
    }));
  }

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

  // about/contact/privacy/terms
  for (const page of STATIC_PAGES) {
    const filePath = path.join(ROOT, `${page.slug}.html`);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠ ${page.slug}.html doesn't exist yet — skipped. Run scripts/generate-static-pages.js first.`);
      continue;
    }
    urls.push(urlEntry(`${SITE_URL}/${page.slug}.html`, { priority: 0.3, lastmod: lastmodOf(filePath) }));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml, 'utf8');

  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
  fs.writeFileSync(path.join(ROOT, 'robots.txt'), robots, 'utf8');

  console.log(`Wrote sitemap.xml — ${urls.length} URL(s) (${listingPagesFound} listing page(s), ${learnItems.length} /learn, ${slugValues.length} questions, ${STATIC_PAGES.length} static)`);
  console.log(`Wrote robots.txt — pointing to ${SITE_URL}/sitemap.xml`);
}

if (require.main === module) {
  main();
}
