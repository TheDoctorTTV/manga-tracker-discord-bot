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
   OAUTH_URL=
   DISCORD_CLIENT_ID=
   DISCORD_OAUTH_SCOPES=bot applications.commands
   DISCORD_OAUTH_PERMISSIONS=0
   DISCORD_OAUTH_GUILD_ID=
   DASHBOARD_AUTH_ENABLED=false
   DASHBOARD_PUBLIC_URL=
   DISCORD_AUTH_CLIENT_ID=
   DISCORD_AUTH_CLIENT_SECRET=
   DASHBOARD_MANAGED_GUILD_IDS=
   DASHBOARD_AUTH_SESSION_HOURS=12
   ```
4. Install dependencies:
   ```bash
   npm ci
   ```

### Discord OAuth / Bot Invite Setup (Self-Host)

Use this to generate a working invite URL for your hosted bot.

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create/select your application.
2. Go to **Bot** and create a bot user (if not already created), then copy the bot token into `DISCORD_TOKEN`.
3. Go to **General Information** and copy **Application ID** into `DISCORD_CLIENT_ID`.
4. Save OAuth env values in `.env` or dashboard **Settings -> Environment**:
   ```env
   DISCORD_CLIENT_ID=123456789012345678
   DISCORD_OAUTH_SCOPES=bot applications.commands
   DISCORD_OAUTH_PERMISSIONS=0
   DISCORD_OAUTH_GUILD_ID=
   OAUTH_URL=
   ```
5. Open the dashboard **Home** tab and use **Bot Invite URL** (copy/open buttons) to invite the bot.

For your own server (preselected + locked in invite flow):
```env
DISCORD_OAUTH_GUILD_ID=your_server_id
```

OAuth env reference:

| Variable | Required | Example | Notes |
| --- | --- | --- | --- |
| `OAUTH_URL` | No | `https://discord.com/oauth2/authorize?...` | Manual override. If set, this exact URL is used. |
| `DISCORD_CLIENT_ID` | For generated invite | `123456789012345678` | Discord Application ID (numeric). |
| `DISCORD_OAUTH_SCOPES` | For generated invite | `bot applications.commands` | Space-separated scopes. |
| `DISCORD_OAUTH_PERMISSIONS` | For generated invite | `0` | Non-negative integer bitset. |
| `DISCORD_OAUTH_GUILD_ID` | No | `987654321098765432` | Optional server ID; when set, invite preselects server and disables server picker. |

Invite behavior:
- `OAUTH_URL` is set: manual URL is used.
- `OAUTH_URL` is empty and `DISCORD_CLIENT_ID` is valid: URL is generated automatically.
- `OAUTH_URL` is empty and `DISCORD_CLIENT_ID` is missing/invalid: invite URL is unavailable and dashboard shows why.

### Discord Intents and OAuth scopes

Gateway intents used by this bot:
- `Guilds`
- `Direct Messages`

Privileged gateway intents currently required:
- None (`Message Content`, `Server Members`, and `Presence` are not required).

OAuth scopes used:
- Bot invite URL: `bot applications.commands`
- Dashboard login OAuth: `identify guilds`

### Quick local run (manual)

```bash
npm start
```

Dashboard URL (default bind):
```text
http://<server-ip-or-domain>:9898
```

Dashboard access is now protected by Discord OAuth when `DASHBOARD_AUTH_ENABLED=true`.
Until auth is fully configured and enabled, dashboard access is limited to localhost bootstrap setup only.
It includes admin tabs for `Home`, `Users`, `Settings`, and `About`.

### Dashboard Discord OAuth Setup

Choose one active dashboard base URL strategy (single active URL only):

1. Tailscale/MagicDNS + port (recommended):
   - Example base URL: `http://your-host-or-fqdn.tailnet.ts.net:9898`
2. Custom domain/reverse proxy (optional):
   - Example base URL: `https://dashboard.example.com`

The app always uses one active base URL via `DASHBOARD_PUBLIC_URL`.

OAuth callback formula:
- `DASHBOARD_PUBLIC_URL + /auth/discord/callback`

Setup steps:

1. In dashboard **Settings -> Dashboard Auth**, set:
   - `DASHBOARD_PUBLIC_URL` (base dashboard URL)
   - `DISCORD_AUTH_CLIENT_ID`
   - `DISCORD_AUTH_CLIENT_SECRET`
   - `DASHBOARD_MANAGED_GUILD_IDS` (comma-separated guild IDs you manage)
   - `DASHBOARD_AUTH_SESSION_HOURS` (default `12`)
2. Copy the **Computed OAuth Callback URL** from the dashboard.
3. In Discord Developer Portal:
   - Open your application.
   - Go to **OAuth2 -> Redirects**.
   - Add the exact callback URL.
   - Save changes.
4. Set `DASHBOARD_AUTH_ENABLED=true` and save environment.
5. Login via Discord. Access is granted only if your Discord account has `ADMINISTRATOR` in at least one managed guild.

Troubleshooting `redirect_uri_mismatch`:
- Ensure the callback in Discord exactly matches computed callback URL (character-for-character).
- Common mistakes:
  - Missing `:9898` port for Tailscale URL.
  - Wrong scheme (`http` vs `https`).
  - Old/stale hostname after URL change.
  - Extra trailing slash or path mismatch.

### Guild-scoped dashboard behavior

- Dashboard user operations are scoped by **Active Guild**.
- User settings and tracked manga are stored per `(guildId, userId)`.
- Existing legacy global user files remain readable as fallback in guild views and are labeled as legacy.
- New edits/writes from dashboard are always saved to guild-scoped records.

## Run as a systemd service (recommended)

Quick setup (stable release, no clone required):
```bash
curl -fsSL -o manga-tracker-linux.tar.gz https://github.com/TheDoctorTTV/manga-tracker-discord-bot/releases/latest/download/manga-tracker-linux.tar.gz && tar -xzf manga-tracker-linux.tar.gz && cd manga-tracker-linux && sudo DISCORD_TOKEN=your_discord_bot_token ./install_systemd_service.sh && cd .. && rm -f manga-tracker-linux.tar.gz
```

Quick setup (latest prerelease, no clone required):
```bash
curl -fsSL -o manga-tracker-linux.tar.gz "$(curl -fsSL https://api.github.com/repos/TheDoctorTTV/manga-tracker-discord-bot/releases | jq -r '[.[] | select(.prerelease == true and .draft == false)][0].assets[] | select(.name == "manga-tracker-linux.tar.gz") | .browser_download_url')" && tar -xzf manga-tracker-linux.tar.gz && cd manga-tracker-linux && sudo DISCORD_TOKEN=your_discord_bot_token ./install_systemd_service.sh && cd .. && rm -f manga-tracker-linux.tar.gz
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
curl -fsSL -o manga-tracker-linux.tar.gz https://github.com/TheDoctorTTV/manga-tracker-discord-bot/releases/latest/download/manga-tracker-linux.tar.gz && tar -xzf manga-tracker-linux.tar.gz && cd manga-tracker-linux && sudo DISCORD_TOKEN=your_discord_bot_token BOT_USER=manga BOT_GROUP=manga ./install_systemd_service.sh && cd .. && rm -f manga-tracker-linux.tar.gz
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

### Firewall examples (UFW)

Allow dashboard on all interfaces (public/LAN):
```bash
sudo ufw allow 9898/tcp
```

Allow dashboard only from your LAN subnet:
```bash
sudo ufw allow from 10.0.0.0/16 to any port 9898 proto tcp
```

Allow dashboard only over Tailscale:
```bash
sudo ufw allow in on tailscale0 to any port 9898 proto tcp
```

Lock down to Tailscale-only (remove broad 9898 rules):
```bash
sudo ufw status numbered
sudo ufw delete allow 9898
sudo ufw delete allow 9898/tcp
sudo ufw allow in on tailscale0 to any port 9898 proto tcp
sudo ufw status
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

## Versioning releases

This repo now uses `version.json` as the single source of truth for app version and release tags.

- Show current version:
  ```bash
  npm run version:show
  ```
- Set a new version across `version.json`, `package.json`, and `package-lock.json`:
  ```bash
  npm run version:set -- 1.0.1
  ```
- Build/publish stable release assets using that version tag (`v1.0.1` in this example):
  ```bash
  npm run build:release
  ```
- Build/publish prerelease assets:
  ```bash
  npm run build:prerelease
  ```

Both scripts read `version.json` for `RELEASE_TAG` unless you override with `RELEASE_TAG=...`.

## Troubleshooting

If setup fails, check:
- `DISCORD_TOKEN` is provided in the setup command or present in `/etc/manga-tracker-discord-bot.env`.
- The release package asset `manga-tracker-linux.tar.gz` exists on the latest release.
- `systemd` is available and running on that machine.

Then rerun setup:
```bash
curl -fsSL -o manga-tracker-linux.tar.gz https://github.com/TheDoctorTTV/manga-tracker-discord-bot/releases/latest/download/manga-tracker-linux.tar.gz && tar -xzf manga-tracker-linux.tar.gz && cd manga-tracker-linux && sudo DISCORD_TOKEN=your_discord_bot_token ./install_systemd_service.sh && cd .. && rm -f manga-tracker-linux.tar.gz
```

## Contributing

Feel free to submit issues or pull requests to improve the bot. Contributions are welcome!

## License

This project is licensed under the MIT License. See the LICENSE file for details.

---

Enjoy keeping track of your favorite manga with ease!
