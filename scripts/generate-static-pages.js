#!/usr/bin/env node
/**
 * Generates about.html, contact.html, privacy.html, terms.html at the repo root —
 * same CSS/nav/footer as everything else, extracted from index.html so they can't
 * visually drift from the rest of the site.
 *
 * Content below uses [SQUARE BRACKETS] wherever the site owner's actual name, email,
 * or jurisdiction is needed — fill those in before publishing.
 *
 * Usage:
 *   node scripts/generate-static-pages.js
 */
const fs = require('fs');
const path = require('path');

const { SITE_URL } = require('./site-config');
const { ROOT, esc, extractHomeCSS, loadLearnLinksHTML, buildNavHTML, NAV_SCRIPT } = require('./site-common');
const { buildFooterHTML, buildFooterStyleTag } = require('./site-footer');

const LAST_UPDATED = 'July 21, 2026';

const PAGE_CSS = `
.legal-wrap{max-width:760px;margin:0 auto;padding:2.5rem 1.5rem 6rem;line-height:1.7}
.crumb{font-size:12px;font-weight:600;color:var(--t3);text-decoration:none;display:inline-flex;align-items:center;gap:6px;margin-bottom:1.5rem}
.crumb:hover{color:var(--t2)}
.legal-h1{font-size:clamp(26px,4vw,38px);font-weight:800;letter-spacing:-1px;margin-bottom:.4rem;color:var(--text)}
.legal-meta{font-size:12px;color:var(--t3);margin-bottom:2rem}
.legal-wrap h2{font-size:17px;font-weight:700;color:var(--text);margin:2rem 0 .75rem}
.legal-wrap p{font-size:14.5px;color:var(--t2);margin-bottom:.9rem}
.legal-wrap ul{margin:0 0 .9rem 1.25rem;font-size:14.5px;color:var(--t2)}
.legal-wrap li{margin-bottom:.4rem}
.legal-wrap a{color:#7c5cfc;font-weight:600;text-decoration:none}
.legal-wrap a:hover{text-decoration:underline}
.legal-wrap strong{color:var(--text)}
.bracket{background:#fff3cd;color:#664d03;padding:0 3px;border-radius:3px}
`;

// ── page content ─────────────────────────────────────────────────────────

const PAGES = [
  {
    slug: 'about',
    title: 'About | TableNotFound',
    description: 'TableNotFound is a free, in-browser SQL practice tool built around real-world company scenarios — no signup, no backend, just SQL.',
    h1: 'About TableNotFound',
    body: `
      <p>TableNotFound is a free tool for practicing SQL against real-world business scenarios modeled on companies like Flipkart, Uber, Netflix, Snapchat, Tinder, Myntra, and YouTube.</p>
      <p>Every query runs entirely in your browser using SQLite compiled to WebAssembly — there's no backend, no account, and nothing you type is sent to a server. Close the tab and it's gone; open it again and start fresh.</p>
      <h2>Why it exists</h2>
      <p>Most SQL practice is disconnected from why the query matters. TableNotFound frames every question as a short business story first — a supplier pricing question at Flipkart, a driver earnings question at Uber — so you're solving a problem, not just matching syntax to a pattern.</p>
      <h2>About the company scenarios</h2>
      <p>Company names are used for scenario flavor only. These questions may or may not reflect anything actually asked at the named companies, and TableNotFound is not affiliated with, endorsed by, or sponsored by any of them.</p>
      <h2>Who's behind this</h2>
      <p>TableNotFound is built and maintained by Gowtham SB. You can find more of my work at <a href="https://linkedin.com/in/sbgowtham" target="_blank" rel="noopener">linkedin.com/in/sbgowtham</a>.</p>
      <p>Found a bug, have feedback, or want to suggest a company scenario? <a href="/contact.html">Get in touch</a>.</p>
    `,
  },
  {
    slug: 'contact',
    title: 'Contact | TableNotFound',
    description: 'Get in touch with TableNotFound — report a bug, share feedback, or suggest a new SQL practice scenario.',
    h1: 'Contact',
    body: `
      <p>TableNotFound is a small, independently-run project. If you've spotted a bug, have feedback, or want to suggest a company scenario, I'd like to hear from you.</p>
      <h2>Email</h2>
      <p>The most reliable way to reach me: <a href="mailto:dataengineeringtamil@gmail.com">dataengineeringtamil@gmail.com</a></p>
      <h2>Elsewhere</h2>
      <p>You can also find me at <a href="https://linkedin.com/in/sbgowtham" target="_blank" rel="noopener">linkedin.com/in/sbgowtham</a>.</p>
      <p>This site doesn't run a live chat or contact form — it has no backend to send one to — so email is the fastest path.</p>
    `,
  },
  {
    slug: 'terms',
    title: 'Terms of Service | TableNotFound',
    description: 'The terms governing use of TableNotFound, a free, in-browser SQL practice tool with real-world company scenarios.',
    h1: 'Terms of Service',
    body: `
      <h2>1. Acceptance of these terms</h2>
      <p>By using TableNotFound (the "Service"), you agree to these Terms of Service. If you don't agree, please don't use the Service.</p>
      <h2>2. What the Service is</h2>
      <p>TableNotFound is a free, browser-based tool for practicing SQL. There are no accounts, no payments, and no data submitted to a server — SQL queries run entirely client-side in your browser.</p>
      <h2>3. Company scenarios aren't affiliations</h2>
      <p>Practice questions reference real company names (e.g. Flipkart, Uber, Netflix, Snapchat, Tinder, Myntra, YouTube) purely as scenario flavor for teaching purposes. These questions may or may not reflect anything actually asked by those companies, and TableNotFound is not affiliated with, endorsed by, or sponsored by any company named on this site.</p>
      <h2>4. No warranty</h2>
      <p>The Service is provided "as is" and "as available," without warranty of any kind. We don't guarantee the accuracy of practice questions, uninterrupted availability, or that the Service will be error-free.</p>
      <h2>5. Acceptable use</h2>
      <ul>
        <li>Don't attempt to disrupt, overload, or gain unauthorized access to the Service.</li>
        <li>Don't scrape or republish site content at scale without permission.</li>
      </ul>
      <h2>6. Advertising and third parties</h2>
      <p>The Service displays ads served by third-party vendors, including Google. See our <a href="/privacy.html">Privacy Policy</a> for details on cookies and advertising.</p>
      <h2>7. Limitation of liability</h2>
      <p>To the fullest extent permitted by law, TableNotFound and its operator aren't liable for any indirect, incidental, or consequential damages arising from use of the Service.</p>
      <h2>8. Changes to these terms</h2>
      <p>These terms may be updated from time to time. Continued use of the Service after a change means you accept the updated terms.</p>
      <h2>9. Governing law</h2>
      <p>These terms are governed by the laws of Tamil Nadu, India, without regard to conflict-of-law principles.</p>
      <h2>10. Contact</h2>
      <p>Questions about these terms? <a href="/contact.html">Get in touch</a>.</p>
    `,
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy | TableNotFound',
    description: "TableNotFound's privacy policy — how cookies, Google AdSense, and third-party advertising vendors are used on this site.",
    h1: 'Privacy Policy',
    body: `
      <h2>Overview</h2>
      <p>TableNotFound doesn't require an account, and has no server-side backend or database. SQL practice runs entirely in your browser using WebAssembly. We don't collect or store the queries you write, your answers, or any personal information ourselves.</p>
      <h2>Cookies</h2>
      <p>This site and the third-party advertising vendors it works with may use cookies and similar technologies (such as browser local storage) to operate the site, remember basic preferences, and serve and measure ads.</p>
      <h2>Third-party advertising vendors</h2>
      <p>TableNotFound displays ads served by <strong>Google AdSense</strong>. Google and its advertising partners (collectively, third-party vendors) may use cookies to serve ads based on a visitor's prior visits to this site or other sites on the internet.</p>
      <h2>Google's use of advertising cookies</h2>
      <p>Google, as a third-party vendor, uses cookies to serve ads on this site. Google's use of advertising cookies enables it and its partners to serve ads to you based on your visit to this site and/or other sites on the internet.</p>
      <h2>Opting out of personalized ads</h2>
      <p>You may opt out of personalized advertising by visiting <a href="https://adssettings.google.com/" target="_blank" rel="noopener">Google Ads Settings</a>. You can also visit <a href="https://www.aboutads.info/choices/" target="_blank" rel="noopener">aboutads.info</a> to opt out of third-party vendor use of cookies for personalized advertising more broadly.</p>
      <h2>What we don't collect</h2>
      <p>We don't operate user accounts, don't process payments, and don't store your SQL queries or practice progress on any server — that state lives only in your browser's memory for the current tab.</p>
      <h2>Children's privacy</h2>
      <p>TableNotFound is not directed at children under 13, and we don't knowingly collect personal information from children.</p>
      <h2>Changes to this policy</h2>
      <p>This policy may be updated from time to time; the date below reflects the most recent version.</p>
      <h2>Contact</h2>
      <p>Questions about this policy, or based in a location with specific data rights (e.g. GDPR, CCPA)? <a href="/contact.html">Get in touch</a> — we're operated from Chennai, India.</p>
    `,
  },
];

// ── page shell ───────────────────────────────────────────────────────────

function buildPage({ slug, title, description, h1, body }, { homeCSS, learnLinksHTML }) {
  const canonical = `${SITE_URL}/${slug}.html`;
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
${PAGE_CSS}
</style>
${buildFooterStyleTag()}
</head>
<body>
<div class="bg"></div>

${buildNavHTML(learnLinksHTML)}

<div class="legal-wrap">
  <a class="crumb" href="/">← Back to TableNotFound</a>
  <h1 class="legal-h1">${esc(h1)}</h1>
  <div class="legal-meta">Last updated: ${LAST_UPDATED}</div>
  ${body}
</div>

${buildFooterHTML()}

<script>
${NAV_SCRIPT}
</script>
</body>
</html>
`;
}

// ── main ─────────────────────────────────────────────────────────────────

function main() {
  const homeCSS = extractHomeCSS();
  const learnLinksHTML = loadLearnLinksHTML();

  const remaining = [];
  for (const page of PAGES) {
    const html = buildPage(page, { homeCSS, learnLinksHTML });
    const outPath = path.join(ROOT, `${page.slug}.html`);
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(`Wrote ${page.slug}.html`);

    const placeholders = html.match(/\[YOUR[^\]]*\]/g);
    if (placeholders) remaining.push({ slug: page.slug, placeholders: [...new Set(placeholders)] });
  }

  if (remaining.length) {
    console.log('\n⚠ Still contains [SQUARE BRACKET] placeholders — fill in before publishing:');
    remaining.forEach(r => console.log(`  ${r.slug}.html — ${r.placeholders.join(', ')}`));
  } else {
    console.log('\nNo [SQUARE BRACKET] placeholders remaining.');
  }
}

if (require.main === module) {
  main();
}

module.exports = { PAGES };
