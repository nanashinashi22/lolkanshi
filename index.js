// index.js

/***************************************************
 * 1) 必要なモジュールのインポート
 ***************************************************/
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const express = require('express');

/***************************************************
 * 2) 環境変数の読み込み
 *    - DISCORD_BOT_TOKEN: Discord Bot トークン
 *    - TARGET_CHANNEL_ID: 通知を送るチャンネルID
 *    - PORT: 任意 (デフォルトは3000)
 ***************************************************/
const token = process.env.DISCORD_BOT_TOKEN;
const targetChannelId = process.env.TARGET_CHANNEL_ID;
const port = process.env.PORT || 3000;

/***************************************************
 * 3) 24時間監視用の設定値
 ***************************************************/
const LOL_GAME_NAME = 'League of Legends'; // ゲーム名（言語設定に応じて変更）
const CHECK_INTERVAL_HOURS = 1;           // 監視間隔（時間）
const INACTIVE_LIMIT_HOURS = 24;          // 通知を送る基準時間（時間）

/***************************************************
 * 4) ボットの状態管理
 ***************************************************/
let isActive = true;                      // ボットの監視機能が有効かどうか
let monitorInterval = null;               // 監視のインターバルID

/***************************************************
 * 5) ユーザーが最後にLoLを起動した時刻を保持するMap
 *    - key: userId
 *    - value: Dateオブジェクト（最後にLoLを開始した時間）
 ***************************************************/
const lastPlayTimeMap = new Map();

/***************************************************
 * 6) Discordクライアントの作成
 ***************************************************/
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,    // presenceUpdate イベントに必要
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]            // 必要に応じてパーシャルを追加
});

/***************************************************
 * 7) Botが起動したときに一度だけ呼ばれる処理
 ***************************************************/
client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);

  // 監視タスクの開始
  startMonitoring();
});

/***************************************************
 * 8) presenceUpdate イベントハンドラ
 *    - ユーザーのアクティビティが更新されるたびに呼ばれる
 *    - LoLをプレイ開始した時刻を記録
 ***************************************************/
client.on('presenceUpdate', (oldPresence, newPresence) => {
  if (!isActive) return;                   // 監視が無効な場合は処理しない
  if (!newPresence || !newPresence.user) return; // 安全チェック
  if (newPresence.user.bot) return;             // Botは無視

  // 新ステータスでLoLをプレイしているか確認
  const isPlayingLoL = newPresence.activities.some(
    (activity) => activity.type === 0 && activity.name === LOL_GAME_NAME
  );

  // LoLをプレイしている場合、現在時刻を記録
  if (isPlayingLoL) {
    lastPlayTimeMap.set(newPresence.user.id, new Date());
  }
});

/***************************************************
 * 9) メッセージの処理
 *    - ボットへのメンションとコマンドの確認
 ***************************************************/
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;          // Botからのメッセージは無視

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

    // 最後のLoL起動時刻の取得
    const lastPlayTime = lastPlayTimeMap.get(userId);
    if (!lastPlayTime) {
      message.channel.send(`${member} さんは、まだLoLをプレイしていません。`);
      return;
    }

    // 現在時刻と最後のプレイ時刻の差を計算
    const now = new Date();
    const diffMs = now - lastPlayTime;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    message.channel.send(`${member} さんは、最後にLoLを起動してから **${diffHours} 時間** 経過しています。`);
  } else {
    message.channel.send('認識できないコマンドです。「login」、「logout」、または「! @ユーザー」を使用してください。');
  }
});

/***************************************************
 * 10) 監視タスクの開始
 ***************************************************/
function startMonitoring() {
  if (monitorInterval) return;            // 既に監視が開始されている場合はスキップ

  monitorInterval = setInterval(checkInactiveUsers, CHECK_INTERVAL_HOURS * 60 * 60 * 1000);
  console.log('監視機能が有効になりました。');
}

/***************************************************
 * 11) 監視タスクの停止
 ***************************************************/
function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('監視機能が無効になりました。');
  }
}

/***************************************************
 * 12) 1時間ごとに呼ばれる関数: checkInactiveUsers
 *     - 24時間LoLを起動していないユーザーに通知
 ***************************************************/
async function checkInactiveUsers() {
  const now = new Date();

  for (const [userId, lastPlayTime] of lastPlayTimeMap) {
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
          content: `${member} LOLから逃げるな`
        });

        // 一度通知したらMapから削除して連続通知を防止
        lastPlayTimeMap.delete(userId);

      } catch (err) {
        console.error('checkInactiveUsers error:', err);
      }
    }
  }
}

/***************************************************
 * 13) ユーザーIDからGuildMemberを探す関数
 ***************************************************/
async function findMemberById(userId) {
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(userId)
      || await guild.members.fetch(userId).catch(() => null);
    if (member) return member;
  }
  return null;
}

/***************************************************
 * 14) Discord Bot にログイン
 ***************************************************/
if (!token) {
  console.error('DISCORD_BOT_TOKEN が設定されていません。環境変数を確認してください。');
  process.exit(1);
}
client.login(token);

/***************************************************
 * 15) Express サーバーを起動
 *     - Koyeb での安定稼働のために必要
 ***************************************************/
const app = express();
app.get('/', (req, res) => {
  res.send('Discord Bot is running on Koyeb!');
});

app.listen(port, () => {
  console.log(`HTTP server running on port ${port}`);
});
