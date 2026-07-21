// Single source of truth for the site's public domain, shared by
// generate-question-pages.js (canonical tags) and generate-sitemap.js
// (sitemap.xml / robots.txt) so they can't drift apart.
// Bare domain 308-redirects to www — use the canonical www form everywhere.
const SITE_URL = 'https://www.tablenotfound.com';

module.exports = { SITE_URL };
