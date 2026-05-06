import mineflayer from 'mineflayer';
import type { BotConfig, Position, BridgeEvent } from './types.js';

type EventHandler = (event: BridgeEvent) => void;

export class HermesBot {
  private config: BotConfig;
  private bot: mineflayer.Bot | null = null;
  private eventHandlers: EventHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private respawnTimers: ReturnType<typeof setTimeout>[] = [];
  private shouldReconnect = true;
  private reconnectFailures = 0;
  private readonly maxReconnectFailures = 8;
  private lastGreetingAt = 0;

  constructor(config: BotConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let spawned = false;

      const finishResolve = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const finishReject = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      this.clearRespawnTimers();
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      // Clean up any old bot
      if (this.bot) {
        try { this.bot.quit(); } catch {}
        this.bot = null;
      }

      const options: mineflayer.BotOptions = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        auth: this.config.auth ?? 'offline',
      };
      if (this.config.version) {
        options.version = this.config.version;
      }

      console.log(`[Bot] Creating bot ${this.config.username} for ${this.config.host}:${this.config.port}`);
      this.bot = mineflayer.createBot(options);
      const activeBot = this.bot;

      // One-time events
      activeBot.once('login', () => {
        console.log('[Bot] Login successful');
      });

      activeBot.once('spawn', () => {
        spawned = true;
        this.reconnectFailures = 0;
        console.log('[Bot] Spawned in world');
        this.emit({ type: 'status', data: { connected: true, message: 'Spawned in world' }, timestamp: Date.now() });
        setTimeout(() => {
          this.maybeGreetNearbyPlayers();
        }, 2000);
        finishResolve();
      });

      activeBot.on('respawn', () => {
        console.log('[Bot] Respawned in world');
        this.clearRespawnTimers();
        this.emit({ type: 'status', data: { connected: true, message: 'Respawned in world' }, timestamp: Date.now() });
        setTimeout(() => {
          this.maybeGreetNearbyPlayers();
        }, 1000);
      });

      activeBot.once('kicked', (reason) => {
        console.log('[Bot] Kicked:', reason);
        this.emit({ type: 'error', data: { message: `Kicked: ${reason}` }, timestamp: Date.now() });
        finishReject(new Error(`Kicked: ${reason}`));
      });

      // Recurring events
      activeBot.on('chat', (username, message) => {
        try {
          if (username === activeBot.username) return;
          console.log(`[Bot] Chat from ${username}: ${message}`);
          this.emit({ type: 'chat', data: { username, message }, timestamp: Date.now() });
        } catch {
          // Don't crash on chat errors
        }
      });

      activeBot.on('death', () => {
        try {
          console.log('[Bot] Died — requesting auto-respawn');
          this.emit({ type: 'death', data: { message: 'Bot died' }, timestamp: Date.now() });
          this.clearRespawnTimers();
          this.queueRespawn(250);
          this.queueRespawn(1000);
          this.queueRespawn(2500);
        } catch {
          // Don't crash on death handling
        }
      });

      activeBot.on('health', () => {
        try {
          this.emit({
            type: 'health',
            data: {
              health: activeBot.health ?? 0,
              food: activeBot.food ?? 0,
            },
            timestamp: Date.now(),
          });
          if (activeBot.food < 10) {
            this.autoEat();
          }
        } catch {
          // Don't crash
        }
      });

      activeBot.on('error', (err) => {
        console.log('[Bot] Error:', err.message);
        this.emit({ type: 'error', data: { message: err.message }, timestamp: Date.now() });
        if (!spawned) {
          finishReject(err);
        }
      });

      activeBot.on('end', () => {
        console.log('[Bot] Connection ended');
        if (this.bot === activeBot) {
          this.bot = null;
        }
        this.clearRespawnTimers();
        this.emit({ type: 'status', data: { connected: false, message: 'Connection ended' }, timestamp: Date.now() });
        if (!spawned) {
          finishReject(new Error('Connection ended before spawn'));
          return;
        }
        this.scheduleReconnect(1000);
      });

      // Timeout for initial connection
      setTimeout(() => {
        if (this.bot === activeBot && !activeBot.entity) {
          console.log('[Bot] Connection timeout');
          finishReject(new Error('Connection timeout'));
        }
      }, 30000);
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.reconnectFailures = 0;
    this.clearRespawnTimers();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.bot) {
      try { this.bot.quit(); } catch {}
      this.bot = null;
    }
    console.log('[Bot] Disconnected (no reconnect)');
  }

  getBot(): mineflayer.Bot | null {
    return this.bot;
  }

  isConnected(): boolean {
    return this.bot !== null && this.bot.entity !== undefined;
  }

  respawn(): void {
    this.bot?.respawn();
  }

  chat(message: string): void {
    try {
      this.bot?.chat(message);
    } catch (err: any) {
      this.emit({ type: 'error', data: { message: `Chat failed: ${err.message}` }, timestamp: Date.now() });
    }
  }

  onEvent(handler: EventHandler): void {
    if (!this.eventHandlers.includes(handler)) {
      this.eventHandlers.push(handler);
    }
  }

  clearEventHandlers(): void {
    this.eventHandlers = [];
  }

  private emit(event: BridgeEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Don't let handler errors crash the bot
      }
    }
  }

  private clearRespawnTimers(): void {
    for (const timer of this.respawnTimers) {
      clearTimeout(timer);
    }
    this.respawnTimers = [];
  }

  private queueRespawn(delayMs: number): void {
    const timer = setTimeout(() => {
      this.respawnTimers = this.respawnTimers.filter(t => t !== timer);
      if (!this.shouldReconnect || !this.bot) return;

      try {
        this.bot.respawn();
        console.log(`[Bot] Respawn requested after ${delayMs}ms`);
        this.emit({ type: 'status', data: { message: 'Respawn requested' }, timestamp: Date.now() });
      } catch (err: any) {
        console.log('[Bot] Respawn request failed:', err?.message ?? err);
      }
    }, delayMs);
    this.respawnTimers.push(timer);
  }

  private scheduleReconnect(delayMs: number): void {
    if (!this.shouldReconnect) return;
    if (this.reconnectFailures >= this.maxReconnectFailures) {
      this.shouldReconnect = false;
      const message = `Stopped reconnecting after ${this.reconnectFailures} failed attempts. Open LAN again and call /connect with the new port.`;
      console.log(`[Bot] ${message}`);
      this.emit({ type: 'error', data: { message }, timestamp: Date.now() });
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const retryDelay = Math.min(delayMs, 30000);
    console.log(`[Bot] Will reconnect in ${retryDelay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect) return;

      console.log('[Bot] Reconnecting...');
      this.connect().catch((err) => {
        this.reconnectFailures += 1;
        console.log(`[Bot] Reconnect failed (${this.reconnectFailures}/${this.maxReconnectFailures}):`, err.message || err.code || err);
        const nextDelay = Math.min(30000, 1000 * 2 ** Math.min(this.reconnectFailures, 5));
        this.scheduleReconnect(nextDelay);
      });
    }, retryDelay);
    this.reconnectTimer.unref?.();
  }

  private async autoEat(): Promise<void> {
    if (!this.bot) return;

    const foodItems = [
      'bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken',
      'cooked_salmon', 'cooked_cod', 'apple', 'golden_apple',
      'baked_potato', 'cookie', 'melon_slice', 'sweet_berries',
      'mushroom_stew', 'beetroot_soup', 'rabbit_stew',
    ];

    for (const foodName of foodItems) {
      const item = this.bot.inventory.items().find(i => i.name === foodName);
      if (item) {
        try {
          await this.bot.equip(item, 'hand');
          await this.bot.consume();
          this.emit({ type: 'status', data: { message: `Ate ${foodName}` }, timestamp: Date.now() });
          return;
        } catch {
          // Try next food item
        }
      }
    }
  }

  private maybeGreetNearbyPlayers(): void {
    if (!this.bot?.entity) return;

    const now = Date.now();
    if (now - this.lastGreetingAt < 30000) return;

    const nearbyPlayers = Object.values(this.bot.players ?? {}).filter((player: any) => {
      if (!player?.entity || !player.username) return false;
      if (player.username === this.bot?.username) return false;
      return this.bot!.entity.position.distanceTo(player.entity.position) <= 16;
    });

    if (nearbyPlayers.length === 0) return;

    this.lastGreetingAt = now;
    const greetings = [
      'Hey, Hermes is here.',
      'Hi, need a hand?',
      'Hello. What are we doing?',
    ];

    try {
      this.bot.chat(greetings[Math.floor(Math.random() * greetings.length)]);
    } catch {
      // Ignore greeting failures.
    }
  }
}
