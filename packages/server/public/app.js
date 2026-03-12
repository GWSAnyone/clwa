/* ================================================================
   CLWA Living World Demo — Frontend Application
   Vanilla JS, no frameworks, no build step
   ================================================================ */

(function () {
  'use strict';

  // --- State ---
  const state = {
    agents: [],
    events: [],
    locations: [],
    currentDay: 1,
    timeHour: '00:00',
    timePeriod: 'night',
    selectedNpcId: null,
    autoTick: false,
    chatStreaming: false,
    ws: null,
  };

  // --- Constants ---
  const ROLE_COLORS = {
    bartender: 'var(--role-bartender)',
    merchant: 'var(--role-merchant)',
    bard: 'var(--role-bard)',
    guard: 'var(--role-guard)',
    priest: 'var(--role-priest)',
    blacksmith: 'var(--role-blacksmith)',
    herbalist: 'var(--role-herbalist)',
  };

  const EVENT_ICONS = {
    NPC_KILLED: '\u2620\uFE0F',
    WITNESS_MEMORY: '\uD83D\uDC41',
    BODY_DISCOVERED: '\uD83D\uDD0D',
    RUMOR_SPREAD: '\uD83D\uDCAC',
    WANTED_STATUS: '\u2694',
    NPC_CONVERSATION: '\uD83D\uDDE3',
  };

  // Village map positions (percentage-based for responsive layout)
  // Layout:
  //   Temple (25%, 8%)       Residential (75%, 8%)
  //           \                /
  //   Market (22%, 38%) --- Town Square (50%, 50%) --- Blacksmith (78%, 38%)
  //                          /        \
  //                Tavern (22%, 82%)  Gate (78%, 82%)
  const LOCATION_POSITIONS = {
    'Temple of Dawn':       { x: 25, y: 8 },
    'Residential Lane':     { x: 75, y: 8 },
    'Market Square':        { x: 22, y: 38 },
    'Blacksmith':           { x: 78, y: 38 },
    'Town Square':          { x: 50, y: 55 },
    'Silver Flagon Tavern': { x: 22, y: 85 },
    'Town Gate':            { x: 78, y: 85 },
  };

  // --- DOM Cache ---
  const dom = {
    dayCounter: document.getElementById('day-counter'),
    timeDisplay: document.getElementById('time-display'),
    timePeriod: document.getElementById('time-period'),
    wsIndicator: document.getElementById('ws-indicator'),
    locationsContainer: document.getElementById('locations-container'),
    killSelect: document.getElementById('kill-select'),
    btnKill: document.getElementById('btn-kill'),
    btnDay: document.getElementById('btn-day'),
    btnTick: document.getElementById('btn-tick'),
    btnAuto: document.getElementById('btn-auto'),
    memoryPanel: document.getElementById('memory-panel'),
    memoryNpcName: document.getElementById('memory-npc-name'),
    memoryList: document.getElementById('memory-list'),
    chatSelect: document.getElementById('chat-select'),
    chatMessages: document.getElementById('chat-messages'),
    chatForm: document.getElementById('chat-form'),
    chatInput: document.getElementById('chat-input'),
    btnSend: document.getElementById('btn-send'),
    timelineList: document.getElementById('timeline-list'),
    toastContainer: document.getElementById('toast-container'),
  };

  // --- API Helpers ---

  async function apiFetch(path, options) {
    try {
      const res = await fetch(path, options);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'HTTP ' + res.status);
      }
      return res.json();
    } catch (err) {
      console.error('API error [' + path + ']:', err);
      throw err;
    }
  }

  function apiGet(path) {
    return apiFetch(path);
  }

  function apiPost(path, body) {
    return apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
    });
  }

  // --- Render: Village Map ---

  function renderMap() {
    const container = dom.locationsContainer;
    container.textContent = '';

    // Build NPC-to-location lookup from current agent state
    const locationNpcs = new Map();
    for (const agent of state.agents) {
      const loc = agent.location;
      if (!locationNpcs.has(loc)) locationNpcs.set(loc, []);
      locationNpcs.get(loc).push(agent);
    }

    // Create village map container
    const mapDiv = document.createElement('div');
    mapDiv.className = 'village-map';

    // SVG for connection lines
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'map-connections');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');

    // Draw connections
    const drawnConnections = new Set();
    for (const loc of state.locations) {
      const posA = LOCATION_POSITIONS[loc.name];
      if (!posA) continue;

      for (const connId of loc.connections) {
        const connLoc = state.locations.find((l) => l.id === connId);
        if (!connLoc) continue;
        const posB = LOCATION_POSITIONS[connLoc.name];
        if (!posB) continue;

        const key = [loc.id, connId].sort().join(':');
        if (drawnConnections.has(key)) continue;
        drawnConnections.add(key);

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', posA.x);
        line.setAttribute('y1', posA.y);
        line.setAttribute('x2', posB.x);
        line.setAttribute('y2', posB.y);
        svg.appendChild(line);
      }
    }

    mapDiv.appendChild(svg);

    // Create location nodes
    for (const loc of state.locations) {
      const pos = LOCATION_POSITIONS[loc.name];
      if (!pos) continue;

      const node = document.createElement('div');
      node.className = 'location-node';
      node.dataset.locationName = loc.name;
      node.style.left = pos.x + '%';
      node.style.top = pos.y + '%';

      const nameEl = document.createElement('div');
      nameEl.className = 'location-node-name';
      nameEl.textContent = loc.name;
      node.appendChild(nameEl);

      const npcsRow = document.createElement('div');
      npcsRow.className = 'location-node-npcs';

      const npcsHere = locationNpcs.get(loc.name) || [];
      for (const npc of npcsHere) {
        const dot = document.createElement('div');
        dot.className = 'location-npc-dot';
        dot.dataset.role = npc.role;
        if (!npc.alive) dot.classList.add('dead');
        dot.textContent = npc.name.charAt(0);
        dot.addEventListener('click', () => selectNpc(npc.id));

        const tooltip = document.createElement('div');
        tooltip.className = 'location-npc-tooltip';
        tooltip.textContent = npc.name + ' (' + npc.role + ')';
        dot.appendChild(tooltip);

        npcsRow.appendChild(dot);
      }

      node.appendChild(npcsRow);
      mapDiv.appendChild(node);
    }

    container.appendChild(mapDiv);
  }

  // --- Render: Timeline ---

  function renderTimeline() {
    dom.timelineList.textContent = '';
    if (state.events.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No events yet. Try advancing a day or triggering a tick.';
      dom.timelineList.appendChild(empty);
      return;
    }
    for (const ev of state.events) {
      appendTimelineEntry(ev, false);
    }
  }

  function appendTimelineEntry(ev, isNew) {
    const empty = dom.timelineList.querySelector('.empty-state');
    if (empty) empty.remove();

    const entry = document.createElement('div');
    entry.className = 'timeline-entry';
    if (isNew) entry.classList.add('new');

    const icon = document.createElement('span');
    icon.className = 'timeline-icon';
    icon.textContent = EVENT_ICONS[ev.type] || '\u2022';
    entry.appendChild(icon);

    const day = document.createElement('span');
    day.className = 'timeline-day';
    day.textContent = 'd' + (ev.gameDay ?? '?');
    entry.appendChild(day);

    const text = document.createElement('span');
    text.className = 'timeline-text';
    text.textContent = formatEventText(ev);
    entry.appendChild(text);

    dom.timelineList.appendChild(entry);
    dom.timelineList.scrollTop = dom.timelineList.scrollHeight;
  }

  function formatEventText(ev) {
    const subj = ev.subjectName || ev.subject;
    const obj = ev.objectName || ev.object || '';
    switch (ev.type) {
      case 'NPC_KILLED':
        return subj + ' killed ' + obj;
      case 'WITNESS_MEMORY':
        return subj + ' witnessed the event';
      case 'BODY_DISCOVERED':
        return subj + ' discovered a body';
      case 'RUMOR_SPREAD':
        return 'Rumor reached ' + (obj || subj);
      case 'WANTED_STATUS':
        return (obj || 'Guard') + ' issued wanted notice for ' + subj;
      case 'NPC_CONVERSATION':
        return subj + ' talked with ' + obj;
      default:
        return ev.type + ': ' + subj + (obj ? ' -> ' + obj : '');
    }
  }

  // --- Render: Dropdowns ---

  function populateSelects() {
    const aliveNpcs = state.agents.filter((a) => a.alive);

    // Kill select
    dom.killSelect.textContent = '';
    const killPlaceholder = document.createElement('option');
    killPlaceholder.value = '';
    killPlaceholder.textContent = 'Kill...';
    dom.killSelect.appendChild(killPlaceholder);
    for (const npc of aliveNpcs) {
      const opt = document.createElement('option');
      opt.value = npc.id;
      opt.textContent = npc.name;
      dom.killSelect.appendChild(opt);
    }

    // Chat select
    const prevChat = dom.chatSelect.value;
    dom.chatSelect.textContent = '';
    const chatPlaceholder = document.createElement('option');
    chatPlaceholder.value = '';
    chatPlaceholder.textContent = 'Select NPC...';
    dom.chatSelect.appendChild(chatPlaceholder);
    for (const npc of aliveNpcs) {
      const opt = document.createElement('option');
      opt.value = npc.id;
      opt.textContent = npc.name;
      dom.chatSelect.appendChild(opt);
    }
    if (prevChat && aliveNpcs.some((a) => a.id === prevChat)) {
      dom.chatSelect.value = prevChat;
    }
  }

  // --- NPC Selection ---

  function selectNpc(npcId) {
    state.selectedNpcId = npcId;
    dom.chatSelect.value = npcId;
    renderMap();
    loadMemories(npcId);
  }

  async function loadMemories(npcId) {
    const npc = state.agents.find((a) => a.id === npcId);
    if (!npc) {
      dom.memoryPanel.classList.add('hidden');
      return;
    }

    dom.memoryNpcName.textContent = npc.name;
    dom.memoryPanel.classList.remove('hidden');
    dom.memoryList.textContent = '';

    const loadingEl = document.createElement('div');
    loadingEl.className = 'empty-state';
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    loadingEl.appendChild(spinner);
    dom.memoryList.appendChild(loadingEl);

    try {
      const memories = await apiGet('/api/memories/' + npcId);
      dom.memoryList.textContent = '';

      if (memories.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'No memories yet.';
        dom.memoryList.appendChild(empty);
        return;
      }

      memories.sort((a, b) => (b.decayedImportance ?? b.importance) - (a.decayedImportance ?? a.importance));

      for (const mem of memories) {
        const item = document.createElement('div');
        item.className = 'memory-item';

        const textEl = document.createElement('div');
        textEl.textContent = mem.text;
        item.appendChild(textEl);

        const meta = document.createElement('div');
        meta.className = 'memory-item-meta';
        meta.textContent = 'day ' + mem.gameDay + '  |  imp: ' + (mem.decayedImportance ?? mem.importance).toFixed(1);
        item.appendChild(meta);

        dom.memoryList.appendChild(item);
      }
    } catch {
      dom.memoryList.textContent = '';
      const errEl = document.createElement('div');
      errEl.className = 'empty-state';
      errEl.textContent = 'Failed to load memories.';
      dom.memoryList.appendChild(errEl);
    }
  }

  // --- Chat ---

  function addChatBubble(type, senderName, text) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble ' + type;

    if (type === 'npc' && senderName) {
      const sender = document.createElement('div');
      sender.className = 'chat-sender';
      const npc = state.agents.find((a) => a.name === senderName || a.id === senderName);
      sender.style.color = npc ? (ROLE_COLORS[npc.role] || 'var(--text-muted)') : 'var(--text-muted)';
      sender.textContent = senderName;
      bubble.appendChild(sender);
    }

    const body = document.createElement('div');
    body.className = 'chat-body';
    body.textContent = text;
    bubble.appendChild(body);

    dom.chatMessages.appendChild(bubble);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    return body;
  }

  function addConversationLine(speakerName, text) {
    const line = document.createElement('div');
    line.className = 'conversation-line';

    const speaker = document.createElement('span');
    speaker.className = 'conv-speaker';
    const npc = state.agents.find((a) => a.name === speakerName);
    speaker.style.color = npc ? (ROLE_COLORS[npc.role] || 'var(--text-secondary)') : 'var(--text-secondary)';
    speaker.textContent = speakerName + ': ';
    line.appendChild(speaker);

    const textNode = document.createTextNode(text);
    line.appendChild(textNode);

    dom.chatMessages.appendChild(line);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  }

  function addTickSeparator(tickData) {
    var sep = document.createElement('div');
    sep.className = 'tick-separator';
    var timeStr = tickData.time ? tickData.time.hour + ' ' + tickData.time.period : '';
    var parts = ['Tick ' + tickData.tickNumber];
    if (timeStr) parts.push(timeStr);
    if (tickData.dayAdvanced) parts.push('NEW DAY ' + tickData.gameDay);

    var summary = [];
    if (tickData.goalActions && tickData.goalActions.length > 0) summary.push(tickData.goalActions.length + ' goal actions');
    if (tickData.movements && tickData.movements.length > 0) summary.push(tickData.movements.length + ' movements');
    if (tickData.conversation) summary.push('conversation');
    if (tickData.idleReason) summary.push('idle');

    sep.innerHTML = '<span class="tick-sep-label">' + parts.join(' | ') + '</span>' +
      (summary.length > 0 ? '<span class="tick-sep-summary">' + summary.join(', ') + '</span>' : '');
    dom.chatMessages.appendChild(sep);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  }

  function addMovementLine(movements) {
    for (const m of movements) {
      var line = document.createElement('div');
      line.className = 'conversation-line';
      line.style.borderLeftColor = 'var(--accent-warning)';
      line.style.fontStyle = 'italic';
      line.textContent = m.agentName + ' moved from ' + m.from + ' to ' + m.to;
      dom.chatMessages.appendChild(line);
    }
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  }

  function addGoalActionLine(action) {
    var line = document.createElement('div');
    line.className = 'conversation-line';

    if (action.interaction) {
      // Goal-driven interaction — show as two lines
      line.style.borderLeftColor = 'var(--accent-danger)';
      var purpose = document.createElement('div');
      purpose.style.fontSize = '0.7rem';
      purpose.style.color = 'var(--text-muted)';
      purpose.style.marginBottom = '4px';
      purpose.textContent = '[' + action.goalType.toUpperCase() + '] ' + action.interaction.purpose;
      line.appendChild(purpose);

      var ownerSpan = document.createElement('span');
      ownerSpan.className = 'conv-speaker';
      ownerSpan.style.color = getNpcColor(action.ownerName);
      ownerSpan.textContent = action.ownerName + ': ';
      line.appendChild(ownerSpan);
      line.appendChild(document.createTextNode(action.interaction.ownerLine));
      dom.chatMessages.appendChild(line);

      var line2 = document.createElement('div');
      line2.className = 'conversation-line';
      line2.style.borderLeftColor = 'var(--accent-danger)';
      var targetSpan = document.createElement('span');
      targetSpan.className = 'conv-speaker';
      targetSpan.style.color = getNpcColor(action.interaction.targetName);
      targetSpan.textContent = action.interaction.targetName + ': ';
      line2.appendChild(targetSpan);
      line2.appendChild(document.createTextNode(action.interaction.targetLine));
      dom.chatMessages.appendChild(line2);
    } else if (action.movement) {
      line.style.borderLeftColor = 'var(--accent-danger)';
      line.style.fontStyle = 'italic';
      line.textContent = '[' + action.goalType.toUpperCase() + '] ' + action.description;
      dom.chatMessages.appendChild(line);
    } else if (action.announcement) {
      line.style.borderLeftColor = 'var(--accent-warning)';
      line.style.fontWeight = '600';
      line.textContent = action.ownerName + ': "' + action.announcement.message + '"';
      dom.chatMessages.appendChild(line);
    } else if (action.goalCompleted) {
      line.style.borderLeftColor = 'var(--accent-success)';
      line.style.fontStyle = 'italic';
      line.textContent = action.description;
      dom.chatMessages.appendChild(line);
    } else {
      line.style.borderLeftColor = 'var(--text-muted)';
      line.style.fontStyle = 'italic';
      line.textContent = action.description;
      dom.chatMessages.appendChild(line);
    }

    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  }

  function getNpcColor(name) {
    var npc = state.agents.find(function (a) { return a.name === name; });
    return npc ? (ROLE_COLORS[npc.role] || 'var(--text-secondary)') : 'var(--text-secondary)';
  }

  var streamingBubbleBody = null;

  function handleChatSubmit(e) {
    e.preventDefault();
    var message = dom.chatInput.value.trim();
    var agentId = dom.chatSelect.value;
    if (!message || !agentId || state.chatStreaming) return;

    var npc = state.agents.find((a) => a.id === agentId);
    if (!npc || !npc.alive) return;

    addChatBubble('player', null, message);
    dom.chatInput.value = '';

    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.chatStreaming = true;
      dom.btnSend.disabled = true;
      streamingBubbleBody = addChatBubble('npc', npc.name, '');
      state.ws.send(JSON.stringify({ type: 'chat', agentId: agentId, message: message }));
    }
  }

  // --- Toast Notifications ---

  function showToast(title, body) {
    var toast = document.createElement('div');
    toast.className = 'toast';

    var titleEl = document.createElement('div');
    titleEl.className = 'toast-title';
    titleEl.textContent = title;
    toast.appendChild(titleEl);

    var bodyEl = document.createElement('div');
    bodyEl.className = 'toast-body';
    bodyEl.textContent = body;
    toast.appendChild(bodyEl);

    dom.toastContainer.appendChild(toast);
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 5200);
  }

  // --- Time Display ---

  function updateTimeDisplay(timeInfo) {
    state.timeHour = timeInfo.hour || '00:00';
    state.timePeriod = timeInfo.period || 'night';
    dom.timeDisplay.textContent = state.timeHour;
    dom.timePeriod.textContent = state.timePeriod;
    dom.timePeriod.dataset.period = state.timePeriod;
  }

  // --- WebSocket ---

  function connectWebSocket() {
    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsUrl = protocol + '//' + location.host + '/ws';
    var ws = new WebSocket(wsUrl);

    ws.addEventListener('open', function () {
      dom.wsIndicator.classList.add('connected');
      dom.wsIndicator.title = 'WebSocket connected';
      state.ws = ws;
    });

    ws.addEventListener('close', function () {
      dom.wsIndicator.classList.remove('connected');
      dom.wsIndicator.title = 'WebSocket disconnected';
      state.ws = null;
      setTimeout(connectWebSocket, 3000);
    });

    ws.addEventListener('error', function () {});

    ws.addEventListener('message', function (rawEvent) {
      var msg;
      try {
        msg = JSON.parse(rawEvent.data);
      } catch {
        return;
      }
      handleWSMessage(msg);
    });
  }

  function handleWSMessage(msg) {
    switch (msg.type) {
      case 'chat:token':
        if (streamingBubbleBody) {
          streamingBubbleBody.textContent += msg.data.token;
          dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
        }
        break;

      case 'chat:done':
        if (streamingBubbleBody) {
          streamingBubbleBody.textContent = msg.data.fullReply;
          streamingBubbleBody = null;
        }
        state.chatStreaming = false;
        dom.btnSend.disabled = false;
        dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
        break;

      case 'conversation:line':
        addConversationLine(msg.data.speakerName, msg.data.text);
        break;

      case 'conversation:complete': {
        var conv = msg.data;
        var evObj = {
          type: 'NPC_CONVERSATION',
          subjectName: conv.initiator,
          objectName: conv.responder,
          gameDay: conv.gameDay,
        };
        state.events.push(evObj);
        appendTimelineEntry(evObj, true);
        break;
      }

      case 'event':
        state.events.push(msg.data);
        appendTimelineEntry(msg.data, true);
        refreshAgents();
        break;

      case 'tick':
        if (msg.data) {
          if (msg.data.gameDay) {
            state.currentDay = msg.data.gameDay;
            dom.dayCounter.textContent = state.currentDay;
          }
          if (msg.data.time) {
            updateTimeDisplay(msg.data.time);
          }
          if (msg.data.dayAdvanced) {
            showToast('New Day', 'Day ' + msg.data.gameDay + ' has begun');
          }
          // Add tick separator to chat log
          addTickSeparator(msg.data);
        }
        break;

      case 'reflection':
        showToast(
          'Reflection: ' + msg.data.agentName,
          msg.data.text.length > 200 ? msg.data.text.slice(0, 200) + '...' : msg.data.text
        );
        break;

      case 'movement':
        addMovementLine(msg.data);
        refreshAgents();
        for (var mi = 0; mi < msg.data.length; mi++) {
          flashLocation(msg.data[mi].to);
          flashLocation(msg.data[mi].from);
        }
        break;

      case 'goal:action':
        addGoalActionLine(msg.data);
        if (msg.data.movement) {
          refreshAgents();
          flashLocation(msg.data.movement.to);
          flashLocation(msg.data.movement.from);
        }
        if (msg.data.interaction || msg.data.announcement) {
          refreshAgents();
        }
        break;

      case 'state:update':
        updateAgentState(msg.data);
        break;
    }
  }

  function flashLocation(locName) {
    var node = document.querySelector('.location-node[data-location-name="' + locName + '"]');
    if (node) {
      node.classList.remove('movement-flash');
      void node.offsetWidth; // force reflow
      node.classList.add('movement-flash');
    }
  }

  function updateAgentState(data) {
    var agent = state.agents.find((a) => a.id === data.agentId);
    if (!agent) return;
    if (data.mood != null) agent.mood = data.mood;
    if (data.alive != null) agent.alive = data.alive;
    if (data.location != null) agent.location = data.location;
    renderMap();
    populateSelects();
  }

  // --- Actions ---

  async function refreshAgents() {
    try {
      state.agents = await apiGet('/api/agents');
      renderMap();
      populateSelects();
      if (state.agents.length > 0 && state.agents[0].currentDay) {
        state.currentDay = state.agents[0].currentDay;
        dom.dayCounter.textContent = state.currentDay;
      }
    } catch {
      // retry on next action
    }
  }

  async function doKill() {
    var victimId = dom.killSelect.value;
    if (!victimId) return;
    dom.btnKill.disabled = true;
    try {
      await apiPost('/api/kill/' + victimId);
      await refreshAgents();
      await refreshEvents();
    } catch (err) {
      showToast('Error', 'Kill failed: ' + err.message);
    } finally {
      dom.btnKill.disabled = false;
    }
  }

  async function doAdvanceDay() {
    dom.btnDay.disabled = true;
    try {
      var result = await apiPost('/api/day');
      if (result.newDay) {
        state.currentDay = result.newDay;
        dom.dayCounter.textContent = state.currentDay;
      }
      await refreshAgents();
      await refreshEvents();
    } catch (err) {
      showToast('Error', 'Advance day failed: ' + err.message);
    } finally {
      dom.btnDay.disabled = false;
    }
  }

  async function doTick() {
    dom.btnTick.disabled = true;
    dom.btnTick.textContent = 'Tick...';
    dom.btnTick.classList.add('ticking');
    try {
      await apiPost('/api/tick');
      await refreshAgents();
      await refreshEvents();
    } catch (err) {
      showToast('Error', 'Tick failed: ' + err.message);
    } finally {
      dom.btnTick.disabled = false;
      dom.btnTick.textContent = 'Tick';
      dom.btnTick.classList.remove('ticking');
    }
  }

  async function doToggleAuto() {
    try {
      var result = await apiPost('/api/auto', { seconds: 15 });
      state.autoTick = result.autoTick;
      dom.btnAuto.textContent = state.autoTick ? 'Auto: ON (15s)' : 'Auto: OFF';
      dom.btnAuto.classList.toggle('active', state.autoTick);
    } catch (err) {
      showToast('Error', 'Auto toggle failed: ' + err.message);
    }
  }

  async function refreshEvents() {
    try {
      state.events = await apiGet('/api/events');
      renderTimeline();
    } catch {
      // keep existing
    }
  }

  async function refreshLocations() {
    try {
      state.locations = await apiGet('/api/locations');
    } catch {
      // fallback: empty
    }
  }

  // --- Event Bindings ---

  function bindEvents() {
    dom.killSelect.addEventListener('change', function () {
      dom.btnKill.disabled = !dom.killSelect.value;
    });

    dom.btnKill.addEventListener('click', doKill);
    dom.btnDay.addEventListener('click', doAdvanceDay);
    dom.btnTick.addEventListener('click', doTick);
    dom.btnAuto.addEventListener('click', doToggleAuto);

    dom.chatForm.addEventListener('submit', handleChatSubmit);

    dom.chatSelect.addEventListener('change', function () {
      var npcId = dom.chatSelect.value;
      if (npcId) selectNpc(npcId);
    });
  }

  // --- Init ---

  async function init() {
    bindEvents();
    connectWebSocket();

    try {
      var results = await Promise.all([
        apiGet('/api/agents'),
        apiGet('/api/events'),
        apiGet('/api/state'),
        apiGet('/api/locations'),
        apiGet('/api/time'),
      ]);

      state.agents = results[0];
      state.events = results[1];
      state.currentDay = results[2].currentDay || 1;
      state.locations = results[3];
      dom.dayCounter.textContent = state.currentDay;

      if (results[4]) {
        updateTimeDisplay(results[4]);
      }

      renderMap();
      populateSelects();
      renderTimeline();

      var firstAlive = state.agents.find((a) => a.alive);
      if (firstAlive) {
        selectNpc(firstAlive.id);
      }
    } catch (err) {
      console.error('Init failed:', err);
      showToast('Connection Error', 'Could not reach the server. Make sure it is running on port 3000.');
    }
  }

  init();
})();
