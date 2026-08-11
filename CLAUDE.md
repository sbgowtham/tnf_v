# TableNotFound (tnf_v)

Free, in-browser SQL practice site (tablenotfound.com). No backend — SQLite runs client-side via WASM. Questions are modeled on real companies for flavor. This file exists so a new Claude session in this repo has full context without re-deriving it — read it fully before doing anything.

## Recurring requests and exact workflow

The user regularly asks two things, almost verbatim:

- **"make a new question for today add new use case and sample and functions or concept which was not used so far"**
- **"write a sql blog some topic make sure its not the same as before one"**

### Adding a new question

1. **Check what's already used** — run this to avoid repeating a company or SQL concept:
   ```
   python3 -c "
   import json, glob
   for f in sorted(glob.glob('questions/*.json')):
       if f.endswith(('index.json','slugs.json')): continue
       data = json.load(open(f))
       ccs = sorted({c for q in data['questions'] for c in q.get('cc',[])})
       print(f.split('/')[-1], ccs)
   "
   ```
   See "State" section below for the list as of this writing — but re-run the command, it may be stale.
2. **Pick a genuinely new SQL concept** (a function/clause never used before) + a **fresh company/use-case** not already used.
3. **Design the dataset by hand, then verify every query result with `node -e` using `node:sqlite`** (bundled SQLite ~3.53, superset of the 3.45 baseline) — never hand-compute expected output, always run it. This project's questions have a strong pattern: **include a genuine NULL that changes the answer** (not a token one) — e.g. NULL meaning "hasn't happened yet" vs 0, or a NULL that needs `COALESCE`/`WHERE ... IS NOT NULL` before a window function runs correctly. This is what makes the soft NULL-warning in the validator go away and gives each question real teaching value.
4. **Write `questions/<company>.json`** matching the exact schema used by every other file: top-level `{setup, questions: [...]}`, each question has `{id, diff, cc, story, question, schemas, steps}`. `story`/`question`/step `title`/step `explain` all need `en`, `ta`, `hi`, `te` translations (Tanglish/Hinglish/Tenglish style — English technical terms kept in English, everything else transliterated colloquially — match the tone of existing files, e.g. `ola.json` or `zomato.json`). Each step's `explain` is an array of 4 prose bullets per language, each one teaching something specific and non-obvious about that exact query (not generic filler). 3 steps per question is the norm: (1) raw data, (2) intermediate/warm-up or the "trap" version, (3) final corrected/complete query.
   **CRITICAL — ta/hi/te must be PURE LATIN SCRIPT, zero native Unicode characters, ever.** This has broken repeatedly (10 question files got fixed on 2026-08-08 after native Tamil/Hindi/Telugu script, Cyrillic homoglyphs, and stray macron diacritics crept into what was supposed to be transliteration). It happens from writing fast/on autopilot, not from a deliberate choice. **Immediately after writing or editing any translation field, run this scanner on the file before doing anything else**:
   ```python
   python3 -c "
   import json, unicodedata
   ALLOWED_EXTRA = set('₹—–\'\"\"…→✓✗×÷°')
   def is_emoji(c):
       return unicodedata.category(c) in ('So',) or ord(c) in range(0x1F000, 0x1FFFF) or ord(c) == 0xFE0F
   def scan(obj, path=''):
       results = []
       if isinstance(obj, str):
           bad = [c for c in obj if ord(c) > 127 and c not in ALLOWED_EXTRA and not is_emoji(c)]
           if bad: results.append((path, bad, obj))
       elif isinstance(obj, dict):
           for k, v in obj.items(): results.extend(scan(v, f'{path}.{k}' if path else k))
       elif isinstance(obj, list):
           for i, v in enumerate(obj): results.extend(scan(v, f'{path}[{i}]'))
       return results
   data = json.load(open('questions/<company>.json', encoding='utf-8'))
   hits = scan(data)
   print('contamination found:', len(hits))
   for p,b,s in hits: print(p,b)
   "
   ```
   Zero hits required before moving on. If it finds something, fix it and re-run — don't assume one pass caught everything.
5. **Add an entry to `questions/index.json`**: `{id, name, sub, c (hex color, pick something visually distinct from existing ones), difficulty}`.
6. **Validate**: `node scripts/validate-questions.js` — must show 0 failures for the new file (2 pre-existing unrelated failures on netflix/youtube are expected and not yours to fix unless asked). If the table count is below 5 rows, expand the dataset (don't just accept the failure) — and if you add rows after already writing the explain text, go back and fix any explain bullets that cite specific counts (row totals, "how many survive" etc.) so they match the final data.
7. **Regenerate static pages**: `node scripts/generate-question-pages.js` — this rebuilds every `questions/*.html` page, updates `questions/slugs.json`, and rebuilds the paginated listing (`index.html` + `questions/page/N.html`).
8. **Regenerate sitemap**: `node scripts/generate-sitemap.js`.
9. Sanity-check the final query's actual output one more time via `node:sqlite`, and re-run the contamination scanner against the *generated* HTML page too (not just the JSON) before reporting done. Do not commit/push unless explicitly asked.

### Adding a new blog post

1. **Check existing topics**: `ls blog/*.html` — pick something genuinely different in flavor from what's there (see "State" below). The established style: a realistic scenario, a dataset, a "bug" query with a wrong-but-plausible result, a "why it happens" explanation, a fix, a cheat-sheet table, verified end-to-end in SQLite (never hand-computed).
2. **Design + verify the dataset/queries** via `node -e` with `node:sqlite`, same rigor as questions.
3. **Add the entry to `learn/index.json` FIRST** (before generating the post) — `{title, desc, href: "/blog/<slug>.html", icon: "📝", color: "#dbeafe"}`. This file is the single source of truth for the "Learn" nav dropdown and feeds the sitemap.
4. **Build the HTML file** using the shared helpers so it's byte-identical in structure to the others: `extractHomeCSS()`, `loadLearnLinksHTML()`, `buildNavHTML()`, `NAV_SCRIPT` from `scripts/site-common.js`, and `buildFooterHTML()`/`buildFooterStyleTag()` from `scripts/site-footer.js`. Easiest approach: write a one-off Node script (see prior scratchpad scripts for the exact pattern) that assembles `<style>${homeCSS}${ARTICLE_CSS}</style>` + nav + article body + footer, and writes to `blog/<slug>.html`. Article CSS block is identical across all posts — copy it from any existing post's `<style>` tag (the `.article-wrap`, `.art-section`, `.cheat-table` etc. rules).
5. **Sync the nav dropdown into every existing blog post** — they're hand-written static files, NOT regenerated automatically. Patch each one's `<div id="learn-links">...</div>` block:
   ```js
   const { loadLearnLinksHTML } = require('./scripts/site-common');
   const learnLinksHTML = loadLearnLinksHTML();
   // for each existing blog/*.html file:
   html = html.replace(/<div id="learn-links">[\s\S]*?<\/nav>/,
     `<div id="learn-links">${learnLinksHTML}</div>\n    </div>\n  </div>\n</nav>`);
   ```
6. **Regenerate everything else**: `node scripts/generate-static-pages.js` (about/contact/privacy/terms — these bake the dropdown at build time), `node scripts/generate-question-pages.js` (question pages also bake the dropdown), `node scripts/generate-sitemap.js`.
7. Sanity-check the new post's content (title, section count, key numbers) with a quick `python3 -c` regex check, then `SendUserFile` it to the user for preview before they commit/push.

### General notes

- **Never commit or push unless explicitly asked.** The user has committed changes themselves mid-session before (author "Gowtham", not through Claude) — don't be surprised if `git status` is suddenly clean; just verify current state with `git status`/`git log` rather than assuming.
- Pagination is 10 questions/page. `index.html` is page 1, `questions/page/N.html` for the rest. Row numbering (`START_INDEX`) must stay correct across pages — this was a real bug fixed on 2026-07-28: the client-side `renderTable()` JS re-numbers rows after fetching `questions/index.json`, and needs a `START_INDEX` baked into each page (not just page-1-relative `i+1`) or page 2+ shows `1, 2, 3...` instead of `11, 12, 13...` after the JS hydration kicks in.
- Company/question detail HTML pages get **content-derived slugs** (not `company-id`), regenerated by `generate-question-pages.js`, which also warns about orphaned stale files (never auto-deletes them).

## State as of 2026-08-11

**Companies used (22)**, each with their standout concept(s) — pick something NOT in this list for the headline concept of a new question:
- airbnb: Self JOIN, COALESCE, Date Comparison (overlapping reservations / double-booking)
- amazon: strftime, COALESCE, GROUP BY
- bookmyshow: INTERSECT, EXCEPT, UNION ALL (weekly movie lineup: continuing vs new releases)
- cred: CROSS JOIN, LEFT JOIN (full user×category universe to detect missed reward categories)
- duolingo: GROUP_CONCAT, COALESCE, AVG NULL-sensitivity
- flipkart: Correlated Subquery, HAVING
- groww: FIRST_VALUE, LAST_VALUE (+ the LAST_VALUE default-frame gotcha), CTE
- meesho: DENSE_RANK, Running Total, CASE WHEN
- myntra: Correlated Subquery, HAVING
- netflix: COUNT(DISTINCT), CASE WHEN
- notion: Recursive CTE (date-spine generation), LEFT JOIN, CASE WHEN
- nykaa: NTILE (+ uneven-bucket-size gotcha), CASE WHEN expression form
- ola: ROW_NUMBER, PARTITION BY, CTE (dedup via ranking)
- snapchat: WHERE IN, CASE WHEN
- spotify: LAG, COALESCE, CTE (churn detection)
- techcorp: RANK, DENSE_RANK, ROW_NUMBER, LAG, LEAD, AVG OVER (kitchen-sink window fn showcase)
- tinder: basic JOIN/GROUP BY/COUNT
- uber: basic JOIN/GROUP BY/SUM/AVG/COALESCE
- unacademy: PERCENT_RANK (+ the ORDER BY direction inversion gotcha), RANK
- youtube: COUNT(DISTINCT), CASE WHEN
- zomato: EXISTS, NOT EXISTS, Correlated Subquery (anti-join pattern)

**Concepts NOT yet used in any question** (good candidates for next time): `NULLIF` (covered in a blog, not a question), `CAST` (used as a blog fix, never a question's headline), subquery in `FROM` (derived table — distinct syntax from CTE even though related), `LIKE`, plain `MIN`/`MAX` as headline concept, `IN (subquery)` form, `GROUP BY ... HAVING COUNT(DISTINCT ...)` combos not yet explored, window frame variants beyond what FIRST_VALUE/LAST_VALUE/running-total already covered (e.g. `ROWS BETWEEN N PRECEDING AND N FOLLOWING` for a moving average).

**Blog posts (10)** — each a distinct "silent wrong result" SQL gotcha, verified in SQLite:
1. `row-number-vs-rank-vs-dense-rank.html` — ranking-function ties
2. `in-vs-exists-vs-join.html` — the `NOT IN` + NULL trap
3. `left-join-where-clause-trap.html` — WHERE on right-table column cancels a LEFT JOIN
4. `count-star-vs-count-column-null-trap.html` — `COUNT(*)` vs `COUNT(column)` NULL skipping
5. `union-vs-union-all-silent-row-drop.html` — UNION's implicit dedup drops real duplicate-looking rows
6. `between-timestamps-missing-last-day.html` — `BETWEEN` date bounds silently exclude the last day's timestamps
7. `where-vs-having-execution-order.html` — aggregates can't go in `WHERE`, logical execution order
8. `nullif-sentinel-values-division-by-zero.html` — `-1`-as-placeholder sentinel values poisoning `AVG()`, plus safe division
9. `numbers-stored-as-text-sorting-trap.html` — a numeric-looking TEXT column sorts/compares lexicographically
10. `group-by-vs-window-functions-collapsed-rows.html` — `GROUP BY` collapses rows you still needed; SQLite silently allows mixing an aggregate into a per-row SELECT with no `GROUP BY` at all

Good next blog candidates: implicit type coercion beyond the TEXT-numbers case (e.g. comparing genuinely different types, or a DISTINCT-on-multiple-columns misconception), self-join gaps-and-islands (consecutive-run detection), subquery-in-FROM vs JOIN (correctness/readability trade-off), correlated subquery performance (N+1-style row-by-row re-execution), `CAST` failure/truncation behavior.

## Key scripts (all in `scripts/`)
- `generate-question-pages.js` — rebuilds all `questions/*.html`, `slugs.json`, `index.html`, `questions/page/N.html`. Run after any question or index.json change.
- `generate-static-pages.js` — rebuilds `about/contact/privacy/terms.html` from `learn/index.json` + `index.html`'s CSS. Run after any `learn/index.json` change.
- `generate-sitemap.js` — rebuilds `sitemap.xml`/`robots.txt`. Run last, after everything else.
- `validate-questions.js` — executes every question's SQL against a fresh in-memory SQLite DB, checks translations exist, checks tables have ≥5 rows, warns (doesn't fail) if `setup` has no literal NULL.
- `site-common.js` / `site-footer.js` — shared helpers (nav, footer, CSS extraction) used by the two generators above and by any one-off blog-post build script.
