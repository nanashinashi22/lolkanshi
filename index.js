/************************************************************
 * index.js
 * 
 * /login, /logout, /rule, /register (user, riotid, tag), /check (user)
 * タグ入力を含む「RiotID (Name#Tag)」に近い形式を想定
 * LoL APIとは別で、利用者の希望通りにtagまで入力できる。
 ************************************************************/

const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  REST, 
  Routes, 
  SlashCommandBuilder 
} = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const express = require('express');

// 1) 環境変数 (Koyeb の場合)
const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId  = process.env.GUILD_ID;
const riotApiKey = process.env.RIOT_API_KEY || '';
const targetChannelId = process.env.TARGET_CHANNEL_ID || null;
const port = process.env.PORT || 3000;

// 2) ユーザーデータ (userId => "SummonerName#Tag" or RiotID など)
const usersFile = 'users.json';
let users = {};
if (fs.existsSync(usersFile)) {
  try {
    users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
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

// 3) Botクライアント
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

let isActive = true;  // 監視フラグ
let monitorInterval = null;
const CHECK_INTERVAL_HOURS = 1;
const INACTIVE_LIMIT_HOURS = 24;

// 4) Slash Commands 定義
const commands = [
  // /login
  new SlashCommandBuilder()
    .setName('login')
    .setDescription('監視機能をオン'),
  
  // /logout
  new SlashCommandBuilder()
    .setName('logout')
    .setDescription('監視機能をオフ'),

  // /rule
  new SlashCommandBuilder()
    .setName('rule')
    .setDescription('ボットの説明'),

  // /register (user, riotid, tag)
  new SlashCommandBuilder()
    .setName('register')
    .setDescription('RiotIDをディスコードに紐づける (Name + #Tag)')
    .addUserOption(opt => 
      opt.setName('user')
         .setDescription('ディスコード内ユーザー名')
         .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('riotid')
         .setDescription('RiotID (Name部分)')
         .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('tag')
         .setDescription('タグ (#あとに続く文字)')
         .setRequired(true)
    ),

  // /check (user)
  new SlashCommandBuilder()
    .setName('check')
    .setDescription('最後にLOLをプレイしてからどれくらい経ったか (ダミー実装)')
    .addUserOption(opt =>
      opt.setName('user')
         .setDescription('ディスコード内ユーザー名')
         .setRequired(true)
    )
].map(cmd => cmd.toJSON());

// 5) コマンドをGuildに登録
async function registerSlashCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    console.log('[registerSlashCommands] Registering...');
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );
    console.log('[registerSlashCommands] Done. (/login, /logout, /rule, /register, /check)');
  } catch (err) {
    console.error('[registerSlashCommands] Error:', err);
  }
}

// 6) ダミー: getLastPlayTime (常に4時間前を返す例)
async function getLastPlayTime(riotIdFull) {
  // riotIdFull = "Name#Tag"
  // ここで実際は Riot API / Valorant API / LoL SummonerName など呼び出す
  // ダミーで4時間前:
  return new Date(Date.now() - (4 * 60 * 60 * 1000));
}

// 7) 監視処理
async function checkInactiveUsers() {
  const now = new Date();
  for (const userId in users) {
    const riotIdFull = users[userId]; // 例 "Nanashinashi#1234"
    const lastEndTime = await getLastPlayTime(riotIdFull);
    if (!lastEndTime) {
      console.log(`${riotIdFull} はまだプレイ履歴なし`);
      continue;
    }
    const diffH = (now - lastEndTime) / (1000 * 60 * 60);
    if (diffH >= INACTIVE_LIMIT_HOURS) {
      try {
        if (!targetChannelId) continue;
        const channel = await client.channels.fetch(targetChannelId);
        if (!channel) continue;
        const member = await findMemberById(userId);
        if (!member) continue;
        await channel.send(`${member} さん、もう${INACTIVE_LIMIT_HOURS}時間LOLをしていません！ (RiotID: ${riotIdFull})`);
        // 一度通知したら削除
        delete users[userId];
        saveUsers();
      } catch (err) {
        console.error('Error in checkInactiveUsers:', err);
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

// userId → GuildMember
async function findMemberById(userId) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return null;
    const member = await guild.members.fetch(userId);
    return member || null;
  } catch (err) {
    return null;
  }
}

// 8) Interactionハンドラ
client.on('interactionCreate', async interaction => {
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
      const ruleText = `
**Botの説明:**

- /login ... 監視オン
- /logout ... 監視オフ
- /rule ... この説明を表示
- /register (user, riotid, tag) ... RiotIDを登録 (Name#Tag)
- /check (user) ... LOL最後のプレイから何時間経ったか (ダミー)
      `;
      await interaction.reply(ruleText);
    }
    else if (commandName === 'register') {
      // user, riotid, tag
      const user = interaction.options.getUser('user');
      const riotid = interaction.options.getString('riotid');
      const tag = interaction.options.getString('tag');
      const riotIdFull = `${riotid}#${tag}`;

      // ダミーで "validateRiotID"
      // 実際にAPI呼んで存在確認するなら実装
      console.log(`Registering ${user.id} => ${riotIdFull}`);
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
        await interaction.reply(`${user} さんはまだ登録されていません。(/register で登録)`);
        return;
      }
      // 最後にLOLをプレイしてから何時間か (ダミー)
      const lastTime = await getLastPlayTime(riotIdFull);
      if (!lastTime) {
        await interaction.reply(`${user} さん (RiotID: ${riotIdFull}) はまだプレイ履歴なし。`);
        return;
      }
      const now = new Date();
      const diffMs = now - lastTime;
      const diffH = Math.floor(diffMs / (1000 * 60 * 60));
      const d = Math.floor(diffH / 24);
      const h = diffH % 24;
      let timeString = '';
      if (d > 0) timeString += `${d}日 `;
      timeString += `${h}時間`;

      await interaction.reply(`${user} さん (RiotID: ${riotIdFull}) は、最後にプレイしてから **${timeString}** 経過しています。`);
    }
  } catch (error) {
    console.error('Interaction error:', error);
    if (interaction.deferred || interaction.replied) {
      // 既に返信している場合は editReply
      await interaction.editReply('エラーが発生しました。');
    } else {
      // まだ返信していない場合は reply
      await interaction.reply('エラーが発生しました。');
    }
  }
});

// 9) コマンド登録 + Bot起動
async function registerSlashCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );
    console.log('Slash commands registered!');
  } catch (err) {
    console.error('registerSlashCommands error:', err);
  }
}
async function main() {
  await registerSlashCommands();
  client.login(token);
}

// 10) Webサーバー & startMonitoring
const app = express();
app.get('/', (req, res) => {
  res.send('Bot with /register のタグ入力 OK!');
});
app.listen(port, () => {
  console.log(`HTTP server listening on ${port}`);
});

// init
main().catch(console.error);

function startMonitoring() {
  if (monitorInterval) return;
  monitorInterval = setInterval(checkInactiveUsers, CHECK_INTERVAL_HOURS * 3600000);
  console.log('監視機能が有効になりました。');
}
function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('監視機能が無効になりました。');
  }
}
