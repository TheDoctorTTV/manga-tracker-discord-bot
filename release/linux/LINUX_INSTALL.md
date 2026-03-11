# Manga Tracker Linux Install Guide

This package contains:

- `manga-tracker` (binary)
- `install_systemd_service.sh`
- `uninstall_systemd_service.sh`
- `.env.example`

## Quick Install

```bash
sudo DISCORD_TOKEN=your_discord_bot_token ./install_systemd_service.sh
```

## Verify Service

```bash
sudo systemctl status manga-tracker-discord-bot --no-pager
journalctl -u manga-tracker-discord-bot -f
```

## Uninstall

Stop/disable service and remove only systemd unit:

```bash
sudo ./uninstall_systemd_service.sh
```

Full purge (also removes `/opt/manga-tracker-discord-bot` and env file):

```bash
sudo PURGE=1 ./uninstall_systemd_service.sh
```

## Optional Environment Overrides

- `SERVICE_NAME` (default: `manga-tracker-discord-bot`)
- `INSTALL_DIR` (default: `/opt/manga-tracker-discord-bot`)
- `BINARY_NAME` (default: `manga-tracker`)
- `ENV_FILE` (default: `/etc/manga-tracker-discord-bot.env`)
- `BOT_USER` (default: current user)
- `BOT_GROUP` (default: same as `BOT_USER`)
