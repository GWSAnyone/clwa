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
const MOTIVE_LABELS = { THREAT_PERCEIVED: 'Threat', REVENGE_DESIRE: 'Revenge', PERSONAL_GRUDGE: 'Grudge' };
let REL_TYPES = ['friend', 'colleague', 'acquaintance', 'rival', 'enemy']; // overridden by registry

async function api(path) { return (await fetch('/api/' + path)).json(); }

// Load world name dynamically
api('meta').then(meta => {
  const brand = document.querySelector('.sidebar-brand p');
  if (brand) brand.textContent = meta.worldName.toUpperCase();
  document.title = `CLWA World Editor — ${meta.worldName}`;
});

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

let _comboId = 0;
/** Free-text input with datalist suggestions (open keys: pick an existing value or type a new one). */
function comboInput(value, options, onChange) {
  const listId = `combo-${_comboId++}`;
  const inp = h('input', { type: 'text', value: value || '', list: listId });
  inp.addEventListener('input', () => onChange(inp.value));
  const dl = h('datalist', { id: listId });
  (options || []).forEach(o => dl.append(h('option', { value: o })));
  return h('span', {}, [inp, dl]);
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

function checkbox(value, labelText, onChange, disabled = false) {
  const inp = h('input', { type: 'checkbox' });
  inp.checked = !!value;
  inp.disabled = !!disabled;
  if (!disabled) inp.addEventListener('change', () => onChange(inp.checked));
  return h('label', { class: 'flex-row', title: disabled ? 'not applicable for this route' : '', style: { cursor: disabled ? 'default' : 'pointer', opacity: disabled ? '0.3' : '1', fontSize: '0.82rem', fontWeight: '400', textTransform: 'none', letterSpacing: '0' } }, [inp, labelText]);
}

function divider(text) {
  return h('div', { class: 'section-divider', text });
}

// Open-key toggle editor: checkboxes for the current option set (registry/data union) + a free-text
// "+ new" so authors aren't locked to existing keys. knownFn() returns the live display set (recomputed
// each render, so a just-added key appears). Used for factions / capabilities — no hardcoded lists.
function keyToggles(knownFn, isOn, setOn) {
  const box = h('div', {});
  function render() {
    box.innerHTML = '';
    const keys = [...new Set(knownFn())].sort();
    const grid = h('div', { class: 'grid-3' });
    keys.forEach(k => grid.append(checkbox(isOn(k), k, v => { setOn(k, v); render(); })));
    box.append(grid);
    const inp = h('input', { class: 'input', placeholder: '+ new key', style: { width: '140px' } });
    const add = () => { const k = inp.value.trim(); if (!k) return; setOn(k, true); render(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    box.append(h('div', { class: 'flex-row gap-sm mt-sm' }, [inp, h('button', { class: 'btn btn-ghost', text: '+ Add', onclick: add })]));
  }
  render();
  return box;
}

function backBtn(text, onClick) {
  return h('button', { class: 'back-btn', html: '&#8592; ' + text, onclick: onClick });
}

// Refs cache
let npcIds = [], npcNames = {}, locationNames = [];
let registeredEventTypes = [], registeredSources = [], registeredMotiveTypes = [];
// Open-key option sets (factions/capabilities/item kinds have no engine registry by design — these are
// the union of what the world uses, served by /api/registry. UI also allows adding a new key freely.)
let factionKeys = [], capabilityKeys = [], itemKinds = [];

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
  if (!registeredEventTypes.length) {
    const reg = await api('registry');
    registeredEventTypes = reg.eventTypes;
    registeredMotiveTypes = reg.motiveTypes;
    registeredSources = reg.sources;
    if (reg.relationshipTypes?.length) REL_TYPES = reg.relationshipTypes;
    factionKeys = reg.factions ?? [];
    capabilityKeys = reg.capabilities ?? [];
    itemKinds = reg.itemKinds ?? [];
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
  const meta = await api('meta');
  $content.append(sectionHeader('NPCs', `${npcs.length} characters in ${meta.worldName}`));

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

  // Few-shot voice examples — one is rotated into each prompt as a voice cue (∪ inline "Example:" lines in
  // Speech Style), kept out of the byte-stable prefix. Author in the world language; great for locking dialect.
  const fewShotCard = h('div', { class: 'card' });
  fewShotCard.append(h('div', { class: 'card-title', text: 'Few-shot Voice Examples' }));
  fewShotCard.append(h('div', { class: 'hint', text: 'Sample in-character lines. One is sampled into each prompt as a "my voice sounds like…" cue. Best authored in the world language.' }));
  function renderFewShot() {
    while (fewShotCard.children.length > 2) fewShotCard.lastChild.remove();
    (data.fewShotExamples || []).forEach((ex, i) => {
      fewShotCard.append(h('div', { class: 'flex-row mb-sm' }, [
        h('div', { style: { flex: '1' } }, [textArea(ex, v => data.fewShotExamples[i] = v, 2)]),
        h('button', { class: 'btn btn-danger', text: 'X', onclick: () => { data.fewShotExamples.splice(i, 1); if (!data.fewShotExamples.length) delete data.fewShotExamples; renderFewShot(); } }),
      ]));
    });
    fewShotCard.append(h('button', { class: 'btn btn-ghost mt-sm', text: '+ Add example', onclick: () => { if (!data.fewShotExamples) data.fewShotExamples = []; data.fewShotExamples.push(''); renderFewShot(); } }));
  }
  renderFewShot();
  wrap.append(fewShotCard);

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

  // Capabilities — open string-keyed flags (no hardcoded list; options = union used across the world).
  wrap.append(h('div', { class: 'card' }, [
    h('div', { class: 'card-title', text: 'Capabilities' }),
    h('div', { class: 'hint', text: 'Open flags read via hasCapability() / CG has_capability. Crime: investigator/detersCrime/canSentence. Other genres add their own (isMerchant, canGrantFavor, …).' }),
    keyToggles(
      () => [...capabilityKeys, ...Object.keys(data.capabilities || {})],
      (k) => !!data.capabilities?.[k],
      (k, v) => { if (!data.capabilities) data.capabilities = {}; data.capabilities[k] = v; },
    ),
  ]));

  // Economy & Factions (B1 gold / B3 factions)
  wrap.append(h('div', { class: 'card' }, [
    h('div', { class: 'card-title', text: 'Economy & Factions' }),
    h('div', { class: 'grid-2' }, [
      fieldGroup('Gold', numInput(data.attributes?.gold?.base ?? 0, v => {
        if (v > 0 || data.attributes?.gold) {
          if (!data.attributes) data.attributes = {};
          data.attributes.gold = { base: v, min: 0 };
        }
      }, { min: 0 })),
      fieldGroup('Factions', keyToggles(
        () => [...factionKeys, ...(data.factions || [])],
        (k) => (data.factions || []).includes(k),
        (k, v) => {
          if (!data.factions) data.factions = [];
          const i = data.factions.indexOf(k);
          if (v && i < 0) data.factions.push(k);
          else if (!v && i >= 0) data.factions.splice(i, 1);
          if (data.factions.length === 0) delete data.factions;
        },
      )),
    ]),
  ]));

  // Inventory (B2) — explicit starting items. Merchant shop stock is auto-derived from `shop` at load.
  {
    const invCard = h('div', { class: 'card' });
    invCard.append(h('div', { class: 'card-title', text: 'Inventory' }));
    invCard.append(h('div', { class: 'hint', text: 'Explicit starting items (e.g. a weapon, a keepsake). Merchant shop stock loads automatically from the Shop list.' }));
    function renderInv() {
      while (invCard.children.length > 2) invCard.lastChild.remove();
      const inv = data.inventory ?? [];
      const tbl = h('table');
      tbl.append(h('thead', {}, [h('tr', {}, [h('th', { text: 'Kind' }), h('th', { text: 'Qty' }), h('th')])]));
      const tb = h('tbody');
      inv.forEach((it, i) => {
        tb.append(h('tr', {}, [
          h('td', {}, [comboInput(it.kind, itemKinds, v => data.inventory[i].kind = v)]),
          h('td', {}, [numInput(it.quantity ?? 1, v => data.inventory[i].quantity = v, { min: 1 })]),
          h('td', {}, [h('button', { class: 'btn btn-danger', text: 'X', onclick: () => { data.inventory.splice(i, 1); if (!data.inventory.length) delete data.inventory; renderInv(); } })]),
        ]));
      });
      tbl.append(tb);
      invCard.append(tbl);
      invCard.append(h('button', { class: 'btn btn-ghost mt-sm', text: '+ Add item', onclick: () => { if (!data.inventory) data.inventory = []; data.inventory.push({ kind: '', quantity: 1 }); renderInv(); } }));
    }
    renderInv();
    wrap.append(invCard);
  }

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
      fieldGroup('Standing (-1..1) — favor/rank axis, e.g. toward the magistrate (0 = none)', slider(rel.standing ?? 0, -1, 1, 0.05, v => rel.standing = v)),
      h('div', { class: 'flex-row gap-sm mt-lg' }, [
        h('button', { class: 'btn btn-primary', text: 'Apply', onclick: () => {
          if (rel.standing === 0) delete rel.standing; // keep neutral edges clean (undefined = no axis)
          if (existing) { delete existing.standing; Object.assign(existing, rel); }
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
          fieldGroup('Type', selectInput(m.type, registeredMotiveTypes, v => data[i].type = v)),
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
        h('td', {}, [selectInput(s.eventType, registeredEventTypes, v => data[i].eventType = v)]),
        h('td', {}, [selectInput(s.subject || '', ['', ...npcIds], v => data[i].subject = v || null)]),
        h('td', {}, [textInput(s.object || '', v => data[i].object = v || null)]),
        h('td', { style: { minWidth: '120px' } }, [slider(s.confidence ?? 0.5, 0, 1, 0.1, v => data[i].confidence = v)]),
        h('td', {}, [selectInput(s.source, registeredSources, v => data[i].source = v)]),
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
  $content.append(sectionHeader('Locations', `${data.locations.length} locations in ${data.name}`, async () => apiPut('world', data)));

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

  // Role labels: capitalize first letter (no hardcoded map)
  const roleLabel = (r) => r.charAt(0).toUpperCase() + r.slice(1);

  function render() {
    $content.innerHTML = '';
    $content.append(sectionHeader('Topics', 'Conversation topics by role.', async () => apiPut('topics', data)));

    Object.keys(data).forEach(role => {
      const card = h('div', { class: 'card mb-md' });
      const body = h('div', { class: 'space-y', style: { display: 'none' } });

      const arrow = h('span', { class: 'accordion-arrow', html: '&#9654;' });
      const header = h('div', { class: 'accordion-header' }, [
        h('div', { class: 'flex-row gap-sm' }, [
          h('span', { style: { color: ROLE_COLORS[role] || 'var(--text)', fontWeight: '600' }, text: roleLabel(role) }),
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
  const [world, reg] = await Promise.all([api('world'), api('registry')]);
  const data = JSON.parse(JSON.stringify(world));

  $content.innerHTML = '';
  $content.append(sectionHeader('World Config', 'Global world settings, LLM routing, and lore.', async () => apiPut('world', data)));

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
      h('div', { class: 'grid-3' }, [
        fieldGroup('Language', selectInput(data.config.language || 'en', ['en', 'ru'], v => data.config.language = v)),
        fieldGroup('Chat staleness (ms)', numInput(data.config.chatStaleMs ?? 300000, v => data.config.chatStaleMs = v, { min: '0', step: '1000' })),
      ]),
      h('div', { class: 'hint', text: 'Language selects the localized L1 scaffold + final directive. Chat staleness: real-time gap (ms) after which the next player chat with an NPC starts fresh (default 300000 = 5 min).' }),
    ]));
  }

  // L1 Prompt Scaffold — universal speech/grounding guardrails. Empty = engine genre-neutral default for the
  // selected language (resolved at runtime). Editable so a world can tune the house style without code.
  if (data.config) {
    const scafCard = h('div', { class: 'card mb-lg' });
    scafCard.append(h('div', { class: 'card-title', text: 'Prompt Scaffold (L1 guardrails)' }));
    scafCard.append(h('div', { class: 'hint', text: 'Universal speech/grounding rules injected into every NPC system prompt. Leave empty to use the engine default for the selected language. Keep it genre-neutral (no crime/economy vocabulary).' }));
    function renderScaffold() {
      while (scafCard.children.length > 2) scafCard.lastChild.remove();
      const has = typeof data.config.scaffold === 'string' && data.config.scaffold.length > 0;
      if (has) {
        scafCard.append(textArea(data.config.scaffold, v => data.config.scaffold = v, 12));
        scafCard.append(h('button', { class: 'btn btn-danger mt-sm', text: 'Clear (use engine default)', onclick: () => { delete data.config.scaffold; renderScaffold(); } }));
      } else {
        const lang = data.config.language || 'en';
        const def = (reg.scaffoldDefaults && reg.scaffoldDefaults[lang]) || '';
        scafCard.append(h('div', { class: 'hint', text: `Using engine default (${lang}):` }));
        scafCard.append(h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '0.76rem', color: 'var(--muted)', maxHeight: '200px', overflow: 'auto', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', margin: '6px 0' }, text: def }));
        scafCard.append(h('button', { class: 'btn btn-ghost mt-sm', text: `Load engine default (${lang}) to customize`, onclick: () => { data.config.scaffold = def; renderScaffold(); } }));
      }
    }
    renderScaffold();
    $content.append(scafCard);
  }

  // LLM Routing — assign provider+model per task (registry/default-router driven, no hardcoded lists).
  {
    const llmCard = h('div', { class: 'card mb-lg' });
    llmCard.append(h('div', { class: 'card-title', text: 'LLM Routing' }));
    llmCard.append(h('div', { class: 'hint', text: 'Provider+model per task. Unset = engine default (llm-defaults.ts). Env CLWA_<ROUTE>_PROVIDER/_MODEL also override at launch. Tasks/providers/models come from the registry + default router.' }));
    const provModels = (p) => reg.modelsByProvider?.[p] || [];
    const modelsFor = (p, current) => [...new Set([...(provModels(p)), current].filter(Boolean))];
    const localProvider = () => (reg.llmProviders || []).includes('lm-studio') ? 'lm-studio' : (reg.llmProviders || [])[0] || '';
    // provider select that clamps its sibling model to the new provider's menu, then re-renders the row.
    function providerSelect(route) {
      return selectInput(route.provider || '', reg.llmProviders || [], v => {
        route.provider = v;
        if (!provModels(v).includes(route.model)) route.model = provModels(v)[0] || '';
        // Flags are claude-code-only — drop them when leaving claude-code so no dead no-op flags linger.
        if (v !== 'claude-code') { delete route.warm; delete route.schemaInPrompt; }
        renderLlm();
      });
    }
    function routeCells(route, task) {
      if (!route.sampling) route.sampling = {};
      // Warm matters only for claude-code (cold-spawn). Schema matters only for a structured claude-code call.
      const isClaude = route.provider === 'claude-code';
      const isStructured = task ? (reg.structuredTasks || []).includes(task) : true; // default route: allow
      const warmOff = !isClaude;
      const schemaOff = !(isClaude && isStructured);
      if (warmOff && route.warm) delete route.warm;             // keep config clean if route changed shape
      if (schemaOff && route.schemaInPrompt) delete route.schemaInPrompt;
      return [
        h('td', {}, [providerSelect(route)]),
        h('td', {}, [selectInput(route.model || '', modelsFor(route.provider, route.model), v => route.model = v)]),
        h('td', {}, [numInput(route.maxTokens ?? 0, v => { if (v > 0) route.maxTokens = v; else delete route.maxTokens; }, { style: { width: '64px' } })]),
        h('td', {}, [numInput(route.sampling.temperature ?? 0.7, v => route.sampling.temperature = v, { step: '0.05', style: { width: '60px' } })]),
        h('td', { title: warmOff ? 'Warm only applies to claude-code (no cold-spawn on lm-studio)' : 'Reuse a warm claude session (skips ~7-19s cold-spawn)' }, [checkbox(!!route.warm, '', v => { if (v) route.warm = true; else delete route.warm; }, warmOff)]),
        h('td', { title: schemaOff ? 'Schema only applies to structured claude-code calls (free-text / lm-studio routes have no JSON to speed up)' : 'Inject schema into prompt (~3-5s) instead of native --json-schema (~11s)' }, [checkbox(!!route.schemaInPrompt, '', v => { if (v) route.schemaInPrompt = true; else delete route.schemaInPrompt; }, schemaOff)]),
        h('td', {}, [route.fallback
          ? h('span', { class: 'flex-row gap-sm' }, [
              selectInput(route.fallback.provider || '', reg.llmProviders || [], v => { route.fallback.provider = v; if (!provModels(v).includes(route.fallback.model)) route.fallback.model = provModels(v)[0] || ''; renderLlm(); }),
              selectInput(route.fallback.model || '', modelsFor(route.fallback.provider, route.fallback.model), v => route.fallback.model = v),
              h('button', { class: 'btn btn-danger', text: 'x', title: 'remove fallback', onclick: () => { delete route.fallback; renderLlm(); } }),
            ])
          : h('button', { class: 'btn btn-ghost', text: '+ fb', title: 'add fallback (defaults to local lm-studio)', onclick: () => { const p = localProvider(); route.fallback = { provider: p, model: provModels(p)[0] || '', ...(route.maxTokens ? { maxTokens: route.maxTokens } : {}) }; renderLlm(); } })]),
      ];
    }
    function renderLlm() {
      while (llmCard.children.length > 2) llmCard.lastChild.remove();
      if (!data.config) data.config = {};
      if (!data.config.llm) {
        llmCard.append(h('div', { class: 'flex-row gap-sm mt-sm' }, [
          h('span', { class: 'hint', text: 'No per-world routing — using engine defaults.' }),
          h('button', { class: 'btn btn-ghost', text: 'Initialize from engine defaults', onclick: () => { data.config.llm = JSON.parse(JSON.stringify(reg.llmDefaultRouter)); renderLlm(); } }),
        ]));
        return;
      }
      const llm = data.config.llm;
      if (!llm.default) llm.default = { provider: (reg.llmProviders || [])[0] || '', model: (reg.llmModels || [])[0] || '' };
      if (!llm.routes) llm.routes = {};
      const tbl = h('table');
      tbl.append(h('thead', {}, [h('tr', {}, ['Task', 'Provider', 'Model', 'MaxTok', 'Temp', 'Warm', 'Schema', 'Fallback', ''].map(t => h('th', { text: t })))]));
      const tb = h('tbody');
      tb.append(h('tr', {}, [h('td', { html: '<b>default</b>' }), ...routeCells(llm.default, null)]));
      (reg.llmTasks || []).forEach(task => {
        const r = llm.routes[task];
        if (r) {
          tb.append(h('tr', {}, [h('td', { text: task }), ...routeCells(r, task), ]));
          tb.lastChild.append(h('td', {}, [h('button', { class: 'btn btn-danger', text: 'reset', title: 'use default for this task', onclick: () => { delete llm.routes[task]; renderLlm(); } })]));
        } else {
          tb.append(h('tr', { style: { opacity: '0.55' } }, [
            h('td', { text: task }),
            h('td', { colspan: '7', html: '<span style="font-size:0.72rem;color:var(--muted)">inherits default</span>' }),
            h('td', {}, [h('button', { class: 'btn btn-ghost', text: '+ override', onclick: () => { llm.routes[task] = JSON.parse(JSON.stringify(llm.default)); renderLlm(); } })]),
          ]));
        }
      });
      tbl.append(tb);
      llmCard.append(tbl);
      llmCard.append(h('button', { class: 'btn btn-danger mt-sm', text: 'Clear (revert to engine defaults)', onclick: () => { delete data.config.llm; renderLlm(); } }));
    }
    renderLlm();
    $content.append(llmCard);
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
