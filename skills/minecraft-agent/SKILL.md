---
name: minecraft-agent
description: Play Minecraft autonomously. Explore, build, fight, and chat with players. Uses Hermes Bridge to control a bot on any Minecraft server.
version: 0.1.0
tags: [minecraft, gaming, bot, agent, autonomous]
---

# Hermes the Miner

Play Minecraft alongside the user in an Open-to-LAN world. The bot joins as `Hermes`, gathers resources, mines, crafts, follows, stops, and chats through the local bridge.

## When to Use

Load this skill when:
- User mentions Minecraft, wants to play, or wants an AI companion in-game
- User wants to set up the Hermes Bridge bot
- User asks about the minecraft-agent Open-to-LAN bridge

## Quick Start

```bash
# 1. First time setup
cd ~/.hermes/projects/hermes-minecraft
./scripts/setup.sh

# 2. Start the bridge (in another terminal)
cd ~/.hermes/projects/hermes-minecraft
./scripts/start-bridge.sh

# 3. Connect the bot to a server
curl -X POST http://localhost:3847/connect \
  -H 'Content-Type: application/json' \
  -d '{"host": "SERVER_IP", "port": 25565, "username": "Hermes"}'

# 4. Start the autonomous agent loop
curl -X POST http://localhost:3847/agent/start
```

## How It Works

```
Minecraft Server or Open-to-LAN world
      ↑ (joins as a player)
Hermes Bridge (Node.js + Mineflayer) — localhost:3847
      ↑ (HTTP / WebSocket)
Hermes CLI (you — the agent brain)
      ↑ (your configured model)
Your LLM (Nous, OpenRouter, Anthropic, etc.)
```

The bridge is a local HTTP server that exposes a Mineflayer bot as an API.
The agent loop calls `hermes chat -q` for each decision — using YOUR configured model.

## Bridge API Reference

Base URL: `http://localhost:3847`
WebSocket: `ws://localhost:3848`

### Connection

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Check if bot is connected |
| `/connect` | POST | Connect bot to server `{"host", "port", "username"}` |
| `/disconnect` | POST | Disconnect bot |
| `/respawn` | POST | Force respawn after death |

### World Observation

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/perceive` | GET | Full world snapshot (position, health, entities, blocks, inventory) |
| `/inventory` | GET | Inventory items |
| `/chat/history` | GET | Recent chat messages `?limit=20` |

### Actions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/action` | POST | Execute an action `{"type": "actionName", ...params}` |

**Movement:**
- `moveTo(x, y, z)` — walk to coordinates
- `follow(entityName)` — follow a player/mob
- `jump()` — jump
- `sneak(toggle)` — sneak on/off

**Inventory:**
- `equip(itemName, slot)` — hold item
- `toss(itemName, count)` — drop items
- `useHeldItem()` — right-click with held item
- `openContainer(x, y, z)` — open chest/furnace

**Interaction:**
- `attack(entityName)` — attack entity
- `placeBlock(x, y, z)` — place block from hand
- `dig(x, y, z)` — break block
- `activateBlock(x, y, z)` — right-click block

**Crafting:**
- `craft(recipeName, count)` — craft item
- `smelt(itemName, fuelName, count)` — smelt in furnace

**Chat:**
- `say(message)` — send chat message

**Navigation:**
- `pathfindTo(x, y, z)` — smart pathfinding

**Combat:**
- `defend(range)` — attack hostiles, flee if low HP

**Safety:**
- `eat(foodName)` — consume food

### Model

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/model` | GET | Current model + available providers |
| `/model/providers/:id/models` | GET | Models for a specific provider |
| `/model` | POST | Switch model `{"provider", "model"}` |

### Agent Loop

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agent/start` | POST | Start autonomous decision loop |
| `/agent/stop` | POST | Stop the loop |
| `/agent/status` | GET | Loop status, current model, iterations |

## Behavior Modes

Set by sending `POST /agent/mode` to the bridge.

- **PASSIVE** — Observe only, respond to chat, no autonomous actions
- **EXPLORER** — Walk around, report findings, avoid combat
- **BUILDER** — Gather materials, build structures on command
- **FIGHTER** — Patrol, attack hostile mobs, protect players
- **HELPER** — Follow nearest player, assist their tasks (default)

## Decision Heuristics

When playing Minecraft autonomously, follow these rules:

1. **Safety first.** Always check health before engaging mobs. Flee at < 6 HP. Auto-eat when food < 10.
2. **Gather basics first.** Punch trees → craft wooden pickaxe → mine stone → craft stone tools.
3. **Respond to players.** When someone chats, respond with `say()`. Prioritize player commands.
4. **Don't get lost.** Check coordinates via `/perceive`. If lost, pathfind to a known landmark or player.
5. **Night = danger.** At night, either find shelter or stay near light sources. Fight only if equipped.
6. **Explore carefully.** Don't walk into lava. Watch for cliffs. Light up dark areas.

## Chat Commands (in-game)

Players can use natural chat commands in Minecraft chat:

- `hermes status` — Bot replies with health, position, model, behavior mode
- `hermes come here` — Bot pathfinds to the player who said it
- `hermes follow me` — Bot follows the player
- `hermes stop` — Bot stops current action
- `hermes help` — List commands

The bot also understands natural language: "go chop trees", "build a house", "come here", "fight that zombie".

## Error Recovery

- **Disconnected:** Try reconnecting. Report in chat if failed.
- **Died:** Bot auto-respawns. Report "I died, respawning."
- **Pathfinding fails:** Try alternative route or report stuck.
- **Action timeout:** Cancel and try something else.
- **No food:** Find and kill animals, or ask a player for food.

## Example Interactions

**Starting the bot:**
```
User: "Start the Minecraft bot and connect to my server at 192.168.1.50"
Agent: Calls POST /connect with the server IP, then POST /agent/start
```

**Checking status:**
```
User: "What's the bot doing?"
Agent: Calls GET /agent/status and GET /perceive, reports back
```

**Changing model:**
```
User: "Switch to Claude"
Agent: Calls POST /model with provider="openrouter" model="anthropic/claude-sonnet-4"
```

## Files

- `~/.hermes/projects/hermes-minecraft/src/` — The bot (Node.js + Mineflayer)
- `~/.hermes/projects/hermes-minecraft/scripts/` — Setup and start scripts
- `~/.hermes/projects/hermes-minecraft/references/` — Action and command docs
