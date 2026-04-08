import type { EventType } from '@clwa/engine';
import { broadcast } from './ws';
import type { GameContext } from './game-context';

/** Build all REST route handlers */
export async function handleRequest(
  req: Request,
  ctx: GameContext,
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // CORS headers for all responses
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // ─── Resetting guard ───
  if (ctx.resetting) {
    return Response.json({ error: 'Server restarting' }, { status: 503, headers: cors });
  }

  // ─── Destructure ctx — all code below uses local vars unchanged ───
  const { world, eventStore, agents, positionManager, seed } = ctx;
  const options = { positionManager, onSave: ctx.onSave };

  // ─── POST /api/new-game ───
  if (method === 'POST' && path === '/api/new-game') {
    const seedParam = url.searchParams.get('seed');
    let newSeed: number;
    if (seedParam) {
      newSeed = parseInt(seedParam, 10);
      if (isNaN(newSeed)) {
        return Response.json({ error: 'Invalid seed' }, { status: 400, headers: cors });
      }
    } else {
      newSeed = Date.now();
    }
    if (ctx.resetting) {
      return Response.json({ error: 'Reset in progress' }, { status: 429, headers: cors });
    }
    // Delegate to newGame handler attached by index.ts
    const newGameFn = ctx.newGame;
    if (!newGameFn) {
      return Response.json({ error: 'New game not available' }, { status: 501, headers: cors });
    }
    await newGameFn(newSeed);
    return Response.json({ seed: newSeed, message: 'New game started' }, { headers: cors });
  }

  // ─── GET /api/seed ───
  if (method === 'GET' && path === '/api/seed') {
    return Response.json({ seed }, { headers: cors });
  }

  // ─── GET /api/agents ───
  if (method === 'GET' && path === '/api/agents') {
    const pm = positionManager;
    const list = Array.from(agents.entries())
      .filter(([, agent]) => !agent.profile.isPlayer)
      .map(([id, agent]) => {
        const pos = pm?.getPosition(id);
        return {
          id,
          name: agent.profile.name,
          role: agent.profile.role,
          location: agent.state.location,
          alive: agent.state.alive,
          status: agent.state.status ?? 'free',
          mood: agent.state.mood,
          currentDay: agent.state.currentDay,
          x: pos?.x ?? 0,
          y: pos?.y ?? 0,
          inTransit: pos?.inTransit ?? false,
          reflection: agent.getReflectionStatus(),
          background: agent.profile.background,
          speechStyle: agent.profile.speechStyle,
          beliefCount: agent.state.beliefs?.getAllBeliefs().length ?? 0,
          relationshipCount: agent.state.relationships?.getAllRelationships().length ?? 0,
          hasShop: !!(agent.profile.shop && agent.profile.shop.length > 0),
          investigator: agent.profile.investigator ?? false,
        };
      });
    return Response.json(list, { headers: cors });
  }

  // ─── GET /api/agent/:id ───
  if (method === 'GET' && path.startsWith('/api/agent/') && !path.startsWith('/api/agents')) {
    const agentId = path.split('/')[3];
    const agent = agents.get(agentId);
    if (!agent) return Response.json({ error: 'Agent not found' }, { status: 404, headers: cors });
    const pm = positionManager;
    const pos = pm?.getPosition(agentId);
    return Response.json({
      id: agentId,
      name: agent.profile.name,
      role: agent.profile.role,
      background: agent.profile.background,
      location: agent.state.location,
      alive: agent.state.alive,
      status: agent.state.status ?? 'free',
      mood: agent.state.mood,
      bigFive: agent.profile.bigFive,
      enneagram: agent.profile.enneagram,
      shop: agent.profile.shop || null,
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
    }, { headers: cors });
  }

  // ─── GET /api/goals ───
  if (method === 'GET' && path === '/api/goals') {
    const goals = world.goalManager.getAllGoals().map((g) => ({
      id: g.id,
      type: g.type,
      ownerId: g.ownerId,
      ownerName: agents.get(g.ownerId)?.profile.name ?? g.ownerId,
      priority: g.priority,
      state: g.state,
      currentStep: g.currentStep,
      totalSteps: g.steps.length,
      data: g.data,
      createdAtMinute: g.createdAtMinute,
    }));
    return Response.json(goals, { headers: cors });
  }

  // ─── GET /api/locations ───
  if (method === 'GET' && path === '/api/locations') {
    const locations = Array.from(world.locations.values()).map((loc) => ({
      id: loc.id,
      name: loc.name,
      connections: loc.connections,
      isPublic: loc.isPublic,
      npcs: Array.from(agents.entries())
        .filter(([, a]) => a.state.location === loc.id)
        .map(([id, a]) => ({ id, name: a.profile.name, role: a.profile.role, alive: a.state.alive })),
    }));
    return Response.json(locations, { headers: cors });
  }

  // ─── GET /api/time ───
  if (method === 'GET' && path === '/api/time') {
    const sm = world.scheduleManager;
    const minuteOfDay = world.minuteOfDay;
    return Response.json({
      ...(sm ? sm.getTimeInfo(minuteOfDay) : { minuteOfDay, period: world.currentPeriod, hour: world.currentHour }),
      gameDay: agents.values().next().value?.state.currentDay ?? 1,
      gameMinute: world.gameMinute,
      gameSpeed: world.gameSpeed,
    }, { headers: cors });
  }

  // ─── GET /api/schedules ───
  if (method === 'GET' && path === '/api/schedules') {
    const sm = world.scheduleManager;
    return Response.json({
      entries: sm?.getAllEntries() ?? [],
      minuteOfDay: world.minuteOfDay,
      period: world.currentPeriod,
    }, { headers: cors });
  }

  // ─── GET /api/events ───
  if (method === 'GET' && path === '/api/events') {
    const typeFilter = url.searchParams.get('type') as EventType | null;
    const events = typeFilter
      ? eventStore.query({ type: typeFilter })
      : eventStore.getAll();

    const mapped = events.map((e) => ({
      ...e,
      subjectName: agents.get(e.subject)?.profile.name ?? e.subject,
      objectName: e.object ? (agents.get(e.object)?.profile.name ?? e.object) : null,
    }));
    return Response.json(mapped, { headers: cors });
  }

  // ─── GET /api/state ───
  if (method === 'GET' && path === '/api/state') {
    const dayParam = url.searchParams.get('day');
    const state = dayParam
      ? eventStore.getStateAtDay(parseInt(dayParam) || 1)
      : eventStore.getState();

    return Response.json({
      currentDay: state.currentDay,
      deadNpcs: Array.from(state.deadNpcs).map((id) => ({
        id,
        name: agents.get(id)?.profile.name ?? id,
      })),
      wantedSubjects: Array.from(state.wantedSubjects),
      npcMoodShifts: Object.fromEntries(state.npcMoodShifts),
      locationFacts: Object.fromEntries(state.locationFacts),
      eventCount: eventStore.count,
    }, { headers: cors });
  }

  // ─── GET /api/beliefs/:id ───
  if (method === 'GET' && path.startsWith('/api/beliefs/')) {
    const agentId = path.split('/').pop()!;
    const agent = agents.get(agentId);
    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404, headers: cors });
    }
    return Response.json(agent.state.beliefs?.toJSON() ?? [], { headers: cors });
  }

  // ─── GET /api/relationships/:id ───
  if (method === 'GET' && path.startsWith('/api/relationships/')) {
    const agentId = path.split('/').pop()!;
    const agent = agents.get(agentId);
    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404, headers: cors });
    }
    return Response.json(agent.state.relationships?.toJSON() ?? [], { headers: cors });
  }

  // ─── GET /api/memories/:id ───
  if (method === 'GET' && path.startsWith('/api/memories/')) {
    const agentId = path.split('/').pop()!;
    const agent = agents.get(agentId);
    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404, headers: cors });
    }
    return agent.getMemories().then((mems) =>
      Response.json(mems, { headers: cors }),
    );
  }

  // ─── GET /api/shop/:id ───
  if (method === 'GET' && path.startsWith('/api/shop/')) {
    const agentId = path.split('/').pop()!;
    const agent = agents.get(agentId);
    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404, headers: cors });
    }
    return Response.json({
      npcName: agent.profile.name,
      items: agent.profile.shop ?? [],
    }, { headers: cors });
  }

  // ─── GET /api/journal ───
  if (method === 'GET' && path === '/api/journal') {
    const typeFilter = url.searchParams.get('type') as 'clue' | 'testimony' | 'observation' | null;
    const groupBy = url.searchParams.get('groupBy');

    if (groupBy === 'suspect') {
      const entries = world.journal.getEntries(typeFilter ? { type: typeFilter } : undefined);
      const grouped: Record<string, { name: string; isSuspect: boolean; entries: typeof entries; evidenceCount: number }> = {};
      const unrelated: typeof entries = [];

      for (const entry of entries) {
        if (entry.relatedNpcs.length === 0) {
          unrelated.push(entry);
          continue;
        }
        for (const npcId of entry.relatedNpcs) {
          if (!grouped[npcId]) {
            const npcAgent = agents.get(npcId);
            grouped[npcId] = {
              name: npcAgent?.profile.name ?? npcId,
              isSuspect: world.journal.isSuspect(npcId),
              entries: [],
              evidenceCount: 0,
            };
          }
          grouped[npcId].entries.push(entry);
          if (entry.evidenceCategory) grouped[npcId].evidenceCount++;
        }
      }
      return Response.json({ suspects: grouped, unrelated }, { headers: cors });
    }

    const entries = world.journal.getEntries(typeFilter ? { type: typeFilter } : undefined);
    return Response.json(entries, { headers: cors });
  }

  // ─── GET /api/journal/case/:npcId ───
  if (method === 'GET' && path.startsWith('/api/journal/case/')) {
    const npcId = decodeURIComponent(path.slice('/api/journal/case/'.length));
    const npcAgent = agents.get(npcId);
    if (!npcAgent) {
      return Response.json({ error: 'NPC not found' }, { status: 404, headers: cors });
    }
    const summary = world.journal.getCaseSummary(npcId, npcAgent.profile.name);
    return Response.json(summary, { headers: cors });
  }

  // ─── POST /api/journal/suspect/:npcId ───
  if (method === 'POST' && path.startsWith('/api/journal/suspect/')) {
    const npcId = decodeURIComponent(path.slice('/api/journal/suspect/'.length));
    const npcAgent = agents.get(npcId);
    if (!npcAgent) {
      return Response.json({ error: 'NPC not found' }, { status: 404, headers: cors });
    }
    const isNowSuspect = world.journal.markSuspect(npcId);
    return Response.json({ npcId, name: npcAgent.profile.name, isSuspect: isNowSuspect }, { headers: cors });
  }

  // ─── GET /api/journal/suspects ───
  if (method === 'GET' && path === '/api/journal/suspects') {
    const suspectIds = world.journal.getSuspects();
    const suspects = suspectIds.map((id) => ({
      id,
      name: agents.get(id)?.profile.name ?? id,
    }));
    return Response.json(suspects, { headers: cors });
  }

  // ─── GET /api/evidence(/:locationId) ───
  if (method === 'GET' && path.startsWith('/api/evidence')) {
    const locPart = path.slice('/api/evidence'.length).replace(/^\//, '');
    const locationId = locPart ? decodeURIComponent(locPart) : null;

    const result: Array<{
      id: string; eventType: string; category: string; location: string;
      subjectName: string | null; objectName: string | null;
      weight: number; active: boolean; discoveredBy: string[];
      description: string;
    }> = [];

    if (locationId) {
      for (const e of world.evidence.getAll(locationId)) {
        result.push({ ...e, discoveredBy: [...e.discoveredBy] });
      }
    } else {
      for (const [, evidenceList] of world.evidence.getAllEvidence()) {
        for (const e of evidenceList) {
          result.push({ ...e, discoveredBy: [...e.discoveredBy] });
        }
      }
    }
    return Response.json(result, { headers: cors });
  }

  // ─── GET /api/crime-scenes ───
  if (method === 'GET' && path === '/api/crime-scenes') {
    const allScenes: Array<{
      id: string; locationId: string; crimeType: string;
      pointCount: number; gameDay: number; active: boolean;
      perpetrator?: string; victim?: string;
    }> = [];
    for (const [, scenes] of world.crimeScenes) {
      for (const scene of scenes) {
        allScenes.push({
          id: scene.id,
          locationId: scene.locationId,
          crimeType: scene.crimeType,
          pointCount: scene.points.length,
          gameDay: scene.gameDay,
          active: scene.active,
          perpetrator: scene.perpetratorId ? agents.get(scene.perpetratorId)?.profile.name : undefined,
          victim: scene.victimId ? agents.get(scene.victimId)?.profile.name : undefined,
        });
      }
    }
    return Response.json(allScenes, { headers: cors });
  }

  // ─── GET /api/crime-scene/:locationId ───
  if (method === 'GET' && path.startsWith('/api/crime-scene/')) {
    const locationId = decodeURIComponent(path.slice('/api/crime-scene/'.length));
    const scenes = world.crimeScenes.get(locationId);
    if (!scenes || scenes.length === 0) {
      return Response.json({ error: 'No crime scene at this location' }, { status: 404, headers: cors });
    }
    const active = scenes.filter((s) => s.active);
    const scene = active.length > 0 ? active[active.length - 1] : scenes[scenes.length - 1];
    return Response.json({
      id: scene.id,
      locationId: scene.locationId,
      crimeType: scene.crimeType,
      gameDay: scene.gameDay,
      active: scene.active,
      points: scene.points,
      perpetrator: scene.perpetratorId ? agents.get(scene.perpetratorId)?.profile.name : undefined,
      victim: scene.victimId ? agents.get(scene.victimId)?.profile.name : undefined,
    }, { headers: cors });
  }

  // ─── POST /api/examine/:locationId/:pointId ───
  if (method === 'POST' && path.startsWith('/api/examine/')) {
    const parts = path.slice('/api/examine/'.length).split('/');
    if (parts.length < 2) {
      return Response.json({ error: 'Usage: /api/examine/:locationId/:pointId' }, { status: 400, headers: cors });
    }
    const locationId = decodeURIComponent(parts[0]);
    const pointId = parts[1];

    const scenes = world.crimeScenes.get(locationId);
    if (!scenes) {
      return Response.json({ error: 'No crime scene at this location' }, { status: 404, headers: cors });
    }

    for (const scene of scenes) {
      const point = scene.points.find((p) => p.id === pointId);
      if (point) {
        point.examined = true;

        const relatedNpcs: string[] = [];
        if (scene.victimId) relatedNpcs.push(scene.victimId);
        if (scene.perpetratorId) relatedNpcs.push(scene.perpetratorId);
        const journalEntry = world.journal.addClue(
          point.clueText,
          locationId,
          scene.gameDay,
          world.gameMinute,
          scene.id,
          relatedNpcs,
        );
        // Populate structured evidence fields from crime scene context
        // Note: point.type is display type ('bloodstain', 'body'), NOT evidence category.
        // evidenceCategory comes from EL evidence entries below, not from examination points.
        journalEntry.eventType = scene.eventType;
        journalEntry.suspectId = scene.perpetratorId;
        journalEntry.victimId = scene.victimId;
        broadcast({ type: 'journal:entry', data: journalEntry });

        // Also discover any undiscovered EL evidence at this location for player
        const discovered = world.evidence.getUndiscovered(locationId, 'player');
        const evidenceEntries = [];
        for (const e of discovered) {
          world.evidence.discover(e.id, 'player');
          const evEntry = world.journal.addClue(
            e.description,
            locationId,
            e.gameDay,
            world.gameMinute,
            undefined,
            [e.subjectId, e.objectId].filter(Boolean) as string[],
          );
          // Populate structured evidence fields from EL
          evEntry.evidenceCategory = e.category;
          evEntry.evidenceWeight = e.weight;
          evEntry.eventType = e.eventType;
          evEntry.suspectId = e.subjectId ?? undefined;
          evEntry.victimId = e.objectId ?? undefined;
          broadcast({ type: 'journal:entry', data: evEntry });
          evidenceEntries.push({ category: e.category, description: e.description, subjectName: e.subjectName });
        }

        return Response.json({
          clueText: point.clueText,
          type: point.type,
          description: point.description,
          journalEntryId: journalEntry.id,
          evidence: evidenceEntries,
        }, { headers: cors });
      }
    }
    return Response.json({ error: 'Examination point not found' }, { status: 404, headers: cors });
  }

  // ─── POST /api/npc-kill/:killerId/:victimId ───
  if (method === 'POST' && path.startsWith('/api/npc-kill/')) {
    const parts = path.split('/');
    const killerId = parts[3];
    const victimId = parts[4];
    return world.processKill(victimId, killerId).then(({ killEvent, results }) => {
      broadcast({ type: 'event', data: killEvent });
      return Response.json({
        killEvent,
        consequences: results.map((r) => ({
          ruleId: r.rule.id,
          targets: r.targets.map((id: string) => ({
            id,
            name: agents.get(id)?.profile.name ?? id,
          })),
          importance: r.rule.consequence.importance,
        })),
        eventCount: eventStore.count,
      }, { headers: cors });
    }).catch((err: Error) =>
      Response.json({ error: err.message }, { status: 400, headers: cors }),
    );
  }

  // ─── POST /api/kill/:id ───
  if (method === 'POST' && path.startsWith('/api/kill/')) {
    const victimId = path.split('/').pop()!;
    return world.processKill(victimId).then(({ killEvent, results }) => {
      broadcast({ type: 'event', data: killEvent });
      return Response.json({
        killEvent,
        consequences: results.map((r) => ({
          ruleId: r.rule.id,
          targets: r.targets.map((id: string) => ({
            id,
            name: agents.get(id)?.profile.name ?? id,
          })),
          importance: r.rule.consequence.importance,
        })),
        eventCount: eventStore.count,
      }, { headers: cors });
    }).catch((err: Error) =>
      Response.json({ error: err.message }, { status: 400, headers: cors }),
    );
  }

  // ─── POST /api/observe ───
  if (method === 'POST' && path === '/api/observe') {
    return req.json().then(async (body: { agentId: string; text: string; importance: number }) => {
      const agent = agents.get(body.agentId);
      if (!agent) {
        return Response.json({ error: 'Agent not found' }, { status: 404, headers: cors });
      }
      await agent.observe(body.text, body.importance);
      return Response.json({
        stored: true,
        reflection: agent.getReflectionStatus(),
      }, { headers: cors });
    });
  }

  // ─── POST /api/day ───
  if (method === 'POST' && path === '/api/day') {
    return world.advanceDay().then(({ newDay, rumorResults }) =>
      Response.json({
        newDay,
        rumors: rumorResults.map((r) => ({
          ruleId: r.rule.id,
          targets: r.targets.map((id: string) => ({
            id,
            name: agents.get(id)?.profile.name ?? id,
          })),
          location: r.event.location,
        })),
        eventCount: eventStore.count,
      }, { headers: cors }),
    );
  }

  // ─── POST /api/tick ───
  if (method === 'POST' && path === '/api/tick') {
    return world.tick().then((result) =>
      Response.json(result, { headers: cors }),
    ).catch((err: Error) =>
      Response.json({ error: err.message }, { status: 409, headers: cors }),
    );
  }

  // ─── GET /api/auto-state ───
  if (method === 'GET' && path === '/api/auto-state') {
    return Response.json({
      running: world.isAutoTicking,
      gameSpeed: world.gameSpeed,
      queueLength: world.processingQueue.length,
      queueProcessing: world.processingQueue.isProcessing,
    }, { headers: cors });
  }

  // ─── POST /api/auto ───
  if (method === 'POST' && path === '/api/auto') {
    if (world.isAutoTicking) {
      world.stopMasterClock();
      return Response.json({ running: false }, { headers: cors });
    }
    world.startMasterClock();
    return Response.json({ running: true, gameSpeed: world.gameSpeed }, { headers: cors });
  }

  // ─── POST /api/speed ───
  if (method === 'POST' && path === '/api/speed') {
    return req.json().then((body: { speed?: number }) => {
      const speed = body.speed ?? 1;
      world.setGameSpeed(speed);
      return Response.json({ gameSpeed: world.gameSpeed }, { headers: cors });
    });
  }

  // ─── POST /api/player/location ───
  if (method === 'POST' && path === '/api/player/location') {
    return req.json().then((body: { location?: string | null }) => {
      const player = world.playerAgent;
      if (player && body.location) {
        player.state.location = body.location;
      }
      return Response.json({ playerLocation: world.playerLocation }, { headers: cors });
    });
  }

  // ─── GET /api/player ───
  if (method === 'GET' && path === '/api/player') {
    const player = world.playerAgent;
    const pm = positionManager;
    const pos = pm?.getPosition('player');
    return Response.json({
      id: player?.profile.id,
      location: world.playerLocation,
      mood: player?.state.mood,
      alive: player?.state.alive,
      beliefs: player?.state.beliefs?.getAllBeliefs().length ?? 0,
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
    }, { headers: cors });
  }

  // ─── POST /api/save ───
  if (method === 'POST' && path === '/api/save') {
    if (options.onSave) {
      options.onSave();
      return Response.json({ saved: true }, { headers: cors });
    }
    return Response.json({ error: 'Save not configured' }, { status: 500, headers: cors });
  }

  // ─── GET /api/debug/mood/:id/:value ───
  const moodMatch = path.match(/^\/api\/debug\/mood\/([^/]+)\/([-\d.]+)$/);
  if (method === 'GET' && moodMatch) {
    const npcId = moodMatch[1];
    const agent = agents.get(npcId);
    if (!agent) return Response.json({ error: 'Agent not found' }, { status: 404, headers: cors });
    const oldMood = agent.state.mood;
    const targetMood = Math.max(-1, Math.min(1, parseFloat(moodMatch[2])));
    // Clear existing debug modifiers, add new one to reach target mood via modifier system
    world.removeModifiers(npcId, 'debug');
    const debugMag = targetMood - (agent.state.baseMood ?? 0);
    world.addModifier(npcId, { source: 'debug_set', category: 'debug',
      magnitude: debugMag, remaining: 0, duration: 0, decay: 'none' });
    return Response.json({ id: npcId, name: agent.profile.name, oldMood, targetMood, debugModifier: debugMag }, { headers: cors });
  }

  // ─── GET /api/debug/move/:id/:location ───
  const moveMatch = path.match(/^\/api\/debug\/move\/([^/]+)\/(.+)$/);
  if (method === 'GET' && moveMatch) {
    const agent = agents.get(moveMatch[1]);
    if (!agent) return Response.json({ error: 'Agent not found' }, { status: 404, headers: cors });
    const oldLocation = agent.state.location;
    agent.state.location = decodeURIComponent(moveMatch[2]);
    return Response.json({ id: moveMatch[1], name: agent.profile.name, oldLocation, newLocation: agent.state.location }, { headers: cors });
  }

  // ─── GET /api/debug/sentiment/:id/:targetId/:value ───
  const sentMatch = path.match(/^\/api\/debug\/sentiment\/([^/]+)\/([^/]+)\/([-\d.]+)$/);
  if (method === 'GET' && sentMatch) {
    const agent = agents.get(sentMatch[1]);
    if (!agent) return Response.json({ error: 'Agent not found' }, { status: 404, headers: cors });
    const value = Math.max(-1, Math.min(1, parseFloat(sentMatch[3])));
    agent.state.relationships?.adjustSentiment(sentMatch[2], value - (agent.state.relationships.getRelationship(sentMatch[2])?.sentiment ?? 0));
    return Response.json({ id: sentMatch[1], target: sentMatch[2], sentiment: value }, { headers: cors });
  }

  // ─── GET /api/debug/volition/:id ───
  const volMatch = path.match(/^\/api\/debug\/volition\/([^/]+)$/);
  if (method === 'GET' && volMatch) {
    const npcId = volMatch[1];
    const agent = agents.get(npcId);
    if (!agent) return Response.json({ error: 'Agent not found' }, { status: 404, headers: cors });

    const results = world.debugVolition(npcId);
    return Response.json({
      npcId, name: agent.profile.name,
      mood: agent.state.mood, location: agent.state.location,
      tick: world.gameMinute,
      affordances: results.filter((r) => r.passed),
      blocked: results.filter((r) => !r.passed).map((r) => r.id),
    }, { headers: cors });
  }

  // ─── GET /api/debug/belief/:id/:eventType/:subject/:confidence ───
  const beliefMatch = path.match(/^\/api\/debug\/belief\/([^/]+)\/([^/]+)\/([^/]+)\/([\d.]+)$/);
  if (method === 'GET' && beliefMatch) {
    const agent = agents.get(beliefMatch[1]);
    if (!agent) return Response.json({ error: 'Agent not found' }, { status: 404, headers: cors });
    const eventType = beliefMatch[2];
    const subjectRaw = decodeURIComponent(beliefMatch[3]);
    const subject = subjectRaw === 'null' ? null : subjectRaw;
    const confidence = Math.max(0, Math.min(1, parseFloat(beliefMatch[4])));
    const objectName = new URL(req.url).searchParams.get('object') ?? null;
    const source = new URL(req.url).searchParams.get('source') ?? 'rumor';
    agent.state.beliefs?.addBelief({
      eventType, subject, object: objectName, confidence,
      source, sourceNpcId: null, location: agent.state.location, gameDay: world.gameDay,
    });
    return Response.json({ id: beliefMatch[1], eventType, subject, object: objectName, confidence, source }, { headers: cors });
  }

  // ─── GET /api/debug/snapshot ───
  if (method === 'GET' && path === '/api/debug/snapshot') {
    const npcs = Array.from(agents.entries()).map(([id, agent]) => {
      const startMood = world.getStartingMood(id);
      const currentMood = agent.state.mood;
      const rels = agent.state.relationships?.getAllRelationships() ?? [];
      const goals = world.goalManager.getGoals(id);
      const beliefs = agent.state.beliefs?.getAllBeliefs() ?? [];

      // Top affordance from volition
      let topAffordance: { id: string; score: number } | null = null;
      try {
        const volition = world.debugVolition(id);
        const passed = volition.filter((r) => r.passed);
        if (passed.length > 0) {
          const best = passed.reduce((a, b) => (a.score ?? 0) > (b.score ?? 0) ? a : b);
          topAffordance = { id: best.id, score: best.score ?? 0 };
        }
      } catch {}

      // Derived mood thresholds
      const H = agent.profile.bigFive.honesty;
      const slidingEntry = -(0.30 - (1 - H) * 0.20); // negative mood where sliding zone starts
      const socialStressMod = (agent.state.moodModifiers ?? []).find(m => m.category === 'social_stress');

      return {
        id, name: agent.profile.name,
        mood: currentMood, baseMood: agent.state.baseMood, startMood,
        moodDelta: startMood != null ? currentMood - startMood : null,
        slidingEntry, // mood threshold where crime utility starts rising
        inSlidingZone: currentMood < slidingEntry,
        socialStress: socialStressMod ? +socialStressMod.magnitude.toFixed(4) : 0,
        modifiers: (agent.state.moodModifiers ?? []).map(m => ({
          source: m.source, category: m.category, magnitude: +m.magnitude.toFixed(4),
          remaining: m.remaining, duration: m.duration, decay: m.decay,
        })),
        location: agent.state.location, alive: agent.state.alive,
        status: agent.state.status ?? null,
        processingState: agent.state.processingState,
        personality: agent.profile.bigFive,
        enneagram: { type: agent.profile.enneagram.type, wing: agent.profile.enneagram.wing },
        relationships: rels.map((r) => ({ targetId: r.targetId, sentiment: r.sentiment, trust: r.trust })),
        goalCount: goals.length, beliefCount: beliefs.length,
        topAffordance,
      };
    });

    return Response.json({
      time: {
        gameMinute: world.gameMinute, minuteOfDay: world.minuteOfDay,
        hour: world.currentHour, period: world.currentPeriod, day: world.getCurrentDay(),
      },
      seed,
      npcs,
      events: {
        total: eventStore.getAll().length,
        dead: Array.from(agents.values()).filter((a) => !a.state.alive).map((a) => a.profile.name),
        wanted: eventStore.getAll().filter((e) => e.type === 'WANTED_STATUS').map((e) => e.subject),
      },
      queue: { length: world.processingQueue.length, processing: world.processingQueue.isProcessing },
    }, { headers: cors });
  }

  // ─── GET /api/debug/mood-history/:id ───
  const moodHistMatch = path.match(/^\/api\/debug\/mood-history\/([^/]+)$/);
  if (method === 'GET' && moodHistMatch) {
    const npcId = moodHistMatch[1];
    const agent = agents.get(npcId);
    if (!agent) return Response.json({ error: 'Agent not found' }, { status: 404, headers: cors });

    const last = parseInt(url.searchParams.get('last') ?? '0') || undefined;
    const history = world.getMoodHistory(npcId, last);

    return Response.json({
      npcId, name: agent.profile.name,
      startMood: world.getStartingMood(npcId),
      currentMood: agent.state.mood,
      entries: history.length,
      history,
    }, { headers: cors });
  }

  // ═══════════════════════════════════════════════════════════════
  // ─── Dev Tools (SPEC-dev-tools) ───
  // ═══════════════════════════════════════════════════════════════

  // ─── POST /api/debug/save/:name ───
  const saveMatch = path.match(/^\/api\/debug\/save\/([a-zA-Z0-9_-]+)$/);
  if (method === 'POST' && saveMatch) {
    const name = saveMatch[1];
    const { mkdirSync, writeFileSync } = await import('fs');
    const savePath = `data/saves/${name}.json`;
    mkdirSync('data/saves', { recursive: true });
    const json = JSON.stringify(world.toJSON(), null, 2);
    writeFileSync(savePath, json);
    return Response.json({ ok: true, action: 'save', name, gameMinute: world.gameMinute,
      day: world.getCurrentDay(), agents: agents.size, size: `${(json.length / 1024).toFixed(0)}KB` }, { headers: cors });
  }

  // ─── POST /api/debug/load/:name ───
  const loadMatch = path.match(/^\/api\/debug\/load\/([a-zA-Z0-9_-]+)$/);
  if (method === 'POST' && loadMatch) {
    const name = loadMatch[1];
    const { readFileSync, existsSync } = await import('fs');
    const savePath = `data/saves/${name}.json`;
    if (!existsSync(savePath)) return Response.json({ error: `Save '${name}' not found` }, { status: 404, headers: cors });
    try {
      world.stopMasterClock();
      const data = JSON.parse(readFileSync(savePath, 'utf-8'));
      world.loadState(data);
      // Reset transient state
      for (const [, agent] of agents) {
        agent.state.processingState = 'idle';
        agent.state.inTransit = false;
        agent.state.inPlayerChat = false;
      }
      world.startMasterClock();
      return Response.json({ ok: true, action: 'load', name, gameMinute: world.gameMinute }, { headers: cors });
    } catch (err) {
      world.startMasterClock();
      return Response.json({ error: `Load failed: ${err instanceof Error ? err.message : err}` }, { status: 500, headers: cors });
    }
  }

  // ─── GET /api/debug/saves ───
  if (method === 'GET' && path === '/api/debug/saves') {
    const { readdirSync, statSync, readFileSync } = await import('fs');
    const { existsSync } = await import('fs');
    const dir = 'data/saves';
    if (!existsSync(dir)) return Response.json({ saves: [] }, { headers: cors });
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    const saves = files.map(f => {
      const st = statSync(`${dir}/${f}`);
      let gameMinute = 0, day = 1;
      try { const d = JSON.parse(readFileSync(`${dir}/${f}`, 'utf-8')); gameMinute = d.gameMinute ?? 0; day = d.currentDay ?? 1; } catch {}
      return { name: f.replace('.json', ''), gameMinute, day, size: `${(st.size / 1024).toFixed(0)}KB`, created: st.mtime.toISOString() };
    });
    return Response.json({ saves }, { headers: cors });
  }

  // ─── DELETE /api/debug/save/:name ───
  const delSaveMatch = path.match(/^\/api\/debug\/save\/([a-zA-Z0-9_-]+)$/);
  if (method === 'DELETE' && delSaveMatch) {
    const { unlinkSync, existsSync } = await import('fs');
    const savePath = `data/saves/${delSaveMatch[1]}.json`;
    if (!existsSync(savePath)) return Response.json({ error: 'Save not found' }, { status: 404, headers: cors });
    unlinkSync(savePath);
    return Response.json({ ok: true, action: 'delete', name: delSaveMatch[1] }, { headers: cors });
  }

  // ─── POST /api/debug/event ───
  if (method === 'POST' && path === '/api/debug/event') {
    const body = await req.json() as { type: string; subject: string; object?: string; location: string; importance?: number; payload?: Record<string, unknown> };
    if (!body.type || !body.subject || !body.location) {
      return Response.json({ error: 'Required: type, subject, location' }, { status: 400, headers: cors });
    }
    const event = {
      id: crypto.randomUUID(),
      type: body.type,
      subject: body.subject,
      object: body.object,
      location: body.location,
      gameDay: world.getCurrentDay(),
      importance: body.importance ?? 6,
      payload: body.payload ?? {},
    };
    const result = await world.injectEvent(event);
    return Response.json({ ok: true, action: 'event', ...result }, { headers: cors });
  }

  // ─── POST /api/debug/status/:id ───
  const statusMatch = path.match(/^\/api\/debug\/status\/([^/]+)$/);
  if (method === 'POST' && statusMatch) {
    const agent = agents.get(statusMatch[1]);
    if (!agent) return Response.json({ error: 'Agent not found' }, { status: 404, headers: cors });
    const body = await req.json() as { status: string | null; releaseDays?: number };
    const oldStatus = agent.state.status;
    agent.state.status = (body.status === 'free' || body.status === null) ? undefined : body.status;
    // Note: imprisonment timer not set here — use force-affordance with sentence_npc for full flow
    return Response.json({ ok: true, action: 'status', npcId: statusMatch[1], oldStatus: oldStatus ?? 'free', newStatus: body.status ?? 'free' }, { headers: cors });
  }

  // ─── POST /api/debug/force-affordance/:npcId ───
  const forceMatch = path.match(/^\/api\/debug\/force-affordance\/([^/]+)$/);
  if (method === 'POST' && forceMatch) {
    const npcId = forceMatch[1];
    if (!agents.has(npcId)) return Response.json({ error: 'Agent not found' }, { status: 404, headers: cors });
    const body = await req.json() as { affordanceId: string; targetId: string; priority?: number };
    if (!body.affordanceId || !body.targetId) return Response.json({ error: 'Required: affordanceId, targetId' }, { status: 400, headers: cors });

    const { forceGoalFromAffordance } = await import('@clwa/engine');
    const goal = forceGoalFromAffordance(npcId, body.affordanceId, body.targetId, world.buildAffordanceContext(), body.priority ?? 10);
    if (!goal) return Response.json({ error: `Affordance '${body.affordanceId}' not found or invalid` }, { status: 404, headers: cors });
    world.goalManager.addGoal(goal);
    return Response.json({ ok: true, action: 'force-affordance', npcId, affordanceId: body.affordanceId,
      targetId: body.targetId, goal: { type: goal.type, steps: goal.steps.map((s: Record<string, string>) => s.action + (s.targetId ? ':' + s.targetId : s.location ? ':' + s.location : '')), priority: goal.priority }
    }, { headers: cors });
  }

  // ─── POST /api/debug/advance-mood ───
  if (method === 'POST' && path === '/api/debug/advance-mood') {
    const body = await req.json() as { minutes: number; npcId?: string };
    if (!body.minutes || body.minutes < 5) return Response.json({ error: 'Required: minutes >= 5' }, { status: 400, headers: cors });
    const results = world.advanceMoodMath(body.minutes, body.npcId);
    return Response.json({ ok: true, action: 'advance-mood',
      warning: 'Mood math only. No LLM, conversations, or events processed. Use for calibration, not behavior testing.',
      minutes: body.minutes, ticks: Math.floor(body.minutes / 5), results,
    }, { headers: cors });
  }

  // ─── POST /api/debug/tick ───
  if (method === 'POST' && path === '/api/debug/tick') {
    const body = await req.json().catch(() => ({})) as { count?: number };
    const count = body.count ?? 1;
    const wasRunning = world.isAutoTicking;
    if (wasRunning) world.stopMasterClock();
    const startTick = world.gameMinute;
    for (let i = 0; i < count; i++) {
      await world.tick();
    }
    if (wasRunning) world.startMasterClock();
    return Response.json({ ok: true, action: 'tick', count, from: startTick, to: world.gameMinute }, { headers: cors });
  }

  // ─── 404 ───
  return Response.json({ error: 'Not found' }, { status: 404, headers: cors });
}
