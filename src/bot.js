const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const db = require('./database');
const sepay = require('./sepay');

const formatPrice = (price) => (price || 0).toLocaleString('vi-VN') + ' VND';
const isAdmin = (userId) => config.ADMIN_IDS.map(id => id.toString()).includes(userId.toString());
const getFullName = (user) => (user.first_name + (user.last_name ? ' ' + user.last_name : '')).trim();
const ORDER_TIMEOUT_MS = 20 * 60 * 1000;

const INLINE_BTN_PAD_SPACES = 20;
const TG_INLINE_BTN_TEXT_MAX = 64;
const ZWJ = '\u200D';
function wideInlineLabel(visible) {
  let spaces = INLINE_BTN_PAD_SPACES;
  while (visible.length + spaces + 1 > TG_INLINE_BTN_TEXT_MAX && spaces > 0) spaces--;
  let v = visible;
  if (v.length + spaces + 1 > TG_INLINE_BTN_TEXT_MAX) {
    v = v.slice(0, TG_INLINE_BTN_TEXT_MAX - spaces - 1);
  }
  return v + ' '.repeat(spaces) + ZWJ;
}

const MESSAGES = {
  vi: {
    channel: '📢 Kênh Thông Báo:',
    admin_support: '👑 Admin Hỗ Trợ:',
    acc_info: '💳 THÔNG TIN TÀI KHOẢN',
    total_deposit: '🏯 Tổng nạp:',
    month_deposit: '💰 Nạp tháng:',
    balance: '🏦 Số dư ví:',
    choose_category: '📁 <b>DANH MỤC THƯ MỤC SẢN PHẨM:</b>\n<i>(Vui lòng chọn thư mục để xem các mặt hàng)</i>',
    btn_deposit: '💳 Nạp tiền vào ví',
    btn_profile: '👤 Hồ sơ cá nhân',
    btn_history: '📜 Lịch sử mua hàng',
    btn_support: '💬 Liên hệ Admin',
    btn_change_lang: '🌐 Đổi ngôn ngữ',
    btn_back_cat: '◀️ Quay lại danh mục',
    btn_back_home: '◀️ Quay lại trang chủ',
    stock_in: 'Còn',
    stock_out: 'Hết',
    buy_wallet: '⚡ Mua bằng SỐ DƯ VÍ',
    buy_bank: '🏦 Quét mã QR NGÂN HÀNG',
    insufficient_balance: 'Số dư ví không đủ! Vui lòng nạp thêm tiền.',
    out_of_stock: 'Sản phẩm đã hết hàng trong kho!',
    order_confirm: '🧾 XÁC NHẬN ĐƠN HÀNG'
  },
  en: {
    channel: '📢 Official Channel:',
    admin_support: '👑 Admin Support:',
    acc_info: '💳 ACCOUNT OVERVIEW',
    total_deposit: '🏯 Total Deposit:',
    month_deposit: '💰 Month Deposit:',
    balance: '🏦 Wallet Balance:',
    choose_category: '📁 <b>PRODUCT CATEGORIES:</b>\n<i>(Please select a category below to view items)</i>',
    btn_deposit: '💳 Deposit Funds',
    btn_profile: '👤 My Profile',
    btn_history: '📜 Purchase History',
    btn_support: '💬 Contact Admin',
    btn_change_lang: '🌐 Change Language',
    btn_back_cat: '◀️ Back to Categories',
    btn_back_home: '◀️ Back to Home',
    stock_in: 'In Stock',
    stock_out: 'Sold Out',
    buy_wallet: '⚡ Pay with WALLET BALANCE',
    buy_bank: '🏦 Pay with BANK TRANSFER (QR)',
    insufficient_balance: 'Insufficient balance! Please top up your wallet.',
    out_of_stock: 'This product is currently out of stock!',
    order_confirm: '🧾 ORDER CONFIRMATION'
  }
};

function getDisplayPrice(product) {
  if (product.price_tiers?.length) {
    const minPrice = Math.min(...product.price_tiers.map((t) => t.price));
    if (minPrice < product.price) return 'từ ' + formatPrice(minPrice);
  }
  return formatPrice(product.price);
}

function formatTierBullets(product) {
  if (!product.price_tiers?.length) return '';
  const sorted = [...product.price_tiers].sort((a, b) => a.min - b.min);
  return sorted
    .map((tier, idx) => {
      const next = sorted[idx + 1];
      const base = Number(product.price) || 0;
      const pct = base > 0 ? Math.round((1 - tier.price / base) * 100) : 0;
      const sfx = pct > 0 ? '  (giảm ' + pct + '%)' : '';
      if (next) {
        return '   • ' + tier.min + ' – ' + (next.min - 1) + ' sản phẩm  →  ' + formatPrice(tier.price) + '/SP' + sfx;
      }
      return '   • Từ ' + tier.min + ' sản phẩm  →  ' + formatPrice(tier.price) + '/SP' + sfx;
    })
    .join('\n') + '\n\n';
}

function formatTierBlockUser(product) {
  if (!product.price_tiers?.length) return '';
  const sorted = [...product.price_tiers].sort((a, b) => a.min - b.min);
  const base = Number(product.price) || 0;
  return sorted
    .map((tier, idx) => {
      const next = sorted[idx + 1];
      const range = next
        ? 'Mua từ ' + tier.min + ' đến ' + (next.min - 1) + ' sản phẩm'
        : 'Mua từ ' + tier.min + ' sản phẩm trở lên';
      const pct = base > 0 ? Math.round((1 - tier.price / base) * 100) : 0;
      const save = pct > 0 ? '\n   └ 💚 Giảm ' + pct + '% so với giá gốc (' + formatPrice(base) + ')' : '';
      return '▸ ' + range + '\n   💵 Đơn giá: ' + formatPrice(tier.price) + ' / sp' + save;
    })
    .join('\n\n');
}

function productPriceBlockUser(product) {
  if (!product.price_tiers?.length) {
    return '💰 Đơn giá: ' + formatPrice(product.price) + ' / sản phẩm\n';
  }
  return (
    '💎 Ưu đãi theo số lượng:\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    formatTierBlockUser(product) +
    '\n━━━━━━━━━━━━━━━━━━━━━\n'
  );
}

function productPriceBlockAdmin(product) {
  let s = '💰 Giá gốc: ' + formatPrice(product.price) + '\n';
  if (product.price_tiers?.length) s += '📊 Bảng giá:\n' + formatTierBullets(product);
  return s;
}

function adminProductKeyboard(productId) {
  return [
    [{ text: wideInlineLabel('✏️ Sửa tên'), callback_data: 'adm_edit_name_' + productId }, { text: wideInlineLabel('💵 Sửa giá gốc'), callback_data: 'adm_edit_price_' + productId }],
    [{ text: wideInlineLabel('📁 Đổi thư mục'), callback_data: 'adm_change_cat_' + productId }, { text: wideInlineLabel('📊 Sửa bảng giá sỉ'), callback_data: 'adm_edit_tiers_' + productId }],
    [{ text: wideInlineLabel('📝 Sửa mô tả'), callback_data: 'adm_edit_desc_' + productId }],
    [{ text: wideInlineLabel('➕ Thêm stock'), callback_data: 'adm_addstock_' + productId }, { text: wideInlineLabel('👁️ Xem stock'), callback_data: 'adm_viewstock_' + productId }],
    [{ text: wideInlineLabel('🗑️ Xóa sản phẩm'), callback_data: 'adm_delete_' + productId }],
    [{ text: wideInlineLabel('◀️ Về danh sách SP'), callback_data: 'adm_back_list' }]
  ];
}

function parseAccount(accountData) {
  let user = accountData;
  let pass = '';
  if (accountData.includes('|')) {
    const parts = accountData.split('|');
    user = parts[0].trim();
    pass = parts.slice(1).join('|').trim();
  } else if (accountData.includes(':')) {
    const parts = accountData.split(':');
    user = parts[0].trim();
    pass = parts.slice(1).join(':').trim();
  }
  return { user, pass, raw: accountData };
}

const pendingOrders = new Map();
const pendingDeposits = new Map();
const processingOrders = new Set();
const waitingStock = new Map();
const waitingEdit = new Map();

function generateCode(prefix = '') {
  return (prefix || '') + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getQRUrl(amount, content) {
  return `https://img.vietqr.io/image/${config.BANK_BIN}-${config.BANK_ACCOUNT}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(content)}`;
}

async function broadcastToAllUsers(bot, textContent) {
  const users = await db.getAllUsers();
  for (const u of users) {
    bot.sendMessage(u.id, textContent, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: wideInlineLabel('🛒 Vào cửa hàng ngay'), callback_data: 'back_main' }]]
      }
    }).catch(() => {});
  }
}

async function deliverOrder(bot, orderId, chatId, userId, userFrom, product, accounts) {
  const accListRaw = accounts.join('\n');
  await db.updateOrder(orderId, null, 'completed', accListRaw);

  const txtContent = 
`==================================================
              HÓA ĐƠN MUA HÀNG
==================================================
 Mã đơn hàng: #${orderId}
 Sản phẩm:    ${product.name}
 Số lượng:    ${accounts.length}
 Thời gian:   ${new Date().toLocaleString('vi-VN')}
==================================================

 DANH SÁCH TÀI KHOẢN:
${accounts.map((acc, i) => `[${i + 1}] ${acc}`).join('\n')}

==================================================
 Cảm ơn bạn đã tin tưởng ủng hộ shop!
 Lưu ý: Vui lòng đổi mật khẩu để bảo vệ tài khoản ngay!
==================================================`;

  const txtBuffer = Buffer.from(txtContent, 'utf-8');
  const filename = `Order_${orderId}.txt`;

  await bot.sendDocument(chatId, txtBuffer, {
    caption: `🎉 <b>GIAO HÀNG THÀNH CÔNG!</b>\n\n📦 <b>Mã đơn:</b> <code>#${orderId}</code>\n🎁 <b>Sản phẩm:</b> <b>${product.name}</b> (x${accounts.length})\n\n📁 <i>File .txt tài khoản đã được đính kèm bên trên!</i>`,
    parse_mode: 'HTML'
  }, { filename, contentType: 'text/plain' });

  let adminAccDetails = '';
  accounts.forEach((acc, i) => {
    const p = parseAccount(acc);
    adminAccDetails += `\n ├ 🔹 <b>Acc ${i + 1}:</b>\n │   👤 TK: <code>${p.user}</code>\n │   🔑 MK: <code>${p.pass || '(Không có)'}</code>`;
  });

  const adminMsg = 
`🔔 <b>ĐƠN HÀNG MỚI HOÀN TẤT</b>
──────────────────────────
 ├ 📦 <b>Mã đơn:</b> <code>#${orderId}</code>
 ├ 👤 <b>Khách hàng:</b> ${getFullName(userFrom)} (<code>${userId}</code>)
 ├ 🎁 <b>Sản phẩm:</b> ${product.name}
 ├ 🔢 <b>Số lượng:</b> ${accounts.length}
 ╰ 💰 <b>Doanh thu:</b> <code>${formatPrice(product.price * accounts.length)}</code>
──────────────────────────
📂 <b>PHÂN LOẠI CHI TIẾT TÀI KHOẢN:</b>${adminAccDetails}`;

  config.ADMIN_IDS.forEach(id => {
    bot.sendMessage(id, adminMsg, { parse_mode: 'HTML' }).catch(() => {});
    bot.sendDocument(id, txtBuffer, { caption: `📁 File đơn backup #${orderId}` }, { filename, contentType: 'text/plain' }).catch(() => {});
  });
}

function getLanguageKeyboard() {
  return [
    [
      { text: wideInlineLabel('🇻🇳 Tiếng Việt'), callback_data: 'set_lang_vi' },
      { text: wideInlineLabel('🇬🇧 English'), callback_data: 'set_lang_en' }
    ]
  ];
}

async function buildMainMenu(userId) {
  let lang = await db.getUserLang(userId) || 'vi';
  const t = MESSAGES[lang] || MESSAGES.vi;

  const balance = await db.getUserBalance(userId);
  const { totalDeposit, monthDeposit } = await db.getUserDepositStats(userId);

  const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━╮
  🌟 <b>${config.SHOP_NAME || 'CLONE FF GIÁ RẺ'}</b> 🌟
╰━━━━━━━━━━━━━━━━━━━━━━━━╯
${t.channel} @cloneffgiare
${t.admin_support} @accffgiatot
──────────────────────────
${t.acc_info}
 ├ ${t.total_deposit} <code>${(totalDeposit || 0).toLocaleString('vi-VN')}đ</code>
 ├ ${t.month_deposit} <code>${(monthDeposit || 0).toLocaleString('vi-VN')}đ</code>
 ╰ ${t.balance}  <code>${(balance || 0).toLocaleString('vi-VN')}đ</code>
──────────────────────────
${t.choose_category}`;

  const categories = await db.getAllCategories();
  const keyboard = [];

  if (categories.length > 0) {
    categories.forEach(c => {
      keyboard.push([{
        text: wideInlineLabel(`📁 ${c.name} (${c.product_count} SP)`),
        callback_data: 'view_category_' + c.id
      }]);
    });
  }

  const uncategorizedProducts = await db.getProductsByCategory(0);
  if (uncategorizedProducts.length > 0) {
    uncategorizedProducts.forEach(p => {
      const stockBadge = p.stock_count > 0 ? `🟢 ${t.stock_in} ${p.stock_count}` : `🔴 ${t.stock_out}`;
      keyboard.push([{ text: wideInlineLabel(`💎 ${p.name} ▫️ ${getDisplayPrice(p)} [${stockBadge}]`), callback_data: 'product_' + p.id }]);
    });
  }

  keyboard.push([
    { text: wideInlineLabel(t.btn_deposit), callback_data: 'deposit_menu' },
    { text: wideInlineLabel(t.btn_profile), callback_data: 'main_profile' }
  ]);
  keyboard.push([
    { text: wideInlineLabel(t.btn_history), callback_data: 'main_history' },
    { text: wideInlineLabel(t.btn_change_lang), callback_data: 'change_language' }
  ]);

  const adminUser = (config.ADMIN_USER_NAME || '').trim().replace('@', '');
  if (adminUser) {
    keyboard.push([{ text: wideInlineLabel(t.btn_support), url: 'https://t.me/' + adminUser }]);
  }

  return { text, keyboard };
}

async function startBot() {
  await db.initDB();

  setInterval(async () => {
    await db.keepAlive();
  }, 5 * 60 * 1000);

  const savedOrders = await db.getPendingOrders();
  savedOrders.forEach(o => {
    pendingOrders.set(o.id, {
      chatId: o.chatId,
      userId: o.userId,
      productId: o.productId,
      quantity: o.quantity,
      totalPrice: o.totalPrice,
      content: o.content,
      createdAt: o.createdAt
    });
  });

  const savedDeposits = await db.getPendingDeposits();
  savedDeposits.forEach(d => {
    pendingDeposits.set(d.id, {
      userId: d.userId,
      amount: d.amount,
      content: d.content,
      createdAt: d.createdAt
    });
  });

  const bot = new TelegramBot(config.BOT_TOKEN, {
    polling: { params: { timeout: 10 }, interval: 300 }
  });

  bot.setMyCommands([
    { command: 'start', description: 'Chọn ngôn ngữ & Khởi động' },
    { command: 'menu', description: 'Danh mục sản phẩm' }
  ]);

  config.ADMIN_IDS.forEach(adminId => {
    bot.setMyCommands([
      { command: 'categories', description: '📁 Quản lý thư mục danh mục' },
      { command: 'products', description: '⚙️ Quản lý sản phẩm' },
      { command: 'orders', description: '📦 Quản lý đơn hàng' },
      { command: 'revenue', description: '📈 Báo cáo doanh thu' },
      { command: 'stats', description: '📊 Kiểm tra tồn kho' },
      { command: 'users', description: '👥 Quản lý thành viên' },
      { command: 'broadcast', description: '📣 Gửi tin thông báo' },
      { command: 'setmoney', description: '💵 Chỉnh sửa số dư ví' }
    ], { scope: { type: 'chat', chat_id: adminId } });
  });

  bot.on('polling_error', (err) => console.log('Polling error:', err.message));

  // Tự động kiểm tra SePay
  setInterval(async () => {
    if (pendingOrders.size === 0 && pendingDeposits.size === 0) return;

    const now = Date.now();
    const transactions = await sepay.getTransactions();

    for (const [orderId, order] of pendingOrders) {
      if (processingOrders.has(orderId)) continue;
      if (now - order.createdAt > ORDER_TIMEOUT_MS) {
        pendingOrders.delete(orderId);
        await db.updateOrder(orderId, null, 'expired');
        bot.sendMessage(order.chatId, `⏰ Đơn hàng <b>#${orderId}</b> đã bị hủy do quá hạn.\n👉 Gõ /menu để mua lại!`, { parse_mode: 'HTML' });
        continue;
      }

      processingOrders.add(orderId);
      const paid = transactions.find(t => {
        const transContent = (t.transaction_content || t.content || t.description || '').toUpperCase();
        const transAmount = parseInt(t.amount_in || t.amount || 0);
        return transContent.includes(order.content.toUpperCase()) && transAmount >= order.totalPrice;
      });

      if (paid) {
        pendingOrders.delete(orderId);
        const product = await db.getProduct(order.productId);
        let accounts = [];
        for (let i = 0; i < order.quantity; i++) {
          const stock = await db.getAvailableStock(order.productId);
          if (stock) {
            await db.markStockSold(stock.id, order.userId);
            accounts.push(stock.account_data);
          }
        }
        if (accounts.length > 0) {
          await deliverOrder(bot, orderId, order.chatId, order.userId, { first_name: 'Khách hàng', id: order.userId }, product, accounts);
        }
      }
      processingOrders.delete(orderId);
    }

    for (const [depositId, dep] of pendingDeposits) {
      if (now - dep.createdAt > ORDER_TIMEOUT_MS) {
        pendingDeposits.delete(depositId);
        await db.updateDepositStatus(depositId, 'expired');
        continue;
      }

      const paidDep = transactions.find(t => {
        const transContent = (t.transaction_content || t.content || t.description || '').toUpperCase();
        const transAmount = parseInt(t.amount_in || t.amount || 0);
        return transContent.includes(dep.content.toUpperCase()) && transAmount >= dep.amount;
      });

      if (paidDep) {
        pendingDeposits.delete(depositId);
        await db.updateDepositStatus(depositId, 'completed');
        await db.addMoney(dep.userId, dep.amount);
        const newBal = await db.getUserBalance(dep.userId);

        bot.sendMessage(dep.userId, 
`╭━━━━━━━━━━━━━━━━━━━━━━━━╮
  🎉 <b>NẠP TIỀN THÀNH CÔNG!</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ ➕ <b>Số tiền nạp:</b>  <code>+${formatPrice(dep.amount)}</code>
 ╰ 💳 <b>Số dư ví mới:</b> <code>${formatPrice(newBal)}</code>`, { parse_mode: 'HTML' });
      }
    }
  }, 25000);

  // Khi bấm /start
  bot.onText(/\/start/, async (msg) => {
    const userId = msg.from.id;
    await db.saveUser(userId, getFullName(msg.from), msg.from.username || '');

    bot.sendMessage(msg.chat.id, 
`╭━━━━━━━━━━━━━━━━━━━━━━━━╮
  🌟 <b>${config.SHOP_NAME || 'CLONE FF GIÁ RẺ'}</b> 🌟
╰━━━━━━━━━━━━━━━━━━━━━━━━╯
👋 <b>Xin chào ${getFullName(msg.from)}!</b>

Vui lòng chọn ngôn ngữ để bắt đầu:
<i>Please choose your language to continue:</i>`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: getLanguageKeyboard() }
    });
  });

  bot.onText(/\/menu/, async (msg) => {
    const userId = msg.from.id;
    await db.saveUser(userId, getFullName(msg.from), msg.from.username || '');
    const { text, keyboard } = await buildMainMenu(userId);
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
  });

  // Admin: /categories
  bot.onText(/\/categories/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const categories = await db.getAllCategories();
    const keyboard = categories.map(c => [{ text: wideInlineLabel(`📁 ${c.name} (${c.product_count} SP)`), callback_data: `adm_cat_detail_${c.id}` }]);
    keyboard.push([{ text: wideInlineLabel('➕ Tạo thư mục mới'), callback_data: 'adm_add_cat' }]);

    bot.sendMessage(msg.chat.id, `📁 <b>QUẢN TRỊ THƯ MỤC DANH MỤC</b>\nHiện có: <b>${categories.length}</b> thư mục. Bấm vào thư mục để chọn SP từ /products đưa vào:`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  });

  // Admin: /products
  bot.onText(/\/products/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const products = await db.getAllProducts();
    const keyboard = products.map(p => [{ text: wideInlineLabel(`📦 #${p.id} ${p.name} (Kho: ${p.stock_count})`), callback_data: 'adm_product_' + p.id }]);
    keyboard.push([{ text: wideInlineLabel('➕ Thêm sản phẩm mới'), callback_data: 'adm_add_product' }]);
    bot.sendMessage(msg.chat.id, `⚙️ <b>QUẢN TRỊ SẢN PHẨM</b>\n📊 Tổng: <b>${products.length}</b> sản phẩm.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
  });

  bot.onText(/\/revenue/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const stats = await db.getRevenue();
    const products = await db.getAllProducts();
    let totalStock = 0;
    products.forEach(p => totalStock += p.stock_count);
    const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━╮
  💰 <b>BÁO CÁO DOANH THU SHOP</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 💵 <b>Tổng thu:</b> <code>${formatPrice(stats.total_revenue)}</code>
 ├ ✅ <b>Đơn thành công:</b> <code>${stats.total_orders} đơn</code>
 ├ 📦 <b>Mặt hàng:</b> <code>${products.length} loại</code>
 ╰ 🎯 <b>Acc tồn kho:</b> <code>${totalStock} acc</code>`;
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  bot.onText(/\/orders/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const orders = await db.getRecentOrders(15);
    if (orders.length === 0) return bot.sendMessage(msg.chat.id, '📦 Hiện chưa có đơn hàng nào!');

    let text = `📦 <b>15 ĐƠN HÀNG GẦN ĐÂY:</b>\n──────────────────────────\n`;
    orders.forEach((o) => {
      const icon = o.status === 'completed' ? '✅' : o.status === 'pending' ? '⏳' : '❌';
      text += `${icon} <b>#${o.id}</b> | <code>${o.user_name}</code>\n ├ 🎁 ${o.product_name} x${o.quantity}\n ╰ 💵 <code>${formatPrice(o.total_price || 0)}</code>\n\n`;
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  bot.onText(/\/stats/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const products = await db.getAllProducts();
    let text = `📊 <b>TỒN KHO HIỆN TẠI:</b>\n──────────────────────────\n`;
    let total = 0;
    products.forEach(p => {
      const status = p.stock_count > 0 ? '🟢' : '🔴';
      text += `${status} <b>${p.name}:</b> <code>${p.stock_count}</code> acc\n`;
      total += p.stock_count;
    });
    text += `──────────────────────────\n🎯 <b>Tổng kho:</b> <code>${total}</code> acc`;
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  bot.onText(/\/users/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const users = await db.getAllUsers();
    let text = `👥 <b>DANH SÁCH THÀNH VIÊN (${users.length} users):</b>\n──────────────────────────\n`;
    users.slice(0, 30).forEach((u, i) => {
      text += `${i + 1}. <b>${u.first_name}</b> (<code>${u.id}</code>) | 💳 <code>${formatPrice(u.balance)}</code>\n`;
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  bot.onText(/\/setmoney(?:\s+(\d+)\s+(\d+))?/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const targetUserId = match[1];
    const amount = parseInt(match[2], 10);
    if (!targetUserId || isNaN(amount)) {
      return bot.sendMessage(msg.chat.id, '⚠️ Cú pháp: <code>/setmoney &lt;User_ID&gt; &lt;Số_tiền&gt;</code>', { parse_mode: 'HTML' });
    }
    await db.setUserBalance(targetUserId, amount);
    bot.sendMessage(msg.chat.id, `✅ Đã set tiền cho <code>${targetUserId}</code> thành ${formatPrice(amount)}`, { parse_mode: 'HTML' });
  });

  bot.onText(/\/clear/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const chatId = msg.chat.id;
    let deleted = 0;
    bot.sendMessage(chatId, '⏳ Đang xóa 50 tin nhắn gần nhất...').then(async (sentMsg) => {
      for (let i = msg.message_id; i > msg.message_id - 50; i--) {
        try {
          await bot.deleteMessage(chatId, i);
          deleted++;
        } catch (e) { }
      }
      try { await bot.deleteMessage(chatId, sentMsg.message_id); } catch (e) { }
      bot.sendMessage(chatId, `🎯 Đã dọn dẹp thành công ${deleted} tin nhắn!`);
    });
  });

  async function createDepositQR(chatId, userTgId, amount, oldMessageId) {
    const content = generateCode('NAP');
    const deposit = await db.createDeposit(userTgId, amount, content);
    pendingDeposits.set(deposit.id, { userId: userTgId, amount, content, createdAt: deposit.createdAt });

    const caption = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━╮
  💳 <b>YÊU CẦU NẠP TIỀN TỰ ĐỘNG</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 💵 <b>Số tiền nạp:</b>  <code>${formatPrice(amount)}</code>
 ├ 🏦 <b>Ngân hàng:</b>   <b>${config.BANK_NAME}</b>
 ├ 💳 <b>Số tài khoản:</b> <code>${config.BANK_ACCOUNT}</code>
 ├ 👤 <b>Chủ tài khoản:</b> <b>${config.BANK_OWNER}</b>
 ╰ 📝 <b>Nội dung CK:</b>  <code>${content}</code>
──────────────────────────
⚠️ <b>LƯU Ý:</b> Tiền sẽ tự động cộng vào ví trong 15 - 30 giây.`;

    if (oldMessageId) {
      try { await bot.deleteMessage(chatId, oldMessageId); } catch (_) {}
    }

    await bot.sendPhoto(chatId, getQRUrl(amount, content), {
      caption: caption,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('◀️ Quay lại Hồ sơ'), callback_data: 'main_profile' }]] }
    });
  }

  // Xử lý nút bấm Callback
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    try {
      if (data === 'set_lang_vi' || data === 'set_lang_en') {
        const selectedLang = data === 'set_lang_vi' ? 'vi' : 'en';
        await db.setUserLang(userId, selectedLang);
        const { text, keyboard } = await buildMainMenu(userId);
        return bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
      }

      if (data === 'main_shop' || data === 'back_main') {
        const { text, keyboard } = await buildMainMenu(userId);
        if (query.message.photo) {
          await bot.deleteMessage(chatId, query.message.message_id);
          return bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
        }
        return bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
      }

      if (data === 'change_language') {
        return bot.editMessageText('🌐 <b>Chọn ngôn ngữ hiển thị:</b>', {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: getLanguageKeyboard() }
        });
      }

      // Khách bấm xem thư mục
      if (data.startsWith('view_category_')) {
        const catId = parseInt(data.split('_')[2]);
        const cat = await db.getCategory(catId);
        const products = await db.getProductsByCategory(catId);
        let lang = await db.getUserLang(userId) || 'vi';
        const t = MESSAGES[lang] || MESSAGES.vi;

        if (products.length === 0) {
          return bot.answerCallbackQuery(query.id, { text: 'Thư mục này hiện chưa có sản phẩm nào!', show_alert: true });
        }

        const keyboard = products.map(p => {
          const stockBadge = p.stock_count > 0 ? `🟢 ${t.stock_in} ${p.stock_count}` : `🔴 ${t.stock_out}`;
          return [{ text: wideInlineLabel(`💎 ${p.name} ▫️ ${getDisplayPrice(p)} [${stockBadge}]`), callback_data: 'product_' + p.id }];
        });
        keyboard.push([{ text: wideInlineLabel(t.btn_back_home), callback_data: 'back_main' }]);

        const text = `📁 <b>DANH MỤC: ${cat ? cat.name.toUpperCase() : 'SẢN PHẨM'}</b>\n<i>${cat?.description || 'Chọn sản phẩm bạn muốn mua:'}</i>`;
        return bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
      }

      // Khách xem chi tiết sản phẩm
      if (data.startsWith('product_')) {
        const product = await db.getProduct(parseInt(data.split('_')[1]));
        if (!product) return bot.answerCallbackQuery(query.id, { text: 'Sản phẩm không tồn tại!' });
        let lang = await db.getUserLang(userId) || 'vi';
        const t = MESSAGES[lang] || MESSAGES.vi;
        const stock = product.stock_count;

        const presets = [1, 2, 3, 5, 10];
        const qtyButtons = [];
        presets.forEach(n => {
          if (n <= stock) {
            const unitPrice = db.getUnitPrice(product, n);
            const label = unitPrice < product.price ? '『' + n + '』 ' + formatPrice(unitPrice) : '『' + n + '』';
            qtyButtons.push({ text: wideInlineLabel(label), callback_data: 'qty_' + product.id + '_' + n });
          }
        });

        const keyboard = [];
        if (qtyButtons.length <= 3) {
          keyboard.push(qtyButtons);
        } else {
          keyboard.push(qtyButtons.slice(0, 3));
          keyboard.push(qtyButtons.slice(3));
        }

        if (stock > 5) {
          keyboard.push([{ text: wideInlineLabel('📝 Nhập số lượng khác'), callback_data: 'customqty_' + product.id }]);
        }

        if (product.category_id > 0) {
          keyboard.push([{ text: wideInlineLabel('◀️ Quay lại thư mục'), callback_data: 'view_category_' + product.category_id }]);
        } else {
          keyboard.push([{ text: wideInlineLabel(t.btn_back_home), callback_data: 'main_shop' }]);
        }

        const text = '🎁 <b>' + product.name + '</b>\n' +
                     '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                     productPriceBlockUser(product) +
                     '📊 Còn: <b>' + stock + '</b> sản phẩm\n' +
                     (product.description ? '📝 ' + product.description + '\n' : '') +
                     '\n⛄ Chọn số lượng:';

        return bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
      }

      if (data.startsWith('customqty_')) {
        const productId = parseInt(data.split('_')[1]);
        const product = await db.getProduct(productId);
        if (!product) return bot.answerCallbackQuery(query.id, { text: 'Sản phẩm không tồn tại!' });
        waitingEdit.set(userId, { field: 'custom_qty', productId, messageId: query.message.message_id });

        const text = '📝 <b>NHẬP SỐ LƯỢNG</b>\n' +
                     '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                     '📦 ' + product.name + '\n' +
                     productPriceBlockUser(product) +
                     '📊 Còn: ' + product.stock_count + ' sp\n\n' +
                     '✏️ Nhập số lượng muốn mua:';

        return bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy'), callback_data: 'product_' + productId }]] } });
      }

      if (data.startsWith('qty_')) {
        const [, productId, quantity] = data.split('_');
        const product = await db.getProduct(parseInt(productId));
        const qty = parseInt(quantity);
        if (product.stock_count < qty) return bot.answerCallbackQuery(query.id, { text: 'Không đủ hàng!', show_alert: true });

        const totalPrice = db.calculatePrice(product, qty);
        const unitPrice = db.getUnitPrice(product, qty);
        const userBalance = await db.getUserBalance(userId);

        const discountInfo = unitPrice < product.price ? '\n💎 Giá ưu đãi: ' + formatPrice(unitPrice) + '/sp' : '';
        const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━╮
  🧾 <b>XÁC NHẬN ĐƠN ĐẶT HÀNG</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 🎁 <b>Sản phẩm:</b> <b>${product.name}</b>
 ├ 🔢 <b>Số lượng:</b> <code>${qty} acc</code>${discountInfo}
 ├ 💰 <b>Tổng tiền:</b> <code>${formatPrice(totalPrice)}</code>
 ╰ 💳 <b>Ví của bạn:</b> <code>${formatPrice(userBalance)}</code>
──────────────────────────
<i>Chọn hình thức thanh toán bên dưới:</i>`;

        const keyboard = [
          [{ text: wideInlineLabel('⚡ Mua bằng SỐ DƯ VÍ'), callback_data: `paywallet_${productId}_${qty}` }],
          [{ text: wideInlineLabel('🏦 Quét mã QR NGÂN HÀNG'), callback_data: `paybank_${productId}_${qty}` }],
          [{ text: wideInlineLabel('◀️ Quay lại'), callback_data: `product_${productId}` }]
        ];

        return bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
      }

      if (data.startsWith('paywallet_')) {
        const [, productId, quantity] = data.split('_');
        const product = await db.getProduct(parseInt(productId));
        const qty = parseInt(quantity);
        const totalPrice = db.calculatePrice(product, qty);
        const userBalance = await db.getUserBalance(userId);

        if (userBalance < totalPrice) {
          return bot.answerCallbackQuery(query.id, { text: `Số dư ví không đủ! Cần nạp thêm.`, show_alert: true });
        }
        if (product.stock_count < qty) {
          return bot.answerCallbackQuery(query.id, { text: 'Kho vừa hết hàng!', show_alert: true });
        }

        await db.deductBalance(userId, totalPrice);
        let accounts = [];
        for (let i = 0; i < qty; i++) {
          const stock = await db.getAvailableStock(parseInt(productId));
          if (stock) {
            await db.markStockSold(stock.id, userId);
            accounts.push(stock.account_data);
          }
        }

        const order = await db.createOrder(userId, parseInt(productId), chatId, 'WALLET_PAY', qty, totalPrice);
        await bot.deleteMessage(chatId, query.message.message_id);
        await deliverOrder(bot, order.lastInsertRowid, chatId, userId, query.from, product, accounts);
        return;
      }

      if (data.startsWith('paybank_')) {
        const [, productId, quantity] = data.split('_');
        const product = await db.getProduct(parseInt(productId));
        const qty = parseInt(quantity);
        const totalPrice = db.calculatePrice(product, qty);
        const unitPrice = db.getUnitPrice(product, qty);

        const content = generateCode();
        const order = await db.createOrder(userId, parseInt(productId), chatId, content, qty, totalPrice);
        const orderId = order.lastInsertRowid;
        pendingOrders.set(orderId, { chatId, userId, productId: parseInt(productId), quantity: qty, totalPrice, content, createdAt: order.createdAt });

        await bot.deleteMessage(chatId, query.message.message_id);
        const discountInfo = unitPrice < product.price ? '\n💎 Giá ưu đãi: ' + formatPrice(unitPrice) + '/sp' : '';
        const caption = '💳 <b>THANH TOÁN ĐƠN #' + orderId + '</b>\n' +
                        '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                        '🎁 ' + product.name + ' x' + qty + discountInfo + '\n' +
                        '💰 Tổng: <code>' + formatPrice(totalPrice) + '</code>\n\n' +
                        '🏦 <b>THÔNG TIN CHUYỂN KHOẢN</b>\n' +
                        '• NH: ' + config.BANK_NAME + '\n' +
                        '• STK: <code>' + config.BANK_ACCOUNT + '</code>\n' +
                        '• Chủ TK: ' + config.BANK_OWNER + '\n' +
                        '• Nội dung: <code>' + content + '</code>\n\n' +
                        '📲 Quét QR để thanh toán\n' +
                        '⏳ Tự động giao acc ngay khi nhận tiền!';

        await bot.sendPhoto(chatId, getQRUrl(totalPrice, content), {
          caption,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: wideInlineLabel('🔄 Kiểm tra thanh toán'), callback_data: 'check_' + orderId + '_' + productId + '_' + qty }],
              [{ text: wideInlineLabel('❌ Hủy đơn'), callback_data: 'cancel_' + orderId }]
            ]
          }
        });
        return;
      }

      if (data.startsWith('check_')) {
        const [, orderId, productId, quantity] = data.split('_');
        const orderIdNum = parseInt(orderId);
        const order = pendingOrders.get(orderIdNum);
        if (!order) return bot.answerCallbackQuery(query.id, { text: 'Đơn hàng không tồn tại hoặc đã xử lý!', show_alert: true });

        if (processingOrders.has(orderIdNum)) {
          return bot.answerCallbackQuery(query.id, { text: '⏳ Đang quét giao dịch, vui lòng chờ 5 giây...', show_alert: true });
        }

        processingOrders.add(orderIdNum);
        const product = await db.getProduct(parseInt(productId));
        const qty = parseInt(quantity) || 1;

        const paid = await sepay.checkPayment(order.content, order.totalPrice);
        if (paid) {
          pendingOrders.delete(orderIdNum);
          let accounts = [];
          for (let i = 0; i < qty; i++) {
            const stock = await db.getAvailableStock(parseInt(productId));
            if (stock) {
              await db.markStockSold(stock.id, userId);
              accounts.push(stock.account_data);
            }
          }
          if (accounts.length > 0) {
            await deliverOrder(bot, orderIdNum, chatId, userId, query.from, product, accounts);
          }
        } else {
          bot.answerCallbackQuery(query.id, { text: 'Hệ thống chưa nhận được tiền. Thử lại sau!', show_alert: true });
        }

        processingOrders.delete(orderIdNum);
        return;
      }

      if (data.startsWith('cancel_')) {
        const orderId = parseInt(data.split('_')[1]);
        if (pendingOrders.has(orderId)) {
          pendingOrders.delete(orderId);
          await db.updateOrder(orderId, null, 'cancelled');
        }
        const { text, keyboard } = await buildMainMenu(userId);
        if (query.message.photo) {
          await bot.deleteMessage(chatId, query.message.message_id);
          return bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
        }
        return bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
      }

      if (data === 'main_profile') {
        const orders = await db.getOrdersByUser(userId);
        const completed = orders.filter(o => o.status === 'completed');
        const totalSpent = completed.reduce((sum, o) => sum + (o.total_price || 0), 0);
        const balance = await db.getUserBalance(userId);
        const { totalDeposit, monthDeposit } = await db.getUserDepositStats(userId);

        const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━╮
  👤 <b>THÔNG TIN TÀI KHOẢN</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 🆔 <b>ID:</b> <code>${userId}</code>
 ├ 🏷️ <b>Họ tên:</b> <b>${getFullName(query.from)}</b>
 ╰ 📧 <b>Username:</b> ${query.from.username ? '@' + query.from.username : '<i>Không có</i>'}
──────────────────────────
💳 <b>TÌNH TRẠNG TÀI CHÍNH</b>
 ├ 🏦 <b>Số dư khả dụng:</b> <code>${formatPrice(balance)}</code>
 ├ 🏯 <b>Tổng tiền đã nạp:</b> <code>${formatPrice(totalDeposit)}</code>
 ╰ 💰 <b>Nạp trong tháng:</b>  <code>${formatPrice(monthDeposit)}</code>
──────────────────────────
📊 <b>HOẠT ĐỘNG MUA HÀNG</b>
 ├ 🛍️ <b>Đơn hoàn tất:</b> <code>${completed.length} đơn</code>
 ╰ 💸 <b>Đã tiêu dùng:</b>  <code>${formatPrice(totalSpent)}</code>`;

        const keyboard = [
          [{ text: wideInlineLabel('💳 Nạp tiền vào ví'), callback_data: 'deposit_menu' }],
          [{ text: wideInlineLabel('📜 Lịch sử mua hàng'), callback_data: 'main_history' }],
          [{ text: wideInlineLabel('◀️ Quay lại'), callback_data: 'back_main' }]
        ];

        return bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
      }

      if (data === 'deposit_menu') {
        const text = `💳 <b>NẠP TIỀN VÀO TÀI KHOẢN</b>\nChọn mức nạp hoặc tự nhập:`;
        const keyboard = [
          [{ text: wideInlineLabel('💵 20.000đ'), callback_data: 'dep_amt_20000' }, { text: wideInlineLabel('💵 50.000đ'), callback_data: 'dep_amt_50000' }],
          [{ text: wideInlineLabel('💵 100.000đ'), callback_data: 'dep_amt_100000' }, { text: wideInlineLabel('💵 200.000đ'), callback_data: 'dep_amt_200000' }],
          [{ text: wideInlineLabel('💵 500.000đ'), callback_data: 'dep_amt_500000' }, { text: wideInlineLabel('✏️ Tự nhập số tiền'), callback_data: 'dep_custom' }],
          [{ text: wideInlineLabel('◀️ Quay lại Hồ sơ'), callback_data: 'main_profile' }]
        ];
        return bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
      }

      if (data.startsWith('dep_amt_')) {
        const amount = parseInt(data.split('_')[2], 10);
        await createDepositQR(chatId, userId, amount, query.message.message_id);
        return;
      }

      if (data === 'dep_custom') {
        waitingEdit.set(userId, { field: 'custom_deposit', messageId: query.message.message_id });
        return bot.editMessageText(`✏️ Nhập số tiền bạn muốn nạp (tối thiểu 10.000đ):`, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy'), callback_data: 'deposit_menu' }]] }
        });
      }

      if (data === 'main_history') {
        const orders = await db.getOrderHistory(userId);
        if (orders.length === 0) return bot.answerCallbackQuery(query.id, { text: 'Chưa có lịch sử mua hàng!', show_alert: true });

        let text = `📜 <b>LỊCH SỬ MUA HÀNG:</b>\n──────────────────────────\n`;
        const keyboard = [];
        orders.slice(0, 8).forEach((o) => {
          const statusIcon = o.status === 'completed' ? '✅' : o.status === 'pending' ? '⏳' : '❌';
          text += `${statusIcon} <b>#${o.id}</b> • <b>${o.product_name}</b> (x${o.quantity || 1}) - <code>${formatPrice(o.total_price)}</code>\n`;
          if (o.status === 'completed' && o.delivered_data) {
            keyboard.push([{ text: wideInlineLabel(`📥 Tải file đơn #${o.id} (${o.product_name})`), callback_data: `dl_order_${o.id}` }]);
          }
        });
        keyboard.push([{ text: wideInlineLabel('◀️ Quay lại'), callback_data: 'back_main' }]);
        return bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
      }

      if (data.startsWith('dl_order_')) {
        const orderId = parseInt(data.split('_')[2]);
        const order = await db.getOrderById(orderId);
        if (order && order.delivered_data) {
          const txtBuffer = Buffer.from(order.delivered_data, 'utf-8');
          await bot.sendDocument(chatId, txtBuffer, { caption: `📁 File đơn #${order.id}` }, { filename: `DonHang_${order.id}.txt`, contentType: 'text/plain' });
        }
        return bot.answerCallbackQuery(query.id);
      }

      // ==================== ADMIN CALLBACKS ====================
      if (isAdmin(userId)) {
        if (data === 'adm_add_cat') {
          waitingEdit.set(userId, { field: 'new_category', messageId: query.message.message_id });
          return bot.editMessageText('📁 <b>TẠO THƯ MỤC MỚI</b>\n\nNhập cú pháp: <code>Tên thư mục|Mô tả</code>\nVí dụ: <code>Acc Free Fire|Danh sách nick FF vip</code>', {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy'), callback_data: 'adm_back_categories' }]] }
          });
        }

        // CHI TIẾT 1 THƯ MỤC TRONG /categories
        if (data.startsWith('adm_cat_detail_')) {
          const catId = parseInt(data.split('_')[3]);
          const cat = await db.getCategory(catId);
          if (!cat) return bot.answerCallbackQuery(query.id, { text: 'Thư mục không tồn tại!' });
          const prods = await db.getProductsByCategory(catId);

          let text = `📁 <b>THƯ MỤC: ${cat.name.toUpperCase()}</b>\n📝 Mô tả: <i>${cat.description || 'Chưa có'}</i>\n📊 Đang có: <b>${prods.length}</b> sản phẩm\n\n`;
          if (prods.length > 0) {
            text += `<i>Danh sách sản phẩm trong thư mục này:</i>\n`;
            prods.forEach((p, idx) => {
              text += `${idx + 1}. <b>${p.name}</b> (Kho: ${p.stock_count}) - ${formatPrice(p.price)}\n`;
            });
          } else {
            text += `<i>(Thư mục này hiện chưa có sản phẩm nào)</i>`;
          }

          const keyboard = [
            // Nút quan trọng: Chọn sản phẩm từ /products đưa vào thư mục này
            [{ text: wideInlineLabel('➕ Thêm sản phẩm từ /products'), callback_data: `adm_pick_from_prods_${catId}` }],
            [{ text: wideInlineLabel('🗑️ Xóa thư mục này'), callback_data: `adm_delcat_${catId}` }],
            [{ text: wideInlineLabel('◀️ Quay lại danh sách thư mục'), callback_data: 'adm_back_categories' }]
          ];

          return bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
        }

        // CHỌN SẢN PHẨM TỪ KHO ĐỂ ĐƯA VÀO HOẶC GỠ RA KHỎI THƯ MỤC NÀY
        if (data.startsWith('adm_pick_from_prods_')) {
          const catId = parseInt(data.split('_')[4]);
          const cat = await db.getCategory(catId);
          const allProds = await db.getAllProducts();

          if (allProds.length === 0) {
            return bot.answerCallbackQuery(query.id, { text: 'Shop chưa có sản phẩm nào! Vui lòng dùng /products tạo sản phẩm trước.', show_alert: true });
          }

          const keyboard = [];
          allProds.forEach(p => {
            const inThisCat = p.category_id === catId;
            const statusIcon = inThisCat ? '✅ [ĐÃ TRONG MỤC]' : '➕ [CHƯA VÀO]';
            keyboard.push([{
              text: wideInlineLabel(`${statusIcon} #${p.id} ${p.name}`),
              callback_data: `adm_toggle_prodcat_${catId}_${p.id}`
            }]);
          });

          keyboard.push([{ text: wideInlineLabel('◀️ Xong / Quay lại thư mục'), callback_data: `adm_cat_detail_${catId}` }]);

          const text = `📁 <b>THƯ MỤC: ${cat.name.toUpperCase()}</b>\n` +
                       `<i>Bấm vào sản phẩm bên dưới để thêm vào thư mục (hoặc bấm để gỡ ra):</i>\n\n` +
                       `• ✅ = Đang nằm trong thư mục này (bấm để gỡ)\n` +
                       `• ➕ = Chưa vào thư mục này (bấm để đưa vào)`;

          return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
          });
        }

        // TOGGLE THÊM / GỠ SẢN PHẨM VÀO THƯ MỤC
        if (data.startsWith('adm_toggle_prodcat_')) {
          const [, , , catIdStr, prodIdStr] = data.split('_');
          const catId = parseInt(catIdStr);
          const prodId = parseInt(prodIdStr);

          const currentProd = await db.getProduct(prodId);
          if (currentProd) {
            const newCatId = currentProd.category_id === catId ? 0 : catId; // Nếu đã có thì gỡ ra 0, nếu chưa có thì gán catId
            if (db.updateProductCategory) {
              await db.updateProductCategory(prodId, newCatId);
            }
            bot.answerCallbackQuery(query.id, {
              text: newCatId === 0 ? `Đã gỡ #${prodId} ra khỏi thư mục!` : `Đã thêm #${prodId} vào thư mục thành công!`
            });
          }

          // Cập nhật lại danh sách nút bấm
          const cat = await db.getCategory(catId);
          const allProds = await db.getAllProducts();
          const keyboard = [];
          allProds.forEach(p => {
            const inThisCat = p.category_id === catId;
            const statusIcon = inThisCat ? '✅ [ĐÃ TRONG MỤC]' : '➕ [CHƯA VÀO]';
            keyboard.push([{
              text: wideInlineLabel(`${statusIcon} #${p.id} ${p.name}`),
              callback_data: `adm_toggle_prodcat_${catId}_${p.id}`
            }]);
          });
          keyboard.push([{ text: wideInlineLabel('◀️ Xong / Quay lại thư mục'), callback_data: `adm_cat_detail_${catId}` }]);

          const text = `📁 <b>THƯ MỤC: ${cat.name.toUpperCase()}</b>\n` +
                       `<i>Bấm vào sản phẩm bên dưới để thêm vào thư mục (hoặc bấm để gỡ ra):</i>\n\n` +
                       `• ✅ = Đang nằm trong thư mục này (bấm để gỡ)\n` +
                       `• ➕ = Chưa vào thư mục này (bấm để đưa vào)`;

          return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
          });
        }

        // Xóa thư mục
        if (data.startsWith('adm_delcat_')) {
          const catId = parseInt(data.split('_')[2]);
          await db.deleteCategory(catId);
          bot.answerCallbackQuery(query.id, { text: 'Đã xóa thư mục!' });
          const categories = await db.getAllCategories();
          const keyboard = categories.map(c => [{ text: wideInlineLabel(`📁 ${c.name} (${c.product_count} SP)`), callback_data: `adm_cat_detail_${c.id}` }]);
          keyboard.push([{ text: wideInlineLabel('➕ Tạo thư mục mới'), callback_data: 'adm_add_cat' }]);
          return bot.editMessageText('✅ Đã xóa thư mục thành công!\n\n📁 <b>QUẢN TRỊ THƯ MỤC:</b>', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
        }

        if (data === 'adm_back_categories') {
          const categories = await db.getAllCategories();
          const keyboard = categories.map(c => [{ text: wideInlineLabel(`📁 ${c.name} (${c.product_count} SP)`), callback_data: `adm_cat_detail_${c.id}` }]);
          keyboard.push([{ text: wideInlineLabel('➕ Tạo thư mục mới'), callback_data: 'adm_add_cat' }]);
          return bot.editMessageText('📁 <b>QUẢN TRỊ THƯ MỤC DANH MỤC:</b>', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
        }

        // Khi bấm "➕ Thêm sản phẩm mới"
        if (data === 'adm_add_product') {
          const categories = await db.getAllCategories();
          const keyboard = [];

          if (categories.length > 0) {
            categories.forEach(c => {
              keyboard.push([{ text: wideInlineLabel(`📁 Đưa vào: ${c.name}`), callback_data: `adm_addprodto_${c.id}` }]);
            });
          }
          keyboard.push([{ text: wideInlineLabel('📦 Mục chung (Không thư mục)'), callback_data: 'adm_addprodto_0' }]);
          keyboard.push([{ text: wideInlineLabel('❌ Hủy'), callback_data: 'adm_back_list' }]);

          return bot.editMessageText('📁 <b>BƯỚC 1: Chọn thư mục bạn muốn chứa sản phẩm này:</b>', {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
          });
        }

        if (data.startsWith('adm_addprodto_')) {
          const catId = parseInt(data.split('_')[2]);
          waitingEdit.set(userId, { field: 'new_product', categoryId: catId, messageId: query.message.message_id });
          return bot.editMessageText(`➕ <b>BƯỚC 2: NHẬP THÔNG TIN SẢN PHẨM</b>\n\nNhập cú pháp: <code>Tên|Giá|Mô tả</code>\nVí dụ: <code>Acc Clone Lv5|25000|Clone sạch chưa qua liên kết</code>`, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy'), callback_data: 'adm_back_list' }]] }
          });
        }

        // Đổi thư mục cho sản phẩm
        if (data.startsWith('adm_change_cat_')) {
          const productId = parseInt(data.split('_')[3]);
          const categories = await db.getAllCategories();
          const keyboard = [];

          categories.forEach(c => {
            keyboard.push([{ text: wideInlineLabel(`📁 Chuyển sang: ${c.name}`), callback_data: `adm_apply_cat_${productId}_${c.id}` }]);
          });
          keyboard.push([{ text: wideInlineLabel('📦 Chuyển ra Mục chung'), callback_data: `adm_apply_cat_${productId}_0` }]);
          keyboard.push([{ text: wideInlineLabel('◀️ Hủy & Quay lại'), callback_data: `adm_product_${productId}` }]);

          return bot.editMessageText('📁 <b>Chọn thư mục mới cho sản phẩm này:</b>', {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
          });
        }

        if (data.startsWith('adm_apply_cat_')) {
          const [, , , productId, catId] = data.split('_');
          if (db.updateProductCategory) {
            await db.updateProductCategory(parseInt(productId), parseInt(catId));
          }
          bot.answerCallbackQuery(query.id, { text: 'Đã đổi thư mục thành công!' });
          return bot.editMessageText(`✅ Đã chuyển sản phẩm #${productId} sang thư mục mới!`, {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('◀️ Về chi tiết SP'), callback_data: 'adm_product_' + productId }]] }
          });
        }

        // Chi tiết sản phẩm
        if (data.startsWith('adm_product_')) {
          const productId = parseInt(data.split('_')[2]);
          const product = await db.getProduct(productId);
          if (!product) return bot.answerCallbackQuery(query.id, { text: 'Không tồn tại!' });
          const stocks = await db.getStockByProduct(productId);
          const available = stocks.filter(s => !s.is_sold).length;
          const sold = stocks.length - available;

          let catName = 'Mục chung (Không thư mục)';
          if (product.category_id > 0) {
            const cat = await db.getCategory(product.category_id);
            if (cat) catName = cat.name;
          }

          const text = '📦 <b>' + product.name + '</b> (#' + product.id + ')\n' +
                       '📁 Thư mục: <b>' + catName + '</b>\n' +
                       '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                       productPriceBlockAdmin(product) +
                       '📝 Mô tả: ' + (product.description || 'Chưa có') + '\n\n' +
                       '📊 KHO: ✅' + available + ' còn │ 🔴' + sold + ' đã bán';

          return bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: adminProductKeyboard(productId) } });
        }

        if (data.startsWith('adm_edit_tiers_')) {
          const productId = parseInt(data.split('_')[3]);
          const product = await db.getProduct(productId);
          waitingEdit.set(userId, { productId, field: 'tiers', messageId: query.message.message_id });

          let currentTiers = 'Chưa có bảng giá';
          if (product.price_tiers && product.price_tiers.length > 0) {
            currentTiers = product.price_tiers.map(t => t.min + ':' + t.price).join(', ');
          }

          const text = '📊 SỬA BẢNG GIÁ\n' +
                       '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                       '📦 ' + product.name + '\n' +
                       '💰 Giá gốc: ' + formatPrice(product.price) + '\n' +
                       '📋 Hiện tại: ' + currentTiers + '\n\n' +
                       '📝 Nhập format:\n' +
                       'SốLượng:Giá, SốLượng:Giá, ...\n\n' +
                       '▸ Ví dụ:\n' +
                       '1:50000, 10:45000, 20:40000\n\n' +
                       '💡 Nhập "xoa" để xóa bảng giá';
          return bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]] } });
        }

        if (data.startsWith('adm_edit_name_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'name', messageId: query.message.message_id });
          return bot.editMessageText('✏️ Nhập tên mới cho sản phẩm #' + productId + ':', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]] } });
        }

        if (data.startsWith('adm_edit_price_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'price', messageId: query.message.message_id });
          return bot.editMessageText('💵 Nhập giá mới (số) cho sản phẩm #' + productId + ':', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]] } });
        }

        if (data.startsWith('adm_edit_desc_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'desc', messageId: query.message.message_id });
          return bot.editMessageText('📝 Nhập mô tả mới cho sản phẩm #' + productId + ':', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]] } });
        }

        if (data.startsWith('adm_addstock_')) {
          const productId = parseInt(data.split('_')[2]);
          const product = await db.getProduct(productId);
          waitingStock.set(userId, productId);
          return bot.editMessageText('➕ Thêm stock cho: ' + product.name + '\n\nGửi danh sách tài khoản (mỗi dòng 1 tk):', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]] } });
        }

        if (data.startsWith('adm_viewstock_')) {
          const productId = parseInt(data.split('_')[2]);
          const product = await db.getProduct(productId);
          const stocks = await db.getStockByProduct(productId);
          const available = stocks.filter(s => !s.is_sold);
          let text = '📦 ' + product.name + '\n\n🎯 Còn: ' + available.length + ' | ✖️ Đã bán: ' + (stocks.length - available.length) + '\n\n';
          const keyboard = [];
          if (available.length > 0) {
            text += 'Tài khoản còn (bấm để xóa):\n';
            available.slice(0, 10).forEach((s, i) => {
              text += (i + 1) + '. ' + s.account_data + '\n';
              keyboard.push([{ text: wideInlineLabel('🗑️ Xóa: ' + s.account_data.substring(0, 25) + '...'), callback_data: 'adm_delstock_' + productId + '_' + s.id }]);
            });
            if (available.length > 10) text += '... và ' + (available.length - 10) + ' tài khoản khác\n';
            keyboard.push([{ text: wideInlineLabel('🗑️ Xóa TẤT CẢ stock'), callback_data: 'adm_clearstock_' + productId }]);
          } else {
            text += '✖️ Chưa có tài khoản trong kho!';
          }
          keyboard.push([{ text: wideInlineLabel('➕ Thêm stock'), callback_data: 'adm_addstock_' + productId }]);
          keyboard.push([{ text: wideInlineLabel('← Quay lại'), callback_data: 'adm_product_' + productId }]);
          return bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: keyboard } });
        }

        if (data.startsWith('adm_delstock_')) {
          const parts = data.split('_');
          const productId = parseInt(parts[2]);
          const stockId = parseInt(parts[3]);
          await db.deleteStock(stockId);
          bot.answerCallbackQuery(query.id, { text: '🎯 Đã xóa!' });
          const product = await db.getProduct(productId);
          const stocks = await db.getStockByProduct(productId);
          const available = stocks.filter(s => !s.is_sold);
          let text = '📦 ' + product.name + '\n\n🎯 Còn: ' + available.length + ' | ✖️ Đã bán: ' + (stocks.length - available.length) + '\n\n';
          const keyboard = [];
          if (available.length > 0) {
            available.slice(0, 10).forEach((s, i) => {
              text += `${i + 1}. ${s.account_data}\n`;
              keyboard.push([{ text: wideInlineLabel('🗑️ Xóa: ' + s.account_data.substring(0, 25) + '...'), callback_data: 'adm_delstock_' + productId + '_' + s.id }]);
            });
            keyboard.push([{ text: wideInlineLabel('🗑️ Xóa TẤT CẢ stock'), callback_data: 'adm_clearstock_' + productId }]);
          }
          keyboard.push([{ text: wideInlineLabel('➕ Thêm stock'), callback_data: 'adm_addstock_' + productId }]);
          keyboard.push([{ text: wideInlineLabel('← Quay lại'), callback_data: 'adm_product_' + productId }]);
          return bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: keyboard } });
        }

        if (data.startsWith('adm_clearstock_')) {
          const productId = parseInt(data.split('_')[2]);
          await db.clearStock(productId);
          bot.answerCallbackQuery(query.id, { text: '🎯 Đã xóa tất cả stock!' });
          return bot.editMessageText(`🎯 Đã xóa sạch toàn bộ acc của sản phẩm #${productId}.`, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('◀️ Quay lại'), callback_data: 'adm_product_' + productId }]] } });
        }

        if (data.startsWith('adm_delete_')) {
          const productId = parseInt(data.split('_')[2]);
          await db.deleteProduct(productId);
          bot.answerCallbackQuery(query.id, { text: 'Đã xóa sản phẩm!' });
          return bot.editMessageText(`🗑️ Đã xóa vĩnh viễn sản phẩm #${productId}.`, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('◀️ Về danh sách'), callback_data: 'adm_back_list' }]] } });
        }

        if (data === 'adm_back_list') {
          const products = await db.getAllProducts();
          const keyboard = products.map(p => [{ text: wideInlineLabel(`📦 #${p.id} ${p.name} (Kho: ${p.stock_count})`), callback_data: 'adm_product_' + p.id }]);
          keyboard.push([{ text: wideInlineLabel('➕ Thêm sản phẩm mới'), callback_data: 'adm_add_product' }]);
          return bot.editMessageText('⚙️ <b>QUẢN TRỊ SẢN PHẨM:</b>', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
        }
      }

    } catch (e) {
      console.log('Callback error:', e.message);
    }
    bot.answerCallbackQuery(query.id).catch(() => {});
  });

  // Message Handler Admin
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/') || !isAdmin(msg.from.id)) return;

    // Nạp stock -> Tự động báo RESTOCK
    const pid = waitingStock.get(msg.from.id);
    if (pid) {
      const accs = msg.text.split('\n').filter(a => a.trim());
      for (const acc of accs) {
        await db.addStock(pid, acc.trim());
      }
      waitingStock.delete(msg.from.id);
      const product = await db.getProduct(pid);

      bot.sendMessage(msg.chat.id, `✅ <b>Đã nạp thành công ${accs.length} tài khoản vào kho!</b>\n📢 Đang tự động thông báo đến tất cả khách hàng...`, { parse_mode: 'HTML' });

      const alertMsg = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━╮
  🔥 <b>THÔNG BÁO HÀNG VỀ (RESTOCK)</b> 🔥
╰━━━━━━━━━━━━━━━━━━━━━━━━╯
📦 <b>Sản phẩm:</b> <b>${product.name}</b>
➕ <b>Vừa cập nhật thêm:</b> <code>+${accs.length} acc</code>
💰 <b>Giá bán:</b> <code>${formatPrice(product.price)}</code>

⚡ <i>Nhanh tay vào mua ngay kẻo hết hàng nhé!</i>`;
      broadcastToAllUsers(bot, alertMsg);
      return;
    }

    const editInfo = waitingEdit.get(msg.from.id);
    if (!editInfo) return;

    // Tạo thư mục mới
    if (editInfo.field === 'new_category') {
      const parts = msg.text.split('|').map(s => s.trim());
      const name = parts[0];
      const desc = parts[1] || '';
      if (!name) return bot.sendMessage(msg.chat.id, '⚠️ Vui lòng nhập tên thư mục!');

      await db.addCategory(name, desc);
      waitingEdit.delete(msg.from.id);
      return bot.sendMessage(msg.chat.id, `✅ Đã tạo thư mục: <b>${name}</b> thành công!\nGõ /categories để kiểm tra.`, { parse_mode: 'HTML' });
    }

    // Thêm SP mới -> Tự động báo HÀNG MỚI
    if (editInfo.field === 'new_product') {
      const parts = msg.text.split('|').map(s => s.trim());
      const name = parts[0];
      const price = parseInt(parts[1], 10);
      const desc = parts.slice(2).join('|') || '';

      if (!name || isNaN(price)) return bot.sendMessage(msg.chat.id, '⚠️ Cú pháp: <code>Tên|Giá|Mô tả</code>', { parse_mode: 'HTML' });

      const res = await db.addProduct(name, price, desc, editInfo.categoryId || 0);
      waitingEdit.delete(msg.from.id);

      bot.sendMessage(msg.chat.id, `✅ Đã tạo sản phẩm <b>${name}</b> (#${res.lastInsertRowid})!\n📢 Đang tự động gửi thông báo đến tất cả khách hàng...`, { parse_mode: 'HTML' });

      const newProductAlert = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━╮
  🎉 <b>MẶT HÀNG MỚI ĐÃ LÊN KỆ!</b> 🎉
╰━━━━━━━━━━━━━━━━━━━━━━━━╯
🎁 <b>Sản phẩm:</b> <b>${name}</b>
💵 <b>Đơn giá:</b> <code>${formatPrice(price)}</code>
📝 <b>Mô tả:</b> <i>${desc || 'Hàng chất lượng cao bảo hành uy tín!'}</i>

👉 <i>Bấm vào nút bên dưới để xem chi tiết và đặt mua!</i>`;
      broadcastToAllUsers(bot, newProductAlert);
      return;
    }

    const product = await db.getProduct(editInfo.productId);
    if (!product) {
      waitingEdit.delete(msg.from.id);
      return bot.sendMessage(msg.chat.id, '✖️ Sản phẩm không tồn tại!');
    }

    let newName = product.name;
    let newPrice = product.price;
    let newDesc = product.description;

    if (editInfo.field === 'name') newName = msg.text.trim();
    else if (editInfo.field === 'price') {
      const priceNum = parseInt(msg.text.trim());
      if (isNaN(priceNum) || priceNum < 0) return bot.sendMessage(msg.chat.id, '✖️ Giá không hợp lệ!');
      newPrice = priceNum;
    } else if (editInfo.field === 'desc') newDesc = msg.text.trim();
    else if (editInfo.field === 'tiers') {
      const input = msg.text.trim().toLowerCase();
      if (input === 'xoa' || input === 'xóa') {
        await db.updatePriceTiers(editInfo.productId, null);
        waitingEdit.delete(msg.from.id);
        return bot.sendMessage(msg.chat.id, '✅ Đã xóa bảng giá! Sẽ dùng giá gốc.\n\nGõ /products để quản lý.');
      }

      const tiers = [];
      const parts = msg.text.split(',').map(s => s.trim());
      for (const part of parts) {
        const [minStr, priceStr] = part.split(':').map(s => s.trim());
        const min = parseInt(minStr);
        const price = parseInt(priceStr);
        if (!isNaN(min) && !isNaN(price) && min >= 1 && price >= 0) {
          tiers.push({ min, price });
        }
      }
      tiers.sort((a, b) => a.min - b.min);
      await db.updatePriceTiers(editInfo.productId, tiers);
      waitingEdit.delete(msg.from.id);
      return bot.sendMessage(msg.chat.id, '✅ Đã cập nhật bảng giá sỉ!\n\nGõ /products để quản lý.');
    }

    await db.updateProduct(editInfo.productId, newName, newPrice, newDesc);
    waitingEdit.delete(msg.from.id);
    return bot.sendMessage(msg.chat.id, `✅ Đã lưu cập nhật cho sản phẩm #${editInfo.productId}!`);
  });

  // Message Handler User
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const editInfo = waitingEdit.get(msg.from.id);
    if (!editInfo) return;

    if (editInfo.field === 'custom_qty') {
      const qty = parseInt(msg.text.trim());
      const product = await db.getProduct(editInfo.productId);

      if (!product) {
        waitingEdit.delete(msg.from.id);
        return bot.sendMessage(msg.chat.id, '✖️ Sản phẩm không tồn tại!');
      }

      if (isNaN(qty) || qty < 1) {
        return bot.sendMessage(msg.chat.id, '✖️ Số lượng không hợp lệ! Nhập số nguyên > 0');
      }

      if (qty > product.stock_count) {
        return bot.sendMessage(msg.chat.id, '✖️ Không đủ hàng! Chỉ còn ' + product.stock_count + ' sản phẩm.');
      }

      waitingEdit.delete(msg.from.id);

      const totalPrice = db.calculatePrice(product, qty);
      const unitPrice = db.getUnitPrice(product, qty);
      const userBalance = await db.getUserBalance(msg.from.id);
      const discountInfo = unitPrice < product.price ? '\n💎 Giá ưu đãi: ' + formatPrice(unitPrice) + '/sp' : '';

      const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━╮
  🧾 <b>XÁC NHẬN ĐƠN ĐẶT HÀNG</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 🎁 <b>Sản phẩm:</b> <b>${product.name}</b>
 ├ 🔢 <b>Số lượng:</b> <code>${qty} acc</code>${discountInfo}
 ├ 💰 <b>Tổng tiền:</b> <code>${formatPrice(totalPrice)}</code>
 ╰ 💳 <b>Ví của bạn:</b> <code>${formatPrice(userBalance)}</code>
──────────────────────────
<i>Chọn hình thức thanh toán bên dưới:</i>`;

      const keyboard = [
        [{ text: wideInlineLabel('⚡ Mua bằng SỐ DƯ VÍ'), callback_data: `paywallet_${editInfo.productId}_${qty}` }],
        [{ text: wideInlineLabel('🏦 Quét mã QR NGÂN HÀNG'), callback_data: `paybank_${editInfo.productId}_${qty}` }],
        [{ text: wideInlineLabel('◀️ Đổi ý quay lại'), callback_data: `product_${editInfo.productId}` }]
      ];

      return bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
    }

    if (editInfo.field === 'custom_deposit') {
      const amount = parseInt(msg.text.trim(), 10);
      waitingEdit.delete(msg.from.id);
      if (isNaN(amount) || amount < 10000) {
        return bot.sendMessage(msg.chat.id, '⚠️ Số tiền nạp tối thiểu là 10.000đ.');
      }
      await createDepositQR(msg.chat.id, msg.from.id, amount, null);
    }
  });

  console.log('🤖 ' + config.SHOP_NAME + ' đang chạy với đầy đủ tính năng liên kết /categories!');
}

startBot().catch(console.error);
