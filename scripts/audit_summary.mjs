import fs from 'fs';
const rows = JSON.parse(fs.readFileSync('scripts/scraped-names.json'));
const cits = JSON.parse(fs.readFileSync('scripts/audit-citizenship.json'));
const ind = rows.filter(r => ['cambodian', 'curated'].includes(r.bucket) && r.qid && r.qid !== 'manual');
const byQ = {};
for (const r of ind) (byQ[r.qid] = byQ[r.qid] || []).push(r);
const KH = 'Q424';
const dom = [], foreign = [], missing = [];
for (const [q, rl] of Object.entries(byQ)) {
  const c = cits[q];
  if (!c) missing.push(rl);
  else if (c.includes(KH)) dom.push(rl);
  else foreign.push(rl);
}
const kmw = r => r.source === 'wikidata/kmwiki-humans';
const qids = a => [...new Set(a.flat().map(r => r.qid))].length;
const kmwRows = a => a.flat().filter(kmw).length;
console.log('bucket cambodian+curated:', ind.length, 'rows /', Object.keys(byQ).length, 'qids');
console.log('KH citizenship   :', dom.flat().length, 'rows /', qids(dom), 'qids');
console.log('no KH citizenship:', foreign.flat().length, 'rows /', qids(foreign), 'qids (kmwiki-humans rows:', kmwRows(foreign) + ')');
console.log('no P27 data      :', missing.flat().length, 'rows /', qids(missing), 'qids (kmwiki-humans rows:', kmwRows(missing) + ')');
console.log();
console.log('--- no-KH-citizenship rows ---');
for (const rl of foreign.sort((a, b) => a[0].khmer.localeCompare(b[0].khmer))) {
  const r = rl[0];
  console.log(r.khmer, '->', r.latin, '| cid=' + cits[r.qid].join(','), '|', r.source, '|', r.qid);
}
