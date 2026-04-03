import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ServerWebSocket } from 'bun';
import type { Agent } from '@clwa/engine';
import type { World } from '@clwa/engine';
import type { IEventStore } from '@clwa/engine';
import { buildSecretDirectives, extractDialogueMeaning, applyDialogueMeaning, getAllRegisteredEventTypes, getAllRegisteredVerbs, createGoalFromRequest } from '@clwa/engine';
import type { ILContext, ILEffectContext, PresentedEvidence, ConversationSession } from '@clwa/engine';
import { handleRequest } from './routes';
import { addClient, removeClient, broadcast, sendTo, clientCount } from './ws';
import type { WSClientMessage } from './ws';
import type { GameContext } from './game-context';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Per-chat transient sessions — tracks accusation repetition, multiple suspects */
const chatSessions = new Map<string, ConversationSession>();

export interface ServerConfig {
  port: number;
  hostname?: string;
}

export function startServer(
  ctx: GameContext,
  config: ServerConfig,
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
        return handleRequest(req, ctx);
      }

      const filePath = url.pathname === '/' ? '/index.html' : url.pathname;
      const fullPath = resolve(PUBLIC_DIR, '.' + filePath);
      const file = Bun.file(fullPath);
      if (await file.exists()) {
        return new Response(file);
      }

      // Serve game assets from godot/assets/
      if (url.pathname.startsWith('/assets/')) {
        const assetPath = resolve(PUBLIC_DIR, '..', '..', '..', 'godot', decodeURIComponent(url.pathname.slice(1)));
        const assetFile = Bun.file(assetPath);
        if (await assetFile.exists()) {
          return new Response(assetFile);
        }
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
        if (ctx.resetting) return; // drop messages during reset
        let chatAgentId: string | null = null; // track for finally cleanup
        try {
          const { world, agents, eventStore, positionManager, approachContexts } = ctx;
          const msg: WSClientMessage = JSON.parse(
            typeof raw === 'string' ? raw : raw.toString(),
          );

          if (msg.type === 'player_move') {
            const pm = positionManager;
            if (pm && world.playerAgent) {
              // Validate and update player position
              if (pm.validatePosition(msg.x, msg.y)) {
                pm.setPosition('player', msg.x, msg.y);
                // Update player location slug from zone detection
                const locSlug = pm.getLocationAtPoint(msg.x, msg.y);
                if (locSlug && world.playerAgent.state.location !== locSlug) {
                  world.playerAgent.state.location = locSlug;
                }
                // Broadcast to other clients
                broadcast({ type: 'player_position', data: { x: msg.x, y: msg.y } });
              }
            }
            return;
          }

          if (msg.type === 'chat_close') {
            chatSessions.delete(msg.agentId);
            return;
          }

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

            // Create or reuse per-chat session
            if (!chatSessions.has(msg.agentId)) {
              chatSessions.set(msg.agentId, {
                npcId: msg.agentId,
                startedAt: world.gameMinute,
                messageCount: 0,
                accusationHistory: new Map(),
                formalAccusations: [],
              });
            }
            const chatSession = chatSessions.get(msg.agentId)!;
            chatSession.messageCount++;

            // ── IL: Extract structured meaning from player speech ──
            const npcNames = Array.from(agents.values())
              .filter((a) => a.state.alive && !a.profile.isPlayer)
              .map((a) => `${a.profile.name} (${a.profile.role})`);
            const locationNames = Array.from(world.locations.values()).map((l) => l.name);
            const locationNameToSlug = new Map<string, string>();
            for (const [slug, loc] of world.locations) {
              locationNameToSlug.set(loc.name, slug);
            }

            const ilContext: ILContext = {
              npcNames,
              locationNames,
              locationNameToSlug,
              knownEventTypes: getAllRegisteredEventTypes(),
              availableActions: getAllRegisteredVerbs(),
              targetNpcName: agent.profile.name,
            };

            broadcast({ type: 'debug:llm', data: { reason: 'IL extract', target: agent.profile.name } });
            const meaning = await extractDialogueMeaning(msg.message, ilContext);
            const ilFallback = (meaning as any)._fallback as string | undefined;
            if (ilFallback) {
              console.warn(`  [IL] FALLBACK: ${ilFallback} — player message not processed`);
            }
            console.log(`  [IL] ${meaning.speechAct}${meaning.claims ? ` claims:${meaning.claims.length}` : ''}${meaning.questions ? ` questions:${meaning.questions.length}` : ''}${meaning.requestedAction ? ` request:${meaning.requestedAction.action}` : ''} (conf:${meaning.extractionConfidence.toFixed(2)})`);

            // Validate and resolve evidence entries attached to this message
            let presentedEvidence: PresentedEvidence[] | undefined;
            if (msg.evidenceIds && Array.isArray(msg.evidenceIds) && msg.evidenceIds.length > 0) {
              presentedEvidence = [];
              for (const entryId of msg.evidenceIds.slice(0, 5)) { // max 5 per message
                if (!world.journal.canPresent(entryId, msg.agentId)) continue;
                const entry = world.journal.getEntry(entryId);
                if (!entry) continue;
                const suspectName = entry.suspectId ? agents.get(entry.suspectId)?.profile.name : undefined;
                presentedEvidence.push({
                  entryId: entry.id,
                  text: entry.text,
                  evidenceCategory: entry.evidenceCategory,
                  evidenceWeight: entry.evidenceWeight,
                  eventType: entry.eventType,
                  suspectId: entry.suspectId,
                  suspectName,
                  victimId: entry.victimId,
                });
                world.journal.markPresented(entryId, msg.agentId);
              }
              if (presentedEvidence.length > 0) {
                console.log(`  [Evidence] ${presentedEvidence.length} entries presented to ${agent.profile.name}`);
              } else {
                presentedEvidence = undefined;
              }
            }

            // Apply IL effects to engine systems (beliefs, mood, relationships)
            let ilAdditionalContext = '';
            const ilEffects: import('@clwa/engine').ILEffect[] = [];
            if (ilFallback) {
              ilEffects.push({ type: 'event_stored', eventType: 'IL_FALLBACK', action: ilFallback });
            }
            if (playerAgent) {
              const effectCtx: ILEffectContext = {
                targetAgent: agent,
                playerAgent,
                agents,
                eventStore,
                gameDay: agent.state.currentDay,
                effects: ilEffects,
                ilConfig: world.resolvedILConfig,
                presentedEvidence,
                playerJournal: world.journal,
                chatSession,
                goalCreator: (npcId, action, target) => {
                  const goal = createGoalFromRequest(npcId, action, world.buildAffordanceContext(), target);
                  if (goal) {
                    world.goalManager.addGoal(goal);
                    return true;
                  }
                  return false;
                },
              };
              ilAdditionalContext = await applyDialogueMeaning(meaning, effectCtx);
            }

            // IL result → WS event with full structured effects for client
            const npcTrust = agent.state.relationships?.getRelationship(playerAgent?.profile.id ?? '')?.trust ?? 0;
            broadcast({ type: 'il_result', data: {
              agentId: msg.agentId,
              agentName: agent.profile.name,
              speechAct: meaning.speechAct,
              extractionConfidence: +meaning.extractionConfidence.toFixed(2),
              trust: +npcTrust.toFixed(2),
              effects: ilEffects,
            } });

            if (meaning.speechAct === 'trade' && agent.profile.shop && agent.profile.shop.length > 0) {
              sendTo(ws, { type: 'shop:open', data: {
                agentId: msg.agentId,
                npcName: agent.profile.name,
                items: agent.profile.shop,
              } });
            }

            // Build NPC response with IL context + secret directives + approach context + shop
            const secretDirectives = buildSecretDirectives(agent, agents, eventStore);
            const approachCtx = approachContexts.get(msg.agentId);
            if (approachCtx) approachContexts.delete(msg.agentId); // consume once
            // Inject shop inventory when trade detected — prevents hallucinated items
            const fullContext = [secretDirectives, approachCtx, ilAdditionalContext].filter(Boolean).join('\n\n') || undefined;

            // For trade: wrap user message with shop inventory so model sees items in user prompt
            // (system prompt "lost middle" causes 9B to ignore shop context there)
            let effectiveMessage = msg.message;
            if (meaning.speechAct === 'trade' && agent.profile.shop?.length) {
              const items = agent.profile.shop.map((i: any) => `- ${i.name}: ${i.price} gold. ${i.description}`).join('\n');
              effectiveMessage = `${msg.message}\n\n[SHOP INVENTORY — mention these items by name and price, do NOT invent others:\n${items}]`;
              console.log(`  [Shop] Injecting ${agent.profile.shop.length} items into user message for ${agent.profile.name}`);
            }

            broadcast({ type: 'debug:llm', data: { reason: 'Player chat', target: agent.profile.name } });
            const fullReply = await agent.chatStream(effectiveMessage, (token) => {
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
                world.gameMinute,
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
              // Structured memory — no raw dialogue (prevents self-reference cascade)
              const actLabel = meaning.speechAct ?? 'conversation';
              await otherAgent.observe(
                `Overheard ${playerAgent!.profile.name} and ${agent.profile.name} talking nearby (${actLabel}).`,
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
