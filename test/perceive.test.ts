import assert from 'node:assert/strict';
import test from 'node:test';
import { Vec3 } from 'vec3';
import { Perception } from '../src/perceive.js';

test('nearby player entities prefer usernames over generic player labels', () => {
  const mc = {
    entity: {
      position: new Vec3(0, 64, 0),
    },
    entities: {
      self: null as any,
      player1: {
        type: 'player',
        username: 'Flownium',
        name: 'player',
        position: new Vec3(3, 64, 3),
      },
    },
    blockAt: () => ({ biome: { name: 'plains' }, light: 15 }),
    inventory: {
      items: () => [],
    },
    time: { timeOfDay: 6000 },
    rainState: 0,
    thunderState: 0,
    findBlocks: () => [],
    canSeeBlock: () => true,
  };

  mc.entities.self = mc.entity;

  const perception = new Perception({
    getBot: () => mc,
  } as any);

  const entities = perception.getNearbyEntities(16);

  assert.equal(entities[0]?.name, 'Flownium');
  assert.equal(entities[0]?.type, 'player');
});
