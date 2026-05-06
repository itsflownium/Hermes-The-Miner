import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentLoop } from '../src/agent-loop.js';

type RecordedAction = { type: string; params: Record<string, any> };

function buildSnapshot(playerNames: string[] = ['Flownium'], nearbyBlocks: { name: string; distance: number }[] = []) {
  return {
    position: { x: 0, y: 64, z: 0 },
    health: 20,
    food: 20,
    inventory: [],
    nearbyEntities: playerNames.map((name, index) => ({
      name,
      type: 'player',
      distance: 3 + index,
      position: { x: 3 + index, y: 64, z: 3 + index },
    })),
    nearbyBlocks: nearbyBlocks.map((block, index) => ({
      name: block.name,
      distance: block.distance,
      position: { x: 4 + index, y: 64, z: 4 + index },
    })),
    biome: 'plains',
    time: '12:00 (day)',
    weather: 'clear',
    lightLevel: 15,
  };
}

function createHarness(options?: {
  activeGoal?: any;
  playerNames?: string[];
  memoryPlayers?: Record<string, any>;
  snapshot?: any;
  execute?: (type: string, params: Record<string, any>) => Promise<{ success: boolean; message: string }>;
}) {
  const chats: string[] = [];
  const actions: RecordedAction[] = [];
  const playerNames = options?.playerNames ?? ['Flownium'];

  const players = Object.fromEntries(
    playerNames.map((name, index) => [
      name,
      {
        username: name,
        entity: {
          position: { x: 3 + index, y: 64, z: 3 + index },
        },
      },
    ]),
  );

  const defaultMemoryPlayers = Object.fromEntries(
    playerNames.map((name, index) => [
      name.toLowerCase(),
      {
        username: name,
        firstSeenAt: 1,
        lastSeenAt: 1,
        lastSeenPosition: { x: 3 + index, y: 64, z: 3 + index },
        interactions: 1,
        notes: [],
      },
    ]),
  );

  const memoryState = {
    activeGoal: options?.activeGoal ?? null,
    clearedWith: null as string | null,
    failedWith: null as string | null,
    players: { ...defaultMemoryPlayers, ...(options?.memoryPlayers ?? {}) },
  };

  const mc = {
    username: 'Hermes',
    players,
    chat(message: string) {
      chats.push(message);
    },
  };

  const loop = new AgentLoop(
    { getSnapshot: () => options?.snapshot ?? null } as any,
    {
      getBot: () => ({
        getBot: () => mc,
      }),
      stop: async () => ({ success: true, message: 'stopped' }),
      execute: async (type: string, params: Record<string, any>) => {
        actions.push({ type, params });
        return options?.execute
          ? options.execute(type, params)
          : { success: true, message: `${type} ok` };
      },
      countItem: () => 0,
      countResource: () => 0,
    } as any,
    {
      getCurrentModel: () => ({ display: 'Test Model' }),
    } as any,
    {
      rememberChat: () => {},
      rememberPlayerSeen: (username: string, position?: { x: number; y: number; z: number }) => {
        memoryState.players[username.toLowerCase()] = {
          ...(memoryState.players[username.toLowerCase()] ?? {
            username,
            firstSeenAt: 1,
            interactions: 0,
            notes: [],
          }),
          username,
          lastSeenAt: Date.now(),
          lastSeenPosition: position,
        };
      },
      addPlayerNote: () => {},
      rememberRequest: () => {},
      addEvent: () => {},
      addNote: () => {},
      getState: () => ({ activeGoal: memoryState.activeGoal, players: memoryState.players }),
      getPromptContext: () => 'none',
      getKnownPlayers: () => Object.values(memoryState.players).map((player: any) => player.username),
      getActiveGoal: () => memoryState.activeGoal,
      setActiveGoal: (goal: any) => {
        memoryState.activeGoal = { ...goal, id: 'goal-1', status: 'active', createdAt: 1, updatedAt: 1 };
        return memoryState.activeGoal;
      },
      clearGoal: (summary: string) => {
        memoryState.clearedWith = summary;
        memoryState.activeGoal = null;
      },
      completeGoal: () => {
        memoryState.activeGoal = null;
      },
      failGoal: (summary: string) => {
        memoryState.failedWith = summary;
        memoryState.activeGoal = null;
      },
      updateGoal: () => memoryState.activeGoal,
    } as any,
    () => {},
  );

  (loop as any).callHermes = async () => null;

  return { loop, chats, actions, memoryState };
}

test('greets nearby player quickly without needing Hermes in every message', async () => {
  const { loop, chats, actions } = createHarness();

  await loop.handleChat('Flownium', 'hi');

  assert.equal(actions.length, 0);
  assert.equal(chats.at(-1), 'Hey Flownium. Need a hand?');
});

test('ignores unaddressed small talk when multiple players are nearby', async () => {
  const { loop, chats, actions } = createHarness({ playerNames: ['Flownium', 'Alex'] });

  await loop.handleChat('Flownium', 'hi');

  assert.equal(actions.length, 0);
  assert.equal(chats.length, 0);
});

test('stop following me clears the current goal and issues a stop action', async () => {
  const { loop, chats, actions, memoryState } = createHarness({
    activeGoal: {
      id: 'goal-1',
      summary: 'Stay near Flownium and help them.',
      kind: 'follow',
      requestedBy: 'Flownium',
      targetPlayer: 'Flownium',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    },
  });

  await loop.handleChat('Flownium', 'hermes stop following me');

  assert.deepEqual(actions[0], { type: 'stop', params: {} });
  assert.equal(memoryState.clearedWith, 'Player asked Hermes to stop');
  assert.equal(chats.at(-1), "Okay Flownium, I'll stay put for a bit.");
});

test('stop following me keeps Hermes from immediately refollowing on the next fallback tick', async () => {
  const { loop } = createHarness({
    activeGoal: {
      id: 'goal-1',
      summary: 'Stay near Flownium and help them.',
      kind: 'follow',
      requestedBy: 'Flownium',
      targetPlayer: 'Flownium',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    },
  });

  await loop.handleChat('Flownium', 'hermes stop following me');

  const plan = (loop as any).fallbackPlan(buildSnapshot(['Flownium']));
  assert.equal(plan, null);
});

test('kill me maps to attacking the speaker instead of ignoring the command', async () => {
  const { loop, actions } = createHarness();

  await loop.handleChat('Flownium', 'hermes try kill me');

  assert.deepEqual(actions[0], { type: 'attack', params: { entityName: 'Flownium' } });
});

test('plain attack command falls back to defend instead of getting stuck on the old goal', async () => {
  const { loop, actions } = createHarness({
    activeGoal: {
      id: 'goal-1',
      summary: 'Gather some cobweb for Flownium.',
      kind: 'gather',
      requestedBy: 'Flownium',
      resourceName: 'cobweb',
      targetCount: 16,
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    },
  });

  await loop.handleChat('Flownium', 'hermes attack');

  assert.deepEqual(actions[0], { type: 'defend', params: { range: 10 } });
});

test('go mine wood is parsed as a collect-resource command', async () => {
  const { loop, actions, memoryState } = createHarness();

  await loop.handleChat('Flownium', 'hermes go mine wood');

  assert.deepEqual(actions[0], { type: 'collectResource', params: { resourceName: 'wood', targetCount: 1 } });
  assert.equal(memoryState.activeGoal?.kind, 'gather');
  assert.equal(memoryState.activeGoal?.resourceName, 'wood');
});

test('polite mine request is parsed without needing exact phrasing', async () => {
  const { loop, actions, memoryState } = createHarness();

  await loop.handleChat('Flownium', 'hermes can you mine some wood');

  assert.deepEqual(actions[0], { type: 'collectResource', params: { resourceName: 'wood', targetCount: 4 } });
  assert.equal(memoryState.activeGoal?.kind, 'gather');
  assert.equal(memoryState.activeGoal?.resourceName, 'wood');
  assert.equal(memoryState.activeGoal?.targetCount, 4);
});

test('yes plus a real request is treated as a command instead of small talk', async () => {
  const { loop, actions, memoryState } = createHarness();

  await loop.handleChat('Flownium', 'yes can you mine some wood for me');

  assert.deepEqual(actions[0], { type: 'collectResource', params: { resourceName: 'wood', targetCount: 4 } });
  assert.equal(memoryState.activeGoal?.resourceName, 'wood');
  assert.equal(memoryState.activeGoal?.targetCount, 4);
});

test('mine this wood is parsed as a visible nearby gather request', async () => {
  const { loop, actions } = createHarness();

  await loop.handleChat('Flownium', 'hermes can you mine this wood');

  assert.deepEqual(actions[0], { type: 'collectResource', params: { resourceName: 'wood', targetCount: 1 } });
});

test('get me wood strips the indirect object from the resource name', async () => {
  const { loop, actions, memoryState } = createHarness();

  await loop.handleChat('Flownium', 'hermes get me wood');

  assert.deepEqual(actions[0], { type: 'collectResource', params: { resourceName: 'wood', targetCount: 1 } });
  assert.equal(memoryState.activeGoal?.resourceName, 'wood');
});

test('get me 2 oak logs extracts both the count and the singularized block name', async () => {
  const { loop, actions, memoryState } = createHarness();

  await loop.handleChat('Flownium', 'hermes get me 2 oak logs');

  assert.deepEqual(actions[0], { type: 'collectResource', params: { resourceName: 'oak_log', targetCount: 2 } });
  assert.equal(memoryState.activeGoal?.resourceName, 'oak_log');
  assert.equal(memoryState.activeGoal?.targetCount, 2);
});

test('oak wood requests resolve to oak logs so mining can target tree trunks', async () => {
  const { loop, actions, memoryState } = createHarness();

  await loop.handleChat('Flownium', 'hermes can you go mine some oak wood for me');

  assert.deepEqual(actions[0], { type: 'collectResource', params: { resourceName: 'oak_log', targetCount: 4 } });
  assert.equal(memoryState.activeGoal?.resourceName, 'oak_log');
  assert.equal(memoryState.activeGoal?.targetCount, 4);
});

test('common acacia typo still resolves to acacia logs', async () => {
  const { loop, actions, memoryState } = createHarness();

  await loop.handleChat('Flownium', 'hermes mine 2 acasia wood');

  assert.deepEqual(actions[0], { type: 'collectResource', params: { resourceName: 'acacia_log', targetCount: 2 } });
  assert.equal(memoryState.activeGoal?.resourceName, 'acacia_log');
  assert.equal(memoryState.activeGoal?.targetCount, 2);
});

test('mine the item in front of you targets the cursor block instead of a fake resource', async () => {
  const { loop, actions } = createHarness();

  await loop.handleChat('Flownium', 'hermes mine the item infront of you');

  assert.deepEqual(actions[0], { type: 'mineCursorBlock', params: {} });
});

test('cobblestone generator requests use the generator miner instead of a fake resource name', async () => {
  const { loop, actions } = createHarness();

  await loop.handleChat('Flownium', 'hermes mine cobblestone generator');

  assert.deepEqual(actions[0], { type: 'mineCobbleGen', params: { continuous: true, cycles: 64, playerName: 'Flownium' } });
});

test('cobblestone generator requests tolerate common cobblestone typos', async () => {
  const { loop, actions } = createHarness();

  await loop.handleChat('Flownium', 'hermes mine cobblstone generator');

  assert.deepEqual(actions[0], { type: 'mineCobbleGen', params: { continuous: true, cycles: 64, playerName: 'Flownium' } });
});

test('drop me dirt is parsed as giving dirt to the speaker', async () => {
  const { loop, actions } = createHarness();

  await loop.handleChat('Flownium', 'hermes drop me dirt');

  assert.deepEqual(actions[0], { type: 'giveAll', params: { itemName: 'dirt', playerName: 'Flownium' } });
});

test('drop wood without the indirect object still gives the resource to the speaker', async () => {
  const { loop, actions } = createHarness();

  await loop.handleChat('Flownium', 'hermes drop the wood');

  assert.deepEqual(actions[0], { type: 'giveAll', params: { itemName: 'wood', playerName: 'Flownium' } });
});

test('drop command strips repeated filler words and common cobblestone typos', async () => {
  const { loop, actions } = createHarness();

  await loop.handleChat('Flownium', 'hermes drop the the cobbletsone');

  assert.deepEqual(actions[0], { type: 'giveAll', params: { itemName: 'cobblestone', playerName: 'Flownium' } });
});

test('craft request is parsed with count and natural phrasing', async () => {
  const { loop, actions, memoryState } = createHarness();

  await loop.handleChat('Flownium', 'hermes can you craft 4 torches for me');

  assert.deepEqual(actions[0], { type: 'craft', params: { recipeName: 'torch', count: 4 } });
  assert.equal(memoryState.activeGoal?.kind, 'general');
  assert.match(String(memoryState.activeGoal?.summary), /Craft 4 torch for Flownium/i);
});

test('make me a crafting table maps to the crafting table recipe', async () => {
  const { loop, actions, memoryState } = createHarness();

  await loop.handleChat('Flownium', 'hermes make me a crafting table');

  assert.deepEqual(actions[0], { type: 'craft', params: { recipeName: 'crafting_table', count: 1 } });
  assert.equal(memoryState.activeGoal?.kind, 'general');
});

test('craft request strips material-source wording from the recipe name', async () => {
  const { loop, actions, memoryState } = createHarness();

  await loop.handleChat('Flownium', 'hermes make a wooden pickaxe with the materials i gave you');

  assert.deepEqual(actions[0], { type: 'craft', params: { recipeName: 'wooden_pickaxe', count: 1 } });
  assert.equal(memoryState.activeGoal?.kind, 'general');
});

test('place a crafting table is parsed as a direct placement command', async () => {
  const { loop, actions } = createHarness();

  await loop.handleChat('Flownium', 'hermes place a crafting table');

  assert.deepEqual(actions[0], { type: 'placeCraftingTable', params: {} });
});

test('cancelling an older job with a newer command does not emit a stale apology', async () => {
  let resolveFirst: ((result: { success: boolean; message: string }) => void) | null = null;
  const { loop, chats } = createHarness({
    execute: async (type: string) => {
      if (type === 'collectResource') {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return { success: true, message: 'Gave 3x wood to Flownium' };
    },
  });

  const first = loop.handleChat('Flownium', 'hermes mine wood');
  await new Promise(resolve => setTimeout(resolve, 300));
  const second = loop.handleChat('Flownium', 'hermes drop wood');
  await new Promise(resolve => setTimeout(resolve, 0));
  resolveFirst?.({ success: false, message: 'Stopped that job.' });

  await Promise.all([first, second]);

  assert.equal(chats.some(message => /Stopped that job/i.test(message)), false);
  assert.equal(chats.includes('Here you go, Flownium.'), true);
});

test('gather fallback uses collectResource so work stays interruptible', () => {
  const { loop } = createHarness({
    activeGoal: {
      id: 'goal-1',
      summary: 'Gather 8 wood for Flownium.',
      kind: 'gather',
      requestedBy: 'Flownium',
      resourceName: 'wood',
      targetCount: 8,
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    },
  });

  const plan = (loop as any).fallbackPlan(buildSnapshot(['Flownium']));
  assert.deepEqual(plan, {
    type: 'collectResource',
    params: { resourceName: 'wood', targetCount: 8 },
  });
});

test('without an active goal Hermes stays put instead of following or exploring on fallback', () => {
  const { loop } = createHarness();

  const plan = (loop as any).fallbackPlan(buildSnapshot(['Flownium']));
  assert.equal(plan, null);
});

test('tick does not execute autonomous movement when there is no active goal', async () => {
  const snapshot = buildSnapshot(['Flownium']);
  const { loop, actions } = createHarness({ snapshot });

  (loop as any).running = true;
  await (loop as any).tick();

  assert.equal(actions.length, 0);
  assert.equal((loop as any).lastAction, 'idle');
});

test('stale follow goals expire if Hermes loses track of the player for too long', () => {
  const staleAt = Date.now() - 60000;
  const { loop, memoryState } = createHarness({
    activeGoal: {
      id: 'goal-1',
      summary: 'Stay near Flownium and help them.',
      kind: 'follow',
      requestedBy: 'Flownium',
      targetPlayer: 'Flownium',
      status: 'active',
      createdAt: staleAt,
      updatedAt: staleAt,
    },
    memoryPlayers: {
      flownium: {
        username: 'Flownium',
        firstSeenAt: staleAt,
        lastSeenAt: staleAt,
        lastSeenPosition: { x: 20, y: 64, z: 20 },
        interactions: 1,
        notes: [],
      },
    },
  });

  const expired = (loop as any).maybeExpireStaleGoal(buildSnapshot([]));

  assert.equal(expired, true);
  assert.equal(memoryState.activeGoal, null);
  assert.equal(memoryState.failedWith, 'Lost track of Flownium');
});
