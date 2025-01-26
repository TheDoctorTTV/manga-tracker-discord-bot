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

- Node.js (v16 or later)
- A Discord bot token ([How to get a bot token](https://discord.com/developers/docs/intro))
- MangaDex API token

### Installation

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd <repo-directory>
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory and add the following:
   ```env
   DISCORD_TOKEN=<your_discord_bot_token>
   MANGADEX_TOKEN=<your_mangadex_api_token>
   ```
4. Start the bot:
   ```bash
   node manga-chapter-updates.js
   ```

## Invite the Bot

Add the bot to your account using the following link:
[Bot Authorize Page](https://discord.com/oauth2/authorize?client_id=1332835637442641973)

## Contributing

Feel free to submit issues or pull requests to improve the bot. Contributions are welcome!

## License

This project is licensed under the MIT License. See the LICENSE file for details.

---

Enjoy keeping track of your favorite manga with ease!

