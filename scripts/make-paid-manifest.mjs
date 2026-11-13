// Writes the paid edition's manifest.yml from the free one, so modules, scopes and resources
// never drift between the two apps. Only the app id, the page title and licensing differ.
//
//   node scripts/make-paid-manifest.mjs [outFile]   (default: overwrite ./manifest.yml)
import { readFileSync, writeFileSync } from 'node:fs';

// Strip a byte-order mark: some Windows editors add one, and JSON.parse rejects it.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^﻿/, '');
const edition = JSON.parse(read(process.env.PAID_EDITION_FILE ?? '../editions/paid.json'));
if (!/^ari:cloud:ecosystem::app\/[0-9a-f-]{36}$/.test(edition.appId ?? '')) {
  console.error('editions/paid.json has no valid appId yet. Register the paid app with `forge register` first.');
  process.exit(2);
}

const free = read('../manifest.yml');
let paid = free
  .replace(/^([ \t]+title:[ \t]*)Capacity Planner[ \t]*$/m, `$1${edition.title}`)
  .replace(/^([ \t]+id:[ \t]*)ari:cloud:ecosystem::app\/[0-9a-f-]+[ \t]*$/m, `$1${edition.appId}`);

if (!/^[ \t]+licensing:/m.test(paid)) {
  // Paid via Atlassian: Jira passes the site's licence to every resolver call.
  paid = paid.replace(/^app:[ \t]*$/m, 'app:\n  licensing:\n    enabled: true');
}
if (paid === free || !paid.includes(edition.appId) || !paid.includes(edition.title)) {
  console.error('Could not rewrite manifest.yml for the paid edition; check its title/id lines.');
  process.exit(1);
}

writeFileSync(process.argv[2] ?? new URL('../manifest.yml', import.meta.url), paid);
console.log(`Paid manifest written for ${edition.title} (${edition.appId}).`);
