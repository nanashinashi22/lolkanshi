// index.js

/**
 * NOTE:
 * 1) .env は使わず、KoyebのEnv Varsを使用 (process.env.X)
 * 2) riotapi.js のダミー関数をインポートして利用
 */

const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require('discord.js');
const express = require('express');
const fs = require('fs');

const { validateRiotID, getLastPlayTimeFromRiotID } = require('./riotapi');

const token = process.env.DISCORD_BOT_TOKEN;  // Koyebで設定
const targetChannelId = process.env.TARGET_CHANNEL_ID || null;
const port = process.env.PORT || 3000;

const usersFile = 'users.json';
let users = {};

if (fs.existsSync(usersFile)) {
  try {
    const data = fs.readFileSync(usersFile, 'utf-8');
    users = JSON.parse(data);
  } catch (error) {
    console.error('Error parsing users.json:', error);
    users = {};
  }
} else {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

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

let isActive = true;
let monitorInterval = null;

const CHECK_INTERVAL_HOURS = 1;
const INACTIVE_LIMIT_HOURS = 24;

/**
 * 監視タスク:
 *   users[userId] => "Name#Tag"
 */
async function checkInactiveUsers() {
  const now = new Date();
  for (const userId in users) {
    const riotId = users[userId];
    const lastPlayTime = await getLastPlayTimeFromRiotID(riotId);
    if (!lastPlayTime) {
      console.log(`[Check] ${riotId} はまだプレイ記録なし`);
      continue;
    }
    const diffMs = now - lastPlayTime;
    const diffH = diffMs / (1000 * 60 * 60);
    if (diffH >= INACTIVE_LIMIT_HOURS) {
      try {
        if (!targetChannelId) {
          console.log('No targetChannelId, skipping...');
          continue;
        }
        const channel = await client.channels.fetch(targetChannelId);
        if (!channel) continue;

        const member = await findMemberById(userId);
        if (!member) continue;

        await channel.send(`${member} LOLしろ。お前を見ている。`);
        // 一度通知したら削除
        delete users[userId];
        saveUsers();
      } catch (err) {
        console.error(err);
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

// userId => GuildMember
async function findMemberById(userId) {
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return null;
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (member) return member;
  }
  return null;
}

/**
 * interactionCreate: スラッシュコマンドが呼ばれた時
 */
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  if (commandName === 'login') {
    if (isActive) {
      await interaction.reply('監視機能は既にオンです。');
    } else {
      isActive = true;
      startMonitoring();
      await interaction.reply('ピピーッ❗️🔔⚡️LOL脱走兵監視botです❗️👊👮❗️LOLしろ❗️👊');
    }
  }
  else if (commandName === 'logout') {
    if (!isActive) {
      await interaction.reply('監視機能は既にオフです。');
    } else {
      isActive = false;
      stopMonitoring();
      await interaction.reply('監視機能をオフにしました。');
    }
  }
  else if (commandName === 'rule') {
    const ruleMsg = `
**コマンド一覧:**

- /login ... 監視機能をオン
- /logout ... 監視機能をオフ
- /rule ... ボットの説明
- /register (user) (riotid) (tag) ... RiotIDを登録
- /check (user) ... 最後にLOLをプレイしてからどれくらい経ったか
`;
    await interaction.reply(ruleMsg);
  }
  else if (commandName === 'register') {
    // user, riotid, tag
    const user = interaction.options.getUser('user');
    const riotid = interaction.options.getString('riotid');
    const tag = interaction.options.getString('tag');

    const riotIdFull = `${riotid}#${tag}`;
    // validate
    const isValid = await validateRiotID(riotIdFull);
    if (!isValid) {
      return interaction.reply(`RiotID「${riotIdFull}」が見つかりませんでした。`);
    }
    users[user.id] = riotIdFull;
    saveUsers();

    if (user.id === interaction.user.id) {
      await interaction.reply(`あなたのRiotIDを「${riotIdFull}」として登録しました。`);
    } else {
      await interaction.reply(`${user} さんのRiotIDを「${riotIdFull}」として登録しました。`);
    }
  }
  else if (commandName === 'check') {
    // user
    const user = interaction.options.getUser('user');
    const riotIdFull = users[user.id];
    if (!riotIdFull) {
      await interaction.reply(`${user} さんは未登録です。/register で登録してください。`);
      return;
    }
    const lastTime = await getLastPlayTimeFromRiotID(riotIdFull);
    if (!lastTime) {
      await interaction.reply(`まだプレイ履歴がありません。 (RiotID: ${riotIdFull})`);
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

    await interaction.reply(`${user} さん (RiotID: ${riotIdFull}) は、最後にプレイしてから **${timeString}** 経過しています。`);
  }
});

/**
 * Botログイン
 */
client.login(token);

/**
 * 簡易サーバー for Koyeb
 */
const app = express();
app.get('/', (req, res) => {
  res.send('Bot is running with slash commands!');
});
app.listen(port, () => {
  console.log(`HTTP server on port ${port}`);
});

/**
 * Bot起動時に監視を開始する場合
 */
startMonitoring();
