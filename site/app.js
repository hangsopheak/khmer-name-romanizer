// Demo page logic. Every romanization comes from the library itself
// (./lib is the package's built dist/, copied in at deploy time).
// The only demo-side helper is a small Jaro-Winkler similarity, used where
// a real app would plug in its own fuzzy matcher (typos, screening).

const REPO = 'https://github.com/hangsopheak/khmer-name-romanizer'
const $ = (id) => document.getElementById(id)

// One retry: a dropped connection on a weak mobile network should not end the demo.
const loadLib = () => import('./lib/index.js')
let lib
try {
  lib = await loadLib().catch(() => new Promise((r) => setTimeout(r, 800)).then(() => import('./lib/index.js?retry=1')))
} catch (err) {
  const box = $('load-error')
  box.innerHTML = '<div class="load-error">The romanizer could not load. Reload the page. If it still fails, <a href="' + REPO + '/issues">report the problem</a>.</div>'
  box.hidden = false
  throw err
}
try {
  const v = await import('./lib/version.js')
  $('ver').textContent = 'v' + v.default
} catch { /* the version file exists only in the deployed build */ }

// ---------------------------------------------------------------- engine
const show = lib.createDefaultTransliterator({ maxCandidates: 8 })
const match = lib.createDefaultTransliterator({ maxCandidates: 10, flipOrderCandidates: true })

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const norm = (s) => s.toLowerCase().replace(/[^a-z]+/g, ' ').trim()
const sortWords = (s) => norm(s).split(' ').filter(Boolean).sort().join(' ')
const hasKhmer = (s) => /[ក-៿]/.test(s)
const RARE_SCORE = -3

/** Jaro-Winkler similarity in [0, 1]. Demo helper, not part of the library. */
function jaroWinkler(a, b) {
  if (a === b) return 1
  const la = a.length, lb = b.length
  if (!la || !lb) return 0
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1)
  const ma = new Array(la).fill(false), mb = new Array(lb).fill(false)
  let m = 0
  for (let i = 0; i < la; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(lb, i + range + 1); j++) {
      if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; m++; break }
    }
  }
  if (!m) return 0
  let t = 0, k = 0
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue
    while (!mb[k]) k++
    if (a[i] !== b[k]) t++
    k++
  }
  const jaro = (m / la + m / lb + (m - t / 2) / m) / 3
  let p = 0
  while (p < Math.min(4, la, lb) && a[p] === b[p]) p++
  return jaro + p * 0.1 * (1 - jaro)
}
/** Edit distance counting a swap of two neighbouring letters as one edit. */
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}
/** Name similarity that ignores word order. */
const nameSim = (a, b) => jaroWinkler(sortWords(a), sortWords(b))

/** Classify a Latin spelling against a Khmer name. */
function judge(khmer, latin) {
  const r = match.transliterate(khmer)
  const scored = r.scoredCandidates ?? r.candidates.map((value) => ({ value, score: 0 }))
  const i = scored.findIndex((c) => norm(c.value) === norm(latin))
  if (i >= 0) {
    const c = scored[i]
    const swapped = sortWords(c.value) === sortWords(r.value) && norm(c.value) !== norm(r.value)
    return { kind: c.score < RARE_SCORE ? 'rare' : 'ok', rank: i + 1, total: scored.length, score: c.score, spelling: c.value, swapped, best: r.value }
  }
  // A typo is one letter off a known spelling (any name order).
  let near = null
  for (const c of scored) {
    const dist = editDistance(sortWords(c.value), sortWords(latin))
    if (!near || dist < near.dist) near = { value: c.value, dist }
  }
  return { kind: near && near.dist <= 1 ? 'typo' : 'bad', near, best: r.value, total: scored.length }
}

/** Run fn on typing, but never in the middle of an input-method composition
 *  (Khmer keyboards on phones and some desktops compose characters). */
function onType(el, fn) {
  let composing = false
  const run = () => { try { fn() } catch (err) { console.error(err) } }
  el.addEventListener('compositionstart', () => { composing = true })
  el.addEventListener('compositionend', () => { composing = false; run() })
  el.addEventListener('input', (e) => { if (!composing && !e.isComposing) run() })
}

function flash(el, msg) {
  el.textContent = msg; el.hidden = false
  clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true }, 1800)
}
async function copyText(text, noticeEl, msg) {
  try { await navigator.clipboard.writeText(text); flash(noticeEl, msg) }
  catch { flash(noticeEl, 'Copy failed. Select the text and copy it yourself.') }
}
// ---------------------------------------------------------------- Latin → Khmer helper
// Typing Khmer is hard without a Khmer keyboard. This reads the library's
// own dictionary backwards: type "hang sopheak", pick the Khmer word for each.
const latinKey = (s) => s.toLowerCase().replace(/[^a-z]/g, '')
const khmerKey = (kh) => lib.normalizeKhmerKey(kh.replace(/[\u200B-\u200D\uFEFF]/g, ''))
const reverse = new Map()
for (const [kh, e] of Object.entries(lib.defaultTokenDict)) {
  const add = (lat, w) => {
    const k = latinKey(lat); if (!k) return
    if (!reverse.has(k)) reverse.set(k, [])
    reverse.get(k).push({ kh, w })
  }
  add(e.latin, e.count + 3)
  for (const [v, c] of Object.entries(e.variants ?? {})) add(v, c)
}
const reverseKeys = [...reverse.keys()].sort()

/** Khmer words for one Latin word: exact spellings first, else words that start with it. */
function khmerOptions(word) {
  const k = latinKey(word)
  if (!k) return { opts: [], exact: false }
  let opts = (reverse.get(k) ?? []).map((o) => ({ ...o, lat: '' }))
  const exact = opts.length > 0
  if (!exact && k.length >= 2) {
    opts = reverseKeys.filter((x) => x.startsWith(k)).flatMap((x) => reverse.get(x).map((o) => ({ ...o, lat: x })))
  }
  opts.sort((a, b) => b.w - a.w)
  const seen = new Set(), out = []
  for (const o of opts) {
    const key = khmerKey(o.kh)
    if (seen.has(key)) continue
    seen.add(key); out.push(o)
    if (out.length >= 6) break
  }
  return { opts: out, exact }
}

/** Adds "No Khmer keyboard? Type it in Latin letters" under a Khmer input. */
function attachLatinHelper(input, onChange, { open = false } = {}) {
  const box = document.createElement('details')
  box.className = 'latin-helper'
  box.open = open
  const uid = input.id + '-latin'
  box.innerHTML = `<summary>No Khmer keyboard? Type the name in Latin letters</summary>
    <div class="lh-body">
      <input type="text" id="${uid}" autocomplete="off" spellcheck="false" placeholder="e.g. hang sopheak" aria-label="Name in Latin letters">
      <div class="lh-words"></div>
      <p class="hint">Pick the Khmer spelling of each word. It goes into the Khmer box above.</p>
    </div>`
  input.closest('.field').after(box)
  const lat = box.querySelector('input'), wordsEl = box.querySelector('.lh-words')
  let words = [], picks = []

  const compose = () => {
    const kh = words.map((w, i) => w.opts[picks[i]]?.kh).filter(Boolean).join(' ')
    input.value = kh
    try { onChange() } catch (err) { console.error(err) }
  }
  const draw = () => {
    wordsEl.innerHTML = words.map((w, i) => {
      if (!w.opts.length) return `<div class="lh-word"><span class="w">${esc(w.text)}</span><span class="hint">No Khmer word found. Check the spelling. The word may not be in the dictionary yet.</span></div>`
      return `<div class="lh-word"><span class="w">${esc(w.text)}</span>` + w.opts.map((o, j) =>
        `<button type="button" class="chip kh-opt${j === picks[i] ? ' on' : ''}" data-i="${i}" data-j="${j}" lang="km">${esc(o.kh)}${o.lat ? `<small>${esc(o.lat)}</small>` : ''}</button>`).join('') + '</div>'
    }).join('')
  }
  const update = () => {
    const texts = lat.value.trim().split(/\s+/).filter(Boolean)
    const prev = words
    words = texts.map((text, i) => prev[i]?.text === text ? prev[i] : { text, ...khmerOptions(text) })
    picks = words.map((w, i) => prev[i] === w ? picks[i] : 0)
    draw()
    if (words.length) compose()
  }
  lat.addEventListener('input', update)
  wordsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.kh-opt'); if (!b) return
    picks[+b.dataset.i] = +b.dataset.j
    draw(); compose()
  })
}

const csvCell = (s) => /[",\n]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s)

// ---------------------------------------------------------------- tabs
const UCS = ['lookup', 'prefill', 'validate', 'audit', 'link', 'screen', 'search', 'bulk']
function route() {
  const h = location.hash.slice(1)
  if (h === 'install') return
  const uc = UCS.includes(h) ? h : 'lookup'
  document.querySelectorAll('[data-uc]').forEach((s) => { s.hidden = s.dataset.uc !== uc })
  document.querySelectorAll('.tab').forEach((a) => {
    const on = a.getAttribute('href') === '#' + uc
    if (on) { a.setAttribute('aria-current', 'page'); a.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
    else a.removeAttribute('aria-current')
  })
}
window.addEventListener('hashchange', route)

// ---------------------------------------------------------------- 1. look up
let current = null

function mrzLine(value) {
  const words = value.toUpperCase().replace(/[^A-Z ]+/g, '').split(/\s+/).filter(Boolean)
  const [sur = '', ...given] = words
  return ('P<KHM' + sur + '<<' + given.join('<') + '<'.repeat(44)).slice(0, 44)
}

function renderLookup() {
  const q = $('q').value.trim()
  if (!q || !hasKhmer(q)) {
    current = null
    $('surname').textContent = '—'
    $('given').textContent = '—'
    $('khname').textContent = q ? 'Type the name in Khmer script' : 'Type a name above'
    $('mrz').textContent = 'P<KHM' + '<'.repeat(39)
    $('cands').innerHTML = '<li class="empty" style="display:block">Suggestions appear here as you type.</li>'
    $('words').innerHTML = '<p class="empty">Each word of the name, and where its spelling came from.</p>'
    $('titles').hidden = true
    updateReport()
    return
  }
  const r = show.transliterate(q)
  current = { q, r }
  const [sur = '', ...given] = r.value.split(/\s+/)
  $('surname').textContent = sur || '—'
  $('given').textContent = given.join(' ') || '—'
  $('khname').textContent = q
  $('mrz').textContent = mrzLine(r.value)
  if (r.honorifics?.length) { $('titles').textContent = 'Title removed: ' + r.honorifics.join(' '); $('titles').hidden = false }
  else $('titles').hidden = true

  const scored = r.scoredCandidates ?? r.candidates.map((value) => ({ value, score: 0 }))
  $('cands').innerHTML = scored.map((c, i) => {
    const pct = Math.max(2, Math.round(Math.exp(c.score) * 100))
    return `<li class="${i === 0 ? 'top' : ''}">
      <span class="rank">${i + 1}</span>
      <span class="cand">${esc(c.value)}</span>
      <span class="bar" title="${pct}%"><i style="width:${pct}%"></i></span>
      <span class="score" title="log-probability score">${c.score === 0 ? '0' : c.score.toFixed(2)}</span>
    </li>`
  }).join('')

  $('words').innerHTML = r.tokens.map((t) => {
    const known = t.source === 'tokenDict'
    const alts = t.alternatives.length ? 'Also: ' + t.alternatives.map(esc).join(', ') : 'No other spellings seen'
    return `<div class="word">
      <span class="kh" lang="km">${esc(t.khmer)}</span>
      <span class="lat">${esc(t.latin)}</span>
      <div class="meta">
        <span class="pill ${known ? 'dict' : 'rules'}">${known ? 'Known name word' : 'New word, read by rules'}</span>
        <span>${alts}</span>
      </div>
    </div>`
  }).join('')
  updateReport()
}

function updateReport() {
  const official = $('official').value.trim()
  const q = current?.q ?? $('q').value.trim()
  const title = `Spelling: ${q || '(name)'} → ${official || '?'}`
  const body = [
    `**Khmer name:** ${q}`,
    `**Official Latin spelling:** ${official}`,
    `**Source (ID, diploma, roster…):** `,
    '',
    `Demo suggested: ${current ? current.r.candidates.join(' · ') : '—'}`,
  ].join('\n')
  $('report').href = `${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
}

onType($('q'), renderLookup)
onType($('official'), updateReport)
$('copy').addEventListener('click', () => current && copyText(current.r.value, $('copied'), 'Name copied'))
$('share').addEventListener('click', () => {
  const url = new URL(location.pathname, location.origin)
  if (current) url.searchParams.set('q', current.q)
  url.hash = 'lookup'
  copyText(url.href, $('copied'), 'Link copied')
})
$('q-clear').addEventListener('click', () => { $('q').value = ''; renderLookup(); $('q').focus() })
$('q-chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return
  $('q').value = b.dataset.q; renderLookup()
})

// ---------------------------------------------------------------- 2. pre-fill
let pfEdited = false
function renderPrefill() {
  const kh = $('pf-kh').value.trim()
  const sugg = $('pf-sugg')
  $('pf-out').hidden = true
  if (!kh || !hasKhmer(kh)) {
    if (!pfEdited) $('pf-lat').value = ''
    sugg.innerHTML = '<span>Suggestions appear as you type the Khmer name.</span>'
    return
  }
  const r = show.transliterate(kh)
  if (!pfEdited) $('pf-lat').value = r.value
  const cur = norm($('pf-lat').value)
  sugg.innerHTML = '<span>Suggestions:</span>' + r.candidates.slice(0, 5).map((c) =>
    `<button class="chip pick${norm(c) === cur ? ' on' : ''}" type="button" data-v="${esc(c)}">${esc(c)}</button>`).join('')
}
onType($('pf-kh'), renderPrefill)
onType($('pf-lat'), () => { pfEdited = $('pf-lat').value.trim() !== ''; renderPrefill() })
$('pf-sugg').addEventListener('click', (e) => {
  const b = e.target.closest('.chip.pick'); if (!b) return
  $('pf-lat').value = b.dataset.v; pfEdited = true; renderPrefill()
})
$('pf-ok').addEventListener('change', () => { $('pf-out').hidden = true })
$('pf-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const out = $('pf-out')
  const kh = $('pf-kh').value.trim(), lat = $('pf-lat').value.trim()
  out.hidden = false
  if (!kh || !lat) { out.className = 'verdict bad'; out.innerHTML = '<b>Fill in both names.</b>'; return }
  if (!$('pf-ok').checked) { out.className = 'verdict warn'; out.innerHTML = '<b>Ask the student to confirm the spelling first.</b><span class="sub">Only they know which spelling is on their ID.</span>'; return }
  const inList = show.transliterate(kh).candidates.some((c) => norm(c) === norm(lat))
  out.className = 'verdict ok'
  out.innerHTML = `<b>Saved:</b> <span lang="km">${esc(kh)}</span> → ${esc(lat)}` +
    (inList ? '' : '<span class="sub">This spelling is not among the suggestions. That is fine because the student confirmed it.</span>') +
    '<span class="sub">Example form. Nothing was sent anywhere.</span>'
})

// ---------------------------------------------------------------- 3. validate
function renderValidate() {
  const kh = $('v-kh').value.trim(), lat = $('v-lat').value.trim()
  const out = $('v-out')
  if (!kh || !lat || !hasKhmer(kh)) { out.hidden = true; return }
  const j = judge(kh, lat)
  out.hidden = false
  if (j.kind === 'ok') {
    out.className = 'verdict ok'
    out.innerHTML = `<b>Match. Accept.</b><span class="sub">“${esc(j.spelling)}” is spelling ${j.rank} of ${j.total}${j.swapped ? ', with the given name first' : ''}. Score ${j.score.toFixed(2)}.</span>`
  } else if (j.kind === 'rare') {
    out.className = 'verdict warn'
    out.innerHTML = `<b>Match, but a rare spelling. Accept, or confirm with the customer.</b><span class="sub">“${esc(j.spelling)}” is spelling ${j.rank} of ${j.total}. Score ${j.score.toFixed(2)}. The usual spelling is ${esc(j.best)}.</span>`
  } else if (j.kind === 'typo') {
    out.className = 'verdict warn'
    out.innerHTML = `<b>Close, but not a known spelling. Send to review.</b><span class="sub">One letter away from ${esc(j.near.value)}. Probably a typo.</span>`
  } else {
    out.className = 'verdict bad'
    out.innerHTML = `<b>No match. Send to review.</b><span class="sub">None of the ${j.total} spellings is close. Expected something like ${esc(j.best)}. It may be a different person, or a spelling the dictionary has not seen yet.</span>`
  }
}
onType($('v-kh'), renderValidate)
onType($('v-lat'), renderValidate)
$('v-chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return
  $('v-kh').value = b.dataset.kh; $('v-lat').value = b.dataset.lat; renderValidate()
})

// ---------------------------------------------------------------- 4. audit
const AUDIT_SAMPLE = [
  ['ចាន់ ដារា', 'CHAN DARA'],
  ['កែវ សុផល', 'KEO SOPHAL'],
  ['ហេង រតនា', 'HENG RATANA'],
  ['ម៉ៅ វិចិត្រ', 'MAO VICHEAT'],
  ['ឈឹម សុភា', 'SOPHEA CHHIM'],
  ['ព្រំ បុប្ផា', 'PROM BOPHA'],
  ['សៀង ស្រីមុំ', 'SEANG SREYMOM'],
  ['យឹម ពិសិដ្ឋ', 'KONG VEASNA'],
  ['ឡុង ចិន្តា', 'LONG CHENDA'],
  ['ពេជ្រ មុន្នី', 'PECH MONI'],
  ['ទេព សុធា', 'TEP SOHTEA'],
  ['គង់ វាសនា', 'KUNG VEASNA'],
]
const AUDIT_LABEL = { ok: 'Matches', rare: 'Rare spelling', typo: 'Likely typo', bad: 'Mismatch' }
let auditResults = []

function parseRecords(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.search(/[,\t;]/)
    return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]
  })
}

function renderAudit(records) {
  auditResults = records.map(([kh, lat]) => {
    if (!kh || !lat || !hasKhmer(kh)) return { kh, lat, j: { kind: 'bad', invalid: true } }
    return { kh, lat, j: judge(kh, lat) }
  })
  const counts = { ok: 0, rare: 0, typo: 0, bad: 0 }
  auditResults.forEach((r) => counts[r.j.kind]++)
  const plural = { ok: ['match', 'matches'], rare: ['rare spelling', 'rare spellings'], typo: ['likely typo', 'likely typos'], bad: ['mismatch', 'mismatches'] }
  $('au-sum').innerHTML = Object.entries(counts).map(([k, n]) => `<span class="pill ${k}">${n} ${plural[k][n === 1 ? 0 : 1]}</span>`).join('')
  $('au-rows').innerHTML = auditResults.map((r, i) => {
    const j = r.j
    let why = ''
    if (j.invalid) why = 'Needs a Khmer name and a Latin name.'
    else if (j.kind === 'ok') why = j.swapped ? 'Given name first' : (j.rank > 1 ? `Spelling ${j.rank} of ${j.total}` : '')
    else if (j.kind === 'rare') why = `Usual spelling: ${esc(j.best)}`
    else if (j.kind === 'typo') why = `Did they mean ${esc(j.near.value)}?`
    else why = `Expected something like ${esc(j.best)}`
    return `<tr>
      <td class="rank">${i + 1}</td>
      <td class="kh" lang="km">${esc(r.kh)}</td>
      <td class="lat">${esc(r.lat)}</td>
      <td><span class="pill ${j.kind}">${AUDIT_LABEL[j.kind]}</span>${why ? `<span class="why">${why}</span>` : ''}</td>
    </tr>`
  }).join('')
}
$('au-in').value = AUDIT_SAMPLE.map(([k, l]) => `${k}, ${l}`).join('\n')
$('au-run').addEventListener('click', () => renderAudit(parseRecords($('au-in').value)))
$('au-copy').addEventListener('click', () => {
  const lines = [['khmer', 'latin', 'result', 'suggestion'].join(',')]
  for (const r of auditResults) lines.push([r.kh, r.lat, AUDIT_LABEL[r.j.kind], r.j.near?.value ?? r.j.best ?? ''].map(csvCell).join(','))
  copyText(lines.join('\n'), $('au-copied'), 'CSV copied')
})

// ---------------------------------------------------------------- 5. link
const LINK_SAMPLE_KH = 'ឈឹម សុភា'
const LINK_SAMPLE = ['CHHIM SOPHEA', 'Sophea Chhim', 'CHHOEM SOPHEA', 'Chhim Sopea', 'KEO SOPHEA', 'CHHIM SOKHA']

function renderLink() {
  const kh = $('l-kh').value.trim()
  const recs = $('l-recs').value.split('\n').map((s) => s.trim()).filter(Boolean)
  const out = $('l-out')
  if (!kh || !hasKhmer(kh)) { out.innerHTML = '<li class="empty" style="display:block">Type the Khmer name of the record in system A.</li>'; return }
  if (!recs.length) { out.innerHTML = '<li class="empty" style="display:block">Add Latin records, one per line.</li>'; return }
  out.innerHTML = recs.map((rec) => {
    const j = judge(kh, rec)
    let pill, why
    if (j.kind === 'ok' || j.kind === 'rare') {
      pill = '<span class="pill ok">Same person</span>'
      why = j.swapped ? 'Same name, given name written first.' : (j.rank === 1 ? 'Same as the usual spelling.' : `Same name, spelled the other common way (spelling ${j.rank}).`)
    } else if (j.kind === 'typo') {
      pill = '<span class="pill typo">Possible</span>'
      why = `One letter away from ${esc(j.near.value)}. Probably a typo, but a person should check.`
    } else {
      pill = '<span class="pill bad">Different</span>'
      why = 'No spelling of this name comes close.'
    }
    return `<li><span class="name">${esc(rec)}</span>${pill}<span class="why">${why}</span></li>`
  }).join('')
}
onType($('l-kh'), renderLink)
onType($('l-recs'), renderLink)

// ---------------------------------------------------------------- 6. screen
const WATCHLIST = ['CHHOEM SOPHEA', 'SOU PAGNA', 'NGUON SOVAN', 'LIM CHANTHA', 'MEAS VANNA', 'TOUCH RATHA']
const SCREEN_MIN = 0.92

function renderScreen() {
  const kh = $('s-kh').value.trim()
  const list = $('s-list').value.split('\n').map((s) => s.trim()).filter(Boolean)
  const out = $('s-out'), call = $('s-callout')
  call.hidden = true
  if (!kh || !hasKhmer(kh)) { out.innerHTML = '<li class="empty" style="display:block">Type a customer name in Khmer.</li>'; return }
  const cands = match.transliterate(kh).candidates
  const hits = []
  for (const entry of list) {
    let best = null
    cands.forEach((c, i) => {
      const s = nameSim(c, entry)
      if (!best || s > best.sim + 1e-9) best = { sim: s, spelling: c, rank: i + 1 }
    })
    if (best && best.sim >= SCREEN_MIN) {
      const topOnly = nameSim(cands[0], entry)
      hits.push({ entry, ...best, topOnly })
    }
  }
  hits.sort((a, b) => b.sim - a.sim)
  if (!hits.length) {
    out.innerHTML = `<li class="empty" style="display:block">No hits. Checked ${cands.length} spellings against ${list.length} watchlist names.</li>`
    return
  }
  out.innerHTML = hits.map((h) => `<li>
    <span class="name">${esc(h.entry)}</span>
    <span class="pill ${h.sim >= 0.999 ? 'bad' : 'typo'}">${h.sim >= 0.999 ? 'Exact hit' : Math.round(h.sim * 100) + '% similar'}</span>
    <span class="why">Found through spelling ${h.rank}: <mark>${esc(h.spelling)}</mark></span>
  </li>`).join('')
  const missed = hits.filter((h) => h.topOnly < SCREEN_MIN)
  if (missed.length) {
    call.hidden = false
    call.innerHTML = `<b>Screening only the first guess, “${esc(cands[0])}”, would miss ${missed.length === 1 ? 'this hit' : 'these ' + missed.length + ' hits'}.</b> That is why every spelling should go to the matcher.`
  }
}
$('s-list').value = WATCHLIST.join('\n')
onType($('s-kh'), renderScreen)
onType($('s-list'), renderScreen)
$('s-chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return
  $('s-kh').value = b.dataset.q; renderScreen()
})

// ---------------------------------------------------------------- 7. quick search
// Made-up contacts: common surnames x common given names, in a fixed order.
const SURNAMES = 'ហង្ស សូ ចាន់ សុខ កែវ ហេង លី ម៉ៅ ឈឹម ព្រំ សៀង យឹម ឡុង ទេព ពេជ្រ ជា អ៊ុំ គង់ មាស តាំង ស៊ុន ឯក ខៀវ'.split(' ')
const GIVEN = 'សុភ័ក្រ្ត បញ្ញា ដារា សុខា សុផល រតនា វិចិត្រ សុភា បុប្ផា ស្រីមុំ ពិសិដ្ឋ ចិន្តា សុធា មុន្នី វណ្ណៈ វាសនា សុភាព សុវណ្ណ លាងខៃ សោភា រស្មី សុជាតា ពិសី វិបុល'.split(' ')
function makeContacts(n) {
  let seed = 7
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647
  const set = new Set(['ហង្ស សុភ័ក្រ្ត', 'ចាន់ ដារា', 'សូ បញ្ញា'])
  while (set.size < n) set.add(SURNAMES[Math.floor(rnd() * SURNAMES.length)] + ' ' + GIVEN[Math.floor(rnd() * GIVEN.length)])
  return [...set]
}
const t0 = performance.now()
const contactIndex = makeContacts(240).map((kh) => {
  const r = show.transliterate(kh)
  return {
    kh, value: r.value,
    tokens: r.tokens.map((tk) => ({
      khmer: tk.khmer,
      primary: norm(tk.latin).replace(/ /g, ''),
      spellings: [tk.latin, ...tk.alternatives].map((x) => norm(x).replace(/ /g, '')),
    })),
  }
}).sort((a, b) => a.value.localeCompare(b.value))
const indexMs = performance.now() - t0

/** How well one typed term matches one word: 4 exact, 3 prefix, 2 other spelling, 1 typo. */
function termMatch(term, tok, allowTypo) {
  if (hasKhmer(term)) return tok.khmer.includes(term) ? { score: 4 } : null
  if (tok.primary === term) return { score: 4 }
  if (tok.primary.startsWith(term)) return { score: 3 }
  const alt = tok.spellings.find((x) => x.startsWith(term))
  if (alt) return { score: 2, alt }
  if (allowTypo && term.length >= 4) {
    for (const x of tok.spellings) {
      if (editDistance(term, x) <= 1 || editDistance(term, x.slice(0, term.length)) <= 1) return { score: 1, typo: x }
    }
  }
  return null
}

function searchContacts(query, allowTypo = false) {
  const terms = hasKhmer(query)
    ? query.trim().split(/\s+/).filter(Boolean)
    : norm(query).split(' ').filter(Boolean)
  if (!terms.length) return null
  const out = []
  for (const c of contactIndex) {
    const used = new Set(), how = []
    let total = 0, ok = true
    for (const term of terms) {
      let best = null
      c.tokens.forEach((tok, i) => {
        if (used.has(i)) return
        const m = termMatch(term, tok, allowTypo)
        if (m && (!best || m.score > best.m.score)) best = { i, m }
      })
      if (!best) { ok = false; break }
      used.add(best.i); total += best.m.score; how.push(best.m)
    }
    if (ok) out.push({ c, total, used, how })
  }
  return out.sort((a, b) => b.total - a.total || a.c.value.localeCompare(b.c.value))
}

function contactRow(c, used = new Set(), how = []) {
  const kh = c.tokens.map((tk, i) => used.has(i) ? `<mark>${esc(tk.khmer)}</mark>` : esc(tk.khmer)).join(' ')
  const tags = []
  for (const m of how) {
    if (m.alt) tags.push(`<span class="tag">spelled ${esc(m.alt)}</span>`)
    else if (m.typo) tags.push(`<span class="tag">typo of ${esc(m.typo)}</span>`)
  }
  return `<li><span class="avatar" lang="km">${esc([...c.tokens[0].khmer][0])}</span>
    <span class="kh" lang="km">${kh}</span>
    <span class="lat"><b>${esc(c.value)}</b>${tags.join('')}</span></li>`
}

const LIST_LIMIT = 40
function renderSearch() {
  const q = $('sr-q').value
  const out = $('sr-out'), meta = $('qs-meta')
  $('qs-total').textContent = `${contactIndex.length} contacts`
  const t = performance.now()
  // Typo tolerance is a fallback: Sopheap is a different name from Sopheak,
  // so close spellings show only when nothing matches exactly.
  let hits = searchContacts(q), fuzzy = false
  if (hits && !hits.length) { hits = searchContacts(q, true); fuzzy = true }
  const ms = performance.now() - t
  if (!hits) {
    meta.textContent = `Index built in ${indexMs.toFixed(0)} ms. Start typing.`
    out.innerHTML = contactIndex.slice(0, LIST_LIMIT).map((c) => contactRow(c)).join('') +
      `<li class="more">and ${contactIndex.length - LIST_LIMIT} more</li>`
    return
  }
  meta.textContent = (fuzzy && hits.length ? 'No exact match. Close spellings: ' : '') + `${hits.length} found in ${ms < 0.1 ? 'under 0.1' : ms.toFixed(1)} ms`
  if (!hits.length) { out.innerHTML = '<li class="none">No contact matches. Try another spelling.</li>'; return }
  out.innerHTML = hits.slice(0, LIST_LIMIT).map((h) => contactRow(h.c, h.used, h.how)).join('') +
    (hits.length > LIST_LIMIT ? `<li class="more">and ${hits.length - LIST_LIMIT} more</li>` : '')
}
onType($('sr-q'), renderSearch)
$('sr-chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return
  $('sr-q').value = b.dataset.q; renderSearch()
})

// ---------------------------------------------------------------- 8. bulk
const BULK_SAMPLE = ['ចាន់ ដារា', 'ជា វណ្ណៈ', 'ហេង រតនា', 'សុខ ចន្ទា', 'ពេជ្រ មុន្នី', 'ងួន សុវណ្ណ', 'អ៊ុំ ច័ន្ទតារា', 'តាន់ ហុកហ៊ី']
const CONF_LABEL = { ok: 'High', rare: 'Check', bad: 'Review' }
let bulkRows = []

function confidence(r) {
  if (r.source === 'rules') return 'bad'
  const top = r.scoredCandidates?.[0]?.score ?? 0
  return top >= -0.7 ? 'ok' : 'rare'
}
function renderBulk() {
  const names = $('b-in').value.split('\n').map((s) => s.trim()).filter(Boolean)
  bulkRows = names.map((kh) => {
    if (!hasKhmer(kh)) return { kh, latin: '', conf: 'bad', why: 'Not Khmer script' }
    const r = show.transliterate(kh)
    const conf = confidence(r)
    const why = conf === 'bad'
      ? 'New word: ' + r.tokens.filter((t) => t.source === 'rules').map((t) => t.khmer).join(', ')
      : conf === 'rare' ? 'Also common: ' + r.candidates.slice(1, 3).join(', ') : ''
    return { kh, latin: r.value, conf, why }
  })
  const counts = { ok: 0, rare: 0, bad: 0 }
  bulkRows.forEach((r) => counts[r.conf]++)
  $('b-sum').innerHTML = `<span class="pill ok">${counts.ok} high</span><span class="pill rare">${counts.rare} to check</span><span class="pill bad">${counts.bad} to review</span>`
  $('b-rows').innerHTML = bulkRows.length
    ? bulkRows.map((r) => `<tr>
        <td class="kh" lang="km">${esc(r.kh)}</td>
        <td class="lat">${esc(r.latin) || '—'}</td>
        <td><span class="pill ${r.conf}">${CONF_LABEL[r.conf]}</span>${r.why ? `<span class="why" ${r.conf === 'bad' ? 'lang="km"' : ''}>${esc(r.why)}</span>` : ''}</td>
      </tr>`).join('')
    : '<tr><td colspan="3" class="empty">Add Khmer names above, one per line.</td></tr>'
}
$('b-in').value = BULK_SAMPLE.join('\n')
onType($('b-in'), renderBulk)
$('b-copy').addEventListener('click', () => {
  const lines = [['khmer', 'latin', 'confidence'].join(',')]
  for (const r of bulkRows) lines.push([r.kh, r.latin, CONF_LABEL[r.conf]].map(csvCell).join(','))
  copyText(lines.join('\n'), $('b-copied'), 'CSV copied')
})

// ---------------------------------------------------------------- start
const initial = new URLSearchParams(location.search).get('q')
$('q').value = initial ?? 'ហង្ស សុភ័ក្រ្ត'
$('pf-kh').value = 'ហង្ស សុភ័ក្រ្ត'
$('v-kh').value = 'ហង្ស សុភ័ក្រ្ត'; $('v-lat').value = 'SOPHEAK HANG'
$('l-kh').value = LINK_SAMPLE_KH; $('l-recs').value = LINK_SAMPLE.join('\n')
$('s-kh').value = 'ឈឹម សុភា'
$('sr-q').value = 'sopheak'

attachLatinHelper($('q'), renderLookup, { open: true })
attachLatinHelper($('pf-kh'), renderPrefill)
attachLatinHelper($('v-kh'), renderValidate)
attachLatinHelper($('l-kh'), renderLink)
attachLatinHelper($('s-kh'), renderScreen)

for (const fn of [renderLookup, renderPrefill, renderValidate, () => renderAudit(AUDIT_SAMPLE), renderLink, renderScreen, renderSearch, renderBulk]) {
  try { fn() } catch (err) { console.error(err) }
}
route()
