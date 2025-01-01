// index.js

/***********************************************************************
 * 1) 必要なモジュールのインポート
 ***********************************************************************/
const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require('discord.js');
const express = require('express');
const { getLastPlayTime, getSummonerByName } = require('./riotapi'); // Riot API用モジュール
const fs = require('fs');
require('dotenv').config(); // 環境変数の読み込み

/***********************************************************************
 * 2) 環境変数の読み込み
 ***********************************************************************/
const token = process.env.DISCORD_BOT_TOKEN;
const riotApiKey = process.env.RIOT_API_KEY;
const targetChannelId = process.env.TARGET_CHANNEL_ID;
const port = process.env.PORT || 3000;

/***********************************************************************
 * 3) ユーザー情報の管理
 ***********************************************************************/
const usersFile = 'users.json';
let users = {};

// JSONファイルからユーザーデータを読み込む
if (fs.existsSync(usersFile)) {
    const data = fs.readFileSync(usersFile, 'utf-8');
    try {
        users = JSON.parse(data);
    } catch (error) {
        console.error(`Error parsing ${usersFile}:`, error.message);
        users = {};
    }
} else {
    // ファイルが存在しない場合は作成
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

/***********************************************************************
 * 4) ユーザーデータを保存する関数
 ***********************************************************************/
function saveUsers() {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

/***********************************************************************
 * 5) Discordクライアントの作成
 ***********************************************************************/
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

/***********************************************************************
 * 6) Botが起動したときに一度だけ呼ばれる処理
 ***********************************************************************/
client.once('ready', () => {
    console.log(`Bot logged in as ${client.user.tag}`);
});

/***********************************************************************
 * 7) メッセージの処理
 ***********************************************************************/
client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // Botからのメッセージは無視

    // コマンドプレフィックスを '/' に変更
    const prefix = '/';
    if (!message.content.startsWith(prefix)) return; // prefixで始まらないメッセージは無視

    // "/register aaa#1234" のような形を解析
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'register') {
        // ユーザー登録コマンド: /register @ユーザー <Summoner名#タグ>
        // または /register <Summoner名#タグ>
        let targetUserId = message.author.id; // デフォルトは自分自身
        let summonerName = '';
        let tag = '';

        if (args.length >= 1) {
            const mentionedUsers = message.mentions.users;
            if (mentionedUsers.size > 0) {
                // 他ユーザーの登録を制限（例: 管理者のみ）
                if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    message.channel.send('他のユーザーのSummoner名を登録するには管理者権限が必要です。');
                    return;
                }

                const mentionedUser = mentionedUsers.first();
                targetUserId = mentionedUser.id;
                // Summoner名#タグ を取得
                const summonerInput = args.slice(1).join(' ');
                if (!summonerInput) {
                    message.channel.send('使用方法: /register @ユーザー <Summoner名#タグ> または /register <Summoner名#タグ>');
                    return;
                }
                const [name, tagPart] = summonerInput.split('#');
                if (!name || !tagPart) {
                    message.channel.send('Summoner名とタグは「名前#タグ」の形式で入力してください。');
                    return;
                }
                summonerName = name;
                tag = tagPart;
            } else {
                // メンションがない場合、自分自身の登録
                const summonerInput = args.join(' ');
                const [name, tagPart] = summonerInput.split('#');
                if (!name || !tagPart) {
                    message.channel.send('Summoner名とタグは「名前#タグ」の形式で入力してください。');
                    return;
                }
                summonerName = name;
                tag = tagPart;
            }
        } else {
            // 引数が不足している場合
            message.channel.send('使用方法: /register @ユーザー <Summoner名#タグ> または /register <Summoner名#タグ>');
            return;
        }

        if (!summonerName || !tag) {
            message.channel.send('Summoner名とタグを正しく入力してください。');
            return;
        }

        // サモナーネームの検証
        const isValid = await validateSummonerName(summonerName);
        if (!isValid) {
            message.channel.send(`サモナーネーム「${summonerName}」が見つかりませんでした。名前とタグを再度確認してください。`);
            return;
        }

        // ユーザーデータに追加
        users[targetUserId] = {
            summonerName: summonerName,
            tag: tag
        };
        saveUsers();

        // 送信者が自分自身を登録した場合と他ユーザーを登録した場合でメッセージを変える
        if (targetUserId === message.author.id) {
            message.channel.send(`Summoner名を「${summonerName}#${tag}」として登録しました。`);
        } else {
            message.channel.send(`${message.mentions.users.first()} さんのSummoner名を「${summonerName}#${tag}」として登録しました。`);
        }

    } else if (command === 'check') {
        // プレイ時間確認コマンド: /check または /check @ユーザー
        let targetUserId = message.author.id; // デフォルトは自分自身

        if (args.length >= 1) {
            const mentionedUsers = message.mentions.users;
            if (mentionedUsers.size > 0) {
                targetUserId = mentionedUsers.first().id;
            } else {
                message.channel.send('使用方法: /check または /check @ユーザー');
                return;
            }
        }

        // ユーザー情報の取得
        const userData = users[targetUserId];
        if (!userData) {
            if (targetUserId === message.author.id) {
                message.channel.send('まず `/register <Summoner名#タグ>` コマンドでSummoner名を登録してください。');
            } else {
                message.channel.send('指定されたユーザーのSummoner名が登録されていません。');
            }
            return;
        }

        const { summonerName, tag } = userData;

        // 最後のLoL起動時刻の取得
        const lastPlayTime = await getLastPlayTime(summonerName);
        if (!lastPlayTime) {
            message.channel.send(`${targetUserId === message.author.id ? 'あなたは' : `${message.mentions.users.first()} さんは`} まだLoLをプレイしていません。`);
            return;
        }

        // 現在時刻と最後のプレイ時刻の差を計算
        const now = new Date();
        const diffMs = now - lastPlayTime;
        const diffHoursTotal = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHoursTotal / 24);
        const remainingHours = diffHoursTotal % 24;

        let timeString = '';
        if (diffDays > 0) {
            timeString += `${diffDays}日 `;
        }
        timeString += `${remainingHours}時間`;

        // 対象ユーザーを取得
        const targetUser = await client.users.fetch(targetUserId).catch(() => null);
        if (!targetUser) {
            message.channel.send('指定されたユーザーが見つかりません。');
            return;
        }

        message.channel.send(`${targetUser} さんは、最後にLoLを起動してから **${timeString}** 経過しています。`);

    } else if (command === 'login') {
        // 監視機能の有効化
        if (isActive) {
            message.channel.send('既に監視機能は有効です。');
        } else {
            isActive = true;
            startMonitoring();
            message.channel.send('ピピーッ❗️🔔⚡️LOL脱走兵監視botです❗️👊👮❗️');
        }

    } else if (command === 'logout') {
        // 監視機能の無効化
        if (!isActive) {
            message.channel.send('既に監視機能は無効です。');
        } else {
            isActive = false;
            stopMonitoring();
            message.channel.send('監視機能をオフにしました。');
        }

    } else if (command === 'rule') {
        // /rule でボットの使い方を表示
        const ruleMessage = `
**LOL脱走兵監視Bot コマンド一覧:**

1. **/register**  
   - **自分を登録**: \`/register <Summoner名#タグ>\`
   - **他ユーザーを登録（管理者のみ）**: \`/register @ユーザー <Summoner名#タグ>\`
   - 例: \`/register Nanashinashi22#1234\` / \`/register @User1 AnotherUser#0000\`

2. **/check**  
   - **自分のプレイ時間確認**: \`/check\`
   - **他ユーザーのプレイ時間確認**: \`/check @ユーザー\`

3. **/login**  
   - 監視機能を有効にします。
   - 有効時は24時間LoLをプレイしていないユーザーを自動通知。

4. **/logout**  
   - 監視機能を無効にします。

ぜひご活用ください！
        `;
        message.channel.send(ruleMessage);

    } else {
        message.channel.send('認識できないコマンドです。「/register」、「/check」、「/login」、「/logout」、「/rule」を使用してください。');
    }
});

/***********************************************************************
 * サモナーネームの検証関数
 ***********************************************************************/
async function validateSummonerName(summonerName) {
    try {
        const summoner = await getSummonerByName(summonerName);
        return summoner !== null;
    } catch (error) {
        console.error(`Error validating summoner name (${summonerName}):`, error.response?.data || error.message);
        return false;
    }
}

/***********************************************************************
 * 監視機能の管理
 ***********************************************************************/
let isActive = true; // 監視機能が有効かどうか
let monitorInterval = null; // 監視のインターバルID

const CHECK_INTERVAL_HOURS = 1; // 監視間隔（時間）
const INACTIVE_LIMIT_HOURS = 24; // 通知を送る基準時間（時間）

async function checkInactiveUsers() {
    const now = new Date();

    for (const userId in users) {
        const { summonerName } = users[userId];
        const lastPlayTime = await getLastPlayTime(summonerName);

        if (!lastPlayTime) {
            console.log(`${summonerName} さんは、まだLoLをプレイしていません。`);
            continue;
        }

        const diffMs = now - lastPlayTime;
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffHours >= INACTIVE_LIMIT_HOURS) {
            try {
                if (!targetChannelId) {
                    console.log('No TARGET_CHANNEL_ID set. Skipping notification.');
                    continue;
                }

                const channel = await client.channels.fetch(targetChannelId);
                if (!channel) {
                    console.log(`Channel ID ${targetChannelId} not found.`);
                    continue;
                }

                const member = await findMemberById(userId);
                if (!member) {
                    console.log(`Member ID ${userId} not found in any guild.`);
                    continue;
                }

                const totalHours = Math.floor(diffHours);
                const days = Math.floor(totalHours / 24);
                const hours = totalHours % 24;
                let timeString = '';
                if (days > 0) {
                    timeString += `${days}日 `;
                }
                timeString += `${hours}時間`;

                await channel.send(`${member} さん、もう${INACTIVE_LIMIT_HOURS}時間LoLを起動していません！LOLしろ！`);

                delete users[userId];
                saveUsers();
            } catch (err) {
                console.error('checkInactiveUsers error:', err);
            }
        }
    }
}

/**
 * 監視タスクの開始
 */
function startMonitoring() {
    if (monitorInterval) return;
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

/***********************************************************************
 * ユーザーIDからGuildMemberを探す関数
 ***********************************************************************/
async function findMemberById(userId) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return null;

    for (const guild of client.guilds.cache.values()) {
        const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
        if (member) return member;
    }
    return null;
}

/***********************************************************************
 * Discord Bot にログイン
 ***********************************************************************/
if (!token) {
    console.error('DISCORD_BOT_TOKEN が設定されていません。');
    process.exit(1);
}
client.login(token);

/***********************************************************************
 * Express サーバーを起動
 ***********************************************************************/
const app = express();
app.get('/', (req, res) => {
    res.send('Discord Bot is running on Koyeb!');
});

app.listen(port, () => {
    console.log(`HTTP server running on port ${port}`);
});
