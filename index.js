// index.js

/***************************************************
 * 1) 必要なモジュールのインポート
 ***************************************************/
const { Client, GatewayIntentBits } = require('discord.js');
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
 * 4) ユーザーが最後にLoLを起動した時刻を保持するMap
 *    - key: userId
 *    - value: Dateオブジェクト（最後にLoLを開始した時間）
 ***************************************************/
const lastPlayTimeMap = new Map();

/***************************************************
 * 5) Discordクライアントの作成
 ***************************************************/
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,    // presenceUpdate イベントに必要
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/***************************************************
 * 6) Botが起動したときに一度だけ呼ばれる処理
 ***************************************************/
client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);

  // 監視タスクの開始
  const intervalMs = CHECK_INTERVAL_HOURS * 60 * 60 * 1000;
  setInterval(checkInactiveUsers, intervalMs);
});

/***************************************************
 * 7) presenceUpdate イベントハンドラ
 *    - ユーザーのアクティビティが更新されるたびに呼ばれる
 *    - LoLをプレイ開始した時刻を記録
 ***************************************************/
client.on('presenceUpdate', (oldPresence, newPresence) => {
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
 * 8) 1時間ごとに呼ばれる関数: checkInactiveUsers
 *    - 24時間LoLを起動していないユーザーに通知
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
          content: `${member} LOLから逃げるな。`
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
 * 9) ユーザーIDからGuildMemberを探す関数
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
 * 10) Discord Bot にログイン
 ***************************************************/
if (!token) {
  console.error('DISCORD_BOT_TOKEN が設定されていません。環境変数を確認してください。');
  process.exit(1);
}
client.login(token);

/***************************************************
 * 11) Express サーバーを起動
 *     - Koyeb での安定稼働のために必要
 ***************************************************/
const app = express();
app.get('/', (req, res) => {
  res.send('Discord Bot is running on Koyeb!');
});

app.listen(port, () => {
  console.log(`HTTP server running on port ${port}`);
});
