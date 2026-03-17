import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ServerWebSocket } from 'bun';
import type { Agent } from '@clwa/engine';
import type { World } from '@clwa/engine';
import type { IEventStore } from '@clwa/engine';
import { buildSecretDirectives, extractDialogueMeaning, applyDialogueMeaning, getAllRegisteredEventTypes, createGoalFromRequest } from '@clwa/engine';
import type { ILContext, ILEffectContext } from '@clwa/engine';
import { handleRequest } from './routes';
import type { RouteOptions } from './routes';
import { addClient, removeClient, broadcast, sendTo, clientCount } from './ws';
import type { WSClientMessage } from './ws';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');

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
        let chatAgentId: string | null = null; // track for finally cleanup
        try {
          const msg: WSClientMessage = JSON.parse(
            typeof raw === 'string' ? raw : raw.toString(),
          );

          if (msg.type === 'chat') {
            chatAgentId = msg.agentId;
            const agent = agents.get(msg.agentId);
            if (!agent) {
              sendTo(ws, { type: 'chat:done', data: { agentId: msg.agentId, fullReply: '[Agent not found]' } });
              return;
            }
            if (!agent.state.alive) {
              sendTo(ws, { type: 'chat:done', data: { agentId: msg.agentId, fullReply: `[${agent.profile.name} is dead and cannot respond.]` } });
              return;
            }

            // Co-location validation — server is authoritative
            const playerAgent = world.playerAgent;
            if (playerAgent && playerAgent.state.location !== agent.state.location) {
              sendTo(ws, { type: 'chat:done', data: { agentId: msg.agentId, fullReply: `[${agent.profile.name} is not here.]` } });
              return;
            }

            // Freeze NPC during conversation — tick skips movement/goals for this agent
            agent.state.inPlayerChat = true;

            // ── IL: Extract structured meaning from player speech ──
            const npcNames = Array.from(agents.values())
              .filter((a) => a.state.alive && !a.profile.isPlayer)
              .map((a) => `${a.profile.name} (${a.profile.role})`);
            const locationNames = Array.from(world.locations.values()).map((l) => l.name);

            const ilContext: ILContext = {
              npcNames,
              locationNames,
              knownEventTypes: getAllRegisteredEventTypes(),
              targetNpcName: agent.profile.name,
            };

            broadcast({ type: 'debug:llm', data: { reason: 'IL extract', target: agent.profile.name } });
            const meaning = await extractDialogueMeaning(msg.message, ilContext);
            console.log(`  [IL] ${meaning.speechAct}${meaning.claims ? ` claims:${meaning.claims.length}` : ''}${meaning.questions ? ` questions:${meaning.questions.length}` : ''}${meaning.requestedAction ? ` request:${meaning.requestedAction.action}` : ''} (conf:${meaning.extractionConfidence.toFixed(2)})`);

            // Apply IL effects to engine systems (beliefs, mood, relationships)
            let ilAdditionalContext = '';
            if (playerAgent) {
              const effectCtx: ILEffectContext = {
                targetAgent: agent,
                playerAgent,
                agents,
                eventStore,
                gameDay: agent.state.currentDay,
                goalCreator: (npcId, action, target) => {
                  const goal = createGoalFromRequest(npcId, action, world.buildAffordanceContext(), target);
                  if (goal) {
                    world.goalManager.addGoal(goal);
                    return true;
                  }
                  return false;
                },
              };
              ilAdditionalContext = applyDialogueMeaning(meaning, effectCtx);
            }

            // IL result → Godot WS event (includes trust + belief info for UI)
            const npcTrust = agent.state.relationships?.getRelationship(playerAgent?.profile.id ?? '')?.trust ?? 0;
            const claimsCreated = meaning.claims?.filter(c => c.eventType).length ?? 0;
            broadcast({ type: 'intent', data: {
              agentId: msg.agentId,
              intent: meaning.speechAct,
              targetNpc: meaning.claims?.[0]?.subject,
              detail: meaning.requestedAction?.action,
              trust: Math.round(npcTrust * 100),
              claimsCreated,
            } });

            if (meaning.speechAct === 'trade' && agent.profile.shop && agent.profile.shop.length > 0) {
              sendTo(ws, { type: 'shop:open', data: {
                agentId: msg.agentId,
                npcName: agent.profile.name,
                items: agent.profile.shop,
              } });
            }

            // Build NPC response with IL context + secret directives
            const secretDirectives = buildSecretDirectives(agent, agents, eventStore);
            const fullContext = [secretDirectives, ilAdditionalContext].filter(Boolean).join('\n\n') || undefined;

            broadcast({ type: 'debug:llm', data: { reason: 'Player chat', target: agent.profile.name } });
            const fullReply = await agent.chatStream(msg.message, (token) => {
              sendTo(ws, { type: 'chat:token', data: { agentId: msg.agentId, token } });
            }, fullContext);

            sendTo(ws, { type: 'chat:done', data: { agentId: msg.agentId, fullReply } });

            // Journal testimony for meaningful speech acts
            const TESTIMONY_ACTS = new Set(['inform', 'accuse', 'confide', 'question']);
            if (TESTIMONY_ACTS.has(meaning.speechAct) && fullReply) {
              const mentionedNpcs: string[] = [];
              const claimSubject = meaning.claims?.[0]?.subject;
              if (claimSubject) {
                for (const [id, a] of agents) {
                  if (a.profile.name.toLowerCase() === claimSubject.toLowerCase()) {
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
                `You were nearby and overheard a conversation between ${playerAgent!.profile.name} and ${agent.profile.name}. ${playerAgent!.profile.name} said: "${msg.message}". ${agent.profile.name} answered: "${fullReply}"`,
                3,
              );
            }
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`  [WS] Error: ${errMsg}`);
        } finally {
          // Always unfreeze NPC after chat completes (success or error)
          if (chatAgentId) {
            const chatAgent = agents.get(chatAgentId);
            if (chatAgent) chatAgent.state.inPlayerChat = false;
          }
        }
      },
    },
  });

  return server;
}
