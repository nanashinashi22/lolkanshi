// index.js

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const express = require('express');
const { getLastPlayTime } = require('./opgg');
const fs = require('fs');

// 簡易的なデータベースとしてJSONファイルを使用
const usersFile = 'users.json';
let users = {};

// JSONファイルからユーザーデータを読み込む
if (fs.existsSync(usersFile)) {
    const data = fs.readFileSync(usersFile);
    users = JSON.parse(data);
}

// JSONファイルにユーザーデータを書き込む関数
function saveUsers() {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

const token = process.env.DISCORD_BOT_TOKEN;
const targetChannelId = process.env.TARGET_CHANNEL_ID;
const port = process.env.PORT || 3000;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`Bot logged in as ${client.user.tag}`);
});

// ユーザー登録とプレイ時間確認コマンドの処理
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const prefix = '!';
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'register') {
        const summonerName = args.join(' ');
        if (!summonerName) {
            message.channel.send('使用方法: !register <Summoner名>');
            return;
        }

        users[message.author.id] = summonerName;
        saveUsers();
        message.channel.send(`Summoner名を「${summonerName}」として登録しました。`);
    } else if (command === 'check') {
        const userId = message.author.id;
        const summonerName = users[userId];
        if (!summonerName) {
            message.channel.send('まず `!register <Summoner名>` コマンドでSummoner名を登録してください。');
            return;
        }

        const lastPlayTime = await getLastPlayTime(summonerName);
        if (!lastPlayTime) {
            message.channel.send(`${summonerName} さんは、まだLoLをプレイしていません。`);
            return;
        }

        const now = new Date();
        const diffMs = now - lastPlayTime;
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);
        const remainingHours = diffHours % 24;

        let timeString = '';
        if (diffDays > 0) {
            timeString += `${diffDays}日 `;
        }
        timeString += `${remainingHours}時間`;

        message.channel.send(`${summonerName} さんは、最後にLoLを起動してから **${timeString}** 経過しています。`);
    }
});

const app = express();
app.get('/', (req, res) => {
    res.send('Discord Bot is running on Koyeb!');
});
app.listen(port, () => {
    console.log(`HTTP server running on port ${port}`);
});

client.login(token);

// index.js の続き

// 定期的に全ユーザーのプレイ時間をチェックし、通知を送る
const CHECK_INTERVAL = 60 * 60 * 1000; // 1時間
const INACTIVE_LIMIT_HOURS = 24;      // 24時間

setInterval(async () => {
    for (const userId in users) {
        const summonerName = users[userId];
        const lastPlayTime = await getLastPlayTime(summonerName);

        if (!lastPlayTime) {
            console.log(`${summonerName} さんは、まだLoLをプレイしていません。`);
            continue;
        }

        const now = new Date();
        const diffMs = now - lastPlayTime;
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffHours >= INACTIVE_LIMIT_HOURS) {
            try {
                const channel = await client.channels.fetch(targetChannelId);
                if (!channel) {
                    console.error(`Channel ID ${targetChannelId} not found.`);
                    continue;
                }

                const member = await findMemberById(userId);
                if (!member) {
                    console.log(`Member ID ${userId} not found in any guild.`);
                    continue;
                }

                await channel.send(`${member} LOLから逃げるな`);
            } catch (error) {
                console.error(`Error sending notification for ${summonerName}:`, error.message);
            }
        }
    }
}, CHECK_INTERVAL);

/**
 * ユーザーIDからGuildMemberを探す関数
 */
async function findMemberById(userId) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return null;

    // 全てのGuildをチェック
    for (const guild of client.guilds.cache.values()) {
        const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
        if (member) return member;
    }

    return null;
}

