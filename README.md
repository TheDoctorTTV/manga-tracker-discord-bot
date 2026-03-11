# Manga Tracker Discord Bot

## Overview

Manga Tracker is an open-source Discord bot designed to help manga enthusiasts stay up-to-date with their favorite manga from supported sources like [MangaDex](https://www.mangadex.org/) and [Comix](https://comix.to/). With Manga Tracker, users can track their favorite manga titles and receive updates conveniently through their DMs.

## Features

- Track manga from supported sites (currently MangaDex and Comix).
- Search titles directly from Discord using your preferred source.
- Receive automatic DM updates on a custom interval (**6 hours to 7 days**).
- Manually check updates at any time.
- Export and import your tracked manga list to/from JSON files.
- Web dashboard for admin management of users, tracked manga, and settings.
- Configure supported manga source domains in `manga-sources.json`.

## Commands

| Command         | Description                                    |
| --------------- | ---------------------------------------------- |
| `/checkupdates` | Manually check for updates on tracked manga.   |
| `/setautocheck` | Set auto-check interval in hours (6 to 168).  |
| `/preferredsource` | Set your preferred source via dropdown.     |
| `/version`      | Display the current version of the bot.        |
| `/searchmanga`  | Search by title using your preferred source.   |
| `/addmanga`     | Add a manga to your tracking list by URL or ID.|
| `/removemanga`  | Remove a manga from your tracking list.        |
| `/listmanga`    | List all manga currently being tracked.        |
| `/exportmanga`  | Export your tracking list as a JSON file.      |
| `/importmanga`  | Import a manga tracking list from a JSON file. |

## How It Works

1. **Add Manga**: Use `/addmanga` and provide a supported manga URL (MangaDex or Comix) to add it to your tracking list.
2. **Receive Updates**: The bot auto-checks on your configured interval and sends a DM only when a tracked manga has a new chapter.
3. **Manage Your List**: Use commands like `/removemanga`, `/listmanga`, `/exportmanga`, and `/importmanga` to customize your experience.

## Hosting the Bot

If you want to host the bot yourself, follow these steps:

### Prerequisites

- Node.js (v20 or later)
- A Discord bot token ([How to get a bot token](https://discord.com/developers/docs/intro))
- Linux host with `systemd` (for service mode)

Check your runtime:
```bash
node -v
npm -v
```

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/TheDoctorTTV/manga-tracker-discord-bot.git
   cd manga-tracker-discord-bot
   ```
2. Create your environment file:
   ```bash
   cp .env.example .env
   ```
3. Edit `.env`:
   ```env
   DISCORD_TOKEN=your_discord_bot_token
   DASHBOARD_PORT=9898
   DASHBOARD_HOST=127.0.0.1
   ```
4. Install dependencies:
   ```bash
   npm ci
   ```

### Quick local run (manual)

```bash
npm start
```

Dashboard URL (local by default):
```text
http://127.0.0.1:9898
```

The dashboard currently runs without built-in auth while admin features are being completed. Keep it bound to localhost or behind your own network controls.
It includes admin tabs for `Home`, `Users`, `Settings`, and `About`.

## Run as a systemd service (recommended)

This repo includes:
- `systemd/manga-tracker-discord-bot.service` (template)
- `scripts/bootstrap.sh` (installs Node.js 20 via NVM, then runs setup)
- `scripts/setup.sh` (builds binary if needed + registers service)
- `scripts/update.sh` (pulls latest, rebuilds binary, restarts service)
- `scripts/build-binary.sh` (builds `dist/manga-tracker`)

### Setup

Fresh server (recommended):
```bash
./scripts/bootstrap.sh
```

If Node.js/npm are already installed:

Run:
   ```bash
   ./scripts/setup.sh
   ```

Optional overrides when needed:
- `BOT_USER=<linux-user> ./scripts/setup.sh`
- `BOT_WORKDIR=/absolute/path/to/repo ./scripts/setup.sh`
- `ENV_FILE=/absolute/path/to/.env ./scripts/setup.sh`
- `BOT_BINARY=/absolute/path/to/manga-tracker ./scripts/setup.sh`

### Build binary manually

```bash
npm run build:binary
./dist/manga-tracker
```

### Start

```bash
sudo systemctl start manga-tracker-discord-bot
```

### Stop

```bash
sudo systemctl stop manga-tracker-discord-bot
```

### Restart

```bash
sudo systemctl restart manga-tracker-discord-bot
```

### Status + logs

```bash
sudo systemctl status manga-tracker-discord-bot --no-pager
journalctl -u manga-tracker-discord-bot -f
```

## Updating the deployed bot

Update to latest commit on current branch:

```bash
./scripts/update.sh
```

Update to a specific branch/tag:

```bash
./scripts/update.sh main
# or
./scripts/update.sh v1.0.1
```

The update script does:
1. `git fetch --tags origin`
2. Checkout/pull requested ref (fast-forward only)
3. `npm ci --omit=dev`
4. `npm run build:binary`
5. Restart the `systemd` service

## Troubleshooting

If you see `bash: npm: command not found`, Node.js/npm are not installed on that machine.

Install Node.js 20 LTS with NVM:
```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
node -v
npm -v
```

Then rerun setup (or just use bootstrap):
```bash
./scripts/bootstrap.sh
# or
./scripts/setup.sh
```

## Contributing

Feel free to submit issues or pull requests to improve the bot. Contributions are welcome!

## License

This project is licensed under the MIT License. See the LICENSE file for details.

---

Enjoy keeping track of your favorite manga with ease!
