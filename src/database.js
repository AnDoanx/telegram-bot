const fs = require('fs');
const path = require('path');
const config = require('./config');

let mode; // 'mysql' | 'sqlite'
let pool;
let sqliteDb;

const SQL_PRODUCTS_STOCK_SUB = `
  (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) as stock_count
`;

async function queryAll(sql, params = []) {
  if (mode === 'mysql') {
    const [rows] = await pool.query(sql, params);
    return rows;
  }
  return sqliteDb.prepare(sql).all(params);
}

async function queryRun(sql, params = []) {
  if (mode === 'mysql') {
    const [result] = await pool.query(sql, params);
    return {
      insertId: result.insertId != null ? Number(result.insertId) : undefined,
      affectedRows: result.affectedRows
    };
  }
  const info = sqliteDb.prepare(sql).run(params);
  return { insertId: Number(info.lastInsertRowid), affectedRows: info.changes };
}

async function initMysql() {
  const mysql = require('mysql2/promise');
  pool = mysql.createPool({
    host: config.MYSQL_HOST,
    port: config.MYSQL_PORT,
    user: config.MYSQL_USER,
    password: config.MYSQL_PASSWORD,
    database: config.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
  const connection = await pool.getConnection();
  try {
    await connection.ping();
    await connection.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        description TEXT
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT PRIMARY KEY AUTO_INCREMENT,
        category_id INT DEFAULT 0,
        name VARCHAR(255) NOT NULL,
        price INT NOT NULL,
        description TEXT,
        price_tiers TEXT
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock (
        id INT PRIMARY KEY AUTO_INCREMENT,
        product_id INT NOT NULL,
        account_data TEXT NOT NULL,
        is_sold TINYINT DEFAULT 0,
        buyer_id BIGINT,
        INDEX idx_product_sold (product_id, is_sold)
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL,
        product_id INT NOT NULL,
        stock_id INT,
        status VARCHAR(50) DEFAULT 'pending',
        chat_id BIGINT,
        content TEXT,
        quantity INT DEFAULT 1,
        total_price INT,
        delivered_data TEXT,
        created_at BIGINT,
        INDEX idx_user_status (user_id, status),
        INDEX idx_status (status)
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT PRIMARY KEY,
        first_name VARCHAR(255),
        username VARCHAR(255),
        balance BIGINT DEFAULT 0,
        lang VARCHAR(10) DEFAULT 'vi',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS deposits (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL,
        amount INT NOT NULL,
        content VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at BIGINT,
        INDEX idx_deposit_user (user_id),
        INDEX idx_deposit_status (status)
      )
    `);

    try { await connection.query(`ALTER TABLE products ADD COLUMN category_id INT DEFAULT 0`); } catch (_) {}
    try { await connection.query(`ALTER TABLE users ADD COLUMN balance BIGINT DEFAULT 0`); } catch (_) {}
    try { await connection.query(`ALTER TABLE users ADD COLUMN lang VARCHAR(10) DEFAULT 'vi'`); } catch (_) {}
    try { await connection.query(`ALTER TABLE orders ADD COLUMN delivered_data TEXT`); } catch (_) {}
  } finally {
    connection.release();
  }
}

function initSqlite() {
  const Database = require('better-sqlite3');
  const dir = path.dirname(config.SQLITE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  sqliteDb = new Database(config.SQLITE_PATH);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER DEFAULT 0,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      description TEXT,
      price_tiers TEXT
    );
    CREATE TABLE IF NOT EXISTS stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      account_data TEXT NOT NULL,
      is_sold INTEGER DEFAULT 0,
      buyer_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_stock_product_sold ON stock(product_id, is_sold);
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      stock_id INTEGER,
      status TEXT DEFAULT 'pending',
      chat_id INTEGER,
      content TEXT,
      quantity INTEGER DEFAULT 1,
      total_price INTEGER,
      delivered_data TEXT,
      created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      first_name TEXT,
      username TEXT,
      balance INTEGER DEFAULT 0,
      lang TEXT DEFAULT 'vi',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
  `);

  try { sqliteDb.exec(`ALTER TABLE products ADD COLUMN category_id INTEGER DEFAULT 0;`); } catch (_) {}
  try { sqliteDb.exec(`ALTER TABLE users ADD COLUMN balance INTEGER DEFAULT 0;`); } catch (_) {}
  try { sqliteDb.exec(`ALTER TABLE users ADD COLUMN lang TEXT DEFAULT 'vi';`); } catch (_) {}
  try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN delivered_data TEXT;`); } catch (_) {}
}

async function initDB() {
  const onlySqlite = config.DB_MODE === 'sqlite';
  const onlyMysql = config.DB_MODE === 'mysql';

  if (!onlySqlite) {
    try {
      await initMysql();
      mode = 'mysql';
      console.log('📦 Database: MySQL');
      return;
    } catch (err) {
      if (onlyMysql) throw err;
      if (pool) { try { await pool.end(); } catch (_) { } pool = null; }
    }
  }

  initSqlite();
  mode = 'sqlite';
  console.log('📦 Database: SQLite');
}

function parsePriceTiersJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed
      .map((t) => ({ min: parseInt(t.min, 10), price: parseInt(t.price, 10) }))
      .filter((t) => !isNaN(t.min) && t.min >= 1 && !isNaN(t.price) && t.price >= 0)
      .sort((a, b) => a.min - b.min);
  } catch {
    return null;
  }
}

function effectiveUnitPrice(product, quantity) {
  const base = Number(product.price) || 0;
  const qty = Math.max(0, parseInt(quantity, 10) || 0);
  const tiers = product.price_tiers;
  if (!tiers?.length || qty < 1) return base;
  const sorted = [...tiers].sort((a, b) => b.min - a.min);
  for (const t of sorted) {
    if (qty >= t.min) return t.price;
  }
  return base;
}

function calculatePrice(product, quantity) {
  return effectiveUnitPrice(product, quantity) * (parseInt(quantity, 10) || 0);
}

function getUnitPrice(product, quantity) {
  return effectiveUnitPrice(product, quantity);
}

// ========== CATEGORIES ==========
async function getAllCategories() {
  const rows = await queryAll(`
    SELECT c.id, c.name, c.description,
    (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count
    FROM categories c
  `);
  return rows.map(r => ({ id: r.id, name: r.name, description: r.description, product_count: parseInt(r.product_count, 10) || 0 }));
}

async function getCategory(id) {
  const rows = await queryAll('SELECT * FROM categories WHERE id = ?', [id]);
  return rows[0] || null;
}

async function addCategory(name, description = '') {
  const res = await queryRun('INSERT INTO categories (name, description) VALUES (?, ?)', [name, description]);
  return { lastInsertRowid: res.insertId };
}

async function deleteCategory(id) {
  await queryRun('UPDATE products SET category_id = 0 WHERE category_id = ?', [id]);
  await queryRun('DELETE FROM categories WHERE id = ?', [id]);
}

// ========== PRODUCTS ==========
async function getAllProducts() {
  const rows = await queryAll(
    `SELECT p.id, p.category_id, p.name, p.price, p.description, p.price_tiers, ${SQL_PRODUCTS_STOCK_SUB} FROM products p`
  );
  return rows.map((row) => ({
    id: row.id,
    category_id: row.category_id || 0,
    name: row.name,
    price: row.price,
    description: row.description,
    price_tiers: parsePriceTiersJson(row.price_tiers),
    stock_count: parseInt(row.stock_count, 10)
  }));
}

async function getProductsByCategory(categoryId) {
  const rows = await queryAll(
    `SELECT p.id, p.category_id, p.name, p.price, p.description, p.price_tiers, ${SQL_PRODUCTS_STOCK_SUB} 
     FROM products p WHERE p.category_id = ?`,
    [categoryId]
  );
  return rows.map((row) => ({
    id: row.id,
    category_id: row.category_id || 0,
    name: row.name,
    price: row.price,
    description: row.description,
    price_tiers: parsePriceTiersJson(row.price_tiers),
    stock_count: parseInt(row.stock_count, 10)
  }));
}

async function getProduct(id) {
  const rows = await queryAll(
    `SELECT p.id, p.category_id, p.name, p.price, p.description, p.price_tiers, ${SQL_PRODUCTS_STOCK_SUB}
     FROM products p WHERE p.id = ?`,
    [id]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    category_id: row.category_id || 0,
    name: row.name,
    price: row.price,
    description: row.description,
    price_tiers: parsePriceTiersJson(row.price_tiers),
    stock_count: parseInt(row.stock_count, 10)
  };
}

async function addProduct(name, price, description = '', categoryId = 0) {
  const result = await queryRun(
    'INSERT INTO products (name, price, description, category_id) VALUES (?, ?, ?, ?)',
    [name, price, description, categoryId]
  );
  return { lastInsertRowid: result.insertId };
}

async function deleteProduct(id) {
  await queryRun('DELETE FROM stock WHERE product_id = ?', [id]);
  await queryRun('DELETE FROM products WHERE id = ?', [id]);
}

async function updateProductCategory(productId, categoryId) {
  await queryRun('UPDATE products SET category_id = ? WHERE id = ?', [categoryId, productId]);
}

async function addStock(productId, accountData) {
  await queryRun('INSERT INTO stock (product_id, account_data) VALUES (?, ?)', [productId, accountData]);
}

async function deleteStock(stockId) {
  await queryRun('DELETE FROM stock WHERE id = ? AND is_sold = 0', [stockId]);
}

async function clearStock(productId) {
  await queryRun('DELETE FROM stock WHERE product_id = ? AND is_sold = 0', [productId]);
}

async function getAvailableStock(productId) {
  const rows = await queryAll(
    'SELECT id, product_id, account_data FROM stock WHERE product_id = ? AND is_sold = 0 LIMIT 1',
    [productId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return { id: row.id, product_id: row.product_id, account_data: row.account_data };
}

async function markStockSold(stockId, buyerId) {
  await queryRun('UPDATE stock SET is_sold = 1, buyer_id = ? WHERE id = ?', [buyerId, stockId]);
}

async function createOrder(userId, productId, chatId, content, quantity, totalPrice) {
  const createdAt = Date.now();
  const result = await queryRun(
    'INSERT INTO orders (user_id, product_id, chat_id, content, quantity, total_price, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId, productId, chatId, content, quantity, totalPrice, createdAt]
  );
  return { lastInsertRowid: result.insertId, createdAt };
}

async function updateOrder(orderId, stockId, status, deliveredData = null) {
  if (deliveredData !== null) {
    await queryRun('UPDATE orders SET stock_id = ?, status = ?, delivered_data = ? WHERE id = ?', [stockId, status, deliveredData, orderId]);
  } else {
    await queryRun('UPDATE orders SET stock_id = ?, status = ? WHERE id = ?', [stockId, status, orderId]);
  }
}

async function getOrderById(orderId) {
  const rows = await queryAll(
    `SELECT o.*, p.name as product_name 
     FROM orders o
     JOIN products p ON o.product_id = p.id
     WHERE o.id = ?`,
    [orderId]
  );
  return rows[0] || null;
}

async function getPendingOrders() {
  const rows = await queryAll(`
    SELECT id, user_id, product_id, chat_id, content, quantity, total_price, created_at
    FROM orders
    WHERE status = 'pending' AND content IS NOT NULL
  `);
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    productId: row.product_id,
    chatId: row.chat_id,
    content: row.content,
    quantity: row.quantity,
    totalPrice: row.total_price,
    createdAt: row.created_at
  }));
}

async function getOrdersByUser(userId) {
  const rows = await queryAll(
    `SELECT o.id, o.status, p.name as product_name, o.total_price, o.quantity, o.created_at, o.delivered_data
     FROM orders o
     JOIN products p ON o.product_id = p.id
     WHERE o.user_id = ?
     ORDER BY o.id DESC`,
    [userId]
  );
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    product_name: row.product_name,
    total_price: row.total_price || 0,
    quantity: row.quantity || 1,
    created_at: row.created_at,
    delivered_data: row.delivered_data
  }));
}

async function saveUser(id, firstName, username) {
  if (mode === 'mysql') {
    await queryRun(
      'INSERT INTO users (id, first_name, username) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE first_name = ?, username = ?',
      [id, firstName, username, firstName, username]
    );
  } else {
    await queryRun(
      `INSERT INTO users (id, first_name, username) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username`,
      [id, firstName, username]
    );
  }
}

async function getAllUsers() {
  const rows = await queryAll('SELECT id, first_name, username, balance, lang FROM users');
  return rows.map((row) => ({
    id: row.id,
    first_name: row.first_name,
    username: row.username,
    balance: parseInt(row.balance, 10) || 0,
    lang: row.lang || 'vi'
  }));
}

async function updateProduct(id, name, price, description) {
  await queryRun('UPDATE products SET name = ?, price = ?, description = ? WHERE id = ?', [name, price, description, id]);
}

async function updatePriceTiers(id, priceTiers) {
  const tiersJson = priceTiers ? JSON.stringify(priceTiers) : null;
  await queryRun('UPDATE products SET price_tiers = ? WHERE id = ?', [tiersJson, id]);
}

async function getStockByProduct(productId) {
  const rows = await queryAll('SELECT id, account_data, is_sold, buyer_id FROM stock WHERE product_id = ?', [productId]);
  return rows.map((row) => ({
    id: row.id,
    account_data: row.account_data,
    is_sold: row.is_sold,
    buyer_id: row.buyer_id
  }));
}

async function getOrderHistory(userId) {
  const rows = await queryAll(
    `SELECT o.id, o.status, p.name as product_name, o.total_price, o.quantity, o.created_at, o.delivered_data
     FROM orders o
     JOIN products p ON o.product_id = p.id
     WHERE o.user_id = ? AND o.status IN ('completed', 'pending', 'expired', 'cancelled')
     ORDER BY o.id DESC
     LIMIT 20`,
    [userId]
  );
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    product_name: row.product_name,
    total_price: row.total_price,
    quantity: row.quantity,
    created_at: row.created_at,
    delivered_data: row.delivered_data
  }));
}

async function getRevenue() {
  const rows = await queryAll(`
    SELECT COUNT(*) as total_orders, COALESCE(SUM(total_price), 0) as total_revenue
    FROM orders
    WHERE status = 'completed'
  `);
  const row = rows[0] || {};
  return {
    total_orders: parseInt(row.total_orders, 10) || 0,
    total_revenue: parseInt(row.total_revenue, 10) || 0
  };
}

async function getRecentOrders(limit = 20) {
  const rows = await queryAll(
    `SELECT o.id, o.user_id, o.status, p.name, o.total_price, o.quantity, u.first_name, o.created_at
     FROM orders o
     JOIN products p ON o.product_id = p.id
     LEFT JOIN users u ON o.user_id = u.id
     ORDER BY o.id DESC
     LIMIT ?`,
    [limit]
  );
  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    status: row.status,
    product_name: row.name,
    total_price: row.total_price,
    quantity: row.quantity || 1,
    user_name: row.first_name || 'Unknown',
    created_at: row.created_at
  }));
}

async function keepAlive() {
  try {
    if (mode === 'mysql') await pool.query('SELECT 1');
    else if (sqliteDb) sqliteDb.prepare('SELECT 1').get();
  } catch (error) {
    console.error('❌ Database keep-alive failed:', error.message);
  }
}

async function getUserLang(userId) {
  const rows = await queryAll('SELECT lang FROM users WHERE id = ?', [userId]);
  return rows?.[0]?.lang || null;
}

async function setUserLang(userId, lang) {
  return await queryRun('UPDATE users SET lang = ? WHERE id = ?', [lang, userId]);
}

async function getUserBalance(userId) {
  const rows = await queryAll('SELECT balance FROM users WHERE id = ?', [userId]);
  if (!rows || rows.length === 0) return 0;
  return parseInt(rows[0].balance, 10) || 0;
}

async function setUserBalance(userId, amount) {
  const val = Math.max(0, parseInt(amount, 10) || 0);
  return await queryRun('UPDATE users SET balance = ? WHERE id = ?', [val, userId]);
}

async function addMoney(userId, amount) {
  const addVal = parseInt(amount, 10) || 0;
  return await queryRun('UPDATE users SET balance = balance + ? WHERE id = ?', [addVal, userId]);
}

async function deductBalance(userId, amount) {
  const val = parseInt(amount, 10) || 0;
  return await queryRun('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?', [val, userId, val]);
}

async function createDeposit(userId, amount, content) {
  const createdAt = Date.now();
  const result = await queryRun(
    'INSERT INTO deposits (user_id, amount, content, status, created_at) VALUES (?, ?, ?, ?, ?)',
    [userId, amount, content, 'pending', createdAt]
  );
  return { id: result.insertId, createdAt };
}

async function getPendingDeposits() {
  const rows = await queryAll("SELECT id, user_id, amount, content, created_at FROM deposits WHERE status = 'pending'");
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    amount: r.amount,
    content: r.content,
    createdAt: r.created_at
  }));
}

async function updateDepositStatus(depositId, status) {
  await queryRun('UPDATE deposits SET status = ? WHERE id = ?', [status, depositId]);
}

async function getUserDepositStats(userId) {
  const rowsTotal = await queryAll(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE user_id = ? AND status = 'completed'",
    [userId]
  );
  const totalDeposit = parseInt(rowsTotal[0]?.total, 10) || 0;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const rowsMonth = await queryAll(
    "SELECT COALESCE(SUM(amount), 0) AS total_month FROM deposits WHERE user_id = ? AND status = 'completed' AND created_at >= ?",
    [userId, startOfMonth]
  );
  const monthDeposit = parseInt(rowsMonth[0]?.total_month, 10) || 0;

  return { totalDeposit, monthDeposit };
}

// BẢNG XẾP HẠNG TOP NẠP TIỀN
async function getTopDeposits(limit = 10) {
  const rows = await queryAll(`
    SELECT u.id, u.first_name, u.username, COALESCE(SUM(d.amount), 0) AS total_deposited
    FROM deposits d
    JOIN users u ON d.user_id = u.id
    WHERE d.status = 'completed'
    GROUP BY u.id, u.first_name, u.username
    ORDER BY total_deposited DESC
    LIMIT ?
  `, [limit]);

  return rows.map((r) => ({
    id: r.id,
    name: r.first_name || 'Khách',
    username: r.username || '',
    total: parseInt(r.total_deposited, 10) || 0
  }));
}

module.exports = {
  initDB,
  getAllCategories,
  getCategory,
  addCategory,
  deleteCategory,
  getAllProducts,
  getProductsByCategory,
  getProduct,
  addProduct,
  deleteProduct,
  updateProductCategory,
  addStock,
  deleteStock,
  clearStock,
  getAvailableStock,
  markStockSold,
  createOrder,
  updateOrder,
  getOrderById,
  getOrdersByUser,
  getPendingOrders,
  saveUser,
  getAllUsers,
  updateProduct,
  updatePriceTiers,
  getStockByProduct,
  getOrderHistory,
  getRevenue,
  getRecentOrders,
  keepAlive,
  calculatePrice,
  getUnitPrice,
  getUserBalance,
  setUserBalance,
  addMoney,
  deductBalance,
  createDeposit,
  getPendingDeposits,
  updateDepositStatus,
  getUserDepositStats,
  getUserLang,
  setUserLang,
  getTopDeposits
};