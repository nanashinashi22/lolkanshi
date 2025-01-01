// registerCommands.js
// スラッシュコマンド (/login, /logout, /rule, /register, /check) をGuildに登録するスクリプト

// ※ Koyebの環境変数を使う場合、dotenvは不要。
//    ローカルでテストする場合のみ、dotenvを使ってもOK。
require('dotenv').config();

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.CLIENT_ID;  // BotのアプリID
const guildId = process.env.GUILD_ID;    // テスト用サーバーID

//
// /login
//
const cmdLogin = new SlashCommandBuilder()
  .setName('login')
  .setDescription('監視機能をオン');

//
// /logout
//
const cmdLogout = new SlashCommandBuilder()
  .setName('logout')
  .setDescription('監視機能をオフ');

//
// /rule
//
const cmdRule = new SlashCommandBuilder()
  .setName('rule')
  .setDescription('ボットの説明');

//
// /register (user, riotid, tag)
//
const cmdRegister = new SlashCommandBuilder()
  .setName('register')
  .setDescription('RiotIDをディスコードに紐づける')
  .addUserOption(opt =>
    opt
      .setName('user')
      .setDescription('ディスコード内ユーザー名')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt
      .setName('riotid')
      .setDescription('RiotID (Name部分)')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt
      .setName('tag')
      .setDescription('#タグ部分')
      .setRequired(true)
  );

//
// /check (user)
//
const cmdCheck = new SlashCommandBuilder()
  .setName('check')
  .setDescription('最後にLOLをプレイしてからどれくらい経ったか')
  .addUserOption(opt =>
    opt
      .setName('user')
      .setDescription('ディスコード内ユーザー名')
      .setRequired(true)
  );

const commands = [
  cmdLogin,
  cmdLogout,
  cmdRule,
  cmdRegister,
  cmdCheck,
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('Registering slash commands...');
    // Guild Commands として登録
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands },
    );
    console.log('Successfully registered slash commands to the guild.');
  } catch (err) {
    console.error(err);
  }
})();
