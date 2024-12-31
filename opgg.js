// opgg.js
const axios = require('axios');
const cheerio = require('cheerio');

/**
 * サモナー名から最後のプレイ時間を取得する関数
 * @param {string} summonerName - サモナー名
 * @returns {Date|null} - 最後のプレイ時間のDateオブジェクト、またはnull
 */
async function getLastPlayTime(summonerName) {
    try {
        // OP.GGのURLを構築（リージョンに応じてURLを変更）
        const url = `https://jp.op.gg/summoner/userName=${encodeURIComponent(summonerName)}`;
        
        // HTTPリクエストを送信
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; LOLBot/1.0)'
            }
        });
        
        const html = response.data;
        const $ = cheerio.load(html);
        
        // 最後のプレイ時間を含む要素を選択（セレクタはOP.GGの構造に依存）
        // 例: 最近のプレイ時間が表示されている要素を特定
        const lastPlayElement = $('.ProfileSummary .Content .LeagueStats .Row'); // 実際のセレクタを確認
        
        if (lastPlayElement.length === 0) {
            console.log(`最後のプレイ時間が見つかりませんでした: ${summonerName}`);
            return null;
        }
        
        // テキストから日数や時間を抽出
        const playText = lastPlayElement.text().trim();
        // 例: "最後のプレイ: 2日前" など
        const regex = /(\d+)\s*日\s*前/;
        const match = playText.match(regex);
        
        if (match) {
            const daysAgo = parseInt(match[1], 10);
            const lastPlayDate = new Date();
            lastPlayDate.setDate(lastPlayDate.getDate() - daysAgo);
            return lastPlayDate;
        } else {
            console.log(`プレイ時間のフォーマットが不正です: ${playText}`);
            return null;
        }
    } catch (error) {
        console.error(`OP.GGからデータを取得できませんでした: ${error.message}`);
        return null;
    }
}

module.exports = { getLastPlayTime };
