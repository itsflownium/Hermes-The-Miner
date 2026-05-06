# Hermes the Miner

Hermes the Miner is a local Minecraft companion bot powered by the Hermes CLI. It connects to a Minecraft Java Open-to-LAN world with Mineflayer, joins as one player named `Hermes`, listens to chat, mines and gathers resources on request, crafts useful items, and exposes a local REST API for external control.

This folder is prepared as a normal source project for a future GitHub repository. New users can download the files, install dependencies, open a Minecraft world to LAN, and run Hermes locally. It does not include generated build output, local logs, runtime memory, or installed dependencies.

## What Is Included

- `src/` - Node.js REST/WebSocket bridge and Mineflayer bot logic.
- `test/` - Automated tests for actions, chat parsing, perception, CLI behavior, and agent loop behavior.
- `data/` - Runtime memory folder placeholder.
- `scripts/` - Setup, launch, and bridge control scripts for Open-to-LAN use.
- `skills/minecraft-agent/` - Hermes skill file for controlling the bridge from Hermes Agent.
- `references/` - Command and action reference docs.

## Requirements

- Node.js 20 or newer.
- npm.
- Hermes CLI installed and configured.
- Minecraft Java Edition with a server or Open-to-LAN world.

## Setup

From the project root:

```bash
./scripts/setup.sh
```

Manual bridge-only setup:

```bash
npm install
npm test
npm run build
```

## Start With An Open-To-LAN World

1. Open your Minecraft world to LAN.
2. Copy the green LAN port Minecraft shows in chat.
3. Start the bridge and connect Hermes:

```bash
./scripts/bridge-ctl.sh start
./scripts/bridge-ctl.sh connect localhost <LAN_PORT>
./scripts/bridge-ctl.sh agent-start
```

Disconnect and stop:

```bash
./scripts/bridge-ctl.sh disconnect
./scripts/bridge-ctl.sh stop
```

## Useful Minecraft Chat Prompts

Type these in Minecraft chat after Hermes joins:

```text
hermes follow me
hermes stop
hermes mine cobblestone generator
hermes drop cobblestone
hermes craft a wooden pickaxe
hermes make a crafting table
```

## What Hermes Can Do

- Join an Open-to-LAN world as `Hermes`.
- Respond to natural Minecraft chat commands.
- Follow, stop, come to the player, and idle when no goal is active.
- Mine visible blocks and cobblestone generators.
- Gather resources such as wood and cobblestone.
- Craft items such as crafting tables and wooden tools.
- Drop items to the player.
- Use the local Hermes CLI for agent decisions when the agent loop is running.

## Bridge API

The bridge listens locally by default:

- REST API: `http://localhost:3847`
- WebSocket: `ws://localhost:3848`

Common endpoints:

- `GET /health`
- `POST /connect`
- `POST /disconnect`
- `POST /agent/start`
- `POST /agent/stop`
- `GET /perceive`
- `POST /action`

Example API connect request:

```bash
curl -s -X POST http://localhost:3847/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":25565,"username":"Hermes","auth":"offline"}'
```

## Development

Bridge checks:

```bash
npm test
npm run build
```

Generated/runtime files are intentionally ignored by Git:

- `node_modules/`
- `dist/`
- `bridge.log`
- `.bridge.pid`
- `data/hermes-memory.json`

## Publishing Notes

This project is ready to publish later as files in a normal GitHub repository named `Hermes the Miner`. Do not upload generated folders like `node_modules`, `dist`, logs, or local memory files.

No repository has been created yet. No one-line MCP install command is included yet. If MCP packaging is added later, this repository can be used as the source project.
