require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');
const express = require('express'); // Added for health check endpoint

const client = new Client({ intents: [GatewayIntentBits.DirectMessages], partials: ['CHANNEL'] });
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

const BOT_VERSION = 'v1.0';
const MANGADEX_API = 'https://api.mangadex.org';
const MANGA_DIR = './manga_data';

if (!fs.existsSync(MANGA_DIR)) fs.mkdirSync(MANGA_DIR);

function sanitizeUsername(username) {
    return username.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getUserFilePath(username) {
    const sanitizedUsername = sanitizeUsername(username);
    return path.join(MANGA_DIR, `${sanitizedUsername}.json`);
}

function getUserMangaList(username) {
    const filePath = getUserFilePath(username);
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return [];
}

function saveUserMangaList(username, mangaList) {
    const filePath = getUserFilePath(username);
    fs.writeFileSync(filePath, JSON.stringify(mangaList, null, 2));
}

async function fetchUserMangaNames(username) {
    const mangaList = getUserMangaList(username);
    const mangaNames = [];
    for (const mangaId of mangaList) {
        try {
            const response = await axios.get(`${MANGADEX_API}/manga/${mangaId}`, {
                headers: { Authorization: `Bearer ${process.env.MANGADEX_TOKEN}` },
            });
            mangaNames.push(response.data.data.attributes.title.en || 'Unknown Title');
        } catch (error) {
            console.error(`Error fetching manga name for ID ${mangaId}:`, error.message);
            mangaNames.push('Unknown Title');
        }
    }
    return mangaNames;
}

async function fetchUserMangaUpdates(username) {
    const mangaList = getUserMangaList(username);
    const updates = [];

    for (const mangaId of mangaList) {
        try {
            const mangaResponse = await axios.get(`${MANGADEX_API}/manga/${mangaId}`, {
                headers: { Authorization: `Bearer ${process.env.MANGADEX_TOKEN}` },
            });

            const mangaTitle = mangaResponse.data.data.attributes.title.en || 'Unknown Title';

            const chapterResponse = await axios.get(`${MANGADEX_API}/chapter`, {
                headers: { Authorization: `Bearer ${process.env.MANGADEX_TOKEN}` },
                params: { manga: mangaId, translatedLanguage: ['en'], order: { chapter: 'desc' }, limit: 1 },
            });

            const latestChapter = chapterResponse.data.data[0];
            if (latestChapter) {
                const chapterNumber = latestChapter.attributes.chapter;
                const chapterId = latestChapter.id;

                updates.push({
                    title: mangaTitle,
                    chapter: chapterNumber,
                    link: `https://mangadex.org/chapter/${chapterId}`,
                });
            }
        } catch (error) {
            console.error(`Error fetching updates for manga ID ${mangaId}:`, error.message);
        }
    }

    return updates;
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    console.log(`Logged in as ${client.user.tag}!`);
    client.user.setPresence({
        activities: [{ name: 'MangaDex 📚', type: 'WATCHING' }],
        status: 'online',
    });

    const commands = [
        { name: 'checkupdates', description: 'Manually check for manga updates and send them via DM.' },
        { name: 'version', description: 'Display the current version of the bot.' },
        {
            name: 'addmanga',
            description: 'Add a new manga URL to track.',
            options: [{ name: 'url', type: 3, description: 'The MangaDex URL of the manga.', required: true }],
        },
        {
            name: 'removemanga',
            description: 'Remove a manga from tracking.',
            options: [{ name: 'url', type: 3, description: 'The MangaDex URL to remove.', required: true }],
        },
        { name: 'listmanga', description: 'List all tracked manga.' },
        { name: 'exportmanga', description: 'Export your manga tracking list as a file.' },
        {
            name: 'importmanga',
            description: 'Import a new manga tracking list from a file.',
            options: [{ name: 'file', type: 11, description: 'The JSON file to import.', required: true }],
        },
    ];

    try {
        console.log('Refreshing application (/) commands...');
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    const username = interaction.user.username;

    if (interaction.commandName === 'checkupdates') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
        try {
            const updates = await fetchUserMangaUpdates(username);
    
            if (updates.length === 0) {
                const noUpdatesEmbed = new EmbedBuilder()
                    .setTitle('No Updates Found')
                    .setDescription('Your tracked manga has no new chapters.')
                    .setColor(0xff0000)
                    .setFooter({ text: 'Check back later for updates!' });
    
                await interaction.followUp({ embeds: [noUpdatesEmbed] });
                return;
            }
    
            const updatesEmbed = new EmbedBuilder()
                .setTitle('📖 Manga Updates')
                .setColor(0x3498db)
                .setDescription(
                    updates
                        .map(
                            (update, index) =>
                                `**${index + 1}. [${update.title}](<${update.link}>)** - Chapter ${update.chapter}`
                        )
                        .join('\n')
                )
                .setFooter({ text: `Total updates: ${updates.length}` });
    
            await interaction.followUp({ embeds: [updatesEmbed] });
        } catch (error) {
            console.error('Error checking updates:', error.message);
            const errorEmbed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription('An error occurred while checking for updates. Please try again later.')
                .setColor(0xff0000);
            await interaction.followUp({ embeds: [errorEmbed] });
        }
    }
    

    if (interaction.commandName === 'version') {
        const embed = new EmbedBuilder()
            .setTitle('Manga Tracker')
            .setDescription(`**${BOT_VERSION}**.`)
            .setColor(0x3498db);

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (interaction.commandName === 'addmanga') {
        const url = interaction.options.getString('url');
        const mangaIdMatch = url.match(/title\/([a-f0-9-]+)/);

        if (!mangaIdMatch) {
            await interaction.reply({ content: 'Invalid MangaDex URL provided.', flags: MessageFlags.Ephemeral });
            return;
        }

        const mangaId = mangaIdMatch[1];
        const userMangaList = getUserMangaList(username);

        if (userMangaList.includes(mangaId)) {
            await interaction.reply({ content: 'This manga is already being tracked.', flags: MessageFlags.Ephemeral });
            return;
        }

        userMangaList.push(mangaId);
        saveUserMangaList(username, userMangaList);

        await interaction.reply({ content: 'Manga added to your tracking list.', flags: MessageFlags.Ephemeral });
    }

    if (interaction.commandName === 'removemanga') {
        const url = interaction.options.getString('url');
        const mangaIdMatch = url.match(/title\/([a-f0-9-]+)/);

        if (!mangaIdMatch) {
            await interaction.reply({ content: 'Invalid MangaDex URL provided.', flags: MessageFlags.Ephemeral });
            return;
        }

        const mangaId = mangaIdMatch[1];
        const userMangaList = getUserMangaList(username);

        if (!userMangaList.includes(mangaId)) {
            await interaction.reply({ content: 'This manga is not being tracked.', flags: MessageFlags.Ephemeral });
            return;
        }

        const updatedList = userMangaList.filter(id => id !== mangaId);
        saveUserMangaList(username, updatedList);

        await interaction.reply({ content: 'Manga removed from your tracking list.', flags: MessageFlags.Ephemeral });
    }

    if (interaction.commandName === 'listmanga') {
        const mangaNames = await fetchUserMangaNames(username);
    
        if (mangaNames.length === 0) {
            const noMangaEmbed = new EmbedBuilder()
                .setTitle('Tracked Manga')
                .setDescription('You are not tracking any manga.')
                .setColor(0xff0000)
                .setFooter({ text: 'Use /addmanga to start tracking manga!' });
    
            await interaction.reply({ embeds: [noMangaEmbed], flags: MessageFlags.Ephemeral });
            return;
        }
    
        const mangaListEmbed = new EmbedBuilder()
            .setTitle('📚 Your Tracked Manga List')
            .setColor(0x3498db)
            .setDescription(
                mangaNames.map((name, index) => `**${index + 1}.** ${name}`).join('\n')
            )
            .setFooter({ text: `Total Manga: ${mangaNames.length}` });
    
        await interaction.reply({ embeds: [mangaListEmbed], flags: MessageFlags.Ephemeral });
    }
    

    if (interaction.commandName === 'exportmanga') {
        const userMangaList = getUserMangaList(username);

        if (userMangaList.length === 0) {
            await interaction.reply({
                content: 'Your manga tracking list is empty. Nothing to export.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const fileName = `${sanitizeUsername(username)}_manga.json`;
        fs.writeFileSync(fileName, JSON.stringify(userMangaList, null, 2));

        const attachment = new AttachmentBuilder(fileName, { name: fileName });
        await interaction.user.send({ files: [attachment] });

        fs.unlinkSync(fileName); // Clean up the temporary file

        await interaction.reply({
            content: 'Your manga tracking list has been exported and sent via DM.',
            flags: MessageFlags.Ephemeral,
        });
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
            const importedData = response.data;

            if (Array.isArray(importedData) && importedData.every(id => typeof id === 'string')) {
                const userMangaList = getUserMangaList(username);
                const combinedList = [...new Set([...userMangaList, ...importedData])];
                saveUserMangaList(username, combinedList);

                await interaction.reply({
                    content: 'Your manga tracking list has been successfully imported!',
                    flags: MessageFlags.Ephemeral,
                });
            } else {
                await interaction.reply({
                    content: 'Invalid file format. Please provide a JSON file containing an array of manga IDs.',
                    flags: MessageFlags.Ephemeral,
                });
            }
        } catch (error) {
            console.error('Error importing file:', error.message);
            await interaction.reply({
                content: 'An error occurred while importing the file. Please try again later.',
                flags: MessageFlags.Ephemeral,
            });
        }
    }
});

// Health check endpoint
const app = express();
const PORT = 25589;
app.get('/status', (req, res) => {
    res.status(200).send('Bot is running!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Health check endpoint running at http://167.114.213.69:${PORT}/status`);
});

client.login(process.env.DISCORD_TOKEN);
