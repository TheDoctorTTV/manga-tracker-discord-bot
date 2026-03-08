# Manga Tracker Discord Bot

## Overview

Manga Tracker is an open-source Discord bot designed to help manga enthusiasts stay up-to-date with their favorite manga directly from [MangaDex](https://www.mangadex.org/). With Manga Tracker, users can track their favorite manga titles and receive updates conveniently through their DMs.

## Features

- Track any manga listed on MangaDex.
- Receive daily updates at **5 PM UTC** in your DMs about new chapters for your tracked manga.
- Easily add, remove, or list tracked manga through slash commands.
- Export and import your tracked manga list to/from JSON files.

## Commands

| Command         | Description                                    |
| --------------- | ---------------------------------------------- |
| `/checkupdates` | Manually check for updates on tracked manga.   |
| `/version`      | Display the current version of the bot.        |
| `/addmanga`     | Add a manga to your tracking list.             |
| `/removemanga`  | Remove a manga from your tracking list.        |
| `/listmanga`    | List all manga currently being tracked.        |
| `/exportmanga`  | Export your tracking list as a JSON file.      |
| `/importmanga`  | Import a manga tracking list from a JSON file. |

## How It Works

1. **Add Manga**: Use `/addmanga` and provide the MangaDex URL to add a manga to your tracking list.
2. **Receive Updates**: At 5 PM UTC, the bot will send you DMs with updates about new chapters for your tracked manga.
3. **Manage Your List**: Use commands like `/removemanga`, `/listmanga`, `/exportmanga`, and `/importmanga` to customize your experience.

## Hosting the Bot

If you want to host the bot yourself, follow these steps:

### Prerequisites

- Node.js (v20 or later)
- A Discord bot token ([How to get a bot token](https://discord.com/developers/docs/intro))
- MangaDex API token
- Linux host with `systemd` (for service mode)

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
   MANGADEX_TOKEN=your_mangadex_api_token
   ```
4. Install dependencies:
   ```bash
   npm ci
   ```

### Quick local run (manual)

```bash
npm start
```

## Run as a systemd service (recommended)

This repo includes:
- `systemd/manga-tracker-discord-bot.service` (template)
- `scripts/setup.sh` (installs dependencies + registers service)
- `scripts/update.sh` (pulls latest + restarts service)

### Setup

Run:
   ```bash
   ./scripts/setup.sh
   ```

Optional overrides when needed:
- `BOT_USER=<linux-user> ./scripts/setup.sh`
- `BOT_WORKDIR=/absolute/path/to/repo ./scripts/setup.sh`
- `ENV_FILE=/absolute/path/to/.env ./scripts/setup.sh`
- `NODE_BIN=/usr/bin/node ./scripts/setup.sh`

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
4. Restart the `systemd` service

## Contributing

Feel free to submit issues or pull requests to improve the bot. Contributions are welcome!

## License

This project is licensed under the MIT License. See the LICENSE file for details.

---

Enjoy keeping track of your favorite manga with ease!
