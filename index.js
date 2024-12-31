// index.js

/***************************************************
 * 1) 必要なモジュールのインポート
 ***************************************************/
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const express = require('express');
const { getLastPlayTime } = require('./opgg');
const fs = require('fs');

/***************************************************
 * 2) 環境変数の読み込み
 ***************************************************/
const token = process.env.DISCORD_BOT_TOKEN;
const targetChannelId = process.env.TARGET_CHANNEL_ID;
const port = process.env.PORT || 3000;

/***************************************************
 * 3) ユーザー情報の管理
 ***************************************************/
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

/***************************************************
 * 4) Discordクライアントの作成
 ***************************************************/
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel] // 必要に応じてパーシャルを追加
});

/***************************************************
 * 5) Botが起動したときに一度だけ呼ばれる処理
 ***************************************************/
client.once('ready', () => {
    console.log(`Bot logged in as ${client.user.tag}`);
});

/***************************************************
 * 6) メッセージの処理
 ***************************************************/
client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // Botからのメッセージは無視

    // ボットへのメンションが含まれているか確認
    const mentioned = message.mentions.has(client.user);
    if (!mentioned) return;

    // メッセージ内容を取得し、コマンドを解析
    const args = message.content.split(' ').slice(1); // メンション部分を除く
    const command = args[0]?.toLowerCase();

    if (command === 'login') {
        if (isActive) {
            message.channel.send('既に監視機能は有効です。');
        } else {
            isActive = true;
            startMonitoring();
            message.channel.send('ピピーッ❗️🔔⚡️LOL脱走兵監視botです❗️👊👮❗️');
        }
    } else if (command === 'logout') {
        if (!isActive) {
            message.channel.send('既に監視機能は無効です。');
        } else {
            isActive = false;
            stopMonitoring();
            message.channel.send('監視機能をオフにしました。');
        }
    } else if (command === '!') {
        // 新しいコマンド処理: ! @ユーザー
        const userMention = args[1]; // メンションされたユーザー
        if (!userMention) {
            message.channel.send('ユーザーをメンションしてください。例: @BotName ! @User1');
            return;
        }

        // ユーザーIDの抽出
        const userIdMatch = userMention.match(/^<@!?(\d+)>$/);
        if (!userIdMatch) {
            message.channel.send('有効なユーザーをメンションしてください。');
            return;
        }
        const userId = userIdMatch[1];

        // ユーザー情報の取得
        const member = await findMemberById(userId);
        if (!member) {
            message.channel.send('指定されたユーザーが見つかりません。');
            return;
        }

        // Summoner名の取得
        const summonerName = users[userId];
        if (!summonerName) {
            message.channel.send(`${member} さんのSummoner名が登録されていません。まず \`!register <Summoner名>\` コマンドで登録してください。`);
            return;
        }

        // 最後のLoL起動時刻の取得
        const lastPlayTime = await getLastPlayTime(summonerName);
        if (!lastPlayTime) {
            message.channel.send(`${summonerName} さんは、まだLoLをプレイしていません。`);
            return;
        }

        // 現在時刻と最後のプレイ時刻の差を計算
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

        message.channel.send(`${member} さんは、最後にLoLを起動してから **${timeString}** 経過しています。`);
    } else if (command === 'register') {
        // ユーザー登録コマンド: !register <Summoner名>
        const summonerName = args.slice(1).join(' ');
        if (!summonerName) {
            message.channel.send('使用方法: !register <Summoner名>');
            return;
        }

        users[message.author.id] = summonerName;
        saveUsers();
        message.channel.send(`Summoner名を「${summonerName}」として登録しました。`);
    } else {
        message.channel.send('認識できないコマンドです。「login」、「logout」、「! @ユーザー」、または「!register <Summoner名>」を使用してください。');
    }
});

/***************************************************
 * 7) 監視機能の管理
 ***************************************************/
let isActive = true; // 監視機能が有効かどうか
let monitorInterval = null; // 監視のインターバルID

/**
 * 監視タスクの開始
 */
function startMonitoring() {
    if (monitorInterval) return; // 既に監視が開始されている場合はスキップ

    monitorInterval = setInterval(checkInactiveUsers, CHECK_INTERVAL_HOURS * 60 * 60 * 1000);
    console.log('監視機能が有効になりました。');
}

/**
 * 監視タスクの停止
 */
function stopMonitoring() {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
        console.log('監視機能が無効になりました。');
    }
}

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

/**
 * 1時間ごとに呼ばれる関数: checkInactiveUsers
 * - 24時間LoLを起動していないユーザーに通知
 */
const CHECK_INTERVAL_HOURS = 1; // 監視間隔（時間）
const INACTIVE_LIMIT_HOURS = 24; // 通知を送る基準時間（時間）

async function checkInactiveUsers() {
    const now = new Date();

    for (const userId in users) {
        const summonerName = users[userId];
        const lastPlayTime = await getLastPlayTime(summonerName);

        if (!lastPlayTime) {
            console.log(`${summonerName} さんは、まだLoLをプレイしていません。`);
            continue;
        }

        const diffMs = now - lastPlayTime;
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffHours >= INACTIVE_LIMIT_HOURS) {
            try {
                // 通知先チャンネルIDが設定されていない場合はスキップ
                if (!targetChannelId) {
                    console.log('No TARGET_CHANNEL_ID set. Skipping notification.');
                    continue;
                }

                // チャンネルを取得
                const channel = await client.channels.fetch(targetChannelId);
                if (!channel) {
                    console.log(`Channel ID ${targetChannelId} not found.`);
                    continue;
                }

                // ユーザーを取得
                const member = await findMemberById(userId);
                if (!member) {
                    console.log(`Member ID ${userId} not found in any guild.`);
                    continue;
                }

                // メンションで通知
                await channel.send({
                    content: `${member} さん、もう${INACTIVE_LIMIT_HOURS}時間LoLを起動していません！LOLしろ！`
                });

                // 一度通知したらユーザーの記録を削除（連続通知を防止）
                delete users[userId];
                saveUsers();

            } catch (err) {
                console.error('checkInactiveUsers error:', err);
            }
        }
    }
}

/**
 * 初期監視の開始
 */
startMonitoring();

/***************************************************
 * 8) Discord Bot にログイン
 ***************************************************/
if (!token) {
    console.error('DISCORD_BOT_TOKEN が設定されていません。環境変数を確認してください。');
    process.exit(1);
}
client.login(token);

/***************************************************
 * 9) Express サーバーを起動
 ***************************************************/
const app = express();
app.get('/', (req, res) => {
    res.send('Discord Bot is running on Koyeb!');
});

app.listen(port, () => {
    console.log(`HTTP server running on port ${port}`);
});
