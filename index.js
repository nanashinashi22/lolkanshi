/************************************************************
 * index.js
 * 
 * スラッシュコマンドの定義は registerCommands.js 側にある前提。
 * ここでは Bot起動 + interactionCreate + 監視機能 を記述。
 * 
 * コマンド:
 *   /login  (監視オン)
 *   /logout (監視オフ)
 *   /rule   (ボットの説明)
 *   /register (user, riotid, tag)  <-- Tagを含めたRiotID登録
 *   /check (user) <-- LOLプレイ時間確認 (ダミー)
 ************************************************************/

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const express = require('express');
const fs = require('fs');
const axios = require('axios');

// 環境変数 (Koyebで設定)
const token         = process.env.DISCORD_BOT_TOKEN;
const riotApiKey    = process.env.RIOT_API_KEY || '';
const targetChannelId = process.env.TARGET_CHANNEL_ID || null;
const guildId       = process.env.GUILD_ID || null;   // 監視用ギルドID (optional)
const port          = process.env.PORT || 3000;

// ユーザーデータ ( { [userId]: "RiotID#Tag" } など)
const usersFile = 'users.json';
let users = {};
if (fs.existsSync(usersFile)) {
  try {
    const raw = fs.readFileSync(usersFile, 'utf-8');
    users = JSON.parse(raw);
  } catch (err) {
    console.error('Error parsing users.json:', err);
    users = {};
  }
} else {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

function saveUsers() {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

// Botクライアント
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// 監視フラグ
let isActive = true;
let monitorInterval = null;

const CHECK_INTERVAL_HOURS = 1;
const INACTIVE_LIMIT_HOURS = 24;

// ダミー: SummonerName or "RiotID#Tag" から最後のプレイ時間を取得
// 実際は Riot API (LoL or Valorant) を呼ぶ。
async function getLastPlayTime(riotIdFull) {
  // ダミーで "4時間前" を返すだけ
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
  return fourHoursAgo;
}

// ユーザーIDからGuildMemberを探す
async function findMemberById(userId) {
  try {
    // もし guildId が特定のギルドなら:
    if (!guildId) return null;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return null;
    const member = await guild.members.fetch(userId);
    return member || null;
  } catch (err) {
    return null;
  }
}

// 監視タスク
async function checkInactiveUsers() {
  const now = new Date();
  for (const userId in users) {
    const riotIdFull = users[userId];
    const lastEndTime = await getLastPlayTime(riotIdFull);
    if (!lastEndTime) {
      console.log(`[checkInactiveUsers] ${riotIdFull} has no data`);
      continue;
    }
    const diffH = (now - lastEndTime) / 3600000;
    if (diffH >= INACTIVE_LIMIT_HOURS) {
      try {
        if (!targetChannelId) continue;
        const channel = await client.channels.fetch(targetChannelId);
        if (!channel) continue;
        const member = await findMemberById(userId);
        if (!member) continue;
        await channel.send(`${member} さん、もう${INACTIVE_LIMIT_HOURS}時間LOLしていません！ (RiotID: ${riotIdFull})`);
        // 通知後ユーザー削除
        delete users[userId];
        saveUsers();
      } catch (err) {
        console.error('checkInactiveUsers error:', err);
      }
    }
  }
}

// 監視ON
function startMonitoring() {
  if (monitorInterval) return;
  monitorInterval = setInterval(checkInactiveUsers, CHECK_INTERVAL_HOURS * 60 * 60 * 1000);
  console.log('監視機能が有効になりました。');
}

// 監視OFF
function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('監視機能が無効になりました。');
  }
}

// interactionCreate (slash commands)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const { commandName } = interaction;

    if (commandName === 'login') {
      if (isActive) {
        await interaction.reply('監視機能は既にオンです。');
      } else {
        isActive = true;
        startMonitoring();
        await interaction.reply('監視機能をオンにしました！');
      }

    } else if (commandName === 'logout') {
      if (!isActive) {
        await interaction.reply('監視機能は既にオフです。');
      } else {
        isActive = false;
        stopMonitoring();
        await interaction.reply('監視機能をオフにしました。');
      }

    } else if (commandName === 'rule') {
      const ruleText = `
**Botの説明:**

- /login ... 監視オン
- /logout ... 監視オフ
- /rule ... ボットの説明
- /register (user, riotid, tag) ... RiotIDを "Name#Tag" 形式で登録
- /check (user) ... 最後にLOLをプレイしてからどれくらい経ったか
`;
      await interaction.reply(ruleText);

    } else if (commandName === 'register') {
      // user, riotid, tag
      const user = interaction.options.getUser('user');
      const riotid = interaction.options.getString('riotid');
      const tag     = interaction.options.getString('tag');

      const riotIdFull = `${riotid}#${tag}`;
      // ここで実際は "validateRiotID" or SummonerName check など
      users[user.id] = riotIdFull;
      saveUsers();

      if (user.id === interaction.user.id) {
        await interaction.reply(`あなたのRiotIDを「${riotIdFull}」として登録しました。`);
      } else {
        await interaction.reply(`${user} さんのRiotIDを「${riotIdFull}」として登録しました。`);
      }

    } else if (commandName === 'check') {
      // user
      const user = interaction.options.getUser('user');
      const riotIdFull = users[user.id];
      if (!riotIdFull) {
        await interaction.reply(`${user} さんはまだ登録されていません ( /register )`);
        return;
      }
      const lastTime = await getLastPlayTime(riotIdFull);
      if (!lastTime) {
        await interaction.reply(`${user} さん (RiotID: ${riotIdFull}) はプレイ履歴なし。`);
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

  } catch (err) {
    console.error('interactionCreate error:', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('エラーが発生しました。');
    } else {
      await interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
    }
  }
});

// Bot起動
client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  // Bot起動時に監視スタート
  startMonitoring();
});

// スラッシュコマンドの登録は "registerCommands.js" で実行する前提なので
// ここでは Bot 本体を起動するだけ
client.login(token);

// Koyeb用 Web サーバー
const app = express();
app.get('/', (req, res) => {
  res.send('Bot is running, with /registerのタグ入力対応!');
});
app.listen(port, () => {
  console.log(`HTTP server on port ${port}`);
});
