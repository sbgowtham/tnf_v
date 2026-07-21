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

const ROOT = path.join(__dirname, '..');
const QUESTIONS_DIR = path.join(ROOT, 'questions');
const TITLE_MAX = 60;

const args = process.argv.slice(2);
const ONLY = (args.find(a => a.startsWith('--only=')) || '').split('=')[1] || null;
const DRY_RUN = args.includes('--dry-run');

// ── text helpers ─────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Same semantics as tx() in index.html: string | {en,ta,hi,te} string | {en,ta,hi,te} string[] */
function tx(field, lang) {
  lang = lang || 'en';
  if (typeof field === 'string') return field;
  const val = field && (field[lang] || field.en);
  return val || (Array.isArray(field && field.en) ? [] : '');
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
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

// ── static assets ────────────────────────────────────────────────────────

/** Extracts the <style>...</style> block from index.html so static pages match it exactly. */
function extractHomeCSS() {
  const homeHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = homeHtml.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) throw new Error('Could not find <style> block in index.html');
  return m[1];
}

function loadLearnLinksHTML() {
  const file = path.join(ROOT, 'learn', 'index.json');
  if (!fs.existsSync(file)) return '<div class="dropdown-empty">No items yet</div>';
  const items = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!items.length) return '<div class="dropdown-empty">No items yet</div>';
  return items.map(item => `
      <a class="dropdown-item" href="/learn/${esc(item.file)}" target="_blank">
        <div class="di-icon" style="background:${esc(item.color || '#f3f0ff')}">${item.icon || '📄'}</div>
        <div class="di-text">
          <span class="di-title">${esc(item.title)}</span>
          <span class="di-sub">${esc(item.desc || '')}</span>
        </div>
      </a>`).join('');
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
.static-footer{margin-top:3rem;font-size:12px;color:var(--t3);text-align:center}
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
</head>
<body>
<div class="bg"></div>

<nav class="nav">
  <a href="/" class="logo" style="text-decoration:none;color:inherit"><span class="logo-tag">Table</span><span class="logo-rest">NotFound</span></a>
  <div class="nav-gap"></div>
  <div class="nav-menu" id="navmenu">
    <button class="menu-btn" onclick="toggleMenu()">
      <span>Learn</span>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <div class="dropdown" id="dropdown">
      <div class="dropdown-header">Visualizers &amp; Guides</div>
      <div id="learn-links">${learnLinksHTML}</div>
    </div>
  </div>
</nav>

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

  <div class="static-footer">TableNotFound &nbsp;·&nbsp; Free, in-browser SQL practice with real company scenarios</div>
</div>

<script>
function toggleMenu(){document.getElementById('navmenu').classList.toggle('open');}
document.addEventListener('click', e => {
  const m=document.getElementById('navmenu');
  if(m&&!m.contains(e.target))m.classList.remove('open');
});
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

// ── index.html <tbody> pre-render ──────────────────────────────────────────
//
// A non-JS crawler previously saw an empty <tbody> — every row, including the
// links to these static pages, was built by client JS from fetched JSON. This
// splices the same rows client-side renderTable() would produce (all questions,
// nothing filtered, nothing marked done — the true state of a fresh page load)
// directly into index.html's raw markup, keyed off <tbody id="tbody">. Client
// JS still overwrites tbody.innerHTML unconditionally once it loads, so nothing
// changes for JS users — this only fixes what non-JS clients and crawlers see.
//
// NOTE: this row markup mirrors the <tr> template in index.html's renderTable()
// (search for "td-num"). It's plain structural HTML, not logic, so the
// duplication is low-risk — but if that template changes, update both.

function buildStaticTableRows(expected) {
  let i = 0;
  const rows = [];
  for (const [slug, { company, q }] of expected) {
    i++;
    const companyDisplay = cap(company.name);
    const qCell = `<div class="q-text">${esc(tx(q.question, 'en'))}</div><div class="q-concepts">${(q.cc || []).slice(0, 3).map(esc).join(' · ')}</div>`;
    rows.push(`      <tr onclick="openQ('${company.id}',${q.id})">
        <td class="td-num">${i}</td>
        <td class="td-q">
          <a class="q-link" href="/questions/${slug}.html" onclick="event.preventDefault();event.stopPropagation();openQ('${company.id}',${q.id});">${qCell}</a>
        </td>
        <td class="td-co"><span class="co-tag" style="background:color-mix(in srgb,${company.c} 13%,white);color:color-mix(in srgb,${company.c} 90%,black)">${esc(companyDisplay)}</span></td>
        <td class="td-diff"><span class="diff-${esc(q.diff)}">${esc(q.diff)}</span></td>
        <td class="td-st"></td>
      </tr>`);
  }
  return rows.join('\n');
}

/** Splices static rows into index.html's <tbody id="tbody"> and updates the toolbar count, in place. */
function updateIndexHtmlTable(expected) {
  const indexPath = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  const rowsHtml = buildStaticTableRows(expected);
  const count = expected.size;
  let ok = true;

  const tbodyRe = /(<tbody id="tbody">)[\s\S]*?(<\/tbody>)/;
  if (tbodyRe.test(html)) {
    html = html.replace(tbodyRe, (_, open, close) => `${open}\n${rowsHtml}\n    ${close}`);
  } else {
    console.warn('⚠ Could not find <tbody id="tbody"> in index.html — static rows not injected.');
    ok = false;
  }

  const statRe = /(<span class="toolbar-stat" id="tstat">)[^<]*(<\/span>)/;
  if (statRe.test(html)) {
    html = html.replace(statRe, (_, open, close) => `${open}${count} question${count !== 1 ? 's' : ''}${close}`);
  } else {
    console.warn('⚠ Could not find #tstat in index.html — static count not updated.');
    ok = false;
  }

  fs.writeFileSync(indexPath, html, 'utf8');
  return ok;
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

    if (updateIndexHtmlTable(expected)) {
      console.log('Updated index.html <tbody> with static rows + links');
    }
  }

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

main();
