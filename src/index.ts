import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { HermesBot } from './bot.js';
import { Perception } from './perceive.js';
import { Actions } from './actions.js';
import { ModelReader } from './models.js';
import { AgentLoop } from './agent-loop.js';
import { HermesMemory } from './memory.js';
import type { BotConfig, BridgeEvent, BehaviorMode } from './types.js';
import { readFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ——— Global error handling — don't crash the bridge ———
process.on('uncaughtException', (err: any) => {
  if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
    console.error('[Network] Connection closed unexpectedly:', err.message);
    // These are expected when Minecraft server closes connection
    return;
  }
  console.error('[FATAL] Uncaught exception:', err.message);
  console.error(err.stack);
  // Keep running — don't crash the bridge
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled rejection at:', promise, 'reason:', reason);
  // Keep running
});

// ——— Config ———

const API_PORT = parseInt(process.env.BRIDGE_API_PORT ?? '3847');
const WS_PORT = parseInt(process.env.BRIDGE_WS_PORT ?? '3848');
const BOT_NAME = 'Hermes';

// ─── State ───

let bot: HermesBot | null = null;
let perception: Perception | null = null;
let actions: Actions | null = null;
let agentLoop: AgentLoop | null = null;
const modelReader = new ModelReader();
const memory = new HermesMemory();
const wsClients = new Set<WebSocket>();
const chatHistory: { username: string; message: string; timestamp: number }[] = [];

function describeError(err: any): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;

  const nestedErrors = Array.isArray(err.errors) ? err.errors : [];
  const refused = nestedErrors.find((entry: any) => entry?.code === 'ECONNREFUSED');
  if (refused) {
    return `Connection refused at ${refused.address ?? 'localhost'}:${refused.port ?? 'unknown port'}. Is the LAN world open on that port?`;
  }

  if (err.code === 'ECONNREFUSED') {
    return `Connection refused at ${err.address ?? 'localhost'}:${err.port ?? 'unknown port'}. Is the LAN world open on that port?`;
  }

  return err.message || err.code || String(err);
}

// ─── WebSocket broadcast ───

function broadcast(event: BridgeEvent): void {
  if (event.type === 'chat') {
    chatHistory.push(event.data);
    if (chatHistory.length > 200) chatHistory.shift();

    // Forward chat to agent loop for conversational AI
    if (agentLoop) {
      agentLoop.handleChat(event.data.username, event.data.message).catch((err: any) => {
        console.error('[AgentLoop] Chat handler error:', err.message);
      });
    }
  }
  if (event.type === 'death') {
    agentLoop?.handleBotDeath();
  }
  const data = JSON.stringify(event);
  wsClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

// ─── Express API ───

const app = express();
app.use(express.json());

// Health
app.get('/health', (_req, res) => {
  res.json({
    connected: bot?.isConnected() ?? false,
    uptime: process.uptime(),
    agentRunning: agentLoop?.getStatus().running ?? false,
    botName: BOT_NAME,
    activeGoal: agentLoop?.getActiveGoal() ?? memory.getActiveGoal(),
  });
});

// Connect bot
app.post('/connect', async (req, res) => {
  if (bot?.isConnected()) {
    return res.json({ success: false, message: 'Already connected' });
  }

  const config: BotConfig = {
    host: req.body.host ?? 'localhost',
    port: req.body.port ?? 25565,
    username: BOT_NAME,
    version: req.body.version,
    auth: req.body.auth ?? 'offline',
  };

  bot = new HermesBot(config);
  bot.clearEventHandlers();
  bot.onEvent(broadcast);

  try {
    await bot.connect();
    perception = new Perception(bot);
    actions = new Actions(bot);
    agentLoop = new AgentLoop(perception, actions, modelReader, memory, broadcast);
    res.json({ success: true, message: `Connected to ${config.host}:${config.port} as ${config.username}` });
  } catch (err: any) {
    bot?.disconnect();
    bot = null;
    perception = null;
    actions = null;
    agentLoop = null;
    res.json({ success: false, message: `Connection failed: ${describeError(err)}` });
  }
});

// Disconnect bot
app.post('/disconnect', (_req, res) => {
  agentLoop?.stop();
  agentLoop = null;
  bot?.disconnect();
  bot = null;
  perception = null;
  actions = null;
  res.json({ success: true, message: 'Disconnected' });
});

// Respawn
app.post('/respawn', (_req, res) => {
  bot?.respawn();
  res.json({ success: true, message: 'Respawning' });
});

// Perceive world
app.get('/perceive', (_req, res) => {
  if (!perception) return res.json({ success: false, message: 'Bot not connected' });
  const snapshot = perception.getSnapshot();
  if (!snapshot) return res.json({ success: false, message: 'No snapshot available' });
  res.json({ success: true, data: snapshot });
});

// Inventory
app.get('/inventory', (_req, res) => {
  if (!perception) return res.json({ success: false, message: 'Bot not connected' });
  res.json({ success: true, data: perception.getInventory() });
});

// Execute action
app.post('/action', async (req, res) => {
  if (!actions) return res.json({ success: false, message: 'Bot not connected' });

  const { type, params: explicitParams, ...restParams } = req.body;
  const handler = (actions as any)[type];

  if (typeof handler !== 'function') {
    return res.json({ success: false, message: `Unknown action: ${type}` });
  }

  try {
    let args: any[];
    if (Array.isArray(explicitParams)) {
      args = explicitParams;
    } else if (explicitParams !== undefined) {
      // explicitParams is an object
      args = Object.values(explicitParams);
    } else {
      // fallback: use rest params (spread body minus type)
      args = Object.values(restParams);
    }
    const result = await handler.call(actions, ...args);
    res.json(result);
  } catch (err: any) {
    res.json({ success: false, message: `Action error: ${err.message}` });
  }
});

// Chat history
app.get('/chat/history', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  res.json({ success: true, data: chatHistory.slice(-limit) });
});

// Send chat message from an external CLI/API caller.
app.post('/chat', (req, res) => {
  const { message, username = 'Hermes' } = req.body;
  if (!message) {
    return res.json({ success: false, message: 'Missing message' });
  }
  if (bot?.isConnected()) {
    bot.chat(message);
    res.json({ success: true, message: 'Sent', data: { username, message } });
  } else {
    // Queue for when bot connects
    chatHistory.push({ username, message, timestamp: Date.now() });
    res.json({ success: true, message: 'Queued (bot not connected)', data: { username, message } });
  }
});

// ─── Model endpoints ───

app.get('/model', (_req, res) => {
  const current = modelReader.getCurrentModel();
  const providers = modelReader.getProviders();
  res.json({
    success: true,
    ...current,
    providers,
  });
});

app.get('/model/providers/:id/models', (req, res) => {
  const models = modelReader.getProviderModels(req.params.id);
  res.json({ success: true, provider: req.params.id, models });
});

app.post('/model', async (req, res) => {
  const { provider, model } = req.body;
  if (!provider || !model) {
    return res.json({ success: false, message: 'Missing provider or model' });
  }

  const ok = await modelReader.setModel(provider, model);
  if (ok) {
    res.json({ success: true, message: `Switched to ${model} via ${provider}` });
  } else {
    res.json({ success: false, message: 'Failed to update model config' });
  }
});

// ─── Agent loop endpoints ───

app.post('/agent/start', (_req, res) => {
  if (!agentLoop) return res.json({ success: false, message: 'Bot not connected' });
  agentLoop.start();
  res.json({ success: true, message: 'Agent loop started' });
});

app.post('/agent/stop', (_req, res) => {
  if (!agentLoop) return res.json({ success: false, message: 'Bot not connected' });
  agentLoop.stop();
  res.json({ success: true, message: 'Agent loop stopped' });
});

app.get('/agent/status', (_req, res) => {
  if (!agentLoop) return res.json({ success: false, message: 'Bot not connected' });
  res.json({ success: true, data: agentLoop.getStatus() });
});

app.get('/agent/goal', (_req, res) => {
  res.json({ success: true, data: agentLoop?.getActiveGoal() ?? memory.getActiveGoal() });
});

app.post('/agent/goal', async (req, res) => {
  if (!agentLoop) return res.json({ success: false, message: 'Bot not connected' });
  const { summary, kind = 'general', requestedBy, targetPlayer, resourceName, targetCount } = req.body ?? {};
  if (!summary) return res.json({ success: false, message: 'Missing goal summary' });

  if (actions) {
    await actions.stop();
  }

  const goal = agentLoop.setGoal({
    summary,
    kind,
    requestedBy,
    targetPlayer,
    resourceName,
    targetCount,
  });

  res.json({ success: true, message: 'Goal updated', data: goal });
});

app.delete('/agent/goal', (_req, res) => {
  if (agentLoop) {
    agentLoop.clearGoal('Cleared via API');
  } else {
    memory.clearGoal('Cleared via API');
  }
  res.json({ success: true, message: 'Goal cleared' });
});

app.get('/agent/mode', (_req, res) => {
  res.json({
    success: true,
    data: {
      current: agentLoop?.getBehaviorMode() ?? 'HELPER',
      available: ['PASSIVE', 'HELPER', 'EXPLORER', 'BUILDER', 'DEFENDER'],
    },
  });
});

app.post('/agent/mode', (req, res) => {
  if (!agentLoop) return res.json({ success: false, message: 'Bot not connected' });

  const mode = String(req.body?.mode ?? '').toUpperCase() as BehaviorMode;
  const allowedModes: BehaviorMode[] = ['PASSIVE', 'HELPER', 'EXPLORER', 'BUILDER', 'DEFENDER'];
  if (!allowedModes.includes(mode)) {
    return res.json({ success: false, message: `Invalid mode. Use one of: ${allowedModes.join(', ')}` });
  }

  agentLoop.setBehaviorMode(mode);
  res.json({ success: true, message: `Mode set to ${mode}`, data: { mode } });
});

app.get('/memory', (_req, res) => {
  res.json({ success: true, data: agentLoop?.getMemorySnapshot() ?? memory.getState() });
});

app.post('/memory/note', (req, res) => {
  const note = String(req.body?.note ?? '').trim();
  if (!note) return res.json({ success: false, message: 'Missing note' });
  if (agentLoop) {
    agentLoop.addMemoryNote(note);
  } else {
    memory.addNote(note);
  }
  res.json({ success: true, message: 'Note saved' });
});

// ─── Static dashboard ───
// NOTE: Web UI removed — everything is CLI/API based.

// Root endpoint — no dashboard, just info
app.get('/', (_req, res) => {
  res.json({
    name: 'Hermes the Miner Bridge',
    description: 'Open-to-LAN Minecraft bot controlled via Hermes CLI',
    endpoints: {
      health: 'GET /health',
      connect: 'POST /connect',
      disconnect: 'POST /disconnect',
      perceive: 'GET /perceive',
      action: 'POST /action',
      chat: 'POST /chat',
      model: 'GET /model',
      memory: 'GET /memory',
      agentStart: 'POST /agent/start',
      agentStop: 'POST /agent/stop',
      agentGoal: 'GET/POST/DELETE /agent/goal',
      agentMode: 'GET/POST /agent/mode',
    },
    cli: 'Use bridge-ctl.sh or load skill: hermes -s hermes-minecraft-agent',
  });
});

// ─── WebSocket server ───

const wss = new WebSocketServer({ port: WS_PORT });

wss.on('error', (err) => {
  console.error(`[WS ERROR] ${err.message}`);
});

wss.on('connection', (ws) => {
  wsClients.add(ws);

  ws.on('close', () => wsClients.delete(ws));

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'action' && actions) {
        const handler = (actions as any)[msg.action];
        if (typeof handler === 'function') {
          const result = await handler.call(actions, ...Object.values(msg.params ?? {}));
          ws.send(JSON.stringify({ type: 'action_result', requestId: msg.requestId, ...result }));
        }
      }
    } catch { /* ignore invalid messages */ }
  });
});

// ─── Start ───

app.listen(API_PORT, () => {
  console.log('');
  console.log('  ╭ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ╮');
  console.log('  │  Hermes the Miner — Bridge Server                            │');
  console.log('  ├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤');
  console.log(`  │  REST API:    http://localhost:${API_PORT}`);
  console.log(`  │  WebSocket:   ws://localhost:${WS_PORT}`);
  console.log('  ╰ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ╯');
  console.log('');
  console.log('  Endpoints:');
  console.log('    POST /connect    — connect to Minecraft server');
  console.log('    POST /disconnect — disconnect bot');
  console.log('    GET  /perceive   — world snapshot');
  console.log('    POST /action     — execute action');
  console.log('    GET  /model      — current model + providers');
  console.log('    POST /model      — switch model');
  console.log('    POST /agent/start — start autonomous loop');
  console.log('    POST /agent/stop  — stop autonomous loop');
  console.log('    GET  /memory      — persistent Hermes memory');
  console.log('    GET/POST /agent/mode — inspect or set behavior mode');
  console.log('    GET/POST/DELETE /agent/goal — inspect or manage current goal');
  console.log('');
});
