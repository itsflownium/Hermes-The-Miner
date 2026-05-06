export interface BotConfig {
  host: string;
  port: number;
  username: string;
  version?: string;
  auth?: 'offline' | 'microsoft';
}

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface ItemInfo {
  name: string;
  count: number;
  slot: number;
}

export interface EntityInfo {
  name: string;
  type: string;
  distance: number;
  position: Position;
}

export interface BlockInfo {
  name: string;
  position: Position;
  distance: number;
}

export interface WorldSnapshot {
  position: Position;
  health: number;
  food: number;
  inventory: ItemInfo[];
  nearbyEntities: EntityInfo[];
  nearbyBlocks: BlockInfo[];
  biome: string;
  time: string;
  weather: string;
  lightLevel: number;
}

export interface ActionResult {
  success: boolean;
  message: string;
  data?: any;
}

export interface ModelInfo {
  model: string;
  provider: string;
  display: string;
  available: boolean;
}

export interface ProviderInfo {
  id: string;
  name: string;
  available: boolean;
}

export interface AgentStatus {
  running: boolean;
  model: string;
  iterations: number;
  lastAction: string;
  behaviorMode: BehaviorMode;
  activeGoal: ActiveGoal | null;
  lastPlan: string | null;
  knownPlayers: string[];
}

export type BehaviorMode = 'PASSIVE' | 'EXPLORER' | 'BUILDER' | 'DEFENDER' | 'HELPER';

export type GoalKind = 'follow' | 'gather' | 'protect' | 'explore' | 'build' | 'chat' | 'general';

export interface ActiveGoal {
  id: string;
  summary: string;
  kind: GoalKind;
  requestedBy?: string;
  targetPlayer?: string;
  resourceName?: string;
  targetCount?: number;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  updatedAt: number;
}

export interface PlayerMemory {
  username: string;
  firstSeenAt: number;
  lastSeenAt: number;
  lastSeenPosition?: Position;
  interactions: number;
  lastMessage?: string;
  lastRequest?: string;
  notes: string[];
}

export interface MemoryEvent {
  timestamp: number;
  type: string;
  summary: string;
}

export interface HermesMemoryState {
  botName: string;
  activeGoal: ActiveGoal | null;
  players: Record<string, PlayerMemory>;
  notes: string[];
  events: MemoryEvent[];
  updatedAt: number;
}

export interface BridgeEvent {
  type: 'chat' | 'death' | 'health' | 'error' | 'action' | 'entity' | 'status';
  data: any;
  timestamp: number;
}
