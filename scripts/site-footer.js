// Shared site footer — About/Contact/Privacy/Terms links, embedded on every page so
// none of the four are orphaned. Single source of truth for the link list + markup:
// generate-question-pages.js and generate-static-pages.js embed it natively when they
// build a page; inject-footer.js splices it (idempotently, by id) into the hand-authored
// pages no generator owns outright (index.html, /learn/*.html).
const FOOTER_LINKS = [
  { href: '/about.html', label: 'About' },
  { href: '/contact.html', label: 'Contact' },
  { href: '/privacy.html', label: 'Privacy Policy' },
  { href: '/terms.html', label: 'Terms of Service' },
];

// Deliberately self-contained (no var(--t3) etc.) — pages across the site use different
// CSS variable names for the same concepts (index.html's --t3 vs ctrlz's --text3 vs
// datalayers' --muted), so this uses color:inherit + opacity to read reasonably on any
// of them instead of chasing every page's palette.
const FOOTER_CSS = `#tnf-footer{margin-top:3rem;padding:1.5rem 1rem 2rem;text-align:center;border-top:1px solid rgba(128,128,128,.22)}
#tnf-footer .tnf-footer-links{display:flex;flex-wrap:wrap;justify-content:center;gap:1rem;margin-bottom:.5rem}
#tnf-footer .tnf-footer-links a{color:inherit;opacity:.65;text-decoration:none;font-size:12px;font-weight:600;transition:opacity .15s}
#tnf-footer .tnf-footer-links a:hover{opacity:1;text-decoration:underline}
#tnf-footer .tnf-footer-copy{font-size:11px;opacity:.45}`;

function buildFooterHTML() {
  const links = FOOTER_LINKS.map(l => `<a href="${l.href}">${l.label}</a>`).join('\n      ');
  return `<footer id="tnf-footer">
      <nav class="tnf-footer-links">
      ${links}
      </nav>
      <div class="tnf-footer-copy">© 2026 TableNotFound</div>
    </footer>`;
}

function buildFooterStyleTag() {
  return `<style id="tnf-footer-style">\n${FOOTER_CSS}\n</style>`;
}

module.exports = { FOOTER_LINKS, FOOTER_CSS, buildFooterHTML, buildFooterStyleTag };
