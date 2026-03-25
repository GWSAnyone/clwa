/* ================================================================
   CLWA — Canvas2D Game Client
   Sprites from Tiny Swords, WS connection to backend
   ================================================================ */
'use strict';

// ─── CONFIG ───
const TILE = 64;
const MAP_W = 30, MAP_H = 20;
const NPC_SPEED = 100; // px/sec
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
  garrett: { unit:'Warrior', color:'Blue', item:'' },
  aldric:  { unit:'Monk', color:'Yellow', item:'' },
  hilda:   { unit:'Pawn', color:'Red', item:' Hammer' },
  bess:    { unit:'Monk', color:'Blue', item:'' },
  magistrate: { unit:'Warrior', color:'Purple', item:'' },
  player:     { unit:'Warrior', color:'Blue', item:'' },
};

// NPC → Avatar mapping (Tiny Swords Human Avatars)
const AVATAR_MAP = {
  garrett:     '01', ted: '04', hilda: '08', mark: '14',
  elara:       '20', aldric: '15', bess: '05', magistrate: '16',
  player:      '02',
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
  chatOpen: false, chatNpcId: null, chatMessages: [],
  autoTick: false,
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
  // Fetch agents
  const res = await fetch('/api/agents');
  const agents = await res.json();
  for (const a of agents) {
    // Use server-authoritative positions (x, y from /api/agents)
    const sprites = getUnitSprites(a.id);
    state.agents[a.id] = {
      name: a.name, role: a.role, location: a.location,
      mood: a.mood, alive: a.alive, status: a.status || '',
      x: a.x ?? 0, y: a.y ?? 0, targetX: a.x ?? 0, targetY: a.y ?? 0,
      moving: false, waypoints: [], wpIdx: 0,
      sprites, frameIdx: 0, animTimer: 0, flipH: false,
    };
  }

  // Player start
  const sq = locCenter('town-square');
  state.player.x = sq.x; state.player.y = sq.y;
  state.player.sprites = getUnitSprites('player');

  // Fetch time
  const timeRes = await fetch('/api/time');
  const timeData = await timeRes.json();
  state.day = timeData.gameDay; state.time = timeData.hour; state.period = timeData.period;
  updateHUD();

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
  });
  window.addEventListener('keyup', e => { state.keys[e.key.toLowerCase()] = false; });
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('mousemove', onCanvasMouseMove);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // Buttons
  document.getElementById('btn-tick').onclick = () => fetch('/api/tick', {method:'POST'});
  document.getElementById('btn-day').onclick = () => fetch('/api/day', {method:'POST'});
  document.getElementById('btn-auto').onclick = toggleAuto;
  // Restore auto-tick from localStorage
  if (localStorage.getItem('clwa-auto')) {
    state.autoTick = true;
    document.getElementById('btn-auto').textContent = 'Auto: ON';
    document.getElementById('btn-auto').classList.add('active');
    autoTickLoop();
  }
  document.getElementById('chat-close').onclick = closeChat;
  document.getElementById('chat-form').onsubmit = sendChat;

  // Start game loop
  requestAnimationFrame(gameLoop);
}

// ─── WEBSOCKET ───
function connectWS() {
  state.ws = new WebSocket(`ws://${location.host}/ws`);
  state.ws.onopen = () => { state.connected = true; document.getElementById('ws-status').className = 'connected'; };
  state.ws.onclose = () => { state.connected = false; document.getElementById('ws-status').className = ''; setTimeout(connectWS, 2000); };
  state.ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    handleWS(msg.type, msg.data);
  };
}

function handleWS(type, data) {
  switch(type) {
    case 'tick':
      state.day = data.gameDay;
      if (data.time) { state.time = data.time.hour; state.period = data.time.period; }
      updateHUD();
      break;

    case 'movement': {
      const moves = Array.isArray(data) ? data : [];
      for (const m of moves) {
        const npc = Object.values(state.agents).find(a => a.name === m.agentName);
        if (npc) {
          // Use server-authoritative target coordinates
          const tx = m.targetX ?? 0, ty = m.targetY ?? 0;
          npc.waypoints = astarPath(npc.x, npc.y, tx, ty);
          npc.wpIdx = 0;
          npc.moving = true;
          npc.location = m.to;
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
        if (initNpc) { initNpc.waypoints = astarPath(initNpc.x, initNpc.y, ap.ax, ap.ay); initNpc.wpIdx = 0; initNpc.moving = true; }
        if (respNpc) { respNpc.waypoints = astarPath(respNpc.x, respNpc.y, ap.bx, ap.by); respNpc.wpIdx = 0; respNpc.moving = true; }
      }
      break;
    }

    case 'event':
      const evType = data.type || '';
      addEvent(evType.includes('KILL') || evType.includes('STOLEN') ? 'crime' : 'conversation',
        `${evType}: ${data.subject || ''} → ${data.object || ''}`);
      break;

    case 'murder':
      const victim = Object.values(state.agents).find(a => a.name === data.victimName);
      if (victim) { victim.alive = false; }
      addEvent('crime', `${data.killerName} killed ${data.victimName}!`);
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
      if (mNpc) mNpc.mood = data.newMood;
      // Update chat mood bar if open for this NPC
      if (state.chatOpen && state.chatNpcId === data.npcId) {
        const pct = (data.newMood + 1) / 2 * 100;
        const bar = document.getElementById('chat-mood-bar');
        bar.style.width = pct + '%';
        bar.style.background = data.newMood > 0 ? '#4a8a4a' : data.newMood > -0.3 ? '#8a8a3a' : '#8a3a3a';
        document.getElementById('chat-mood-val').textContent = data.newMood.toFixed(2);
      }
      if (Math.abs(data.newMood - data.oldMood) > 0.05) {
        addEvent('mood', `${data.npcName} mood: ${data.oldMood.toFixed(2)} → ${data.newMood.toFixed(2)}`);
      }
      break;
    }

    case 'goal_update':
      addEvent('movement', `${data.npcName || data.npcId}: ${data.goalType} (${data.status})`);
      break;

    case 'event_cascade':
      for (const c of (data.consequences || [])) {
        addEvent('crime', `  ↳ ${c.type}: ${c.subject || '?'}`);
      }
      break;

    case 'chat:token':
      if (state.chatOpen) appendChatToken(data.token);
      break;

    case 'chat:done':
      break;
  }
}

// ─── HUD ───
function updateHUD() {
  document.getElementById('hud-day').textContent = state.day;
  document.getElementById('hud-time').textContent = state.time;
  document.getElementById('hud-period').textContent = state.period;
}

// ─── EVENT FEED ───
function addEvent(cls, text) {
  state.events.unshift({ cls, text, time: state.time });
  if (state.events.length > 50) state.events.pop();
  renderEventFeed();
}

function renderEventFeed() {
  const feed = document.getElementById('event-feed');
  feed.innerHTML = state.events.map(e =>
    `<div class="feed-item ${e.cls}"><span class="time">${e.time}</span> ${e.text}</div>`
  ).join('');
}

// ─── CHAT ───
function openChat(npcId) {
  state.chatOpen = true; state.chatNpcId = npcId;
  const a = state.agents[npcId];
  if (!a) return;

  // Avatar
  const avatarNum = AVATAR_MAP[npcId] || '01';
  document.getElementById('chat-avatar').src = `/assets/tinyswords/UI%20Elements/UI%20Elements/Human%20Avatars/Avatars_${avatarNum}.png`;

  // NPC info
  document.getElementById('chat-npc-name').textContent = a.name;
  document.getElementById('chat-npc-role').textContent = a.role;

  // Mood bar
  const moodPct = (a.mood + 1) / 2 * 100; // -1..1 → 0..100%
  const moodBar = document.getElementById('chat-mood-bar');
  moodBar.style.width = moodPct + '%';
  moodBar.style.background = a.mood > 0 ? '#4a8a4a' : a.mood > -0.3 ? '#8a8a3a' : '#8a3a3a';
  document.getElementById('chat-mood-val').textContent = a.mood.toFixed(2);

  // Clear messages
  document.getElementById('chat-messages').innerHTML = '';
  _chatTokenBuffer = '';

  // Show panel
  document.getElementById('chat-panel').classList.add('open');

  // Save current zoom and smoothly transition to NPC
  state._preZoom = state.camera.zoom;
  state._chatZoomTarget = Math.max(state.camera.zoom, 1.5); // zoom in but not out
  state._chatCamTarget = { x: a.x, y: a.y };

  setTimeout(() => document.getElementById('chat-input').focus(), 100);
}

function closeChat() {
  state.chatOpen = false; state.chatNpcId = null;
  document.getElementById('chat-panel').classList.remove('open');

  // Smooth return — lerp both zoom and position back to player
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
  state.ws.send(JSON.stringify({ type: 'chat', agentId: state.chatNpcId, message: text }));
  addChatMessage('You', text, 'player');
  input.value = '';
}

function addChatMessage(name, text, cls) {
  const div = document.getElementById('chat-messages');
  div.innerHTML += `<div class="msg msg-${cls}"><b>${name}</b>${text}</div>`;
  div.scrollTop = div.scrollHeight;
}

let _chatTokenBuffer = '';
function appendChatToken(token) {
  _chatTokenBuffer += token;
  // Update last NPC message or create new
  const div = document.getElementById('chat-messages');
  let last = div.querySelector('.msg-npc:last-child');
  if (!last || !last.dataset.streaming) {
    const a = state.agents[state.chatNpcId];
    div.innerHTML += `<div class="msg-npc" data-streaming="1"><b>${a?.name || ''}:</b> <span class="stream-text"></span></div>`;
    last = div.querySelector('.msg-npc:last-child');
  }
  last.querySelector('.stream-text').textContent = _chatTokenBuffer;
  div.scrollTop = div.scrollHeight;
}

// ─── AUTO TICK ───
function toggleAuto() {
  state.autoTick = !state.autoTick;
  localStorage.setItem('clwa-auto', state.autoTick ? '1' : '');
  const btn = document.getElementById('btn-auto');
  btn.textContent = state.autoTick ? 'Auto: ON' : 'Auto';
  btn.classList.toggle('active', state.autoTick);
  if (state.autoTick) autoTickLoop();
}

async function autoTickLoop() {
  if (!state.autoTick) return;
  await fetch('/api/tick', {method:'POST'});
  setTimeout(autoTickLoop, 8000);
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

// ─── GAME LOOP ───
let lastTime = 0;

function gameLoop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;

  update(dt);
  render();
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
      state.ws.send(JSON.stringify({ type: 'player_move', x: px, y: py }));
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
        a.x += (dx/dist) * NPC_SPEED * dt;
        a.y += (dy/dist) * NPC_SPEED * dt;
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
  drawNPCs();
  drawPlayer();

  ctx.restore();
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

function drawNPCs() {
  for (const [id, a] of Object.entries(state.agents)) {
    if (!a.alive) continue;
    if (a.status === 'exiled' || a.status === 'fled') continue;

    const sheet = a.moving ? a.sprites.run : a.sprites.idle;
    if (!sheet || !sheet.complete || !sheet.naturalWidth) continue;

    const frameW = 192, frameH = 192;
    const totalFrames = Math.floor(sheet.naturalWidth / frameW);
    const frame = a.frameIdx % totalFrames;

    // Mood ring
    ctx.beginPath();
    ctx.arc(a.x, a.y + 10, 20, 0, Math.PI * 2);
    ctx.fillStyle = moodColor(a.mood);
    ctx.fill();

    // Sprite
    ctx.save();
    if (a.flipH) {
      ctx.translate(a.x, a.y);
      ctx.scale(-1, 1);
      ctx.drawImage(sheet, frame * frameW, 0, frameW, frameH,
        -frameW * SPRITE_SCALE / 2, -frameH * SPRITE_SCALE / 2,
        frameW * SPRITE_SCALE, frameH * SPRITE_SCALE);
    } else {
      ctx.drawImage(sheet, frame * frameW, 0, frameW, frameH,
        a.x - frameW * SPRITE_SCALE / 2, a.y - frameH * SPRITE_SCALE / 2,
        frameW * SPRITE_SCALE, frameH * SPRITE_SCALE);
    }
    ctx.restore();

    // Name
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
    ctx.fillText(a.name, a.x, a.y - 45);
    ctx.shadowBlur = 0;

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
