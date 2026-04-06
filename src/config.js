require('dotenv').config();

const path = require('path');

const DB_MODE = (process.env.DB_MODE || 'auto').toLowerCase();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  ADMIN_IDS: (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim())),
  SHOP_NAME: process.env.SHOP_NAME || 'Shop Bot',
  ADMIN_USER_NAME: process.env.ADMIN_USER_NAME,
  SEPAY_API_KEY: process.env.SEPAY_API_KEY,
  BANK_ACCOUNT: process.env.BANK_ACCOUNT,
  BANK_NAME: process.env.BANK_NAME,
  BANK_OWNER: process.env.BANK_OWNER,
  BANK_BIN: process.env.BANK_BIN,
  DB_MODE,
  SQLITE_PATH: process.env.SQLITE_PATH
    ? path.resolve(process.env.SQLITE_PATH)
    : path.join(__dirname, '../data/shop.db'),
  MYSQL_HOST: process.env.MYSQL_HOST || 'localhost',
  MYSQL_PORT: parseInt(process.env.MYSQL_PORT || '3306', 10),
  MYSQL_USER: process.env.MYSQL_USER || 'root',
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || '',
  MYSQL_DATABASE: process.env.MYSQL_DATABASE || 'telegram_shop'
};
