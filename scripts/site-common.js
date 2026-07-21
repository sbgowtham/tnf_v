// Shared helpers for generate-question-pages.js and generate-static-pages.js —
// extracted here once both scripts needed the same nav markup / CSS-extraction /
// escaping logic, so they can't drift apart the way two copies eventually would.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Extracts the <style>...</style> block from index.html so generated pages match it exactly. */
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
  return items.map(item => {
    const url = item.href || `/learn/${item.file}`;
    return `
      <a class="dropdown-item" href="${esc(url)}" target="_blank">
        <div class="di-icon" style="background:${esc(item.color || '#f3f0ff')}">${item.icon || '📄'}</div>
        <div class="di-text">
          <span class="di-title">${esc(item.title)}</span>
          <span class="di-sub">${esc(item.desc || '')}</span>
        </div>
      </a>`;
  }).join('');
}

/** Standard nav bar markup shared by every generated page. */
function buildNavHTML(learnLinksHTML) {
  return `<nav class="nav">
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
</nav>`;
}

const NAV_SCRIPT = `function toggleMenu(){document.getElementById('navmenu').classList.toggle('open');}
document.addEventListener('click', e => {
  const m=document.getElementById('navmenu');
  if(m&&!m.contains(e.target))m.classList.remove('open');
});`;

module.exports = { ROOT, esc, cap, extractHomeCSS, loadLearnLinksHTML, buildNavHTML, NAV_SCRIPT };
