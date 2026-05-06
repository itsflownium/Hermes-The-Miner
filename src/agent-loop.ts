import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Perception } from './perceive.js';
import { Actions } from './actions.js';
import { ModelReader } from './models.js';
import { HermesMemory } from './memory.js';
import type {
  ActiveGoal,
  AgentStatus,
  BehaviorMode,
  BridgeEvent,
  WorldSnapshot,
} from './types.js';

type EventHandler = (event: BridgeEvent) => void;

const SYSTEM_PROMPTS: Record<BehaviorMode, string> = {
  PASSIVE: `You are Hermes, a polite Minecraft companion. Stay fair, stay nearby, and only act when it is clearly useful or requested.`,
  HELPER: `You are Hermes, a helpful Minecraft companion. Play fairly, stay social, gather useful resources, and help nearby players without cheating.`,
  EXPLORER: `You are Hermes, an explorer. Wander carefully, report useful discoveries, and only chase resources that are actually exposed or nearby.`,
  BUILDER: `You are Hermes, a builder's assistant. Stay near the player, carry materials, help position yourself, and avoid destructive actions unless asked.`,
  DEFENDER: `You are Hermes, a guardian. Protect nearby players from hostile mobs while still playing fairly and preserving your own safety.`,
};

const ACTION_GUIDE = `Allowed actions:
- follow {"entityName": string}
- moveTo {"x": number, "y": number, "z": number}
- collectResource {"resourceName": string, "targetCount": number}
- mineBlock {"blockName": string}
- dig {"x": number, "y": number, "z": number}
- placeBlock {"x": number, "y": number, "z": number}
- placeCraftingTable {}
- attack {"entityName": string}
- defend {"range": number}
- stop {}
- jump {}
- sneak {"toggle": true|false}
- equip {"itemName": string, "slot": string}
- say {"message": string}
- giveAll {"itemName": string, "playerName": string}
- countItem {"itemName": string}
- getInventory {}
- craft {"recipeName": string, "count": number}
- eat {"foodName": string}
- explore {}
- findResource {"resourceName": string}
- listNearby {}

Reply with exactly one line:
ACTION: <action_name> <json>`;

export class AgentLoop {
  private perception: Perception;
  private actions: Actions;
  private modelReader: ModelReader;
  private memory: HermesMemory;
  private emit: EventHandler;
  private running = false;
  private interval?: ReturnType<typeof setInterval>;
  private tickInProgress = false;
  private iterations = 0;
  private lastAction = 'idle';
  private behaviorMode: BehaviorMode = 'HELPER';
  private lastChatTime = 0;
  private lastCommandTime = 0;
  private lastPlanTime = 0;
  private lastPlan: string | null = null;
  private lastDirectReply: { username: string; message: string; at: number } | null = null;
  private conversationFocus: { username: string; at: number } | null = null;
  private idleUntil = 0;
  private goalFailures = new Map<string, number>();
  private latestCommandSequence = 0;
  private runningAction: { type: string; at: number } | null = null;
  private lastDuplicateActionReplyAt = 0;

  constructor(
    perception: Perception,
    actions: Actions,
    modelReader: ModelReader,
    memory: HermesMemory,
    emit: EventHandler,
  ) {
    this.perception = perception;
    this.actions = actions;
    this.modelReader = modelReader;
    this.memory = memory;
    this.emit = emit;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[Agent] Autonomous loop started');
    this.tick().catch((err: unknown) => {
      console.error('[Agent] Initial tick failed:', err);
    });
    this.interval = setInterval(() => {
      this.tick().catch((err: unknown) => {
        console.error('[Agent] Tick failed:', err);
      });
    }, 4000);
  }

  stop(): void {
    this.running = false;
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
    console.log('[Agent] Autonomous loop stopped');
  }

  getStatus(): AgentStatus {
    return {
      running: this.running,
      model: this.modelReader.getCurrentModel().display,
      iterations: this.iterations,
      lastAction: this.lastAction,
      behaviorMode: this.behaviorMode,
      activeGoal: this.memory.getActiveGoal(),
      lastPlan: this.lastPlan,
      knownPlayers: this.memory.getKnownPlayers(),
    };
  }

  setBehaviorMode(mode: BehaviorMode): void {
    this.behaviorMode = mode;
    this.memory.addEvent('mode', `Behavior mode set to ${mode}`);
    console.log(`[Agent] Behavior mode set to ${mode}`);
  }

  getBehaviorMode(): BehaviorMode {
    return this.behaviorMode;
  }

  getActiveGoal(): ActiveGoal | null {
    return this.memory.getActiveGoal();
  }

  setGoal(input: Omit<ActiveGoal, 'id' | 'status' | 'createdAt' | 'updatedAt'>): ActiveGoal {
    this.clearIdlePause();
    return this.memory.setActiveGoal(input);
  }

  clearGoal(summary = 'Goal cleared'): void {
    this.memory.clearGoal(summary);
  }

  handleBotDeath(): void {
    this.runningAction = null;
    this.latestCommandSequence += 1;
    this.beginIdlePause(8000);
    this.actions.cancelAll('Bot died; cancelled active work');
    this.failActiveGoal('Bot died during the task');
  }

  getMemorySnapshot() {
    return this.memory.getState();
  }

  addMemoryNote(note: string): void {
    this.memory.addNote(note);
  }

  private setConversationFocus(username: string): void {
    this.conversationFocus = { username, at: Date.now() };
  }

  private hasConversationFocus(username: string): boolean {
    return Boolean(
      this.conversationFocus &&
      this.conversationFocus.username === username &&
      Date.now() - this.conversationFocus.at < 15000,
    );
  }

  private isAddressedToHermes(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('hermes') || normalized.startsWith('bot ');
  }

  private canHandleUnaddressedChat(mc: any, username: string): boolean {
    const visiblePlayers = Object.values(mc.players ?? {}).filter((player: any) => {
      if (!player?.username || !player?.entity) return false;
      return player.username !== mc.username;
    });

    return visiblePlayers.length <= 1 || this.hasConversationFocus(username);
  }

  private beginIdlePause(ms: number): void {
    this.idleUntil = Date.now() + ms;
  }

  private clearIdlePause(): void {
    this.idleUntil = 0;
  }

  private getPlayerMemory(username: string): { lastSeenAt?: number; lastSeenPosition?: { x: number; y: number; z: number } } | null {
    const state = this.memory.getState();
    return state.players?.[username.toLowerCase()] ?? null;
  }

  private incrementGoalFailure(goal: ActiveGoal): number {
    const next = (this.goalFailures.get(goal.id) ?? 0) + 1;
    this.goalFailures.set(goal.id, next);
    return next;
  }

  private resetGoalFailure(goal: ActiveGoal | null): void {
    if (!goal) return;
    this.goalFailures.delete(goal.id);
  }

  private failActiveGoal(summary: string): void {
    if (typeof (this.memory as any).failGoal === 'function') {
      (this.memory as any).failGoal(summary);
    } else {
      this.memory.clearGoal(summary);
    }
  }

  async handleChat(username: string, message: string): Promise<void> {
    try {
      const mc = this.actions.getBot().getBot();
      if (!mc || username === mc.username) return;

      const trimmed = message.trim();
      if (!trimmed) return;

      const now = Date.now();
      this.memory.rememberChat(username, trimmed);

      const playerEntity = Object.values(mc.players ?? {}).find((player: any) => player?.username === username) as any;
      if (playerEntity?.entity?.position) {
        this.memory.rememberPlayerSeen(username, {
          x: Math.round(playerEntity.entity.position.x),
          y: Math.round(playerEntity.entity.position.y),
          z: Math.round(playerEntity.entity.position.z),
        });
      }

      if (now - this.lastCommandTime < 250) return;

      const normalized = trimmed.toLowerCase();
      const isAddressed = this.isAddressedToHermes(trimmed);
      const canHandleUnaddressed = this.canHandleUnaddressedChat(mc, username);

      const directReply = (isAddressed || canHandleUnaddressed)
        ? this.getDirectReply(username, trimmed)
        : null;
      if (directReply) {
        this.lastChatTime = now;
        this.lastDirectReply = { username, message: directReply, at: now };
        this.setConversationFocus(username);
        mc.chat(directReply);
        return;
      }

      if (normalized.startsWith('remember that ')) {
        const note = trimmed.slice('remember that '.length).trim();
        if (note) {
          this.memory.addPlayerNote(username, note);
          this.setConversationFocus(username);
          mc.chat(`Okay ${username}, I'll remember that.`);
        }
        return;
      }

      if ((isAddressed || canHandleUnaddressed) && /(what are you doing|what's the plan|status\??|goal\??)/i.test(trimmed)) {
        const goal = this.memory.getActiveGoal();
        const response = goal
          ? `I'm working on: ${goal.summary}`
          : 'No big task right now, just staying helpful.';
        this.setConversationFocus(username);
        mc.chat(response);
        return;
      }

      const soundsCommandLike = /(follow|come|stop|mine|dig|gather|collect|attack|protect|defend|find|explore|build|craft|eat|inventory|give|drop|equip|hold|say|where|list|remember)/i.test(trimmed);
      const isQuestion = trimmed.includes('?');

      if (!isAddressed && !soundsCommandLike && !isQuestion) return;
      if (!isAddressed && !canHandleUnaddressed) return;

      const commandText = this.stripWakeWord(trimmed);
      const action = await this.parseNaturalCommand(commandText, username);

      if (!action) {
        if (now - this.lastChatTime < 3000) return;
        this.lastChatTime = now;
        const reply = await this.generateSocialReply(username, trimmed);
        this.setConversationFocus(username);
        mc.chat(reply);
        return;
      }

      this.lastCommandTime = now;
      const commandSequence = ++this.latestCommandSequence;
      this.setConversationFocus(username);
      if (action.type === 'mineCobbleGen' && this.runningAction?.type === 'mineCobbleGen') {
        if (now - this.lastDuplicateActionReplyAt > 3000) {
          this.lastDuplicateActionReplyAt = now;
          mc.chat(`Already mining the cobblestone generator, ${username}. Say "hermes stop" to cancel.`);
        }
        return;
      }
      if (action.type === 'stop') {
        this.beginIdlePause(20000);
      } else {
        this.clearIdlePause();
      }
      if (!['getInventory', 'countItem', 'listNearby', 'say', 'stop'].includes(action.type)) {
        await this.actions.stop();
      }
      const derivedGoal = this.deriveGoalFromAction(commandText, username, action.type, action.params);
      if (derivedGoal) {
        this.memory.rememberRequest(username, derivedGoal.summary);
        this.memory.setActiveGoal(derivedGoal);
      } else if (action.type === 'stop') {
        this.memory.clearGoal('Player asked Hermes to stop');
      }

      const immediateAck = this.getImmediateActionAck(username, action.type, action.params);
      if (immediateAck) {
        mc.chat(immediateAck);
      }

      this.runningAction = { type: action.type, at: now };
      let result;
      try {
        result = await this.actions.execute(action.type, action.params);
      } finally {
        if (this.runningAction?.type === action.type) {
          this.runningAction = null;
        }
      }
      this.lastAction = `${action.type} -> ${result.success ? 'ok' : result.message}`;
      this.memory.addEvent(
        'command',
        `${username}: ${commandText} -> ${result.success ? result.message : `failed (${result.message})`}`,
      );

      if (commandSequence !== this.latestCommandSequence) {
        return;
      }

      const response = this.formatActionResponse(username, action.type, action.params, result.success, result.message, immediateAck);
      if (response) {
        this.lastChatTime = now;
        mc.chat(response);
      }
    } catch (err: any) {
      console.error('[Agent] Chat handler error:', err.message, err.stack);
    }
  }

  private async tick(): Promise<void> {
    if (!this.running || this.tickInProgress) return;
    this.tickInProgress = true;

    try {
      const snapshot = this.perception.getSnapshot();
      const mc = this.actions.getBot().getBot();
      if (!snapshot || !mc || !mc.entity) return;

      this.rememberVisiblePlayers(snapshot);

      if (await this.handleSafetyReflexes(snapshot)) return;
      if (this.maybeCompleteGoal()) return;
      if (this.maybeExpireStaleGoal(snapshot)) return;

      if (!this.memory.getActiveGoal()) {
        this.lastAction = 'idle';
        return;
      }

      const now = Date.now();
      if (now < this.idleUntil) return;
      if (now - this.lastPlanTime < 5000) return;
      this.lastPlanTime = now;

      const action = await this.planNextAction(snapshot);
      if (!action) return;

      this.lastPlan = `${action.type} ${JSON.stringify(action.params)}`;
      const result = await this.actions.execute(action.type, action.params);
      this.iterations += 1;
      this.lastAction = `${action.type} -> ${result.success ? 'ok' : result.message}`;
      this.memory.addEvent(
        'plan',
        `${this.lastPlan} -> ${result.success ? result.message : `failed (${result.message})`}`,
      );

      const goal = this.memory.getActiveGoal();
      if (result.success) {
        this.resetGoalFailure(goal);
      } else if (goal && /can't|couldn't|failed|no exposed|not found|can't see|stopped/i.test(result.message)) {
        const failureCount = this.incrementGoalFailure(goal);
        if (failureCount >= 3) {
          this.failActiveGoal('Stopped chasing a stale goal');
          this.beginIdlePause(12000);
          if (mc && goal.requestedBy) {
            mc.chat(`${goal.requestedBy}, I can't make progress on ${goal.summary.toLowerCase()} right now.`);
          }
        } else {
          this.memory.updateGoal({ updatedAt: Date.now() } as Partial<Omit<ActiveGoal, 'id' | 'createdAt'>>);
        }
      }
    } catch (err: any) {
      console.error('[Agent] Tick error:', err.message);
    } finally {
      this.tickInProgress = false;
    }
  }

  private rememberVisiblePlayers(snapshot: WorldSnapshot): void {
    snapshot.nearbyEntities
      .filter(entity => entity.type === 'player')
      .forEach((entity) => {
        this.memory.rememberPlayerSeen(entity.name, entity.position);
      });
  }

  private async handleSafetyReflexes(snapshot: WorldSnapshot): Promise<boolean> {
    const mc = this.actions.getBot().getBot();
    if (!mc) return false;

    if (snapshot.food < 10) {
      const foods = ['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'apple', 'baked_potato'];
      for (const foodName of foods) {
        const count = this.actions.countItem(foodName);
        if (count <= 0) continue;
        const result = await this.actions.execute('eat', { foodName });
        this.lastAction = `eat -> ${result.success ? 'ok' : result.message}`;
        return result.success;
      }
    }

    const hostile = snapshot.nearbyEntities.find(entity => entity.type === 'hostile' && entity.distance <= 5.5);
    if (hostile && snapshot.health >= 8) {
      const result = await this.actions.execute('attack', { entityName: hostile.name });
      this.lastAction = `attack -> ${result.success ? 'ok' : result.message}`;
      if (result.success) {
        this.memory.addEvent('combat', `Engaged nearby ${hostile.name}`);
      }
      return result.success;
    }

    return false;
  }

  private maybeCompleteGoal(): boolean {
    const goal = this.memory.getActiveGoal();
    if (!goal || goal.kind !== 'gather' || !goal.resourceName || !goal.targetCount) return false;

    const current = this.actions.countResource(goal.resourceName);
    if (current < goal.targetCount) return false;

    const mc = this.actions.getBot().getBot();
    this.memory.completeGoal(`Completed gather goal for ${goal.resourceName} (${current}/${goal.targetCount})`);
    if (mc && goal.requestedBy) {
      mc.chat(`${goal.requestedBy}, I have ${current} ${goal.resourceName} now.`);
    }
    return true;
  }

  private maybeExpireStaleGoal(snapshot: WorldSnapshot): boolean {
    const goal = this.memory.getActiveGoal();
    if (!goal) return false;

    const now = Date.now();
    const age = now - goal.updatedAt;

    if (goal.kind === 'gather' && age > 120000) {
      this.failActiveGoal('Gather goal went stale');
      this.beginIdlePause(10000);
      return true;
    }

    if (!goal.targetPlayer || !['follow', 'protect', 'build'].includes(goal.kind)) {
      return false;
    }

    const targetVisible = snapshot.nearbyEntities.some((entity) =>
      entity.type === 'player' && entity.name.toLowerCase() === goal.targetPlayer?.toLowerCase(),
    );

    if (targetVisible) return false;

    const rememberedPlayer = this.getPlayerMemory(goal.targetPlayer);
    const unseenFor = rememberedPlayer?.lastSeenAt ? now - rememberedPlayer.lastSeenAt : Infinity;

    if (age > 45000 && unseenFor > 45000) {
      this.failActiveGoal(`Lost track of ${goal.targetPlayer}`);
      this.beginIdlePause(10000);
      return true;
    }

    return false;
  }

  private async planNextAction(snapshot: WorldSnapshot): Promise<{ type: string; params: Record<string, any> } | null> {
    const prompt = this.buildPlanningPrompt(snapshot);
    const response = await this.callHermes(prompt);
    if (!response) return this.fallbackPlan(snapshot);

    const parsed = this.parseAction(response);
    if (parsed) return parsed;
    return this.fallbackPlan(snapshot);
  }

  private buildPlanningPrompt(snapshot: WorldSnapshot): string {
    const goal = this.memory.getActiveGoal();
    const nearbyPlayers = snapshot.nearbyEntities
      .filter(entity => entity.type === 'player')
      .map(entity => `${entity.name} at ${entity.distance}m`)
      .join(', ') || 'none';

    const hostiles = snapshot.nearbyEntities
      .filter(entity => entity.type === 'hostile')
      .map(entity => `${entity.name} at ${entity.distance}m`)
      .join(', ') || 'none';

    const nearbyBlocks = snapshot.nearbyBlocks
      .slice(0, 10)
      .map(block => `${block.name} at ${block.distance}m`)
      .join(', ') || 'none';

    return `${SYSTEM_PROMPTS[this.behaviorMode]}

You are controlling a single Minecraft bot named Hermes.
Play fairly. Only use nearby players, nearby blocks, and exposed resources listed below. Do not assume hidden ore or off-screen knowledge.

${ACTION_GUIDE}

Current state:
- Position: ${snapshot.position.x}, ${snapshot.position.y}, ${snapshot.position.z}
- Health: ${snapshot.health}/20
- Food: ${snapshot.food}/20
- Biome: ${snapshot.biome}
- Time: ${snapshot.time}
- Weather: ${snapshot.weather}
- Players nearby: ${nearbyPlayers}
- Hostile mobs: ${hostiles}
- Interesting exposed blocks: ${nearbyBlocks}
- Inventory: ${snapshot.inventory.slice(0, 8).map(item => `${item.count}x ${item.name}`).join(', ') || 'empty'}
- Last action: ${this.lastAction}
- Active goal: ${goal ? goal.summary : 'none'}

Long-term memory:
${this.memory.getPromptContext()}

Choose the single best next action for Hermes right now.`;
  }

  private fallbackPlan(snapshot: WorldSnapshot): { type: string; params: Record<string, any> } | null {
    const goal = this.memory.getActiveGoal();

    if (goal?.kind === 'follow' && goal.targetPlayer) {
      const visibleTarget = snapshot.nearbyEntities.find((entity) =>
        entity.type === 'player' && entity.name.toLowerCase() === goal.targetPlayer!.toLowerCase(),
      );
      if (visibleTarget) {
        return { type: 'follow', params: { entityName: goal.targetPlayer } };
      }

      const rememberedPlayer = this.getPlayerMemory(goal.targetPlayer);
      if (rememberedPlayer?.lastSeenPosition && rememberedPlayer.lastSeenAt && Date.now() - rememberedPlayer.lastSeenAt < 30000) {
        return { type: 'moveTo', params: rememberedPlayer.lastSeenPosition };
      }

      return null;
    }

    if (goal?.kind === 'protect' && goal.targetPlayer) {
      const threat = snapshot.nearbyEntities.find(entity => entity.type === 'hostile' && entity.distance <= 8);
      if (threat) return { type: 'attack', params: { entityName: threat.name } };

      const visibleTarget = snapshot.nearbyEntities.find((entity) =>
        entity.type === 'player' && entity.name.toLowerCase() === goal.targetPlayer!.toLowerCase(),
      );
      if (visibleTarget) {
        return { type: 'follow', params: { entityName: goal.targetPlayer } };
      }

      const rememberedPlayer = this.getPlayerMemory(goal.targetPlayer);
      if (rememberedPlayer?.lastSeenPosition && rememberedPlayer.lastSeenAt && Date.now() - rememberedPlayer.lastSeenAt < 30000) {
        return { type: 'moveTo', params: rememberedPlayer.lastSeenPosition };
      }

      return null;
    }

    if (goal?.kind === 'build' && goal.targetPlayer) {
      const visibleTarget = snapshot.nearbyEntities.find((entity) =>
        entity.type === 'player' && entity.name.toLowerCase() === goal.targetPlayer!.toLowerCase(),
      );
      if (visibleTarget) {
        return { type: 'follow', params: { entityName: goal.targetPlayer } };
      }

      const rememberedPlayer = this.getPlayerMemory(goal.targetPlayer);
      if (rememberedPlayer?.lastSeenPosition && rememberedPlayer.lastSeenAt && Date.now() - rememberedPlayer.lastSeenAt < 30000) {
        return { type: 'moveTo', params: rememberedPlayer.lastSeenPosition };
      }

      return null;
    }

    if (goal?.kind === 'gather' && goal.resourceName) {
      return {
        type: 'collectResource',
        params: {
          resourceName: goal.resourceName,
          targetCount: goal.targetCount ?? 1,
        },
      };
    }

    if (goal?.kind === 'explore') {
      return { type: 'explore', params: {} };
    }

    return null;
  }

  private stripWakeWord(message: string): string {
    const lowered = message.toLowerCase();
    const hermesIndex = lowered.indexOf('hermes');
    if (hermesIndex >= 0) {
      return message.slice(hermesIndex + 'hermes'.length).trim() || 'help';
    }
    return message.trim();
  }

  private normalizeCommandText(message: string): string {
    return message
      .trim()
      .replace(/^[,:\-\s]+/, '')
      .replace(/[.!?]+$/g, '')
      .replace(/^(?:yes|yeah|yep|ok|okay|sure)\s+/i, '')
      .replace(/^(?:can|could|would)\s+you\s+/i, '')
      .replace(/^please\s+/i, '')
      .trim();
  }

  private parseRequestedThing(raw: string, defaultCount = 1): { resourceName: string; targetCount: number } {
    let cleaned = raw
      .trim()
      .replace(/\s+(?:for\s+me|for\s+us|please)$/i, '')
      .replace(/^(?:me|us)\s+/i, '')
      .replace(/^(?:some|this|that|the|a|an)\s+/i, '')
      .trim();

    let targetCount = defaultCount;
    const countMatch = cleaned.match(/^(\d+)\s+(.+)$/);
    if (countMatch) {
      targetCount = Number.parseInt(countMatch[1], 10);
      cleaned = countMatch[2].trim();
    } else if (/\bsome\b/i.test(raw)) {
      targetCount = Math.max(defaultCount, 4);
    }

    cleaned = cleaned
      .replace(/^(?:some|this|that|the|a|an)\s+/i, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');

    const aliases: Record<string, string> = {
      logs: 'log',
      oak_wood: 'oak_log',
      oak_logs: 'oak_log',
      birch_wood: 'birch_log',
      birch_logs: 'birch_log',
      spruce_wood: 'spruce_log',
      spruce_logs: 'spruce_log',
      jungle_wood: 'jungle_log',
      jungle_logs: 'jungle_log',
      acacia_wood: 'acacia_log',
      acacia_logs: 'acacia_log',
      acasia_wood: 'acacia_log',
      acasia_log: 'acacia_log',
      acasia_logs: 'acacia_log',
      dark_oak_wood: 'dark_oak_log',
      dark_oak_logs: 'dark_oak_log',
      mangrove_wood: 'mangrove_log',
      mangrove_logs: 'mangrove_log',
      cherry_wood: 'cherry_log',
      cherry_logs: 'cherry_log',
    };

    return {
      resourceName: aliases[cleaned] ?? cleaned,
      targetCount,
    };
  }

  private parseCraftRequest(raw: string, defaultCount = 1): { recipeName: string; count: number } {
    let cleaned = raw
      .trim()
      .replace(/\s+(?:with|using|from)\s+(?:these|the|my)?\s*(?:materials?|items?|stuff|resources?)(?:\s+i\s+gave\s+you|\s+you\s+have)?$/i, '')
      .replace(/\s+with\s+(?:the\s+)?materials?\s+i\s+gave\s+you$/i, '')
      .replace(/\s+(?:for\s+me|for\s+us|please)$/i, '')
      .replace(/^(?:me|us)\s+/i, '')
      .replace(/^(?:some|this|that|the|a|an)\s+/i, '')
      .trim();

    let count = defaultCount;
    const countMatch = cleaned.match(/^(\d+)\s+(.+)$/);
    if (countMatch) {
      count = Number.parseInt(countMatch[1], 10);
      cleaned = countMatch[2].trim();
    }

    cleaned = cleaned
      .replace(/^(?:some|this|that|the|a|an)\s+/i, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');

    const aliases: Record<string, string> = {
      torches: 'torch',
      sticks: 'stick',
      planks: 'oak_planks',
      wooden_planks: 'oak_planks',
      wood_planks: 'oak_planks',
      workbench: 'crafting_table',
      furnaces: 'furnace',
      chests: 'chest',
      ladders: 'ladder',
    };

    return {
      recipeName: aliases[cleaned] ?? cleaned,
      count,
    };
  }

  private cleanItemThing(raw: string): string {
    const cleaned = raw
      .trim()
      .replace(/\s+(?:for\s+me|please)$/i, '')
      .replace(/^(?:(?:me|us|all|some|this|that|the|a|an)\s+)+/i, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');

    const aliases: Record<string, string> = {
      cobble: 'cobblestone',
      cobbletsone: 'cobblestone',
      cobbelstone: 'cobblestone',
      cobblstone: 'cobblestone',
      cobblestones: 'cobblestone',
      logs: 'wood',
      wooden_logs: 'wood',
    };

    return aliases[cleaned] ?? cleaned;
  }

  private humanizeThing(value: string | undefined): string {
    return String(value ?? 'that').replace(/_/g, ' ');
  }

  private describeGoal(goal: ActiveGoal): string {
    switch (goal.kind) {
      case 'gather':
        return `I'm gathering ${goal.targetCount ?? 'some'} ${this.humanizeThing(goal.resourceName)}${goal.requestedBy ? ` for ${goal.requestedBy}` : ''}.`;
      case 'follow':
        return `I'm staying near ${goal.targetPlayer ?? goal.requestedBy ?? 'you'}.`;
      case 'protect':
        return `I'm protecting ${goal.targetPlayer ?? goal.requestedBy ?? 'you'}.`;
      case 'build':
        return `I'm helping ${goal.targetPlayer ?? goal.requestedBy ?? 'you'} build.`;
      case 'explore':
        return `I'm scouting nearby.`;
      default:
        return `I'm working on ${goal.summary.toLowerCase()}.`;
    }
  }

  private async parseNaturalCommand(
    message: string,
    username: string,
  ): Promise<{ type: string; params: Record<string, any> } | null> {
    const normalizedMessage = this.normalizeCommandText(message);
    const cobbleGen = '(?:(?:cobble(?:stone)?|cobbelstone|cobbletsone|cobblstone)\\s*)?(?:generator|gen|cobblegen)';
    const quickPatterns: [RegExp, string, Record<string, any> | ((match: RegExpMatchArray) => Record<string, any>)][] = [
      [/^(?:come\s+here|come|follow\s+me|follow)$/i, 'follow', { entityName: username }],
      [/^(?:guard\s+me|protect\s+me)$/i, 'follow', { entityName: username }],
      [/^(?:stop|halt|stay|wait|cancel|nevermind|forget\s+it)$/i, 'stop', {}],
      [/^(?:stop\s+following\s+me|stop\s+following|don'?t\s+follow\s+me|leave\s+me)$/i, 'stop', {}],
      [/^(?:stop\s+mining|stop\s+that)$/i, 'stop', {}],
      [/^jump$/i, 'jump', {}],
      [/^(?:defend|protect|fight)$/i, 'defend', { range: 16 }],
      [/^(?:attack|kill|fight)\s+me$/i, 'attack', { entityName: username }],
      [/^(?:try\s+)?kill\s+me$/i, 'attack', { entityName: username }],
      [/^(?:attack|kill)$/i, 'defend', { range: 10 }],
      [/^attack\s+(\S+)$/i, 'attack', (match) => ({ entityName: match[1] })],
      [/^(?:kill|fight)\s+(\S+)$/i, 'attack', (match) => ({ entityName: match[1] })],
      [new RegExp(`^(?:mine|dig|break)\\s+(?:the\\s+)?${cobbleGen}(?:\\s+(?:continuously|constantly|forever))?$`, 'i'), 'mineCobbleGen', { continuous: true, cycles: 64, playerName: username }],
      [new RegExp(`^(?:continuously|constantly)\\s+(?:mine|dig|break)\\s+(?:the\\s+)?${cobbleGen}$`, 'i'), 'mineCobbleGen', { continuous: true, cycles: 64, playerName: username }],
      [/^(?:mine|dig|break|chop)\s+(?:the\s+)?(?:block|item|thing)\s+(?:in\s*front|infront|ahead)(?:\s+of\s+(?:you|me))?$/i, 'mineCursorBlock', {}],
      [/^(?:mine|dig|break|chop)\s+(?:this|that)$/i, 'mineCursorBlock', {}],
      [/^(?:mine|dig|chop|get|go\s+mine|go\s+get)\s+(.+)$/i, 'collectResource', (match) => this.parseRequestedThing(match[1], 1)],
      [/^(?:find|where\s+is)\s+(\S+)$/i, 'findResource', (match) => ({ resourceName: match[1] })],
      [/^(?:gather|collect)\s+(?:(\d+)\s+)?(.+)$/i, 'collectResource', (match) => this.parseRequestedThing(
        match[1] ? `${match[1]} ${match[2]}` : match[2],
        16,
      )],
      [/^give\s+me\s+(.+)$/i, 'giveAll', (match) => ({ itemName: match[1].trim().replace(/^all\s+/, ''), playerName: username })],
      [/^(?:drop|give)\s+me\s+(.+)$/i, 'giveAll', (match) => ({ itemName: this.cleanItemThing(match[1]), playerName: username })],
      [/^(?:drop|give)\s+(.+)$/i, 'giveAll', (match) => ({ itemName: this.cleanItemThing(match[1]), playerName: username })],
      [/^inventory$/i, 'getInventory', {}],
      [/^what\s+do\s+you\s+see$/i, 'listNearby', {}],
      [/^equip\s+(\S+)$/i, 'equip', (match) => ({ itemName: match[1], slot: 'hand' })],
      [/^hold\s+(\S+)$/i, 'equip', (match) => ({ itemName: match[1], slot: 'hand' })],
      [/^eat\s+(\S+)$/i, 'eat', (match) => ({ foodName: match[1] })],
      [/^(?:place|put\s+down|set\s+down)\s+(?:a\s+|the\s+)?(?:crafting\s+table|workbench)$/i, 'placeCraftingTable', {}],
      [/^(?:craft|make|create)\s+(.+)$/i, 'craft', (match) => this.parseCraftRequest(match[1], 1)],
      [/^say\s+(.+)$/i, 'say', (match) => ({ message: match[1] })],
      [/^(?:explore|wander|look\s+around)$/i, 'explore', {}],
      [/^(?:build|help\s+me\s+build)\s*(.*)$/i, 'follow', { entityName: username }],
    ];

    for (const [pattern, type, params] of quickPatterns) {
      const match = normalizedMessage.match(pattern);
      if (!match) continue;
      return { type, params: typeof params === 'function' ? params(match) : params };
    }

    const prompt = `You are a command parser for a Minecraft bot named Hermes.

Player: ${username}
Message: "${normalizedMessage}"

Return only JSON with this shape:
{"type":"actionName","params":{...}}

If the player is just chatting, return:
{"type":"none"}

Use only these actions:
follow, moveTo, collectResource, mineBlock, mineCursorBlock, mineCobbleGen, dig, placeBlock, placeCraftingTable, attack, defend, stop, jump, sneak, equip, say, giveAll, countItem, getInventory, craft, eat, explore, findResource, listNearby`;

    const response = await this.callHermes(prompt);
    if (!response) return null;

    try {
      const match = response.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]) as { type?: string; params?: Record<string, any> };
      if (!parsed.type || parsed.type === 'none') return null;
      return { type: parsed.type, params: parsed.params ?? {} };
    } catch {
      return null;
    }
  }

  private deriveGoalFromAction(
    message: string,
    username: string,
    type: string,
    params: Record<string, any>,
  ): Omit<ActiveGoal, 'id' | 'status' | 'createdAt' | 'updatedAt'> | null {
    const normalized = message.toLowerCase();
    if (type === 'follow') {
      if (/(build|help me build)/i.test(message)) {
        return {
          summary: `Stay near ${username} and assist with building.`,
          kind: 'build',
          requestedBy: username,
          targetPlayer: username,
        };
      }

      if (/(guard|protect me)/i.test(message)) {
        return {
          summary: `Stay near ${username} and protect them from hostile mobs.`,
          kind: 'protect',
          requestedBy: username,
          targetPlayer: username,
        };
      }

      return {
        summary: `Stay near ${username} and help them.`,
        kind: 'follow',
        requestedBy: username,
        targetPlayer: username,
      };
    }

    if (type === 'defend') {
      return {
        summary: `Protect ${username} from nearby hostile mobs.`,
        kind: 'protect',
        requestedBy: username,
        targetPlayer: username,
      };
    }

    if (type === 'collectResource' || type === 'findResource' || (type === 'mineBlock' && /(gather|collect|get|mine)/i.test(message))) {
      const countMatch = normalized.match(/\b(\d+)\b/);
      const resourceName = String(params.resourceName ?? params.blockName ?? 'resource');
      const explicitTarget = typeof params.targetCount === 'number' ? params.targetCount : undefined;
      return {
        summary: `Gather ${explicitTarget ?? (countMatch ? Number.parseInt(countMatch[1], 10) : 'some')} ${resourceName} for ${username}.`,
        kind: 'gather',
        requestedBy: username,
        resourceName,
        targetCount: explicitTarget ?? (countMatch ? Number.parseInt(countMatch[1], 10) : 16),
      };
    }

    if (type === 'explore') {
      return {
        summary: `Explore nearby terrain and report anything useful.`,
        kind: 'explore',
        requestedBy: username,
      };
    }

    if (type === 'craft' && params.recipeName) {
      const count = typeof params.count === 'number' && params.count > 0 ? params.count : 1;
      const recipeName = String(params.recipeName);
      return {
        summary: `Craft ${count} ${recipeName} for ${username}.`,
        kind: 'general',
        requestedBy: username,
      };
    }

    return null;
  }

  private formatActionResponse(
    username: string,
    type: string,
    params: Record<string, any>,
    success: boolean,
    message: string,
    immediateAck: string | null,
  ): string | null {
    if (!success) {
      if (/stopped that job|stopped digging|stopped handing items over/i.test(message)) {
        return null;
      }
      return `Sorry ${username}, ${message}`;
    }

    switch (type) {
      case 'follow':
      case 'attack':
      case 'defend':
        return null;
      case 'stop':
        return null;
      case 'collectResource':
        return message;
      case 'mineBlock':
      case 'mineCursorBlock':
      case 'mineCobbleGen':
        if (immediateAck && /Looking for|Heading over|scouting|Got /i.test(message)) {
          return message;
        }
        return immediateAck ? null : `On it, mining ${params.blockName ?? 'that'}.`;
      case 'findResource':
        return message;
      case 'placeCraftingTable':
        return message;
      case 'craft':
        return message;
      case 'giveAll':
        return `Here you go, ${username}.`;
      case 'getInventory':
      case 'listNearby':
      case 'countItem':
        return message;
      case 'say':
        return String(params.message ?? 'Done.');
      default:
        return immediateAck ? null : message;
    }
  }

  private getImmediateActionAck(
    username: string,
    type: string,
    params: Record<string, any>,
  ): string | null {
    const amount = typeof params.targetCount === 'number' && params.targetCount > 1 ? `${params.targetCount} ` : '';
    switch (type) {
      case 'follow':
        return `On my way, ${username}.`;
      case 'attack':
      case 'defend':
        return `I've got it.`;
      case 'stop':
        return `Okay ${username}, I'll stay put for a bit.`;
      case 'collectResource':
        return `Okay ${username}, I'll gather ${amount}${this.humanizeThing(params.resourceName)}.`;
      case 'mineBlock':
        return `Okay ${username}, I'll mine ${this.humanizeThing(params.blockName)}.`;
      case 'findResource':
        return `Okay ${username}, looking for ${this.humanizeThing(params.resourceName)}.`;
      case 'craft': {
        const count = typeof params.count === 'number' && params.count > 1 ? `${params.count} ` : '';
        return `Okay ${username}, I'll craft ${count}${this.humanizeThing(params.recipeName)}.`;
      }
      default:
        return null;
    }
  }

  private async generateSocialReply(username: string, message: string): Promise<string> {
    const basicReply = this.getDirectReply(username, message);
    if (basicReply) return basicReply;

    const prompt = `You are Hermes, a friendly Minecraft bot.

Player: ${username}
Message: "${message}"

Relevant memory:
${this.memory.getPromptContext()}

Reply in one short in-game sentence as Hermes. Do not include quotes or markdown.`;

    const response = await this.callHermes(prompt);
    if (!response) {
      if (/(follow|mine|attack|kill|fight|gather|collect|stop|come|help|build)/i.test(message)) {
        return `Tell me the exact job, ${username}.`;
      }
      const goal = this.memory.getActiveGoal();
      return goal ? this.describeGoal(goal) : `I'm here, ${username}.`;
    }

    return response.split('\n').map(line => line.trim()).filter(Boolean)[0] ?? `I'm here, ${username}.`;
  }

  private getDirectReply(username: string, message: string): string | null {
    const normalized = message.trim().toLowerCase();
    const goal = this.memory.getActiveGoal();

    if (!normalized) return null;

    if (this.lastDirectReply &&
        this.lastDirectReply.username === username &&
        this.lastDirectReply.message &&
        Date.now() - this.lastDirectReply.at < 2000) {
      return null;
    }

    if (/^(hi|hello|hey|yo)(?:\s+hermes)?[.!?]*$/.test(normalized)) {
      return `Hey ${username}. Need a hand?`;
    }

    if (/^(yes|yeah|yep|ok|okay|sure)[.!?]*$/.test(normalized)) {
      return goal ? this.describeGoal(goal) : `Okay ${username}, what do you need?`;
    }

    if (/^(thanks|thank you)(?:\s+hermes)?[.!?]*$/.test(normalized)) {
      return `Anytime, ${username}.`;
    }

    if (/^(?:i need help|help me|need help)[.!?]*$/.test(normalized)) {
      return `Tell me the job, ${username}. I can follow, gather, mine, or fight.`;
    }

    return null;
  }

  private parseAction(response: string): { type: string; params: Record<string, any> } | null {
    const actionMatch = response.match(/ACTION:\s*(\w+)\s*(\{.*\})?/i);
    if (actionMatch) {
      const [, rawType, rawParams] = actionMatch;
      try {
        return {
          type: rawType,
          params: rawParams ? JSON.parse(rawParams) as Record<string, any> : {},
        };
      } catch {
        return { type: rawType, params: {} };
      }
    }

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      const parsed = JSON.parse(jsonMatch[0]) as { type?: string; params?: Record<string, any> };
      if (!parsed.type) return null;
      return { type: parsed.type, params: parsed.params ?? {} };
    } catch {
      return null;
    }
  }

  private async callHermes(prompt: string): Promise<string | null> {
    const tmpDir = mkdtempSync(join(tmpdir(), 'hermes-mc-'));
    const promptFile = join(tmpDir, 'prompt.txt');
    writeFileSync(promptFile, prompt, 'utf-8');

    return new Promise((resolve) => {
      const child = spawn('hermes', ['chat', '-Q', '-q', `@${promptFile}`, '--max-turns', '1'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        timeout: 15000,
      });

      let stdout = '';
      let stderr = '';
      let finished = false;

      const cleanup = (): void => {
        if (finished) return;
        finished = true;
        try {
          rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup issues.
        }
      };

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        cleanup();

        if (code !== 0 && code !== null) {
          console.log(`[Agent] hermes chat exited ${code}: ${stderr.substring(0, 200)}`);
          resolve(null);
          return;
        }

        const lines = stdout
          .split('\n')
          .map(line => line.trim())
          .filter(line =>
            line &&
            !line.includes('session_id') &&
            !line.includes('Reached maximum iterations') &&
            !line.startsWith('⚠'),
          );

        resolve(lines.join('\n').trim() || null);
      });

      child.on('error', (err) => {
        cleanup();
        console.error('[Agent] hermes chat spawn error:', err.message);
        resolve(null);
      });

      setTimeout(() => {
        if (finished) return;
        child.kill();
        cleanup();
        resolve(null);
      }, 15000);
    });
  }
}
