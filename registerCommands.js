// registerCommands.js

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

/**
 * 1) /login
 */
const cmdLogin = new SlashCommandBuilder()
  .setName('login')
  .setDescription('監視機能をオン');

/**
 * 2) /logout
 */
const cmdLogout = new SlashCommandBuilder()
  .setName('logout')
  .setDescription('監視機能をオフ');

/**
 * 3) /rule
 */
const cmdRule = new SlashCommandBuilder()
  .setName('rule')
  .setDescription('ボットの説明');

/**
 * 4) /register
 *   - user: ディスコード内ユーザー名 (Userオプション, 任意or必須かは要相談)
 *   - riotid: RiotID (String)
 *   - tag: #タグ (String)
 */
const cmdRegister = new SlashCommandBuilder()
  .setName('register')
  .setDescription('RiotIDをディスコードに紐づける')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('ディスコード内ユーザー名')
      .setRequired(true) // 必須
  )
  .addStringOption(option =>
    option
      .setName('riotid')
      .setDescription('RiotID (Name部分)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('tag')
      .setDescription('#タグ部分')
      .setRequired(true)
  );

/**
 * 5) /check
 *   - user: ディスコード内ユーザー名 (Userオプション)
 */
const cmdCheck = new SlashCommandBuilder()
  .setName('check')
  .setDescription('最後にLOLをプレイしてからどれくらい経ったか')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('ディスコード内ユーザー名')
      .setRequired(true)
  );

/**
 * まとめて登録するコマンドを配列に
 */
const commands = [
  cmdLogin,
  cmdLogout,
  cmdRule,
  cmdRegister,
  cmdCheck,
].map(cmd => cmd.toJSON());

// Discord APIに登録する
const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('Started refreshing application (/) commands...');

    // GuildCommands として一括登録
    // → テスト用サーバーなどで確認
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();
