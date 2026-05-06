# Hermes The Miner

Hermes The Miner is a local Minecraft bot for Java Edition Open-to-LAN worlds. It joins as one player named `Hermes`, listens to Minecraft chat, and can follow, stop, mine, gather, craft, drop items, and respond through the local Hermes Agent setup.

This repo is the LAN version only. It does not include the HermesLink/modpack variant.

## Requirements

- Node.js 20 or newer.
- npm.
- Minecraft Java Edition.
- A Minecraft world opened to LAN.
- Hermes Agent / Hermes CLI installed and configured on your machine.

Hermes Agent is required because the bot can use your local `hermes` CLI for agent decisions.

## Install

From the project folder:

```bash
npm install
npm run build
```

Or run the setup script:

```bash
./scripts/setup.sh
```

## Launch

1. Open Minecraft Java Edition.
2. Open your world to LAN.
3. Copy the LAN port shown in Minecraft chat.
4. Start the bridge:

```bash
./scripts/bridge-ctl.sh start
```

5. Connect Hermes to your LAN world:

```bash
./scripts/bridge-ctl.sh connect localhost <LAN_PORT>
```

6. Start the agent loop:

```bash
./scripts/bridge-ctl.sh agent-start
```

Example:

```bash
./scripts/bridge-ctl.sh start
./scripts/bridge-ctl.sh connect localhost 54321
./scripts/bridge-ctl.sh agent-start
```

## Use In Minecraft Chat

After Hermes joins, type commands in Minecraft chat:

```text
hermes follow me
hermes stop
hermes come here
hermes mine cobblestone generator
hermes mine wood
hermes craft a wooden pickaxe
hermes make a crafting table
hermes drop cobblestone
```

## Stop Hermes

Disconnect the bot:

```bash
./scripts/bridge-ctl.sh disconnect
```

Stop the bridge:

```bash
./scripts/bridge-ctl.sh stop
```

## Useful Commands

```bash
./scripts/bridge-ctl.sh status
./scripts/bridge-ctl.sh perceive
./scripts/bridge-ctl.sh agent-status
./scripts/bridge-ctl.sh log
```

## Development

Run tests:

```bash
npm test
```

Build TypeScript:

```bash
npm run build
```

## License

Hermes The Miner is released under the MIT License. See [LICENSE](LICENSE).
