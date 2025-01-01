/************************************************************
 * index.js
 * 
 * 概要:
 *  1. /register (user, summonerName) でLoLサモナー名を紐づけ
 *  2. /check (user) で最新マッチ終了時間をLoL APIから取得し、
 *     今何時間経過したか計算して返信
 *  3. /login, /logout, /rule は監視機能のオンオフや説明
 *  
 * アプリケーションコマンドはすでに registerCommands.js などで
 * /login, /logout, /rule, /register, /check を登録済み想定。
 ************************************************************/

const {
  Client,
  GatewayIntentBits,
  Partials
} = require('discord.js');
const axios = require('axios');
const fs   = require('fs');
const express = require('express');


// ------ 1) Koyebなどの環境変数 ------
const token      = process.env.DISCORD_BOT_TOKEN;  // Botトークン
const riotApiKey = process.env.RIOT_API_KEY;       // Riot APIキー (LoL)
const targetChannelId = process.env.TARGET_CHANNEL_ID || null;
const guildId    = process.env.GUILD_ID || null;   // 監視対象Guild ID
const port       = process.env.PORT || 3000;

// ------ 2) データ保存 (users.json) ------
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

// ------ 3) Botクライアント ------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});


// ------ 4) 監視機能のフラグ & 定数 ------
let isActive = true;
let monitorInterval = null;
const CHECK_INTERVAL_HOURS = 1;      // 1時間毎にチェック
const INACTIVE_LIMIT_HOURS = 24;    // 24時間以上で警告

// ------ 5) LoL SummonerName → 最終プレイ時間を取得する関数群 ------
/**
 * SummonerName から PUUID を取得
 * 日本サーバーなら region = 'jp1'
 */
async function getPUUIDfromSummonerName(summonerName) {
  const region = 'jp1'; // 日本サーバー
  const url = `https://${region}.api.riotgames.com/lol/summoner/v4/summoners/by-name/${encodeURIComponent(summonerName)}`;
  try {
    const res = await axios.get(url, {
      headers: {
        'X-Riot-Token': riotApiKey
      }
    });
    return res.data.puuid; // SummonerDTO
  } catch (err) {
    console.error(`getPUUIDfromSummonerName error:`, err.response?.data || err.message);
    return null;
  }
}

/**
 * PUUID から最新マッチ1件の終了時刻を取得
 * 例: https://asia.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids
 */
async function getLastMatchEndTime(puuid) {
  if (!puuid) return null;
  const matchRegion = 'asia'; // 日本鯖の場合
  const matchListUrl = `https://${matchRegion}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=1`;
  try {
    const matchListRes = await axios.get(matchListUrl, {
      headers: { 'X-Riot-Token': riotApiKey }
    });
    if (!matchListRes.data || matchListRes.data.length === 0) {
      return null; // 試合がない
    }
    const matchId = matchListRes.data[0]; // 最新1件
    // match詳細
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

/**
 * SummonerName から「最後の試合終了時刻」を取得
 */
async function getLastPlayTime(summonerName) {
  const puuid = await getPUUIDfromSummonerName(summonerName);
  if (!puuid) return null; 
  const endTime = await getLastMatchEndTime(puuid);
  return endTime; // null or Date
}

// ------ 6) interactionCreate (SlashCommands) ------
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
**Botの説明**:

- /login ... 監視機能をオン
- /logout ... 監視機能をオフ
- /rule ... ボットの説明
- /register (user, summonerName) ... LoLサモナー名を登録
- /check (user) ... 最後のプレイからどれくらい経ったか
      `;
      await interaction.reply(ruleText);

    } else if (commandName === 'register') {
      // user, summoner, tag (例: riotid, tag)
      const user = interaction.options.getUser('user');
      const riotid = interaction.options.getString('riotid'); 
      const tag = interaction.options.getString('tag'); 
      // Name#Tag
      const summonerNameFull = `${riotid}#${tag}`; 
      // もし LoL SummonerName が本来は "Name" のみなら Tag不要
      // ここではユーザーの希望通り "tag" も保存

      // SummonerNameとして実際に検索するなら "riotid" だけ使うか、 
      // or もし SummonerName そのものに #tag は含まれないなら 
      // SummonerName = riotid (tagは別用途)

      // ここでは "summonerNameFull" を一応保存:
      users[user.id] = summonerNameFull;
      saveUsers();

      if (user.id === interaction.user.id) {
        await interaction.reply(`あなたのLoLサモナー名を「${summonerNameFull}」として登録しました。`);
      } else {
        await interaction.reply(`${user} さんのLoLサモナー名を「${summonerNameFull}」として登録しました。`);
      }

    } else if (commandName === 'check') {
      // user
      const user = interaction.options.getUser('user');
      const summonerName = users[user.id];
      if (!summonerName) {
        await interaction.reply(`${user} さんはまだ登録されていません ( /register )`);
        return;
      }

      await interaction.deferReply(); // API呼び出しが時間かかる場合に deferReply

      // Riot API呼び出し
      const lastEnd = await getLastPlayTime(summonerName);
      if (!lastEnd) {
        await interaction.editReply(`${user} さん (SummonerName: ${summonerName}) はまだプレイ履歴がありません。`);
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

      await interaction.editReply(`${user} さん (SummonerName: ${summonerName}) は、最後の試合終了から **${timeString}** 経過しています。`);
    }
  } catch (err) {
    console.error('interactionCreate error:', err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('エラーが発生しました。');
      } else {
        await interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
      }
    } catch {}
  }
});

// ------ 7) 監視タスク (checkInactiveUsers) ------
async function checkInactiveUsers() {
  const now = new Date();
  for (const userId in users) {
    const summonerName = users[userId];
    const lastEndTime = await getLastPlayTime(summonerName);
    if (!lastEndTime) {
      console.log(`[checkInactiveUsers] ${summonerName} has no match data`);
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

        await channel.send(`${member} さん、もう${INACTIVE_LIMIT_HOURS}時間LoLを起動していません！（Summoner: ${summonerName}）`);
        // 通知したら削除
        delete users[userId];
        saveUsers();
      } catch (error) {
        console.error('checkInactiveUsers error:', error);
      }
    }
  }
}

// 監視開始
function startMonitoring() {
  if (monitorInterval) return;
  monitorInterval = setInterval(checkInactiveUsers, CHECK_INTERVAL_HOURS * 3600000);
  console.log('監視機能が有効になりました。');
}

// 監視停止
function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('監視機能が無効になりました。');
  }
}

// userId -> GuildMember
async function findMemberById(userId) {
  try {
    // 監視対象のguildIdが設定されている場合のみ
    if (!guildId) return null;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return null;
    const member = await guild.members.fetch(userId);
    return member;
  } catch (err) {
    return null;
  }
}

// ------ 8) Botログイン ------
client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  // Bot起動時に監視スタート
  startMonitoring();
});

client.login(token);

// ------ 9) Webサーバー for Koyeb ------
const app = express();
app.get('/', (req, res) => {
  res.send('Bot running with real LoL Summoner fetch, plus /registerにタグ入力');
});
app.listen(port, () => {
  console.log(`HTTP server on port ${port}`);
});
