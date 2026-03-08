require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const schedule = require('node-schedule');
const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages], partials: ['CHANNEL'] });
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

const BOT_VERSION = 'v3.0.0';
const MANGADEX_API = 'https://api.mangadex.org';
const MANGA_DIR = './manga_data';
const REQUIRED_ENV_VARS = ['DISCORD_TOKEN'];
const STATUS_PORT = 25589;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!fs.existsSync(MANGA_DIR)) fs.mkdirSync(MANGA_DIR);

function sanitizeUsername(username) {
    return username.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function requireEnvVars() {
    const missingVars = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
    if (missingVars.length > 0) {
        console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
        process.exit(1);
    }
}

function getUserFilePath(userId) {
    return path.join(MANGA_DIR, `${userId}.json`);
}

function getLegacyUserFilePath(username) {
    const sanitizedUsername = sanitizeUsername(username);
    return path.join(MANGA_DIR, `${sanitizedUsername}.json`);
}

function migrateLegacyUsernameFile(userId, username) {
    const userFilePath = getUserFilePath(userId);
    const legacyFilePath = getLegacyUserFilePath(username);

    if (!fs.existsSync(legacyFilePath) || fs.existsSync(userFilePath)) {
        return;
    }

    fs.renameSync(legacyFilePath, userFilePath);
}

function normalizeTrackedEntry(entry) {
    if (typeof entry === 'string' && UUID_REGEX.test(entry)) {
        return {
            mangaId: entry,
            title: null,
            lastNotifiedChapterId: null,
        };
    }

    if (!entry || typeof entry !== 'object') {
        return null;
    }

    const mangaId = entry.mangaId || entry.id;
    if (!mangaId || typeof mangaId !== 'string' || !UUID_REGEX.test(mangaId)) {
        return null;
    }

    return {
        mangaId,
        title: typeof entry.title === 'string' ? entry.title : null,
        lastNotifiedChapterId: typeof entry.lastNotifiedChapterId === 'string' ? entry.lastNotifiedChapterId : null,
    };
}

function normalizeUserData(rawData) {
    if (Array.isArray(rawData)) {
        const tracked = rawData.map(normalizeTrackedEntry).filter(Boolean);
        return { version: 2, tracked };
    }

    if (rawData && Array.isArray(rawData.tracked)) {
        const tracked = rawData.tracked.map(normalizeTrackedEntry).filter(Boolean);
        return { version: 2, tracked };
    }

    return { version: 2, tracked: [] };
}

function getUserData(userId) {
    const filePath = getUserFilePath(userId);
    if (!fs.existsSync(filePath)) {
        return { version: 2, tracked: [] };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return normalizeUserData(parsed);
    } catch (error) {
        console.error(`Error parsing user data for ${userId}:`, error.message);
        return { version: 2, tracked: [] };
    }
}

function saveUserData(userId, data) {
    const filePath = getUserFilePath(userId);
    const normalized = normalizeUserData(data);
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2));
}

function pickMangaTitle(attributes = {}) {
    const titleMap = attributes.title || {};
    if (titleMap.en) return titleMap.en;

    const altTitles = Array.isArray(attributes.altTitles) ? attributes.altTitles : [];
    for (const altTitle of altTitles) {
        if (altTitle.en) return altTitle.en;
    }

    const firstTitle = Object.values(titleMap)[0];
    return firstTitle || 'Unknown Title';
}

function extractMangaId(value) {
    if (!value || typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (UUID_REGEX.test(trimmed)) {
        return trimmed;
    }

    const match = trimmed.match(/title\/([0-9a-f-]{36})/i);
    if (match && UUID_REGEX.test(match[1])) {
        return match[1];
    }

    return null;
}

async function fetchMangaById(mangaId) {
    const response = await axios.get(`${MANGADEX_API}/manga/${mangaId}`);
    return response.data?.data || null;
}

async function fetchLatestChapter(mangaId) {
    const commonParams = {
        limit: 1,
        'manga[]': mangaId,
        'order[readableAt]': 'desc',
    };

    const withEnglish = await axios.get(`${MANGADEX_API}/chapter`, {
        params: {
            ...commonParams,
            'translatedLanguage[]': 'en',
        },
    });

    let latestChapter = withEnglish.data?.data?.[0];

    if (!latestChapter) {
        const withoutLanguage = await axios.get(`${MANGADEX_API}/chapter`, { params: commonParams });
        latestChapter = withoutLanguage.data?.data?.[0];
    }

    if (!latestChapter) {
        return null;
    }

    return {
        id: latestChapter.id,
        chapter: latestChapter.attributes?.chapter || '?',
        title: latestChapter.attributes?.title || null,
        readableAt: latestChapter.attributes?.readableAt || null,
        link: `https://mangadex.org/chapter/${latestChapter.id}`,
    };
}

async function resolveTrackedMangaTitle(entry) {
    if (entry.title) return entry.title;

    try {
        const manga = await fetchMangaById(entry.mangaId);
        const title = pickMangaTitle(manga?.attributes);
        entry.title = title;
        return title;
    } catch (error) {
        console.error(`Error resolving manga title for ${entry.mangaId}:`, error.message);
        return 'Unknown Title';
    }
}

async function buildUserUpdates(userId) {
    const userData = getUserData(userId);
    const updates = [];
    let changed = false;

    for (const entry of userData.tracked) {
        try {
            const mangaTitle = await resolveTrackedMangaTitle(entry);
            const latestChapter = await fetchLatestChapter(entry.mangaId);
            if (!latestChapter) continue;

            if (!entry.lastNotifiedChapterId) {
                entry.lastNotifiedChapterId = latestChapter.id;
                changed = true;
                continue;
            }

            if (entry.lastNotifiedChapterId !== latestChapter.id) {
                updates.push({
                    mangaId: entry.mangaId,
                    title: mangaTitle,
                    chapter: latestChapter.chapter,
                    chapterTitle: latestChapter.title,
                    link: latestChapter.link,
                    readableAt: latestChapter.readableAt,
                    latestChapterId: latestChapter.id,
                });
                entry.lastNotifiedChapterId = latestChapter.id;
                changed = true;
            }
        } catch (error) {
            console.error(`Error fetching updates for manga ID ${entry.mangaId}:`, error.message);
        }
    }

    if (changed) {
        saveUserData(userId, userData);
    }

    return updates;
}

function formatUpdateLine(update, index) {
    const chapterSuffix = update.chapterTitle ? ` - ${update.chapterTitle}` : '';
    return `**${index + 1}. [${update.title}](<${update.link}>)** - Chapter ${update.chapter}${chapterSuffix}`;
}

function buildUpdatesEmbed(updates, title = '📖 Manga Updates') {
    return new EmbedBuilder()
        .setTitle(title)
        .setColor(0x3498db)
        .setDescription(updates.map(formatUpdateLine).join('\n'))
        .setFooter({ text: `Total updates: ${updates.length}` });
}

function buildNoUpdatesEmbed() {
    return new EmbedBuilder()
        .setTitle('No Updates Found')
        .setDescription('Your tracked manga has no new chapters.')
        .setColor(0xff0000)
        .setFooter({ text: 'Check back later for updates!' });
}

async function runDailyUpdateSweep() {
    const files = fs.readdirSync(MANGA_DIR).filter((name) => name.endsWith('.json'));

    for (const file of files) {
        const userId = file.replace('.json', '');
        if (!/^\d+$/.test(userId)) continue;

        try {
            const updates = await buildUserUpdates(userId);
            if (updates.length === 0) continue;

            const user = await client.users.fetch(userId);
            const embed = buildUpdatesEmbed(updates, '📬 Daily Manga Updates');
            await user.send({ embeds: [embed] });
        } catch (error) {
            console.error(`Error sending daily updates to user ${userId}:`, error.message);
        }
    }
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    client.user.setPresence({
        activities: [{ name: 'MangaDex 📚', type: 3 }],
        status: 'online',
    });

    const commands = [
        { name: 'checkupdates', description: 'Check for new chapters across your tracked manga.' },
        { name: 'version', description: 'Display the current version of the bot.' },
        {
            name: 'searchmanga',
            description: 'Search MangaDex for manga to track.',
            options: [{ name: 'query', type: 3, description: 'Manga title to search for', required: true }],
        },
        {
            name: 'addmanga',
            description: 'Add a MangaDex URL or manga ID to your tracking list.',
            options: [{ name: 'url_or_id', type: 3, description: 'MangaDex title URL or manga UUID', required: true }],
        },
        {
            name: 'removemanga',
            description: 'Remove a manga from tracking by URL or ID.',
            options: [{ name: 'url_or_id', type: 3, description: 'MangaDex title URL or manga UUID', required: true }],
        },
        { name: 'listmanga', description: 'List all manga you are currently tracking.' },
        { name: 'exportmanga', description: 'Export your manga tracking list as JSON.' },
        {
            name: 'importmanga',
            description: 'Import your manga tracking list from a JSON file.',
            options: [{ name: 'file', type: 11, description: 'JSON file to import', required: true }],
        },
    ];

    try {
        console.log('Refreshing application (/) commands...');
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering slash commands:', error.message);
    }

    schedule.scheduleJob('0 17 * * *', async () => {
        console.log('Running scheduled daily update sweep...');
        await runDailyUpdateSweep();
    });
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    const username = interaction.user.username;
    migrateLegacyUsernameFile(userId, username);

    if (interaction.commandName === 'checkupdates') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const updates = await buildUserUpdates(userId);
            if (updates.length === 0) {
                await interaction.followUp({ embeds: [buildNoUpdatesEmbed()] });
                return;
            }

            await interaction.followUp({ embeds: [buildUpdatesEmbed(updates)] });
        } catch (error) {
            console.error('Error checking updates:', error.message);
            await interaction.followUp({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('Error')
                        .setDescription('An error occurred while checking updates. Please try again later.')
                        .setColor(0xff0000),
                ],
            });
        }
        return;
    }

    if (interaction.commandName === 'version') {
        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('Manga Tracker')
                    .setDescription(`**${BOT_VERSION}**`)
                    .setColor(0x3498db),
            ],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (interaction.commandName === 'searchmanga') {
        const query = interaction.options.getString('query', true).trim();

        try {
            const response = await axios.get(`${MANGADEX_API}/manga`, {
                params: {
                    title: query,
                    limit: 5,
                    'order[relevance]': 'desc',
                },
            });

            const results = response.data?.data || [];
            if (results.length === 0) {
                await interaction.reply({
                    content: `No results found for "${query}".`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const lines = results.map((manga, index) => {
                const title = pickMangaTitle(manga.attributes);
                return `**${index + 1}.** ${title}\nID: \`${manga.id}\`\nhttps://mangadex.org/title/${manga.id}`;
            });

            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`Search Results: ${query}`)
                        .setDescription(lines.join('\n\n'))
                        .setColor(0x3498db),
                ],
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            console.error('Error searching manga:', error.message);
            await interaction.reply({
                content: 'Unable to search MangaDex right now. Please try again later.',
                flags: MessageFlags.Ephemeral,
            });
        }
        return;
    }

    if (interaction.commandName === 'addmanga') {
        const input = interaction.options.getString('url_or_id', true);
        const mangaId = extractMangaId(input);

        if (!mangaId) {
            await interaction.reply({
                content: 'Invalid MangaDex URL or manga ID. Example: https://mangadex.org/title/<id>',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const userData = getUserData(userId);
        if (userData.tracked.some((entry) => entry.mangaId === mangaId)) {
            await interaction.reply({ content: 'This manga is already being tracked.', flags: MessageFlags.Ephemeral });
            return;
        }

        try {
            const manga = await fetchMangaById(mangaId);
            if (!manga) {
                await interaction.reply({ content: 'Manga not found on MangaDex.', flags: MessageFlags.Ephemeral });
                return;
            }

            const title = pickMangaTitle(manga.attributes);
            let latestChapterId = null;
            try {
                const latestChapter = await fetchLatestChapter(mangaId);
                latestChapterId = latestChapter?.id || null;
            } catch (error) {
                console.error(`Unable to fetch baseline chapter for ${mangaId}:`, error.message);
            }

            userData.tracked.push({ mangaId, title, lastNotifiedChapterId: latestChapterId });
            saveUserData(userId, userData);

            await interaction.reply({
                content: `Now tracking **${title}**.`,
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            console.error('Error adding manga:', error.message);
            await interaction.reply({
                content: 'Could not add this manga right now. Please try again later.',
                flags: MessageFlags.Ephemeral,
            });
        }
        return;
    }

    if (interaction.commandName === 'removemanga') {
        const input = interaction.options.getString('url_or_id', true);
        const mangaId = extractMangaId(input);

        if (!mangaId) {
            await interaction.reply({
                content: 'Invalid MangaDex URL or manga ID. Example: https://mangadex.org/title/<id>',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const userData = getUserData(userId);
        if (!userData.tracked.some((entry) => entry.mangaId === mangaId)) {
            await interaction.reply({ content: 'This manga is not currently tracked.', flags: MessageFlags.Ephemeral });
            return;
        }

        userData.tracked = userData.tracked.filter((entry) => entry.mangaId !== mangaId);
        saveUserData(userId, userData);

        await interaction.reply({ content: 'Manga removed from your tracking list.', flags: MessageFlags.Ephemeral });
        return;
    }

    if (interaction.commandName === 'listmanga') {
        const userData = getUserData(userId);

        if (userData.tracked.length === 0) {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('Tracked Manga')
                        .setDescription('You are not tracking any manga.')
                        .setColor(0xff0000)
                        .setFooter({ text: 'Use /addmanga to start tracking.' }),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        let changed = false;
        const names = [];
        for (const entry of userData.tracked) {
            const hadTitle = Boolean(entry.title);
            const title = await resolveTrackedMangaTitle(entry);
            if (!hadTitle && entry.title) changed = true;
            names.push(title);
        }

        if (changed) {
            saveUserData(userId, userData);
        }

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('📚 Your Tracked Manga List')
                    .setColor(0x3498db)
                    .setDescription(names.map((name, index) => `**${index + 1}.** ${name}`).join('\n'))
                    .setFooter({ text: `Total manga: ${names.length}` }),
            ],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (interaction.commandName === 'exportmanga') {
        const userData = getUserData(userId);

        if (userData.tracked.length === 0) {
            await interaction.reply({
                content: 'Your manga tracking list is empty. Nothing to export.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const fileName = `${sanitizeUsername(username)}_manga.json`;
        fs.writeFileSync(fileName, JSON.stringify(userData, null, 2));

        const attachment = new AttachmentBuilder(fileName, { name: fileName });
        await interaction.user.send({ files: [attachment] });
        fs.unlinkSync(fileName);

        await interaction.reply({
            content: 'Your manga tracking list has been exported and sent via DM.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (interaction.commandName === 'importmanga') {
        const file = interaction.options.getAttachment('file');

        if (!file || !file.name.endsWith('.json')) {
            await interaction.reply({
                content: 'Please provide a valid JSON file with a .json extension.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        try {
            const response = await axios.get(file.url);
            const imported = normalizeUserData(response.data);

            if (!Array.isArray(imported.tracked)) {
                await interaction.reply({
                    content: 'Invalid format. File must contain manga IDs or a tracked object.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const existing = getUserData(userId);
            const map = new Map();

            for (const entry of existing.tracked) {
                map.set(entry.mangaId, entry);
            }

            for (const entry of imported.tracked) {
                if (!map.has(entry.mangaId)) {
                    map.set(entry.mangaId, entry);
                }
            }

            saveUserData(userId, { version: 2, tracked: Array.from(map.values()) });
            await interaction.reply({
                content: 'Your manga tracking list has been successfully imported.',
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            console.error('Error importing file:', error.message);
            await interaction.reply({
                content: 'An error occurred while importing the file. Please try again later.',
                flags: MessageFlags.Ephemeral,
            });
        }
    }
});

requireEnvVars();

const statusServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Bot is running!');
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

statusServer.listen(STATUS_PORT, '0.0.0.0', () => {
    console.log(`Health check endpoint running at http://0.0.0.0:${STATUS_PORT}/status`);
});

client.login(process.env.DISCORD_TOKEN);
