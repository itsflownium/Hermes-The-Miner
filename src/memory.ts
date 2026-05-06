import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type {
  ActiveGoal,
  HermesMemoryState,
  MemoryEvent,
  PlayerMemory,
  Position,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_PATH = join(__dirname, '../data/hermes-memory.json');
const MAX_EVENTS = 80;
const MAX_NOTES = 40;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function createEmptyState(): HermesMemoryState {
  return {
    botName: 'Hermes',
    activeGoal: null,
    players: {},
    notes: [],
    events: [],
    updatedAt: Date.now(),
  };
}

export class HermesMemory {
  private state: HermesMemoryState;

  constructor() {
    this.state = this.load();
  }

  getState(): HermesMemoryState {
    return clone(this.state);
  }

  getActiveGoal(): ActiveGoal | null {
    return this.state.activeGoal ? clone(this.state.activeGoal) : null;
  }

  setActiveGoal(goal: Omit<ActiveGoal, 'id' | 'status' | 'createdAt' | 'updatedAt'>): ActiveGoal {
    const now = Date.now();
    const nextGoal: ActiveGoal = {
      ...goal,
      id: `goal-${now}`,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    this.state.activeGoal = nextGoal;
    this.addEvent('goal', `Goal set: ${goal.summary}`);
    this.persist();
    return clone(nextGoal);
  }

  updateGoal(patch: Partial<Omit<ActiveGoal, 'id' | 'createdAt'>>): ActiveGoal | null {
    if (!this.state.activeGoal) return null;
    this.state.activeGoal = {
      ...this.state.activeGoal,
      ...patch,
      updatedAt: Date.now(),
    };
    this.persist();
    return clone(this.state.activeGoal);
  }

  clearGoal(summary = 'Goal cleared', status: ActiveGoal['status'] = 'cancelled'): void {
    if (!this.state.activeGoal) return;
    const goal = this.state.activeGoal;
    this.addEvent('goal', `${summary}: ${goal.summary}`);
    goal.status = status;
    goal.updatedAt = Date.now();
    this.state.activeGoal = null;
    this.persist();
  }

  completeGoal(summary?: string): void {
    if (!this.state.activeGoal) return;
    const goal = this.state.activeGoal;
    goal.status = 'completed';
    goal.updatedAt = Date.now();
    this.addEvent('goal', summary ?? `Completed goal: ${goal.summary}`);
    this.state.activeGoal = null;
    this.persist();
  }

  failGoal(summary: string): void {
    if (!this.state.activeGoal) return;
    const goal = this.state.activeGoal;
    goal.status = 'failed';
    goal.updatedAt = Date.now();
    this.addEvent('goal', `${summary}: ${goal.summary}`);
    this.state.activeGoal = null;
    this.persist();
  }

  rememberPlayerSeen(username: string, position?: Position): PlayerMemory {
    const key = username.toLowerCase();
    const now = Date.now();
    const existing = this.state.players[key];
    const next: PlayerMemory = existing
      ? {
          ...existing,
          username,
          lastSeenAt: now,
          lastSeenPosition: position ?? existing.lastSeenPosition,
        }
      : {
          username,
          firstSeenAt: now,
          lastSeenAt: now,
          lastSeenPosition: position,
          interactions: 0,
          notes: [],
        };
    this.state.players[key] = next;
    this.persist();
    return clone(next);
  }

  rememberChat(username: string, message: string): PlayerMemory {
    const key = username.toLowerCase();
    const current = this.rememberPlayerSeen(username);
    const next: PlayerMemory = {
      ...current,
      interactions: current.interactions + 1,
      lastMessage: message,
    };
    this.state.players[key] = next;
    this.persist();
    return clone(next);
  }

  rememberRequest(username: string, request: string): PlayerMemory {
    const key = username.toLowerCase();
    const current = this.rememberPlayerSeen(username);
    const next: PlayerMemory = {
      ...current,
      interactions: current.interactions + 1,
      lastRequest: request,
    };
    this.state.players[key] = next;
    this.persist();
    return clone(next);
  }

  addPlayerNote(username: string, note: string): void {
    const key = username.toLowerCase();
    const current = this.rememberPlayerSeen(username);
    const dedupedNotes = [note, ...current.notes.filter(existing => existing !== note)].slice(0, 6);
    this.state.players[key] = {
      ...current,
      notes: dedupedNotes,
    };
    this.addEvent('player-note', `Remembered about ${username}: ${note}`);
    this.persist();
  }

  addNote(note: string): void {
    this.state.notes = [note, ...this.state.notes.filter(existing => existing !== note)].slice(0, MAX_NOTES);
    this.addEvent('note', note);
    this.persist();
  }

  addEvent(type: string, summary: string): MemoryEvent {
    const event: MemoryEvent = {
      timestamp: Date.now(),
      type,
      summary,
    };
    this.state.events = [event, ...this.state.events].slice(0, MAX_EVENTS);
    this.persist();
    return clone(event);
  }

  getPromptContext(): string {
    const goal = this.state.activeGoal
      ? `Active goal: ${this.state.activeGoal.summary} (${this.state.activeGoal.kind})`
      : 'Active goal: none';

    const players = Object.values(this.state.players)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, 5)
      .map((player) => {
        const notes = player.notes.slice(0, 2).join('; ');
        const request = player.lastRequest ? ` last request: ${player.lastRequest}.` : '';
        return `${player.username} seen recently, interactions ${player.interactions}.${request}${notes ? ` Notes: ${notes}.` : ''}`;
      })
      .join(' ');

    const notes = this.state.notes.slice(0, 5).join(' | ') || 'none';
    const events = this.state.events
      .slice(0, 6)
      .map(event => `${event.type}: ${event.summary}`)
      .join(' | ') || 'none';

    return [
      goal,
      `Known players: ${players || 'none'}`,
      `Long-term notes: ${notes}`,
      `Recent events: ${events}`,
    ].join('\n');
  }

  getKnownPlayers(): string[] {
    return Object.values(this.state.players)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map(player => player.username);
  }

  private load(): HermesMemoryState {
    try {
      if (!existsSync(MEMORY_PATH)) {
        this.ensureDir();
        const empty = createEmptyState();
        writeFileSync(MEMORY_PATH, JSON.stringify(empty, null, 2), 'utf-8');
        return empty;
      }
      const raw = readFileSync(MEMORY_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<HermesMemoryState>;
      return {
        ...createEmptyState(),
        ...parsed,
        players: parsed.players ?? {},
        notes: parsed.notes ?? [],
        events: parsed.events ?? [],
      };
    } catch {
      return createEmptyState();
    }
  }

  private persist(): void {
    this.state.updatedAt = Date.now();
    this.ensureDir();
    writeFileSync(MEMORY_PATH, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  private ensureDir(): void {
    mkdirSync(dirname(MEMORY_PATH), { recursive: true });
  }
}
