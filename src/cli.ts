#!/usr/bin/env node
import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_PORT = process.env.BRIDGE_API_PORT ?? '3847';
const API_URL = `http://localhost:${API_PORT}`;
const PID_FILE = join(homedir(), '.hermes', 'hermes-mc-bridge.pid');
const PROJECT_ROOT = join(__dirname, '..');
const LOG_FILE = join(PROJECT_ROOT, 'bridge.log');

const COMMANDS = `
  hermes-mc start                  Start the bridge daemon
  hermes-mc stop                   Stop the bridge daemon
  hermes-mc status                 Show bridge + bot status
  hermes-mc connect <host> [port]         Connect Hermes to a server
  hermes-mc disconnect             Disconnect bot
  hermes-mc say <message>          Send chat message
  hermes-mc action <type> [args]   Execute action (see below)
  hermes-mc agent start|stop       Start/stop autonomous agent
  hermes-mc mode [MODE]            Show or set behavior mode
  hermes-mc goal [text]            Show or set the current goal
  hermes-mc goal clear             Clear the current goal
  hermes-mc memory                 Show persistent memory summary
  hermes-mc model                  Show current AI model
  hermes-mc model set <provider> <model>  Switch AI model
  hermes-mc logs                   Show bridge logs
  hermes-mc help                   Show this help

Actions:
  moveTo <x> <y> <z>      Walk to coordinates
  follow <player>          Follow a player
  dig <x> <y> <z>          Break block
  placeBlock <x> <y> <z>   Place held block
  attack <entity>          Attack entity
  defend [range]           Attack hostile mobs
  equip <item> [slot]      Equip item
  toss <item> [count]      Drop items
  eat <food>               Eat food
  jump                     Jump
  sneak on|off             Toggle sneak
  useHeldItem              Right-click with held item
  craft <item> [count]     Craft item
  stop                     Stop all movement
`;

// ——— Helpers ———

function api(method: string, path: string, body?: object): any {
  const url = `${API_URL}${path}`;
  try {
  const opts = {
    encoding: 'utf-8' as const,
    timeout: 10000,
    stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
  };
    let cmd: string;
    if (method === 'GET') {
      cmd = `curl -s -X GET "${url}"`;
    } else {
      const json = JSON.stringify(body ?? {});
      cmd = `curl -s -X ${method} "${url}" -H "Content-Type: application/json" -d '${json}'`;
    }
    const out = execSync(cmd, opts);
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function isDaemonRunning(): boolean {
  try {
    if (!existsSync(PID_FILE)) return false;
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim());
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startDaemon(): void {
  const daemonRunning = isDaemonRunning();
  const health = api('GET', '/health');
  if (daemonRunning || health) {
    console.log(daemonRunning
      ? '✗ Bridge daemon is already running'
      : `✗ Bridge API is already reachable at ${API_URL}`);
    return;
  }

  try {
    execSync('npm run build', {
      cwd: join(__dirname, '..'),
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (err: any) {
    console.log(`✗ Bridge build failed: ${err.message}`);
    return;
  }

  const bridgeScript = join(__dirname, 'index.js');
  const proc = spawn('node', [bridgeScript], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  proc.unref();

  // Write PID synchronously
  try {
    writeFileSync(PID_FILE, String(proc.pid ?? ''), 'utf-8');
  } catch { /* ignore */ }

  console.log(`✓ Bridge daemon started (PID: ${proc.pid})`);
  console.log(`  API:    http://localhost:${API_PORT}`);
  console.log(`  WS:     ws://localhost:${parseInt(API_PORT) + 1}`);
}

function stopDaemon(): void {
  if (!isDaemonRunning()) {
    console.log(api('GET', '/health')
      ? '✗ Bridge API is running, but not as a CLI-managed daemon'
      : '✗ Bridge daemon is not running');
    return;
  }

  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim());
    process.kill(pid, 'SIGTERM');
    console.log(`✓ Bridge daemon stopped (PID: ${pid})`);
  } catch (err: any) {
    console.log(`✗ Failed to stop daemon: ${err.message}`);
  }
}

export function formatStatusLines(
  daemonRunning: boolean,
  health: any,
  model: any,
  status: any,
): string[] {
  if (!health) {
    return ['Bridge: not running'];
  }

  const lines = [
    `Bridge: ${daemonRunning ? 'running (daemon)' : 'running (external)'}`,
    `  Connected: ${health.connected}`,
    `  Uptime:    ${Math.round(health.uptime)}s`,
    `  Agent:     ${health.agentRunning ? 'running' : 'stopped'}`,
  ];

  if (model?.success) {
    lines.push(`  Model:     ${model.display}`);
    lines.push(`  Provider:  ${model.provider}`);
  }
  if (status?.success) {
    lines.push(`  Mode:      ${status.data.behaviorMode}`);
    lines.push(`  Goal:      ${status.data.activeGoal?.summary ?? 'none'}`);
  }

  return lines;
}

function showStatus(): void {
  const daemonRunning = isDaemonRunning();
  const health = api('GET', '/health');
  const model = api('GET', '/model');
  const status = api('GET', '/agent/status');

  for (const line of formatStatusLines(daemonRunning, health, model, status)) {
    console.log(line);
  }
}

function showModel(): void {
  const data = api('GET', '/model');
  if (!data?.success) {
    console.log('Failed to fetch model info. Is the bridge running?');
    return;
  }

  console.log(`Current model: ${data.display}`);
  console.log(`Provider:      ${data.provider}`);
  console.log(`Available:     ${data.available ? 'yes' : 'no'}`);
  console.log('');
  console.log('Available providers:');
  for (const p of (data.providers ?? [])) {
    const marker = p.available ? '✓' : '✗';
    console.log(`  ${marker} ${p.id.padEnd(18)} ${p.name}`);
  }
}

function setModel(provider: string, model: string): void {
  const result = api('POST', '/model', { provider, model });
  if (result?.success) {
    console.log(`✓ Switched to ${model} via ${provider}`);
  } else {
    console.log(`✗ Failed: ${result?.message ?? 'unknown error'}`);
  }
}

function connectBot(host: string, port?: string): void {
  const result = api('POST', '/connect', {
    host,
    port: port ? parseInt(port) : 25565,
    username: 'Hermes',
    auth: 'offline',
  });
  if (result?.success) {
    console.log(`✓ ${result.message}`);
  } else {
    console.log(`✗ ${result?.message ?? 'Connection failed'}`);
  }
}

function disconnectBot(): void {
  const result = api('POST', '/disconnect');
  console.log(result?.success ? '✓ Disconnected' : `✗ ${result?.message ?? 'Failed'}`);
}

function sendChat(message: string): void {
  const result = api('POST', '/action', { type: 'say', params: { message } });
  console.log(result?.success ? `✓ ${result.message}` : `✗ ${result?.message ?? 'Failed'}`);
}

function runAgent(cmd: string): void {
  const result = api('POST', cmd === 'start' ? '/agent/start' : '/agent/stop');
  console.log(result?.success ? `✓ ${result.message}` : `✗ ${result?.message ?? 'Failed'}`);
}

function showOrSetMode(nextMode?: string): void {
  if (!nextMode) {
    const result = api('GET', '/agent/mode');
    if (!result?.success) {
      console.log('✗ Failed to fetch current mode');
      return;
    }
    console.log(`Current mode: ${result.data.current}`);
    console.log(`Available:    ${result.data.available.join(', ')}`);
    return;
  }

  const result = api('POST', '/agent/mode', { mode: nextMode.toUpperCase() });
  console.log(result?.success ? `✓ ${result.message}` : `✗ ${result?.message ?? 'Failed'}`);
}

function showOrSetGoal(args: string[]): void {
  if (args[0] === 'clear') {
    const result = api('DELETE', '/agent/goal');
    console.log(result?.success ? `✓ ${result.message}` : `✗ ${result?.message ?? 'Failed'}`);
    return;
  }

  if (args.length === 0) {
    const result = api('GET', '/agent/goal');
    if (!result?.success) {
      console.log('✗ Failed to fetch current goal');
      return;
    }
    console.log(result.data?.summary ?? 'No active goal');
    return;
  }

  const summary = args.join(' ');
  const result = api('POST', '/agent/goal', { summary, kind: 'general' });
  console.log(result?.success ? `✓ ${result.message}: ${result.data.summary}` : `✗ ${result?.message ?? 'Failed'}`);
}

function showMemory(): void {
  const result = api('GET', '/memory');
  if (!result?.success) {
    console.log('✗ Failed to fetch memory');
    return;
  }

  const data = result.data;
  console.log(`Goal: ${data.activeGoal?.summary ?? 'none'}`);
  const players = Object.values(data.players ?? {}) as Array<{ username: string; interactions: number; lastRequest?: string }>;
  if (players.length === 0) {
    console.log('Players: none yet');
  } else {
    console.log('Players:');
    for (const player of players.slice(0, 8)) {
      console.log(`  - ${player.username} (${player.interactions} interactions)${player.lastRequest ? ` — ${player.lastRequest}` : ''}`);
    }
  }
  const events = (data.events ?? []) as Array<{ summary: string }>;
  if (events.length > 0) {
    console.log('Recent events:');
    for (const event of events.slice(0, 5)) {
      console.log(`  - ${event.summary}`);
    }
  }
}

function runAction(args: string[]): void {
  const type = args[0];
  const params: Record<string, any> = {};

  // Parse positional args based on action type
  switch (type) {
    case 'moveTo':
    case 'pathfindTo':
    case 'dig':
    case 'placeBlock':
      params.x = parseInt(args[1]);
      params.y = parseInt(args[2]);
      params.z = parseInt(args[3]);
      break;
    case 'follow':
    case 'attack':
      params.entityName = args[1];
      break;
    case 'equip':
      params.itemName = args[1];
      params.slot = args[2] || 'hand';
      break;
    case 'toss':
      params.itemName = args[1];
      params.count = parseInt(args[2] || '1');
      break;
    case 'eat':
      params.foodName = args[1];
      break;
    case 'say':
      params.message = args.slice(1).join(' ');
      break;
    case 'craft':
      params.recipeName = args[1];
      params.count = parseInt(args[2] || '1');
      break;
    case 'smelt':
      params.itemName = args[1];
      params.fuelName = args[2];
      params.count = parseInt(args[3] || '1');
      break;
    case 'defend':
      params.range = parseInt(args[1] || '16');
      break;
    case 'sneak':
      params.toggle = args[1] === 'on';
      break;
    case 'stop':
    case 'jump':
    case 'useHeldItem':
      break;
    default:
      // Try generic param mapping
      for (let i = 1; i < args.length; i++) {
        const key = ['x', 'y', 'z', 'count', 'range'][i - 1] ?? `param${i}`;
        const num = parseInt(args[i]);
        params[key] = isNaN(num) ? args[i] : num;
      }
  }

  const result = api('POST', '/action', { type, params });
  console.log(result?.success ? `✓ ${result.message}` : `✗ ${result?.message ?? 'Failed'}`);
}

function showLogs(): void {
  try {
    const log = execSync(`tail -n 50 "${LOG_FILE}" 2>/dev/null || echo "No logs found"`, { encoding: 'utf-8' });
    console.log(log);
  } catch {
    console.log('No logs available');
  }
}

// ——— Main ———

const args = process.argv.slice(2);
const cmd = args[0] ?? 'help';

switch (cmd) {
  case 'start':
    startDaemon();
    break;
  case 'stop':
    stopDaemon();
    break;
  case 'status':
    showStatus();
    break;
  case 'connect':
    connectBot(args[1], args[2]);
    break;
  case 'disconnect':
    disconnectBot();
    break;
  case 'say':
    sendChat(args.slice(1).join(' '));
    break;
  case 'action':
    runAction(args.slice(1));
    break;
  case 'agent':
    runAgent(args[1]);
    break;
  case 'mode':
    showOrSetMode(args[1]);
    break;
  case 'goal':
    showOrSetGoal(args.slice(1));
    break;
  case 'memory':
    showMemory();
    break;
  case 'model':
    if (args[1] === 'set' && args[2] && args[3]) {
      setModel(args[2], args[3]);
    } else {
      showModel();
    }
    break;
  case 'logs':
    showLogs();
    break;
  case 'help':
  case '-h':
  case '--help':
  default:
    console.log('Hermes the Miner — CLI');
    console.log(COMMANDS);
}
