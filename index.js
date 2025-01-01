// index.js (全文 example)

/***********************************************************************
 * 1) 必要なモジュール
 ***********************************************************************/
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const express = require('express');
const fs = require('fs');

/** 
 * riotapi.js のようなファイルを使う場合は import:
 * const { validateRiotID, getLastPlayTime } = require('./riotapi');
 * 
 * ここではダミー実装にするか、まだ riotapi.js を読み込むかはお好みで。
 */

/***********************************************************************
 * 2) 環境変数 (Koyeb内で設定)
 ***********************************************************************/
const token = process.env.DISCORD_BOT_TOKEN; 
const targetChannelId = process.env.TARGET_CHANNEL_ID || null; 
const port = process.env.PORT || 3000;

/***********************************************************************
 * 3) Botクライアント作成
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
 * 4) ローカルデータ (ユーザー情報)
 ***********************************************************************/
const usersFile = 'users.json';
let users = {};

if (fs.existsSync(usersFile)) {
  try {
    const raw = fs.readFileSync(usersFile, 'utf-8');
    users = JSON.parse(raw);
  } catch (err) {
    console.error('Error parsing users.json', err);
    users = {};
  }
} else {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

function saveUsers() {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

/***********************************************************************
 * 5) Bot起動
 ***********************************************************************/
client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
});

/***********************************************************************
 * 6) 監視機能
 ***********************************************************************/
let isActive = true;
let monitorInterval = null;

const CHECK_INTERVAL_HOURS = 1;
const INACTIVE_LIMIT_HOURS = 24;

// ダミー実装: getLastPlayTime
// ここは実際は riotapi.js 等で "Name#Tag" から取得してください。
async function getLastPlayTime(riotId) {
  // ここでは適当に "今から6時間前" と仮定する
  return new Date(Date.now() - (6 * 60 * 60 * 1000));
}

async function checkInactiveUsers() {
  const now = new Date();
  for (const userId in users) {
    const riotId = users[userId];
    const lastTime = await getLastPlayTime(riotId);
    if (!lastTime) {
      console.log(`User ${userId} (RiotID: ${riotId}) has no play records.`);
      continue;
    }
    const diffMs = now - lastTime;
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours >= INACTIVE_LIMIT_HOURS) {
      try {
        if (!targetChannelId) {
          console.log('No TARGET_CHANNEL_ID, skipping notification.');
          continue;
        }
        const channel = await client.channels.fetch(targetChannelId);
        if (!channel) continue;

        // ユーザーを取得 (GuildMember)
        const member = await findMemberById(userId);
        if (!member) {
          console.log(`Member not found for userID ${userId}`);
          continue;
        }

        await channel.send(`${member} さん、もう${INACTIVE_LIMIT_HOURS}時間LOLをしていません！ (RiotID: ${riotId})`);
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
  console.log('監視機能オン');
}

function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('監視機能オフ');
  }
}

// userId -> GuildMember を探す
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
 * 7) Slash Command (interactionCreate)
 ***********************************************************************/
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  if (commandName === 'login') {
    // 監視機能オン
    if (isActive) {
      await interaction.reply('監視機能は既にオンです。');
    } else {
      isActive = true;
      startMonitoring();
      await interaction.reply('ピピーッ❗️🔔⚡️LOL脱走兵監視botです❗️👊👮❗️LOLしろ❗️👊');
    }

  } else if (commandName === 'logout') {
    // 監視機能オフ
    if (!isActive) {
      await interaction.reply('監視機能は既にオフです。');
    } else {
      isActive = false;
      stopMonitoring();
      await interaction.reply('監視機能をオフにしました。');
    }

  } else if (commandName === 'rule') {
    // ボットの説明
    const msg = `
**Botの説明:**

- /login : 監視機能オン
- /logout : 監視機能オフ
- /rule : この説明を表示
- /register <user> <riotid> <tag> : RiotIDを紐づける
- /check <user> : 最後にLOLをプレイしてからどれくらい経ったか
`;
    await interaction.reply(msg);

  } else if (commandName === 'register') {
    // /register (user), (riotid), (tag)
    const user = interaction.options.getUser('user');
    const riotid = interaction.options.getString('riotid');
    const tag = interaction.options.getString('tag');

    // ここで "Name#Tag" としてまとめたり、さらなるバリデーションを行う
    const riotIdFull = `${riotid}#${tag}`;

    // ここで例えば "validateRiotID(riotIdFull)" を呼ぶ
    // 省略 or ダミー
    users[user.id] = riotIdFull;
    saveUsers();

    if (user.id === interaction.user.id) {
      await interaction.reply(`あなたのRiotIDを「${riotIdFull}」として登録しました。`);
    } else {
      await interaction.reply(`${user} さんのRiotIDを「${riotIdFull}」として登録しました。`);
    }

  } else if (commandName === 'check') {
    // /check (user)
    const user = interaction.options.getUser('user');
    const riotIdFull = users[user.id];
    if (!riotIdFull) {
      await interaction.reply('まだ登録されていません。 /register で登録してください。');
      return;
    }
    // 最後のプレイ時間を取得 (ダミー)
    const lastTime = await getLastPlayTime(riotIdFull);
    if (!lastTime) {
      await interaction.reply(`${user} さん (RiotID: ${riotIdFull}) はまだプレイ履歴がありません。`);
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

/***********************************************************************
 * 8) Botログイン
 ***********************************************************************/
client.login(token);

/***********************************************************************
 * 9) 簡易ウェブサーバー
 ***********************************************************************/
const app = express();
app.get('/', (req, res) => {
  res.send('Bot is up and running!');
});
app.listen(port, () => {
  console.log(`HTTP server listening on port ${port}`);
});

// (オプション) Bot起動時に監視機能開始
startMonitoring();
