/* Overview: pipeline rail (funnel bar from opened jobs to offer) and the
   labels that move under the bar when a part is too narrow. */
/* Pipeline rail: one bar, to scale, where the full width is every opened job.
   Parts: not in English | in English, not matched | AI matched
   (Applied inside it, Got interview inside Applied, Offer inside interview).
   Volume slices (through Applied) are a share of opened jobs. Got interview
   and Offer are conversion from Applied, not from opened. Offer stays at 0. */
export function sizeFunnelRail(funnel) {
  const opened = Number(funnel.title_clicked) || 0;
  const german = Number(funnel.german_filtered) || 0;
  const matched = Number(funnel.ai_matched) || 0;
  const applied = Number(funnel.applied) || 0;
  const appliedSlice = Math.min(applied, matched);
  const interviewed = Math.min(Number(funnel.interviewed) || 0, applied);
  const offer = Math.min(Number(funnel.offer) || 0, applied);
  // Manually logged / API jobs can push "matched" past the English count:
  // clamp so the parts never go negative, and scale to their sum.
  const englishRest = Math.max(opened - german - matched, 0);
  const total = german + englishRest + matched;

  const fmt = (n) => n.toLocaleString('en-US');
  const pctOf = (n, of, unit) => {
    if (!of) return `0% of ${unit}`;
    const p = (n / of) * 100;
    return `${p > 0 && p < 10 ? p.toFixed(1) : Math.round(p)}% of ${unit}`;
  };
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('f-clicked', fmt(opened));
  set('f-german', fmt(german));      set('fp-german', pctOf(german, total, 'opened'));
  set('f-english', fmt(englishRest)); set('fp-english', pctOf(englishRest, total, 'opened'));
  set('f-matched', fmt(matched));    set('fp-matched', pctOf(matched, total, 'opened'));
  set('f-applied', fmt(applied));    set('fp-applied', pctOf(applied, total, 'opened'));
  set('f-interview', fmt(interviewed)); set('fp-interview', pctOf(interviewed, applied, 'applied'));
  set('f-offer', fmt(offer));        set('fp-offer', pctOf(offer, applied, 'applied'));

  const bar = document.getElementById('railBar');
  if (!bar) return;
  const share = (n, of) => (of ? `${(n / of) * 100}%` : '0%');
  const seg = (key) => bar.querySelector(`.seg[data-key="${key}"]`);
  seg('german').style.width = share(german, total);
  seg('english').style.width = share(englishRest, total);
  seg('matched').style.width = share(matched, total);
  // Applied is a slice of matched. Interview fills Applied by interviewed/applied.
  // Offer sits inside interview (subset), but its % label is still of Applied.
  seg('applied').style.width = share(appliedSlice, matched);
  seg('interview').style.width = share(interviewed, appliedSlice || applied);
  seg('offer').style.width = share(offer, interviewed);
  const counts = { german, english: englishRest, matched, applied: appliedSlice, interview: interviewed, offer };
  ['german', 'english', 'matched', 'applied', 'interview', 'offer'].forEach(key => {
    seg(key).hidden = counts[key] === 0;
  });
  requestAnimationFrame(placeRailLabels);
}

function appendRailOutside(seg, outside) {
  const label = seg.querySelector(':scope > .seg-label');
  if (!label) return;
  const item = document.createElement('div');
  item.className = `rail-out rail-out-${seg.dataset.key}`;
  const clone = label.cloneNode(true);
  clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  item.innerHTML = '<span class="sw"></span>';
  item.append(...clone.childNodes);
  outside.appendChild(item);
}

/* A part too narrow for its text shows the text under the bar instead.
   Offer is always listed, even at 0, so the slot is reserved. */
function placeRailLabels() {
  const bar = document.getElementById('railBar');
  const outside = document.getElementById('railOutside');
  if (!bar || !outside) return;
  outside.innerHTML = '';
  bar.querySelectorAll('.seg').forEach(s => s.classList.remove('narrow'));
  const compact = window.matchMedia('(max-width: 760px)').matches;
  bar.querySelectorAll('.seg').forEach(s => {
    if (s.hidden) return;
    const label = s.querySelector(':scope > .seg-label');
    const inner = s.querySelector(':scope > .seg');
    const room = s.clientWidth - (inner && !inner.hidden ? inner.offsetWidth : 0);
    const need = Math.max(...[...label.children].map(c => c.offsetWidth)) + 24;
    if (!compact && need <= room) return;
    s.classList.add('narrow');
    appendRailOutside(s, outside);
  });
  const offerSeg = bar.querySelector('.seg[data-key="offer"]');
  if (offerSeg && offerSeg.hidden) {
    offerSeg.classList.add('narrow');
    appendRailOutside(offerSeg, outside);
  }
}

// Web fonts change text widths once they arrive
document.fonts?.ready.then(() => placeRailLabels());

window.addEventListener('resize', () => {
  clearTimeout(placeRailLabels._t);
  placeRailLabels._t = setTimeout(placeRailLabels, 120);
});
