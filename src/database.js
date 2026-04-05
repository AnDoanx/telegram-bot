const mysql = require('mysql2/promise');
const config = require('./config');

let pool;

async function initDB() {
  // Tạo connection pool
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

  // Tạo các bảng nếu chưa tồn tại
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        price INT NOT NULL,
        description TEXT
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } finally {
    connection.release();
  }
}

async function getAllProducts() {
  const [rows] = await pool.query(`
    SELECT p.id, p.name, p.price, p.description, 
           COUNT(CASE WHEN s.is_sold = 0 THEN 1 END) as stock_count
    FROM products p
    LEFT JOIN stock s ON p.id = s.product_id
    GROUP BY p.id
  `);
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    price: row.price,
    description: row.description,
    stock_count: parseInt(row.stock_count)
  }));
}

async function getProduct(id) {
  const [rows] = await pool.query(`
    SELECT p.id, p.name, p.price, p.description,
           COUNT(CASE WHEN s.is_sold = 0 THEN 1 END) as stock_count
    FROM products p
    LEFT JOIN stock s ON p.id = s.product_id
    WHERE p.id = ?
    GROUP BY p.id
  `, [id]);
  
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    description: row.description,
    stock_count: parseInt(row.stock_count)
  };
}

async function addProduct(name, price, description = '') {
  const [result] = await pool.query(
    'INSERT INTO products (name, price, description) VALUES (?, ?, ?)',
    [name, price, description]
  );
  return { lastInsertRowid: result.insertId };
}

async function deleteProduct(id) {
  await pool.query('DELETE FROM stock WHERE product_id = ?', [id]);
  await pool.query('DELETE FROM products WHERE id = ?', [id]);
}

async function addStock(productId, accountData) {
  await pool.query(
    'INSERT INTO stock (product_id, account_data) VALUES (?, ?)',
    [productId, accountData]
  );
}

async function deleteStock(stockId) {
  await pool.query('DELETE FROM stock WHERE id = ? AND is_sold = 0', [stockId]);
}

async function clearStock(productId) {
  await pool.query('DELETE FROM stock WHERE product_id = ? AND is_sold = 0', [productId]);
}

async function getAvailableStock(productId) {
  const [rows] = await pool.query(
    'SELECT id, product_id, account_data FROM stock WHERE product_id = ? AND is_sold = 0 LIMIT 1',
    [productId]
  );
  
  if (!rows.length) return null;
  return {
    id: rows[0].id,
    product_id: rows[0].product_id,
    account_data: rows[0].account_data
  };
}

async function markStockSold(stockId, buyerId) {
  await pool.query(
    'UPDATE stock SET is_sold = 1, buyer_id = ? WHERE id = ?',
    [buyerId, stockId]
  );
}

async function createOrder(userId, productId, chatId, content, quantity, totalPrice) {
  const createdAt = Date.now();
  const [result] = await pool.query(
    'INSERT INTO orders (user_id, product_id, chat_id, content, quantity, total_price, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId, productId, chatId, content, quantity, totalPrice, createdAt]
  );
  return { lastInsertRowid: result.insertId, createdAt };
}

async function updateOrder(orderId, stockId, status) {
  await pool.query(
    'UPDATE orders SET stock_id = ?, status = ? WHERE id = ?',
    [stockId, status, orderId]
  );
}

async function getPendingOrders() {
  const [rows] = await pool.query(`
    SELECT id, user_id, product_id, chat_id, content, quantity, total_price, created_at 
    FROM orders 
    WHERE status = 'pending' AND content IS NOT NULL
  `);
  
  return rows.map(row => ({
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
  const [rows] = await pool.query(`
    SELECT o.id, o.status, p.name as product_name, o.total_price
    FROM orders o
    JOIN products p ON o.product_id = p.id
    WHERE o.user_id = ?
    ORDER BY o.id DESC
  `, [userId]);
  
  return rows.map(row => ({
    id: row.id,
    status: row.status,
    product_name: row.product_name,
    price: row.total_price || 0
  }));
}

async function saveUser(id, firstName, username) {
  await pool.query(
    'INSERT INTO users (id, first_name, username) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE first_name = ?, username = ?',
    [id, firstName, username, firstName, username]
  );
}

async function getAllUsers() {
  const [rows] = await pool.query('SELECT id, first_name, username FROM users');
  return rows.map(row => ({
    id: row.id,
    first_name: row.first_name,
    username: row.username
  }));
}

async function updateProduct(id, name, price, description) {
  await pool.query(
    'UPDATE products SET name = ?, price = ?, description = ? WHERE id = ?',
    [name, price, description, id]
  );
}

async function getStockByProduct(productId) {
  const [rows] = await pool.query(
    'SELECT id, account_data, is_sold, buyer_id FROM stock WHERE product_id = ?',
    [productId]
  );
  
  return rows.map(row => ({
    id: row.id,
    account_data: row.account_data,
    is_sold: row.is_sold,
    buyer_id: row.buyer_id
  }));
}

async function getOrderHistory(userId) {
  const [rows] = await pool.query(`
    SELECT o.id, o.status, p.name, o.total_price, o.quantity, o.created_at
    FROM orders o
    JOIN products p ON o.product_id = p.id
    WHERE o.user_id = ? AND o.status IN ('completed', 'pending', 'expired', 'cancelled')
    ORDER BY o.id DESC
    LIMIT 20
  `, [userId]);
  
  return rows.map(row => ({
    id: row.id,
    status: row.status,
    product_name: row.name,
    total_price: row.total_price,
    quantity: row.quantity,
    created_at: row.created_at
  }));
}

async function getRevenue() {
  const [rows] = await pool.query(`
    SELECT 
      COUNT(*) as total_orders,
      COALESCE(SUM(total_price), 0) as total_revenue
    FROM orders
    WHERE status = 'completed'
  `);
  
  return {
    total_orders: parseInt(rows[0].total_orders) || 0,
    total_revenue: parseInt(rows[0].total_revenue) || 0
  };
}

async function getRecentOrders(limit = 20) {
  const [rows] = await pool.query(`
    SELECT o.id, o.user_id, o.status, p.name, o.total_price, o.quantity, u.first_name, o.created_at
    FROM orders o
    JOIN products p ON o.product_id = p.id
    LEFT JOIN users u ON o.user_id = u.id
    ORDER BY o.id DESC
    LIMIT ?
  `, [limit]);
  
  return rows.map(row => ({
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

// Hàm keep-alive để giữ database luôn hoạt động (tránh bị sleep)
async function keepAlive() {
  try {
    await pool.query('SELECT 1');
    console.log('🔄 Database keep-alive ping successful');
  } catch (error) {
    console.error('❌ Database keep-alive ping failed:', error.message);
  }
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
  getStockByProduct,
  getOrderHistory,
  getRevenue,
  getRecentOrders,
  keepAlive
};
