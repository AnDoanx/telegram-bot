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
      CREATE TABLE IF NOT EXISTS products (
        id INT PRIMARY KEY AUTO_INCREMENT,
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
        INDEX idx_dep_status (status)
      )
    `);

    try {
      await connection.query(`ALTER TABLE users ADD COLUMN balance BIGINT DEFAULT 0`);
    } catch (_) {}
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
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      first_name TEXT,
      username TEXT,
      balance INTEGER DEFAULT 0,
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
    CREATE INDEX IF NOT EXISTS idx_dep_status ON deposits(status);
  `);

  try {
    sqliteDb.exec(`ALTER TABLE users ADD COLUMN balance INTEGER DEFAULT 0;`);
  } catch (_) {}
}

async function initDB() {
  const onlySqlite = config.DB_MODE === 'sqlite';
  const onlyMysql = config.DB_MODE === 'mysql';

  if (!onlySqlite) {
    try {
      await initMysql();
      mode = 'mysql';
      console.log('📦 Database: MySQL (' + config.MYSQL_HOST + ':' + config.MYSQL_PORT + '/' + config.MYSQL_DATABASE + ')');
      return;
    } catch (err) {
      if (onlyMysql) {
        console.error('❌ MySQL bắt buộc (DB_MODE=mysql) nhưng không kết nối được:', err.message);
        throw err;
      }
      if (pool) {
        try { await pool.end(); } catch (_) { }
        pool = null;
      }
    }
  }

  initSqlite();
  mode = 'sqlite';
  console.log('📦 Database: SQLite (file ' + config.SQLITE_PATH + ')');
}

function parsePriceTiersJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const normalized = parsed
      .map((t) => ({
        min: parseInt(t.min, 10),
        price: parseInt(t.price, 10)
      }))
      .filter((t) => !isNaN(t.min) && t.min >= 1 && !isNaN(t.price) && t.price >= 0);
    if (!normalized.length) return null;
    normalized.sort((a, b) => a.min - b.min);
    const byMin = new Map();
    normalized.forEach((t) => byMin.set(t.min, t));
    return Array.from(byMin.values()).sort((a, b) => a.min - b.min);
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

async function getAllProducts() {
  const rows = await queryAll(
    `SELECT p.id, p.name, p.price, p.description, p.price_tiers, ${SQL_PRODUCTS_STOCK_SUB} FROM products p`
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: row.price,
    description: row.description,
    price_tiers: parsePriceTiersJson(row.price_tiers),
    stock_count: parseInt(row.stock_count, 10)
  }));
}

async function getProduct(id) {
  const rows = await queryAll(
    `SELECT p.id, p.name, p.price, p.description, p.price_tiers, ${SQL_PRODUCTS_STOCK_SUB}
     FROM products p WHERE p.id = ?`,
    [id]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    description: row.description,
    price_tiers: parsePriceTiersJson(row.price_tiers),
    stock_count: parseInt(row.stock_count, 10)
  };
}

async function addProduct(name, price, description = '') {
  const result = await queryRun(
    'INSERT INTO products (name, price, description) VALUES (?, ?, ?)',
    [name, price, description]
  );
  return { lastInsertRowid: result.insertId };
}

async function deleteProduct(id) {
  await queryRun('DELETE FROM stock WHERE product_id = ?', [id]);
  await queryRun('DELETE FROM products WHERE id = ?', [id]);
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

async function updateOrder(orderId, stockId, status) {
  await queryRun('UPDATE orders SET stock_id = ?, status = ? WHERE id = ?', [stockId, status, orderId]);
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
    `SELECT o.id, o.status, p.name as product_name, o.total_price
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
    total_price: row.total_price || 0
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
  const rows = await queryAll('SELECT id, first_name, username, balance FROM users');
  return rows.map((row) => ({
    id: row.id,
    first_name: row.first_name,
    username: row.username,
    balance: parseInt(row.balance, 10) || 0
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
    `SELECT o.id, o.status, p.name, o.total_price, o.quantity, o.created_at
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
    product_name: row.name,
    total_price: row.total_price,
    quantity: row.quantity,
    created_at: row.created_at
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
    if (mode === 'mysql') {
      await pool.query('SELECT 1');
    } else if (sqliteDb) {
      sqliteDb.prepare('SELECT 1').get();
    }
  } catch (error) {
    console.error('❌ Database keep-alive failed:', error.message);
  }
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
  const deductVal = Math.max(0, parseInt(amount, 10) || 0);
  return await queryRun('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?', [deductVal, userId, deductVal]);
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
  return rows.map(r => ({
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

// Lấy danh sách Top nạp tiền nhiều nhất
async function getTopDepositors(limit = 10) {
  const sql = `
    SELECT d.user_id, COALESCE(u.first_name, 'Khách giấu tên') as first_name, SUM(d.amount) as total_deposited
    FROM deposits d
    LEFT JOIN users u ON d.user_id = u.id
    WHERE d.status = 'completed'
    GROUP BY d.user_id, u.first_name
    ORDER BY total_deposited DESC
    LIMIT ?
  `;
  const rows = await queryAll(sql, [limit]);
  return rows.map(r => ({
    userId: r.user_id,
    firstName: r.first_name,
    totalDeposited: parseInt(r.total_deposited, 10) || 0
  }));
}

module.exports = {
  initDB,
  getAllProducts,
  getProduct,
  addProduct,
  deleteProduct,
  addStock,
  deleteStock,
  clearStock,
  getAvailableStock,
  markStockSold,
  createOrder,
  updateOrder,
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
  getTopDepositors
};
