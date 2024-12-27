// index.js

/***************************************************
 * 1) 必要なモジュールをインポート
 ***************************************************/
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

/***************************************************
 * 2) Railway の Variables から読み取る環境変数
 *    - DISCORD_BOT_TOKEN
 *    - TARGET_CHANNEL_ID (通知を送るチャンネル)
 *    - PORT (HTTPサーバー用、Railwayが自動設定する場合も)
 ***************************************************/
const token = process.env.DISCORD_BOT_TOKEN;
const targetChannelId = process.env.TARGET_CHANNEL_ID;
const port = process.env.PORT || 3000;

/***************************************************
 * 3) 24時間監視用の設定値
 ***************************************************/
// LoLのアクティビティ名
const LOL_GAME_NAME = 'League of Legends';

// 1時間ごとにチェック
const CHECK_INTERVAL_HOURS = 1;

// 24時間起動してなかったら通知
const INACTIVE_LIMIT_HOURS = 24;

/***************************************************
 * 4) ユーザーが最後にLoLを起動した時刻を保持するMap
 *    key: userId, value: Date(最後にLoLを開始した時間)
 ***************************************************/
const lastPlayTimeMap = new Map();

/***************************************************
 * 5) Discordクライアントの作成
 ***************************************************/
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,    // presenceUpdateに必要
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/***************************************************
 * 6) Bot起動時
 ***************************************************/
client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);

  // Botが起動したら、1時間ごとに「24時間プレイなしユーザー」をチェックする
  const intervalMs = CHECK_INTERVAL_HOURS * 60 * 60 * 1000;
  setInterval(checkInactiveUsers, intervalMs);
});

/***************************************************
 * 7) presenceUpdateイベント
 *    - ユーザーのアクティビティが更新されるたびに呼ばれる
 *    - LoLプレイ開始時刻を記録する
 ***************************************************/
client.on('presenceUpdate', (oldPresence, newPresence) => {
  if (!newPresence || !newPresence.user) return; // 念のため
  if (newPresence.user.bot) return;             // Botは無視

  // 新ステータスでLoLをプレイしているかどうか
  const isPlayingLoL = newPresence.activities.some(
    (activity) => activity.type === 0 && activity.name === LOL_GAME_NAME
  );

  // LoLをプレイしているなら、lastPlayTimeMapに「今の時刻」を記録
  if (isPlayingLoL) {
    lastPlayTimeMap.set(newPresence.user.id, new Date());
  }
});

/***************************************************
 * 8) 1時間ごとに呼ばれる関数: checkInactiveUsers
 *    - 24時間LoLを起動していないユーザーに通知
 ***************************************************/
async function checkInactiveUsers() {
  // 現在時刻
  const now = new Date();

  // Map内の全ユーザーをチェック
  for (const [userId, lastPlayTime] of lastPlayTimeMap) {
    // 経過時間を(時)で計算
    const diffMs = now - lastPlayTime;
    const diffHours = diffMs / (1000 * 60 * 60);

    // 24時間(= INACTIVE_LIMIT_HOURS) 越えていたら通知
    if (diffHours >= INACTIVE_LIMIT_HOURS) {
      try {
        // 通知先チャンネルが設定されていない場合はスキップ
        if (!targetChannelId) {
          console.log('No TARGET_CHANNEL_ID set. Skipping.');
          continue;
        }

        // 該当チャンネルを取得
        const channel = await client.channels.fetch(targetChannelId);
        if (!channel) continue;

        // ユーザーを探す
        const member = await findMemberById(userId);
        if (!member) continue;

        // メンションで通知
        await channel.send({
          content: `${member} さん、もう24時間LOLを起動していません！LOLしろ！`
        });

        // 一度通知したらMapから削除して連続通知を防ぐ
        lastPlayTimeMap.delete(userId);

      } catch (err) {
        console.error('checkInactiveUsers error:', err);
      }
    }
  }
}

/***************************************************
 * 9) ユーザーIDからGuildMemberを探すユーティリティ関数
 *    (Botが参加している全サーバーから検索)
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
 * 10) Botにログイン
 *     (Railway Variables で設定したトークン)
 ***************************************************/
if (!token) {
  console.error('DISCORD_BOT_TOKEN is not set. Please check Railway Variables.');
  process.exit(1);
}
client.login(token);

/***************************************************
 * 11) Express サーバーを起動 (任意)
 *     - Railway などでWebポートをListenし、常時稼働をサポート
 ***************************************************/
const app = express();
app.get('/', (req, res) => {
  res.send('Discord Bot is running!');
});

app.listen(port, () => {
  console.log(`HTTP server running on port ${port}`);
});
