# Hermes Bridge — Action Reference

All actions are called via `POST /action` with a JSON body.

## Movement

### moveTo
Walk to coordinates using pathfinding.
```json
{"type": "moveTo", "x": 100, "y": 64, "z": -200}
```
Timeout: 30 seconds.

### follow
Follow the nearest entity matching the name.
```json
{"type": "follow", "entityName": "Steve"}
```

### jump
Jump in place.
```json
{"type": "jump"}
```

### sneak
Toggle sneak mode.
```json
{"type": "sneak", "toggle": true}
```

## Inventory

### equip
Hold an item in your hand.
```json
{"type": "equip", "itemName": "diamond_sword", "slot": "hand"}
```

### toss
Drop items from inventory.
```json
{"type": "toss", "itemName": "cobblestone", "count": 64}
```

### useHeldItem
Right-click with the currently held item.
```json
{"type": "useHeldItem"}
```

### openContainer
Open a chest, furnace, or other container.
```json
{"type": "openContainer", "x": 100, "y": 64, "z": -200}
```

## Interaction

### attack
Attack the nearest entity matching the name.
```json
{"type": "attack", "entityName": "zombie"}
```

### placeBlock
Place the held block at a position.
```json
{"type": "placeBlock", "x": 100, "y": 64, "z": -200}
```

### dig
Break a block at a position.
```json
{"type": "dig", "x": 100, "y": 64, "z": -200}
```
Timeout: 15 seconds.

### activateBlock
Right-click a block (open door, press button, use lever).
```json
{"type": "activateBlock", "x": 100, "y": 64, "z": -200}
```

## Crafting

### craft
Craft an item using available materials.
```json
{"type": "craft", "recipeName": "oak_planks", "count": 4}
```

### smelt
Smelt an item in the nearest furnace.
```json
{"type": "smelt", "itemName": "iron_ore", "fuelName": "coal", "count": 1}
```

## Chat

### say
Send a chat message to the server.
```json
{"type": "say", "message": "Hello everyone!"}
```

## Navigation

### pathfindTo
Smart pathfinding to coordinates (same as moveTo).
```json
{"type": "pathfindTo", "x": 100, "y": 64, "z": -200}
```

## Combat

### defend
Attack hostile mobs within range. Flee if health < 6.
```json
{"type": "defend", "range": 16}
```

## Safety

### eat
Eat food from inventory.
```json
{"type": "eat", "foodName": "bread"}
```

## Safety Rules

- **Pathfinding timeout:** 30 seconds
- **Action timeout:** 15 seconds (30s for pathfinding)
- **Flee threshold:** Health < 6
- **Auto-eat:** Triggers when food < 10 and food is available
- **Input validation:** Actions check prerequisites before executing
