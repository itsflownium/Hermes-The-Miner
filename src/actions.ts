import { HermesBot } from './bot.js';
import { Vec3 } from 'vec3';
import type { ActionResult } from './types.js';
import pathfinderPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pathfinderPkg as any;

export class Actions {
  private bot: HermesBot;
  private pathfinderLoaded = false;
  private pathfinderBot: any = null;
  private readonly airLikeBlocks = new Set(['air', 'cave_air', 'void_air', 'water']);
  private taskVersion = 0;
  private scoutStep = 0;
  private goalClearTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(bot: HermesBot) {
    this.bot = bot;
  }

  getBot(): HermesBot {
    return this.bot;
  }

  private ensurePathfinder(): void {
    const mc = this.bot.getBot();
    if (!mc) {
      throw new Error('Bot not connected');
    }

    const botWithPathfinder = mc as any;
    if (this.pathfinderLoaded && this.pathfinderBot === mc && botWithPathfinder.pathfinder?.setGoal) {
      return;
    }

    mc.loadPlugin(pathfinder);
    if (!botWithPathfinder.pathfinder?.setGoal) {
      throw new Error('Pathfinder unavailable after reconnect');
    }

    try {
      const movements = new Movements(mc);
      botWithPathfinder.pathfinder.setMovements?.(movements);
    } catch (err: any) {
      console.warn(`[Actions] Pathfinder movements unavailable; using defaults: ${err.message}`);
    }
    this.pathfinderLoaded = true;
    this.pathfinderBot = mc;
  }

  private clearPathfinderGoal(): void {
    const mc = this.bot.getBot();
    if (this.goalClearTimer) {
      clearTimeout(this.goalClearTimer);
      this.goalClearTimer = null;
    }
    if (!mc) return;
    try {
      mc.pathfinder?.setGoal?.(null);
    } catch {
      // Stopping should still clear controls/digging even if pathfinder is unavailable.
    }
  }

  private schedulePathfinderClear(ms: number): void {
    if (this.goalClearTimer) {
      clearTimeout(this.goalClearTimer);
    }

    this.goalClearTimer = setTimeout(() => {
      this.goalClearTimer = null;
      this.clearPathfinderGoal();
    }, ms);
    this.goalClearTimer.unref?.();
  }

  private timeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
    ]);
  }

  private beginTask(): number {
    this.taskVersion += 1;
    return this.taskVersion;
  }

  private cancelActiveTask(): void {
    this.taskVersion += 1;
  }

  private ensureTaskActive(taskVersion: number): void {
    if (taskVersion !== this.taskVersion) {
      throw new Error('Action cancelled');
    }
  }

  private async sleep(ms: number, taskVersion?: number): Promise<void> {
    const slice = 100;
    let remaining = ms;
    while (remaining > 0) {
      const step = Math.min(slice, remaining);
      await new Promise(resolve => setTimeout(resolve, step));
      remaining -= step;
      if (taskVersion !== undefined) {
        this.ensureTaskActive(taskVersion);
      }
    }
  }

  private isCancelledError(err: unknown): boolean {
    return err instanceof Error && /cancelled/i.test(err.message);
  }

  cancelAll(reason = 'Action cancelled'): void {
    this.cancelActiveTask();
    const mc = this.bot.getBot();
    try {
      this.clearPathfinderGoal();
      mc?.clearControlStates?.();
      mc?.stopDigging?.();
    } catch {
      // Best-effort emergency stop.
    }
    console.log(`[Actions] ${reason}`);
  }

  private getResourceAliases(resourceName: string): string[] {
    const normalized = resourceName.toLowerCase().replace(/\s+/g, '_');
    const aliases: Record<string, string[]> = {
      wood: ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log', 'log'],
      logs: ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log', 'log'],
      tree: ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log', 'log'],
      oak_wood: ['oak_log'],
      oak_logs: ['oak_log'],
      birch_wood: ['birch_log'],
      birch_logs: ['birch_log'],
      spruce_wood: ['spruce_log'],
      spruce_logs: ['spruce_log'],
      jungle_wood: ['jungle_log'],
      jungle_logs: ['jungle_log'],
      acacia_wood: ['acacia_log'],
      acacia_logs: ['acacia_log'],
      acasia_wood: ['acacia_log'],
      acasia_log: ['acacia_log'],
      acasia_logs: ['acacia_log'],
      dark_oak_wood: ['dark_oak_log'],
      dark_oak_logs: ['dark_oak_log'],
      mangrove_wood: ['mangrove_log'],
      mangrove_logs: ['mangrove_log'],
      cherry_wood: ['cherry_log'],
      cherry_logs: ['cherry_log'],
      stone: ['stone', 'cobblestone'],
      cobble: ['cobblestone'],
      coal: ['coal_ore', 'deepslate_coal_ore', 'coal'],
      iron: ['iron_ore', 'deepslate_iron_ore', 'raw_iron', 'iron_ingot'],
      gold: ['gold_ore', 'deepslate_gold_ore', 'raw_gold', 'gold_ingot'],
      diamond: ['diamond_ore', 'deepslate_diamond_ore', 'diamond'],
      copper: ['copper_ore', 'deepslate_copper_ore', 'raw_copper'],
      food: ['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'apple', 'baked_potato', 'carrot', 'potato'],
      berries: ['sweet_berry_bush', 'sweet_berries'],
      flowers: ['poppy', 'dandelion', 'blue_orchid', 'allium', 'azure_bluet', 'tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley'],
    };

    return aliases[normalized] ?? [normalized];
  }

  private getSearchBlockNames(resourceName: string): string[] {
    const mc = this.bot.getBot();
    if (!mc) return this.getResourceAliases(resourceName);

    const normalized = resourceName.toLowerCase().replace(/\s+/g, '_');
    const blockFocusedAliases: Record<string, string[]> = {
      food: ['wheat', 'carrots', 'potatoes', 'beetroots', 'sweet_berry_bush', 'melon', 'pumpkin', 'sugar_cane'],
      berries: ['sweet_berry_bush'],
    };

    const aliases = [
      ...(blockFocusedAliases[normalized] ?? []),
      ...this.getResourceAliases(resourceName),
    ];

    return [...new Set(
      aliases.filter((alias) =>
        alias === 'log' ||
        alias.endsWith('_log') ||
        alias.endsWith('_leaves') ||
        Boolean(mc.registry?.blocksByName?.[alias]),
      ),
    )];
  }

  private getScoutClueNames(resourceName: string): string[] {
    const normalized = resourceName.toLowerCase().replace(/\s+/g, '_');
    const clues: Record<string, string[]> = {
      wood: ['oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves'],
      logs: ['oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves'],
      tree: ['oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves'],
      stone: ['stone', 'cobblestone', 'andesite', 'granite', 'diorite', 'gravel'],
      cobble: ['cobblestone', 'stone'],
      cobblestone: ['cobblestone', 'stone'],
      coal: ['stone', 'deepslate', 'coal_ore', 'deepslate_coal_ore'],
      iron: ['stone', 'deepslate', 'iron_ore', 'deepslate_iron_ore'],
      copper: ['stone', 'deepslate', 'copper_ore', 'deepslate_copper_ore'],
      gold: ['stone', 'deepslate', 'gold_ore', 'deepslate_gold_ore'],
      diamond: ['stone', 'deepslate', 'diamond_ore', 'deepslate_diamond_ore'],
      food: ['wheat', 'carrots', 'potatoes', 'beetroots', 'sweet_berry_bush', 'melon', 'pumpkin', 'sugar_cane'],
      cobweb: ['cobweb'],
    };

    return clues[normalized] ?? this.getSearchBlockNames(resourceName);
  }

  private matchesSearchName(actualName: string, searchName: string): boolean {
    if (actualName === searchName) return true;
    if (searchName === 'log') return actualName.endsWith('_log');
    return false;
  }

  private isLogBlock(blockName: string): boolean {
    return blockName === 'log' || blockName.endsWith('_log');
  }

  private isTransparentForMiningFace(blockName: string): boolean {
    return this.airLikeBlocks.has(blockName) ||
      blockName.endsWith('_leaves') ||
      blockName === 'grass' ||
      blockName === 'tall_grass' ||
      blockName === 'fern' ||
      blockName === 'large_fern' ||
      blockName === 'vine' ||
      blockName.includes('cave_vines');
  }

  private hasOpenFaceTowardBot(block: any): boolean {
    const mc = this.bot.getBot();
    if (!mc?.entity?.position || !block?.position) return false;

    const blockCenter = block.position.offset(0.5, 0.5, 0.5);
    const botPos = mc.entity.position;
    const offsets = [
      { axis: 'x', distance: Math.abs(botPos.x - blockCenter.x), dx: botPos.x >= blockCenter.x ? 1 : -1, dy: 0, dz: 0 },
      { axis: 'y', distance: Math.abs(botPos.y + 1.4 - blockCenter.y), dx: 0, dy: botPos.y + 1.4 >= blockCenter.y ? 1 : -1, dz: 0 },
      { axis: 'z', distance: Math.abs(botPos.z - blockCenter.z), dx: 0, dy: 0, dz: botPos.z >= blockCenter.z ? 1 : -1 },
    ].sort((a, b) => b.distance - a.distance);

    for (const offset of offsets) {
      if (offset.distance < 0.35) continue;
      const neighbor = mc.blockAt(block.position.offset(offset.dx, offset.dy, offset.dz));
      if (!neighbor || this.isTransparentForMiningFace(neighbor.name)) return true;
      if (offset.axis !== 'y') break;
    }

    return false;
  }

  private hasPracticalMiningSight(block: any, allowRelaxedLogs = false): boolean {
    if (this.canSeeBlock(block)) return true;
    if (!this.isExposedBlock(block)) return false;
    if (!this.hasOpenFaceTowardBot(block)) return false;

    const mc = this.bot.getBot();
    const distance = mc?.entity?.position?.distanceTo?.(block.position) ?? Infinity;
    return (allowRelaxedLogs && this.isLogBlock(block.name)) || distance <= 3.6;
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

  private isExposedBlock(block: any): boolean {
    if (!block?.position) return false;
    const mc = this.bot.getBot();
    if (!mc) return false;

    const offsets = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];

    return offsets.some(([dx, dy, dz]) => {
      const neighbor = mc.blockAt(block.position.offset(dx, dy, dz));
      return !neighbor || this.isTransparentForMiningFace(neighbor.name);
    });
  }

  private findNearestMatchingBlock(searchNames: string[], range: number, verticalRange = 5, requireExposed = true): any | null {
    return this.findMatchingBlocks(searchNames, range, verticalRange, requireExposed, 1)[0] ?? null;
  }

  private findMatchingBlocks(
    searchNames: string[],
    range: number,
    verticalRange = 5,
    requireExposed = true,
    maxCount = 6,
    allowRelaxedLogs = false,
  ): any[] {
    const mc = this.bot.getBot();
    if (!mc?.entity) return [];

    const myPos = mc.entity.position;
    const foundPositions = mc.findBlocks({
      point: myPos,
      maxDistance: range,
      count: Math.max(24, Math.min(96, range * 4)),
      matching: (block: any) => searchNames.some(name => this.matchesSearchName(block.name, name)),
    }) ?? [];
    const positionKeys = new Set<string>();
    const positions = [...foundPositions];

    for (const position of foundPositions) {
      positionKeys.add(`${position.x},${position.y},${position.z}`);
    }

    // Mineflayer's indexed block search can miss freshly-loaded or leaf-covered tree trunks.
    // A tight local scan keeps nearby visible resources responsive without scanning the world.
    for (let dx = -range; dx <= range; dx += 1) {
      for (let dy = -verticalRange; dy <= verticalRange; dy += 1) {
        for (let dz = -range; dz <= range; dz += 1) {
          if ((dx * dx) + (dy * dy) + (dz * dz) > range * range) continue;
          const position = new Vec3(Math.round(myPos.x) + dx, Math.round(myPos.y) + dy, Math.round(myPos.z) + dz);
          const key = `${position.x},${position.y},${position.z}`;
          if (positionKeys.has(key)) continue;
          const block = mc.blockAt(position);
          if (!block || !searchNames.some(name => this.matchesSearchName(block.name, name))) continue;
          positions.push(position);
          positionKeys.add(key);
        }
      }
    }

    return positions
      .map((position: any) => mc.blockAt(position))
      .filter((block: any) => {
        if (!block?.position) return false;
        if (Math.abs(block.position.y - myPos.y) > verticalRange) return false;
        if (requireExposed && !this.isExposedBlock(block)) return false;
        if (!this.canSeeBlock(block) && (!allowRelaxedLogs || !this.hasPracticalMiningSight(block, true))) return false;
        return true;
      })
      .sort((a: any, b: any) => this.scoreBlockCandidate(a, myPos) - this.scoreBlockCandidate(b, myPos))
      .slice(0, maxCount);
  }

  private scoreBlockCandidate(block: any, myPos: any): number {
    const mc = this.bot.getBot();
    const distance = myPos.distanceTo(block.position);
    const abovePenalty = Math.max(0, block.position.y - myPos.y) * 2.5;
    const below = mc?.blockAt?.(block.position.offset(0, -1, 0));
    const canopyPenalty = !below || this.airLikeBlocks.has(below.name) || below.name.endsWith('_leaves') ? 3 : 0;
    return distance + abovePenalty + canopyPenalty;
  }

  private humanizeName(name: string): string {
    return name.replace(/_/g, ' ');
  }

  private normalizeItemRequest(itemName: string): string {
    const normalized = itemName
      .trim()
      .toLowerCase()
      .replace(/\s+(?:for\s+me|please)$/i, '')
      .replace(/^(?:(?:me|us|all|some|this|that|the|a|an)\s+)+/i, '')
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

    return aliases[normalized] ?? normalized;
  }

  private countExactItem(itemName: string): number {
    const mc = this.bot.getBot();
    if (!mc) return 0;
    return mc.inventory.items()
      .filter(item => item.name === itemName)
      .reduce((sum, item) => sum + item.count, 0);
  }

  private countInventoryById(itemId: number, metadata: number | null = null): number {
    const mc = this.bot.getBot();
    if (!mc) return 0;

    if (typeof mc.inventory?.count === 'function') {
      try {
        return mc.inventory.count(itemId, metadata);
      } catch {
        // Fall back to scanning inventory items below.
      }
    }

    return mc.inventory.items()
      .filter((item) => item.type === itemId && (metadata == null || item.metadata == null || item.metadata === metadata))
      .reduce((sum, item) => sum + item.count, 0);
  }

  private getItemNameById(itemId: number | null): string | null {
    if (itemId == null || itemId < 0) return null;

    const mc = this.bot.getBot();
    if (!mc?.registry) return null;

    const direct = mc.registry.items?.[itemId];
    if (direct?.name) return direct.name;

    for (const [name, item] of Object.entries(mc.registry.itemsByName ?? {})) {
      if ((item as any)?.id === itemId) return name;
    }

    return null;
  }

  private normalizeRecipeName(recipeName: string): string {
    const normalized = recipeName
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
      crafting_bench: 'crafting_table',
      furnaces: 'furnace',
      chests: 'chest',
      ladders: 'ladder',
    };

    return aliases[normalized] ?? normalized;
  }

  private getDirectGatherResource(itemName: string): string | null {
    const normalized = itemName.toLowerCase().replace(/\s+/g, '_');
    const direct: Record<string, string> = {
      oak_log: 'wood',
      birch_log: 'wood',
      spruce_log: 'wood',
      jungle_log: 'wood',
      acacia_log: 'wood',
      dark_oak_log: 'wood',
      mangrove_log: 'wood',
      cherry_log: 'wood',
      acasia_log: 'wood',
      coal: 'coal',
      diamond: 'diamond',
      cobblestone: 'stone',
      dirt: 'dirt',
      gravel: 'gravel',
      sand: 'sand',
      cobweb: 'cobweb',
      sweet_berries: 'berries',
    };

    return direct[normalized] ?? null;
  }

  private getRecipeIngredientNames(recipe: any): string[] {
    return (recipe.delta ?? [])
      .filter((delta: any) => delta.count < 0)
      .map((delta: any) => this.getItemNameById(delta.id))
      .filter(Boolean) as string[];
  }

  private getRecipePreferenceScore(recipe: any): number {
    let score = Number(recipe.requiresTable) * 2;
    const preferredWoodItems = new Set(['oak_log', 'oak_planks']);

    for (const ingredientName of this.getRecipeIngredientNames(recipe)) {
      if (preferredWoodItems.has(ingredientName)) {
        score -= 4;
      } else if (ingredientName.endsWith('_log') || ingredientName.endsWith('_planks')) {
        score += 3;
      }

      if (this.countExactItem(ingredientName) > 0) {
        score -= 8;
      } else if (this.getDirectGatherResource(ingredientName)) {
        score -= 1;
      }
    }

    return score;
  }

  private getAllRecipes(itemId: number): any[] {
    const mc = this.bot.getBot();
    if (!mc?.recipesAll) return [];

    const recipes = mc.recipesAll(itemId, null, true) ?? [];
    return [...recipes].sort((a: any, b: any) => {
      const preferenceBias = this.getRecipePreferenceScore(a) - this.getRecipePreferenceScore(b);
      if (preferenceBias !== 0) return preferenceBias;
      const tableBias = Number(a.requiresTable) - Number(b.requiresTable);
      if (tableBias !== 0) return tableBias;
      const ingredientBias = (a.delta?.filter((delta: any) => delta.count < 0).length ?? 0)
        - (b.delta?.filter((delta: any) => delta.count < 0).length ?? 0);
      if (ingredientBias !== 0) return ingredientBias;
      return (b.result?.count ?? 1) - (a.result?.count ?? 1);
    });
  }

  private async tryCraftNow(normalizedRecipe: string, desiredCount: number): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    const item = mc.registry?.itemsByName?.[normalizedRecipe];
    if (!item) {
      return { success: false, message: `I don't know how to craft ${this.humanizeName(normalizedRecipe)}` };
    }

    const sanitizedDesiredCount = Math.max(1, Number.isFinite(desiredCount) ? Math.floor(desiredCount) : 1);
    const inventoryRecipe = mc.recipesFor(item.id, null, sanitizedDesiredCount, null)?.[0] ?? null;
    let craftingTable = inventoryRecipe ? null : this.findNearestBlock('crafting_table', 16);
    let stationRecipe = craftingTable ? mc.recipesFor(item.id, null, sanitizedDesiredCount, craftingTable)?.[0] ?? null : null;

    if (!inventoryRecipe && !stationRecipe && normalizedRecipe !== 'crafting_table' && this.countExactItem('crafting_table') > 0) {
      const placed = await this.placeCraftingTable();
      if (placed.success) {
        craftingTable = this.findNearestBlock('crafting_table', 6);
        stationRecipe = craftingTable ? mc.recipesFor(item.id, null, sanitizedDesiredCount, craftingTable)?.[0] ?? null : null;
      }
    }

    const recipe = inventoryRecipe ?? stationRecipe;
    if (!recipe) {
      if (!craftingTable) {
        return {
          success: false,
          message: `I need the right materials and maybe a crafting table nearby for ${this.humanizeName(normalizedRecipe)}`,
        };
      }
      return {
        success: false,
        message: `I don't have the materials to craft ${this.humanizeName(normalizedRecipe)} yet`,
      };
    }

    const craftOperations = Math.max(1, Math.ceil(sanitizedDesiredCount / (recipe.result?.count ?? 1)));
    await mc.craft(recipe, craftOperations, craftingTable ?? null);
    const producedCount = (recipe.result?.count ?? 1) * craftOperations;
    return { success: true, message: `Crafted ${producedCount}x ${this.humanizeName(normalizedRecipe)}` };
  }

  private async acquireMissingItem(
    itemName: string,
    missingCount: number,
    depth: number,
    chain: Set<string>,
  ): Promise<ActionResult> {
    if (missingCount <= 0) return { success: true, message: 'Already available' };

    const directResource = this.getDirectGatherResource(itemName);
    if (directResource) {
      return await this.collectResource(directResource, missingCount);
    }

    return await this.craftInternal(itemName, missingCount, depth + 1, chain);
  }

  private async prepareMissingMaterials(
    normalizedRecipe: string,
    desiredCount: number,
    depth: number,
    chain: Set<string>,
  ): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };
    if (depth > 6) {
      return { success: false, message: `I couldn't work out the missing materials for ${this.humanizeName(normalizedRecipe)}` };
    }
    if (chain.has(normalizedRecipe)) {
      return { success: false, message: `I got stuck planning the materials for ${this.humanizeName(normalizedRecipe)}` };
    }

    const item = mc.registry?.itemsByName?.[normalizedRecipe];
    if (!item) {
      return { success: false, message: `I don't know how to craft ${this.humanizeName(normalizedRecipe)}` };
    }

    const recipes = this.getAllRecipes(item.id);
    const recipe = recipes[0];
    if (!recipe) {
      return { success: false, message: `I don't know a recipe for ${this.humanizeName(normalizedRecipe)}` };
    }

    const nextChain = new Set(chain);
    nextChain.add(normalizedRecipe);

    if (recipe.requiresTable && normalizedRecipe !== 'crafting_table' &&
        !this.findNearestBlock('crafting_table', 16) &&
        this.countExactItem('crafting_table') <= 0) {
      const ensureTable = await this.acquireMissingItem('crafting_table', 1, depth + 1, nextChain);
      if (!ensureTable.success) return ensureTable;
    }

    const craftOperations = Math.max(1, Math.ceil(desiredCount / (recipe.result?.count ?? 1)));

    for (let attempts = 0; attempts < 8; attempts += 1) {
      const shortages = (recipe.delta ?? [])
        .filter((delta: any) => delta.count < 0)
        .map((delta: any) => {
          const ingredientName = this.getItemNameById(delta.id);
          const requiredCount = (-delta.count) * craftOperations;
          const availableCount = this.countInventoryById(delta.id, delta.metadata ?? null);
          return {
            ingredientName,
            missingCount: Math.max(0, requiredCount - availableCount),
          };
        })
        .filter((entry: any) => entry.ingredientName && entry.missingCount > 0);

      if (shortages.length === 0) {
        return { success: true, message: `Prepared materials for ${this.humanizeName(normalizedRecipe)}` };
      }

      const nextShortage = shortages[0];
      const acquired = await this.acquireMissingItem(nextShortage.ingredientName, nextShortage.missingCount, depth + 1, nextChain);
      if (!acquired.success) return acquired;
    }

    return { success: false, message: `I couldn't finish gathering the materials for ${this.humanizeName(normalizedRecipe)}` };
  }

  private async craftInternal(
    recipeName: string,
    count: number,
    depth = 0,
    chain = new Set<string>(),
  ): Promise<ActionResult> {
    const normalizedRecipe = this.normalizeRecipeName(recipeName);
    const desiredCount = Math.max(1, Number.isFinite(count) ? Math.floor(count) : 1);

    const immediate = await this.tryCraftNow(normalizedRecipe, desiredCount);
    if (immediate.success) return immediate;
    if (depth > 6) return immediate;

    const prepared = await this.prepareMissingMaterials(normalizedRecipe, desiredCount, depth, chain);
    if (!prepared.success) return prepared;

    const retried = await this.tryCraftNow(normalizedRecipe, desiredCount);
    if (retried.success) {
      return {
        success: true,
        message: `${retried.message} after gathering missing materials.`,
      };
    }
    return retried;
  }

  private findNearbyPlacementTarget(): Vec3 | null {
    const mc = this.bot.getBot();
    if (!mc?.entity?.position) return null;

    const origin = new Vec3(
      Math.floor(mc.entity.position.x),
      Math.floor(mc.entity.position.y),
      Math.floor(mc.entity.position.z),
    );

    const candidates = [
      origin.offset(1, 0, 0),
      origin.offset(-1, 0, 0),
      origin.offset(0, 0, 1),
      origin.offset(0, 0, -1),
      origin.offset(1, 1, 0),
      origin.offset(-1, 1, 0),
      origin.offset(0, 1, 1),
      origin.offset(0, 1, -1),
    ];

    for (const target of candidates) {
      const targetBlock = mc.blockAt(target);
      if (targetBlock && !this.airLikeBlocks.has(targetBlock.name)) continue;

      const below = mc.blockAt(target.offset(0, -1, 0));
      if (!below || this.airLikeBlocks.has(below.name)) continue;

      return target;
    }

    return null;
  }

  private async equipToolForBlock(blockName: string): Promise<void> {
    const mc = this.bot.getBot();
    if (!mc) return;

    const tools: Record<string, string[]> = {
      stone: ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'],
      cobblestone: ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'],
      coal_ore: ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'],
      deepslate_coal_ore: ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'],
      iron_ore: ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe'],
      deepslate_iron_ore: ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe'],
      copper_ore: ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe'],
      deepslate_copper_ore: ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe'],
      gold_ore: ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe'],
      deepslate_gold_ore: ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe'],
      diamond_ore: ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe'],
      deepslate_diamond_ore: ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe'],
      log: ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'],
      oak_log: ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'],
      birch_log: ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'],
      spruce_log: ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'],
      jungle_log: ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'],
      acacia_log: ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'],
      dark_oak_log: ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'],
      mangrove_log: ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'],
      cherry_log: ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'],
      dirt: ['netherite_shovel', 'diamond_shovel', 'iron_shovel', 'stone_shovel', 'wooden_shovel'],
      gravel: ['netherite_shovel', 'diamond_shovel', 'iron_shovel', 'stone_shovel', 'wooden_shovel'],
      sand: ['netherite_shovel', 'diamond_shovel', 'iron_shovel', 'stone_shovel', 'wooden_shovel'],
    };

    const toolList = tools[blockName] ?? tools[Object.keys(tools).find(key => blockName.includes(key)) ?? ''];
    if (!toolList) return;

    for (const toolName of toolList) {
      const tool = mc.inventory.items().find(item => item.name === toolName);
      if (!tool) continue;
      this.normalizeItemEnchantments(tool);
      try {
        await mc.equip(tool, 'hand');
        this.normalizeEquippedEnchantments();
      } catch {
        // Ignore failed equip attempts and try the next tool.
      }
      return;
    }
  }

  private normalizeEnchantments(rawEnchantments: any): { name: string; lvl: number }[] {
    if (!rawEnchantments) return [];

    if (Array.isArray(rawEnchantments)) {
      return rawEnchantments
        .map((entry: any) => ({
          name: String(entry?.name ?? entry?.id ?? '').replace(/^minecraft:/, ''),
          lvl: Number(entry?.lvl ?? entry?.level ?? entry?.value ?? 1),
        }))
        .filter((entry) => entry.name);
    }

    const levelData = rawEnchantments.levels ?? rawEnchantments.enchantments ?? rawEnchantments;
    if (levelData instanceof Map) {
      return [...levelData.entries()]
        .map(([name, value]) => ({
          name: String(name).replace(/^minecraft:/, ''),
          lvl: Number((value as any)?.lvl ?? (value as any)?.level ?? value ?? 1),
        }))
        .filter((entry) => entry.name);
    }

    if (typeof levelData === 'object') {
      return Object.entries(levelData)
        .map(([name, value]) => ({
          name: String(name).replace(/^minecraft:/, ''),
          lvl: Number((value as any)?.lvl ?? (value as any)?.level ?? value ?? 1),
        }))
        .filter((entry) => entry.name && Number.isFinite(entry.lvl));
    }

    return [];
  }

  private normalizeItemEnchantments(item: any): void {
    if (!item) return;

    try {
      const normalized = this.normalizeEnchantments(item.enchants);
      if (item.componentMap?.has?.('enchantments')) {
        const component = item.componentMap.get('enchantments');
        if (component && !Array.isArray(component.data)) {
          component.data = normalized;
        }
      } else if (!Array.isArray(item.enchants)) {
        item.enchants = normalized;
      }
    } catch {
      try {
        if (item.componentMap?.has?.('enchantments')) {
          item.componentMap.get('enchantments').data = [];
        } else {
          Object.defineProperty(item, 'enchants', {
            configurable: true,
            value: [],
          });
        }
      } catch {
        // If the item object is read-only, Mineflayer will handle the plain item as-is.
      }
    }
  }

  private normalizeEquippedEnchantments(): void {
    const mc = this.bot.getBot();
    if (!mc) return;

    this.normalizeItemEnchantments(mc.heldItem);

    try {
      const headSlot = mc.getEquipmentDestSlot?.('head');
      if (typeof headSlot === 'number') {
        this.normalizeItemEnchantments(mc.inventory?.slots?.[headSlot]);
      }
    } catch {
      // Helmet enchantments only affect dig speed; never let them break mining.
    }
  }

  private getEntityNames(entity: any): string[] {
    return [
      entity?.username,
      entity?.name,
      entity?.displayName?.toString?.(),
      entity?.player?.username,
      entity?.profile?.name,
    ]
      .filter(Boolean)
      .map((name: string) => name.toLowerCase());
  }

  private resolvePlayerEntity(playerName: string): { entity: any | null; ambiguous: boolean } {
    const mc = this.bot.getBot();
    if (!mc) return { entity: null, ambiguous: false };

    const normalized = playerName.toLowerCase();
    const candidates = Object.values(mc.entities).filter((entity) => {
      if (!entity || entity === mc.entity) return false;
      if ((entity as any).type !== 'player' && !(entity as any).username) return false;
      const names = this.getEntityNames(entity);
      return names.length > 0;
    });

    const exact = candidates.filter((entity) =>
      this.getEntityNames(entity).some((name) => name === normalized),
    );
    if (exact.length === 1) return { entity: exact[0], ambiguous: false };
    if (exact.length > 1) return { entity: null, ambiguous: true };

    const prefix = candidates.filter((entity) =>
      this.getEntityNames(entity).some((name) => name.startsWith(normalized)),
    );
    if (prefix.length === 1) return { entity: prefix[0], ambiguous: false };
    if (prefix.length > 1) return { entity: null, ambiguous: true };

    const partial = candidates.filter((entity) =>
      this.getEntityNames(entity).some((name) => name.includes(normalized)),
    );
    if (partial.length === 1) return { entity: partial[0], ambiguous: false };
    if (partial.length > 1) return { entity: null, ambiguous: true };

    return { entity: null, ambiguous: false };
  }

  private setGoalNear(x: number, y: number, z: number, radius: number): void {
    this.ensurePathfinder();
    const mc = this.bot.getBot();
    mc?.pathfinder?.setGoal?.(new goals.GoalNear(x, y, z, radius));
  }

  private async mineVisibleBlock(
    targetBlock: any,
    requestedName: string,
    activeTaskVersion?: number,
    allowPathing = true,
  ): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc || !mc.entity) return { success: false, message: 'Bot not connected' };

    const taskVersion = activeTaskVersion ?? this.beginTask();

    try {
      this.clearPathfinderGoal();

      const blockPos = targetBlock.position;
      if (allowPathing && mc.entity.position.distanceTo(blockPos) > 3) {
        const pathY = blockPos.y > mc.entity.position.y + 1
          ? Math.round(mc.entity.position.y)
          : blockPos.y;
        const radius = blockPos.y > mc.entity.position.y + 1 ? 3 : 2;
        this.setGoalNear(blockPos.x, pathY, blockPos.z, radius);
        let waited = 0;
        while (waited < 8000) {
          await this.sleep(250, taskVersion);
          waited += 250;
          if (mc.entity.position.distanceTo(blockPos) <= 3.5) break;
        }
        this.clearPathfinderGoal();
      }

      this.ensureTaskActive(taskVersion);

      if (mc.entity.position.distanceTo(blockPos) > 4.5) {
        return { success: false, message: `Can't reach the ${requestedName}` };
      }

      const liveBlock = mc.blockAt(blockPos);
      if (!liveBlock || this.airLikeBlocks.has(liveBlock.name)) {
        return { success: false, message: `Lost sight of the ${requestedName}` };
      }

      if (typeof mc.lookAt === 'function') {
        try {
          await mc.lookAt(liveBlock.position.offset(0.5, 0.5, 0.5), true);
        } catch {
          // Keep going if the bot cannot smoothly adjust its gaze.
        }
      }

      if (!this.hasPracticalMiningSight(liveBlock, this.isLogBlock(liveBlock.name))) {
        return { success: false, message: `Can't see a clear ${requestedName} to mine from here` };
      }

      await this.equipToolForBlock(liveBlock.name);
      this.normalizeEquippedEnchantments();
      this.ensureTaskActive(taskVersion);
      await this.timeout(mc.dig(liveBlock), 15000, 'mineBlock');
      this.ensureTaskActive(taskVersion);
      return { success: true, message: `Mined ${liveBlock.name}.` };
    } catch (err: any) {
      if (taskVersion !== this.taskVersion || this.isCancelledError(err)) {
        return { success: false, message: 'Stopped that job.' };
      }
      mc.stopDigging?.();
      return { success: false, message: `Failed to mine: ${err.message}` };
    } finally {
      this.clearPathfinderGoal();
    }
  }

  // ─── Stop ───

  async stop(): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    try {
      this.cancelActiveTask();
      this.clearPathfinderGoal();
      mc.clearControlStates();
      mc.stopDigging?.();
      return { success: true, message: 'Stopped all actions' };
    } catch (err: any) {
      return { success: false, message: `Failed to stop: ${err.message}` };
    }
  }

  // ─── Movement ───

  async moveTo(x: number, y: number, z: number): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    try {
      this.ensurePathfinder();
      const goal = new goals.GoalNear(x, y, z, 1); // Within 1 block
      // Use goto but with shorter timeout and don't block other tasks
      mc.pathfinder.setGoal(goal);
      return { success: true, message: `Moving to ${x}, ${y}, ${z}` };
    } catch (err: any) {
      return { success: false, message: `Failed to move: ${err.message}` };
    }
  }

  async follow(entityName: string): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    const { entity: target, ambiguous } = this.resolvePlayerEntity(entityName);
    if (ambiguous) {
      return { success: false, message: `I see more than one player matching ${entityName}` };
    }
    if (!target) return { success: false, message: `Can't see ${entityName} nearby` };

    try {
      this.ensurePathfinder();
      this.clearPathfinderGoal();
      const goal = new goals.GoalFollow(target, 2);
      // Avoid continuous dynamic replanning here; in dense builds it can peg the event loop
      // hard enough for Minecraft to time out the bot connection.
      mc.pathfinder.setGoal(goal, false);
      this.schedulePathfinderClear(20000);
      return { success: true, message: `Following ${entityName}` };
    } catch (err: any) {
      return { success: false, message: `Failed to follow: ${err.message}` };
    }
  }

  async jump(): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    mc.setControlState('jump', true);
    await new Promise(r => setTimeout(r, 300));
    mc.setControlState('jump', false);
    return { success: true, message: 'Jumped' };
  }

  async sneak(toggle: boolean): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    mc.setControlState('sneak', toggle);
    return { success: true, message: toggle ? 'Sneaking' : 'Stopped sneaking' };
  }

  // ─── Inventory ───

  async equip(itemName: string, slot: string = 'hand'): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    const item = mc.inventory.items().find(i => i.name === itemName);
    if (!item) return { success: false, message: `Item '${itemName}' not in inventory` };

    try {
      await mc.equip(item, slot as any);
      return { success: true, message: `Equipped ${itemName}` };
    } catch (err: any) {
      return { success: false, message: `Failed to equip: ${err.message}` };
    }
  }

  async toss(itemName: string, count: number = 1): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    const item = mc.inventory.items().find(i => i.name === itemName);
    if (!item) return { success: false, message: `Item '${itemName}' not in inventory` };

    try {
      await mc.toss(item.type, null, Math.min(count, item.count));
      return { success: true, message: `Dropped ${count}x ${itemName}` };
    } catch (err: any) {
      return { success: false, message: `Failed to toss: ${err.message}` };
    }
  }

  async useHeldItem(): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    try {
      mc.activateItem();
      await new Promise(r => setTimeout(r, 500));
      mc.deactivateItem();
      return { success: true, message: 'Used held item' };
    } catch (err: any) {
      return { success: false, message: `Failed to use item: ${err.message}` };
    }
  }

  async openContainer(x: number, y: number, z: number): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    const block = mc.blockAt(new Vec3(x, y, z));
    if (!block) return { success: false, message: 'No block at position' };

    try {
      await mc.openBlock(block);
      return { success: true, message: `Opened ${block.name} at ${x}, ${y}, ${z}` };
    } catch (err: any) {
      return { success: false, message: `Failed to open: ${err.message}` };
    }
  }

  // ─── Interaction ───

  async attack(entityName: string): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    // Find entity by name OR username (players have username)
    const entity = Object.values(mc.entities).find(
      e => (e?.name?.toLowerCase().includes(entityName.toLowerCase()) || 
            (e as any)?.username?.toLowerCase() === entityName.toLowerCase()) && 
            e !== mc.entity
    );
    if (!entity) return { success: false, message: `Entity '${entityName}' not found` };

    try {
      // Equip best weapon before attacking
      const weapons = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword',
                       'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'];
      for (const weaponName of weapons) {
        const weapon = mc.inventory.items().find(i => i.name === weaponName);
        if (weapon) {
          try { await mc.equip(weapon, 'hand'); } catch { /* ignore equip errors */ }
          break;
        }
      }

      mc.attack(entity);
      return { success: true, message: `Attacked ${entityName}!` };
    } catch (err: any) {
      return { success: false, message: `Failed to attack: ${err.message}` };
    }
  }

  async placeBlock(x: number, y: number, z: number): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    const heldItem = mc.heldItem;
    if (!heldItem) return { success: false, message: 'No item in hand' };

    // Find an adjacent solid block to place against
    const adjacentOffsets = [
      { dx: 0, dy: -1, dz: 0, face: { x: 0, y: 1, z: 0 } },  // below
      { dx: 0, dy: 1, dz: 0, face: { x: 0, y: -1, z: 0 } },  // above
      { dx: -1, dy: 0, dz: 0, face: { x: 1, y: 0, z: 0 } },  // west
      { dx: 1, dy: 0, dz: 0, face: { x: -1, y: 0, z: 0 } },  // east
      { dx: 0, dy: 0, dz: -1, face: { x: 0, y: 0, z: 1 } },  // north
      { dx: 0, dy: 0, dz: 1, face: { x: 0, y: 0, z: -1 } },  // south
    ];

    const Vec3Ctor = Vec3;
    const targetPos = new Vec3Ctor(x, y, z);

    for (const offset of adjacentOffsets) {
      const refPos = targetPos.offset(offset.dx, offset.dy, offset.dz);
      const refBlock = mc.world.getBlock(refPos);
      if (refBlock && refBlock.name !== 'air' && refBlock.name !== 'cave_air') {
        try {
          await mc.placeBlock(refBlock, new Vec3Ctor(offset.face.x, offset.face.y, offset.face.z));
          return { success: true, message: `Placed ${heldItem.name} at ${x}, ${y}, ${z}` };
        } catch {
          // Try next adjacent block
        }
      }
    }

    return { success: false, message: `No solid block adjacent to ${x}, ${y}, ${z} to place against` };
  }

  async dig(x: number, y: number, z: number): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    const block = mc.blockAt(new Vec3(x, y, z));
    if (!block || block.name === 'air') return { success: false, message: 'No block to dig' };

    const taskVersion = this.beginTask();

    try {
      this.ensureTaskActive(taskVersion);
      await this.timeout(mc.dig(block), 15000, 'dig');
      this.ensureTaskActive(taskVersion);
      return { success: true, message: `Dug ${block.name} at ${x}, ${y}, ${z}` };
    } catch (err: any) {
      if (taskVersion !== this.taskVersion || this.isCancelledError(err)) {
        return { success: false, message: 'Stopped digging.' };
      }
      return { success: false, message: `Failed to dig: ${err.message}` };
    }
  }

  async activateBlock(x: number, y: number, z: number): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    const block = mc.blockAt(new Vec3(x, y, z));
    if (!block) return { success: false, message: 'No block at position' };

    try {
      await mc.activateBlock(block);
      return { success: true, message: `Activated ${block.name}` };
    } catch (err: any) {
      return { success: false, message: `Failed to activate: ${err.message}` };
    }
  }

  // ─── Crafting ───

  async placeCraftingTable(): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    const nearbyTable = this.findNearestBlock('crafting_table', 4);
    if (nearbyTable) {
      return { success: true, message: 'Crafting table is already nearby.' };
    }

    const tableItem = mc.inventory.items().find(item => item.name === 'crafting_table');
    if (!tableItem) {
      return { success: false, message: 'No crafting table in inventory' };
    }

    const target = this.findNearbyPlacementTarget();
    if (!target) {
      return { success: false, message: 'No safe nearby spot to place a crafting table' };
    }

    try {
      await mc.equip(tableItem, 'hand');
      const placed = await this.placeBlock(target.x, target.y, target.z);
      if (!placed.success) return placed;
      return { success: true, message: 'Placed a crafting table nearby.' };
    } catch (err: any) {
      return { success: false, message: `Failed to place crafting table: ${err.message}` };
    }
  }

  async craft(recipeName: string, count: number = 1): Promise<ActionResult> {
    try {
      return await this.craftInternal(recipeName, count);
    } catch (err: any) {
      return { success: false, message: `Failed to craft: ${err.message}` };
    }
  }

  async smelt(itemName: string, fuelName: string, count: number = 1): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    // Find nearest furnace
    const furnaceBlock = this.findNearestBlock('furnace', 16);
    if (!furnaceBlock) return { success: false, message: 'No furnace nearby' };

    try {
      const furnace = await mc.openFurnace(furnaceBlock);
      const item = mc.inventory.items().find(i => i.name === itemName);
      const fuel = mc.inventory.items().find(i => i.name === fuelName);

      if (!item) return { success: false, message: `${itemName} not in inventory` };
      if (!fuel) return { success: false, message: `${fuelName} not in inventory` };

      await furnace.putInput(item.type, null, Math.min(count, item.count));
      await furnace.putFuel(fuel.type, null, 1);

      return { success: true, message: `Smelting ${count}x ${itemName} with ${fuelName}` };
    } catch (err: any) {
      return { success: false, message: `Failed to smelt: ${err.message}` };
    }
  }

  // ─── Chat ───

  async say(message: string): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    try {
      mc.chat(message);
      return { success: true, message: `Said: ${message}` };
    } catch (err: any) {
      return { success: false, message: `Chat failed: ${err.message}` };
    }
  }

  // ─── Navigation ───

  async pathfindTo(x: number, y: number, z: number): Promise<ActionResult> {
    return this.moveTo(x, y, z);
  }

  // ─── Combat ───

  async defend(range: number = 16): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc || !mc.entity) return { success: false, message: 'Bot not connected' };

    // Safety check
    if (mc.health < 6) {
      return { success: false, message: 'Health too low to fight, fleeing!' };
    }

    const hostileMobs = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'slime', 'phantom'];
    const nearbyHostile = Object.values(mc.entities).find(e => {
      if (!e || e === mc.entity) return false;
      const dist = mc.entity.position.distanceTo(e.position);
      return dist < range && hostileMobs.some(h => e.name?.includes(h));
    });

    if (!nearbyHostile) {
      return { success: true, message: 'No hostile mobs nearby' };
    }

    try {
      mc.attack(nearbyHostile);
      return { success: true, message: `Defending against ${nearbyHostile.name}` };
    } catch (err: any) {
      return { success: false, message: `Failed to attack: ${err.message}` };
    }
  }

  // ─── Safety ───

  async eat(foodName: string): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    const food = mc.inventory.items().find(i => i.name === foodName);
    if (!food) return { success: false, message: `${foodName} not in inventory` };

    try {
      await mc.equip(food, 'hand');
      await mc.consume();
      return { success: true, message: `Ate ${foodName}` };
    } catch (err: any) {
      return { success: false, message: `Failed to eat: ${err.message}` };
    }
  }

  // ─── Generic execute ───

  async execute(type: string, params: Record<string, any>): Promise<ActionResult> {
    try {
      switch (type) {
        case 'follow': return await this.follow(params.entityName);
        case 'moveTo': return await this.moveTo(params.x, params.y, params.z);
        case 'dig': return await this.dig(params.x, params.y, params.z);
        case 'place':
        case 'placeBlock': return await this.placeBlock(params.x, params.y, params.z);
        case 'smelt': return await this.smelt(params.itemName, params.fuelName, params.count);
        case 'openContainer': return await this.openContainer(params.x, params.y, params.z);
        case 'attack': return await this.attack(params.entityName);
        case 'jump': return await this.jump();
        case 'sneak': return await this.sneak(params.toggle ?? true);
        case 'equip': return await this.equip(params.itemName, params.slot);
        case 'toss': return await this.toss(params.itemName, params.count);
        case 'say': return await this.say(params.message);
        case 'stop': return await this.stop();
        case 'defend': return await this.defend(params.range);
        case 'pathfindTo': return await this.pathfindTo(params.x, params.y, params.z);
        case 'activateBlock': return await this.activateBlock(params.x, params.y, params.z);
        case 'craft': return await this.craft(params.recipeName, params.count);
        case 'placeCraftingTable': return await this.placeCraftingTable();
        case 'eat': return await this.eat(params.foodName);
        case 'mineCobbleGen': return await this.mineCobbleGen(params.cycles ?? 1, params.playerName, Boolean(params.continuous));
        case 'mineCursorBlock': return await this.mineCursorBlock();
        case 'collectResource': return await this.collectResource(params.resourceName || params.blockName || 'wood', params.targetCount ?? 1);
        case 'mineBlock': return await this.mineBlock(params.blockName);
        case 'mine': return await this.mineBlock(params.blockName || 'stone');
        case 'giveAll': return await this.giveAll(params.itemName, params.playerName);
        case 'getInventory': {
          const inv = this.getInventory();
          return { success: true, message: `Inventory: ${inv.items.map(i => `${i.count}x ${i.name}`).join(', ')}` };
        }
        case 'countItem': {
          const count = this.countItem(params.itemName);
          return { success: true, message: `I have ${count}x ${params.itemName}` };
        }
        case 'explore': return await this.explore();
        case 'findResource':
        case 'find': return await this.findResource(params.resourceName || params.blockName || 'wood');
        case 'listNearby':
        case 'list': return await this.listNearby();
        case 'build': return await this.build(params.pattern || 'house');
        default:
          return { success: false, message: `Unknown action: ${type}` };
      }
    } catch (err: any) {
      console.error(`[Actions] execute(${type}) crashed:`, err.message);
      return { success: false, message: `Action crashed: ${err.message}` };
    }
  }

  // ─── Autonomous exploration ───

  async explore(): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc || !mc.entity) return { success: false, message: 'Bot not connected' };

    try {
      const myPos = mc.entity.position;
      const offsets = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2, Math.PI];
      const angle = (mc.entity.yaw ?? 0) + offsets[this.scoutStep % offsets.length];
      const dist = 14 + (this.scoutStep % 3) * 6;
      this.scoutStep += 1;
      const targetX = Math.round(myPos.x + Math.cos(angle) * dist);
      const targetZ = Math.round(myPos.z + Math.sin(angle) * dist);
      const targetY = Math.round(myPos.y);

      this.setGoalNear(targetX, targetY, targetZ, 3);
      return { success: true, message: `Scouting toward ${targetX}, ${targetZ}` };
    } catch (err: any) {
      return { success: false, message: `Failed to explore: ${err.message}` };
    }
  }

  async findResource(resourceName: string, searchRange = 48): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc || !mc.entity) return { success: false, message: 'Bot not connected' };

    try {
      const normalizedResource = resourceName.toLowerCase().replace(/\s+/g, '_');
      const searchNames = this.getSearchBlockNames(resourceName);
      const ranges = [12, 24, searchRange].filter((value, index, array) => value > 0 && array.indexOf(value) === index);
      let foundBlock: any | null = null;

      for (const range of ranges) {
        foundBlock = this.findNearestMatchingBlock(searchNames, range, 10, true);
        if (foundBlock) break;
      }

      if (foundBlock) {
        this.setGoalNear(foundBlock.position.x, foundBlock.position.y, foundBlock.position.z, 2);
        const distance = Math.round(mc.entity.position.distanceTo(foundBlock.position) * 10) / 10;
        return {
          success: true,
          message: `I can see ${this.humanizeName(foundBlock.name)} ${distance}m away. Heading over.`,
        };
      }

      const clueBlock = this.findNearestMatchingBlock(this.getScoutClueNames(resourceName), Math.min(searchRange, 24), 10, true);
      if (clueBlock && !searchNames.some((name) => this.matchesSearchName(clueBlock.name, name))) {
        this.setGoalNear(clueBlock.position.x, clueBlock.position.y, clueBlock.position.z, 3);
        return {
          success: true,
          message: `I can't see ${this.humanizeName(normalizedResource)} yet. I'm checking near that ${this.humanizeName(clueBlock.name)}.`,
        };
      }

      const exploreResult = await this.explore();
      if (exploreResult.success) {
        return { success: true, message: `I can't see ${this.humanizeName(normalizedResource)} yet. I'm scouting a bit farther.` };
      }

      return { success: false, message: `Couldn't find visible ${resourceName} within walking distance` };
    } catch (err: any) {
      return { success: false, message: `Failed to find ${resourceName}: ${err.message}` };
    }
  }

  async collectResource(resourceName: string, targetCount = 1): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    const current = this.countResource(resourceName);
    if (current >= targetCount) {
      return { success: true, message: `I already have ${current}/${targetCount} ${resourceName}.` };
    }

    const searchNames = this.getSearchBlockNames(resourceName);
    const shouldRelaxForLogs = searchNames.some(name => name === 'log' || name.endsWith('_log'));
    let targetBlocks = this.findMatchingBlocks(searchNames, 10, 6, true, 6);
    if (targetBlocks.length === 0 && shouldRelaxForLogs) {
      targetBlocks = this.findMatchingBlocks(searchNames, 10, 6, true, 6, true);
    }

    if (targetBlocks.length === 0) {
      return this.findResource(resourceName, 48);
    }

    let result: ActionResult | null = null;
    let minedBlockName = resourceName;
    for (const targetBlock of targetBlocks) {
      minedBlockName = targetBlock.name;
      result = await this.mineVisibleBlock(targetBlock, resourceName);
      if (result.success) break;
      if (!/(timed out|can't reach|lost sight|can't see a clear)/i.test(result.message)) {
        return result;
      }
    }

    if (!result?.success) {
      const searchResult = await this.findResource(resourceName, 48);
      if (searchResult.success) return searchResult;
      return result ?? { success: false, message: `Couldn't gather ${resourceName} right now.` };
    }

    const updatedCount = this.countResource(resourceName);
    if (updatedCount > current) {
      return {
        success: true,
        message: `Got ${this.humanizeName(minedBlockName)}. ${updatedCount}/${targetCount} ${resourceName} now.`,
      };
    }

    return {
      success: true,
      message: `Broke ${this.humanizeName(minedBlockName)}. Still gathering ${resourceName}.`,
    };
  }

  async listNearby(): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc || !mc.entity) return { success: false, message: 'Bot not connected' };

    try {
      const myPos = mc.entity.position;
      const found = new Set<string>();

      for (let dx = -10; dx <= 10; dx++) {
        for (let dy = -5; dy <= 5; dy++) {
          for (let dz = -10; dz <= 10; dz++) {
            const block = mc.blockAt(new Vec3(Math.round(myPos.x) + dx, Math.round(myPos.y) + dy, Math.round(myPos.z) + dz));
            if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'grass' && block.name !== 'tall_grass') {
              found.add(block.name);
            }
          }
        }
      }

      const interesting = Array.from(found).filter(n => 
        !n.includes('grass') && !n.includes('dirt') && !n.includes('stone') && n !== 'water' && n !== 'lava'
      ).slice(0, 10);

      return { success: true, message: `I see: ${interesting.join(', ') || 'just grass and stone'}` };
    } catch (err: any) {
      return { success: false, message: `Failed to scan: ${err.message}` };
    }
  }

  async build(pattern: string): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    return { success: true, message: `Build command received! I can help gather materials for a ${pattern}. Tell me what to collect!` };
  }

  // Mine any block type nearby
  async mineBlock(blockName: string): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc || !mc.entity) return { success: false, message: 'Bot not connected' };

    try {
      const searchNames = this.getSearchBlockNames(blockName);
      const shouldRelaxForLogs = searchNames.some(name => name === 'log' || name.endsWith('_log'));
      let targetBlocks = this.findMatchingBlocks(searchNames, 8, 4, true, 5);
      if (targetBlocks.length === 0 && shouldRelaxForLogs) {
        targetBlocks = this.findMatchingBlocks(searchNames, 8, 4, true, 5, true);
      }

      if (targetBlocks.length === 0) {
        const searchResult = await this.findResource(blockName, 64);
        if (searchResult.success) {
          return {
            success: true,
            message: `Looking for ${blockName} now. ${searchResult.message}`,
          };
        }
        return { success: false, message: `No exposed ${blockName} found nearby.` };
      }

      let lastResult: ActionResult | null = null;
      for (const targetBlock of targetBlocks) {
        lastResult = await this.mineVisibleBlock(targetBlock, blockName);
        if (lastResult.success) return lastResult;
        if (!/(timed out|can't reach|lost sight|can't see a clear)/i.test(lastResult.message)) {
          return lastResult;
        }
      }

      return lastResult ?? { success: false, message: `No exposed ${blockName} found nearby.` };
    } catch (err: any) {
      return { success: false, message: `Failed to mine: ${err.message}` };
    }
  }

  async mineCursorBlock(): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc || !mc.entity) return { success: false, message: 'Bot not connected' };
    if (typeof mc.blockAtCursor !== 'function') {
      return { success: false, message: "I can't target the block in front of me on this server version" };
    }

    try {
      const targetBlock = mc.blockAtCursor(6, (block: any) => block && !this.airLikeBlocks.has(block.name));
      if (!targetBlock) {
        return { success: false, message: "I don't see a block directly in front of me" };
      }

      return await this.mineVisibleBlock(targetBlock, targetBlock.name);
    } catch (err: any) {
      return { success: false, message: `Failed to mine the block in front of me: ${err.message}` };
    }
  }

  private isWaterBlock(blockName: string | undefined): boolean {
    return Boolean(blockName && (blockName === 'water' || blockName.includes('water')));
  }

  private isLavaBlock(blockName: string | undefined): boolean {
    return Boolean(blockName && (blockName === 'lava' || blockName.includes('lava')));
  }

  private isDangerousBlock(blockName: string | undefined): boolean {
    return this.isLavaBlock(blockName) || blockName === 'fire' || blockName === 'soul_fire' || blockName === 'campfire';
  }

  private isSafeStandingPosition(position: Vec3): boolean {
    const mc = this.bot.getBot();
    if (!mc) return false;

    const feet = mc.blockAt(position);
    const head = mc.blockAt(position.offset(0, 1, 0));
    const below = mc.blockAt(position.offset(0, -1, 0));
    if (feet && !this.airLikeBlocks.has(feet.name)) return false;
    if (head && !this.airLikeBlocks.has(head.name)) return false;
    if (!below || this.airLikeBlocks.has(below.name) || this.isDangerousBlock(below.name)) return false;

    const dangerOffsets = [
      [0, 0, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [1, -1, 0],
      [-1, -1, 0],
      [0, -1, 1],
      [0, -1, -1],
    ];

    return !dangerOffsets.some(([dx, dy, dz]) => {
      const block = mc.blockAt(position.offset(dx, dy, dz));
      return this.isDangerousBlock(block?.name);
    });
  }

  private isBotStandingSafely(): boolean {
    const mc = this.bot.getBot();
    if (!mc?.entity?.position) return false;
    const position = new Vec3(
      Math.floor(mc.entity.position.x),
      Math.floor(mc.entity.position.y),
      Math.floor(mc.entity.position.z),
    );
    return this.isSafeStandingPosition(position);
  }

  private getCobbleGenFluidScore(position: Vec3): { water: number; lava: number } {
    const mc = this.bot.getBot();
    if (!mc) return { water: 0, lava: 0 };

    const offsets = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [1, -1, 0],
      [-1, -1, 0],
      [0, -1, 1],
      [0, -1, -1],
      [0, 1, 0],
      [0, -1, 0],
    ];

    let water = 0;
    let lava = 0;
    for (const [dx, dy, dz] of offsets) {
      const neighbor = mc.blockAt(position.offset(dx, dy, dz));
      if (this.isWaterBlock(neighbor?.name)) water += 1;
      if (this.isLavaBlock(neighbor?.name)) lava += 1;
    }

    return { water, lava };
  }

  private isCobbleGenCandidate(block: any): boolean {
    if (!block?.position || block.name !== 'cobblestone') return false;
    const fluids = this.getCobbleGenFluidScore(block.position);
    return fluids.water > 0 && fluids.lava > 0;
  }

  private findCobbleGenBlock(playerName?: string): any | null {
    const mc = this.bot.getBot();
    if (!mc || !mc.entity) return null;

    const { entity: player } = playerName ? this.resolvePlayerEntity(playerName) : { entity: null };
    const candidates = new Map<string, any>();

    if (typeof mc.blockAtCursor === 'function') {
      const cursorBlock = mc.blockAtCursor(5, (block: any) => block && block.name === 'cobblestone');
      if (cursorBlock && this.hasPracticalMiningSight(cursorBlock, false)) {
        candidates.set(`${cursorBlock.position.x},${cursorBlock.position.y},${cursorBlock.position.z}`, cursorBlock);
      }
    }

    const origins = [
      player?.position,
      mc.entity.position,
    ].filter(Boolean);

    for (const origin of origins) {
      for (let dx = -5; dx <= 5; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dz = -5; dz <= 5; dz++) {
            const x = Math.round(origin.x) + dx;
            const y = Math.round(origin.y) + dy;
            const z = Math.round(origin.z) + dz;
            const block = mc.blockAt(new Vec3(x, y, z));
            if (block?.name !== 'cobblestone') continue;
            if (!this.hasPracticalMiningSight(block, false)) continue;
            candidates.set(`${x},${y},${z}`, block);
          }
        }
      }
    }

    const scored = [...candidates.values()]
      .map((block) => {
        const fluids = this.getCobbleGenFluidScore(block.position);
        const isGenerator = fluids.water > 0 && fluids.lava > 0;
        const playerDistance = player?.position?.distanceTo(block.position) ?? 0;
        const botDistance = mc.entity.position.distanceTo(block.position);
        return {
          block,
          score: (isGenerator ? -100 : 0) - (fluids.water + fluids.lava) + playerDistance + botDistance * 0.35,
        };
      })
      .sort((a, b) => a.score - b.score);

    const generatorBlock = scored.find(entry => this.isCobbleGenCandidate(entry.block));
    return generatorBlock?.block ?? scored[0]?.block ?? null;
  }

  // Find and mine cobblestone from a cobblestone generator.
  async mineCobbleGen(cycles = 1, playerName?: string, continuous = false): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc || !mc.entity) return { success: false, message: 'Bot not connected' };

    const maxCycles = Math.max(1, Math.min(128, Math.floor(Number.isFinite(cycles) ? cycles : 1)));
    const taskVersion = this.beginTask();
    let mined = 0;
    let attempts = 0;
    let transientFailures = 0;

    try {
      const targetBlock = this.findCobbleGenBlock(playerName);
      if (!targetBlock) {
        return { success: false, message: 'No cobblestone generator block found. Stand Hermes by the lava/water cobble block.' };
      }

      if (!this.isCobbleGenCandidate(targetBlock)) {
        return { success: false, message: 'I see cobblestone, but not a generator block touching both lava and water.' };
      }

      if (!this.isBotStandingSafely()) {
        return { success: false, message: 'I am too close to lava/fire to mine safely. Put Hermes on a dry solid block beside the generator.' };
      }

      const targetPos = targetBlock.position.clone?.() ?? new Vec3(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z);
      if (typeof mc.lookAt === 'function') {
        await mc.lookAt(targetPos.offset(0.5, 0.5, 0.5), true).catch(() => {});
      }

      while (continuous || (mined < maxCycles && attempts < maxCycles * 5)) {
        attempts += 1;
        this.ensureTaskActive(taskVersion);
        const cobbleBlock = mc.blockAt(targetPos);

        if (cobbleBlock?.name !== 'cobblestone') {
          await this.sleep(250, taskVersion);
          continue;
        }

        const result = await this.mineVisibleBlock(cobbleBlock, 'cobblestone', taskVersion, false);
        if (!result.success) {
          if (/stopped/i.test(result.message)) return result;
          if (continuous) {
            transientFailures += 1;
            await this.sleep(Math.min(1500, 250 + transientFailures * 150), taskVersion);
            continue;
          }
          if (mined > 0) break;
          return result;
        }

        mined += 1;
        transientFailures = 0;
        await this.sleep(250, taskVersion);
      }

      const cobbleCount = this.countResource('cobblestone');
      return {
        success: mined > 0,
        message: mined > 0
          ? `Mined ${mined} cobblestone from the generator. Now have ${cobbleCount} cobble.`
          : 'No cobblestone generated in time.',
      };
    } catch (err: any) {
      if (this.isCancelledError(err)) {
        return { success: false, message: 'Stopped that job.' };
      }
      return { success: false, message: `Failed to mine cobble: ${err.message}` };
    }
  }

  // Give all of an item to a player
  async giveAll(itemName: string, playerName: string): Promise<ActionResult> {
    const mc = this.bot.getBot();
    if (!mc) return { success: false, message: 'Bot not connected' };

    const taskVersion = this.beginTask();

    try {
      const { entity: player, ambiguous } = this.resolvePlayerEntity(playerName);
      if (ambiguous) {
        return { success: false, message: `I see more than one player matching ${playerName}` };
      }
      if (!player) {
        return { success: false, message: `Can't see ${playerName} nearby` };
      }

      this.clearPathfinderGoal();
      this.setGoalNear(player.position.x, player.position.y, player.position.z, 2);
      let waited = 0;
      while (waited < 5000) {
        await this.sleep(250, taskVersion);
        waited += 250;
        if (!mc.entity) break;
        if (mc.entity.position.distanceTo(player.position) <= 3) break;
      }
      this.clearPathfinderGoal();
      this.ensureTaskActive(taskVersion);

      await mc.lookAt(player.position.offset(0, 1.5, 0));

      const requested = this.normalizeItemRequest(itemName);
      const aliases = this.getResourceAliases(requested);
      const items = mc.inventory.items().filter(i => 
        i.name === requested ||
        i.name.includes(requested) ||
        aliases.some(alias => this.matchesSearchName(i.name, alias))
      );
      const totalCount = items.reduce((sum, i) => sum + i.count, 0);

      if (totalCount === 0) {
        return { success: false, message: `No ${requested.replace(/_/g, ' ')} in inventory` };
      }

      for (const item of items) {
        try {
          this.ensureTaskActive(taskVersion);
          await mc.tossStack(item);
          await this.sleep(200, taskVersion);
        } catch {
          // Continue with next item
        }
      }

      return { success: true, message: `Gave ${totalCount}x ${requested.replace(/_/g, ' ')} to ${playerName}` };
    } catch (err: any) {
      if (taskVersion !== this.taskVersion || this.isCancelledError(err)) {
        return { success: false, message: 'Stopped handing items over.' };
      }
      return { success: false, message: `Failed to give items: ${err.message}` };
    }
  }

  // Get inventory summary
  getInventory(): { items: { name: string; count: number }[]; totalSlots: number; usedSlots: number } {
    const mc = this.bot.getBot();
    if (!mc) return { items: [], totalSlots: 36, usedSlots: 0 };

    const items = mc.inventory.items().map(i => ({ name: i.name, count: i.count }));
    return {
      items,
      totalSlots: 36,
      usedSlots: items.length,
    };
  }

  // Count specific item
  countItem(itemName: string): number {
    const mc = this.bot.getBot();
    if (!mc) return 0;
    return mc.inventory.items()
      .filter(i => i.name === itemName)
      .reduce((sum, i) => sum + i.count, 0);
  }

  countResource(resourceName: string): number {
    const mc = this.bot.getBot();
    if (!mc) return 0;

    const aliases = this.getResourceAliases(resourceName);
    return mc.inventory.items()
      .filter(item => aliases.some(alias => this.matchesSearchName(item.name, alias)))
      .reduce((sum, item) => sum + item.count, 0);
  }

  private findNearestBlock(name: string, range: number): any {
    const mc = this.bot.getBot();
    if (!mc || !mc.entity) return null;

    const myPos = mc.entity.position;
    let nearest: any = null;
    let nearestDist = Infinity;

    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        for (let dz = -range; dz <= range; dz++) {
          const x = Math.round(myPos.x) + dx;
          const y = Math.round(myPos.y) + dy;
          const z = Math.round(myPos.z) + dz;
          const block = mc.blockAt(new Vec3(x, y, z));
          if (block?.name === name) {
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearest = block;
            }
          }
        }
      }
    }
    return nearest;
  }
}
