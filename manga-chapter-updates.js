require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');
const schedule = require('node-schedule');

const client = new Client({ intents: [GatewayIntentBits.DirectMessages], partials: ['CHANNEL'] });
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Bot Version
const BOT_VERSION = 'v1.0';

// MangaDex API base URL
const MANGADEX_API = 'https://api.mangadex.org';

// File to store manga IDs
const MANGA_FILE = './manga.json';

// Load or initialize manga IDs
let trackedMangaIds = [];
if (fs.existsSync(MANGA_FILE)) {
    trackedMangaIds = JSON.parse(fs.readFileSync(MANGA_FILE));
} else {
    fs.writeFileSync(MANGA_FILE, JSON.stringify(trackedMangaIds, null, 2));
}

// Store last chapter IDs to track changes
const lastChapterIds = {};

// Function to fetch manga names for the list
async function fetchMangaNames() {
    const names = [];
    for (const mangaId of trackedMangaIds) {
        try {
            const response = await axios.get(`${MANGADEX_API}/manga/${mangaId}`, {
                headers: {
                    Authorization: `Bearer ${process.env.MANGADEX_TOKEN}`,
                },
            });
            names.push(response.data.data.attributes.title.en || 'Unknown Title');
        } catch (error) {
            console.error(`Error fetching name for manga ID ${mangaId}:`, error.message);
            names.push('Unknown Title');
        }
    }
    return names;
}

// Function to fetch the latest chapters for tracked mangas
async function fetchMangaUpdates() {
    const updates = [];
    for (const mangaId of trackedMangaIds) {
        try {
            const response = await axios.get(`${MANGADEX_API}/manga/${mangaId}/feed`, {
                params: { translatedLanguage: ['en'], limit: 1, order: { createdAt: 'desc' } },
                headers: {
                    Authorization: `Bearer ${process.env.MANGADEX_TOKEN}`,
                },
            });
            const chapterData = response.data.data[0];
            if (chapterData) {
                updates.push({
                    mangaId,
                    title: chapterData.attributes.title || 'Unknown Title',
                    chapter: chapterData.attributes.chapter || 'Unknown Chapter',
                    chapterId: chapterData.id,
                    link: `https://mangadex.org/chapter/${chapterData.id}`,
                });
            } else {
                updates.push({
                    mangaId,
                    title: 'Unknown Title',
                    chapter: 'No Chapters Found',
                });
            }
        } catch (error) {
            console.error(`Error fetching updates for manga ID ${mangaId}:`, error.message);
        }
    }
    return updates;
}

// Function to send DM with manga updates
async function sendMangaUpdates(user, updates, isManual = false) {
    const newUpdates = updates.filter(
        update => isManual || lastChapterIds[update.chapterId] !== update.chapterId
    );

    if (newUpdates.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('Manga Update Status')
            .setDescription('All tracked mangas are up to date.')
            .setColor(0x00ff00);

        updates.forEach(update => {
            embed.addFields({
                name: update.title,
                value: `Chapter: ${update.chapter}\n[View Manga](https://mangadex.org/title/${update.mangaId})`,
                inline: false,
            });
        });

        await user.send({ embeds: [embed] });
        return;
    }

    for (const update of newUpdates) {
        await user.send(
            `**${update.title}** - Chapter ${update.chapter}\nRead here: ${update.link}`
        );
        lastChapterIds[update.chapterId] = update.chapterId;
    }
}

// Event: On bot ready
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    (async () => {
        try {
            console.log('Refreshing application (/) commands...');
            const commands = [
                {
                    name: 'checkupdates',
                    description: 'Manually check for manga updates and send them via DM.',
                },
                {
                    name: 'version',
                    description: 'Display the current version of the bot.',
                },
                {
                    name: 'addmanga',
                    description: 'Add a new manga URL to track.',
                    options: [
                        {
                            name: 'url',
                            type: 3,
                            description: 'The MangaDex URL of the manga.',
                            required: true,
                        },
                    ],
                },
                {
                    name: 'removemanga',
                    description: 'Remove a manga from tracking.',
                    options: [
                        {
                            name: 'url',
                            type: 3,
                            description: 'The MangaDex URL of the manga to remove.',
                            required: true,
                        },
                    ],
                },
                {
                    name: 'listmanga',
                    description: 'List all tracked manga.',
                },
                {
                    name: 'exportmanga',
                    description: 'Export the current manga tracking list as a file.',
                },
                {
                    name: 'importmanga',
                    description: 'Import a new manga tracking list from a file.',
                    options: [
                        {
                            name: 'file',
                            type: 11,
                            description: 'The JSON file to import.',
                            required: true,
                        },
                    ],
                },
            ];

            await rest.put(
                Routes.applicationCommands(client.user.id),
                { body: commands }
            );

            console.log('Successfully reloaded application (/) commands.');
        } catch (error) {
            console.error('Error registering slash commands:', error);
        }
    })();

    schedule.scheduleJob('0 17 * * *', async () => {
        console.log('Running daily manga update check...');
        const updates = await fetchMangaUpdates();
        for (const user of client.users.cache.values()) {
            try {
                await sendMangaUpdates(user, updates, false);
            } catch (error) {
                console.error(`Failed to send updates to ${user.tag}:`, error.message);
            }
        }
    });
});

// Event: On interaction (for / commands)
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const user = interaction.user;

    if (interaction.commandName === 'checkupdates') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const updates = await fetchMangaUpdates();
        await sendMangaUpdates(user, updates, true);
        await interaction.followUp('Checked for updates! Please check your DMs.');
    }

    if (interaction.commandName === 'version') {
        const embed = new EmbedBuilder()
            .setTitle('Manga Tracker')
            .setDescription(`The current version of the bot is **${BOT_VERSION}**.`)
            .setColor(0x3498db);

        try {
            await user.send({ embeds: [embed] });
            await interaction.reply({ content: 'Version info sent via DM!', flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error('Failed to send DM:', error);
            await interaction.reply({
                content: 'Failed to send version info via DM. Please ensure DMs are enabled.',
                flags: MessageFlags.Ephemeral,
            });
        }
    }

    if (interaction.commandName === 'addmanga') {
        const url = interaction.options.getString('url');
        const mangaIdMatch = url.match(/title\/([a-f0-9-]+)/);
        if (!mangaIdMatch) {
            await interaction.reply({ content: 'Invalid MangaDex URL provided.', flags: MessageFlags.Ephemeral });
            return;
        }

        const mangaId = mangaIdMatch[1];
        if (trackedMangaIds.includes(mangaId)) {
            await interaction.reply({ content: 'This manga is already being tracked.', flags: MessageFlags.Ephemeral });
            return;
        }

        trackedMangaIds.push(mangaId);
        fs.writeFileSync(MANGA_FILE, JSON.stringify(trackedMangaIds, null, 2));
        await interaction.reply({ content: 'Manga added to the tracking list.', flags: MessageFlags.Ephemeral });
    }

    if (interaction.commandName === 'removemanga') {
        const url = interaction.options.getString('url');
        const mangaIdMatch = url.match(/title\/([a-f0-9-]+)/);
        if (!mangaIdMatch) {
            await interaction.reply({ content: 'Invalid MangaDex URL provided.', flags: MessageFlags.Ephemeral });
            return;
        }

        const mangaId = mangaIdMatch[1];
        if (!trackedMangaIds.includes(mangaId)) {
            await interaction.reply({ content: 'This manga is not being tracked.', flags: MessageFlags.Ephemeral });
            return;
        }

        trackedMangaIds = trackedMangaIds.filter(id => id !== mangaId);
        fs.writeFileSync(MANGA_FILE, JSON.stringify(trackedMangaIds, null, 2));
        await interaction.reply({ content: 'Manga removed from the tracking list.', flags: MessageFlags.Ephemeral });
    }

    if (interaction.commandName === 'listmanga') {
        const mangaNames = await fetchMangaNames();
    
        if (mangaNames.length === 0) {
            const noMangaEmbed = new EmbedBuilder()
                .setTitle('Tracked Manga')
                .setDescription('No manga is currently being tracked.')
                .setColor(0xff0000)
                .setFooter({ text: 'Use /addmanga to start tracking manga!' });
    
            await interaction.reply({ embeds: [noMangaEmbed], flags: MessageFlags.Ephemeral });
            return;
        }
    
        const embed = new EmbedBuilder()
            .setTitle('📚 Tracked Manga List')
            .setDescription(
                mangaNames
                    .map((name, index) => `**${index + 1}.** ${name}`)
                    .join('\n')
            )
            .setColor(0x3498db)
            .setFooter({ text: `Total Manga: ${mangaNames.length}` })
            .setTimestamp();
    
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    if (interaction.commandName === 'exportmanga') {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const filePath = path.resolve(MANGA_FILE);
            const attachment = new AttachmentBuilder(filePath, { name: 'manga.json' });

            await user.send({ files: [attachment] });

            await interaction.followUp({
                content: 'Manga tracking list exported and sent via DM.',
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            console.error('Error exporting manga tracking list:', error.message);
            await interaction.followUp({
                content: 'An error occurred while exporting the manga tracking list.',
                flags: MessageFlags.Ephemeral,
            });
        }
    }

    if (interaction.commandName === 'importmanga') {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const file = interaction.options.getAttachment('file');
            if (!file || !file.url.endsWith('.json')) {
                await interaction.followUp({ content: 'Please provide a valid JSON file.', flags: MessageFlags.Ephemeral });
                return;
            }

            const response = await axios.get(file.url);
            const importedMangaIds = response.data;

            if (!Array.isArray(importedMangaIds) || !importedMangaIds.every(id => typeof id === 'string')) {
                await interaction.followUp({
                    content: 'Invalid file format. Expected an array of manga IDs.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            trackedMangaIds = [...new Set([...trackedMangaIds, ...importedMangaIds])];
            fs.writeFileSync(MANGA_FILE, JSON.stringify(trackedMangaIds, null, 2));

            await interaction.followUp({
                content: 'Manga tracking list successfully imported!',
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            console.error('Error importing manga file:', error.message);
            await interaction.followUp({
                content: 'An error occurred while importing the file. Please check the format or try again later.',
                flags: MessageFlags.Ephemeral,
            });
        }
    }
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
