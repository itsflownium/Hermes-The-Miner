# Publishing Hermes The Miner

This project is not published to GitHub yet. These notes are here so the folder can be uploaded later as a normal source repository.

## Repository Scope

Hermes The Miner is the Open-to-LAN Minecraft bot project only. It includes the Node.js bridge, Mineflayer bot, Hermes Agent skill, scripts, tests, and command references needed for users to download and run the bot in a LAN world.

Recommended GitHub repository name: `Hermes-The-Miner`.

The public project name should be written as `Hermes The Miner`. The repository slug should use hyphens because GitHub repository URLs should not contain spaces.

## Files To Include

Include these normal project source files and folders:

- `.github/`
- `.gitattributes`
- `.gitignore`
- `.env.example`
- `README.md`
- `LICENSE`
- `PUBLISHING.md`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `src/`
- `test/`
- `data/.gitkeep`
- `scripts/`
- `skills/minecraft-agent/`
- `references/`

## Files Not To Include

These are generated runtime files and should not be uploaded:

- `node_modules/`
- `dist/`
- `bridge.log`
- `.bridge.pid`
- `data/hermes-memory.json`

The `.gitignore` already excludes these if the folder is turned into a git repository later.

## Fresh Download Check

After downloading the repository on another machine, users should be able to run:

```bash
./scripts/setup.sh
./scripts/bridge-ctl.sh start
./scripts/bridge-ctl.sh connect localhost <LAN_PORT>
./scripts/bridge-ctl.sh agent-start
```
