// index.js

// -----------------------------
// .env の内容を読み込む
// -----------------------------
require('dotenv').config();

const {
  Client,
  GatewayIntentBits
} = require('discord.js');

// -----------------------------
// 必要な環境変数の取得
// -----------------------------
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;       // Botトークン
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID || '623556660417396736'; 
  // 上記が空の場合はデフォルト値を使う例

// ゲーム名（言語環境に応じて調整）
const LOL_GAME_NAME = 'League of Legends';

// 監視に関する設定
const CHECK_INTERVAL_HOURS = 1;    // 監視間隔 (1時間ごと)
const INACTIVE_LIMIT_HOURS = 24;   // 24時間起動していない場合に通知

// -----------------------------
// Discordクライアントを初期化
// -----------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

// -----------------------------
// ユーザーが最後にLoLを起動した時刻を記録するMap
//   key: userId
//   value: Date (LoLを起動した瞬間の時刻)
// -----------------------------
const lastPlayTimeMap = new Map();

// -----------------------------
// Botが起動したとき
// -----------------------------
client.once('ready', () => {
  console.log(`Botがログインしました: ${client.user.tag}`);

  // 1時間ごとにチェックするタイマーをセット
  const intervalMs = CHECK_INTERVAL_HOURS * 60 * 60 * 1000;
  setInterval(checkInactiveUsers, intervalMs);
});

// -----------------------------
// presenceUpdateイベント
//   ユーザーのアクティビティが更新されるたび呼ばれる
// -----------------------------
client.on('presenceUpdate', (oldPresence, newPresence) => {
  if (!newPresence || !newPresence.user) return; // nullチェック
  if (newPresence.user.bot) return;             // Botは無視

  // 新ステータスでLoLをプレイしているか？
  const isPlayingLoL = newPresence.activities.some(
    (activity) => activity.type === 0 && activity.name === LOL_GAME_NAME
  );

  // LoLをプレイしているなら、"最後にLoLを起動した時刻"を更新する
  if (isPlayingLoL) {
    lastPlayTimeMap.set(newPresence.user.id, new Date());
  }
});

// -----------------------------
// 1時間ごとに呼ばれるチェック関数
// -----------------------------
async function checkInactiveUsers() {
  const now = new Date();

  for (const [userId, lastPlayTime] of lastPlayTimeMap) {
    const diffMs = now - lastPlayTime;
    const diffHours = diffMs / (1000 * 60 * 60);

    // 24時間(= INACTIVE_LIMIT_HOURS) プレイしていない場合に通知
    if (diffHours >= INACTIVE_LIMIT_HOURS) {
      try {
        const channel = await client.channels.fetch(TARGET_CHANNEL_ID);
        if (!channel) continue;

        const member = await findMemberById(userId);
        if (!member) continue;

        // メンションつきで通知
        await channel.send({
          content: `${member} もう24時間LOLを起動していません！ LOLしろ！`
        });

        // 一度通知したらMapから削除して連続通知を防止
        lastPlayTimeMap.delete(userId);

      } catch (err) {
        console.error('通知エラー:', err);
      }
    }
  }
}

// -----------------------------
// ユーザーIDからGuildMemberを探すユーティリティ関数
// (Botが参加している全てのGuildをチェック)
// -----------------------------
async function findMemberById(userId) {
  for (const guild of client.guilds.cache.values()) {
    // キャッシュ or API でメンバーを取得
    const member = guild.members.cache.get(userId)
      || await guild.members.fetch(userId).catch(() => null);
    if (member) return member;
  }
  return null;
}

// -----------------------------
// Botにログイン
// -----------------------------
if (!DISCORD_BOT_TOKEN) {
  console.error('ERROR: .env から DISCORD_BOT_TOKEN を読み込めませんでした。');
  process.exit(1);
}
client.login(DISCORD_BOT_TOKEN);
require('./server.js');
