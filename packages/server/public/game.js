/* ================================================================
   CLWA — Canvas2D Game Client
   Sprites from Tiny Swords, WS connection to backend
   ================================================================ */
'use strict';

// ─── CONFIG ───
const TILE = 64;
const MAP_W = 30, MAP_H = 20;
const NPC_SPEED = 100; // px/sec (default, overridden by transit duration)
const PLAYER_SPEED = 160;
const SPRITE_SCALE = 0.45;
const FRAME_MS = 120; // sprite animation frame duration

// ─── LOCATION LAYOUT ───
// Positions from Godot zone polygon centers (world pixels, original)
const LOCATIONS = {
  'town-square':          { px: 316,  py: 188,  label: 'Town Square' },
  'town-gate':            { px: 320,  py: -384, label: 'Town Gate' },
  'market-square':        { px: -352, py: -208, label: 'Market Square' },
  'blacksmith':           { px: -896, py: 21,   label: 'Blacksmith' },
  'temple-of-dawn':       { px: 1141, py: 128,  label: 'Temple of Dawn' },
  'silver-flagon-tavern': { px: -486, py: 422,  label: 'Silver Flagon Tavern' },
  'residential-lane':     { px: 192,  py: 800,  label: 'Residential Lane' },
  'courthouse':           { px: 896,  py: 768,  label: 'Courthouse' },
};

const ROADS = [
  ['town-square','town-gate'], ['town-square','market-square'],
  ['town-square','temple-of-dawn'], ['town-square','residential-lane'],
  ['town-square','courthouse'], ['town-square','silver-flagon-tavern'],
  ['market-square','blacksmith'], ['residential-lane','courthouse'],
];

// ─── ROAD PATHFINDING ───
// Build adjacency graph from ROADS
const ROAD_GRAPH = {};
for (const [a, b] of ROADS) {
  if (!ROAD_GRAPH[a]) ROAD_GRAPH[a] = [];
  if (!ROAD_GRAPH[b]) ROAD_GRAPH[b] = [];
  ROAD_GRAPH[a].push(b);
  ROAD_GRAPH[b].push(a);
}

// BFS shortest path between two locations
function findPath(fromLoc, toLoc) {
  if (fromLoc === toLoc) return [];
  const queue = [[fromLoc]];
  const visited = new Set([fromLoc]);
  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];
    for (const neighbor of (ROAD_GRAPH[current] || [])) {
      if (neighbor === toLoc) return [...path.slice(1), neighbor]; // skip fromLoc itself
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }
  return [toLoc]; // fallback direct
}

// ─── A* PATHFINDING ON TILEMAP GRID ───
// NPC can only walk on tiles that exist in mapData (grass/cliff = walkable, no tile = water)
let walkableGrid = null; // Set of "tx,ty" strings

const tileCost = {}; // "tx,ty" → movement cost (higher = avoid)

function buildWalkableGrid() {
  if (!mapData) return;
  walkableGrid = new Set();
  for (const [tx, ty] of mapData.tiles) {
    walkableGrid.add(tx + ',' + ty);
  }
  // Calculate cost per tile: edge tiles are more expensive (NPC prefer center paths)
  for (const [tx, ty] of mapData.tiles) {
    let neighbors = 0;
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[1,1],[-1,-1],[1,-1],[-1,1]]) {
      if (walkableGrid.has((tx+dx) + ',' + (ty+dy))) neighbors++;
    }
    // 8 neighbors = center (cost 1.0). Fewer neighbors = much more expensive
    // This forces pathfinding to strongly prefer interior tiles
    if (neighbors <= 3) tileCost[tx + ',' + ty] = 8;      // very edge — avoid
    else if (neighbors <= 5) tileCost[tx + ',' + ty] = 3;  // edge-ish — expensive
    else tileCost[tx + ',' + ty] = 1;                       // interior — cheap
  }
}

function isWalkable(tx, ty) {
  return walkableGrid && walkableGrid.has(tx + ',' + ty);
}

/** Total pixel distance along a waypoint path */
function pathLength(waypoints, startX, startY) {
  let d = 0, px = startX, py = startY;
  for (const wp of waypoints) {
    d += Math.sqrt((wp.x - px) ** 2 + (wp.y - py) ** 2);
    px = wp.x; py = wp.y;
  }
  return d;
}

// A* from pixel coords to pixel coords, returns waypoints in pixels
function astarPath(fromX, fromY, toX, toY) {
  if (!walkableGrid) return [{ x: toX, y: toY }];

  const ts = 64;
  const startTx = Math.round(fromX / ts), startTy = Math.round(fromY / ts);
  const endTx = Math.round(toX / ts), endTy = Math.round(toY / ts);

  if (startTx === endTx && startTy === endTy) return [{ x: toX, y: toY }];

  // A* on tile grid
  const openSet = [{ tx: startTx, ty: startTy, g: 0, f: 0, parent: null }];
  const closed = new Set();
  const key = (x, y) => x + ',' + y;

  const heuristic = (tx, ty) => Math.abs(tx - endTx) + Math.abs(ty - endTy);
  openSet[0].f = heuristic(startTx, startTy);

  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
  const dirCost = [1,1,1,1, 1.41,1.41,1.41,1.41];

  let found = null;
  let iterations = 0;
  const maxIter = 2000;

  while (openSet.length > 0 && iterations++ < maxIter) {
    // Find lowest f
    let bestIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].f < openSet[bestIdx].f) bestIdx = i;
    }
    const current = openSet.splice(bestIdx, 1)[0];
    const ck = key(current.tx, current.ty);

    if (current.tx === endTx && current.ty === endTy) {
      found = current;
      break;
    }

    if (closed.has(ck)) continue;
    closed.add(ck);

    for (let d = 0; d < dirs.length; d++) {
      const ntx = current.tx + dirs[d][0], nty = current.ty + dirs[d][1];
      const nk = key(ntx, nty);
      if (closed.has(nk)) continue;
      if (!isWalkable(ntx, nty)) continue;

      // For diagonal, check that both adjacent cardinal tiles are walkable (no corner cutting)
      if (d >= 4) {
        if (!isWalkable(current.tx + dirs[d][0], current.ty) || !isWalkable(current.tx, current.ty + dirs[d][1])) continue;
      }

      const ng = current.g + dirCost[d] * (tileCost[nk] || 1);
      const nf = ng + heuristic(ntx, nty);
      openSet.push({ tx: ntx, ty: nty, g: ng, f: nf, parent: current });
    }
  }

  if (!found) return [{ x: toX, y: toY }]; // fallback direct

  // Reconstruct path
  const tilePath = [];
  let node = found;
  while (node) {
    tilePath.unshift({ x: node.tx * ts, y: node.ty * ts });
    node = node.parent;
  }

  // Simplify: remove collinear points, keep turns only
  const simplified = [tilePath[0]];
  for (let i = 1; i < tilePath.length - 1; i++) {
    const prev = tilePath[i-1], curr = tilePath[i], next = tilePath[i+1];
    const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
    if (dx1 !== dx2 || dy1 !== dy2) {
      simplified.push(curr);
    }
  }
  simplified.push({ x: toX, y: toY }); // exact destination

  return simplified;
}

// Generate waypoints using A* on tilemap
function roadWaypoints(fromLoc, toLoc) {
  const from = LOCATIONS[fromLoc] || LOCATIONS['town-square'];
  const to = LOCATIONS[toLoc] || LOCATIONS['town-square'];

  // Find NPC's current position for start, not location center
  return astarPath(from.px, from.py, to.px, to.py);
}

// NPC → Tiny Swords unit mapping
const UNIT_MAP = {
  ted:     { unit:'Pawn', color:'Red', item:' Meat' },
  mark:    { unit:'Pawn', color:'Yellow', item:' Gold' },
  elara:   { unit:'Monk', color:'Purple', item:'' },
  garrett: { unit:'Warrior', color:'Red', item:'' },
  aldric:  { unit:'Monk', color:'Yellow', item:'' },
  hilda:   { unit:'Pawn', color:'Red', item:' Hammer' },
  bess:    { unit:'Monk', color:'Blue', item:'' },
  magistrate: { unit:'Warrior', color:'Purple', item:'' },
  player:     { unit:'Warrior', color:'Blue', item:'' },
};

// NPC → Avatar mapping (Tiny Swords Human Avatars)
const AVATAR_MAP = {
  garrett:     '06', ted: '09', hilda: '09', mark: '14',
  elara:       '20', aldric: '15', bess: '05', magistrate: '16',
  player:      '01',
};

// ─── STATE ───
const state = {
  agents: {},       // id → { name, role, location, mood, alive, status, x, y, targetX, targetY, moving, frames, frameIdx, animTimer }
  player: { x: 15*TILE, y: 8*TILE, sprites: null, frameIdx: 0, animTimer: 0, flipH: false, moving: false },
  camera: { fx: 0, fy: 0, zoom: 1.0 },  // fx,fy = world focus point (center of screen)
  day: 1, time: '07:00', period: 'morning',
  ws: null, connected: false,
  keys: {},
  events: [],
  chatOpen: false, chatNpcId: null, chatMessages: [], _pendingILEffects: null,
  crimeScenes: [], approachingNpc: null, actionEffects: [],
  autoTick: false, gameSpeed: 1,
  hoveredNpc: null,
};

// ─── CANVAS ───
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const dpr = window.devicePixelRatio || 1;

function resizeCanvas() {
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ─── SPRITE LOADER ───
const spriteCache = {};

function loadSprite(path) {
  if (spriteCache[path]) return spriteCache[path];
  const img = new Image();
  img.src = path;
  spriteCache[path] = img;
  return img;
}

function getUnitSprites(npcId) {
  const map = UNIT_MAP[npcId] || { unit:'Warrior', color:'Blue', item:'' };
  const base = `/assets/tinyswords/Units/${map.color} Units/${map.unit}/`;
  let idleName, runName;
  if (map.unit === 'Pawn') {
    idleName = `Pawn_Idle${map.item}.png`;
    runName = `Pawn_Run${map.item}.png`;
  } else if (map.unit === 'Monk') {
    idleName = 'Idle.png'; runName = 'Run.png';
  } else {
    idleName = `${map.unit}_Idle.png`; runName = `${map.unit}_Run.png`;
  }
  return {
    idle: loadSprite(base + idleName),
    run: loadSprite(base + runName),
  };
}

function getBuildingSprite(locId) {
  const map = {
    'silver-flagon-tavern': '/assets/tinyswords/Buildings/Red Buildings/House2.png',
    'blacksmith':           '/assets/tinyswords/Buildings/Red Buildings/Barracks.png',
    'temple-of-dawn':       '/assets/tinyswords/Buildings/Yellow Buildings/Monastery.png',
    'courthouse':           '/assets/tinyswords/Buildings/Purple Buildings/Castle.png',
    'town-gate':            '/assets/tinyswords/Buildings/Blue Buildings/Tower.png',
    'residential-lane':     '/assets/tinyswords/Buildings/Blue Buildings/House1.png',
  };
  return map[locId] ? loadSprite(map[locId]) : null;
}

// ─── LOCATION HELPERS ───
function locCenter(id) {
  const l = LOCATIONS[id];
  if (!l) return { x: 316, y: 188 }; // fallback to town-square
  return { x: l.px, y: l.py };
}

// ─── MOOD COLOR ───
function moodColor(mood) {
  if (mood > 0) {
    const t = Math.min(mood, 1);
    return `rgba(${Math.round(80+170*(1-t))}, ${Math.round(200)}, ${Math.round(80)}, 0.5)`;
  } else {
    const t = Math.min(-mood, 1);
    return `rgba(${Math.round(220)}, ${Math.round(200*(1-t))}, ${Math.round(80*(1-t))}, 0.5)`;
  }
}

// ─── MAP DATA ───
let mapData = null;
const atlasImg = new Image();

async function loadMapData() {
  try {
    const res = await fetch('/map-data.json');
    mapData = await res.json();
    atlasImg.src = mapData.atlasPath;
    // Update location positions to match map bounds offset
    // Map tiles go from minX to maxX — pixel offset = minX * TILE
    console.log('[Map] Loaded', mapData.tiles.length, 'tiles, bounds:', mapData.bounds);
  } catch(e) {
    console.log('[Map] No map-data.json, using fallback');
  }
}

// ─── INIT ───
async function init() {
  await loadMapData();
  buildWalkableGrid();

  try {
    const res = await fetch('/api/agents');
    if (!res.ok) throw new Error(`agents: ${res.status}`);
    const agents = await res.json();
    for (const a of agents) {
      const sprites = getUnitSprites(a.id);
      state.agents[a.id] = {
        name: a.name, role: a.role, location: a.location,
        mood: a.mood, alive: a.alive, status: a.status || '',
        background: a.background || '',
        hasShop: a.hasShop || false,
        investigator: a.investigator || false,
        chatHistory: loadChatHistory(a.id),
        x: a.x ?? 0, y: a.y ?? 0, targetX: a.x ?? 0, targetY: a.y ?? 0,
        moving: false, waypoints: [], wpIdx: 0,
        sprites, frameIdx: 0, animTimer: 0, flipH: false,
      };
    }

    const playerRes = await fetch('/api/player');
    if (!playerRes.ok) throw new Error(`player: ${playerRes.status}`);
    const playerData = await playerRes.json();
    if (playerData.id) state.player.id = playerData.id;
    if (playerData.x != null && playerData.y != null && (playerData.x || playerData.y)) {
      state.player.x = playerData.x; state.player.y = playerData.y;
    } else {
      const sq = locCenter('town-square');
      state.player.x = sq.x; state.player.y = sq.y;
    }
    state.player.sprites = getUnitSprites('player');

    const timeRes = await fetch('/api/time');
    if (!timeRes.ok) throw new Error(`time: ${timeRes.status}`);
    const timeData = await timeRes.json();
    state.day = timeData.gameDay; state.time = timeData.hour; state.period = timeData.period;
    state.gameSpeed = timeData.gameSpeed ?? 1;
    syncSpeedButtons(state.gameSpeed);
    updateHUD();
  } catch (e) {
    showToast('Server unavailable — retrying...', 'info', 4000);
    setTimeout(init, 3000);
    return;
  }

  // Load journal state
  try {
    const [journalRes, suspectsRes] = await Promise.all([
      fetch('/api/journal'),
      fetch('/api/journal/suspects'),
    ]);
    const journalData = await journalRes.json();
    if (Array.isArray(journalData)) {
      _journalEntries.length = 0;
      _journalEntries.push(...journalData);
    }
    const suspectsData = await suspectsRes.json();
    if (Array.isArray(suspectsData)) {
      _journalSuspects.clear();
      for (const s of suspectsData) _journalSuspects.add(s.id);
    }
    renderJournal();
  } catch { /* journal not critical */ }

  // WS
  connectWS();

  // Input
  window.addEventListener('keydown', e => {
    state.keys[e.key.toLowerCase()] = true;
    // E key — interact with nearest NPC
    if (e.key.toLowerCase() === 'e' && !state.chatOpen) {
      const nearest = findNearestNpc(state.player.x, state.player.y, 100);
      if (nearest) openChat(nearest);
    }
    // Escape — close chat
    if (e.key === 'Escape' && state.chatOpen) closeChat();
    // Focus trap in chat panel
    if (e.key === 'Tab' && state.chatOpen) {
      const panel = document.getElementById('chat-panel');
      const focusable = panel.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])');
      if (focusable.length) {
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
  });
  window.addEventListener('keyup', e => { state.keys[e.key.toLowerCase()] = false; });
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('mousemove', onCanvasMouseMove);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // Load seed
  fetch('/api/seed').then(r => r.json()).then(d => {
    const el = document.getElementById('hud-seed');
    el.textContent = `#${d.seed}`;
    el.dataset.seed = d.seed;
  }).catch(err => console.warn('[Fetch]', err));

  // Buttons
  document.getElementById('btn-tick').onclick = () => fetch('/api/tick', {method:'POST'});
  document.getElementById('btn-day').onclick = () => fetch('/api/day', {method:'POST'});
  document.getElementById('btn-auto').onclick = toggleAuto;
  document.getElementById('btn-new-game').onclick = newGame;
  // Check server auto-tick state
  fetch('/api/auto-state').then(r => r.json()).then(d => {
    state.autoTick = d.running;
    if (state.autoTick) {
      document.getElementById('btn-auto').textContent = 'Auto: ON';
      document.getElementById('btn-auto').classList.add('active');
    }
  }).catch(err => console.warn('[Fetch]', err));
  document.getElementById('chat-close').onclick = closeChat;
  document.getElementById('chat-form').onsubmit = sendChat;

  // Minimap
  initMinimap();

  // Start game loop
  requestAnimationFrame(gameLoop);
}

// ─── WEBSOCKET ───
function sendWS(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(msg));
  }
}

function connectWS() {
  state.ws = new WebSocket(`ws://${location.host}/ws`);
  state.ws.onopen = () => { state.connected = true; document.getElementById('ws-status').className = 'connected'; };
  state.ws.onclose = () => { state.connected = false; document.getElementById('ws-status').className = ''; if (!state._wsReconnectTimer) state._wsReconnectTimer = setTimeout(() => { state._wsReconnectTimer = null; connectWS(); }, 2000); };
  state.ws.onerror = () => { console.error('[WS Error]'); };
  state.ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleWS(msg.type, msg.data);
    } catch (err) {
      console.error('[WS Parse Error]', err);
    }
  };
}

function handleWS(type, data) {
  switch(type) {
    case 'tick':
      state.day = data.gameDay;
      if (data.time) { state.time = data.time.hour; state.period = data.time.period; }
      updateHUD();
      break;

    case 'time_update':
      state.time = data.hour;
      state.period = data.period;
      state.day = data.gameDay;
      if (data.gameSpeed != null && data.gameSpeed !== state.gameSpeed) {
        state.gameSpeed = data.gameSpeed;
        syncSpeedButtons(state.gameSpeed);
      }
      updateHUD();
      break;

    case 'movement': {
      const moves = Array.isArray(data) ? data : [];
      for (const m of moves) {
        const npc = Object.values(state.agents).find(a => a.name === m.agentName);
        if (!npc) continue;
        npc.location = m.to;

        if (m.arrived) {
          // NPC arrived — update location, let animation finish naturally
          // Only snap if NPC is far from destination (e.g. reconnect/desync)
          const tx = m.targetX ?? m.x ?? npc.x;
          const ty = m.targetY ?? m.y ?? npc.y;
          const dx = tx - npc.x, dy = ty - npc.y;
          const distToTarget = Math.sqrt(dx * dx + dy * dy);
          if (distToTarget > 150) {
            // Far away — snap (reconnect scenario)
            npc.x = tx; npc.y = ty;
            npc.moving = false;
            npc.waypoints = [];
          }
          // Close or walking — let client animation finish, just clear transit state
          npc.transitDist = 0;
          npc.transitDuration = 0;
        } else {
          // Start walking to target
          const tx = m.targetX ?? 0, ty = m.targetY ?? 0;
          npc.waypoints = astarPath(npc.x, npc.y, tx, ty);
          npc.wpIdx = 0;
          npc.moving = true;
          if (m.transitDuration > 0) {
            npc.transitDist = pathLength(npc.waypoints, npc.x, npc.y);
            npc.transitDuration = m.transitDuration;
          } else {
            npc.transitDist = 0;
            npc.transitDuration = 0;
          }
          addEvent('movement', `${m.agentName} → ${LOCATIONS[m.to]?.label || m.to}`);
        }
      }
      break;
    }

    case 'conversation:line': {
      addEvent('conversation', `${data.speakerName}: "${data.text}"`);
      // Show speech bubble above NPC with typewriter effect
      const speaker = Object.values(state.agents).find(a => a.name === data.speakerName);
      if (speaker) {
        const fullText = data.text.length > 60 ? data.text.slice(0, 57) + '...' : data.text;
        speaker._speech = { fullText, text: '', charIdx: 0, timer: 4.0, typing: true };
      }
      if (state.chatOpen && state.chatNpcId) {
        const a = state.agents[state.chatNpcId];
        if (a && a.name === data.speakerName) {
          addChatMessage(data.speakerName, data.text, 'npc');
        }
      }
      break;
    }

    case 'conversation:complete': {
      // Use server-authoritative approach points
      const ap = data.approachPoints;
      if (ap) {
        const initNpc = Object.values(state.agents).find(a => a.name === data.initiator);
        const respNpc = Object.values(state.agents).find(a => a.name === data.responder);
        if (initNpc) { initNpc.waypoints = astarPath(initNpc.x, initNpc.y, ap.ax, ap.ay); initNpc.wpIdx = 0; initNpc.moving = true; initNpc.transitDist = 0; initNpc.transitDuration = 0; }
        if (respNpc) { respNpc.waypoints = astarPath(respNpc.x, respNpc.y, ap.bx, ap.by); respNpc.wpIdx = 0; respNpc.moving = true; respNpc.transitDist = 0; respNpc.transitDuration = 0; }
      }
      break;
    }

    case 'event': {
      const evType = data.type || '';
      const subjectAgent = data.subject ? state.agents[data.subject] : null;
      const objectAgent = data.object ? state.agents[data.object] : null;
      const subjectName = subjectAgent?.name || data.subject || '?';
      const objectName = objectAgent?.name || data.object || '?';

      // Enriched event feed text
      const isCrime = evType.includes('KILL') || evType.includes('STOLEN');
      let feedText;
      if (evType === 'NPC_ARRESTED') feedText = `${subjectName} arrested ${objectName}`;
      else if (evType === 'NPC_SENTENCED') feedText = `${objectName} was ${data.payload?.verdict || 'sentenced'}`;
      else if (evType === 'BODY_DISCOVERED') feedText = `${subjectName} discovered a body`;
      else if (evType === 'GOODS_STOLEN') feedText = `Theft at ${data.location || '?'}`;
      else if (evType === 'NPC_FLED') feedText = `${objectName} fled the town`;
      else if (evType === 'NPC_KILLED') feedText = `${subjectName} killed ${objectName}`;
      else if (evType === 'ARGUMENT_WITNESSED') feedText = `${subjectName} argued with ${objectName}`;
      else if (evType === 'THREAT_WITNESSED') feedText = `${subjectName} threatened ${objectName}`;
      else if (evType === 'WITNESS_INTIMIDATED') feedText = `${subjectName} intimidated ${objectName}`;
      else if (evType === 'EVIDENCE_DESTROYED') feedText = `${subjectName} destroyed evidence`;
      else feedText = `${evType}: ${subjectName} → ${objectName}`;
      addEvent(isCrime ? 'crime' : evType === 'NPC_ARRESTED' ? 'crime' : 'conversation', feedText);

      // State updates + toasts
      if (evType === 'NPC_ARRESTED' && objectAgent) {
        objectAgent.status = 'detained';
        showToast(`${subjectName} arrested ${objectName}`, 'arrest');
      } else if (evType === 'NPC_SENTENCED') {
        const verdict = data.payload?.verdict || 'sentenced';
        if (objectAgent) objectAgent.status = verdict;
        showToast(`${objectName} was ${verdict}`, 'sentence');
      } else if (evType === 'BODY_DISCOVERED') {
        showToast(`${subjectName} discovered a body!`, 'discovery');
      } else if (evType === 'GOODS_STOLEN') {
        showToast(`Goods stolen at ${data.location || '?'}`, 'theft');
      } else if (evType === 'NPC_FLED') {
        if (objectAgent) objectAgent.status = 'fled';
        showToast(`${objectName} fled the town!`, 'sentence');
      } else if (evType === 'ARGUMENT_WITNESSED') {
        showToast(`${subjectName} is arguing with ${objectName}!`, 'info', 4000);
      } else if (evType === 'THREAT_WITNESSED') {
        showToast(`${subjectName} threatened ${objectName}!`, 'crime', 5000);
      }
      break;
    }

    case 'murder':
      const victim = Object.values(state.agents).find(a => a.name === data.victimName);
      if (victim) { victim.alive = false; }
      addEvent('crime', `${data.killerName} killed ${data.victimName}!`);
      showToast(`${data.killerName} killed ${data.victimName}!`, 'murder');
      break;

    case 'npc_thought':
      // Only show thought bubble for non-talk actions (crime, duty, etc)
      if (data.action && data.action !== 'talk') {
        const tNpc = state.agents[data.npcId];
        if (tNpc) tNpc._thought = { text: `${data.instinctTier}: ${data.action}`, timer: 4.0 };
      }
      addEvent('thought', `${data.npcName}: ${data.action} (${data.instinctTier})`);
      break;

    case 'mood_update': {
      const mNpc = state.agents[data.npcId];
      if (mNpc) {
        mNpc.mood = data.newMood;
        // Mood visual cue — pulse on significant shift
        if (Math.abs(data.newMood - data.oldMood) > 0.05) {
          mNpc._moodPulse = { timer: 1.0, positive: data.newMood > data.oldMood };
        }
      }
      if (state.chatOpen && state.chatNpcId === data.npcId) {
        updateChatMoodBar(data.newMood);
      }
      if (Math.abs(data.newMood - data.oldMood) > 0.05) {
        addEvent('mood', `${data.npcName} mood: ${data.oldMood.toFixed(2)} → ${data.newMood.toFixed(2)}`);
      }
      break;
    }

    case 'state:update': {
      const suNpc = state.agents[data.agentId];
      if (suNpc) {
        if (data.mood != null) suNpc.mood = data.mood;
        if (data.alive != null) suNpc.alive = data.alive;
        if (data.location != null) suNpc.location = data.location;
        if (data.status != null) suNpc.status = data.status;
      }
      if (state.chatOpen && state.chatNpcId === data.agentId && data.mood != null) {
        updateChatMoodBar(data.mood);
      }
      break;
    }

    case 'relationship_change': {
      // Update trust/sentiment in chat panel if open for this NPC→player
      if (state.chatOpen && data.fromId === state.chatNpcId && data.toId === 'player') {
        // Re-fetch full relationship to get both trust and sentiment
        fetch(`/api/relationships/${data.fromId}`).then(r => r.json()).then(rels => {
          if (state.chatNpcId !== data.fromId) return;
          const playerRel = rels.find(r => r.targetId === 'player');
          if (playerRel) updateChatTrustBar(playerRel.trust, playerRel.sentiment);
        }).catch(err => console.warn('[Fetch]', err));
      }
      break;
    }

    case 'goal_update':
      addEvent('movement', `${data.npcName || data.npcId}: ${data.goalType} (${data.status})`);
      break;

    case 'goal:action':
      addEvent('thought', `${data.ownerName}: ${data.description}`);
      spawnActionEffect(data);
      break;

    case 'event_cascade':
      for (const c of (data.consequences || [])) {
        const label = {
          'WITNESS_MEMORY': 'witnessed', 'RUMOR_SPREAD': 'rumor spreads',
          'WANTED_STATUS': 'wanted', 'COVER_UP': 'covering up',
          'REPORT_IMPULSE': 'eager to report', 'REVENGE_IMPULSE': 'seeks revenge',
          'GUARD_WARNING': 'guard warned', 'CORRUPTION_COVER': 'guard looks away',
          'ARREST_RESENTMENT': 'resents arrest',
        }[c.type] ?? c.type;
        addEvent('crime', `  ↳ ${label}${c.subject ? ': ' + c.subject : ''}`);
      }
      break;

    case 'chat:token':
      if (state.chatOpen) appendChatToken(data.token);
      break;

    case 'chat:done':
      finalizeChatStream();
      break;

    case 'shop:open':
      if (state.chatOpen && data.agentId === state.chatNpcId) {
        state._shopData = data;
        const btn = document.getElementById('btn-shop');
        btn.style.display = 'inline-block';
        btn.classList.add('glow');
        setTimeout(() => btn.classList.remove('glow'), 3000);
      }
      break;

    case 'crime:scene':
      if (!state.crimeScenes) state.crimeScenes = [];
      state.crimeScenes.push({ id: data.id, locationId: data.locationId, crimeType: data.crimeType });
      showToast(`Crime scene at ${LOCATIONS[data.locationId]?.label || data.locationId}`, 'crime');
      // If player is at this location, trigger examine panel refresh
      if (state._examineLocationId === data.locationId) {
        state._examineLocationId = null; // force re-fetch
        state._examineSceneData = null;
      }
      break;

    case 'npc_approach': {
      state.approachingNpc = data.npcId;
      const approachText = data.displayText || `${data.npcName} wants to talk to you`;
      showToast(approachText, 'approach');
      addEvent('approach', approachText);
      break;
    }

    case 'journal:entry':
      addJournalEntry(data);
      if (state.chatOpen) updateDetectiveHint(state.chatNpcId);
      break;

    case 'il_result':
      // Store pending effects — will be attached to NPC response on chat:done
      if (state.chatOpen && data.agentId === state.chatNpcId) {
        state._pendingILEffects = data.effects || [];
      }
      break;

    case 'new_game':
      console.log('[NewGame] Server restarted with seed:', data.seed);
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('chat_')) localStorage.removeItem(key);
      }
      localStorage.removeItem('autoTick');
      location.reload();
      break;
  }
}

// ─── HUD ───
function updateHUD() {
  document.getElementById('hud-day').textContent = state.day;
  document.getElementById('hud-time').textContent = state.time;
  document.getElementById('hud-period').textContent = state.period;
}

// ─── ACTION EFFECTS ───
const ACTION_EFFECT_CONFIG = {
  attack_npc:       { color: '#ff4444', icon: '⚔', label: 'ATTACK',      duration: 3, line: true },
  arrest_npc:       { color: '#4488ff', icon: '⛓', label: 'ARREST',      duration: 4, line: true },
  steal_from:       { color: '#ccaa44', icon: '💰', label: 'STEAL',       duration: 2.5, line: true },
  examine_scene:    { color: '#44ddaa', icon: '🔍', label: 'EXAMINE',     duration: 3, line: false },
  sentence_npc:     { color: '#aa44ff', icon: '⚖', label: 'SENTENCE',    duration: 4, line: true },
  destroy_evidence: { color: '#ff8844', icon: '🔥', label: 'DESTROY',     duration: 2.5, line: false },
  flee:             { color: '#888888', icon: '💨', label: 'FLEE',         duration: 2, line: false },
  interact:         { color: '#88bbdd', icon: '💬', label: '',            duration: 2, line: true },
};

function spawnActionEffect(data) {
  const owner = state.agents[data.ownerId];
  if (!owner) return;

  const cfg = ACTION_EFFECT_CONFIG[data.action];
  if (!cfg) return; // move_to, wait, announce — no visual

  // Determine target position for line effect
  let targetX = null, targetY = null;
  if (cfg.line) {
    const targetId = data.interaction?.targetId || data.crimeEvent?.targetId;
    const target = targetId ? state.agents[targetId] : null;
    if (target) { targetX = target.x; targetY = target.y; }
  }

  // Refine label for interact subtypes based on goalType
  let label = cfg.label;
  if (data.action === 'interact') {
    const gt = data.goalType || '';
    if (gt.includes('interrogat'))   label = 'INTERROGATE';
    else if (gt.includes('confront')) label = 'CONFRONT';
    else if (gt.includes('testif'))   label = 'TESTIFY';
    else if (gt.includes('report'))   label = 'REPORT';
    else if (gt.includes('leverage') || gt.includes('blackmail')) label = 'BLACKMAIL';
    else if (gt.includes('intimidat')) label = 'INTIMIDATE';
  }

  // Refine color for confront/interrogate
  let color = cfg.color;
  if (label === 'CONFRONT')    color = '#dd6644';
  if (label === 'INTERROGATE') color = '#ddaa44';
  if (label === 'BLACKMAIL')   color = '#aa44aa';

  state.actionEffects.push({
    x: owner.x, y: owner.y,
    targetX, targetY,
    color, icon: cfg.icon, label,
    timer: cfg.duration, maxTimer: cfg.duration,
    line: cfg.line && targetX != null,
  });
}

function updateActionEffects(dt) {
  for (let i = state.actionEffects.length - 1; i >= 0; i--) {
    state.actionEffects[i].timer -= dt;
    if (state.actionEffects[i].timer <= 0) state.actionEffects.splice(i, 1);
  }
  // Mood pulse decay
  for (const a of Object.values(state.agents)) {
    if (a._moodPulse) {
      a._moodPulse.timer -= dt;
      if (a._moodPulse.timer <= 0) a._moodPulse = null;
    }
  }
}

function drawActionEffects() {
  for (const fx of state.actionEffects) {
    const alpha = Math.min(1, fx.timer / (fx.maxTimer * 0.3)); // fade out in last 30%

    // Line between actors
    if (fx.line) {
      const r = parseInt(fx.color.slice(1,3),16), g = parseInt(fx.color.slice(3,5),16), b = parseInt(fx.color.slice(5,7),16);
      ctx.strokeStyle = `rgba(${r},${g},${b},${alpha * 0.4})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(fx.x, fx.y);
      ctx.lineTo(fx.targetX, fx.targetY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }

    // Pulsing ring around actor
    const pulse = 0.6 + Math.sin(Date.now() / 200) * 0.3;
    const r2 = parseInt(fx.color.slice(1,3),16), g2 = parseInt(fx.color.slice(3,5),16), b2 = parseInt(fx.color.slice(5,7),16);
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, 28 + Math.sin(Date.now() / 300) * 4, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${r2},${g2},${b2},${alpha * pulse})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 1;

    // Icon + label above
    if (fx.label) {
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(${r2},${g2},${b2},${alpha})`;
      ctx.fillText(`${fx.icon} ${fx.label}`, fx.x, fx.y - 60);
    }
  }
}

// ─── TOAST NOTIFICATIONS ───
function showToast(text, type = 'info', duration = 5000) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = text;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 400);
  }, duration);
}

// ─── SHOP ───
function toggleShop() {
  const panel = document.getElementById('shop-panel');
  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    return;
  }
  const data = state._shopData;
  if (!data) return;
  const container = document.getElementById('shop-items');
  container.innerHTML = '';
  for (const item of data.items) {
    const div = document.createElement('div');
    div.className = 'shop-item';
    div.innerHTML = `
      <div>
        <div class="shop-item-name">${escapeHTML(item.name)}</div>
        <div class="shop-item-desc">${escapeHTML(item.description)}</div>
      </div>
      <span class="shop-item-price">${item.price}g</span>
    `;
    container.appendChild(div);
  }
  panel.classList.add('open');
}

function closeShop() {
  document.getElementById('shop-panel').classList.remove('open');
  document.getElementById('btn-shop').style.display = 'none';
  state._shopData = null;
}

// ─── EXAMINE CRIME SCENE ───
const EXAMINE_VERBS = { body: 'Look closer', trail: 'Follow it', object: 'Pick it up', weapon: 'Pick it up', bloodstain: 'Inspect' };

function updateExaminePanel() {
  // Show/hide the "Investigate" button when near a crime scene
  const btn = document.getElementById('btn-examine');
  if (!btn) return;
  if (!state.crimeScenes || state.crimeScenes.length === 0 || state.chatOpen) {
    btn.style.display = 'none';
    return;
  }
  const nearby = state.crimeScenes.find(cs => {
    const loc = LOCATIONS[cs.locationId];
    if (!loc) return false;
    const dx = state.player.x - loc.px, dy = state.player.y - loc.py;
    return Math.sqrt(dx*dx + dy*dy) < 200;
  });
  if (nearby) {
    btn.style.display = 'inline-block';
    btn.dataset.locationId = nearby.locationId;
  } else {
    btn.style.display = 'none';
    state._examineLocationId = null;
    state._examineSceneData = null;
  }
}

function openExaminePanel() {
  const btn = document.getElementById('btn-examine');
  const locationId = btn?.dataset?.locationId;
  if (!locationId) return;
  const panel = document.getElementById('examine-panel');
  if (state._examineLocationId !== locationId) {
    state._examineLocationId = locationId;
    state._examineSceneData = null;
    fetchExamineScene(locationId);
  }
  if (state._examineSceneData) panel.style.display = 'block';
}

function closeExaminePanel() {
  document.getElementById('examine-panel').style.display = 'none';
}

async function fetchExamineScene(locationId) {
  try {
    const res = await fetch(`/api/crime-scene/${encodeURIComponent(locationId)}`);
    if (!res.ok) { state._examineLocationId = null; return; }
    const data = await res.json();
    if (!data.points || data.points.length === 0) {
      showToast('Nothing to examine here', 'info');
      state._examineLocationId = null; return;
    }
    state._examineSceneData = data;
    renderExaminePanel(data);
    document.getElementById('examine-panel').style.display = 'block';
  } catch { state._examineLocationId = null; }
}

function renderExaminePanel(data) {
  const panel = document.getElementById('examine-panel');
  const allExamined = data.points.every(p => p.examined);
  let html = `<div class="examine-title">Crime Scene <span style="float:right;cursor:pointer;opacity:0.5" onclick="closeExaminePanel()">&times;</span></div>`;
  html += `<div class="examine-intro">You survey the scene and notice several things worth investigating:</div>`;

  for (const pt of data.points) {
    if (pt.examined) {
      html += `<div class="examine-point examined">
        <div class="examine-point-desc">\u2713 ${escapeHTML(pt.description)}</div>
        <div class="examine-point-clue">${escapeHTML(pt.clueText)}</div>
      </div>`;
    } else {
      const verb = EXAMINE_VERBS[pt.type] || 'Inspect';
      html += `<div class="examine-point" id="ep-${pt.id}">
        <div class="examine-point-desc">\uD83D\uDD0D ${escapeHTML(pt.description)}</div>
        <button class="examine-btn" onclick="examinePoint('${escapeAttr(data.locationId)}','${escapeAttr(pt.id)}')">${escapeHTML(verb)}</button>
      </div>`;
    }
  }

  if (allExamined) {
    html += `<div class="examine-done">You've examined everything at this scene.</div>`;
  }
  html += `<button class="examine-leave" onclick="closeExaminePanel()">Leave</button>`;
  panel.innerHTML = html;
}

async function examinePoint(locationId, pointId) {
  const btn = document.querySelector(`#ep-${pointId} .examine-btn`);
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    const res = await fetch(`/api/examine/${encodeURIComponent(locationId)}/${encodeURIComponent(pointId)}`, { method: 'POST' });
    const data = await res.json();
    if (data.error) {
      showToast(data.error, 'info');
      if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
      return;
    }
    showToast(`Found: ${data.clueText || data.description}`, 'discovery');
    if (data.evidence && data.evidence.length > 0) {
      for (const e of data.evidence) {
        showToast(`Evidence: ${e.description}`, 'discovery', 7000);
      }
    }
    // Update cached scene data and re-render
    if (state._examineSceneData) {
      const pt = state._examineSceneData.points.find(p => p.id === pointId);
      if (pt) pt.examined = true;
      renderExaminePanel(state._examineSceneData);
    }
  } catch {
    showToast('Failed to examine', 'info');
    if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
  }
}

function closeExaminePanel() {
  document.getElementById('examine-panel').style.display = 'none';
  state._examineLocationId = null;
  state._examineSceneData = null;
}

// ─── JOURNAL ───
const _journalEntries = [];
const _journalSuspects = new Set();
let _journalTab = 'all';

function addJournalEntry(data) {
  _journalEntries.unshift(data);
  renderJournal();
  showToast('New journal entry', 'info', 3000);
}

function setJournalTab(tab) {
  _journalTab = tab;
  document.getElementById('journal-tab-all').classList.toggle('active', tab === 'all');
  document.getElementById('journal-tab-suspects').classList.toggle('active', tab === 'suspects');
  renderJournal();
}

function renderJournal() {
  const body = document.getElementById('journal-body');
  if (_journalEntries.length === 0) {
    body.innerHTML = '<div class="journal-empty">No entries yet. Examine crime scenes to collect evidence.</div>';
    updateSuspectCount();
    return;
  }
  if (_journalTab === 'suspects') {
    renderJournalSuspects(body);
  } else {
    renderJournalAll(body);
  }
  updateSuspectCount();
}

function updateSuspectCount() {
  const el = document.getElementById('journal-suspect-count');
  if (el) el.textContent = _journalSuspects.size || '';
}

let _journalCategoryFilter = null;

function renderJournalAll(body) {
  // Dynamic category filter buttons
  const cats = new Set(_journalEntries.map(e => e.evidenceCategory).filter(Boolean));
  let filterHtml = '';
  if (cats.size > 0) {
    filterHtml = '<div class="journal-filter-bar">';
    filterHtml += `<button class="journal-filter-btn${!_journalCategoryFilter ? ' active' : ''}" onclick="setJournalCategoryFilter(null)">All</button>`;
    for (const cat of cats) {
      filterHtml += `<button class="journal-filter-btn${_journalCategoryFilter === cat ? ' active' : ''}" onclick="setJournalCategoryFilter('${escapeAttr(cat)}')">${escapeHTML(cat)}</button>`;
    }
    filterHtml += '</div>';
  }

  const filtered = _journalCategoryFilter
    ? _journalEntries.filter(e => e.evidenceCategory === _journalCategoryFilter)
    : _journalEntries;
  body.innerHTML = filterHtml + filtered.map(renderJournalEntry).join('');
}

function setJournalCategoryFilter(cat) {
  _journalCategoryFilter = cat;
  renderJournal();
}

function renderJournalEntry(e) {
  // Show time for alibi checking: "Day 1, Morning — Market Square"
  const periodNames = { dawn: 'Dawn', morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
  const minuteOfDay = (e.tick || 0) % 1440;
  const period = minuteOfDay < 300 ? 'night' : minuteOfDay < 420 ? 'dawn' : minuteOfDay < 720 ? 'morning'
    : minuteOfDay < 1020 ? 'afternoon' : minuteOfDay < 1260 ? 'evening' : 'night';
  const timeStr = periodNames[period] || '';
  const day = `Day ${e.gameDay || '?'}${timeStr ? ', ' + timeStr : ''} — ${e.location || e.locationId || ''}`;
  const text = escapeHTML(e.text || e.clueText || e.description || '');
  const type = e.type || 'clue';

  let meta = '';
  if (e.evidenceCategory) {
    meta += `<span class="journal-badge ${safeCssClass(e.evidenceCategory)}">${escapeHTML(e.evidenceCategory)}</span>`;
  }
  if (e.evidenceWeight) {
    meta += `<span class="journal-weight">${e.evidenceWeight.toFixed(2)}</span>`;
  }
  if (e.suspectId) {
    const suspectName = state.agents[e.suspectId]?.name || e.suspectId;
    meta += `<span class="journal-suspect-link" onclick="toggleSuspect('${escapeAttr(e.suspectId)}')">${escapeHTML(suspectName)}</span>`;
  }
  if (e.presentedTo && e.presentedTo.length > 0) {
    const names = e.presentedTo.map(id => state.agents[id]?.name || id).join(', ');
    meta += `<span class="journal-presented">shown to ${escapeHTML(names)}</span>`;
  }

  return `<div class="journal-entry" data-id="${e.id || ''}">
    <div class="journal-entry-header">
      <span class="journal-entry-day">${day}</span>
      <span class="journal-entry-type ${type}">${type}</span>
    </div>
    <div class="journal-entry-text">${text}</div>
    ${meta ? `<div class="journal-entry-meta">${meta}</div>` : ''}
  </div>`;
}

function renderJournalSuspects(body) {
  const groups = {};
  const unrelated = [];
  for (const e of _journalEntries) {
    if (e.suspectId) {
      if (!groups[e.suspectId]) groups[e.suspectId] = [];
      groups[e.suspectId].push(e);
    } else if (e.relatedNpcs && e.relatedNpcs.length > 0) {
      for (const npcId of e.relatedNpcs) {
        if (!groups[npcId]) groups[npcId] = [];
        groups[npcId].push(e);
      }
    } else {
      unrelated.push(e);
    }
  }

  const sortedIds = Object.keys(groups).sort((a, b) => {
    const aSusp = _journalSuspects.has(a) ? 1 : 0;
    const bSusp = _journalSuspects.has(b) ? 1 : 0;
    if (aSusp !== bSusp) return bSusp - aSusp;
    return groups[b].length - groups[a].length;
  });

  let html = '';
  const defaultWeights = { clue: 0.10, testimony: 0.12, observation: 0.08 };

  for (const npcId of sortedIds) {
    const entries = groups[npcId];
    const name = state.agents[npcId]?.name || npcId;
    const isSuspect = _journalSuspects.has(npcId);

    const cats = { physical: 0, motive: 0, opportunity: 0, witness: 0, alibi: 0 };
    let totalScore = 0;
    for (const e of entries) {
      if (e.evidenceCategory && cats[e.evidenceCategory] !== undefined) cats[e.evidenceCategory]++;
      totalScore += e.evidenceWeight ?? defaultWeights[e.type] ?? 0.08;
    }
    const quality = totalScore >= 0.7 ? 'strong' : totalScore >= 0.4 ? 'moderate' : totalScore >= 0.2 ? 'weak' : 'insufficient';

    const breakdown = Object.entries(cats)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `<span>${k}: ${v}</span>`)
      .join('');

    html += `<div class="journal-suspect-group">
      <div class="journal-suspect-header" onclick="this.parentElement.classList.toggle('collapsed')">
        <span class="journal-suspect-name">${escapeHTML(name)}</span>
        <span class="journal-case-quality ${quality}">${quality}</span>
        <span class="journal-case-score">${totalScore.toFixed(2)}</span>
        <button class="journal-case-btn"
          onclick="event.stopPropagation(); openCaseReview('${escapeAttr(npcId)}')">Case File</button>
        <button class="journal-suspect-toggle ${isSuspect ? 'active' : ''}"
          onclick="event.stopPropagation(); toggleSuspect('${escapeAttr(npcId)}')">
          ${isSuspect ? 'Suspect' : 'Mark'}
        </button>
      </div>
      <div class="journal-suspect-entries">${entries.map(renderJournalEntry).join('')}</div>
      ${breakdown ? `<div class="journal-case-breakdown">${breakdown}</div>` : ''}
    </div>`;
  }

  if (unrelated.length > 0) {
    html += '<div class="journal-section-title">Other</div>';
    html += unrelated.map(renderJournalEntry).join('');
  }

  if (!html) html = '<div class="journal-empty">No evidence linked to any NPC yet.</div>';
  body.innerHTML = html;
}

async function toggleSuspect(npcId) {
  try {
    const res = await fetch(`/api/journal/suspect/${npcId}`, { method: 'POST' });
    const data = await res.json();
    if (data.isSuspect) _journalSuspects.add(npcId);
    else _journalSuspects.delete(npcId);
    renderJournal();
  } catch { /* ignore */ }
}

async function openCaseReview(npcId) {
  const body = document.getElementById('journal-body');
  body.innerHTML = '<div class="journal-empty">Loading case file...</div>';
  try {
    const res = await fetch(`/api/journal/case/${encodeURIComponent(npcId)}`);
    const data = await res.json();
    if (data.error) { renderJournal(); return; }
    renderCaseReview(data);
  } catch { renderJournal(); }
}

function renderCaseReview(data) {
  const body = document.getElementById('journal-body');
  const name = escapeHTML(data.suspectName || data.suspectId);

  if (!data.entries || data.entries.length === 0) {
    body.innerHTML = `<div class="case-review">
      <div class="case-review-title">Case File: ${name}</div>
      <div class="journal-empty">No evidence collected yet. Investigate the crime scene and talk to people.</div>
      <button class="case-review-back" onclick="renderJournal()">Back to Suspects</button>
    </div>`;
    return;
  }

  // Evidence summary — only categories with count > 0
  let summaryHtml = '<div class="case-review-summary">';
  if (data.evidence) {
    for (const [cat, count] of Object.entries(data.evidence)) {
      if (count > 0) {
        summaryHtml += `<div class="case-review-cat">
          <span class="case-cat-name">${escapeHTML(cat)}</span>
          <span class="case-cat-count">${count}</span>
        </div>`;
      }
    }
  }
  summaryHtml += '</div>';

  // Evidence details
  let detailsHtml = '<div class="case-review-details"><div class="case-review-divider">Details</div>';
  for (const e of data.entries) {
    const text = escapeHTML(e.text || e.clueText || e.description || '');
    const cat = e.evidenceCategory ? `<span class="journal-badge ${safeCssClass(e.evidenceCategory)}">${escapeHTML(e.evidenceCategory)}</span>` : '';
    const loc = e.locationId || e.location || '';
    const source = e.type || '';
    const meta = [source, loc].filter(Boolean).join(', ');
    detailsHtml += `<div class="case-review-entry">
      <div class="case-review-entry-text">${text}</div>
      <div class="case-review-entry-meta">${cat}${meta ? `<span class="case-meta-info">${escapeHTML(meta)}</span>` : ''}</div>
    </div>`;
  }
  detailsHtml += '</div>';

  body.innerHTML = `<div class="case-review">
    <div class="case-review-title">Case File: ${name}</div>
    ${summaryHtml}
    ${detailsHtml}
    <button class="case-review-back" onclick="renderJournal()">Back to Suspects</button>
  </div>`;
}

function toggleJournal() {
  document.getElementById('journal-panel').classList.toggle('open');
}

// ─── EVIDENCE PRESENTER ───
const _selectedEvidence = new Set();

function toggleEvidencePresenter() {
  const panel = document.getElementById('evidence-presenter');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) renderEvidencePresenter();
}

function renderEvidencePresenter() {
  const panel = document.getElementById('evidence-presenter');
  const npcId = state.chatNpcId;
  // Filter entries that have evidence data
  const entries = _journalEntries.filter(e => e.id && (e.evidenceCategory || e.type === 'testimony'));
  if (entries.length === 0) {
    panel.innerHTML = '<div class="evidence-empty">No evidence to present.</div>';
    return;
  }

  panel.innerHTML = '<div class="evidence-title">Select evidence to present</div>' +
    entries.map(e => {
      const alreadyShown = npcId && e.presentedTo && e.presentedTo.includes(npcId);
      const selected = _selectedEvidence.has(e.id);
      const cls = `evidence-item${selected ? ' selected' : ''}${alreadyShown ? ' already-shown' : ''}`;
      const text = escapeHTML(e.text || e.clueText || e.description || '');
      const cat = e.evidenceCategory ? `<span class="journal-badge ${safeCssClass(e.evidenceCategory)}">${escapeHTML(e.evidenceCategory)}</span> ` : '';
      const shown = alreadyShown ? '<div class="evidence-item-shown">already shown</div>' : '';
      return `<div class="${cls}" onclick="toggleEvidenceItem('${e.id}')">
        <div class="evidence-item-check"></div>
        <div class="evidence-item-text">${cat}${text}${shown}</div>
      </div>`;
    }).join('');
}

function toggleEvidenceItem(entryId) {
  if (_selectedEvidence.has(entryId)) _selectedEvidence.delete(entryId);
  else _selectedEvidence.add(entryId);
  renderEvidencePresenter();
  renderEvidenceTags();
  document.getElementById('btn-evidence').classList.toggle('has-selection', _selectedEvidence.size > 0);
}

function renderEvidenceTags() {
  const container = document.getElementById('evidence-tags');
  if (_selectedEvidence.size === 0) { container.innerHTML = ''; return; }
  container.innerHTML = [..._selectedEvidence].map(id => {
    const e = _journalEntries.find(j => j.id === id);
    const label = e ? (e.evidenceCategory || e.type || 'evidence') : id;
    return `<span class="evidence-tag" onclick="toggleEvidenceItem('${id}')" title="Click to remove">${label}</span>`;
  }).join('');
}

function clearEvidenceSelection() {
  _selectedEvidence.clear();
  renderEvidenceTags();
  document.getElementById('btn-evidence').classList.remove('has-selection');
  document.getElementById('evidence-presenter').classList.remove('open');
  document.getElementById('evidence-presenter').innerHTML = '';
}

// ─── EVENT FEED ───
const FEED_CLASSES = new Set(['crime', 'conversation', 'movement', 'thought', 'mood']);
function addEvent(cls, text) {
  const safeCls = FEED_CLASSES.has(cls) ? cls : '';
  state.events.unshift({ cls: safeCls, text, time: state.time });
  if (state.events.length > 50) state.events.pop();
  // Incremental DOM — prepend new element, trim overflow
  const feed = state._feedEl || (state._feedEl = document.getElementById('event-feed'));
  const el = document.createElement('div');
  el.className = `feed-item ${safeCls}`;
  el.innerHTML = `<span class="time">${escapeHTML(state.time)}</span> ${escapeHTML(text)}`;
  feed.prepend(el);
  while (feed.children.length > 50) feed.lastChild.remove();
}

// ─── CHAT ───
function openChat(npcId) {
  state.chatOpen = true; state.chatNpcId = npcId;
  sendWS({ type: 'chat_open', agentId: npcId });
  document.getElementById('examine-panel').style.display = 'none';
  clearEvidenceSelection();
  const a = state.agents[npcId];
  if (!a) return;

  // Avatar — portrait from Tiny Swords Human Avatars
  const avatarNum = AVATAR_MAP[npcId] || '01';
  document.getElementById('chat-avatar').src = `/assets/tinyswords/UI%20Elements/UI%20Elements/Human%20Avatars/Avatars_${avatarNum}.png`;

  // NPC info
  const nameEl = document.getElementById('chat-npc-name');
  nameEl.textContent = a.name;
  nameEl.style.color = '#e8dcc8'; // reset, updated by sentiment below
  document.getElementById('chat-npc-role').textContent = a.role;
  document.getElementById('chat-npc-loc').textContent = LOCATIONS[a.location]?.label || a.location;

  // Details / NPC Mind — reset to collapsed, clear cache for fresh data
  document.getElementById('chat-npc-background').textContent = a.background || '';
  const detailsBody = document.getElementById('chat-details-body');
  detailsBody.classList.remove('open');
  detailsBody.style.maxHeight = '0';
  document.getElementById('chat-details-toggle').classList.remove('open');
  resetMindCache();

  // Status badge
  const badge = document.getElementById('chat-status-badge');
  if (a.status && a.status !== 'free' && a.status !== '') {
    badge.textContent = a.status.toUpperCase();
    badge.className = 'chat-status-badge ' + (a.status || '').replace(/[^a-z_-]/gi, '');
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }

  // Mood bar
  updateChatMoodBar(a.mood);

  // Trust bar — fetch relationship to player
  updateChatTrustBar(0.3, 0); // default while loading
  fetch(`/api/relationships/${npcId}`).then(r => r.json()).then(rels => {
    if (state.chatNpcId !== npcId) return; // chat closed or switched
    const playerRel = rels.find(r => r.targetId === 'player');
    if (playerRel) {
      updateChatTrustBar(playerRel.trust, playerRel.sentiment);
    }
  }).catch(err => console.warn('[Fetch]', err));

  // Restore or reset messages — single source of truth: chatHistory
  const msgDiv = document.getElementById('chat-messages');
  finalizeChatStream(); // flush any pending stream from previous chat
  const history = a.chatHistory || [];
  msgDiv.innerHTML = '';

  if (history.length > 0) {
    renderChatHistory(msgDiv, history);
    msgDiv.classList.add('has-messages');
    requestAnimationFrame(() => {
      const content = msgDiv.scrollHeight;
      if (content <= CHAT_MSG_MAX_H) {
        msgDiv.style.height = content + 'px';
      } else {
        msgDiv.style.height = CHAT_MSG_MAX_H + 'px';
        msgDiv.scrollTop = msgDiv.scrollHeight;
      }
    });
  } else {
    msgDiv.style.height = '0';
    msgDiv.classList.remove('has-messages');
  }

  // Mark new conversation session
  a._chatSession = `Day ${state.day}, ${state.time}`;

  // Shop button — show if NPC has shop
  const shopBtn = document.getElementById('btn-shop');
  if (a.hasShop) {
    shopBtn.style.display = 'inline-block';
    shopBtn.classList.remove('glow');
    // Pre-load shop data from agent profile
    fetch(`/api/agent/${npcId}`).then(r => r.json()).then(d => {
      if (d.shop) state._shopData = { agentId: npcId, npcName: d.name, items: d.shop };
    }).catch(err => console.warn('[Fetch]', err));
  } else {
    shopBtn.style.display = 'none';
    state._shopData = null;
  }

  // Player footer — portrait avatar (same style as NPC)
  const playerAvNum = AVATAR_MAP['player'] || '01';
  document.getElementById('chat-player-avatar').src = `/assets/tinyswords/UI%20Elements/UI%20Elements/Human%20Avatars/Avatars_${playerAvNum}.png`;
  // Location
  const playerLoc = Object.entries(LOCATIONS).find(([id]) => {
    const z = LOCATIONS[id];
    const dx = state.player.x - z.px, dy = state.player.y - z.py;
    return Math.sqrt(dx*dx + dy*dy) < 300;
  });
  document.getElementById('chat-player-loc').textContent = playerLoc ? playerLoc[1].label : '';
  // Mood + beliefs from server
  fetch('/api/player').then(r => r.json()).then(pd => {
    const moodEl = document.getElementById('chat-player-mood');
    if (moodEl) {
      moodEl.textContent = `Mood: ${pd.mood?.toFixed(2) ?? '?'}`;
      moodEl.style.color = pd.mood > 0 ? '#8aba8a' : pd.mood > -0.3 ? '#baba6a' : '#ba6a6a';
    }
    const belEl = document.getElementById('chat-player-beliefs');
    if (belEl) belEl.textContent = `${pd.beliefs ?? 0} beliefs`;
  }).catch(err => console.warn('[Fetch]', err));

  // Show panel
  document.getElementById('chat-panel').classList.add('open');

  // Save current zoom and smoothly transition to NPC
  state._preZoom = state.camera.zoom;
  state._chatZoomTarget = Math.max(state.camera.zoom, 1.5);
  state._chatCamTarget = { x: a.x, y: a.y };

  updateDetectiveHint(npcId);
  setTimeout(() => document.getElementById('chat-input').focus(), 100);
}

// ─── DETECTIVE INTUITION HINTS ───
function updateDetectiveHint(npcId) {
  const hintEl = document.getElementById('detective-hint');
  if (!npcId) { hintEl.style.display = 'none'; return; }
  const a = state.agents[npcId];
  if (!a) { hintEl.style.display = 'none'; return; }

  // Gather context data
  const suspectIds = new Set(_journalSuspects);
  const isSuspect = suspectIds.has(npcId);
  const isInvestigator = a.investigator;
  const npcEntries = _journalEntries.filter(e => e.suspectId === npcId && (e.evidenceCategory || e.type === 'testimony'));
  const hasEvidence = npcEntries.length > 0;
  const hasCrimeBeliefs = _journalEntries.length > 0;

  // Check if NPC knows a suspect (from relationships loaded in Mind accordion)
  let knownSuspectName = null;
  if (!isSuspect && !isInvestigator && suspectIds.size > 0) {
    // We check agent data — relationships are fetched lazily, so just check if this NPC
    // is related to any suspect via journal entries mentioning them
    for (const sid of suspectIds) {
      const sa = state.agents[sid];
      if (sa) { knownSuspectName = sa.name; break; }
    }
  }

  // Priority-ordered hint selection — detective guidance
  let hint = null;
  if (isSuspect && hasEvidence) {
    hint = `You have evidence linking ${a.name} to the crime. This might be the time to press them on it.`;
  } else if (isSuspect && !hasEvidence) {
    hint = `Something about ${a.name} doesn't sit right. You might try asking about their whereabouts.`;
  } else if (isInvestigator && hasCrimeBeliefs) {
    hint = `The guard could help investigate. You could share what you've learned about the crime.`;
  } else if (a.mood < -0.4 && !isSuspect) {
    hint = `${a.name} looks distressed. They might have something to share if you can earn their trust.`;
  } else if (knownSuspectName) {
    hint = `${a.name} might know something about ${knownSuspectName}. They could have information.`;
  } else if (a.status === 'detained') {
    hint = `${a.name} is detained. You could try talking to the judge about their case.`;
  }

  if (!hint || hintEl._dismissed === npcId) {
    hintEl.style.display = 'none';
    return;
  }

  hintEl.style.display = 'block';
  hintEl.textContent = '';
  const closeBtn = document.createElement('span');
  closeBtn.className = 'hint-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', dismissHint);
  hintEl.appendChild(closeBtn);
  hintEl.appendChild(document.createTextNode(hint));
}

function dismissHint() {
  const hintEl = document.getElementById('detective-hint');
  hintEl.style.display = 'none';
  hintEl._dismissed = state.chatNpcId;
}

let _lastRenderedMood = null;
function updateChatMoodBar(mood) {
  if (_lastRenderedMood !== null && Math.abs(mood - _lastRenderedMood) < 0.01) return;
  _lastRenderedMood = mood;
  const pct = (mood + 1) / 2 * 100;
  const bar = document.getElementById('chat-mood-bar');
  bar.style.width = pct + '%';
  bar.style.background = mood > 0 ? '#4a8a4a' : mood > -0.3 ? '#8a8a3a' : '#8a3a3a';
  document.getElementById('chat-mood-val').textContent = mood.toFixed(2);
}

function updateChatTrustBar(trust, sentiment) {
  const pct = trust * 100;
  const bar = document.getElementById('chat-trust-bar');
  bar.style.width = pct + '%';
  bar.style.background = trust > 0.5 ? '#4a7aba' : trust > 0.2 ? '#5a6a8a' : '#6a5a5a';
  document.getElementById('chat-trust-val').textContent = trust.toFixed(2);

  // Sentiment tints NPC name color
  const nameEl = document.getElementById('chat-npc-name');
  if (sentiment > 0.2) nameEl.style.color = '#a8d8b0';
  else if (sentiment < -0.2) nameEl.style.color = '#d8a8a8';
  else nameEl.style.color = '#e8dcc8';
}

function toggleChatDetails() {
  const toggle = document.getElementById('chat-details-toggle');
  const body = document.getElementById('chat-details-body');
  const isOpen = body.classList.contains('open');
  if (isOpen) {
    body.style.maxHeight = '0';
    body.classList.remove('open');
    toggle.classList.remove('open');
  } else {
    body.classList.add('open');
    body.style.maxHeight = ''; // let CSS .open handle it (320px with scroll)
    toggle.classList.add('open');
  }
}

// ─── NPC Mind — lazy-loaded sub-sections ───
const _mindCache = {}; // npcId → { beliefs, relationships, goals, personality }

function resetMindCache() {
  const npcId = state.chatNpcId;
  if (npcId) delete _mindCache[npcId];
  // Collapse all mind sections
  for (const sec of ['beliefs', 'relationships', 'goals', 'personality']) {
    const hdr = document.querySelector(`#mind-${sec} .mind-header`);
    const body = document.getElementById(`mind-${sec}-body`);
    if (hdr) hdr.classList.remove('open');
    if (body) { body.classList.remove('open'); body.style.maxHeight = '0'; body.innerHTML = ''; }
    const cnt = document.getElementById(`mind-${sec}-count`);
    if (cnt) cnt.textContent = '';
  }
}

async function toggleMindSection(section) {
  const hdr = document.querySelector(`#mind-${section} .mind-header`);
  const body = document.getElementById(`mind-${section}-body`);
  if (!hdr || !body) return;

  if (body.classList.contains('open')) {
    body.style.maxHeight = '0';
    body.classList.remove('open');
    hdr.classList.remove('open');
    return;
  }

  hdr.classList.add('open');
  const npcId = state.chatNpcId;
  if (!npcId) return;
  if (!_mindCache[npcId]) _mindCache[npcId] = {};
  const cache = _mindCache[npcId];

  // Show loading
  if (!cache[section]) {
    body.innerHTML = '<div class="mind-loading">Loading...</div>';
    body.classList.add('open');
    body.style.maxHeight = '40px';
  }

  try {
    if (!cache[section]) cache[section] = await fetchMindData(npcId, section);
    renderMindSection(section, cache[section], body);
  } catch {
    body.innerHTML = '<div class="mind-loading">Failed to load</div>';
  }

  body.classList.add('open');
  requestAnimationFrame(() => {
    body.style.maxHeight = body.scrollHeight + 'px';
    // Re-expand parent details body to accommodate new content
    const detailsBody = document.getElementById('chat-details-body');
    if (detailsBody?.classList.contains('open')) detailsBody.style.maxHeight = detailsBody.scrollHeight + 'px';
  });
}

async function fetchMindData(npcId, section) {
  switch (section) {
    case 'beliefs': {
      const res = await fetch(`/api/beliefs/${npcId}`);
      const data = await res.json();
      document.getElementById('mind-beliefs-count').textContent = `(${data.length})`;
      return data;
    }
    case 'relationships': {
      const res = await fetch(`/api/relationships/${npcId}`);
      const data = await res.json();
      document.getElementById('mind-relationships-count').textContent = `(${data.length})`;
      return data;
    }
    case 'goals': {
      const res = await fetch('/api/goals');
      const all = await res.json();
      const data = all.filter(g => g.ownerId === npcId);
      document.getElementById('mind-goals-count').textContent = `(${data.length})`;
      return data;
    }
    case 'personality': {
      const res = await fetch(`/api/agent/${npcId}`);
      return await res.json();
    }
    default: return null;
  }
}

function renderMindSection(section, data, container) {
  container.innerHTML = '';
  if (!data) return;

  switch (section) {
    case 'beliefs': {
      if (data.length === 0) { container.innerHTML = '<div class="mind-loading">No beliefs</div>'; return; }
      for (const b of data) {
        const pct = Math.round((b.confidence ?? 0) * 100);
        const div = document.createElement('div');
        div.className = 'belief-item';
        div.innerHTML = `
          <span class="belief-type">${escapeHTML(b.eventType || '?')}</span>
          <div class="belief-conf"><div class="belief-conf-fill" style="width:${pct}%;background:${pct>60?'#6aba6a':pct>30?'#ba8a4a':'#6a6a6a'}"></div></div>
          <span class="belief-text">${escapeHTML(b.subject || '?')}${b.object ? ' → ' + escapeHTML(b.object) : ''}</span>
          <span class="belief-source">${escapeHTML(b.source || '')}</span>
        `;
        container.appendChild(div);
      }
      break;
    }

    case 'relationships': {
      if (data.length === 0) { container.innerHTML = '<div class="mind-loading">No relationships</div>'; return; }
      for (const r of data) {
        const sentPct = ((r.sentiment + 1) / 2) * 100; // -1..1 → 0..100
        const trustPct = r.trust * 100;
        const sentColor = r.sentiment > 0.2 ? '#6aba6a' : r.sentiment < -0.2 ? '#ba4a4a' : '#8a8a6a';
        const div = document.createElement('div');
        div.className = 'rel-item';
        div.innerHTML = `
          <span class="rel-name">${escapeHTML(r.targetName)}</span>
          <span class="rel-type-badge">${escapeHTML(r.type)}</span>
          <div class="rel-bars">
            <div class="rel-bar"><span class="rel-bar-label">S</span><div class="rel-bar-bg"><div class="rel-bar-fill" style="width:${sentPct}%;background:${sentColor}"></div></div><span class="rel-bar-val">${r.sentiment.toFixed(1)}</span></div>
            <div class="rel-bar"><span class="rel-bar-label">T</span><div class="rel-bar-bg"><div class="rel-bar-fill" style="width:${trustPct}%;background:#4a7aba"></div></div><span class="rel-bar-val">${r.trust.toFixed(1)}</span></div>
          </div>
        `;
        container.appendChild(div);
      }
      break;
    }

    case 'goals': {
      if (data.length === 0) { container.innerHTML = '<div class="mind-loading">No active goals</div>'; return; }
      for (const g of data) {
        const div = document.createElement('div');
        div.className = 'goal-item';
        div.innerHTML = `
          <span class="goal-state ${g.state}">${escapeHTML(g.state)}</span>
          <span class="goal-text">${escapeHTML(g.type)}${g.ownerName ? '' : ''}</span>
          <span class="goal-progress">${g.currentStep + 1}/${g.totalSteps}</span>
        `;
        container.appendChild(div);
      }
      break;
    }

    case 'personality': {
      if (!data.bigFive) { container.innerHTML = '<div class="mind-loading">No personality data</div>'; return; }
      const bf = data.bigFive;
      const traitColors = { O: '#a080d0', C: '#60a0d0', E: '#d0a040', A: '#60c080', N: '#d06060', H: '#40a0a0' };
      for (const [key, label] of [['openness','O'],['conscientiousness','C'],['extraversion','E'],['agreeableness','A'],['neuroticism','N'],['honesty','H']]) {
        const val = bf[key] ?? 0;
        const div = document.createElement('div');
        div.className = 'trait-row';
        div.innerHTML = `
          <span class="trait-label" style="color:${traitColors[label]}">${label}</span>
          <div class="trait-bar-bg"><div class="trait-bar-fill" style="width:${val*100}%;background:${traitColors[label]}"></div></div>
          <span class="trait-val">${val.toFixed(2)}</span>
        `;
        container.appendChild(div);
      }
      if (data.enneagram) {
        const e = data.enneagram;
        const enneNames = {1:'Perfectionist',2:'Helper',3:'Achiever',4:'Individualist',5:'Investigator',6:'Loyalist',7:'Enthusiast',8:'Challenger',9:'Peacemaker'};
        const typeName = enneNames[e.type] || e.type;
        const d1 = document.createElement('div');
        d1.className = 'enne-line';
        d1.innerHTML = `<span class="enne-label">Type</span> ${e.type}w${e.wing} ${escapeHTML(typeName)}`;
        container.appendChild(d1);
        if (e.coreFear) {
          const d2 = document.createElement('div');
          d2.className = 'enne-line';
          d2.innerHTML = `<span class="enne-label">Fear</span> ${escapeHTML(e.coreFear)}`;
          container.appendChild(d2);
        }
        if (e.coreDesire) {
          const d3 = document.createElement('div');
          d3.className = 'enne-line';
          d3.innerHTML = `<span class="enne-label">Desire</span> ${escapeHTML(e.coreDesire)}`;
          container.appendChild(d3);
        }
      }
      break;
    }
  }
}

// ─── IL feedback ───

function renderILEffectLine(e) {
  switch (e.type) {
    case 'belief_created':
      return `<span class="il-label">belief</span> Noted claim about ${escapeHTML(e.subject || 'someone')} — confidence ${Math.round(e.confidence * 100)}%, trust ${Math.round(e.trust * 100)}%`;
    case 'belief_rejected':
      return `<span class="il-label">rejected</span> Dismissed claim${e.subject ? ' about ' + escapeHTML(e.subject) : ''} — ${escapeHTML(e.reason)}`;
    case 'mood_change':
      return `<span class="il-label">mood</span> ${e.delta > 0 ? 'Improved' : 'Worsened'} by ${Math.abs(e.delta).toFixed(2)} → ${e.newMood}`;
    case 'relationship_change':
      return `<span class="il-label">${e.field}</span> ${e.delta > 0 ? 'Increased' : 'Decreased'} by ${Math.abs(e.delta).toFixed(2)}`;
    case 'goal_created':
      return `<span class="il-label">action</span> Will ${escapeHTML(e.action)}${e.target ? ' regarding ' + escapeHTML(e.target) : ''}`;
    case 'goal_rejected':
      return `<span class="il-label">refused</span> Won't ${escapeHTML(e.action)} — ${escapeHTML(e.reason)}${e.trust != null ? ' (trust: ' + Math.round(e.trust * 100) + '%)' : ''}`;
    case 'memory_stored':
      return `<span class="il-label">memory</span> Remembered: "${escapeHTML(e.text)}" (importance: ${e.importance})`;
    case 'event_stored':
      if (e.eventType === 'IL_FALLBACK') return `<span class="il-label" style="color:#d08040">warning</span> IL extraction failed: ${escapeHTML(e.action)}`;
      return null;
    default:
      return null;
  }
}

function attachILBadge(msgEl, effects) {
  const visible = effects.filter(e => e.type !== 'event_stored');
  if (visible.length === 0) return;

  // Toggle button
  const toggle = document.createElement('div');
  toggle.className = 'msg-il-toggle';
  toggle.textContent = `⚙ ${visible.length} effect${visible.length > 1 ? 's' : ''}`;
  toggle.onclick = function() { toggleMsgIL(this); };
  msgEl.appendChild(toggle);

  // Collapsible details
  const details = document.createElement('div');
  details.className = 'msg-il-details';
  for (const e of visible) {
    const line = renderILEffectLine(e);
    if (!line) continue;
    const div = document.createElement('div');
    div.className = 'il-effect';
    div.innerHTML = line;
    details.appendChild(div);
  }
  msgEl.appendChild(details);
}

function toggleMsgIL(toggleEl) {
  const details = toggleEl.nextElementSibling;
  if (!details) return;
  const div = document.getElementById('chat-messages');
  const isOpen = details.classList.contains('open');
  if (isOpen) {
    details.style.maxHeight = '0';
    details.classList.remove('open');
    toggleEl.classList.remove('open');
  } else {
    details.classList.add('open');
    details.style.maxHeight = details.scrollHeight + 'px';
    toggleEl.classList.add('open');
    setTimeout(() => {
      div.scrollTop = div.scrollHeight;
    }, 50);
  }
}

// ─── Chat system ───
const CHAT_MSG_MAX_H = 560; // matches CSS --chat-msg-max-h
const CHAT_HISTORY_CAP = 50;
let _chatTokenBuffer = '';
let _chatStreamEl = null;

function escapeHTML(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function escapeAttr(str) {
  return String(str).replace(/&/g,'&amp;').replace(/'/g,'&#39;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function safeCssClass(str) {
  return /^[a-z_-]+$/.test(str) ? str : '';
}

function createMsgEl(name, text, cls) {
  const el = document.createElement('div');
  el.className = `msg msg-${cls}`;
  el.innerHTML = name ? `<b>${escapeHTML(name)}</b>${escapeHTML(text)}` : escapeHTML(text);
  return el;
}

function renderChatHistory(container, history) {
  const frag = document.createDocumentFragment();
  let lastSession = null;
  for (const m of history) {
    if (m.session && m.session !== lastSession && lastSession !== null) {
      const sep = document.createElement('div');
      sep.className = 'chat-session-sep';
      sep.textContent = m.session;
      frag.appendChild(sep);
    }
    lastSession = m.session || lastSession;
    const el = createMsgEl(m.name, m.text, m.cls);
    if (m.effects && m.effects.length > 0) attachILBadge(el, m.effects);
    frag.appendChild(el);
  }
  container.appendChild(frag);
}

function pushHistory(npcId, name, text, cls, effects) {
  const a = state.agents[npcId];
  if (!a) return;
  if (!a.chatHistory) a.chatHistory = [];
  const entry = { name, text, cls, session: a._chatSession || null };
  if (effects && effects.length > 0) entry.effects = effects;
  a.chatHistory.push(entry);
  if (a.chatHistory.length > CHAT_HISTORY_CAP) a.chatHistory.shift();
  saveChatHistory(npcId, a.chatHistory);
}

function saveChatHistory(npcId, history) {
  try { localStorage.setItem(`clwa-chat-${npcId}`, JSON.stringify(history)); } catch {}
}

function loadChatHistory(npcId) {
  try {
    const raw = localStorage.getItem(`clwa-chat-${npcId}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function finalizeChatStream() {
  if (_chatTokenBuffer && state.chatNpcId) {
    const a = state.agents[state.chatNpcId];
    const effects = state._pendingILEffects || [];
    if (a) pushHistory(state.chatNpcId, a.name, _chatTokenBuffer, 'npc', effects);
    if (_chatStreamEl) {
      delete _chatStreamEl.dataset.streaming;
      // Attach IL effects badge to this NPC message
      if (effects.length > 0) {
        attachILBadge(_chatStreamEl, effects);
      }
    }
    growChatArea();
  }
  _chatTokenBuffer = '';
  _chatStreamEl = null;
  state._pendingILEffects = null;
}

function closeChat() {
  finalizeChatStream();
  closeShop();
  clearEvidenceSelection();
  // Notify server to destroy conversation session
  if (state.chatNpcId) {
    sendWS({ type: 'chat_close', agentId: state.chatNpcId });
  }
  state.chatOpen = false; state.chatNpcId = null;
  document.getElementById('chat-panel').classList.remove('open');

  if (state._preZoom) state._chatZoomTarget = state._preZoom;
  state._chatCamTarget = null;
  state._cameraReturning = true;
  setTimeout(() => { state._chatZoomTarget = null; state._preZoom = null; state._cameraReturning = false; }, 1200);
}

function sendChat(e) {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !state.chatNpcId || !state.ws) return;
  const msg = { type: 'chat', agentId: state.chatNpcId, message: text };
  if (_selectedEvidence.size > 0) {
    msg.evidenceIds = [..._selectedEvidence];
    // Mark entries as presented locally
    for (const id of msg.evidenceIds) {
      const entry = _journalEntries.find(j => j.id === id);
      if (entry) {
        if (!entry.presentedTo) entry.presentedTo = [];
        if (!entry.presentedTo.includes(state.chatNpcId)) entry.presentedTo.push(state.chatNpcId);
      }
    }
    clearEvidenceSelection();
    renderJournal();
  }
  sendWS(msg);
  addChatMessage('You', text, 'player');
  input.value = '';
}

function addChatMessage(name, text, cls) {
  if (state.chatNpcId) pushHistory(state.chatNpcId, name, text, cls);
  const div = document.getElementById('chat-messages');
  div.appendChild(createMsgEl(name, text, cls));
  growChatArea();
}

function growChatArea() {
  const div = document.getElementById('chat-messages');
  if (!div.classList.contains('has-messages')) div.classList.add('has-messages');
  requestAnimationFrame(() => {
    const content = div.scrollHeight;
    if (content <= CHAT_MSG_MAX_H) {
      // Content fits — expand to fit, no scroll
      div.style.height = content + 'px';
    } else {
      div.style.height = CHAT_MSG_MAX_H + 'px';
      div.scrollTop = div.scrollHeight;
    }
  });
}

function appendChatToken(token) {
  _chatTokenBuffer += token;
  const div = document.getElementById('chat-messages');
  if (!_chatStreamEl || !_chatStreamEl.parentNode) {
    const a = state.agents[state.chatNpcId];
    _chatStreamEl = document.createElement('div');
    _chatStreamEl.className = 'msg msg-npc';
    _chatStreamEl.dataset.streaming = '1';
    _chatStreamEl.innerHTML = `<b>${escapeHTML(a?.name || '')}</b><span class="stream-text"></span>`;
    div.appendChild(_chatStreamEl);
  }
  _chatStreamEl.querySelector('.stream-text').textContent = _chatTokenBuffer;
  growChatArea();
}

function syncSpeedButtons(speed) {
  // Speed controls removed — always 1x
}

// ─── AUTO TICK (server-authoritative) ───
async function toggleAuto() {
  const res = await fetch('/api/auto', { method: 'POST' });
  const data = await res.json();
  state.autoTick = data.running;
  const btn = document.getElementById('btn-auto');
  btn.textContent = state.autoTick ? 'Auto: ON' : 'Auto';
  btn.classList.toggle('active', state.autoTick);
}

// ─── NEW GAME ───
async function newGame() {
  if (!confirm('Start a new game? Current progress will be lost.')) return;
  try {
    const res = await fetch('/api/new-game', { method: 'POST' });
    const data = await res.json();
    if (data.error) { showToast(data.error, 'info'); return; }
    showToast(`New game started (seed: ${data.seed})`, 'discovery', 4000);
    // Full page reload to re-init everything
    setTimeout(() => location.reload(), 500);
  } catch { showToast('Failed to start new game', 'info'); }
}

// ─── CANVAS INTERACTION ───
function screenToWorld(sx, sy) {
  const z = state.camera.zoom;
  const logW = canvas.width / dpr, logH = canvas.height / dpr;
  const camX = state.camera.fx - logW / (2 * z);
  const camY = state.camera.fy - logH / (2 * z);
  return { x: sx / z + camX, y: sy / z + camY };
}

function onCanvasClick(e) {
  const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
  canvas.style.cursor = 'crosshair';
  // Check NPC click
  for (const [id, a] of Object.entries(state.agents)) {
    if (!a.alive) continue;
    if (a.status && a.status !== 'free' && a.status !== '') continue;
    const dx = wx - a.x, dy = wy - a.y;
    if (Math.abs(dx) < 30 && Math.abs(dy) < 40) {
      const distToNpc = Math.sqrt((state.player.x - a.x)**2 + (state.player.y - a.y)**2);
      if (distToNpc < 100) {
        openChat(id);
      } else {
        // Walk to NPC, open chat on arrival
        state.player._pendingChat = id;
        state.player.waypoints = astarPath(state.player.x, state.player.y, a.x, a.y);
        state.player.wpIdx = 0;
        state.player.moving = true;
      }
      return;
    }
  }
  // A* pathfinding for player click-move (avoid water)
  state.player._pendingChat = null;
  state.player.waypoints = astarPath(state.player.x, state.player.y, wx, wy);
  state.player.wpIdx = 0;
  state.player.moving = true;
}

function onCanvasMouseMove(e) {
  const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
  state.hoveredNpc = null;
  for (const [id, a] of Object.entries(state.agents)) {
    if (!a.alive) continue;
    if (Math.abs(wx - a.x) < 30 && Math.abs(wy - a.y) < 40) {
      state.hoveredNpc = id;
      const tip = document.getElementById('tooltip');
      tip.style.display = 'block';
      tip.style.left = (e.clientX + 15) + 'px';
      tip.style.top = (e.clientY - 10) + 'px';
      tip.querySelector('.name').textContent = a.name;
      tip.querySelector('.role').textContent = a.role;
      const bar = tip.querySelector('.mood-bar');
      bar.style.background = moodColor(a.mood);
      bar.style.width = Math.abs(a.mood) * 100 + '%';
      return;
    }
  }
  document.getElementById('tooltip').style.display = 'none';
}

function findNearestNpc(px, py, maxDist) {
  let nearest = null, bestDist = maxDist;
  for (const [id, a] of Object.entries(state.agents)) {
    if (!a.alive || (a.status && a.status !== 'free' && a.status !== '')) continue;
    const dist = Math.sqrt((a.x-px)**2 + (a.y-py)**2);
    if (dist < bestDist) { bestDist = dist; nearest = id; }
  }
  return nearest;
}

function onWheel(e) {
  e.preventDefault();
  if (state.chatOpen) return;
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  state.camera.zoom = Math.max(0.3, Math.min(3.0, state.camera.zoom * factor));
}

// ─── MINIMAP ───
const _minimap = { canvas: null, ctx: null, scale: 0, ox: 0, oy: 0 };
function initMinimap() {
  _minimap.canvas = document.getElementById('minimap');
  if (!_minimap.canvas) return;
  // HiDPI scaling
  _minimap.canvas.width = 200 * dpr;
  _minimap.canvas.height = 150 * dpr;
  _minimap.ctx = _minimap.canvas.getContext('2d');
  _minimap.ctx.scale(dpr, dpr);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const loc of Object.values(LOCATIONS)) {
    if (loc.px < minX) minX = loc.px; if (loc.px > maxX) maxX = loc.px;
    if (loc.py < minY) minY = loc.py; if (loc.py > maxY) maxY = loc.py;
  }
  const pad = 100;
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  const w = maxX - minX, h = maxY - minY;
  _minimap.scale = Math.min(200 / w, 150 / h);
  _minimap.ox = -minX; _minimap.oy = -minY;
  _minimap.canvas.addEventListener('click', (e) => {
    const rect = _minimap.canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / _minimap.scale - _minimap.ox;
    const my = (e.clientY - rect.top) / _minimap.scale - _minimap.oy;
    let best = null, bestD = Infinity;
    for (const loc of Object.values(LOCATIONS)) {
      const d = Math.hypot(loc.px - mx, loc.py - my);
      if (d < bestD) { bestD = d; best = loc; }
    }
    if (best) { state.camera.fx = best.px; state.camera.fy = best.py; }
  });
}

function drawMinimap() {
  if (!_minimap.ctx) return;
  const mc = _minimap.ctx;
  const s = _minimap.scale, ox = _minimap.ox, oy = _minimap.oy;
  mc.clearRect(0, 0, 200, 150);

  // Roads
  mc.strokeStyle = 'rgba(100,140,180,0.2)';
  mc.lineWidth = 1;
  for (const [a, b] of ROADS) {
    const la = LOCATIONS[a], lb = LOCATIONS[b];
    if (!la || !lb) continue;
    mc.beginPath();
    mc.moveTo((la.px + ox) * s, (la.py + oy) * s);
    mc.lineTo((lb.px + ox) * s, (lb.py + oy) * s);
    mc.stroke();
  }

  // Location nodes
  for (const [id, loc] of Object.entries(LOCATIONS)) {
    const x = (loc.px + ox) * s, y = (loc.py + oy) * s;
    const hasCrime = state.crimeScenes?.some(cs => cs.locationId === id);
    if (hasCrime) {
      const pulse = 0.4 + Math.sin(Date.now() / 400) * 0.3;
      mc.beginPath(); mc.arc(x, y, 6, 0, Math.PI * 2);
      mc.fillStyle = `rgba(220,60,60,${pulse})`; mc.fill();
    }
    mc.beginPath(); mc.arc(x, y, 3, 0, Math.PI * 2);
    mc.fillStyle = 'rgba(100,140,180,0.5)'; mc.fill();
  }

  // NPC dots
  for (const a of Object.values(state.agents)) {
    if (!a.alive || a.status === 'exiled' || a.status === 'fled') continue;
    const x = (a.x + ox) * s, y = (a.y + oy) * s;
    mc.beginPath(); mc.arc(x, y, 2, 0, Math.PI * 2);
    mc.fillStyle = moodColor(a.mood).replace('0.5)', '0.8)'); mc.fill();
  }

  // Player
  const px = (state.player.x + ox) * s, py = (state.player.y + oy) * s;
  mc.beginPath(); mc.arc(px, py, 3.5, 0, Math.PI * 2);
  mc.fillStyle = '#fff'; mc.fill();
}

// ─── GAME LOOP ───
let lastTime = 0;

function gameLoop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;

  update(dt);
  updateActionEffects(dt);
  render();
  drawMinimap();
  updateExaminePanel();
  requestAnimationFrame(gameLoop);
}

function update(dt) {
  // Player WASD
  let pdx = 0, pdy = 0;
  if (state.keys['w'] || state.keys['arrowup']) pdy -= 1;
  if (state.keys['s'] || state.keys['arrowdown']) pdy += 1;
  if (state.keys['a'] || state.keys['arrowleft']) pdx -= 1;
  if (state.keys['d'] || state.keys['arrowright']) pdx += 1;

  let playerMoving = false;
  if (pdx || pdy) {
    const len = Math.sqrt(pdx*pdx + pdy*pdy);
    const speed = state.keys['shift'] ? PLAYER_SPEED * 1.5 : PLAYER_SPEED;
    state.player.x += (pdx/len) * speed * dt;
    state.player.y += (pdy/len) * speed * dt;
    state.player.moving = false; // cancel click-move
    if (pdx) state.player.flipH = pdx < 0;
    playerMoving = true;
  } else if (state.player.moving && state.player.waypoints && state.player.waypoints.length > 0) {
    const wp = state.player.waypoints[state.player.wpIdx];
    if (!wp) { state.player.moving = false; }
    else {
      const dx = wp.x - state.player.x, dy = wp.y - state.player.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < 8) {
        state.player.wpIdx++;
        if (state.player.wpIdx >= state.player.waypoints.length) {
          state.player.moving = false;
          // Open chat if we walked to an NPC
          if (state.player._pendingChat) {
            const npcId = state.player._pendingChat;
            state.player._pendingChat = null;
            const a = state.agents[npcId];
            if (a) {
              const d = Math.sqrt((state.player.x-a.x)**2 + (state.player.y-a.y)**2);
              if (d < 120) openChat(npcId);
            }
          }
        }
      } else {
        state.player.x += (dx/dist) * PLAYER_SPEED * dt;
        state.player.y += (dy/dist) * PLAYER_SPEED * dt;
        if (Math.abs(dx) > 2) state.player.flipH = dx < 0;
        playerMoving = true;
      }
    }
  }

  // Player animation
  state.player._isMoving = playerMoving;
  state.player.animTimer += dt * 1000;
  if (state.player.animTimer >= FRAME_MS) {
    state.player.animTimer = 0;
    state.player.frameIdx++;
  }

  // Player position sync to server (throttled: 5/sec)
  state.player._syncTimer = (state.player._syncTimer || 0) + dt;
  if (state.player._syncTimer >= 0.2 && state.ws && state.connected) {
    const px = Math.round(state.player.x), py = Math.round(state.player.y);
    if (px !== state.player._lastSyncX || py !== state.player._lastSyncY) {
      sendWS({ type: 'player_move', x: px, y: py });
      state.player._lastSyncX = px; state.player._lastSyncY = py;
    }
    state.player._syncTimer = 0;
  }

  // Camera zoom lerp (only when transitioning to/from chat)
  if (state._chatZoomTarget != null) {
    state.camera.zoom += (state._chatZoomTarget - state.camera.zoom) * dt * 4;
  }

  // Camera focus point (world center)
  if (state._chatCamTarget) {
    state.camera.fx += (state._chatCamTarget.x - state.camera.fx) * dt * 4;
    state.camera.fy += (state._chatCamTarget.y - state.camera.fy) * dt * 4;
  } else if (state._cameraReturning) {
    state.camera.fx += (state.player.x - state.camera.fx) * dt * 4;
    state.camera.fy += (state.player.y - state.camera.fy) * dt * 4;
  } else {
    state.camera.fx = state.player.x;
    state.camera.fy = state.player.y;
  }

  // NPC movement + animation
  for (const a of Object.values(state.agents)) {
    if (!a.alive) continue;
    if (a.status && a.status !== 'free' && a.status !== '') continue;

    if (a.moving && a.waypoints && a.waypoints.length > 0) {
      const wp = a.waypoints[a.wpIdx];
      if (!wp) { a.moving = false; continue; }
      const dx = wp.x - a.x, dy = wp.y - a.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < 8) {
        a.wpIdx++;
        if (a.wpIdx >= a.waypoints.length) {
          a.moving = false;
        }
      } else {
        let spd;
        if (a.transitDist > 0 && a.transitDuration > 0) {
          const realSeconds = a.transitDuration / Math.max(0.1, state.gameSpeed || 1);
          spd = a.transitDist / Math.max(1, realSeconds);
        } else {
          spd = NPC_SPEED;
        }
        a.x += (dx/dist) * spd * dt;
        a.y += (dy/dist) * spd * dt;
        if (Math.abs(dx) > 2) a.flipH = dx < 0;
      }
    } else if (a.moving) {
      a.moving = false;
    }

    // Sprite animation
    a.animTimer += dt * 1000;
    if (a.animTimer >= FRAME_MS) {
      a.animTimer = 0;
      a.frameIdx++;
    }

    // Thought/speech timers
    if (a._thought) {
      a._thought.timer -= dt;
      if (a._thought.timer <= 0) a._thought = null;
    }
    if (a._speech) {
      if (a._speech.typing) {
        // Typewriter: add ~30 chars/sec
        a._speech.charIdx += dt * 30;
        const idx = Math.min(Math.floor(a._speech.charIdx), a._speech.fullText.length);
        a._speech.text = a._speech.fullText.slice(0, idx);
        if (idx >= a._speech.fullText.length) {
          a._speech.typing = false;
          a._speech.timer = 3.0; // hold after finished typing
        }
      } else {
        a._speech.timer -= dt;
        if (a._speech.timer <= 0) a._speech = null;
      }
    }
  }
}

function render() {
  const logW = canvas.width / dpr, logH = canvas.height / dpr;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  const z = state.camera.zoom;
  // Derive top-left from focus point
  const camX = state.camera.fx - logW / (2 * z);
  const camY = state.camera.fy - logH / (2 * z);
  ctx.scale(dpr * z, dpr * z);
  ctx.translate(-camX, -camY);

  drawMap();
  drawBuildings();
  drawCrimeScenes();
  drawNPCs();
  drawPlayer();
  drawActionEffects();
  drawDayNight(logW, logH, camX, camY);

  ctx.restore();
}

function drawDayNight(logW, logH, camX, camY) {
  const overlays = {
    dawn:      { r: 200, g: 150, b: 80,  a: 0.08 },
    morning:   null,
    afternoon: { r: 200, g: 160, b: 100, a: 0.03 },
    evening:   { r: 160, g: 80,  b: 120, a: 0.18 },
    night:     { r: 20,  g: 30,  b: 80,  a: 0.38 },
  };
  const o = overlays[state.period];
  if (!o) return;
  ctx.fillStyle = `rgba(${o.r},${o.g},${o.b},${o.a})`;
  ctx.fillRect(camX, camY, logW / state.camera.zoom, logH / state.camera.zoom);
}

function drawMap() {
  // Water background — covers entire world
  const waterImg = loadSprite('/assets/tinyswords/Terrain/Tileset/Water%20Background%20color.png');
  if (waterImg.complete && waterImg.naturalWidth) {
    const z = state.camera.zoom;
    const viewW = (canvas.width / dpr) / z, viewH = (canvas.height / dpr) / z;
    const wCamX = state.camera.fx - viewW/2;
    const wCamY = state.camera.fy - viewH/2;
    const startX = Math.floor(wCamX / 64) * 64 - 64;
    const startY = Math.floor(wCamY / 64) * 64 - 64;
    const endX = wCamX + viewW + 128;
    const endY = wCamY + viewH + 128;
    for (let wx = startX; wx < endX; wx += 64) {
      for (let wy = startY; wy < endY; wy += 64) {
        ctx.drawImage(waterImg, wx, wy, 65, 65);
      }
    }
  } else {
    ctx.fillStyle = '#2a4a5a';
    const vw = canvas.width + 200, vh = canvas.height + 200;
    ctx.fillRect(state.camera.x - 100, state.camera.y - 100, vw, vh);
  }

  // Tilemap from Godot data
  if (mapData && atlasImg.complete && atlasImg.naturalWidth) {
    const ts = mapData.tileSize;
    for (const [tx, ty, ax, ay] of mapData.tiles) {
      const sx = ax * ts, sy = ay * ts;
      const dx = tx * ts, dy = ty * ts;
      ctx.drawImage(atlasImg, sx, sy, ts, ts, dx, dy, ts, ts);
    }
  }

  // Location labels (on top of terrain)
  ctx.fillStyle = 'rgba(255,255,240,0.6)';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 3;
  for (const [id, loc] of Object.entries(LOCATIONS)) {
    ctx.fillText(loc.label, loc.px, loc.py + 80);
  }
  ctx.shadowBlur = 0;
}

function drawBuildings() {
  for (const [id, loc] of Object.entries(LOCATIONS)) {
    const sprite = getBuildingSprite(id);
    if (!sprite || !sprite.complete) continue;
    const scale = 0.6;
    const bx = loc.px - sprite.width * scale / 2;
    const by = loc.py - sprite.height * scale + 20;
    ctx.drawImage(sprite, bx, by, sprite.width * scale, sprite.height * scale);
  }
}

function drawCrimeScenes() {
  if (!state.crimeScenes) return;
  const t = Date.now() / 1000;
  for (const cs of state.crimeScenes) {
    const loc = LOCATIONS[cs.locationId];
    if (!loc) continue;
    const pulse = 0.4 + Math.sin(t * 3) * 0.3;
    ctx.beginPath();
    ctx.arc(loc.px, loc.py, 50 + Math.sin(t * 2) * 10, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(220,40,40,${pulse})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = `rgba(220,40,40,${pulse * 0.15})`;
    ctx.fill();
    ctx.fillStyle = `rgba(255,80,80,${pulse})`;
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CRIME SCENE', loc.px, loc.py + 70);
  }
}

function drawNPCs() {
  for (const [id, a] of Object.entries(state.agents)) {
    const isDead = !a.alive;
    const isAbsent = a.status === 'exiled' || a.status === 'fled';
    const isDetained = a.status === 'detained';
    const isApproaching = state.approachingNpc === id;

    // Don't render absent NPCs
    if (isAbsent) continue;

    const sheet = (isDead || isDetained) ? a.sprites.idle : (a.moving ? a.sprites.run : a.sprites.idle);
    if (!sheet || !sheet.complete || !sheet.naturalWidth) continue;

    const frameW = 192, frameH = 192;
    const totalFrames = Math.floor(sheet.naturalWidth / frameW);
    const frame = isDead ? 0 : (a.frameIdx % totalFrames);

    // Mood ring (skip for dead)
    if (!isDead) {
      ctx.beginPath();
      ctx.arc(a.x, a.y + 10, 20, 0, Math.PI * 2);
      ctx.fillStyle = moodColor(a.mood);
      ctx.fill();
      // Mood pulse effect on significant shift
      if (a._moodPulse && a._moodPulse.timer > 0) {
        const p = a._moodPulse;
        const progress = 1 - p.timer;
        const radius = 20 + progress * 15;
        const alpha = p.timer * 0.6;
        ctx.beginPath();
        ctx.arc(a.x, a.y + 10, radius, 0, Math.PI * 2);
        ctx.strokeStyle = p.positive ? `rgba(100,200,100,${alpha})` : `rgba(200,80,80,${alpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Approach glow
    if (isApproaching) {
      const pulse = 0.5 + Math.sin(Date.now() / 300) * 0.3;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 35, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(80,200,120,${pulse})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Sprite
    ctx.save();
    const sw = frameW * SPRITE_SCALE, sh = frameH * SPRITE_SCALE;
    if (isDead) {
      // Dead: lying on side (rotated 90°) + faded + blood pool
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = '#8a2020';
      ctx.beginPath();
      ctx.ellipse(a.x, a.y + 8, 24, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.translate(a.x, a.y);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(sheet, 0, 0, frameW, frameH, -sw/2, -sh/2, sw, sh);
    } else if (a.flipH) {
      ctx.translate(a.x, a.y);
      ctx.scale(-1, 1);
      ctx.drawImage(sheet, frame * frameW, 0, frameW, frameH, -sw/2, -sh/2, sw, sh);
    } else {
      ctx.drawImage(sheet, frame * frameW, 0, frameW, frameH, a.x - sw/2, a.y - sh/2, sw, sh);
    }
    ctx.restore();

    // Name
    ctx.fillStyle = isDead ? '#888' : isDetained ? '#8ac' : '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
    ctx.fillText(a.name, a.x, a.y - 45);
    ctx.shadowBlur = 0;

    // Emotional state indicator — subtle visual cue for player observation
    if (!isDead && !isDetained) {
      let stateText = '';
      let stateColor = '';
      if (a.mood < -0.5) { stateText = 'distressed'; stateColor = '#e55'; }
      else if (a.mood < -0.3) { stateText = 'tense'; stateColor = '#da6'; }
      else if (a.mood > 0.3) { stateText = 'at ease'; stateColor = '#7b7'; }
      // Override with status-based states
      if (a.status === 'imprisoned') { stateText = 'imprisoned'; stateColor = '#8ac'; }
      if (stateText) {
        ctx.font = '8px sans-serif';
        ctx.fillStyle = stateColor;
        ctx.globalAlpha = 0.7;
        ctx.fillText(stateText, a.x, a.y - 36);
        ctx.globalAlpha = 1.0;
      }
    }

    // Thought bubble
    if (a._thought) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      const tw = ctx.measureText(a._thought.text).width + 16;
      ctx.fillRect(a.x - tw/2, a.y - 75, tw, 18);
      ctx.fillStyle = '#fc8';
      ctx.font = '9px sans-serif';
      ctx.fillText(a._thought.text, a.x, a.y - 62);
    }

    // Speech bubble (conversation lines)
    if (a._speech) {
      ctx.font = '9px sans-serif';
      const lines = a._speech.text.length > 30 ?
        [a._speech.text.slice(0, 30), a._speech.text.slice(30)] : [a._speech.text];
      const maxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
      const bh = lines.length * 13 + 8;
      // Bubble background
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.roundRect(a.x - maxW/2, a.y - 55 - bh, maxW, bh, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Bubble pointer
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(a.x - 5, a.y - 55);
      ctx.lineTo(a.x + 5, a.y - 55);
      ctx.lineTo(a.x, a.y - 48);
      ctx.fill();
      // Text
      ctx.fillStyle = '#222';
      ctx.textAlign = 'center';
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], a.x, a.y - 55 - bh + 14 + i * 13);
      }
    }

    // Detained overlay
    if (a.status === 'detained') {
      ctx.fillStyle = 'rgba(100,100,100,0.5)';
      ctx.fillRect(a.x - 25, a.y - 40, 50, 80);
      ctx.fillStyle = '#f88';
      ctx.font = 'bold 8px sans-serif';
      ctx.fillText('DETAINED', a.x, a.y + 50);
    }
  }
}

function drawPlayer() {
  const p = state.player;
  const sheet = p._isMoving ? p.sprites?.run : p.sprites?.idle;

  if (sheet && sheet.complete && sheet.naturalWidth) {
    const frameW = 192, frameH = 192;
    const totalFrames = Math.floor(sheet.naturalWidth / frameW);
    const frame = p.frameIdx % totalFrames;

    ctx.save();
    if (p.flipH) {
      ctx.translate(p.x, p.y);
      ctx.scale(-1, 1);
      ctx.drawImage(sheet, frame * frameW, 0, frameW, frameH,
        -frameW * SPRITE_SCALE / 2, -frameH * SPRITE_SCALE / 2,
        frameW * SPRITE_SCALE, frameH * SPRITE_SCALE);
    } else {
      ctx.drawImage(sheet, frame * frameW, 0, frameW, frameH,
        p.x - frameW * SPRITE_SCALE / 2, p.y - frameH * SPRITE_SCALE / 2,
        frameW * SPRITE_SCALE, frameH * SPRITE_SCALE);
    }
    ctx.restore();
  } else {
    // Fallback circle
    ctx.beginPath();
    ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#4a8af4';
    ctx.fill();
  }

  // Name label
  ctx.fillStyle = '#fc8';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
  ctx.fillText('You', p.x, p.y - 50);
  ctx.shadowBlur = 0;
}

// ─── START ───
init();
