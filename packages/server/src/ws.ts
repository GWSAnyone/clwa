import type { ServerWebSocket } from 'bun';
import type { ConversationLine, ConversationResult, TickResult, MovementResult, GoalActionResult, CrimeScene, JournalEntry } from '@clwa/engine';
import type { WorldEvent } from '@clwa/engine';

/** Server-enriched movement broadcast: engine MovementResult + pixel data for the client renderer
 *  (position-authoritative waypoints + speed). Pixel fields live here (server), NOT on engine MovementResult. */
export type EnrichedMovement = MovementResult & {
  x?: number;
  y?: number;
  targetX?: number;
  targetY?: number;
  waypoints?: { x: number; y: number }[];
  speed?: number;
};

/** All WebSocket message types server can send */
export type WSMessage =
  | { type: 'conversation:line'; data: ConversationLine }
  | { type: 'conversation:complete'; data: ConversationResult & { approachPoints?: unknown } }
  | { type: 'tick'; data: TickResult }
  | { type: 'event'; data: WorldEvent }
  | { type: 'reflection'; data: { agentName: string; text: string } }
  | { type: 'chat:token'; data: { agentId: string; token: string } }
  | { type: 'chat:done'; data: { agentId: string; fullReply: string } }
  | { type: 'state:update'; data: { agentId: string; mood: number; alive: boolean; location: string } }
  | { type: 'movement'; data: EnrichedMovement[] }
  | { type: 'goal:action'; data: GoalActionResult }
  | { type: 'murder'; data: { killerId: string; victimId: string; killerName: string; affectedName: string } }
  | { type: 'intent'; data: { agentId: string; intent: string; targetNpc?: string; detail?: string } }
  | { type: 'shop:open'; data: { agentId: string; npcName: string; items: Array<{ id: string; name: string; price: number; description: string }> } }
  | { type: 'crime:scene'; data: { id: string; locationId: string; crimeType: string; pointCount: number } }
  | { type: 'journal:entry'; data: JournalEntry }
  | { type: 'debug:llm'; data: { reason: string; target?: string } }
  | { type: 'npc_approach'; data: unknown }
  | { type: 'npc_thought'; data: unknown }
  | { type: 'relationship_change'; data: unknown }
  | { type: 'event_cascade'; data: unknown }
  | { type: 'goal_update'; data: unknown }
  | { type: 'mood_update'; data: unknown }
  | { type: 'time_update'; data: unknown }
  | { type: 'new_game'; data: unknown }
  | { type: 'player_position'; data: unknown }
  | { type: 'il_result'; data: unknown };

/** Client → server messages */
export type WSClientMessage =
  | { type: 'chat'; agentId: string; message: string; evidenceIds?: string[] }
  | { type: 'chat_open'; agentId: string }
  | { type: 'chat_close'; agentId: string }
  | { type: 'player_move'; x: number; y: number };

/** Connected WebSocket clients */
const clients = new Set<ServerWebSocket<unknown>>();

export function addClient(ws: ServerWebSocket<unknown>): void {
  clients.add(ws);
}

export function removeClient(ws: ServerWebSocket<unknown>): void {
  clients.delete(ws);
}

/** Broadcast a message to all connected clients */
export function broadcast(message: WSMessage): void {
  const data = JSON.stringify(message);
  for (const client of clients) {
    try {
      client.send(data);
    } catch {
      clients.delete(client);
    }
  }
}

/** Send to a specific client */
export function sendTo(ws: ServerWebSocket<unknown>, message: WSMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    clients.delete(ws);
  }
}

export function clientCount(): number {
  return clients.size;
}
