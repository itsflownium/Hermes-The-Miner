# Hermes the Miner — Command Reference

## Quick Start Commands

```bash
# Start the bridge server
./scripts/bridge-ctl.sh start

# Connect bot to your server
./scripts/bridge-ctl.sh connect localhost 25565

# Start the AI agent
./scripts/bridge-ctl.sh agent-start

# Check bot status
./scripts/bridge-ctl.sh status
```

## Bridge Control Commands

| Command | Description |
|---------|-------------|
| `bridge-ctl.sh start` | Start the bridge server |
| `bridge-ctl.sh stop` | Stop the bridge server |
| `bridge-ctl.sh status` | Check if bridge is running |
| `bridge-ctl.sh connect <host> <port> [version]` | Connect Hermes to server |
| `bridge-ctl.sh disconnect` | Disconnect bot from server |
| `bridge-ctl.sh agent-start` | Start autonomous AI agent |
| `bridge-ctl.sh agent-stop` | Stop autonomous AI agent |
| `bridge-ctl.sh agent-status` | Get agent status |
| `bridge-ctl.sh perceive` | Get world snapshot |
| `bridge-ctl.sh model` | Show current AI model |
| `bridge-ctl.sh chat "<message>"` | Send chat as bot |
| `bridge-ctl.sh log` | Show recent bridge logs |

## Bot Actions

```bash
# Movement
bridge-ctl.sh action moveTo '{"x":100,"y":64,"z":200}'
bridge-ctl.sh action follow '{"entityName":"Steve"}'
bridge-ctl.sh action jump
bridge-ctl.sh action stop

# Combat
bridge-ctl.sh action attack '{"entityName":"zombie"}'
bridge-ctl.sh action defend

# Building
bridge-ctl.sh action dig '{"x":10,"y":64,"z":5}'
bridge-ctl.sh action placeBlock '{"x":10,"y":65,"z":5}'

# Inventory
bridge-ctl.sh action equip '{"itemName":"diamond_sword","slot":"hand"}'
bridge-ctl.sh action toss '{"itemName":"cobblestone","count":32}'

# Chat
bridge-ctl.sh action say '{"message":"Hello!"}'
bridge-ctl.sh chat "Hello everyone!"
```

## In-Game Chat Commands

Players can talk to the bot naturally in Minecraft chat:

```
Hermes come here
Hermes follow me
Hermes what's up?
Hermes help me build
Hermes defend me
```

## Setup (First Time)
```bash
cd hermes-the-miner
./scripts/setup.sh
```

## One-Click Launch
```bash
./scripts/launch.sh
```
