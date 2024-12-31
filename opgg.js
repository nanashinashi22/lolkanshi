// opgg.js

const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Summoner名から最後にLoLをプレイした日時を取得
 * @param {string} summonerName - Summoner名
 * @returns {Promise<Date|null>} - 最後のプレイ日時またはnull
 */
async function getLastPlayTime(summonerName) {
    try {
        const url = `https://www.op.gg/summoner/userName=${encodeURIComponent(summonerName)}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });

        const $ = cheerio.load(response.data);

        // LoLプレイ情報が存在するか確認
        const lastPlayedText = $('.GameListItem.Item- ').first().find('.GameType').text();

        if (!lastPlayedText) {
            // プレイ履歴がない場合
            return null;
        }

        // プレイ日時を解析
        const lastPlayedElement = $('.GameListItem.Item- ').first().find('.Time');
        const timeString = lastPlayedElement.text().trim();

        // 時間表現をDateオブジェクトに変換
        const lastPlayTime = parseTimeString(timeString);

        return lastPlayTime;
    } catch (error) {
        console.error(`Error fetching OP.GG data for ${summonerName}:`, error.message);
        return null;
    }
}

/**
 * 時間表現の文字列をDateオブジェクトに変換
 * @param {string} timeStr - "X時間前"、"X日前" などの文字列
 * @returns {Date|null} - 変換後のDateオブジェクトまたはnull
 */
function parseTimeString(timeStr) {
    const now = new Date();
    const regex = /(\d+)\s*(時間|日)/;
    const match = timeStr.match(regex);

    if (!match) return null;

    const value = parseInt(match[1], 10);
    const unit = match[2];

    if (unit === '時間') {
        return new Date(now.getTime() - value * 60 * 60 * 1000);
    } else if (unit === '日') {
        return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
    }

    return null;
}

module.exports = { getLastPlayTime };
