#!/usr/bin/env node
/**
 * Injects the shared site footer (About/Contact/Privacy/Terms links) into pages no
 * generator owns end-to-end: index.html and the /learn pages. Question pages and
 * about/contact/privacy/terms get the footer natively from their own generators instead.
 *
 * Idempotent — matches the previously-injected block by id and replaces it in place,
 * so re-running (e.g. after adding a new /learn page) never duplicates it.
 *
 * Usage: node scripts/inject-footer.js
 */
const fs = require('fs');
const path = require('path');

const { ROOT } = require('./site-common');
const { buildFooterHTML, buildFooterStyleTag } = require('./site-footer');

function injectInto(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  let updated = html;

  const footerRe = /<footer id="tnf-footer">[\s\S]*?<\/footer>/;
  const footerHTML = buildFooterHTML();
  updated = footerRe.test(updated)
    ? updated.replace(footerRe, footerHTML)
    : updated.replace(/<\/body>/, `${footerHTML}\n</body>`);

  const styleRe = /<style id="tnf-footer-style">[\s\S]*?<\/style>/;
  const styleTag = buildFooterStyleTag();
  updated = styleRe.test(updated)
    ? updated.replace(styleRe, styleTag)
    : updated.replace(/<\/head>/, `${styleTag}\n</head>`);

  if (updated !== html) {
    fs.writeFileSync(filePath, updated, 'utf8');
    return true;
  }
  return false;
}

function main() {
  const targets = [path.join(ROOT, 'index.html')];

  const learnIndexPath = path.join(ROOT, 'learn', 'index.json');
  if (fs.existsSync(learnIndexPath)) {
    const items = JSON.parse(fs.readFileSync(learnIndexPath, 'utf8'));
    for (const item of items) targets.push(path.join(ROOT, 'learn', item.file));
  } else {
    console.warn('⚠ learn/index.json not found — /learn pages skipped');
  }

  let changed = 0;
  for (const file of targets) {
    if (!fs.existsSync(file)) {
      console.warn(`⚠ ${file} not found — skipped`);
      continue;
    }
    const didChange = injectInto(file);
    console.log(`${didChange ? 'Updated' : 'Unchanged'}: ${path.relative(ROOT, file)}`);
    if (didChange) changed++;
  }
  console.log(`\nFooter injected/refreshed in ${changed} of ${targets.length} file(s).`);
}

if (require.main === module) {
  main();
}
