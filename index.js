// index.js

require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require('discord.js');
const express = require('express');
const fs = require('fs');

const { validateRiotID, getLastPlayTimeFromRiotID } = require('./riotapi');

const token = process.env.DISCORD_BOT_TOKEN;
const targetChannelId = process.env.TARGET_CHANNEL_ID;
const port = process.env.PORT || 3000;

const usersFile = 'users.json';
let users = {};

// ユーザーデータ読み込み
if (fs.existsSync(usersFile)) {
  const data = fs.readFileSync(usersFile, 'utf-8');
  try {
    users = JSON.parse(data);
  } catch (err) {
    console.error(`Error parsing users.json:`, err.message);
    users = {};
  }
} else {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

// ユーザーデータ保存
function saveUsers() {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
});

// 監視機能フラグなど
let isActive = true;
let monitorInterval = null;

const CHECK_INTERVAL_HOURS = 1;
const INACTIVE_LIMIT_HOURS = 24;

// 監視タスク
async function checkInactiveUsers() {
  const now = new Date();
  for (const userId in users) {
    const riotId = users[userId]; // "Name#Tag"

    const lastPlayTime = await getLastPlayTimeFromRiotID(riotId);
    if (!lastPlayTime) {
      console.log(`${riotId} はまだプレイ履歴がありません。`);
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
        if (!channel) continue;

        const member = await findMemberById(userId);
        if (!member) continue;

        await channel.send(`${member} さん、もう${INACTIVE_LIMIT_HOURS}時間プレイしていません！LOLしろ！ (RiotID: ${riotId})`);
        // 一度通知したらユーザー削除して連続通知防止
        delete users[userId];
        saveUsers();
      } catch (err) {
        console.error('checkInactiveUsers error:', err);
      }
    }
  }
}

function startMonitoring() {
  if (monitorInterval) return;
  monitorInterval = setInterval(checkInactiveUsers, CHECK_INTERVAL_HOURS * 60 * 60 * 1000);
  console.log('監視機能が有効になりました。');
}

function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('監視機能が無効になりました。');
  }
}

// ユーザーを取得
async function findMemberById(userId) {
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return null;
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (member) return member;
  }
  return null;
}

// メッセージコマンドハンドリング
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const prefix = '/';
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  if (command === 'register') {
    // /register @User  Name#Tag or /register Name#Tag
    let targetUserId = message.author.id;
    let riotId = '';

    if (args.length >= 1) {
      const mentioned = message.mentions.users;
      if (mentioned.size > 0) {
        // 管理者のみ他人を登録
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.channel.send('他ユーザーのRiotIDを登録するには管理者権限が必要です。');
        }
        const mentionUser = mentioned.first();
        targetUserId = mentionUser.id;
        // Riot ID = 残り部分
        const input = args.slice(1).join(' ');
        riotId = input;
      } else {
        riotId = args.join(' ');
      }
    } else {
      return message.channel.send('使用方法: /register @User <Name#Tag>  または /register <Name#Tag>');
    }

    if (!riotId.includes('#')) {
      return message.channel.send('RiotIDは「Name#Tag」の形式で入力してください。');
    }

    // バリデーション
    const isValid = await validateRiotID(riotId);
    if (!isValid) {
      return message.channel.send(`RiotID「${riotId}」が見つかりませんでした。正しいIDを入力してください。`);
    }

    users[targetUserId] = riotId;
    saveUsers();
    if (targetUserId === message.author.id) {
      message.channel.send(`RiotIDを「${riotId}」として登録しました。`);
    } else {
      message.channel.send(`${message.mentions.users.first()} さんのRiotIDを「${riotId}」として登録しました。`);
    }

  } else if (command === 'check') {
    // /check or /check @User
    let targetUserId = message.author.id;
    if (args.length >= 1) {
      const mentioned = message.mentions.users;
      if (mentioned.size > 0) {
        targetUserId = mentioned.first().id;
      }
    }
    const riotId = users[targetUserId];
    if (!riotId) {
      if (targetUserId === message.author.id) {
        message.channel.send('まず /register でRiotID (Name#Tag) を登録してください。');
      } else {
        message.channel.send('指定されたユーザーは登録されていません。');
      }
      return;
    }

    const lastTime = await getLastPlayTimeFromRiotID(riotId);
    if (!lastTime) {
      message.channel.send(`まだプレイ履歴がありません。 (RiotID: ${riotId})`);
      return;
    }
    const now = new Date();
    const diffMs = now - lastTime;
    const diffH = Math.floor(diffMs / 3600000);
    const d = Math.floor(diffH / 24);
    const h = diffH % 24;
    let timeString = '';
    if (d > 0) timeString += `${d}日 `;
    timeString += `${h}時間`;

    const targetUser = await findMemberById(targetUserId);
    if (!targetUser) {
      message.channel.send('ユーザー情報が見つかりません。');
      return;
    }
    message.channel.send(`${targetUser} さん (RiotID: ${riotId}) は、最後にプレイしてから **${timeString}** 経過しています。`);

  } else if (command === 'login') {
    if (isActive) {
      message.channel.send('既に監視機能は有効です。');
    } else {
      isActive = true;
      startMonitoring();
      message.channel.send('ピピーッ❗️🔔⚡️RiotID監視botです❗️👊👮❗️');
    }

  } else if (command === 'logout') {
    if (!isActive) {
      message.channel.send('既に監視機能は無効です。');
    } else {
      isActive = false;
      stopMonitoring();
      message.channel.send('監視機能をオフにしました。');
    }

  } else if (command === 'rule') {
    const ruleText = `
**RiotID監視Bot コマンド一覧**:

1. **/register**  
   - 自分を登録: \`/register Name#Tag\`
   - 他人を登録 (管理者のみ): \`/register @User Name#Tag\`

2. **/check**  
   - 自分の状況を確認: \`/check\`
   - 他人の状況を確認: \`/check @User\`

3. **/login**  
   - 監視機能を有効化し、${INACTIVE_LIMIT_HOURS}時間プレイしていないユーザーに自動通知

4. **/logout**  
   - 監視機能を無効化

ぜひお試しください！
`;
    message.channel.send(ruleText);

  } else {
    message.channel.send('認識できないコマンドです。「/register」「/check」「/login」「/logout」「/rule」などを使用してください。');
  }
});

// Bot起動
client.login(token);

// 簡易Webサーバー
const app = express();
app.get('/', (req, res) => {
  res.send('Discord Bot is running with Riot ID approach!');
});
app.listen(port, () => {
  console.log(`HTTP on port ${port}`);
});
