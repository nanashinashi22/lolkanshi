// riotapi.js
const axios = require('axios');

/**
 * 例: 環境変数から取得
 * Valorant等の実際のエンドポイントに合わせて変更してください
 */
const RIOT_API_KEY = process.env.RIOT_API_KEY;
const REGION = 'ap'; // Valorantなら "ap" (APAC) など
const API_BASE_URL = `https://${REGION}.api.riotgames.com`;

/**
 * Riot IDを検証するダミー関数
 * @param {string} riotId - "Name#Tag" 形式
 * @returns {boolean} - 例: Riot ID が存在するか
 */
async function validateRiotID(riotId) {
  try {
    // 実際は Valorant API, 例えば /val/account/v1/accounts/by-riot-id/{gameName}/{tagLine} などを呼ぶ
    // ここではダミーで常に true とする
    console.log(`(Dummy) Checking if ${riotId} is valid...`);
    return true;
  } catch (error) {
    console.error(`Error validating RiotID (${riotId}):`, error.message);
    return false;
  }
}

/**
 * Riot IDの最後のプレイ時間を取得するダミー関数
 * @param {string} riotId - "Name#Tag"
 * @returns {Date|null} - 最後のプレイ時間、未プレイならnull
 */
async function getLastPlayTimeFromRiotID(riotId) {
  try {
    // 実際のAPI呼び出し例 (Valorant):
    // GET /val/match/v1/matches/by-puuid/{puuid} ...
    // ここではダミーで、常に今から5時間前を返す
    console.log(`(Dummy) Fetching last play time for ${riotId}...`);
    
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    return fiveHoursAgo;
  } catch (error) {
    console.error(`Error fetching last play time for ${riotId}:`, error.message);
    return null;
  }
}

module.exports = { validateRiotID, getLastPlayTimeFromRiotID };
