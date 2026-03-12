import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ServerWebSocket } from 'bun';
import type { Agent } from '@clwa/engine';
import type { World } from '@clwa/engine';
import type { IEventStore } from '@clwa/engine';
import { classifyIntent, buildSecretDirectives } from '@clwa/engine';
import type { IntentResult } from '@clwa/engine';
import { handleRequest } from './routes';
import type { RouteOptions } from './routes';
import { addClient, removeClient, broadcast, sendTo, clientCount } from './ws';
import type { WSClientMessage } from './ws';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Apply mechanical effects based on classified player intent */
function applyIntentEffects(
  intent: IntentResult,
  targetAgent: Agent,
  agents: Map<string, Agent>,
  eventStore: IEventStore,
  world: World,
): void {
  const playerSubject = 'player';
  const gameDay = targetAgent.state.currentDay;
  const location = targetAgent.state.location;

  switch (intent.intent) {
    case 'threaten':
      targetAgent.state.mood = Math.max(-1, targetAgent.state.mood - 0.15);
      eventStore.append({
        id: crypto.randomUUID(),
        type: 'PLAYER_ACTION',
        subject: playerSubject,
        object: targetAgent.profile.id,
        location,
        gameDay,
        importance: 5,
        payload: { action: 'threaten', detail: intent.detail },
      });
      targetAgent.observe(
        `A traveling stranger threatened me. ${intent.detail ?? ''}`,
        5,
      );
      break;

    case 'insult':
      targetAgent.state.mood = Math.max(-1, targetAgent.state.mood - 0.08);
      targetAgent.observe(
        `A traveling stranger insulted me. ${intent.detail ?? ''}`,
        3,
      );
      break;

    case 'compliment':
      targetAgent.state.mood = Math.min(1, targetAgent.state.mood + 0.08);
      targetAgent.observe(
        `A traveling stranger said something kind to me. ${intent.detail ?? ''}`,
        2,
      );
      break;

    case 'accuse': {
      eventStore.append({
        id: crypto.randomUUID(),
        type: 'PLAYER_ACTION',
        subject: playerSubject,
        object: targetAgent.profile.id,
        location,
        gameDay,
        importance: 7,
        payload: { action: 'accuse', accusedNpc: intent.targetNpc, detail: intent.detail },
      });
      const accusationText = intent.targetNpc
        ? `A traveling stranger accused ${intent.targetNpc} of wrongdoing in front of me. ${intent.detail ?? ''}`
        : `A traveling stranger made an accusation to me. ${intent.detail ?? ''}`;
      targetAgent.observe(accusationText, 6);
      break;
    }

    case 'bribe':
      eventStore.append({
        id: crypto.randomUUID(),
        type: 'PLAYER_ACTION',
        subject: playerSubject,
        object: targetAgent.profile.id,
        location,
        gameDay,
        importance: 5,
        payload: { action: 'bribe', detail: intent.detail },
      });
      targetAgent.observe(
        `A traveling stranger tried to bribe me. ${intent.detail ?? ''}`,
        5,
      );
      break;

    case 'confide':
      targetAgent.observe(
        `A traveling stranger confided something personal to me. ${intent.detail ?? ''}`,
        4,
      );
      break;

    case 'trade':
      break;

    default:
      break;
  }
}

export interface ServerConfig {
  port: number;
  hostname?: string;
}

export function startServer(
  world: World,
  eventStore: IEventStore,
  agents: Map<string, Agent>,
  config: ServerConfig,
  routeOptions?: RouteOptions,
) {
  const server = Bun.serve({
    port: config.port,
    hostname: config.hostname ?? '0.0.0.0',
    idleTimeout: 120,

    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === '/ws') {
        const upgraded = server.upgrade(req);
        if (!upgraded) {
          return new Response('WebSocket upgrade failed', { status: 400 });
        }
        return undefined as any;
      }

      if (url.pathname.startsWith('/api/')) {
        return handleRequest(req, world, eventStore, agents, routeOptions);
      }

      const filePath = url.pathname === '/' ? '/index.html' : url.pathname;
      const fullPath = resolve(PUBLIC_DIR, '.' + filePath);
      const file = Bun.file(fullPath);
      if (await file.exists()) {
        return new Response(file);
      }

      return new Response('Not found', { status: 404 });
    },

    websocket: {
      open(ws: ServerWebSocket<unknown>) {
        addClient(ws);
        console.log(`  [WS] Client connected (${clientCount()} total)`);
      },

      close(ws: ServerWebSocket<unknown>) {
        removeClient(ws);
        console.log(`  [WS] Client disconnected (${clientCount()} total)`);
      },

      async message(ws: ServerWebSocket<unknown>, raw: string | Buffer) {
        try {
          const msg: WSClientMessage = JSON.parse(
            typeof raw === 'string' ? raw : raw.toString(),
          );

          if (msg.type === 'chat') {
            const agent = agents.get(msg.agentId);
            if (!agent) {
              sendTo(ws, { type: 'chat:done', data: { agentId: msg.agentId, fullReply: '[Agent not found]' } });
              return;
            }
            if (!agent.state.alive) {
              sendTo(ws, { type: 'chat:done', data: { agentId: msg.agentId, fullReply: `[${agent.profile.name} is dead and cannot respond.]` } });
              return;
            }

            agent.state.playerPresent = true;

            const npcNames = Array.from(agents.values())
              .filter((a) => a.state.alive)
              .map((a) => a.profile.name);
            broadcast({ type: 'debug:llm', data: { reason: 'Intent classify', target: agent.profile.name } });
            const intent = await classifyIntent(msg.message, npcNames);
            console.log(`  [Intent] ${intent.intent}${intent.targetNpc ? ` → ${intent.targetNpc}` : ''}`);

            applyIntentEffects(intent, agent, agents, eventStore, world);

            broadcast({ type: 'intent', data: { agentId: msg.agentId, ...intent } });

            if (intent.intent === 'trade' && agent.profile.shop && agent.profile.shop.length > 0) {
              sendTo(ws, { type: 'shop:open', data: {
                agentId: msg.agentId,
                npcName: agent.profile.name,
                items: agent.profile.shop,
              } });
            }

            const secretDirectives = buildSecretDirectives(agent, agents, eventStore);

            broadcast({ type: 'debug:llm', data: { reason: 'Player chat', target: agent.profile.name } });
            const fullReply = await agent.chatStream(msg.message, (token) => {
              sendTo(ws, { type: 'chat:token', data: { agentId: msg.agentId, token } });
            }, secretDirectives || undefined);

            sendTo(ws, { type: 'chat:done', data: { agentId: msg.agentId, fullReply } });

            const TESTIMONY_INTENTS = new Set(['ask_about_npc', 'accuse', 'confide']);
            if (TESTIMONY_INTENTS.has(intent.intent) && fullReply) {
              const mentionedNpcs: string[] = [];
              if (intent.targetNpc) {
                for (const [id, a] of agents) {
                  if (a.profile.name.toLowerCase() === intent.targetNpc.toLowerCase()) {
                    mentionedNpcs.push(id);
                    break;
                  }
                }
              }
              const entry = world.journal.addTestimony(
                fullReply,
                agent.profile.name,
                msg.agentId,
                agent.state.location,
                agent.state.currentDay,
                world.currentTick,
                mentionedNpcs,
              );
              broadcast({ type: 'journal:entry', data: entry });
              console.log(`  [Journal] Testimony from ${agent.profile.name} recorded`);
            }

            const npcLocation = agent.state.location;
            for (const [otherId, otherAgent] of agents) {
              if (otherId === msg.agentId) continue;
              if (!otherAgent.state.alive) continue;
              if (otherAgent.state.location !== npcLocation) continue;
              if (Math.random() > 0.6) continue;
              otherAgent.observe(
                `You were nearby and overheard a conversation between a traveling stranger and ${agent.profile.name}. The stranger said: "${msg.message}". ${agent.profile.name} answered: "${fullReply}"`,
                3,
              );
            }
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`  [WS] Error: ${errMsg}`);
        }
      },
    },
  });

  return server;
}
