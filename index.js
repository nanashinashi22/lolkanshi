/************************************************************
 * index.js - Riot API + Slash Commands (LoLプレイ時間確認)
 * 
 * Koyeb環境用に修正済み。
 * エラーハンドリングと変数宣言を適切に行っています。
 *************************************************************/

// ------- 1) 必要なモジュールのインポート -------
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

// ------- 2) Koyeb環境変数を読む -------
const token      = process.env.DISCORD_BOT_TOKEN;
const clientId   = process.env.CLIENT_ID;       // アプリのClient ID
const guildId    = process.env.GUILD_ID;        // テスト用Guild ID
const riotApiKey = process.env.RIOT_API_KEY;    // LoL APIキー
const targetChannelId = process.env.TARGET_CHANNEL_ID || null; 
const port       = process.env.PORT || 3000;

// ------- 3) ユーザーデータ (summoner name 紐づけ) -------
const usersFile = 'users.json';
let users = {};

// 初回起動時にusers.jsonを作成、存在する場合は読み込む
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

// ユーザーデータ保存関数
function saveUsers() {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

// ------- 4) グローバル変数の宣言 -------
let isActive = true;         // 監視機能のフラグ
let monitorInterval = null; // 監視タスクのインターバルID

const CHECK_INTERVAL_HOURS = 1;
const INACTIVE_LIMIT_HOURS = 24;

// ------- 5) Botクライアントの作成 -------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ------- 6) Bot起動時の処理 -------
client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  // 監視機能を起動
  startMonitoring();
});

// ------- 7) Slash Commands の定義 -------
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

  // /register (user, summoner)
  new SlashCommandBuilder()
    .setName('register')
    .setDescription('LoLサモナー名をディスコードに紐づける')
    .addUserOption(opt =>
      opt
        .setName('user')
        .setDescription('Discordのユーザー名')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('summoner')
        .setDescription('LoLサモナー名')
        .setRequired(true)
    ),

  // /check (user)
  new SlashCommandBuilder()
    .setName('check')
    .setDescription('最後にLOLをプレイしてからどれくらい経ったか')
    .addUserOption(opt =>
      opt
        .setName('user')
        .setDescription('Discordのユーザー名')
        .setRequired(true)
    ),
].map(cmd => cmd.toJSON());

// ------- 8) コマンドをGuildに登録する関数 -------
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

// ------- 9) LoL API 呼び出し (SummonerName→puuid→matches) -------

// SummonerNameからpuuid取得
async function getPUUIDfromSummonerName(summonerName) {
  const region = 'jp1'; // 日本サーバー
  const url = `https://${region}.api.riotgames.com/lol/summoner/v4/summoners/by-name/${encodeURIComponent(summonerName)}`;
  try {
    const res = await axios.get(url, {
      headers: {
        'X-Riot-Token': riotApiKey
      }
    });
    return res.data.puuid;
  } catch (err) {
    console.error(`getPUUIDfromSummonerName error:`, err.response?.data || err.message);
    return null;
  }
}

// puuid から最新1試合の終了時間を取得
async function getLastMatchEndTime(puuid) {
  const matchRegion = 'asia'; // LoL Match APIのリージョン
  const url = `https://${matchRegion}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=1`;
  try {
    const matchRes = await axios.get(url, {
      headers: { 'X-Riot-Token': riotApiKey }
    });
    if (!matchRes.data || matchRes.data.length === 0) {
      return null; // 試合履歴なし
    }
    const matchId = matchRes.data[0]; // 最新1件

    // 次に match詳細を取得
    const detailUrl = `https://${matchRegion}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
    const detailRes = await axios.get(detailUrl, {
      headers: { 'X-Riot-Token': riotApiKey }
    });
    const gameEndTimestamp = detailRes.data.info.gameEndTimestamp; 
    return new Date(gameEndTimestamp);
  } catch (err) {
    console.error(`getLastMatchEndTime error:`, err.response?.data || err.message);
    return null;
  }
}

// SummonerName から 最後のプレイ時間を取得
async function getLastPlayTime(summonerName) {
  const puuid = await getPUUIDfromSummonerName(summonerName);
  if (!puuid) {
    return null;
  }
  const endTime = await getLastMatchEndTime(puuid);
  return endTime; // null or Date
}

// ------- 10) interactionCreate イベントハンドラー -------
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const { commandName } = interaction;

    if (commandName === 'login') {
      // 監視機能オン
      if (isActive) {
        await interaction.reply('監視機能は既にオンです。');
      } else {
        isActive = true;
        startMonitoring();
        await interaction.reply('監視機能をオンにしました。');
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
      const ruleText = `
**Botの説明:**

- /login : 監視機能をオン
- /logout : 監視機能をオフ
- /rule : この説明を表示
- /register (user, summoner) : LoLサモナー名を登録
- /check (user) : 最後にLOLをプレイしてからどれくらい経ったか
      `;
      await interaction.reply(ruleText);

    } else if (commandName === 'register') {
      // /register (user, summoner)
      const user = interaction.options.getUser('user');
      const summonerName = interaction.options.getString('summoner');

      // SummonerNameの存在を検証
      const puuid = await getPUUIDfromSummonerName(summonerName);
      if (!puuid) {
        await interaction.reply(`サモナー名「${summonerName}」が見つかりませんでした。`);
        return;
      }

      // ユーザーを登録
      users[user.id] = summonerName;
      saveUsers();

      if (user.id === interaction.user.id) {
        await interaction.reply(`あなたのLoLサモナー名を「${summonerName}」として登録しました。`);
      } else {
        await interaction.reply(`${user} さんのLoLサモナー名を「${summonerName}」として登録しました。`);
      }

    } else if (commandName === 'check') {
      // /check (user)
      const user = interaction.options.getUser('user');
      const summonerName = users[user.id];

      if (!summonerName) {
        await interaction.reply(`${user} さんはまだ登録されていません。 /register コマンドでサモナー名を紐づけてください。`);
        return;
      }

      // プレイ時間を取得
      const lastEnd = await getLastPlayTime(summonerName);
      if (!lastEnd) {
        await interaction.reply(`${user} さんはまだプレイ履歴がありません。`);
        return;
      }

      const now = new Date();
      const diffMs = now - lastEnd;
      const diffH = Math.floor(diffMs / (1000 * 60 * 60));
      const d = Math.floor(diffH / 24);
      const h = diffH % 24;
      let timeString = '';
      if (d > 0) timeString += `${d}日 `;
      timeString += `${h}時間`;

      await interaction.reply(`${user} さん (SummonerName: ${summonerName}) は、最後にプレイしてから **${timeString}** 経過しています。`);
    }

  } catch (error) {
    console.error('Error handling interaction:', error);
    // インタラクションにエラーを通知
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('エラーが発生しました。後ほど再試行してください。');
    } else {
      await interaction.reply({ content: 'エラーが発生しました。後ほど再試行してください。', ephemeral: true });
    }
  }
});

// ------- 11) 監視処理 -------
async function checkInactiveUsers() {
  const now = new Date();
  for (const userId in users) {
    const summonerName = users[userId];
    const lastEndTime = await getLastPlayTime(summonerName);
    if (!lastEndTime) {
      console.log(`${summonerName} はまだプレイ履歴なし`);
      continue;
    }
    const diffH = (now - lastEndTime) / (1000 * 60 * 60);
    if (diffH >= INACTIVE_LIMIT_HOURS) {
      try {
        if (!targetChannelId) {
          console.log('No targetChannelId, skipping notification.');
          continue;
        }
        const channel = await client.channels.fetch(targetChannelId);
        if (!channel) {
          console.log(`Channel ${targetChannelId} not found.`);
          continue;
        }

        const member = await findMemberById(userId);
        if (!member) {
          console.log(`Member with ID ${userId} not found.`);
          continue;
        }

        await channel.send(`${member} さん、もう${INACTIVE_LIMIT_HOURS}時間LOLをしていません！（SummonerName: ${summonerName}）`);
        // 通知後データ削除
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

// ------- 12) ユーザーIDからGuildMemberを取得 -------
async function findMemberById(userId) {
  try {
    const member = await client.guilds.cache.get(guildId)?.members.fetch(userId);
    return member || null;
  } catch (error) {
    console.error(`Error fetching member ${userId}:`, error);
    return null;
  }
}

// ------- 13) コマンド登録とBot起動 -------
async function main() {
  await registerSlashCommands(); // スラッシュコマンドをGuildに登録
  await client.login(token);      // Botをログイン
}

main().catch(console.error);

// ------- 14) 簡易ウェブサーバー -------
const app = express();
app.get('/', (req, res) => {
  res.send('Bot is running with real LoL Summoner check approach!');
});
app.listen(port, () => {
  console.log(`HTTP server listening on port ${port}`);
});
