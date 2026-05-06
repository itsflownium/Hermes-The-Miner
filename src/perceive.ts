import { HermesBot } from './bot.js';
import { Vec3 } from 'vec3';
import type { WorldSnapshot, ItemInfo, EntityInfo, BlockInfo, Position } from './types.js';

const NOTABLE_BLOCKS = new Set([
  // Ores
  'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'emerald_ore',
  'lapis_ore', 'redstone_ore', 'copper_ore',
  'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_gold_ore',
  'deepslate_diamond_ore', 'deepslate_emerald_ore', 'deepslate_lapis_ore',
  'deepslate_redstone_ore', 'deepslate_copper_ore',
  // Containers
  'chest', 'trapped_chest', 'ender_chest', 'barrel',
  'furnace', 'blast_furnace', 'smoker', 'brewing_stand',
  'crafting_table', 'anvil', 'chipped_anvil', 'damaged_anvil',
  // Utility
  'bed', 'respawn_anchor', 'enchanting_table', 'beacon',
  'spawner', 'bell', 'grindstone', 'loom', 'stonecutter',
  'cartography_table', 'fletching_table', 'smithing_table',
  // Doors/gates
  'oak_door', 'iron_door', 'spruce_door', 'birch_door',
  'oak_fence_gate', 'iron_bars',
  // Danger
  'lava', 'water', 'magma_block', 'fire',
  // Valuable
  'obsidian', 'ancient_debris', 'netherite_block',
  'tnt', 'dispenser', 'dropper', 'hopper',
  // Gatherable surface resources
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log',
  'cherry_log', 'wheat', 'carrots', 'potatoes', 'beetroots', 'sweet_berry_bush', 'sugar_cane',
]);

export class Perception {
  private bot: HermesBot;

  constructor(bot: HermesBot) {
    this.bot = bot;
  }

  getSnapshot(): WorldSnapshot | null {
    const mc = this.bot.getBot();
    if (!mc || !mc.entity) return null;

    const pos = mc.entity.position;

    return {
      position: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
      health: mc.health,
      food: mc.food,
      inventory: this.getInventory(),
      nearbyEntities: this.getNearbyEntities(32),
      nearbyBlocks: this.getNearbyBlocks(16),
      biome: mc.blockAt(new Vec3(Math.round(pos.x), Math.round(pos.y) - 1, Math.round(pos.z)))?.biome?.name ?? 'unknown',
      time: this.getTimeString(mc),
      weather: this.getWeather(mc),
      lightLevel: mc.blockAt(new Vec3(Math.round(pos.x), Math.round(pos.y), Math.round(pos.z)))?.light ?? 0,
    };
  }

  getInventory(): ItemInfo[] {
    const mc = this.bot.getBot();
    if (!mc) return [];

    return mc.inventory.items().map(item => ({
      name: item.name,
      count: item.count,
      slot: item.slot,
    }));
  }

  getNearbyEntities(range: number): EntityInfo[] {
    const mc = this.bot.getBot();
    if (!mc || !mc.entity) return [];

    const myPos = mc.entity.position;
    const entities: EntityInfo[] = [];

    for (const entity of Object.values(mc.entities)) {
      if (!entity || !entity.position || entity === mc.entity) continue;
      if (entity.type === 'orb' || entity.type === 'object') continue;

      const dist = myPos.distanceTo(entity.position);
      if (dist > range) continue;

      const entityName = entity.type === 'player'
        ? entity.username ?? entity.displayName?.toString?.() ?? entity.name ?? 'player'
        : entity.name ?? entity.displayName?.toString?.() ?? entity.type ?? 'unknown';

      entities.push({
        name: entityName,
        type: entity.type ?? 'unknown',
        distance: Math.round(dist * 10) / 10,
        position: {
          x: Math.round(entity.position.x),
          y: Math.round(entity.position.y),
          z: Math.round(entity.position.z),
        },
      });
    }

    // Sort by distance, cap at 20
    return entities.sort((a, b) => a.distance - b.distance).slice(0, 20);
  }

  getNearbyBlocks(range: number): BlockInfo[] {
    const mc = this.bot.getBot();
    if (!mc || !mc.entity) return [];

    const myPos = mc.entity.position;
    const blocks: BlockInfo[] = [];
    const positions = mc.findBlocks({
      point: myPos,
      maxDistance: range,
      count: 64,
      matching: (block: any) => NOTABLE_BLOCKS.has(block.name),
    });

    for (const position of positions) {
      const block = mc.blockAt(position);
      if (!block || block.name === 'air' || block.name === 'cave_air') continue;
      if (!this.isExposedBlock(block.position.x, block.position.y, block.position.z)) continue;
      if (!this.canSeeBlock(block)) continue;

      const distance = Math.round(myPos.distanceTo(block.position) * 10) / 10;

      blocks.push({
        name: block.name,
        position: {
          x: block.position.x,
          y: block.position.y,
          z: block.position.z,
        },
        distance,
      });
    }

    // Cap at 20, prioritize ores
    const ores = blocks.filter(b => b.name.includes('ore'));
    const others = blocks.filter(b => !b.name.includes('ore'));
    return [...ores, ...others].slice(0, 20);
  }

  getBlockAt(x: number, y: number, z: number): BlockInfo | null {
    const mc = this.bot.getBot();
    if (!mc) return null;

    const block = mc.blockAt(new Vec3(x, y, z));
    if (!block) return null;

    const myPos = mc.entity?.position;
    const distance = myPos ? Math.round(myPos.distanceTo(block.position) * 10) / 10 : 0;

    return {
      name: block.name,
      position: { x, y, z },
      distance,
    };
  }

  findNearest(entityType: string, maxDistance: number): EntityInfo | null {
    const entities = this.getNearbyEntities(maxDistance);
    return entities.find(e => e.name.includes(entityType) || e.type.includes(entityType)) ?? null;
  }

  private getTimeString(mc: any): string {
    const timeOfDay = mc.time?.timeOfDay ?? 0;
    const hours = Math.floor(((timeOfDay % 24000) / 24000) * 24);
    const period = hours >= 6 && hours < 18 ? 'day' : 'night';
    return `${hours}:00 (${period})`;
  }

  private getWeather(mc: any): string {
    if (mc.rainState > 0) {
      return mc.thunderState > 0 ? 'thunderstorm' : 'rain';
    }
    return 'clear';
  }

  private canSeeBlock(block: any): boolean {
    const mc = this.bot.getBot();
    if (!mc || !block) return false;

    try {
      return mc.canSeeBlock(block);
    } catch {
      return false;
    }
  }

  private isExposedBlock(x: number, y: number, z: number): boolean {
    const mc = this.bot.getBot();
    if (!mc) return false;

    const airLike = new Set(['air', 'cave_air', 'void_air', 'water']);
    const offsets = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];

    return offsets.some(([dx, dy, dz]) => {
      const neighbor = mc.blockAt(new Vec3(x + dx, y + dy, z + dz));
      return !neighbor || airLike.has(neighbor.name);
    });
  }
}
