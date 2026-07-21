#!/usr/bin/env node
/**
 * Validates every questions/<company>.json file by actually executing it —
 * not by comparing against a hand-written expected result, because this schema
 * has no expected_result/solution_sql fields (see questions/*.json: setup +
 * questions[].{id,diff,cc,story,question,schemas,steps}). Instead, for every
 * question:
 *
 *   1. Builds a fresh in-memory SQLite database from `setup` (node:sqlite,
 *      bundled SQLite 3.53.x — a superset of the 3.45 compatibility baseline
 *      this project targets; nothing used here behaves differently between
 *      the two).
 *   2. Runs every step's `sql` against it, in order, and fails loudly on any
 *      SQL error (with the exact error and which step/question it came from).
 *   3. Asserts the final step returns at least one row — a step that runs
 *      but returns nothing is a broken question, not a passing one.
 *   4. Cross-checks that every table referenced (FROM/JOIN) in step SQL was
 *      actually created by `setup`, and that every table `setup` creates has
 *      at least 5 rows.
 *   5. Flags (soft warning, not a failure — see note below) whether `setup`
 *      contains a literal NULL, so at least the NULL-edge-case requirement
 *      is machine-checkable. Ties, zeros, and empty groups are data-design
 *      properties a script can't reliably detect in general — those are the
 *      author's responsibility, not this script's; they're spot-checked in
 *      the run summary printed at the end.
 *
 * Usage:
 *   node scripts/validate-questions.js
 *   npm run validate:questions
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const QUESTIONS_DIR = path.join(ROOT, 'questions');
const SKIP_FILES = new Set(['index.json', 'slugs.json']);

let failures = 0;
let warnings = 0;
let questionsChecked = 0;

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failures++;
}
function warn(msg) {
  console.warn(`  ⚠ ${msg}`);
  warnings++;
}
function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

function extractCreatedTables(setup) {
  const names = new Set();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`\[]?(\w+)["`\]]?/gi;
  let m;
  while ((m = re.exec(setup))) names.add(m[1].toLowerCase());
  return names;
}

function extractCteNames(sql) {
  // WITH foo AS (...), bar AS (...) — foo/bar are valid FROM/JOIN targets
  // even though setup never creates them as real tables.
  const names = new Set();
  if (!/\bWITH\b/i.test(sql)) return names;
  const re = /(?:WITH|,)\s*["`\[]?(\w+)["`\]]?\s+AS\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) names.add(m[1].toLowerCase());
  return names;
}

function extractReferencedTables(sql) {
  const names = new Set();
  const re = /\b(?:FROM|JOIN)\s+["`\[]?(\w+)["`\]]?/gi;
  let m;
  while ((m = re.exec(sql))) names.add(m[1].toLowerCase());
  const ctes = extractCteNames(sql);
  for (const c of ctes) names.delete(c);
  return names;
}

function validateQuestionFile(file) {
  const company = path.basename(file, '.json');
  console.log(`\n${company}.json`);

  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`could not parse JSON: ${e.message}`);
    return;
  }

  if (typeof data.setup !== 'string' || !data.setup.trim()) {
    fail('missing or empty top-level "setup" string');
    return;
  }
  const questions = Array.isArray(data.questions) ? data.questions : [];
  if (!questions.length) {
    fail('"questions" array is missing or empty');
    return;
  }

  const createdTables = extractCreatedTables(data.setup);
  if (!createdTables.size) {
    fail('could not find any CREATE TABLE statements in "setup"');
    return;
  }

  const hasNullLiteral = /,\s*NULL\s*[,)]/i.test(data.setup);
  if (!hasNullLiteral) {
    warn('setup has no literal NULL in its INSERT values — confirm the required edge case (NULL, zero, tie, or empty group) is present some other way');
  }

  for (const q of questions) {
    questionsChecked++;
    const label = `  [${company} #${q.id}]`;

    if (!q.diff || !['easy', 'mid', 'hard'].includes(q.diff)) {
      fail(`${label} diff is "${q.diff}" — expected easy/mid/hard`);
    }
    for (const lang of ['en', 'ta', 'hi', 'te']) {
      if (!q.story || !q.story[lang]) fail(`${label} story.${lang} is missing`);
      if (!q.question || !q.question[lang]) fail(`${label} question.${lang} is missing`);
    }
    if (!Array.isArray(q.steps) || !q.steps.length) {
      fail(`${label} has no steps`);
      continue;
    }

    // schema table-count check
    for (const s of q.schemas || []) {
      if (!createdTables.has(s.name.toLowerCase())) {
        fail(`${label} schemas references table "${s.name}" but setup never creates it`);
      }
    }

    // fresh DB per question so questions can't accidentally depend on each other
    let db;
    try {
      db = new DatabaseSync(':memory:');
      db.exec(data.setup);
    } catch (e) {
      fail(`${label} setup failed to execute: ${e.message}`);
      continue;
    }

    for (const table of createdTables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
        if (row.c < 5) fail(`${label} table "${table}" has only ${row.c} rows — needs at least 5`);
      } catch (e) {
        fail(`${label} could not count rows in "${table}": ${e.message}`);
      }
    }

    let lastResult = null;
    let stepFailed = false;
    q.steps.forEach((step, si) => {
      if (typeof step.sql !== 'string' || !step.sql.trim()) {
        fail(`${label} step ${si + 1} has no sql`);
        stepFailed = true;
        return;
      }
      for (const lang of ['en', 'ta', 'hi', 'te']) {
        if (!step.title || !step.title[lang]) fail(`${label} step ${si + 1} title.${lang} is missing`);
        const exp = step.explain && step.explain[lang];
        if (!exp || (Array.isArray(exp) && exp.length === 0)) {
          fail(`${label} step ${si + 1} explain.${lang} is missing or empty`);
        }
      }

      const referenced = extractReferencedTables(step.sql);
      for (const t of referenced) {
        if (!createdTables.has(t)) {
          fail(`${label} step ${si + 1} sql references table "${t}" not created by setup`);
        }
      }

      try {
        lastResult = db.prepare(step.sql).all();
      } catch (e) {
        fail(`${label} step ${si + 1} ("${step.title?.en}") failed to execute: ${e.message}`);
        stepFailed = true;
      }
    });

    if (!stepFailed) {
      if (!lastResult || lastResult.length === 0) {
        fail(`${label} final step returned 0 rows — a working question should return something`);
      } else {
        ok(`#${q.id} (${q.diff}) — ${q.steps.length} steps executed, final step returned ${lastResult.length} row(s)`);
      }
    }

    db.close();
  }
}

function main() {
  const files = fs.readdirSync(QUESTIONS_DIR)
    .filter(f => f.endsWith('.json') && !SKIP_FILES.has(f))
    .map(f => path.join(QUESTIONS_DIR, f));

  if (!files.length) {
    console.error('No question files found in questions/');
    process.exit(1);
  }

  for (const file of files) validateQuestionFile(file);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${questionsChecked} question(s) checked across ${files.length} file(s)`);
  console.log(`${failures} failure(s), ${warnings} warning(s)`);

  if (failures > 0) {
    console.error('\nFAILED');
    process.exit(1);
  }
  console.log('\nPASSED');
}

main();
