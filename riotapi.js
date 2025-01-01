// riotapi.js
// RiotID (Name#Tag) を処理するためのダミー実装例。
// LoL 用 SummonerName ではなく、Valorant 等の RiotID を扱う想定。
// 実際には Valorant API などのエンドポイントを呼び出すように実装を変更してください。

const axios = require('axios');

const RIOT_API_KEY = process.env.RIOT_API_KEY || '';
// 例: Valorantなら "ap", "na" などを指定
const REGION = 'ap';

// ダミー: RiotID "Name#Tag" でAPI_BASE_URLを決める (Valorantの例)
const API_BASE_URL = `https://${REGION}.api.riotgames.com`;

/**
 * ダミー: RiotIDを検証する
 * @param {string} riotId - "Name#Tag" 形式
 * @returns {boolean} - 例: APIで存在確認できたらtrue
 */
async function validateRiotID(riotId) {
  try {
    console.log(`[Dummy] validateRiotID: checking if ${riotId} is valid...`);
    // 実際には Valorant API で /val/account/v1/accounts/by-riot-id/{gameName}/{tagLine} など叩いて確認
    // ここでは常に true で返すダミー
    return true;
  } catch (error) {
    console.error(`validateRiotID error:`, error.response?.data || error.message);
    return false;
  }
}

/**
 * ダミー: RiotIDから最後にプレイした日時を取得
 * @param {string} riotId - "Name#Tag"
 * @returns {Date|null}
 */
async function getLastPlayTimeFromRiotID(riotId) {
  try {
    console.log(`[Dummy] getLastPlayTimeFromRiotID: fetch last play time of ${riotId}`);
    // 実際には試合履歴APIなどを呼び出し、最新試合の終了時刻を返す
    // ここでは5時間前を仮定して返す
    return new Date(Date.now() - (5 * 60 * 60 * 1000));
  } catch (error) {
    console.error(`getLastPlayTimeFromRiotID error:`, error.response?.data || error.message);
    return null;
  }
}

module.exports = {
  validateRiotID,
  getLastPlayTimeFromRiotID
};
