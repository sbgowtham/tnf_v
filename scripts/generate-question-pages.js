#!/usr/bin/env node
/**
 * Generates one static, crawlable HTML page per SQL question into /questions/.
 *
 * Source of truth:
 *   - questions/index.json      → company list (id, name, sub, color)
 *   - questions/<company>.json  → { setup, questions: [...] } per company
 *   - learn/index.json          → nav "Learn" dropdown links
 *   - index.html                → CSS is extracted from here so static pages
 *                                  stay visually identical without duplicating it by hand
 *
 * Filenames are content-derived topic slugs (e.g. flipkart-suppliers-average-product-...),
 * not company+id, so they read as real URLs. Because they're derived from the question
 * text, editing a question's wording changes its filename on the next run — that's by
 * design; the orphan check below is what catches the old file when that happens.
 *
 * Usage:
 *   node scripts/generate-question-pages.js                    generate every page
 *   node scripts/generate-question-pages.js --only=<slug>       generate a single page (preview)
 *   node scripts/generate-question-pages.js --dry-run            build everything but don't write files
 *
 * Every run also scans questions/*.html and warns about any file that no longer matches
 * a current JSON entry — orphaned by a rename, id change, or deleted question. It only
 * warns and lists; it never deletes. Remove those files yourself once you've confirmed
 * they're really stale.
 */
const fs = require('fs');
const path = require('path');

const { SITE_URL } = require('./site-config');
const { esc, cap, extractHomeCSS, loadLearnLinksHTML, buildNavHTML, NAV_SCRIPT } = require('./site-common');
const { buildFooterHTML, buildFooterStyleTag } = require('./site-footer');

const ROOT = path.join(__dirname, '..');
const QUESTIONS_DIR = path.join(ROOT, 'questions');
const PAGE_DIR = path.join(QUESTIONS_DIR, 'page');
const TITLE_MAX = 60;

/** Listing pagination — change this one constant to repaginate the whole site. */
const PAGE_SIZE = 10;

// The true source of index.html's un-paginated marketing copy. Pagination always derives
// page titles/descriptions FROM these constants, never by reading (and possibly re-suffixing)
// whatever's currently on disk — otherwise re-running the generator would keep appending
// "(Page 1 of N)" onto an already-suffixed title.
const HOME_TITLE_BASE = 'TableNotFound — SQL Practice';
const HOME_DESCRIPTION_BASE = 'Practice SQL for free in your browser with real-world questions modeled on Flipkart, Uber, Netflix, and more — no signup, no setup, instant feedback.';

const args = process.argv.slice(2);
const ONLY = (args.find(a => a.startsWith('--only=')) || '').split('=')[1] || null;
const DRY_RUN = args.includes('--dry-run');

// ── text helpers ─────────────────────────────────────────────────────────

/** Same semantics as tx() in index.html: string | {en,ta,hi,te} string | {en,ta,hi,te} string[] */
function tx(field, lang) {
  lang = lang || 'en';
  if (typeof field === 'string') return field;
  const val = field && (field[lang] || field.en);
  return val || (Array.isArray(field && field.en) ? [] : '');
}

function truncateWords(text, max) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

function firstSentence(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const m = clean.match(/^[^.]*\./);
  return m ? m[0].slice(0, -1).trim() : clean;
}

/**
 * "For each TV show, calculate the completion..." → "TV show calculate the completion..."
 * "Find suppliers whose average..."               → "suppliers whose average..."
 * Strips the generic question-writing lead-in so both the title fragment and the
 * filename slug lead with the actual subject instead of a boilerplate verb every
 * question in this dataset happens to start with.
 */
function stripLeadingFiller(text) {
  let t = text.trim();
  t = t.replace(/^for each\s+(.+?),\s*/i, '$1 ');
  t = t.replace(/^(find|calculate|determine|identify|return|get|show|list|display|count)\s+/i, '');
  return t.trim();
}

// ── title / description / slug ──────────────────────────────────────────

/**
 * Distinguishing fragment of the actual question text, not company+concepts —
 * two questions from the same company with overlapping concept tags (e.g. both
 * tagged JOIN/GROUP BY/SUM) used to produce identical titles. Kept under
 * TITLE_MAX chars total so search results don't truncate it.
 */
function buildTitle(companyDisplay, questionText) {
  const suffix = ' | TableNotFound';
  const prefix = `${companyDisplay}: `;
  const budget = TITLE_MAX - prefix.length - suffix.length;
  const fragment = truncateWords(stripLeadingFiller(firstSentence(questionText)), Math.max(budget, 15));
  return prefix + fragment + suffix;
}

function buildDescription(companyDisplay, q, questionText) {
  const prefix = `${companyDisplay} SQL practice question (${q.diff}): `;
  const suffix = ' Free, runs live in your browser.';
  const budget = 158 - prefix.length - suffix.length;
  return prefix + truncateWords(questionText, Math.max(budget, 40)) + suffix;
}

const SLUG_STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'is', 'are', 'was', 'were', 'whose', 'that', 'which',
  'all', 'same', 'per', 'to', 'with', 'has', 'have', 'this', 'these', 'those', 'and', 'or',
  'for', 'by', 'their', 'who', 'been', 'based', 'than', 'each', 'from', 'as', 'at', 'be', 'into'
]);

/** Content-derived topic slug, e.g. "suppliers-average-product-unit-price-greater-category". */
function slugifyQuestion(questionText) {
  const stripped = stripLeadingFiller(firstSentence(questionText));
  const seen = new Set();
  const words = [];
  for (const raw of stripped.split(/\s+/)) {
    const w = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!w || SLUG_STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    words.push(w);
    if (words.join('-').length >= 45) break;
  }
  const slug = words.join('-').slice(0, 50).replace(/-+$/, '');
  return slug || 'question';
}

// Extra CSS the interactive page doesn't need but the static page does
// (mostly: force content visible that index.html hides behind JS state/toggles).
// Left inlined for now per request — extraction to a shared stylesheet is a later pass.
const STATIC_OVERRIDES_CSS = `
.static-wrap{max-width:820px;margin:0 auto;padding:2rem 1.5rem 6rem}
.crumb{font-size:12px;font-weight:600;color:var(--t3);text-decoration:none;display:inline-flex;align-items:center;gap:6px;margin-bottom:1.5rem}
.crumb:hover{color:var(--t2)}
.q-header{padding:.5rem 0 1.75rem;animation:up .55s cubic-bezier(.22,1,.36,1) both}
.q-badges{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:1rem}
.q-h1{font-size:clamp(22px,4vw,32px);font-weight:800;line-height:1.35;letter-spacing:-.7px;margin-bottom:.5rem;color:var(--text)}
.q-sub{font-size:13px;color:var(--t2)}
.step-body{display:block}
.xpl{display:block}
.step-head{cursor:default}
.step-num{background:rgba(255,255,255,.6)!important;color:var(--t2)!important}
.cta-row{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.75rem}
.cta-btn{display:inline-flex;align-items:center;gap:7px;padding:10px 22px;border-radius:20px;border:none;cursor:pointer;font-family:var(--ff);font-size:13px;font-weight:700;text-decoration:none;background:linear-gradient(135deg,#7c5cfc,#c45cfc);color:#fff;box-shadow:0 3px 12px rgba(124,92,252,.35);transition:transform .18s}
.cta-btn:hover{transform:translateY(-2px)}
.cta-btn.secondary{background:rgba(255,255,255,.65);color:var(--t2);border:var(--bdr);box-shadow:none}
`;

// ── page builders ────────────────────────────────────────────────────────

function renderSchemas(schemas) {
  if (!schemas || !schemas.length) return '';
  return `<div class="schema-wrap">
    <div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:.75rem">📋 Table Structure</div>
    <div class="schema-cards">${schemas.map(s => `
      <div class="sc">
        <div class="sc-head">🗂 <span class="sc-name">${esc(s.name)}</span></div>
        <div>${(s.cols || []).map(c => `<div class="sc-row">
          <span class="sc-col">${esc(c.n)}</span>
          <span class="sc-type">${esc(c.t)}</span>
          <span class="sc-eg">${esc(c.e)}</span>
        </div>`).join('')}</div>
      </div>`).join('')}
    </div>
  </div>`;
}

function renderExplain(step) {
  const exp = tx(step.explain, 'en');
  if (Array.isArray(exp)) {
    const points = exp.map(p => `<li class="xpl-point">${esc(p)}</li>`).join('');
    return `<div class="xpl-label">💡 Explanation</div><ul class="xpl-list">${points}</ul>`;
  }
  return `<div class="xpl-text">${esc(exp)}</div>`;
}

function renderSteps(steps, uc) {
  return steps.map((step, si) => `
    <div class="step-card" style="--uc:${uc}">
      <div class="step-head">
        <div class="step-num">${si + 1}</div>
        <div class="step-info">
          <div class="step-title">${esc(tx(step.title, 'en'))}</div>
        </div>
      </div>
      <div class="step-body">
        <div class="ed-win">
          <div class="ed-bar"><div class="dot dr"></div><div class="dot dy"></div><div class="dot dg"></div>
            <span class="ed-file">query.sql</span></div>
          <pre class="ed-ta" style="margin:0;overflow-x:auto;white-space:pre"><code>${esc(step.sql || '')}</code></pre>
        </div>
        <div class="xpl">${renderExplain(step)}</div>
      </div>
    </div>`).join('');
}

function buildPage({ company, q, slug, homeCSS, learnLinksHTML }) {
  const companyDisplay = cap(company.name);
  const questionText = tx(q.question, 'en');
  const storyText = tx(q.story, 'en');
  const title = buildTitle(companyDisplay, questionText);
  const description = buildDescription(companyDisplay, q, questionText);
  const canonical = `${SITE_URL}/questions/${slug}.html`;
  const uc = company.c || '#7c5cfc';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
${homeCSS}
${STATIC_OVERRIDES_CSS}
</style>
${buildFooterStyleTag()}
</head>
<body>
<div class="bg"></div>

${buildNavHTML(learnLinksHTML)}

<div class="static-wrap">
  <a class="crumb" href="/">← All SQL Questions</a>

  <div class="q-header">
    <div class="q-badges">
      <span class="co-tag" style="background:color-mix(in srgb,${uc} 13%,white);color:color-mix(in srgb,${uc} 90%,black)">${esc(companyDisplay)}</span>
      <span class="diff-${esc(q.diff)}">${esc(q.diff)}</span>
      ${(q.cc || []).map(c => `<span class="chip">${esc(c)}</span>`).join('')}
    </div>
    <h1 class="q-h1">${esc(questionText)}</h1>
    <p class="q-sub">${esc(companyDisplay)} · ${esc(company.sub || '')} — practice this real-world SQL scenario live in your browser.</p>
  </div>

  ${storyText ? `<div class="story" style="--uc:${uc}">
    <div class="story-bg"></div>
    <div class="story-top">
      <span class="story-lbl">📖 Story</span>
      <span class="story-co">${esc(companyDisplay)} · ${esc(company.sub || '')}</span>
    </div>
    <div class="story-body">${esc(storyText)}</div>
  </div>` : ''}

  <div class="mission">
    <div class="mission-top">🎯 Your Mission</div>
    <div class="mission-body">${esc(questionText)}</div>
  </div>

  ${renderSchemas(q.schemas)}

  <div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin:1.5rem 0 .75rem">⚡ Step-by-Step Walkthrough</div>
  ${renderSteps(q.steps || [], uc)}

  <div class="cta-row">
    <a class="cta-btn" href="/">▶ Practice this live</a>
    <a class="cta-btn secondary" href="/">← Browse all questions</a>
  </div>
</div>

${buildFooterHTML()}

<script>
${NAV_SCRIPT}
</script>
</body>
</html>
`;
}

// ── expected-slug map (always computed in full, regardless of --only) ─────

function computeExpected(companies) {
  const expected = new Map(); // slug → { company, q }

  for (const company of companies) {
    const dataFile = path.join(QUESTIONS_DIR, `${company.id}.json`);
    if (!fs.existsSync(dataFile)) continue;
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const questions = Array.isArray(data) ? data : (data.questions || []);

    for (const q of questions) {
      const topic = slugifyQuestion(tx(q.question, 'en'));
      let slug = `${company.id}-${topic}`;
      let n = 2;
      while (expected.has(slug)) {
        slug = `${company.id}-${topic}-${n++}`;
      }
      expected.set(slug, { company, q });
    }
  }

  return expected;
}

// ── main ─────────────────────────────────────────────────────────────────

/**
 * questions/slugs.json — maps "<companyId>:<questionId>" → slug. index.html fetches this
 * to build row links instead of reimplementing slugifyQuestion() in browser JS, which would
 * just recreate the two-places-can-drift problem this script's orphan check exists to catch.
 */
function writeSlugManifest(expected) {
  const manifest = {};
  for (const [slug, { company, q }] of expected) {
    manifest[`${company.id}:${q.id}`] = slug;
  }
  fs.writeFileSync(path.join(QUESTIONS_DIR, 'slugs.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

// ── listing pagination ──────────────────────────────────────────────────
//
// A non-JS crawler previously saw an empty <tbody> — every row, including the
// links to these static pages, was built by client JS from fetched JSON. Then
// it saw ALL rows, unpaginated. Now each listing page (index.html for page 1,
// questions/page/N.html for the rest) gets exactly its own PAGE_SIZE-sized
// slice spliced into its raw <tbody>, in a stable, explicit order: by
// company id, then by question id — never by anything content-derived (like
// the slug), so editing a question's wording can't reshuffle which page it
// lives on. Client JS still takes over once loaded, but it's now scoped to
// PAGE_QUESTIONS (this page's own {uid,qid} pairs, injected below) instead of
// every question on the site — otherwise the moment JS loaded it would
// silently re-render the full unpaginated list, undoing pagination for every
// real visitor while leaving crawlers (who never ran the JS) none the wiser.
//
// NOTE: the <tr> row markup mirrors index.html's client-side renderTable()
// (search for "td-num"). Plain structural HTML, not logic — low drift risk,
// but if that template changes, update both.

/** Stable, explicit, content-independent order: company id, then question id. */
function sortEntries(expected) {
  const all = [...expected.entries()].map(([slug, v]) => ({ slug, ...v }));
  all.sort((a, b) => {
    if (a.company.id !== b.company.id) return a.company.id < b.company.id ? -1 : 1;
    return a.q.id - b.q.id;
  });
  return all;
}

function paginateEntries(sorted, pageSize = PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pages = [];
  for (let page = 1; page <= totalPages; page++) {
    pages.push({
      page,
      totalPages,
      total: sorted.length,
      startIndex: (page - 1) * pageSize, // 0-based index of this page's first item
      items: sorted.slice((page - 1) * pageSize, page * pageSize),
    });
  }
  return pages;
}

function pageUrl(n) {
  return n === 1 ? '/' : `/questions/page/${n}.html`;
}

function buildRowsHtml(items, startIndex) {
  return items.map(({ slug, company, q }, i) => {
    const companyDisplay = cap(company.name);
    const qCell = `<div class="q-text">${esc(tx(q.question, 'en'))}</div><div class="q-concepts">${(q.cc || []).slice(0, 3).map(esc).join(' · ')}</div>`;
    return `      <tr onclick="openQ('${company.id}',${q.id})">
        <td class="td-num">${startIndex + i + 1}</td>
        <td class="td-q">
          <a class="q-link" href="/questions/${slug}.html" onclick="event.preventDefault();event.stopPropagation();openQ('${company.id}',${q.id});">${qCell}</a>
        </td>
        <td class="td-co"><span class="co-tag" style="background:color-mix(in srgb,${company.c} 13%,white);color:color-mix(in srgb,${company.c} 90%,black)">${esc(companyDisplay)}</span></td>
        <td class="td-diff"><span class="diff-${esc(q.diff)}">${esc(q.diff)}</span></td>
        <td class="td-st"></td>
      </tr>`;
  }).join('\n');
}

/** Numbered 1..N + Previous/Next, real <a href> (or a non-link <span> for the current page). */
function buildPaginationNav(page, totalPages) {
  if (totalPages <= 1) return '';
  const links = [];
  if (page > 1) {
    links.push(`<a class="page-link page-prev" href="${pageUrl(page - 1)}" rel="prev">← Previous</a>`);
  }
  for (let n = 1; n <= totalPages; n++) {
    links.push(n === page
      ? `<span class="page-link current" aria-current="page">${n}</span>`
      : `<a class="page-link" href="${pageUrl(n)}">${n}</a>`);
  }
  if (page < totalPages) {
    links.push(`<a class="page-link page-next" href="${pageUrl(page + 1)}" rel="next">Next →</a>`);
  }
  links.push(`<div class="page-info">Page ${page} of ${totalPages}</div>`);
  return links.join('\n      ');
}

/**
 * Renders one listing page (index.html for page 1, questions/page/N.html for the rest)
 * from a pristine copy of index.html's current markup — always the same base for every
 * page, so pages can't compound each other's substitutions across runs.
 */
function renderListingPage(baseHtml, { page, totalPages, items, startIndex, total }) {
  let html = baseHtml;
  const paginated = totalPages > 1;

  const title = page === 1
    ? (paginated ? `${HOME_TITLE_BASE} (Page 1 of ${totalPages})` : HOME_TITLE_BASE)
    : `SQL Practice Questions — Page ${page} of ${totalPages} | TableNotFound`;

  const description = page === 1
    ? (paginated ? `${HOME_DESCRIPTION_BASE} Page 1 of ${totalPages}.` : HOME_DESCRIPTION_BASE)
    : `Browse SQL practice questions ${startIndex + 1}–${startIndex + items.length} of ${total} on TableNotFound — free, in-browser SQL practice with real company scenarios. Page ${page} of ${totalPages}.`;

  const canonical = `${SITE_URL}${pageUrl(page)}`;

  html = html.replace(/<title>.*?<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`);
  html = html.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${canonical}">`);
  // strip any prev/next <link> tags from a previous run before (maybe) re-adding them
  html = html.replace(/\s*<link rel="(?:prev|next)" href="[^"]*">/g, '');
  let relLinks = '';
  if (page > 1) relLinks += `\n<link rel="prev" href="${SITE_URL}${pageUrl(page - 1)}">`;
  if (page < totalPages) relLinks += `\n<link rel="next" href="${SITE_URL}${pageUrl(page + 1)}">`;
  if (relLinks) html = html.replace(/<link rel="canonical" href="[^"]*">/, m => `${m}${relLinks}`);

  html = html.replace(/(<tbody id="tbody">)[\s\S]*?(<\/tbody>)/,
    (_, open, close) => `${open}\n${buildRowsHtml(items, startIndex)}\n    ${close}`);

  html = html.replace(/(<span class="toolbar-stat" id="tstat">)[^<]*(<\/span>)/,
    (_, open, close) => `${open}${items.length} question${items.length !== 1 ? 's' : ''}${close}`);

  html = html.replace(/(<nav id="pagination" class="pagination" aria-label="Question list pages">)[\s\S]*?(<\/nav>)/,
    (_, open, close) => `${open}\n      ${buildPaginationNav(page, totalPages)}\n    ${close}`);

  const pageQuestions = items.map(({ company, q }) => ({ uid: company.id, qid: q.id }));
  html = html.replace(/let PAGE_QUESTIONS = \[[^\]]*\];/, `let PAGE_QUESTIONS = ${JSON.stringify(pageQuestions)};`);

  return html;
}

/** Writes every listing page (index.html + questions/page/N.html) and warns about stale page files. */
function writeListingPages(expected, dryRun) {
  const baseHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sorted = sortEntries(expected);
  const pages = paginateEntries(sorted);

  for (const p of pages) {
    const html = renderListingPage(baseHtml, p);
    if (dryRun) continue;
    const outPath = p.page === 1 ? path.join(ROOT, 'index.html') : path.join(PAGE_DIR, `${p.page}.html`);
    if (p.page > 1) fs.mkdirSync(PAGE_DIR, { recursive: true });
    fs.writeFileSync(outPath, html, 'utf8');
  }

  console.log(`${dryRun ? '[dry-run] would write' : 'Wrote'} ${pages.length} listing page(s) (${PAGE_SIZE}/page, ${sorted.length} question(s) total):`);
  pages.forEach(p => console.log(`  ${pageUrl(p.page)} — ${p.items.length} question(s)`));

  if (!dryRun && fs.existsSync(PAGE_DIR)) {
    const expectedPageFiles = new Set(pages.filter(p => p.page > 1).map(p => `${p.page}.html`));
    const stalePages = fs.readdirSync(PAGE_DIR).filter(f => f.endsWith('.html') && !expectedPageFiles.has(f));
    if (stalePages.length) {
      console.warn(`\n⚠ ${stalePages.length} file(s) in questions/page/ no longer correspond to a real page (not deleted — review and remove manually):`);
      stalePages.forEach(f => console.warn(`  questions/page/${f}`));
    }
  }

  return pages;
}

function main() {
  const companies = JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, 'index.json'), 'utf8'));
  const homeCSS = extractHomeCSS();
  const learnLinksHTML = loadLearnLinksHTML();

  const expected = computeExpected(companies);

  let written = 0;
  const writtenSlugs = [];

  for (const [slug, { company, q }] of expected) {
    if (ONLY && slug !== ONLY) continue;

    const html = buildPage({ company, q, slug, homeCSS, learnLinksHTML });
    const outPath = path.join(QUESTIONS_DIR, `${slug}.html`);
    writtenSlugs.push(slug);

    if (!DRY_RUN) {
      fs.writeFileSync(outPath, html, 'utf8');
    }
    written++;
  }

  console.log(`${DRY_RUN ? '[dry-run] would write' : 'Wrote'} ${written} page(s):`);
  writtenSlugs.forEach(s => console.log(`  questions/${s}.html`));

  if (!DRY_RUN) {
    writeSlugManifest(expected);
    console.log('Updated questions/slugs.json');
  }

  console.log('');
  writeListingPages(expected, DRY_RUN);

  // Orphan check always runs against the FULL expected set, not just what --only wrote,
  // so a partial/preview run doesn't falsely flag every other page as stale.
  const expectedFiles = new Set([...expected.keys()].map(s => `${s}.html`));
  const existingFiles = fs.readdirSync(QUESTIONS_DIR).filter(f => f.endsWith('.html'));
  const stale = existingFiles.filter(f => !expectedFiles.has(f));

  if (stale.length) {
    console.warn(`\n⚠ ${stale.length} file(s) in questions/ no longer match any JSON entry (not deleted — review and remove manually):`);
    stale.forEach(f => console.warn(`  questions/${f}`));
  } else {
    console.log('\nNo orphaned static pages found.');
  }
}

if (require.main === module) {
  main();
}

module.exports = { computeExpected, sortEntries, paginateEntries, pageUrl, PAGE_SIZE };
