// riotapi.js

const axios = require('axios');

/**
 * Riot APIの設定
 */
const RIOT_API_KEY = process.env.RIOT_API_KEY; // 環境変数からAPIキーを取得
const REGION = 'jp1'; 
const API_BASE_URL = `https://${REGION}.api.riotgames.com`;


/**
 * サモナー名からサモナー情報を取得する関数
 * @param {string} summonerName - サモナー名
 * @returns {Object|null} - サモナー情報オブジェクトまたはnull
 */
async function getSummonerByName(summonerName) {
    try {
        const response = await axios.get(`${API_BASE_URL}/lol/summoner/v4/summoners/by-name/${encodeURIComponent(summonerName)}`, {
            headers: {
                'X-Riot-Token': RIOT_API_KEY
            }
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching summoner by name (${summonerName}):`, error.response?.data || error.message);
        return null;
    }
}

/**
 * サモナーIDからマッチリストを取得する関数
 * @param {string} puuid - サモナーのPUUID
 * @param {number} count - 取得するマッチの数（デフォルト: 5）
 * @returns {Array|null} - マッチIDの配列またはnull
 */
async function getMatchList(puuid, count = 5) {
    try {
        const response = await axios.get(`${API_BASE_URL}/lol/match/v5/matches/by-puuid/${puuid}/ids`, {
            headers: {
                'X-Riot-Token': RIOT_API_KEY
            },
            params: {
                start: 0,
                count: count
            }
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching match list for puuid (${puuid}):`, error.response?.data || error.message);
        return null;
    }
}

/**
 * マッチIDからマッチ詳細を取得する関数
 * @param {string} matchId - マッチID
 * @returns {Object|null} - マッチ詳細オブジェクトまたはnull
 */
async function getMatchDetails(matchId) {
    try {
        const response = await axios.get(`${API_BASE_URL}/lol/match/v5/matches/${matchId}`, {
            headers: {
                'X-Riot-Token': RIOT_API_KEY
            }
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching match details (${matchId}):`, error.response?.data || error.message);
        return null;
    }
}

/**
 * サモナーの最後のプレイ時間を取得する関数
 * @param {string} summonerName - サモナー名
 * @returns {Date|null} - 最後のプレイ時間のDateオブジェクトまたはnull
 */
async function getLastPlayTime(summonerName) {
    const summoner = await getSummonerByName(summonerName);
    if (!summoner) return null;

    const puuid = summoner.puuid;
    const matchList = await getMatchList(puuid, 1); // 最新のマッチ1件を取得
    if (!matchList || matchList.length === 0) {
        console.log(`${summonerName} さんは、まだLoLをプレイしていません。`);
        return null;
    }

    const latestMatchId = matchList[0];
    const matchDetails = await getMatchDetails(latestMatchId);
    if (!matchDetails) return null;

    const gameEndTimestamp = matchDetails.info.gameEndTimestamp;
    const gameEndDate = new Date(gameEndTimestamp);
    return gameEndDate;
}

module.exports = { getLastPlayTime };
