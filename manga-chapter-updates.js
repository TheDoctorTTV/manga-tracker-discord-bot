require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const axios = require('axios');
const schedule = require('node-schedule');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// MangaDex API base URL
const MANGADEX_API = 'https://api.mangadex.org';

// List of manga IDs to track
const trackedMangaIds = [
    'ed996855-70de-449f-bba2-e8e24224c14d',
    '462bd3fc-019c-4f28-8884-d7513d1e5a80',
    '027df837-7a15-4893-9dc3-e2ae11b94717',
    'a287ef9c-3718-4c6f-80be-44e404b78641',
];

// Store last chapter IDs to track changes
const lastChapterIds = {};

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
                    title: chapterData.attributes.title || 'Unknown Title',
                    chapter: chapterData.attributes.chapter || 'Unknown Chapter',
                    chapterId: chapterData.id,
                    link: `https://mangadex.org/chapter/${chapterData.id}`,
                });
            }
        } catch (error) {
            console.error(`Error fetching updates for manga ID ${mangaId}:`, error.message);
        }
    }
    return updates;
}

// Function to post manga updates to a specific channel
async function postMangaUpdates(channelId, updates, isManual = false) {
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
        console.error('Channel not found!');
        return;
    }

    const newUpdates = updates.filter(
        update => isManual || lastChapterIds[update.chapterId] !== update.chapterId
    );

    if (newUpdates.length === 0 && !isManual) {
        return; // Don't post if no new updates during daily check
    }

    for (const update of newUpdates) {
        await channel.send(
            `**${update.title}** - Chapter ${update.chapter}\nRead here: ${update.link}`
        );
        lastChapterIds[update.chapterId] = update.chapterId;
    }

    if (isManual && newUpdates.length === 0) {
        await channel.send('No new updates for the tracked mangas.');
    }
}

// Event: On bot ready
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Register slash commands
    try {
        console.log('Refreshing application (/) commands...');
        const commands = [
            {
                name: 'checkupdates',
                description: 'Manually check for manga updates and post them in this channel.',
            },
        ];
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }

    // Set the channel ID for auto updates
    const channelId = process.env.DISCORD_CHANNEL_ID;

    // Schedule daily update check at 5:00 PM UTC
    schedule.scheduleJob('0 17 * * *', async () => {
        console.log('Running daily manga update check...');
        const updates = await fetchMangaUpdates();
        await postMangaUpdates(channelId, updates, false);
    });
});

// Event: On interaction (for / commands)
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'checkupdates') {
        await interaction.deferReply();
        const channelId = process.env.DISCORD_CHANNEL_ID;
        const updates = await fetchMangaUpdates();
        await postMangaUpdates(channelId, updates, true);
        await interaction.followUp('Checked for updates!');
    }
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
