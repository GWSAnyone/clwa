/**
 * CLWA World Editor — UI logic
 * Design matches the main game client (dark detective-noir theme)
 */

// ============================================================
// THEME TOGGLE
// ============================================================
const savedTheme = localStorage.getItem('we-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
updateThemeIcon(savedTheme);

document.getElementById('theme-toggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('we-theme', next);
  updateThemeIcon(next);
});

function updateThemeIcon(t) {
  const icon = document.getElementById('theme-icon');
  if (icon) icon.innerHTML = t === 'dark' ? '&#9790;' : '&#9728;';
}

// ============================================================
// HELPERS
// ============================================================
const $content = document.getElementById('content');
const $toast = document.getElementById('toast');

const ROLE_COLORS = {
  bartender: '#e8993a', merchant: '#d4a843', bard: '#a371d6',
  guard: '#6498c8', priest: '#e0c97f', blacksmith: '#c47a5a',
  herbalist: '#6abf8a', judge: '#8b949e',
};
const TRAIT_COLORS = {
  O: '#a080d0', C: '#60a0d0', E: '#d0a040', A: '#60c080', N: '#d06060', H: '#40a0a0',
};
const TRAIT_NAMES = {
  O: 'Openness', C: 'Conscientiousness', E: 'Extraversion',
  A: 'Agreeableness', N: 'Neuroticism', H: 'Honesty',
};
const PERIOD_LABELS = { dawn: 'Dawn', morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
const MOTIVE_TYPES = ['THREAT_PERCEIVED', 'REVENGE_DESIRE', 'PERSONAL_GRUDGE'];
const MOTIVE_LABELS = { THREAT_PERCEIVED: 'Threat', REVENGE_DESIRE: 'Revenge', PERSONAL_GRUDGE: 'Grudge' };
const REL_TYPES = ['friend', 'colleague', 'acquaintance', 'rival', 'enemy'];

async function api(path) { return (await fetch('/api/' + path)).json(); }

async function apiPut(path, data) {
  await fetch('/api/' + path, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  showToast('Saved!');
}

function showToast(msg) {
  $toast.textContent = msg;
  $toast.style.display = 'block';
  $toast.style.animation = 'none';
  $toast.offsetHeight; // reflow
  $toast.style.animation = 'toastIn 0.3s ease-out';
  clearTimeout($toast._t);
  $toast._t = setTimeout(() => $toast.style.display = 'none', 2000);
}

// --- DOM builder ---
function h(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (typeof c === 'string') e.append(c);
    else if (c) e.append(c);
  }
  return e;
}

function sectionHeader(title, subtitle, onSave) {
  return h('div', { class: 'section-header mb-lg' }, [
    h('div', {}, [
      h('div', { class: 'section-title', text: title }),
      subtitle ? h('div', { class: 'section-subtitle', text: subtitle }) : null,
    ]),
    onSave ? h('button', { class: 'btn btn-success', html: '&#10003; Save', onclick: onSave }) : null,
  ]);
}

function fieldGroup(labelText, inputEl) {
  return h('div', { class: 'field-group' }, [
    h('label', { text: labelText }),
    inputEl,
  ]);
}

function textInput(value, onChange) {
  const inp = h('input', { type: 'text', value: value || '' });
  inp.addEventListener('input', () => onChange(inp.value));
  return inp;
}

function numInput(value, onChange, attrs = {}) {
  const inp = h('input', { type: 'number', value: String(value ?? ''), ...attrs });
  inp.addEventListener('input', () => onChange(parseFloat(inp.value) || 0));
  return inp;
}

function textArea(value, onChange, rows = 3) {
  const ta = h('textarea', { rows: String(rows) });
  ta.value = value || '';
  ta.addEventListener('input', () => onChange(ta.value));
  return ta;
}

function slider(value, min, max, step, onChange, color) {
  const val = h('span', {
    class: 'trait-value',
    text: (value ?? 0).toFixed(2),
    style: color ? { color } : {},
  });
  const inp = h('input', {
    type: 'range', min: String(min), max: String(max),
    step: String(step), value: String(value ?? 0),
  });
  if (color) inp.style.accentColor = color;
  inp.addEventListener('input', () => {
    const v = parseFloat(inp.value);
    val.textContent = v.toFixed(2);
    onChange(v);
  });
  return h('div', { class: 'flex-row', style: { flex: '1' } }, [inp, val]);
}

function selectInput(value, options, onChange) {
  const sel = h('select');
  for (const opt of options) {
    const o = h('option', { value: opt, text: opt });
    if (opt === value) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function checkbox(value, labelText, onChange) {
  const inp = h('input', { type: 'checkbox' });
  inp.checked = !!value;
  inp.addEventListener('change', () => onChange(inp.checked));
  return h('label', { class: 'flex-row', style: { cursor: 'pointer', fontSize: '0.82rem', fontWeight: '400', textTransform: 'none', letterSpacing: '0' } }, [inp, labelText]);
}

function divider(text) {
  return h('div', { class: 'section-divider', text });
}

function backBtn(text, onClick) {
  return h('button', { class: 'back-btn', html: '&#8592; ' + text, onclick: onClick });
}

// Refs cache
let npcIds = [], npcNames = {}, locationNames = [];

async function loadRefs() {
  if (!npcIds.length) {
    const npcs = await api('npcs');
    npcIds = npcs.map(n => n.id);
    npcs.forEach(n => npcNames[n.id] = n.name);
  }
  if (!locationNames.length) {
    const world = await api('world');
    locationNames = world.locations.map(l => l.name);
  }
}

// ============================================================
// NAVIGATION
// ============================================================
document.getElementById('nav').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-section]');
  if (!btn) return;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  await loadRefs();
  const s = btn.dataset.section;
  if (s === 'npcs') renderNpcs();
  else if (s === 'relationships') renderRelationships();
  else if (s === 'motives') renderMotives();
  else if (s === 'secrets') renderSecrets();
  else if (s === 'locations') renderLocations();
  else if (s === 'topics') renderTopics();
  else if (s === 'config') renderConfig();
});

// ============================================================
// NPCs — LIST
// ============================================================
async function renderNpcs() {
  const npcs = await api('npcs');
  $content.innerHTML = '';
  $content.append(sectionHeader('NPCs', `${npcs.length} characters in Millhaven`));

  const grid = h('div', { class: 'npc-grid' });
  for (const npc of npcs) {
    const color = ROLE_COLORS[npc.role] || '#8b949e';
    const moodPct = ((npc.startingMood + 1) / 2) * 100;
    const moodColor = npc.startingMood >= 0 ? '#3fb950' : '#f85149';

    const card = h('div', { class: 'card card-clickable npc-card', onclick: () => renderNpcDetail(npc.id) }, [
      h('div', { class: 'npc-avatar', style: { background: color }, text: npc.name[0] }),
      h('div', { class: 'npc-info' }, [
        h('div', { class: 'flex-row gap-sm' }, [
          h('span', { class: 'npc-name', text: npc.name }),
          h('span', { class: 'badge badge-role', text: npc.role }),
        ]),
        h('div', { class: 'npc-mood-bar' }, [
          h('div', { class: 'npc-mood-fill', style: { width: moodPct + '%', background: moodColor } }),
        ]),
      ]),
    ]);
    grid.append(card);
  }
  $content.append(grid);
}

// ============================================================
// NPCs — DETAIL
// ============================================================
async function renderNpcDetail(id) {
  const npc = await api('npcs/' + id);
  const data = JSON.parse(JSON.stringify(npc));
  const color = ROLE_COLORS[data.role] || '#8b949e';

  $content.innerHTML = '';
  $content.append(backBtn('All NPCs', () => renderNpcs()));

  // Header with avatar
  const header = h('div', { class: 'flex-row gap-lg mb-lg' }, [
    h('div', { class: 'npc-avatar', style: { background: color, width: '56px', height: '56px', fontSize: '1.2rem' }, text: data.name[0] }),
    h('div', {}, [
      h('div', { style: { fontSize: '1.2rem', fontWeight: '700' }, text: data.name }),
      h('div', { class: 'flex-row gap-sm mt-sm' }, [
        h('span', { class: 'badge badge-role', text: data.role }),
        data.mobile ? h('span', { class: 'badge badge-type', text: 'mobile' }) : null,
        data.capabilities?.investigator ? h('span', { class: 'badge badge-motive', text: 'investigator' }) : null,
        data.capabilities?.detersCrime ? h('span', { class: 'badge badge-motive', text: 'deters crime' }) : null,
        data.capabilities?.canSentence ? h('span', { class: 'badge badge-type', text: 'judge' }) : null,
      ]),
    ]),
    h('div', { style: { marginLeft: 'auto' } }, [
      h('button', { class: 'btn btn-success', html: '&#10003; Save', onclick: () => apiPut('npcs/' + id, data) }),
    ]),
  ]);
  $content.append(header);

  const wrap = h('div', { class: 'space-y-lg' });

  // ---- NARRATIVE (for screenwriters) ----
  wrap.append(divider('Narrative'));

  wrap.append(h('div', { class: 'card space-y' }, [
    fieldGroup('Background', textArea(data.background, v => data.background = v, 4)),
    fieldGroup('Speech Style', textArea(data.speechStyle, v => data.speechStyle = v, 3)),
    fieldGroup('Secret', textArea(data.secret, v => data.secret = v, 2)),
    fieldGroup('Inner Conflict', textArea(data.innerConflict, v => data.innerConflict = v, 2)),
  ]));

  // Memories
  const memCard = h('div', { class: 'card' });
  memCard.append(h('div', { class: 'card-title', text: 'Memories' }));
  function renderMems() {
    while (memCard.children.length > 1) memCard.lastChild.remove();
    data.memories?.forEach((m, i) => {
      const row = h('div', { class: 'flex-row mb-sm' }, [
        h('div', { style: { flex: '1' } }, [
          textArea(m, v => data.memories[i] = v, 2),
        ]),
        h('button', { class: 'btn btn-danger', text: 'X', onclick: () => { data.memories.splice(i, 1); renderMems(); } }),
      ]);
      memCard.append(row);
    });
    memCard.append(h('button', { class: 'btn btn-ghost mt-sm', text: '+ Add memory', onclick: () => { if (!data.memories) data.memories = []; data.memories.push(''); renderMems(); } }));
  }
  renderMems();
  wrap.append(memCard);

  // ---- PERSONALITY (for both) ----
  wrap.append(divider('Personality'));

  const traitCard = h('div', { class: 'card' });
  traitCard.append(h('div', { class: 'card-title', text: 'HEXACO Traits' }));
  for (const [key, name] of Object.entries(TRAIT_NAMES)) {
    const color = TRAIT_COLORS[key];
    traitCard.append(h('div', { class: 'trait-row' }, [
      h('span', { class: 'trait-label', style: { color }, text: key }),
      h('span', { class: 'trait-name', text: name }),
      h('div', { class: 'trait-slider' }, [
        slider(data.personality[key], 0, 1, 0.05, v => data.personality[key] = v, color),
      ]),
    ]));
  }
  wrap.append(traitCard);

  // Random ranges
  if (data.randomRanges) {
    const rangeCard = h('div', { class: 'card' });
    rangeCard.append(h('div', { class: 'card-title', text: 'Randomization Ranges' }));
    for (const [key, name] of Object.entries(TRAIT_NAMES)) {
      if (!data.randomRanges[key]) continue;
      const color = TRAIT_COLORS[key];
      const r = data.randomRanges[key];
      rangeCard.append(h('div', { class: 'trait-row' }, [
        h('span', { class: 'trait-label', style: { color }, text: key }),
        h('span', { class: 'trait-name', text: 'min' }),
        h('div', { class: 'trait-slider' }, [slider(r[0], 0, 1, 0.05, v => data.randomRanges[key][0] = v, color)]),
        h('span', { class: 'trait-name', style: { width: '30px' }, text: 'max' }),
        h('div', { class: 'trait-slider' }, [slider(r[1], 0, 1, 0.05, v => data.randomRanges[key][1] = v, color)]),
      ]));
    }
    wrap.append(rangeCard);
  }

  // Enneagram
  if (data.enneagram) {
    wrap.append(h('div', { class: 'card' }, [
      h('div', { class: 'card-title', text: 'Enneagram' }),
      h('div', { class: 'grid-4' }, [
        fieldGroup('Type', numInput(data.enneagram.type, v => data.enneagram.type = v, { min: '1', max: '9' })),
        fieldGroup('Wing', numInput(data.enneagram.wing, v => data.enneagram.wing = v, { min: '1', max: '9' })),
        fieldGroup('Stress', numInput(data.enneagram.stressType, v => data.enneagram.stressType = v, { min: '1', max: '9' })),
        fieldGroup('Growth', numInput(data.enneagram.growthType, v => data.enneagram.growthType = v, { min: '1', max: '9' })),
      ]),
      h('div', { class: 'grid-2' }, [
        fieldGroup('Core Fear', textInput(data.enneagram.coreFear, v => data.enneagram.coreFear = v)),
        fieldGroup('Core Desire', textInput(data.enneagram.coreDesire, v => data.enneagram.coreDesire = v)),
      ]),
    ]));
  }

  // ---- TECHNICAL (for programmers) ----
  wrap.append(divider('Technical'));

  wrap.append(h('div', { class: 'card' }, [
    h('div', { class: 'card-title', text: 'Identity & Location' }),
    h('div', { class: 'grid-3' }, [
      fieldGroup('ID', textInput(data.id, v => data.id = v)),
      fieldGroup('Name', textInput(data.name, v => data.name = v)),
      fieldGroup('Role', textInput(data.role, v => data.role = v)),
    ]),
    h('div', { class: 'grid-3' }, [
      fieldGroup('Home', selectInput(data.home, locationNames, v => data.home = v)),
      fieldGroup('Starting Location', selectInput(data.startingLocation, locationNames, v => data.startingLocation = v)),
      fieldGroup('Mobile', checkbox(data.mobile, 'Can move between locations', v => data.mobile = v)),
    ]),
  ]));

  // Capabilities
  wrap.append(h('div', { class: 'card' }, [
    h('div', { class: 'card-title', text: 'Capabilities' }),
    h('div', { class: 'grid-3' }, [
      checkbox(data.capabilities?.investigator, 'Investigator', v => { if (!data.capabilities) data.capabilities = {}; data.capabilities.investigator = v; }),
      checkbox(data.capabilities?.detersCrime, 'Deters Crime', v => { if (!data.capabilities) data.capabilities = {}; data.capabilities.detersCrime = v; }),
      checkbox(data.capabilities?.canSentence, 'Can Sentence', v => { if (!data.capabilities) data.capabilities = {}; data.capabilities.canSentence = v; }),
    ]),
  ]));

  // Mood
  wrap.append(h('div', { class: 'card' }, [
    h('div', { class: 'card-title', text: 'Mood' }),
    fieldGroup('Starting Mood', slider(data.startingMood ?? 0, -1, 1, 0.05, v => data.startingMood = v)),
    data.moodRange ? h('div', { class: 'grid-2' }, [
      fieldGroup('Range Min', slider(data.moodRange[0], -1, 1, 0.05, v => data.moodRange[0] = v)),
      fieldGroup('Range Max', slider(data.moodRange[1], -1, 1, 0.05, v => data.moodRange[1] = v)),
    ]) : null,
  ]));

  // LLM
  wrap.append(h('div', { class: 'card' }, [
    h('div', { class: 'card-title', text: 'LLM Settings' }),
    h('div', { class: 'grid-2' }, [
      fieldGroup('Temperature', slider(data.llm?.temperature ?? 0.7, 0, 1, 0.05, v => { if (!data.llm) data.llm = {}; data.llm.temperature = v; })),
      fieldGroup('Max Tokens', numInput(data.llm?.maxTokens ?? 200, v => { if (!data.llm) data.llm = {}; data.llm.maxTokens = v; })),
    ]),
  ]));

  // Schedule
  if (data.schedule) {
    const schedTable = h('table');
    schedTable.append(h('thead', {}, [h('tr', {}, [
      h('th', { text: 'Period' }), h('th', { text: 'Location' }), h('th', { text: 'Activity' }),
    ])]));
    const tbody = h('tbody');
    data.schedule.forEach((s, i) => {
      tbody.append(h('tr', {}, [
        h('td', { text: PERIOD_LABELS[s.period] || s.period }),
        h('td', {}, [selectInput(s.location, locationNames, v => data.schedule[i].location = v)]),
        h('td', {}, [textInput(s.activity, v => data.schedule[i].activity = v)]),
      ]));
    });
    schedTable.append(tbody);
    wrap.append(h('div', { class: 'card' }, [
      h('div', { class: 'card-title', text: 'Schedule' }),
      schedTable,
    ]));
  }

  // Shop
  if (data.shop?.length) {
    const shopCard = h('div', { class: 'card' });
    shopCard.append(h('div', { class: 'card-title', text: 'Shop' }));
    function renderShop() {
      while (shopCard.children.length > 1) shopCard.lastChild.remove();
      const tbl = h('table');
      tbl.append(h('thead', {}, [h('tr', {}, [
        h('th', { text: 'ID' }), h('th', { text: 'Name' }), h('th', { text: 'Price' }), h('th', { text: 'Description' }), h('th'),
      ])]));
      const tb = h('tbody');
      data.shop.forEach((item, i) => {
        tb.append(h('tr', {}, [
          h('td', {}, [textInput(item.id, v => data.shop[i].id = v)]),
          h('td', {}, [textInput(item.name, v => data.shop[i].name = v)]),
          h('td', {}, [numInput(item.price, v => data.shop[i].price = v)]),
          h('td', {}, [textInput(item.description, v => data.shop[i].description = v)]),
          h('td', {}, [h('button', { class: 'btn btn-danger', text: 'X', onclick: () => { data.shop.splice(i, 1); renderShop(); } })]),
        ]));
      });
      tbl.append(tb);
      shopCard.append(tbl);
      shopCard.append(h('button', { class: 'btn btn-ghost mt-sm', text: '+ Add item', onclick: () => { data.shop.push({ id: '', name: '', price: 0, description: '' }); renderShop(); } }));
    }
    renderShop();
    wrap.append(shopCard);
  }

  // Motive (legacy)
  if (data.motive) {
    wrap.append(h('div', { class: 'card' }, [
      h('div', { class: 'card-title', text: 'Legacy Motive' }),
      h('div', { class: 'grid-2' }, [
        fieldGroup('Target', selectInput(data.motive.targetId, npcIds, v => data.motive.targetId = v)),
        fieldGroup('Reason', textArea(data.motive.reason, v => data.motive.reason = v, 2)),
      ]),
    ]));
  }

  $content.append(wrap);
}

// ============================================================
// RELATIONSHIPS
// ============================================================
async function renderRelationships() {
  const [rels, npcs] = await Promise.all([api('relationships'), api('npcs')]);
  const ids = npcs.map(n => n.id);
  const names = {};
  npcs.forEach(n => names[n.id] = n.name);
  let data = JSON.parse(JSON.stringify(rels));

  function lookup() {
    const m = {};
    data.forEach(r => { if (!m[r.from]) m[r.from] = {}; m[r.from][r.to] = r; });
    return m;
  }

  function render() {
    $content.innerHTML = '';
    $content.append(sectionHeader('Relationships', 'Click a cell to edit. Color = sentiment.', async () => apiPut('relationships', data)));

    const lk = lookup();
    const tbl = h('table', { class: 'rel-matrix' });
    const headerRow = h('tr', {}, [h('th')]);
    ids.forEach(id => headerRow.append(h('th', { text: names[id] })));
    tbl.append(h('thead', {}, [headerRow]));

    const tbody = h('tbody');
    ids.forEach(fromId => {
      const row = h('tr', {}, [h('td', { style: { textAlign: 'right', paddingRight: '8px', fontWeight: '600', fontSize: '0.78rem' }, text: names[fromId] })]);
      ids.forEach(toId => {
        if (fromId === toId) { row.append(h('td', { html: '<span style="color:var(--border)">—</span>' })); return; }
        const rel = lk[fromId]?.[toId];
        const sent = rel?.sentiment ?? 0;
        let bg;
        if (!rel) bg = 'rgba(255,255,255,0.02)';
        else if (sent > 0) bg = `rgba(63,185,80,${Math.min(sent * 0.8, 0.6)})`;
        else if (sent < 0) bg = `rgba(248,81,73,${Math.min(Math.abs(sent) * 0.8, 0.6)})`;
        else bg = 'rgba(255,255,255,0.05)';

        const text = rel ? (rel.type?.[0]?.toUpperCase() || '?') : '+';
        const title = rel ? `${rel.type}: ${rel.note || ''}\nSentiment: ${sent}\nTrust: ${rel.trust ?? '-'}` : 'No relationship — click to create';
        row.append(h('td', {}, [
          h('div', { class: 'rel-cell', text, title, style: { background: bg }, onclick: () => editRel(fromId, toId, rel) }),
        ]));
      });
      tbody.append(row);
    });
    tbl.append(tbody);
    $content.append(tbl);
  }

  function editRel(fromId, toId, existing) {
    const rel = existing ? JSON.parse(JSON.stringify(existing)) : { from: fromId, to: toId, type: 'acquaintance', note: '' };
    const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
    const box = h('div', { class: 'modal-box space-y' }, [
      h('div', { class: 'modal-title', text: `${names[fromId]} → ${names[toId]}` }),
      fieldGroup('Type', selectInput(rel.type, REL_TYPES, v => rel.type = v)),
      fieldGroup('Note', textInput(rel.note, v => rel.note = v)),
      fieldGroup('Sentiment (-1..1)', slider(rel.sentiment ?? 0, -1, 1, 0.05, v => rel.sentiment = v)),
      fieldGroup('Trust (0..1)', slider(rel.trust ?? 0.5, 0, 1, 0.05, v => rel.trust = v)),
      h('div', { class: 'flex-row gap-sm mt-lg' }, [
        h('button', { class: 'btn btn-primary', text: 'Apply', onclick: () => {
          if (existing) Object.assign(existing, rel);
          else data.push(rel);
          overlay.remove();
          render();
        }}),
        existing ? h('button', { class: 'btn btn-danger', text: 'Delete', onclick: () => {
          data = data.filter(r => !(r.from === fromId && r.to === toId));
          overlay.remove();
          render();
        }}) : null,
        h('button', { class: 'btn btn-ghost', text: 'Cancel', onclick: () => overlay.remove() }),
      ]),
    ]);
    overlay.append(box);
    document.body.append(overlay);
  }

  render();
}

// ============================================================
// MOTIVES
// ============================================================
async function renderMotives() {
  const motives = await api('motives');
  let data = JSON.parse(JSON.stringify(motives));

  function render() {
    $content.innerHTML = '';
    $content.append(sectionHeader('Motives', 'Hidden motivations — who wants to harm whom and under what conditions.', async () => apiPut('motives', data)));

    data.forEach((m, i) => {
      const card = h('div', { class: 'card mb-md' }, [
        h('div', { class: 'flex-between mb-md' }, [
          h('div', { class: 'flex-row gap-sm' }, [
            h('span', { style: { fontWeight: '600' }, text: npcNames[m.from] || m.from }),
            h('span', { style: { color: 'var(--text-muted)' }, text: ' → ' }),
            h('span', { style: { fontWeight: '600' }, text: npcNames[m.to] || m.to }),
            h('span', { class: 'badge badge-motive', text: MOTIVE_LABELS[m.type] || m.type }),
          ]),
          h('button', { class: 'btn btn-danger', text: 'Delete', onclick: () => { data.splice(i, 1); render(); } }),
        ]),
        h('div', { class: 'grid-2' }, [
          fieldGroup('ID', textInput(m.id, v => data[i].id = v)),
          fieldGroup('Type', selectInput(m.type, MOTIVE_TYPES, v => data[i].type = v)),
        ]),
        h('div', { class: 'grid-2' }, [
          fieldGroup('From', selectInput(m.from, npcIds, v => data[i].from = v)),
          fieldGroup('To', selectInput(m.to, npcIds, v => data[i].to = v)),
        ]),
        fieldGroup('Reason', textArea(m.reason, v => data[i].reason = v, 2)),
        h('div', { class: 'grid-2' }, [
          fieldGroup('Confidence', slider(m.confidence ?? 0.5, 0, 1, 0.05, v => data[i].confidence = v)),
          fieldGroup('Probability', slider(m.probability ?? 0.3, 0, 1, 0.05, v => data[i].probability = v)),
        ]),
        fieldGroup('Requires (JSON)', textArea(JSON.stringify(m.requires || {}, null, 2), v => { try { data[i].requires = JSON.parse(v); } catch {} }, 2)),
      ]);
      $content.append(card);
    });

    $content.append(h('button', { class: 'btn btn-ghost', text: '+ Add motive', onclick: () => {
      data.push({ id: '', from: npcIds[0], to: npcIds[1], type: 'PERSONAL_GRUDGE', reason: '', confidence: 0.5, probability: 0.3, requires: {} });
      render();
    }}));
  }
  render();
}

// ============================================================
// SECRETS
// ============================================================
async function renderSecrets() {
  const secrets = await api('secrets');
  let data = JSON.parse(JSON.stringify(secrets));

  function render() {
    $content.innerHTML = '';
    $content.append(sectionHeader('Secrets', 'What characters know about each other at game start.', async () => apiPut('secrets', data)));

    const tbl = h('table');
    tbl.append(h('thead', {}, [h('tr', {}, [
      h('th', { text: 'Who Knows' }), h('th', { text: 'Type' }), h('th', { text: 'About' }),
      h('th', { text: 'What' }), h('th', { text: 'Confidence' }), h('th', { text: 'Source' }), h('th'),
    ])]));
    const tbody = h('tbody');
    data.forEach((s, i) => {
      tbody.append(h('tr', {}, [
        h('td', {}, [selectInput(s.npcId, npcIds, v => data[i].npcId = v)]),
        h('td', {}, [textInput(s.eventType, v => data[i].eventType = v)]),
        h('td', {}, [textInput(s.subject, v => data[i].subject = v)]),
        h('td', {}, [textInput(s.object || '', v => data[i].object = v || null)]),
        h('td', { style: { minWidth: '120px' } }, [slider(s.confidence ?? 0.5, 0, 1, 0.1, v => data[i].confidence = v)]),
        h('td', {}, [textInput(s.source, v => data[i].source = v)]),
        h('td', {}, [h('button', { class: 'btn btn-danger', text: 'X', onclick: () => { data.splice(i, 1); render(); } })]),
      ]));
    });
    tbl.append(tbody);
    $content.append(tbl);
    $content.append(h('button', { class: 'btn btn-ghost mt-md', text: '+ Add secret', onclick: () => {
      data.push({ npcId: npcIds[0], eventType: 'PERSONAL_SECRET', subject: '', object: '', confidence: 0.5, source: 'secret' });
      render();
    }}));
  }
  render();
}

// ============================================================
// LOCATIONS
// ============================================================
async function renderLocations() {
  const world = await api('world');
  const data = JSON.parse(JSON.stringify(world));

  $content.innerHTML = '';
  $content.append(sectionHeader('Locations', `${data.locations.length} locations in Millhaven`, async () => apiPut('world', data)));

  data.locations.forEach((loc, i) => {
    $content.append(h('div', { class: 'card mb-md' }, [
      h('div', { class: 'card-title', text: loc.name }),
      h('div', { class: 'grid-2' }, [
        fieldGroup('Name', textInput(loc.name, v => data.locations[i].name = v)),
        fieldGroup('Connections (comma-separated)', textInput(loc.connections.join(', '), v => {
          data.locations[i].connections = v.split(',').map(s => s.trim()).filter(Boolean);
        })),
      ]),
      fieldGroup('Description', textArea(loc.description, v => data.locations[i].description = v, 2)),
      fieldGroup('Conversation Hook', textArea(loc.conversationHook, v => data.locations[i].conversationHook = v, 2)),
    ]));
  });
}

// ============================================================
// TOPICS
// ============================================================
async function renderTopics() {
  const topics = await api('topics');
  let data = JSON.parse(JSON.stringify(topics));

  const ROLE_LABELS = {
    bartender: 'Bartender', merchant: 'Merchant', guard: 'Guard', priest: 'Priest',
    bard: 'Bard', blacksmith: 'Blacksmith', judge: 'Judge', herbalist: 'Herbalist',
  };

  function render() {
    $content.innerHTML = '';
    $content.append(sectionHeader('Topics', 'Conversation topics by role.', async () => apiPut('topics', data)));

    Object.keys(data).forEach(role => {
      const card = h('div', { class: 'card mb-md' });
      const body = h('div', { class: 'space-y', style: { display: 'none' } });

      const arrow = h('span', { class: 'accordion-arrow', html: '&#9654;' });
      const header = h('div', { class: 'accordion-header' }, [
        h('div', { class: 'flex-row gap-sm' }, [
          h('span', { style: { color: ROLE_COLORS[role] || 'var(--text)', fontWeight: '600' }, text: ROLE_LABELS[role] || role }),
          h('span', { style: { color: 'var(--text-muted)', fontSize: '0.75rem' }, text: `${data[role].length} topics` }),
        ]),
        arrow,
      ]);
      header.addEventListener('click', () => {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        arrow.classList.toggle('open', !open);
      });

      data[role].forEach((t, i) => {
        body.append(h('div', { class: 'card', style: { background: 'var(--bg-elevated)', marginTop: 'var(--sp-sm)' } }, [
          h('div', { class: 'grid-2' }, [
            fieldGroup('Subject', textInput(t.subject, v => data[role][i].subject = v)),
            fieldGroup('Tone', textInput(t.tone, v => data[role][i].tone = v)),
          ]),
          h('div', { class: 'grid-2' }, [
            fieldGroup('Mood Valence', numInput(t.moodValence, v => data[role][i].moodValence = v, { step: '0.005' })),
            fieldGroup('Weight', numInput(t.weight, v => data[role][i].weight = v)),
          ]),
          fieldGroup('Initiator Hook', textArea(t.initiatorHook, v => data[role][i].initiatorHook = v, 2)),
          h('div', { style: { textAlign: 'right' } }, [
            h('button', { class: 'btn btn-danger', text: 'Delete', onclick: () => { data[role].splice(i, 1); render(); } }),
          ]),
        ]));
      });

      body.append(h('button', { class: 'btn btn-ghost mt-sm', text: '+ Add topic', onclick: () => {
        data[role].push({ subject: '', tone: '', moodValence: 0, weight: 2, initiatorHook: '' });
        render();
      }}));

      card.append(header);
      card.append(body);
      $content.append(card);
    });
  }
  render();
}

// ============================================================
// CONFIG
// ============================================================
async function renderConfig() {
  const world = await api('world');
  const data = JSON.parse(JSON.stringify(world));

  $content.innerHTML = '';
  $content.append(sectionHeader('World Config', 'Global world settings and lore.', async () => apiPut('world', data)));

  $content.append(h('div', { class: 'card mb-lg' }, [
    h('div', { class: 'card-title', text: 'World' }),
    h('div', { class: 'grid-2' }, [
      fieldGroup('Name', textInput(data.name, v => data.name = v)),
    ]),
    fieldGroup('Description', textArea(data.description, v => data.description = v, 2)),
  ]));

  if (data.config) {
    $content.append(h('div', { class: 'card mb-lg' }, [
      h('div', { class: 'card-title', text: 'Simulation Parameters' }),
      h('div', { class: 'grid-3' }, [
        fieldGroup('Start Minute', numInput(data.config.startMinute, v => data.config.startMinute = v)),
        fieldGroup('Exchange Count', numInput(data.config.exchangeCount, v => data.config.exchangeCount = v)),
        fieldGroup('Mood Bias', numInput(data.config.moodBias, v => data.config.moodBias = v, { step: '0.1' })),
      ]),
    ]));
  }

  if (data.lore) {
    const loreCard = h('div', { class: 'card' });
    loreCard.append(h('div', { class: 'card-title', text: 'Lore' }));
    function renderLore() {
      while (loreCard.children.length > 1) loreCard.lastChild.remove();
      data.lore.forEach((l, i) => {
        loreCard.append(h('div', { class: 'flex-row mb-sm' }, [
          h('div', { style: { flex: '1' } }, [textArea(l, v => data.lore[i] = v, 2)]),
          h('button', { class: 'btn btn-danger', text: 'X', onclick: () => { data.lore.splice(i, 1); renderLore(); } }),
        ]));
      });
      loreCard.append(h('button', { class: 'btn btn-ghost mt-sm', text: '+ Add lore', onclick: () => { data.lore.push(''); renderLore(); } }));
    }
    renderLore();
    $content.append(loreCard);
  }
}
