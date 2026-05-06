import assert from 'node:assert/strict';
import test from 'node:test';
import { Vec3 } from 'vec3';
import { Actions } from '../src/actions.js';

function createActionsHarness() {
  const blocks = new Map<string, any>();
  let digReject: ((err: Error) => void) | null = null;
  let inventoryItems: any[] = [];
  let loadPluginCount = 0;
  const pathfinderGoals: any[][] = [];
  const itemDefs: Record<string, { id: number }> = {
    oak_log: { id: 7 },
    acacia_log: { id: 8 },
    cherry_log: { id: 9 },
    oak_planks: { id: 36 },
    cherry_planks: { id: 37 },
    stick: { id: 844 },
    crafting_table: { id: 299 },
    wooden_pickaxe: { id: 816 },
    diamond: { id: 801 },
    diamond_sword: { id: 834 },
    coal: { id: 799 },
    torch: { id: 290 },
    cobblestone: { id: 1200 },
    dirt: { id: 1201 },
  };
  const itemsById = Object.fromEntries(
    Object.entries(itemDefs).map(([name, item]) => [item.id, { id: item.id, name }]),
  );
  const recipeMap: Record<number, any[]> = {
    [itemDefs.oak_planks.id]: [{
      result: { id: itemDefs.oak_planks.id, count: 4 },
      delta: [
        { id: itemDefs.oak_log.id, metadata: null, count: -1 },
        { id: itemDefs.oak_planks.id, metadata: null, count: 4 },
      ],
      requiresTable: false,
    }],
    [itemDefs.cherry_planks.id]: [{
      result: { id: itemDefs.cherry_planks.id, count: 4 },
      delta: [
        { id: itemDefs.cherry_log.id, metadata: null, count: -1 },
        { id: itemDefs.cherry_planks.id, metadata: null, count: 4 },
      ],
      requiresTable: false,
    }],
    [itemDefs.stick.id]: [{
      result: { id: itemDefs.stick.id, count: 4 },
      delta: [
        { id: itemDefs.oak_planks.id, metadata: null, count: -2 },
        { id: itemDefs.stick.id, metadata: null, count: 4 },
      ],
      requiresTable: false,
    }],
    [itemDefs.crafting_table.id]: [{
      result: { id: itemDefs.crafting_table.id, count: 1 },
      delta: [
        { id: itemDefs.oak_planks.id, metadata: null, count: -4 },
        { id: itemDefs.crafting_table.id, metadata: null, count: 1 },
      ],
      requiresTable: false,
    }],
    [itemDefs.wooden_pickaxe.id]: [
      {
        result: { id: itemDefs.wooden_pickaxe.id, count: 1 },
        delta: [
          { id: itemDefs.cherry_planks.id, metadata: null, count: -3 },
          { id: itemDefs.stick.id, metadata: null, count: -2 },
          { id: itemDefs.wooden_pickaxe.id, metadata: null, count: 1 },
        ],
        requiresTable: true,
      },
      {
        result: { id: itemDefs.wooden_pickaxe.id, count: 1 },
        delta: [
          { id: itemDefs.oak_planks.id, metadata: null, count: -3 },
          { id: itemDefs.stick.id, metadata: null, count: -2 },
          { id: itemDefs.wooden_pickaxe.id, metadata: null, count: 1 },
        ],
        requiresTable: true,
      },
    ],
    [itemDefs.diamond_sword.id]: [{
      result: { id: itemDefs.diamond_sword.id, count: 1 },
      delta: [
        { id: itemDefs.diamond.id, metadata: null, count: -2 },
        { id: itemDefs.stick.id, metadata: null, count: -1 },
        { id: itemDefs.diamond_sword.id, metadata: null, count: 1 },
      ],
      requiresTable: true,
    }],
    [itemDefs.torch.id]: [{
      result: { id: itemDefs.torch.id, count: 4 },
      delta: [
        { id: itemDefs.coal.id, metadata: null, count: -1 },
        { id: itemDefs.stick.id, metadata: null, count: -1 },
        { id: itemDefs.torch.id, metadata: null, count: 4 },
      ],
      requiresTable: false,
    }],
  };

  const keyFor = (position: Vec3) => `${position.x},${position.y},${position.z}`;
  const countInventoryById = (itemId: number, metadata: number | null = null) =>
    inventoryItems
      .filter(item => item.type === itemId && (metadata == null || item.metadata == null || item.metadata === metadata))
      .reduce((sum, item) => sum + item.count, 0);
  const addInventoryById = (itemId: number, count: number) => {
    if (count <= 0) return;
    const existing = inventoryItems.find(item => item.type === itemId);
    if (existing) {
      existing.count += count;
      return;
    }
    inventoryItems.push({
      name: itemsById[itemId]?.name ?? `item_${itemId}`,
      count,
      type: itemId,
      metadata: null,
    });
  };
  const removeInventoryById = (itemId: number, count: number) => {
    let remaining = count;
    for (const item of inventoryItems.filter(entry => entry.type === itemId)) {
      if (remaining <= 0) break;
      const consumed = Math.min(item.count, remaining);
      item.count -= consumed;
      remaining -= consumed;
    }
    inventoryItems = inventoryItems.filter(item => item.count > 0);
  };

  const mc = {
    entity: {
      position: new Vec3(0, 64, 0),
      yaw: 0,
      distanceTo(target: Vec3) {
        return this.position.distanceTo(target);
      },
    },
    entities: {},
    players: {},
    registry: {
      blocksByName: {
        oak_log: { id: 1 },
        cherry_log: { id: 9 },
        stone: { id: 2 },
        cobblestone: { id: 3 },
        oak_leaves: { id: 4 },
        crafting_table: { id: 5 },
        dirt: { id: 6 },
        water: { id: 7 },
        lava: { id: 8 },
      },
      itemsByName: itemDefs,
      items: itemsById,
    },
    inventory: {
      items: () => inventoryItems,
      count: countInventoryById,
    },
    heldItem: null as any,
    pathfinder: {
      setGoal: (...args: any[]) => {
        pathfinderGoals.push(args);
      },
      setMovements: () => {},
    },
    loadPlugin: () => {
      loadPluginCount += 1;
      if (!mc.pathfinder) {
        mc.pathfinder = {
          setGoal: (...args: any[]) => {
            pathfinderGoals.push(args);
          },
          setMovements: () => {},
        };
      }
    },
    findBlocks: () => [],
    blockAtCursor: () => null,
    blockAt: (position: Vec3) => blocks.get(keyFor(position)) ?? null,
    world: {
      getBlock: (position: Vec3) => blocks.get(keyFor(position)) ?? null,
    },
    canSeeBlock: (block: any) => block.visible !== false,
    clearControlStates: () => {},
    stopDigging: () => {
      digReject?.(new Error('Digging aborted'));
    },
    lookAt: async () => {},
    equip: async (item: any) => {
      mc.heldItem = item;
    },
    recipesAll: (itemId: number, _meta: any, craftingTable: any) =>
      (recipeMap[itemId] ?? []).filter(recipe => !recipe.requiresTable || Boolean(craftingTable)),
    recipesFor: (itemId: number, _meta: any, minResultCount: number, craftingTable: any) =>
      (recipeMap[itemId] ?? []).filter((recipe) => {
        if (recipe.requiresTable && !craftingTable) return false;
        const operations = Math.max(1, Math.ceil((minResultCount ?? 1) / (recipe.result?.count ?? 1)));
        return recipe.delta
          .filter((delta: any) => delta.count < 0)
          .every((delta: any) => countInventoryById(delta.id, delta.metadata ?? null) >= (-delta.count) * operations);
      }),
    craft: async (recipe: any, count: number) => {
      for (const delta of recipe.delta ?? []) {
        const deltaCount = (delta.count ?? 0) * count;
        if (deltaCount < 0) {
          removeInventoryById(delta.id, -deltaCount);
        } else if (deltaCount > 0) {
          addInventoryById(delta.id, deltaCount);
        }
      }
    },
    placeBlock: async (refBlock: any, face: Vec3) => {
      const targetPos = refBlock.position.offset(face.x, face.y, face.z);
      const placedName = mc.heldItem?.name ?? 'crafting_table';
      blocks.set(keyFor(targetPos), { name: placedName, position: targetPos, visible: true });
    },
    dig: async (_block: any) => new Promise<void>((_resolve, reject) => {
      digReject = reject;
    }),
  };

  const actions = new Actions({
    getBot: () => mc,
  } as any);

  return {
    actions,
    mc,
    blocks,
    keyFor,
    itemDefs,
    setInventoryItems: (items: any[]) => { inventoryItems = items; },
    getInventoryItems: () => inventoryItems,
    getLoadPluginCount: () => loadPluginCount,
    getPathfinderGoals: () => pathfinderGoals,
  };
}

test('findNearestMatchingBlock ignores loaded blocks that Hermes cannot actually see', () => {
  const { actions, mc, blocks, keyFor } = createActionsHarness();
  const hiddenPos = new Vec3(1, 64, 0);
  const visiblePos = new Vec3(2, 64, 0);

  blocks.set(keyFor(hiddenPos), { name: 'oak_log', position: hiddenPos, visible: false });
  blocks.set(keyFor(visiblePos), { name: 'oak_log', position: visiblePos, visible: true });
  mc.findBlocks = () => [hiddenPos, visiblePos];

  const found = (actions as any).findNearestMatchingBlock(['oak_log'], 16, 5, true);

  assert.equal(found?.position.x, 2);
});

test('stop interrupts an active mining job instead of waiting for dig completion', async () => {
  const { actions, mc, blocks, keyFor } = createActionsHarness();
  const targetPos = new Vec3(1, 64, 0);

  blocks.set(keyFor(targetPos), { name: 'stone', position: targetPos, visible: true });
  mc.findBlocks = () => [targetPos];

  const mining = actions.mineBlock('stone');
  await new Promise(resolve => setTimeout(resolve, 30));
  await actions.stop();
  const result = await mining;

  assert.equal(result.success, false);
  assert.match(result.message, /Stopped that job/);
});

test('giveAll treats wood as a resource alias and hands over matching logs', async () => {
  const { actions, mc } = createActionsHarness();
  const tossed: string[] = [];

  (actions as any).pathfinderLoaded = true;
  (actions as any).pathfinderBot = mc;
  mc.inventory.items = () => [
    { name: 'acacia_log', count: 3, type: 1 },
    { name: 'oak_log', count: 2, type: 2 },
  ];
  mc.entities = {
    player1: {
      type: 'player',
      username: 'Flownium',
      position: new Vec3(1, 64, 0),
      offset(dx: number, dy: number, dz: number) {
        return new Vec3(1 + dx, 64 + dy, dz);
      },
    },
  };
  mc.lookAt = async () => {};
  mc.tossStack = async (item: any) => {
    tossed.push(item.name);
  };

  const result = await actions.giveAll('wood', 'Flownium');

  assert.equal(result.success, true);
  assert.deepEqual(tossed.sort(), ['acacia_log', 'oak_log']);
});

test('giveAll normalizes repeated filler words before inventory lookup', async () => {
  const { actions, mc } = createActionsHarness();
  const tossed: string[] = [];

  (actions as any).pathfinderLoaded = true;
  (actions as any).pathfinderBot = mc;
  mc.inventory.items = () => [
    { name: 'cobblestone', count: 5, type: 1200, metadata: null },
  ];
  mc.entities = {
    player1: {
      type: 'player',
      username: 'Flownium',
      position: new Vec3(1, 64, 0),
      offset(dx: number, dy: number, dz: number) {
        return new Vec3(1 + dx, 64 + dy, dz);
      },
    },
  };
  mc.lookAt = async () => {};
  mc.tossStack = async (item: any) => {
    tossed.push(item.name);
  };

  const result = await actions.giveAll('the the cobblestone', 'Flownium');

  assert.equal(result.success, true);
  assert.deepEqual(tossed, ['cobblestone']);
});

test('collectResource retries another visible block when the first mining attempt times out', async () => {
  const { actions, mc, blocks, keyFor } = createActionsHarness();
  const firstPos = new Vec3(1, 64, 0);
  const secondPos = new Vec3(2, 64, 0);
  const mined: string[] = [];

  blocks.set(keyFor(firstPos), { name: 'oak_log', position: firstPos, visible: true });
  blocks.set(keyFor(secondPos), { name: 'oak_log', position: secondPos, visible: true });
  blocks.set(keyFor(firstPos.offset(0, -1, 0)), { name: 'dirt', position: firstPos.offset(0, -1, 0), visible: true });
  blocks.set(keyFor(secondPos.offset(0, -1, 0)), { name: 'dirt', position: secondPos.offset(0, -1, 0), visible: true });
  mc.findBlocks = () => [firstPos, secondPos];
  mc.dig = async (block: any) => {
    mined.push(`${block.position.x},${block.position.y},${block.position.z}`);
    if (block.position.x === 1) {
      throw new Error('mineBlock timed out after 15000ms');
    }
  };

  const result = await actions.collectResource('wood', 1);

  assert.equal(result.success, true);
  assert.deepEqual(mined, ['1,64,0', '2,64,0']);
});

test('collectResource treats oak wood as oak logs', async () => {
  const { actions, mc, blocks, keyFor, getInventoryItems } = createActionsHarness();
  const targetPos = new Vec3(1, 64, 0);
  const supportPos = targetPos.offset(0, -1, 0);

  blocks.set(keyFor(targetPos), { name: 'oak_log', position: targetPos, visible: true });
  blocks.set(keyFor(supportPos), { name: 'dirt', position: supportPos, visible: true });
  mc.findBlocks = ({ matching }: any) => {
    const block = blocks.get(keyFor(targetPos));
    return block && matching(block) ? [targetPos] : [];
  };
  mc.dig = async (block: any) => {
    blocks.delete(keyFor(block.position));
    getInventoryItems().push({ name: 'oak_log', count: 1, type: 7, metadata: null });
  };

  const result = await actions.collectResource('oak_wood', 1);

  assert.equal(result.success, true);
  assert.equal(actions.countResource('oak_wood'), 1);
});

test('collectResource can mine an exposed tree trunk when strict visibility misses it', async () => {
  const { actions, mc, blocks, keyFor, getInventoryItems } = createActionsHarness();
  const targetPos = new Vec3(1, 64, 0);
  const supportPos = targetPos.offset(0, -1, 0);

  blocks.set(keyFor(targetPos), { name: 'oak_log', position: targetPos, visible: false });
  blocks.set(keyFor(supportPos), { name: 'dirt', position: supportPos, visible: true });
  mc.findBlocks = ({ matching }: any) => {
    const block = blocks.get(keyFor(targetPos));
    return block && matching(block) ? [targetPos] : [];
  };
  mc.dig = async (block: any) => {
    blocks.delete(keyFor(block.position));
    getInventoryItems().push({ name: 'oak_log', count: 1, type: 7, metadata: null });
  };

  const result = await actions.collectResource('oak_log', 1);

  assert.equal(result.success, true);
  assert.equal(actions.countResource('oak_log'), 1);
});

test('relaxed tree mining still refuses a trunk behind a solid face', async () => {
  const { actions, mc, blocks, keyFor } = createActionsHarness();
  const targetPos = new Vec3(1, 64, 0);

  blocks.set(keyFor(targetPos), { name: 'oak_log', position: targetPos, visible: false });
  blocks.set(keyFor(targetPos.offset(-1, 0, 0)), { name: 'dirt', position: targetPos.offset(-1, 0, 0), visible: true });
  blocks.set(keyFor(targetPos.offset(0, -1, 0)), { name: 'dirt', position: targetPos.offset(0, -1, 0), visible: true });
  mc.findBlocks = ({ matching }: any) => {
    const block = blocks.get(keyFor(targetPos));
    return block && matching(block) ? [targetPos] : [];
  };

  const result = await actions.collectResource('oak_log', 1);

  assert.equal(result.success, true);
  assert.match(result.message, /scouting|checking|Looking/i);
});

test('findNearestMatchingBlock prefers a grounded log over an elevated canopy log', () => {
  const { actions, mc, blocks, keyFor } = createActionsHarness();
  const canopyPos = new Vec3(1, 67, 0);
  const groundedPos = new Vec3(2, 64, 0);

  blocks.set(keyFor(canopyPos), { name: 'oak_log', position: canopyPos, visible: true });
  blocks.set(keyFor(groundedPos), { name: 'oak_log', position: groundedPos, visible: true });
  blocks.set(keyFor(canopyPos.offset(0, -1, 0)), { name: 'oak_leaves', position: canopyPos.offset(0, -1, 0), visible: true });
  blocks.set(keyFor(groundedPos.offset(0, -1, 0)), { name: 'dirt', position: groundedPos.offset(0, -1, 0), visible: true });
  mc.findBlocks = () => [canopyPos, groundedPos];

  const found = (actions as any).findNearestMatchingBlock(['oak_log'], 16, 5, true);

  assert.equal(found?.position.x, 2);
  assert.equal(found?.position.y, 64);
});

test('leaf-covered trunks still count as exposed for tree mining', async () => {
  const { actions, mc, blocks, keyFor, getInventoryItems } = createActionsHarness();
  const targetPos = new Vec3(1, 64, 0);

  blocks.set(keyFor(targetPos), { name: 'oak_log', position: targetPos, visible: true });
  blocks.set(keyFor(targetPos.offset(1, 0, 0)), { name: 'oak_leaves', position: targetPos.offset(1, 0, 0), visible: true });
  blocks.set(keyFor(targetPos.offset(-1, 0, 0)), { name: 'oak_leaves', position: targetPos.offset(-1, 0, 0), visible: true });
  blocks.set(keyFor(targetPos.offset(0, 1, 0)), { name: 'oak_leaves', position: targetPos.offset(0, 1, 0), visible: true });
  blocks.set(keyFor(targetPos.offset(0, -1, 0)), { name: 'dirt', position: targetPos.offset(0, -1, 0), visible: true });
  blocks.set(keyFor(targetPos.offset(0, 0, 1)), { name: 'oak_leaves', position: targetPos.offset(0, 0, 1), visible: true });
  blocks.set(keyFor(targetPos.offset(0, 0, -1)), { name: 'oak_leaves', position: targetPos.offset(0, 0, -1), visible: true });
  mc.findBlocks = () => [];
  mc.dig = async (block: any) => {
    blocks.delete(keyFor(block.position));
    getInventoryItems().push({ name: 'oak_log', count: 1, type: 7, metadata: null });
  };

  const result = await actions.collectResource('wood', 1);

  assert.equal(result.success, true);
  assert.equal(actions.countResource('wood'), 1);
});

test('pathfinder is reloaded when a new bot replaces the old connection', async () => {
  const { actions, mc, getLoadPluginCount } = createActionsHarness();

  (actions as any).pathfinderLoaded = true;
  (actions as any).pathfinderBot = {};
  mc.pathfinder = undefined;

  const result = await actions.moveTo(1, 64, 1);

  assert.equal(result.success, true);
  assert.equal(getLoadPluginCount(), 1);
});

test('follow uses bounded pathfinding instead of continuous replanning', async () => {
  const { actions, mc, getPathfinderGoals } = createActionsHarness();

  mc.entities = {
    player1: {
      type: 'player',
      username: 'Flownium',
      position: new Vec3(5, 64, 0),
    },
  };

  const result = await actions.follow('Flownium');

  assert.equal(result.success, true);
  const lastGoal = getPathfinderGoals().at(-1);
  assert.equal(lastGoal?.[1], false);
});

test('placeCraftingTable equips and places a nearby crafting table', async () => {
  const { actions, blocks, keyFor, setInventoryItems, itemDefs } = createActionsHarness();
  const supportPos = new Vec3(1, 63, 0);

  setInventoryItems([{ name: 'crafting_table', count: 1, type: itemDefs.crafting_table.id }]);
  blocks.set(keyFor(supportPos), { name: 'dirt', position: supportPos, visible: true });

  const result = await actions.placeCraftingTable();

  assert.equal(result.success, true);
  assert.equal((actions as any).findNearestBlock('crafting_table', 4)?.name, 'crafting_table');
});

test('craft auto-places a crafting table when a recipe needs one and Hermes has one in inventory', async () => {
  const { actions, blocks, keyFor, setInventoryItems, itemDefs } = createActionsHarness();
  const supportPos = new Vec3(1, 63, 0);

  setInventoryItems([
    { name: 'crafting_table', count: 1, type: itemDefs.crafting_table.id },
    { name: 'diamond', count: 2, type: itemDefs.diamond.id },
    { name: 'stick', count: 1, type: itemDefs.stick.id },
  ]);
  blocks.set(keyFor(supportPos), { name: 'dirt', position: supportPos, visible: true });

  const result = await actions.craft('diamond_sword', 1);

  assert.equal(result.success, true);
  assert.equal(actions.countItem('diamond_sword'), 1);
  assert.equal((actions as any).findNearestBlock('crafting_table', 4)?.name, 'crafting_table');
});

test('craft gathers missing wood and crafts a wooden pickaxe by itself', async () => {
  const { actions, mc, blocks, keyFor, getInventoryItems } = createActionsHarness();
  const logPositions = [new Vec3(1, 64, 0), new Vec3(2, 64, 0), new Vec3(3, 64, 0)];
  const supportPositions = logPositions.map(position => position.offset(0, -1, 0));

  for (const supportPos of supportPositions) {
    blocks.set(keyFor(supportPos), { name: 'dirt', position: supportPos, visible: true });
  }
  for (const logPos of logPositions) {
    blocks.set(keyFor(logPos), { name: 'oak_log', position: logPos, visible: true });
  }

  mc.findBlocks = ({ matching }: any) =>
    logPositions
      .filter((position) => {
        const block = blocks.get(keyFor(position));
        return block && matching(block);
      });
  mc.dig = async (block: any) => {
    blocks.delete(keyFor(block.position));
    getInventoryItems().push({ name: 'oak_log', count: 1, type: 7, metadata: null });
  };

  const result = await actions.craft('wooden_pickaxe', 1);

  assert.equal(result.success, true);
  assert.equal(actions.countItem('wooden_pickaxe'), 1);
  assert.match(result.message, /after gathering missing materials/i);
});

test('mineCursorBlock mines the block directly in front of Hermes', async () => {
  const { actions, mc, blocks, keyFor } = createActionsHarness();
  const targetPos = new Vec3(1, 64, 0);
  const supportPos = targetPos.offset(0, -1, 0);
  const mined: string[] = [];

  blocks.set(keyFor(targetPos), { name: 'oak_log', position: targetPos, visible: true });
  blocks.set(keyFor(supportPos), { name: 'dirt', position: supportPos, visible: true });
  mc.blockAtCursor = () => blocks.get(keyFor(targetPos));
  mc.dig = async (block: any) => {
    mined.push(block.name);
    blocks.delete(keyFor(block.position));
  };

  const result = await actions.mineCursorBlock();

  assert.equal(result.success, true);
  assert.deepEqual(mined, ['oak_log']);
});

test('mineCursorBlock can mine a nearby non-log when strict visibility is flaky but the face is open', async () => {
  const { actions, mc, blocks, keyFor } = createActionsHarness();
  const targetPos = new Vec3(1, 64, 0);
  const mined: string[] = [];

  blocks.set(keyFor(targetPos), { name: 'cobblestone', position: targetPos, visible: false });
  blocks.set(keyFor(targetPos.offset(0, -1, 0)), { name: 'dirt', position: targetPos.offset(0, -1, 0), visible: true });
  mc.blockAtCursor = () => blocks.get(keyFor(targetPos));
  mc.dig = async (block: any) => {
    mined.push(block.name);
  };

  const result = await actions.mineCursorBlock();

  assert.equal(result.success, true);
  assert.deepEqual(mined, ['cobblestone']);
});

test('mining normalizes modern enchanted tool data before Mineflayer dig timing', async () => {
  const { actions, mc, blocks, keyFor, getInventoryItems } = createActionsHarness();
  const targetPos = new Vec3(1, 64, 0);
  const enchantComponent = { data: { levels: { 'minecraft:efficiency': 5, 'minecraft:unbreaking': 3 } } };

  blocks.set(keyFor(targetPos), { name: 'cobblestone', position: targetPos, visible: true });
  blocks.set(keyFor(targetPos.offset(0, -1, 0)), { name: 'dirt', position: targetPos.offset(0, -1, 0), visible: true });
  mc.blockAtCursor = () => blocks.get(keyFor(targetPos));
  getInventoryItems().push({
    name: 'diamond_pickaxe',
    count: 1,
    type: 999,
    metadata: null,
    get enchants() {
      return enchantComponent.data;
    },
    componentMap: new Map([['enchantments', enchantComponent]]),
  });
  mc.dig = async () => {
    assert.ok(Array.isArray(mc.heldItem.enchants));
    assert.deepEqual(mc.heldItem.enchants, [
      { name: 'efficiency', lvl: 5 },
      { name: 'unbreaking', lvl: 3 },
    ]);
  };

  const result = await actions.mineCursorBlock();

  assert.equal(result.success, true);
});

test('mineCobbleGen prefers the cobblestone block at the cursor and repeats cycles', async () => {
  const { actions, mc, blocks, keyFor, getInventoryItems } = createActionsHarness();
  const targetPos = new Vec3(1, 64, 0);
  let mined = 0;

  blocks.set(keyFor(new Vec3(0, 63, 0)), { name: 'dirt', position: new Vec3(0, 63, 0), visible: true });
  blocks.set(keyFor(targetPos), { name: 'cobblestone', position: targetPos, visible: false });
  blocks.set(keyFor(targetPos.offset(1, 0, 0)), { name: 'water', position: targetPos.offset(1, 0, 0), visible: true });
  blocks.set(keyFor(targetPos.offset(0, 0, 1)), { name: 'lava', position: targetPos.offset(0, 0, 1), visible: true });
  blocks.set(keyFor(targetPos.offset(0, -1, 0)), { name: 'dirt', position: targetPos.offset(0, -1, 0), visible: true });
  mc.blockAtCursor = () => blocks.get(keyFor(targetPos));
  mc.dig = async (block: any) => {
    mined += 1;
    getInventoryItems().push({ name: block.name, count: 1, type: 1200, metadata: null });
  };

  const result = await actions.mineCobbleGen(3);

  assert.equal(result.success, true);
  assert.equal(mined, 3);
  assert.match(result.message, /Mined 3 cobblestone/);
});

test('mineCobbleGen mines in place instead of pathfinding around the generator', async () => {
  const { actions, mc, blocks, keyFor, getInventoryItems, getPathfinderGoals } = createActionsHarness();
  const targetPos = new Vec3(3, 64, 1);

  blocks.set(keyFor(new Vec3(0, 63, 0)), { name: 'dirt', position: new Vec3(0, 63, 0), visible: true });
  blocks.set(keyFor(targetPos), { name: 'cobblestone', position: targetPos, visible: true });
  blocks.set(keyFor(targetPos.offset(1, 0, 0)), { name: 'water', position: targetPos.offset(1, 0, 0), visible: true });
  blocks.set(keyFor(targetPos.offset(0, 0, 1)), { name: 'lava', position: targetPos.offset(0, 0, 1), visible: true });
  blocks.set(keyFor(targetPos.offset(0, -1, 0)), { name: 'dirt', position: targetPos.offset(0, -1, 0), visible: true });
  mc.blockAtCursor = () => blocks.get(keyFor(targetPos));
  mc.dig = async (block: any) => {
    getInventoryItems().push({ name: block.name, count: 1, type: 1200, metadata: null });
  };

  const result = await actions.mineCobbleGen(1);

  assert.equal(result.success, true);
  assert.equal(getPathfinderGoals().some(([goal]) => goal !== null), false);
});

test('mineCobbleGen continuous mode keeps mining until stopped', async () => {
  const { actions, mc, blocks, keyFor, getInventoryItems } = createActionsHarness();
  const targetPos = new Vec3(1, 64, 0);
  let mined = 0;

  blocks.set(keyFor(new Vec3(0, 63, 0)), { name: 'dirt', position: new Vec3(0, 63, 0), visible: true });
  blocks.set(keyFor(targetPos), { name: 'cobblestone', position: targetPos, visible: false });
  blocks.set(keyFor(targetPos.offset(1, 0, 0)), { name: 'water', position: targetPos.offset(1, 0, 0), visible: true });
  blocks.set(keyFor(targetPos.offset(0, 0, 1)), { name: 'lava', position: targetPos.offset(0, 0, 1), visible: true });
  blocks.set(keyFor(targetPos.offset(0, -1, 0)), { name: 'dirt', position: targetPos.offset(0, -1, 0), visible: true });
  mc.blockAtCursor = () => blocks.get(keyFor(targetPos));
  mc.dig = async (block: any) => {
    mined += 1;
    getInventoryItems().push({ name: block.name, count: 1, type: 1200, metadata: null });
    if (mined === 3) {
      setTimeout(() => void actions.stop(), 0);
    }
  };

  const result = await actions.mineCobbleGen(1, 'Flownium', true);

  assert.equal(result.success, false);
  assert.equal(mined, 3);
  assert.match(result.message, /Stopped that job/i);
});

test('mineCobbleGen rejects random cobblestone that is not touching lava and water', async () => {
  const { actions, mc, blocks, keyFor } = createActionsHarness();
  const targetPos = new Vec3(1, 64, 0);

  blocks.set(keyFor(targetPos), { name: 'cobblestone', position: targetPos, visible: true });
  blocks.set(keyFor(targetPos.offset(0, -1, 0)), { name: 'dirt', position: targetPos.offset(0, -1, 0), visible: true });
  mc.blockAtCursor = () => blocks.get(keyFor(targetPos));

  const result = await actions.mineCobbleGen(3);

  assert.equal(result.success, false);
  assert.match(result.message, /not a generator block/i);
});

test('mineCobbleGen refuses to mine when Hermes is standing next to lava', async () => {
  const { actions, mc, blocks, keyFor } = createActionsHarness();
  const targetPos = new Vec3(1, 64, 0);

  blocks.set(keyFor(new Vec3(0, 63, 0)), { name: 'dirt', position: new Vec3(0, 63, 0), visible: true });
  blocks.set(keyFor(new Vec3(0, 64, 1)), { name: 'lava', position: new Vec3(0, 64, 1), visible: true });
  blocks.set(keyFor(targetPos), { name: 'cobblestone', position: targetPos, visible: true });
  blocks.set(keyFor(targetPos.offset(1, 0, 0)), { name: 'water', position: targetPos.offset(1, 0, 0), visible: true });
  blocks.set(keyFor(targetPos.offset(0, 0, 1)), { name: 'lava', position: targetPos.offset(0, 0, 1), visible: true });
  mc.blockAtCursor = () => blocks.get(keyFor(targetPos));

  const result = await actions.mineCobbleGen(3);

  assert.equal(result.success, false);
  assert.match(result.message, /too close to lava/i);
});
