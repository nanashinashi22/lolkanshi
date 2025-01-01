/************************************************************
 * index.js - Riot API + Slash Commands (LoLプレイ時間確認)
 * 
 * 単一ファイルにまとめた例。
 * Koyebの場合、.env は不要で Environment Variables を設定。
 ************************************************************/

// ------- 1) 必要なモジュールのインポート -------
const { 
  Client, 
  GatewayIntentBits, 
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionsBitField
} = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const express = require('express');

// ------- 2) Koyeb環境変数を読む (.env ではなく) -------
const token      = process.env.DISCORD_BOT_TOKEN;
const clientId   = process.env.CLIENT_ID;       // アプリのClient ID
const guildId    = process.env.GUILD_ID;        // テスト用Guild ID
const riotApiKey = process.env.RIOT_API_KEY;    // LoL APIキー
const targetChannelId = process.env.TARGET_CHANNEL_ID || null; 
const port       = process.env.PORT || 3000;

// ------- 3) ユーザーデータ (summoner name 紐づけ) -------
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

// ------- 4) Botクライアント -------
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

// ------- 5) Slash Commands の定義 (Guild Commands) -------
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

  // /register (user) (summonerName)
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

// ------- 6) コマンドをGuildに登録する関数 -------
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
    console.error(err);
  }
}

// ------- 7) LoL API 呼び出し (SummonerName→puuid→matches) -------

// SummonerNameからpuuid取得
async function getPUUIDfromSummonerName(summonerName) {
  // 日本サーバーの場合: jp1
  // エンドポイント: https://jp1.api.riotgames.com/lol/summoner/v4/summoners/by-name/{summonerName}
  const region = 'jp1';
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

// puuid から最新1試合の終了時間
async function getLastMatchEndTime(puuid) {
  // https://asia.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids?start=0&count=1
  // 例: ASIAリージョン(日本鯖)
  const matchRegion = 'asia'; 
  const url = `https://${matchRegion}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=1`;
  try {
    const matchRes = await axios.get(url, {
      headers: { 'X-Riot-Token': riotApiKey }
    });
    if (!matchRes.data || matchRes.data.length === 0) {
      return null; // 試合履歴なし
    }
    const matchId = matchRes.data[0]; // 最新1件

    // 次に match詳細
    const detailUrl = `https://${matchRegion}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
    const detailRes = await axios.get(detailUrl, {
      headers: { 'X-Riot-Token': riotApiKey }
    });
    const gameEndTimestamp = detailRes.data.info.gameEndTimestamp; 
    // ミリ秒(UNIX TIME) 
    return new Date(gameEndTimestamp);
  } catch (err) {
    console.error(`getLastMatchEndTime error:`, err.response?.data || err.message);
    return null;
  }
}

// SummonerName から 最後のプレイ時間
async function getLastPlayTime(summonerName) {
  // 1) SummonerName -> puuid
  const puuid = await getPUUIDfromSummonerName(summonerName);
  if (!puuid) {
    return null;
  }
  // 2) puuid -> 最新マッチ終了時間
  const endTime = await getLastMatchEndTime(puuid);
  return endTime; // null or Date
}

// ------- 8) interactionCreate -------
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  if (commandName === 'login') {
    // 監視オン
    if (isActive) {
      await interaction.reply('監視機能は既にオンです。');
    } else {
      isActive = true;
      startMonitoring();
      await interaction.reply('ピピーッ❗️🔔⚡️LOL脱走兵監視botです❗️👊👮❗️');
    }

  } else if (commandName === 'logout') {
    // 監視オフ
    if (!isActive) {
      await interaction.reply('既にオフです。');
    } else {
      isActive = false;
      stopMonitoring();
      await interaction.reply('監視機能をオフにしました。');
    }

  } else if (commandName === 'rule') {
    // ボットの説明
    const ruleText = `
**Botの説明:**

- /login : 監視機能オン
- /logout : 監視機能オフ
- /rule : ボットの説明
- /register (user, summoner) : LoLサモナー名登録
- /check (user) : 最後にLOLをプレイしてからどれくらい経ったか
`;
    await interaction.reply(ruleText);

  } else if (commandName === 'register') {
    // /register user summoner
    const user = interaction.options.getUser('user');
    const summonerName = interaction.options.getString('summoner');
    const tagOption = interaction.options.getString('tag'); 
    // もし実際に #tag は LoL では不要だが、一応引数があれば取得
    // ここでは SummonerName + #tag として合体しない (LoLの場合)

    // example: SummonerNameだけでValidate
    const puuidCheck = await getPUUIDfromSummonerName(summonerName);
    if (!puuidCheck) {
      await interaction.reply(`サモナー名「${summonerName}」が見つかりませんでした。`);
      return;
    }

    // データ登録
    users[user.id] = summonerName; 
    saveUsers();

    if (user.id === interaction.user.id) {
      await interaction.reply(`あなたを「${summonerName}」として登録しました！`);
    } else {
      await interaction.reply(`${user} さんを「${summonerName}」として登録しました！`);
    }

  } else if (commandName === 'check') {
    // /check user
    const user = interaction.options.getUser('user');
    const summonerName = users[user.id];
    if (!summonerName) {
      await interaction.reply(`${user} はまだ登録されていません。 /register コマンドでサモナー名を紐づけてください。`);
      return;
    }
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
    let str = '';
    if (d > 0) str += `${d}日 `;
    str += `${h}時間`;

    await interaction.reply(`${user} さん (SummonerName: ${summonerName}) は、最後の試合終了から **${str}** 経過しています。`);
  }
});

// ------- 9) 監視処理 (checkInactiveUsers) -------
async function checkInactiveUsers() {
  const now = new Date();
  for (const userId in users) {
    const summonerName = users[userId];
    const lastEndTime = await getLastPlayTime(summonerName);
    if (!lastEndTime) {
      console.log(`${summonerName} はまだプレイ履歴なし`);
      continue;
    }
    const diffH = (now - lastEndTime) / 3600000;
    if (diffH >= 24) {
      // 24時間以上
      try {
        if (!targetChannelId) continue;
        const channel = await client.channels.fetch(targetChannelId);
        if (!channel) continue;
        const member = await findMemberById(userId);
        if (!member) continue;
        await channel.send(`${member} LOLから逃げるな。お前を見ている`);
        // 通知後データ削除
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
  console.log('監視機能オ ン');
}
function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('監視機能オ フ');
  }
}

async function findMemberById(userId) {
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return null;
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (member) return member;
  }
  return null;
}

// ------- 10) コマンド登録 (on Bot start) -------
async function main() {
  await registerSlashCommands(); // これにより "/login" 等をGuild Commandsに登録
  client.login(token);
}

// ------- 11) Webサーバー & 実行 -------
const app = express();
app.get('/', (req, res) => {
  res.send('Bot is running with real LoL Summoner check approach!');
});
app.listen(port, () => {
  console.log(`HTTP on port ${port}`);
});

// 実行
main().catch(console.error);
