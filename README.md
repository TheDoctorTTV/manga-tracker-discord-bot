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
- Configure dynamic source metadata in `manga-sources.json` (`key`, `adapter`, `enabled`, hosts, URLs).

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
2. Create your environment file (optional, auto-created on first start):
   ```bash
   cp .env.example .env
   ```
3. Edit `.env` (or use the dashboard **Settings -> Environment** section):
   ```env
   DISCORD_TOKEN=your_discord_bot_token
   DASHBOARD_PORT=9898
   DASHBOARD_HOST=0.0.0.0
   ```
4. Install dependencies:
   ```bash
   npm ci
   ```

### Quick local run (manual)

```bash
npm start
```

Dashboard URL (default bind):
```text
http://<server-ip-or-domain>:9898
```

The dashboard currently runs without built-in auth while admin features are being completed. Keep it behind your own network controls.
It includes admin tabs for `Home`, `Users`, `Settings`, and `About`.
Because the dashboard can edit environment values (including token updates), do not expose it publicly until auth (such as Discord OAuth) is enabled.

## Run as a systemd service (recommended)

Quick setup (stable release, no clone required):
```bash
curl -fsSL -o manga-tracker-linux.tar.gz https://github.com/TheDoctorTTV/manga-tracker-discord-bot/releases/latest/download/manga-tracker-linux.tar.gz && tar -xzf manga-tracker-linux.tar.gz && cd manga-tracker-linux && sudo DISCORD_TOKEN=your_discord_bot_token ./install_systemd_service.sh
```

Quick setup (latest prerelease, no clone required):
```bash
curl -fsSL -o manga-tracker-linux.tar.gz "$(curl -fsSL https://api.github.com/repos/TheDoctorTTV/manga-tracker-discord-bot/releases | jq -r '[.[] | select(.prerelease == true and .draft == false)][0].assets[] | select(.name == "manga-tracker-linux.tar.gz") | .browser_download_url')" && tar -xzf manga-tracker-linux.tar.gz && cd manga-tracker-linux && sudo DISCORD_TOKEN=your_discord_bot_token ./install_systemd_service.sh
```

Prerelease command note: requires `jq` to parse the GitHub Releases API response.

What this does:
- Downloads the latest Linux release package from GitHub Releases.
- Extracts the package and runs the bundled installer script.
- Installs the bundled binary to `/opt/manga-tracker-discord-bot/manga-tracker`.
- Creates/enables/starts `manga-tracker-discord-bot.service`.
- Uses `/etc/manga-tracker-discord-bot.env` for environment variables.

Optional overrides when needed:
- `SERVICE_NAME=manga-tracker-discord-bot`
- `BOT_USER=<linux-user>`
- `BOT_GROUP=<linux-group>`
- `INSTALL_DIR=/opt/manga-tracker-discord-bot`
- `BINARY_NAME=manga-tracker`
- `ENV_FILE=/etc/manga-tracker-discord-bot.env`
- `DASHBOARD_HOST=0.0.0.0`
- `DASHBOARD_PORT=9898`

Example with overrides:
```bash
curl -fsSL -o manga-tracker-linux.tar.gz https://github.com/TheDoctorTTV/manga-tracker-discord-bot/releases/latest/download/manga-tracker-linux.tar.gz && tar -xzf manga-tracker-linux.tar.gz && cd manga-tracker-linux && sudo DISCORD_TOKEN=your_discord_bot_token BOT_USER=manga BOT_GROUP=manga ./install_systemd_service.sh
```

To uninstall:
```bash
sudo ./uninstall_systemd_service.sh
# or full purge:
sudo PURGE=1 ./uninstall_systemd_service.sh
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

Use the **About** tab in the admin dashboard:
1. Click **Check For Updates**.
2. Click **Apply Latest Update**.
3. A detached updater worker replaces the binary and runs `systemctl restart` for the bot service.

Optional updater env vars:
- `BOT_UPDATE_BINARY_PATH` (override binary file path)
- `BOT_UPDATE_ASSET_NAME` (force a specific release asset)
- `BOT_UPDATE_SYSTEMD_SERVICE` (systemd service name to restart, default: `manga-tracker-discord-bot`)

In the dashboard About tab updater:
- Choose `Release` or `Release + Prerelease`.
- Pick a specific version from the version dropdown (or keep latest).

## Troubleshooting

If setup fails, check:
- `DISCORD_TOKEN` is provided in the setup command or present in `/etc/manga-tracker-discord-bot.env`.
- The release package asset `manga-tracker-linux.tar.gz` exists on the latest release.
- `systemd` is available and running on that machine.

Then rerun setup:
```bash
curl -fsSL -o manga-tracker-linux.tar.gz https://github.com/TheDoctorTTV/manga-tracker-discord-bot/releases/latest/download/manga-tracker-linux.tar.gz && tar -xzf manga-tracker-linux.tar.gz && cd manga-tracker-linux && sudo DISCORD_TOKEN=your_discord_bot_token ./install_systemd_service.sh
```

## Contributing

Feel free to submit issues or pull requests to improve the bot. Contributions are welcome!

## License

This project is licensed under the MIT License. See the LICENSE file for details.

---

Enjoy keeping track of your favorite manga with ease!
