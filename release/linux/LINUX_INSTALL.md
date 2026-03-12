# Manga Tracker Linux Install Guide

This package contains:

- `manga-tracker` (binary)
- `install_systemd_service.sh`
- `uninstall_systemd_service.sh`
- `.env.example`
- `dashboard.html`
- `login.html`
- `onboarding.html`
- `dashboard.css`
- `dashboardTabState.js`

## Quick Install

```bash
sudo DISCORD_TOKEN=your_discord_bot_token ./install_systemd_service.sh
```

## Verify Service

```bash
sudo systemctl status manga-tracker-discord-bot --no-pager
journalctl -u manga-tracker-discord-bot -f
```

## Force Update

Stable release:

```bash
sudo systemctl stop manga-tracker-discord-bot || true && rm -rf manga-tracker-linux && curl -fsSL -o manga-tracker-linux.tar.gz https://github.com/TheDoctorTTV/manga-tracker-discord-bot/releases/latest/download/manga-tracker-linux.tar.gz && tar -xzf manga-tracker-linux.tar.gz && cd manga-tracker-linux && sudo ./install_systemd_service.sh && cd .. && rm -f manga-tracker-linux.tar.gz
```

Latest prerelease:

```bash
sudo systemctl stop manga-tracker-discord-bot || true && rm -rf manga-tracker-linux && curl -fsSL -o manga-tracker-linux.tar.gz "$(curl -fsSL https://api.github.com/repos/TheDoctorTTV/manga-tracker-discord-bot/releases | jq -r '[.[] | select(.prerelease == true and .draft == false)][0].assets[] | select(.name == "manga-tracker-linux.tar.gz") | .browser_download_url')" && tar -xzf manga-tracker-linux.tar.gz && cd manga-tracker-linux && sudo ./install_systemd_service.sh && cd .. && rm -f manga-tracker-linux.tar.gz
```

These commands reinstall over the existing service install and keep using the current env file unless `ENV_FILE` is changed.

## Uninstall

Full uninstall (stops/disables service and deletes unit, install directory, and env file):

```bash
sudo ./uninstall_systemd_service.sh
```

Non-interactive uninstall for automation:

```bash
sudo FORCE=1 ./uninstall_systemd_service.sh
```

The uninstall script prints a bold red warning and requires typing `DELETE` unless `FORCE=1` is provided.
When run from the extracted `manga-tracker-linux` folder, it also deletes that package directory.

## Optional Environment Overrides

- `SERVICE_NAME` (default: `manga-tracker-discord-bot`)
- `INSTALL_DIR` (default: `/opt/manga-tracker-discord-bot`)
- `BINARY_NAME` (default: `manga-tracker`)
- `ENV_FILE` (default: `/etc/manga-tracker-discord-bot.env`)
- `PACKAGE_DIR` (default: extracted `manga-tracker-linux` directory when detected; set `PACKAGE_DIR=""` to keep it)
- `BOT_USER` (default: current user)
- `BOT_GROUP` (default: same as `BOT_USER`)
