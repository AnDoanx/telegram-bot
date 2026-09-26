const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const db = require('./database');
const sepay = require('./sepay');

const formatPrice = (price) => (price || 0).toLocaleString('vi-VN') + 'đ';
const isAdmin = (userId) => config.ADMIN_IDS.map(id => id.toString()).includes(userId.toString());
const getFullName = (user) => (user.first_name + (user.last_name ? ' ' + user.last_name : '')).trim();
const ORDER_TIMEOUT_MS = 20 * 60 * 1000;

// Không ép thêm khoảng trắng để tránh vỡ nút trên điện thoại
function cleanLabel(text) {
  return text.trim();
}

const MESSAGES = {
  vi: {
    channel: '📢 Kênh:',
    admin_support: '👑 Hỗ trợ:',
    acc_info: '💳 VÍ TIỀN & TÀI KHOẢN',
    total_deposit: '▫️ Tổng nạp:',
    month_deposit: '▫️ Nạp tháng:',
    balance: '▫️ Số dư ví:',
    choose_category: '📂 <b>DANH MỤC MẶT HÀNG:</b>\n<i>(Chọn danh mục bên dưới để xem hàng)</i>',
    btn_deposit: '💳 Nạp tiền',
    btn_top: '🏆 Top nạp',
    btn_profile: '👤 Tài khoản',
    btn_history: '📜 Lịch sử',
    btn_support: '💬 CSKH',
    btn_change_lang: '🌐 Ngôn ngữ',
    btn_back_cat: '◀️ Danh mục',
    btn_back_home: '◀️ Trang chủ',
    stock_in: 'Còn',
    stock_out: 'Hết',
    buy_wallet: '⚡ Mua bằng VÍ',
    buy_bank: '🏦 Quét VietQR',
    insufficient_balance: 'Số dư ví không đủ! Vui lòng nạp thêm.',
    out_of_stock: 'Mặt hàng đã hết trong kho!',
    order_confirm: '🧾 XÁC NHẬN ĐƠN HÀNG'
  },
  en: {
    channel: '📢 Channel:',
    admin_support: '👑 Support:',
    acc_info: '💳 ACCOUNT OVERVIEW',
    total_deposit: '▫️ Total:',
    month_deposit: '▫️ Month:',
    balance: '▫️ Balance:',
    choose_category: '📂 <b>CATEGORIES:</b>\n<i>(Select a category below to browse)</i>',
    btn_deposit: '💳 Deposit',
    btn_top: '🏆 Top Users',
    btn_profile: '👤 Profile',
    btn_history: '📜 History',
    btn_support: '💬 Support',
    btn_change_lang: '🌐 Language',
    btn_back_cat: '◀️ Categories',
    btn_back_home: '◀️ Main Menu',
    stock_in: 'In Stock',
    stock_out: 'Sold Out',
    buy_wallet: '⚡ Pay via Wallet',
    buy_bank: '🏦 Pay via QR',
    insufficient_balance: 'Insufficient balance! Please deposit.',
    out_of_stock: 'Out of stock!',
    order_confirm: '🧾 CONFIRMATION'
  }
};

// Căn chỉnh tin nhắn trực tiếp không bị vỡ giao diện
async function sendOrEditText(bot, chatId, messageId, text, keyboard) {
  if (messageId) {
    try {
      return await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (_) {
      try { await bot.deleteMessage(chatId, messageId); } catch (e) {}
    }
  }
  return await bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

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
      const sfx = pct > 0 ? ' (giảm ' + pct + '%)' : '';
      if (next) {
        return ' ├ ' + tier.min + ' - ' + (next.min - 1) + ' SP  ➔  <b>' + formatPrice(tier.price) + '</b>/SP' + sfx;
      }
      return ' ╰ Từ ' + tier.min + ' SP  ➔  <b>' + formatPrice(tier.price) + '</b>/SP' + sfx;
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
        ? 'Mua ' + tier.min + ' – ' + (next.min - 1) + ' SP'
        : 'Mua từ ' + tier.min + ' SP trở lên';
      const pct = base > 0 ? Math.round((1 - tier.price / base) * 100) : 0;
      const save = pct > 0 ? ' (giảm ' + pct + '%)' : '';
      return ' ▫️ <b>' + range + ':</b> <code>' + formatPrice(tier.price) + '</code>/sp' + save;
    })
    .join('\n');
}

function productPriceBlockUser(product) {
  if (!product.price_tiers?.length) {
    return '💵 <b>Đơn giá:</b> <code>' + formatPrice(product.price) + '</code> / 1 SP\n';
  }
  return (
    '🏷️ <b>BẢNG GIÁ SỈ:</b>\n' +
    '─────────────────────────\n' +
    formatTierBlockUser(product) +
    '\n─────────────────────────\n'
  );
}

function productPriceBlockAdmin(product) {
  let s = '💵 <b>Giá gốc:</b> <code>' + formatPrice(product.price) + '</code>\n';
  if (product.price_tiers?.length) s += '📊 <b>Bảng giá sỉ:</b>\n' + formatTierBullets(product);
  return s;
}

function adminProductKeyboard(productId) {
  return [
    [{ text: cleanLabel('✏️ Đổi tên'), callback_data: 'adm_edit_name_' + productId }, { text: cleanLabel('💵 Đổi giá'), callback_data: 'adm_edit_price_' + productId }],
    [{ text: cleanLabel('📁 Danh mục'), callback_data: 'adm_change_cat_' + productId }, { text: cleanLabel('📊 Bảng giá sỉ'), callback_data: 'adm_edit_tiers_' + productId }],
    [{ text: cleanLabel('📝 Sửa mô tả'), callback_data: 'adm_edit_desc_' + productId }],
    [{ text: cleanLabel('📥 Nạp stock'), callback_data: 'adm_addstock_' + productId }, { text: cleanLabel('👁️ Xem tồn kho'), callback_data: 'adm_viewstock_' + productId }],
    [{ text: cleanLabel('🗑️ Xóa sản phẩm'), callback_data: 'adm_delete_' + productId }],
    [{ text: cleanLabel('◀️ Về danh sách'), callback_data: 'adm_back_list' }]
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

function notifyAllAdmins(bot, message) {
  config.ADMIN_IDS.forEach(id => {
    bot.sendMessage(id, message, { parse_mode: 'HTML' }).catch(() => {});
  });
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
 Khách hàng:  ${getFullName(userFrom)} (${userId})
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
    caption: 
`╔══════════════════════════════╗
  🎉 <b>GIAO HÀNG THÀNH CÔNG!</b>
╚══════════════════════════════╝
 ├ 📦 <b>Mã đơn:</b> <code>#${orderId}</code>
 ├ 🎁 <b>Mặt hàng:</b> <b>${product.name}</b>
 ├ 🔢 <b>Số lượng:</b> <code>${accounts.length} acc</code>
 ╰ ⏰ <b>Trạng thái:</b> <code>Đã hoàn tất</code>
─────────────────────────
📁 <i>File tài khoản (.txt) đã được đính kèm bên trên!</i>`,
    parse_mode: 'HTML'
  }, { filename, contentType: 'text/plain' });

  let adminAccDetails = '';
  accounts.forEach((acc, i) => {
    const p = parseAccount(acc);
    adminAccDetails += `\n ├ 🔹 <b>Acc ${i + 1}:</b>\n │   👤 TK: <code>${p.user}</code>\n │   🔑 MK: <code>${p.pass || '(Không có)'}</code>`;
  });

  const adminMsg = 
`╔══════════════════════════════╗
  🔔 <b>ĐƠN HÀNG ĐÃ HOÀN TẤT</b>
╚══════════════════════════════╝
 ├ 📦 <b>Mã đơn:</b> <code>#${orderId}</code>
 ├ 👤 <b>Khách hàng:</b> ${getFullName(userFrom)} (<code>${userId}</code>)
 ├ 🎁 <b>Sản phẩm:</b> ${product.name}
 ├ 🔢 <b>Số lượng:</b> ${accounts.length}
 ╰ 💰 <b>Tổng thu:</b> <code>${formatPrice(product.price * accounts.length)}</code>
─────────────────────────
📂 <b>DỮ LIỆU ĐÃ GIAO:</b>${adminAccDetails}`;

  config.ADMIN_IDS.forEach(id => {
    bot.sendMessage(id, adminMsg, { parse_mode: 'HTML' }).catch(() => {});
    bot.sendDocument(id, txtBuffer, { caption: `📁 File đơn #${orderId}` }, { filename, contentType: 'text/plain' }).catch(() => {});
  });
}

function getLanguageKeyboard() {
  return [
    [
      { text: cleanLabel('🇻🇳 Tiếng Việt'), callback_data: 'set_lang_vi' },
      { text: cleanLabel('🇬🇧 English'), callback_data: 'set_lang_en' }
    ]
  ];
}

async function buildMainMenu(userId) {
  let lang = await db.getUserLang(userId) || 'vi';
  const t = MESSAGES[lang] || MESSAGES.vi;

  const balance = await db.getUserBalance(userId);
  const { totalDeposit, monthDeposit } = await db.getUserDepositStats(userId);

  const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  ⚡ <b>${config.SHOP_NAME || 'STORE TỰ ĐỘNG'}</b> ⚡
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
${t.channel} @cloneffgiare
${t.admin_support} @accffgiatot
─────────────────────────
<b>${t.acc_info}</b>
 ${t.total_deposit} <code>${(totalDeposit || 0).toLocaleString('vi-VN')}đ</code>
 ${t.month_deposit} <code>${(monthDeposit || 0).toLocaleString('vi-VN')}đ</code>
 ${t.balance} <code>${(balance || 0).toLocaleString('vi-VN')}đ</code>
─────────────────────────
${t.choose_category}`;

  const categories = await db.getAllCategories();
  const keyboard = [];

  if (categories.length > 0) {
    categories.forEach(c => {
      keyboard.push([{
        text: cleanLabel(`📂 ${c.name} (${c.product_count} SP)`),
        callback_data: 'view_category_' + c.id
      }]);
    });
  } else {
    keyboard.push([{
      text: cleanLabel('⚠️ Đang cập nhật danh mục'),
      callback_data: 'none'
    }]);
  }

  // Chia 2 cột đều tăm tắp, không bị lệch lề
  keyboard.push([
    { text: cleanLabel(t.btn_deposit), callback_data: 'deposit_menu' },
    { text: cleanLabel(t.btn_top), callback_data: 'view_top_deposits' }
  ]);

  keyboard.push([
    { text: cleanLabel(t.btn_profile), callback_data: 'main_profile' },
    { text: cleanLabel(t.btn_history), callback_data: 'main_history' }
  ]);

  const bottomRow = [{ text: cleanLabel(t.btn_change_lang), callback_data: 'change_language' }];
  const adminUser = (config.ADMIN_USER_NAME || '').trim().replace('@', '');
  if (adminUser) {
    bottomRow.push({ text: cleanLabel(t.btn_support), url: 'https://t.me/' + adminUser });
  }
  keyboard.push(bottomRow);

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
    { command: 'start', description: 'Khởi động bot' },
    { command: 'menu', description: 'Mở cửa hàng' }
  ]);

  config.ADMIN_IDS.forEach(adminId => {
    bot.setMyCommands([
      { command: 'categories', description: '📁 Quản lý danh mục' },
      { command: 'products', description: '⚙️ Quản trị sản phẩm' },
      { command: 'orders', description: '📦 Danh sách đơn hàng' },
      { command: 'revenue', description: '📈 Thống kê doanh thu' },
      { command: 'stats', description: '📊 Tồn kho' },
      { command: 'users', description: '👥 Quản lý thành viên' },
      { command: 'broadcast', description: '📣 Thông báo toàn shop' },
      { command: 'setmoney', description: '💵 Chỉnh số dư ví' }
    ], { scope: { type: 'chat', chat_id: adminId } });
  });

  bot.on('polling_error', (err) => console.log('Polling error:', err.message));

  setInterval(async () => {
    if (pendingOrders.size === 0 && pendingDeposits.size === 0) return;

    const now = Date.now();
    const transactions = await sepay.getTransactions();

    for (const [orderId, order] of pendingOrders) {
      if (processingOrders.has(orderId)) continue;
      if (now - order.createdAt > ORDER_TIMEOUT_MS) {
        pendingOrders.delete(orderId);
        await db.updateOrder(orderId, null, 'expired');
        bot.sendMessage(order.chatId, `⏰ Đơn hàng <b>#${orderId}</b> đã hết hạn thanh toán.\n👉 Hãy gõ /menu để mua lại!`, { parse_mode: 'HTML' });
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
`╔══════════════════════════════╗
  🎉 <b>NẠP TIỀN THÀNH CÔNG!</b>
╚══════════════════════════════╝
 ├ ➕ <b>Số tiền:</b> <code>+${formatPrice(dep.amount)}</code>
 ╰ 💳 <b>Số dư mới:</b> <code>${formatPrice(newBal)}</code>
─────────────────────────
👉 <i>Gõ /menu để mua sắm ngay!</i>`, { parse_mode: 'HTML' });

        const adminDepositNotice = 
`╔══════════════════════════════╗
  💰 <b>CÓ GIAO DỊCH NẠP MỚI</b>
╚══════════════════════════════╝
 ├ 👤 <b>Thành viên:</b> <code>${dep.userId}</code>
 ├ 💵 <b>Số tiền nạp:</b> <code>+${formatPrice(dep.amount)}</code>
 ├ 📝 <b>Mã nạp:</b> <code>${dep.content}</code>
 ╰ 💳 <b>Số dư sau nạp:</b> <code>${formatPrice(newBal)}</code>`;
        notifyAllAdmins(bot, adminDepositNotice);
      }
    }
  }, 25000);

  // ==================== LỆNH GIAO DIỆN CHÍNH ====================
  bot.onText(/\/start/, async (msg) => {
    const userId = msg.from.id;
    await db.saveUser(userId, getFullName(msg.from), msg.from.username || '');

    const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  👋 <b>XIN CHÀO ${getFullName(msg.from).toUpperCase()}!</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
Chào mừng bạn đã đến với <b>${config.SHOP_NAME || 'Cửa hàng tự động'}</b>!

🌐 Vui lòng chọn ngôn ngữ để bắt đầu:
<i>Please select your language:</i>`;

    await sendOrEditText(bot, msg.chat.id, null, text, getLanguageKeyboard());
  });

  bot.onText(/\/menu/, async (msg) => {
    const userId = msg.from.id;
    await db.saveUser(userId, getFullName(msg.from), msg.from.username || '');
    const { text, keyboard } = await buildMainMenu(userId);

    await sendOrEditText(bot, msg.chat.id, null, text, keyboard);
  });

  bot.onText(/\/revenue/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const stats = await db.getRevenue();
    const products = await db.getAllProducts();
    let totalStock = 0;
    products.forEach(p => totalStock += p.stock_count);

    const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  📈 <b>BÁO CÁO DOANH THU SHOP</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 💵 <b>Doanh thu:</b> <code>${formatPrice(stats.total_revenue)}</code>
 ├ ✅ <b>Thành công:</b> <code>${stats.total_orders} đơn</code>
 ├ 📦 <b>Mặt hàng:</b> <code>${products.length} loại</code>
 ╰ 🎯 <b>Tồn kho:</b> <code>${totalStock} acc</code>
─────────────────────────
💡 <i>Dữ liệu trích xuất từ database.</i>`;

    await sendOrEditText(bot, msg.chat.id, null, text, []);
  });

  bot.onText(/\/stats/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const products = await db.getAllProducts();
    let text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  📊 <b>BÁO CÁO TỒN KHO</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n`;
    let total = 0;
    products.forEach(p => {
      const status = p.stock_count > 0 ? '🟢' : '🔴';
      text += ` ${status} <b>${p.name}:</b> <code>${p.stock_count}</code> acc\n`;
      total += p.stock_count;
    });
    text += `─────────────────────────\n🎯 <b>Tổng kho:</b> <code>${total}</code> acc`;

    await sendOrEditText(bot, msg.chat.id, null, text, []);
  });

  bot.onText(/\/categories/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const categories = await db.getAllCategories();
    const keyboard = categories.map(c => [{ text: cleanLabel(`📂 ${c.name} (${c.product_count} SP)`), callback_data: `adm_cat_detail_${c.id}` }]);
    keyboard.push([{ text: cleanLabel('➕ Thêm danh mục mới'), callback_data: 'adm_add_cat' }]);

    bot.sendMessage(msg.chat.id, `📁 <b>QUẢN LÝ DANH MỤC THƯ MỤC:</b>\nHiện có <b>${categories.length}</b> danh mục:`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  });

  bot.onText(/\/products/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const products = await db.getAllProducts();
    const keyboard = products.map(p => [{ text: cleanLabel(`📦 #${p.id} ${p.name} (Kho: ${p.stock_count})`), callback_data: 'adm_product_' + p.id }]);
    keyboard.push([{ text: cleanLabel('➕ Thêm sản phẩm mới'), callback_data: 'adm_add_product' }]);
    bot.sendMessage(msg.chat.id, `⚙️ <b>QUẢN TRỊ SẢN PHẨM:</b>\n📊 Tổng cộng: <b>${products.length}</b> mặt hàng.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
  });

  bot.onText(/\/orders/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const orders = await db.getRecentOrders(15);
    if (orders.length === 0) return bot.sendMessage(msg.chat.id, '📦 Hiện chưa có đơn hàng nào!');

    let text = `📦 <b>15 ĐƠN HÀNG GẦN ĐÂY:</b>\n─────────────────────────\n`;
    orders.forEach((o) => {
      const icon = o.status === 'completed' ? '✅' : o.status === 'pending' ? '⏳' : '❌';
      text += `${icon} <b>#${o.id}</b> | <code>${o.user_name}</code>\n ├ 🎁 ${o.product_name} x${o.quantity}\n ╰ 💵 <code>${formatPrice(o.total_price || 0)}</code>\n\n`;
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  bot.onText(/\/users/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const users = await db.getAllUsers();
    let text = `👥 <b>THÀNH VIÊN (${users.length} users):</b>\n─────────────────────────\n`;
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
    bot.sendMessage(msg.chat.id, `✅ Đã chỉnh số dư <code>${targetUserId}</code> thành <b>${formatPrice(amount)}</b>`, { parse_mode: 'HTML' });
  });

  bot.onText(/\/clear/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const chatId = msg.chat.id;
    let deleted = 0;
    bot.sendMessage(chatId, '⏳ Đang dọn dẹp tin nhắn...').then(async (sentMsg) => {
      for (let i = msg.message_id; i > msg.message_id - 50; i--) {
        try {
          await bot.deleteMessage(chatId, i);
          deleted++;
        } catch (e) {}
      }
      try { await bot.deleteMessage(chatId, sentMsg.message_id); } catch (e) {}
      bot.sendMessage(chatId, `🎯 Đã dọn dẹp ${deleted} tin nhắn!`);
    });
  });

  bot.onText(/^\/broadcast$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const users = await db.getAllUsers();
    waitingEdit.set(msg.from.id, { field: 'broadcast' });
    const text = '📣 <b>GỬI TIN THÔNG BÁO TỚI KHÁCH HÀNG</b>\n' +
                 '─────────────────────────\n' +
                 '👥 Sẽ gửi tới: <b>' + users.length + '</b> khách hàng\n\n' +
                 '✏️ Nhắn nội dung thông báo vào đây:';
    bot.sendMessage(msg.chat.id, text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: cleanLabel('❌ Hủy bỏ'), callback_data: 'cancel_broadcast' }]] }
    });
  });

  bot.onText(/\/broadcast (.+)/s, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const content = match[1].trim();
    if (!content) return;

    const users = await db.getAllUsers();
    bot.sendMessage(msg.chat.id, '⏳ Đang gửi thông báo tới ' + users.length + ' người dùng...');

    let sent = 0, failed = 0;
    for (const user of users) {
      try {
        await bot.sendMessage(user.id, `📢 <b>THÔNG BÁO TỪ SHOP:</b>\n\n${content}`, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: cleanLabel('🛒 Mở Menu Cửa Hàng'), callback_data: 'back_main' }]]
          }
        });
        sent++;
      } catch (e) {
        failed++;
      }
    }

    const text = '✅ <b>ĐÃ GỬI THÔNG BÁO HOÀN TẤT</b>\n' +
                 '─────────────────────────\n' +
                 '🎯 Gửi thành công: <b>' + sent + '</b>\n' +
                 '⚠️ Thất bại/Chặn: <b>' + failed + '</b>';
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  async function createDepositQR(chatId, userFrom, amount, oldMessageId) {
    const userTgId = userFrom.id;
    const content = generateCode('NAP');
    const deposit = await db.createDeposit(userTgId, amount, content);
    pendingDeposits.set(deposit.id, { userId: userTgId, amount, content, createdAt: deposit.createdAt });

    const caption = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  💳 <b>YÊU CẦU NẠP TIỀN TỰ ĐỘNG</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 💵 <b>Số tiền:</b> <code>${formatPrice(amount)}</code>
 ├ 🏦 <b>Ngân hàng:</b> <b>${config.BANK_NAME}</b>
 ├ 💳 <b>Số tài khoản:</b> <code>${config.BANK_ACCOUNT}</code>
 ├ 👤 <b>Chủ tài khoản:</b> <b>${config.BANK_OWNER}</b>
 ╰ 📝 <b>Nội dung CK:</b> <code>${content}</code>
─────────────────────────
⚠️ <b>LƯU Ý:</b>
 • Quét mã QR và giữ nguyên nội dung chuyển khoản.
 • Hệ thống tự động duyệt trong 15 - 30 giây.`;

    if (oldMessageId) {
      try { await bot.deleteMessage(chatId, oldMessageId); } catch (_) {}
    }

    await bot.sendPhoto(chatId, getQRUrl(amount, content), {
      caption: caption,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: cleanLabel('◀️ Quay lại Hồ sơ'), callback_data: 'main_profile' }]] }
    });

    const adminMsg = 
`⚡ <b>GIAO DỊCH NẠP CHỜ QUÉT MÃ</b>
─────────────────────────
 ├ 👤 <b>Khách hàng:</b> ${getFullName(userFrom)} (<code>${userTgId}</code>)
 ├ 💵 <b>Số tiền:</b> <code>${formatPrice(amount)}</code>
 ╰ 📝 <b>Nội dung CK:</b> <code>${content}</code>`;
    notifyAllAdmins(bot, adminMsg);
  }

  // ==================== BỘ XỬ LÝ SỰ KIỆN CALLBACK QUERY ====================
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    const messageId = query.message.message_id;

    try {
      if (data === 'none') {
        return bot.answerCallbackQuery(query.id);
      }

      if (data === 'cancel_broadcast') {
        waitingEdit.delete(userId);
        return bot.editMessageText('❌ Đã hủy thao tác thông báo.', { chat_id: chatId, message_id: messageId });
      }

      if (data === 'set_lang_vi' || data === 'set_lang_en') {
        const selectedLang = data === 'set_lang_vi' ? 'vi' : 'en';
        await db.setUserLang(userId, selectedLang);
        const { text, keyboard } = await buildMainMenu(userId);
        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
      }

      if (data === 'main_shop' || data === 'back_main') {
        const { text, keyboard } = await buildMainMenu(userId);
        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
      }

      if (data === 'change_language') {
        const langText = `🌐 <b>LỰA CHỌN NGÔN NGỮ HIỂN THỊ:</b>\n─────────────────────────\n<i>Vui lòng chọn ngôn ngữ bên dưới:</i>`;
        return await sendOrEditText(bot, chatId, messageId, langText, getLanguageKeyboard());
      }

      if (data === 'view_top_deposits') {
        let topList = [];
        if (db.getTopDeposits) {
          topList = await db.getTopDeposits(10);
        }

        let text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  🏆 <b>BẢNG VINH DANH TOP ĐẠI GIA</b> 🏆
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
<i>Tri ân sự tin tưởng và đồng hành của bạn!</i>
─────────────────────────\n`;

        if (topList.length === 0) {
          text += `<i>Chưa có giao dịch nạp nào.</i>`;
        } else {
          topList.forEach((u, idx) => {
            let medal = '▫️';
            if (idx === 0) medal = '🥇';
            else if (idx === 1) medal = '🥈';
            else if (idx === 2) medal = '🥉';

            const userTag = u.username ? `@${u.username}` : `<code>${u.name}</code>`;
            text += `${medal} <b>Top ${idx + 1}:</b> ${userTag}\n   ╰ 💰 <b>Tổng:</b> <code>${formatPrice(u.total)}</code>\n\n`;
          });
        }

        text += `─────────────────────────\n💡 <i>Nạp tiền ngay để vinh danh trên bảng vàng!</i>`;

        const keyboard = [
          [{ text: cleanLabel('💳 Nạp tiền ngay'), callback_data: 'deposit_menu' }],
          [{ text: cleanLabel('◀️ Về Trang Chủ'), callback_data: 'back_main' }]
        ];

        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
      }

      if (data.startsWith('view_category_')) {
        const catId = parseInt(data.split('_')[2]);
        const cat = await db.getCategory(catId);
        const products = await db.getProductsByCategory(catId);
        let lang = await db.getUserLang(userId) || 'vi';
        const t = MESSAGES[lang] || MESSAGES.vi;

        if (products.length === 0) {
          return bot.answerCallbackQuery(query.id, { text: 'Danh mục này tạm thời chưa có hàng!', show_alert: true });
        }

        const keyboard = products.map(p => {
          const stockBadge = p.stock_count > 0 ? `🟢 ${t.stock_in} ${p.stock_count}` : `🔴 ${t.stock_out}`;
          return [{ text: cleanLabel(`💎 ${p.name} ▫️ ${getDisplayPrice(p)} [${stockBadge}]`), callback_data: 'product_' + p.id }];
        });
        keyboard.push([{ text: cleanLabel(t.btn_back_home), callback_data: 'back_main' }]);

        const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  📂 <b>DANH MỤC: ${(cat ? cat.name : 'SẢN PHẨM').toUpperCase()}</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
<i>${cat?.description || 'Chọn mặt hàng bên dưới để tiến hành mua:'}</i>`;

        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
      }

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
            const label = unitPrice < product.price ? '『x' + n + '』 ' + formatPrice(unitPrice) : '『x' + n + '』';
            qtyButtons.push({ text: cleanLabel(label), callback_data: 'qty_' + product.id + '_' + n });
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
          keyboard.push([{ text: cleanLabel('📝 Nhập số lượng khác'), callback_data: 'customqty_' + product.id }]);
        }

        if (product.category_id > 0) {
          keyboard.push([{ text: cleanLabel('◀️ Quay lại danh mục'), callback_data: 'view_category_' + product.category_id }]);
        } else {
          keyboard.push([{ text: cleanLabel(t.btn_back_home), callback_data: 'main_shop' }]);
        }

        const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  🎁 <b>${product.name.toUpperCase()}</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n` +
          productPriceBlockUser(product) +
          '📊 <b>Kho hàng:</b> <code>' + stock + '</code> tài khoản\n' +
          (product.description ? '📝 <b>Mô tả:</b> <i>' + product.description + '</i>\n' : '') +
          '─────────────────────────\n' +
          '👇 <i>Chạm chọn nhanh số lượng muốn mua:</i>';

        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
      }

      if (data.startsWith('customqty_')) {
        const productId = parseInt(data.split('_')[1]);
        const product = await db.getProduct(productId);
        if (!product) return bot.answerCallbackQuery(query.id, { text: 'Sản phẩm không tồn tại!' });
        waitingEdit.set(userId, { field: 'custom_qty', productId, messageId });

        const text = '📝 <b>NHẬP SỐ LƯỢNG MUA</b>\n' +
                     '─────────────────────────\n' +
                     '📦 Mặt hàng: <b>' + product.name + '</b>\n' +
                     productPriceBlockUser(product) +
                     '📊 Kho hiện có: <b>' + product.stock_count + '</b> sp\n\n' +
                     '✏️ <i>Nhập số lượng bạn muốn mua:</i>';

        return await sendOrEditText(bot, chatId, messageId, text, [[{ text: cleanLabel('❌ Hủy bỏ'), callback_data: 'product_' + productId }]]);
      }

      if (data.startsWith('qty_')) {
        const [, productId, quantity] = data.split('_');
        const product = await db.getProduct(parseInt(productId));
        const qty = parseInt(quantity);
        if (product.stock_count < qty) return bot.answerCallbackQuery(query.id, { text: 'Kho không đủ số lượng yêu cầu!', show_alert: true });

        const totalPrice = db.calculatePrice(product, qty);
        const unitPrice = db.getUnitPrice(product, qty);
        const userBalance = await db.getUserBalance(userId);

        const discountInfo = unitPrice < product.price ? '\n ├ 💎 <b>Giá ưu đãi:</b> <code>' + formatPrice(unitPrice) + '/sp</code>' : '';
        const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  🧾 <b>XÁC NHẬN ĐƠN MUA HÀNG</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 🎁 <b>Mặt hàng:</b> <b>${product.name}</b>
 ├ 🔢 <b>Số lượng:</b> <code>${qty} acc</code>${discountInfo}
 ├ 💰 <b>Tổng tiền:</b> <code>${formatPrice(totalPrice)}</code>
 ╰ 💳 <b>Số dư ví:</b> <code>${formatPrice(userBalance)}</code>
─────────────────────────
<i>Chọn hình thức thanh toán bên dưới:</i>`;

        const keyboard = [
          [{ text: cleanLabel('⚡ Mua bằng SỐ DƯ VÍ'), callback_data: `paywallet_${productId}_${qty}` }],
          [{ text: cleanLabel('🏦 Quét mã QR NGÂN HÀNG'), callback_data: `paybank_${productId}_${qty}` }],
          [{ text: cleanLabel('◀️ Thay đổi số lượng'), callback_data: `product_${productId}` }]
        ];

        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
      }

      if (data.startsWith('paywallet_')) {
        const [, productId, quantity] = data.split('_');
        const product = await db.getProduct(parseInt(productId));
        const qty = parseInt(quantity);
        const totalPrice = db.calculatePrice(product, qty);
        const userBalance = await db.getUserBalance(userId);

        if (userBalance < totalPrice) {
          return bot.answerCallbackQuery(query.id, { text: `Số dư ví không đủ! Cần nạp thêm tiền.`, show_alert: true });
        }
        if (product.stock_count < qty) {
          return bot.answerCallbackQuery(query.id, { text: 'Kho vừa hết hàng, xin lỗi quý khách!', show_alert: true });
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
        await bot.deleteMessage(chatId, messageId);
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

        await bot.deleteMessage(chatId, messageId);
        const discountInfo = unitPrice < product.price ? '\n ├ 💎 <b>Ưu đãi:</b> <code>' + formatPrice(unitPrice) + '/sp</code>' : '';
        const caption = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  💳 <b>THANH TOÁN ĐƠN HÀNG #${orderId}</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 🎁 <b>Mặt hàng:</b> <b>${product.name}</b> (x${qty})${discountInfo}
 ├ 💰 <b>Tổng tiền:</b> <code>${formatPrice(totalPrice)}</code>
 ├ 🏦 <b>Ngân hàng:</b> <b>${config.BANK_NAME}</b>
 ├ 💳 <b>STK:</b> <code>${config.BANK_ACCOUNT}</code>
 ├ 👤 <b>Chủ TK:</b> <b>${config.BANK_OWNER}</b>
 ╰ 📝 <b>Nội dung CK:</b> <code>${content}</code>
─────────────────────────
📲 <i>Quét mã QR bên trên để thanh toán tự động.</i>
⚡ <i>Hệ thống tự động phát file tài khoản ngay khi nhận tiền!</i>`;

        await bot.sendPhoto(chatId, getQRUrl(totalPrice, content), {
          caption,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: cleanLabel('🔄 Kiểm tra thanh toán'), callback_data: 'check_' + orderId + '_' + productId + '_' + qty }],
              [{ text: cleanLabel('❌ Hủy đơn này'), callback_data: 'cancel_' + orderId }]
            ]
          }
        });

        const adminOrderAlert = 
`⚡ <b>ĐƠN HÀNG MỚI ĐANG CHỜ QUÉT MÃ QR</b>
─────────────────────────
 ├ 📦 <b>Mã đơn:</b> <code>#${orderId}</code>
 ├ 👤 <b>Khách hàng:</b> ${getFullName(query.from)} (<code>${userId}</code>)
 ├ 🎁 <b>Sản phẩm:</b> ${product.name} (x${qty})
 ├ 💰 <b>Tổng tiền:</b> <code>${formatPrice(totalPrice)}</code>
 ╰ 📝 <b>Nội dung CK:</b> <code>${content}</code>`;
        notifyAllAdmins(bot, adminOrderAlert);
        return;
      }

      if (data.startsWith('check_')) {
        const [, orderId, productId, quantity] = data.split('_');
        const orderIdNum = parseInt(orderId);
        const order = pendingOrders.get(orderIdNum);
        if (!order) return bot.answerCallbackQuery(query.id, { text: 'Đơn hàng không tồn tại hoặc đã xử lý!', show_alert: true });

        if (processingOrders.has(orderIdNum)) {
          return bot.answerCallbackQuery(query.id, { text: '⏳ Đang quét giao dịch ngân hàng, vui lòng đợi...', show_alert: true });
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
          bot.answerCallbackQuery(query.id, { text: 'Chưa thấy giao dịch chuyển khoản. Vui lòng thử lại sau ít giây!', show_alert: true });
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
        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
      }

      if (data === 'main_profile') {
        const orders = await db.getOrdersByUser(userId);
        const completed = orders.filter(o => o.status === 'completed');
        const totalSpent = completed.reduce((sum, o) => sum + (o.total_price || 0), 0);
        const balance = await db.getUserBalance(userId);
        const { totalDeposit, monthDeposit } = await db.getUserDepositStats(userId);

        const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  👤 <b>THÔNG TIN HỒ SƠ TÀI KHOẢN</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 🆔 <b>ID:</b> <code>${userId}</code>
 ├ 🏷️ <b>Họ tên:</b> <b>${getFullName(query.from)}</b>
 ╰ 📧 <b>Username:</b> ${query.from.username ? '@' + query.from.username : '<i>Không có</i>'}
─────────────────────────
💳 <b>TÀI CHÍNH:</b>
 ├ 🏦 <b>Số dư ví:</b> <code>${formatPrice(balance)}</code>
 ├ 🏯 <b>Tổng nạp:</b> <code>${formatPrice(totalDeposit)}</code>
 ╰ 💰 <b>Nạp tháng:</b> <code>${formatPrice(monthDeposit)}</code>
─────────────────────────
📊 <b>GIAO DỊCH:</b>
 ├ 🛍️ <b>Đã mua:</b> <code>${completed.length} đơn</code>
 ╰ 💸 <b>Đã tiêu:</b> <code>${formatPrice(totalSpent)}</code>`;

        const keyboard = [
          [{ text: cleanLabel('💳 Nạp tiền vào ví'), callback_data: 'deposit_menu' }],
          [{ text: cleanLabel('📜 Lịch sử mua hàng'), callback_data: 'main_history' }],
          [{ text: cleanLabel('◀️ Về Trang Chủ'), callback_data: 'back_main' }]
        ];

        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
      }

      if (data === 'deposit_menu') {
        const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  💳 <b>NẠP TIỀN TỰ ĐỘNG VÀO VÍ</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
<i>Hệ thống quét biến động VietQR tự động 24/7.
Chọn mức nạp gợi ý hoặc tự nhập:</i>`;

        const keyboard = [
          [{ text: cleanLabel('💵 20.000đ'), callback_data: 'dep_amt_20000' }, { text: cleanLabel('💵 50.000đ'), callback_data: 'dep_amt_50000' }],
          [{ text: cleanLabel('💵 100.000đ'), callback_data: 'dep_amt_100000' }, { text: cleanLabel('💵 200.000đ'), callback_data: 'dep_amt_200000' }],
          [{ text: cleanLabel('💵 500.000đ'), callback_data: 'dep_amt_500000' }, { text: cleanLabel('✏️ Nhập số khác'), callback_data: 'dep_custom' }],
          [{ text: cleanLabel('◀️ Về Trang Chủ'), callback_data: 'back_main' }]
        ];

        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
      }

      if (data.startsWith('dep_amt_')) {
        const amount = parseInt(data.split('_')[2], 10);
        await createDepositQR(chatId, query.from, amount, messageId);
        return;
      }

      if (data === 'dep_custom') {
        waitingEdit.set(userId, { field: 'custom_deposit', messageId });
        const text = `✏️ <b>NHẬP SỐ TIỀN CẦN NẠP</b>\n─────────────────────────\n<i>Vui lòng nhập số tiền bạn muốn nạp (tối thiểu 10.000đ):</i>`;
        return await sendOrEditText(bot, chatId, messageId, text, [[{ text: cleanLabel('❌ Hủy bỏ'), callback_data: 'deposit_menu' }]]);
      }

      if (data === 'main_history') {
        const orders = await db.getOrderHistory(userId);
        if (orders.length === 0) return bot.answerCallbackQuery(query.id, { text: 'Bạn chưa có lịch sử mua hàng!', show_alert: true });

        let text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  📜 <b>LỊCH SỬ MUA HÀNG GẦN ĐÂY</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n`;
        const keyboard = [];
        orders.slice(0, 8).forEach((o) => {
          const statusIcon = o.status === 'completed' ? '✅' : o.status === 'pending' ? '⏳' : '❌';
          text += `${statusIcon} <b>#${o.id}</b> • <b>${o.product_name}</b> (x${o.quantity || 1}) - <code>${formatPrice(o.total_price)}</code>\n`;
          if (o.status === 'completed' && o.delivered_data) {
            keyboard.push([{ text: cleanLabel(`📥 Nhận file đơn #${o.id} (${o.product_name})`), callback_data: `dl_order_${o.id}` }]);
          }
        });
        keyboard.push([{ text: cleanLabel('◀️ Về Trang Chủ'), callback_data: 'back_main' }]);

        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
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

      // ==================== CALLBACKS ADMIN ====================
      if (isAdmin(userId)) {
        if (data === 'adm_add_cat') {
          waitingEdit.set(userId, { field: 'new_category', messageId });
          const text = '📁 <b>TẠO DANH MỤC MỚI</b>\n─────────────────────────\nNhập cú pháp: <code>Tên|Mô tả</code>\nVí dụ: <code>Acc Free Fire VIP|Nick VIP full skin</code>';
          return await sendOrEditText(bot, chatId, messageId, text, [[{ text: cleanLabel('❌ Hủy'), callback_data: 'adm_back_categories' }]]);
        }

        if (data.startsWith('adm_cat_detail_')) {
          const catId = parseInt(data.split('_')[3]);
          const cat = await db.getCategory(catId);
          if (!cat) return bot.answerCallbackQuery(query.id, { text: 'Danh mục này không tồn tại!' });
          const prods = await db.getProductsByCategory(catId);

          let text = `📂 <b>DANH MỤC: ${cat.name.toUpperCase()}</b>\n📝 <b>Mô tả:</b> <i>${cat.description || 'Chưa cập nhật'}</i>\n📊 <b>Số lượng SP:</b> <b>${prods.length}</b> mặt hàng\n\n`;
          if (prods.length > 0) {
            text += `<i>Danh sách mặt hàng:</i>\n`;
            prods.forEach((p, idx) => {
              text += `${idx + 1}. <b>${p.name}</b> (Kho: ${p.stock_count}) - ${formatPrice(p.price)}\n`;
            });
          } else {
            text += `<i>(Chưa có sản phẩm nào)</i>`;
          }

          const keyboard = [
            [{ text: cleanLabel('➕ Chọn sản phẩm đưa vào'), callback_data: `adm_pick_from_prods_${catId}` }],
            [{ text: cleanLabel('🗑️ Xóa danh mục này'), callback_data: `adm_delcat_${catId}` }],
            [{ text: cleanLabel('◀️ Quay lại danh sách'), callback_data: 'adm_back_categories' }]
          ];

          return await sendOrEditText(bot, chatId, messageId, text, keyboard);
        }

        if (data.startsWith('adm_pick_from_prods_')) {
          const catId = parseInt(data.split('_')[4]);
          const cat = await db.getCategory(catId);
          const allProds = await db.getAllProducts();

          if (allProds.length === 0) {
            return bot.answerCallbackQuery(query.id, { text: 'Chưa có sản phẩm nào! Dùng /products để tạo.', show_alert: true });
          }

          const keyboard = [];
          allProds.forEach(p => {
            const inThisCat = p.category_id === catId;
            const statusIcon = inThisCat ? '✅ [CHỌN]' : '➕ [CHƯA]';
            keyboard.push([{
              text: cleanLabel(`${statusIcon} #${p.id} ${p.name}`),
              callback_data: `adm_toggle_prodcat_${catId}_${p.id}`
            }]);
          });

          keyboard.push([{ text: cleanLabel('◀️ Hoàn tất / Quay lại'), callback_data: `adm_cat_detail_${catId}` }]);

          const text = `📁 <b>PHÂN PHỐI SẢN PHẨM: ${cat.name.toUpperCase()}</b>\n` +
                       `<i>Chạm vào từng mục để thêm vào hoặc gỡ ra khỏi danh mục:</i>`;

          return await sendOrEditText(bot, chatId, messageId, text, keyboard);
        }

        if (data.startsWith('adm_toggle_prodcat_')) {
          const [, , , catIdStr, prodIdStr] = data.split('_');
          const catId = parseInt(catIdStr);
          const prodId = parseInt(prodIdStr);

          const currentProd = await db.getProduct(prodId);
          if (currentProd) {
            const newCatId = currentProd.category_id === catId ? 0 : catId;
            if (db.updateProductCategory) {
              await db.updateProductCategory(prodId, newCatId);
            }
            bot.answerCallbackQuery(query.id, {
              text: newCatId === 0 ? `Đã gỡ #${prodId}!` : `Đã thêm #${prodId}!`
            });
          }

          const cat = await db.getCategory(catId);
          const allProds = await db.getAllProducts();
          const keyboard = [];
          allProds.forEach(p => {
            const inThisCat = p.category_id === catId;
            const statusIcon = inThisCat ? '✅ [CHỌN]' : '➕ [CHƯA]';
            keyboard.push([{
              text: cleanLabel(`${statusIcon} #${p.id} ${p.name}`),
              callback_data: `adm_toggle_prodcat_${catId}_${p.id}`
            }]);
          });
          keyboard.push([{ text: cleanLabel('◀️ Hoàn tất / Quay lại'), callback_data: `adm_cat_detail_${catId}` }]);

          const text = `📁 <b>PHÂN PHỐI SẢN PHẨM: ${cat.name.toUpperCase()}</b>\n` +
                       `<i>Chạm vào từng mục để thêm vào hoặc gỡ ra khỏi danh mục:</i>`;

          return await sendOrEditText(bot, chatId, messageId, text, keyboard);
        }

        if (data.startsWith('adm_delcat_')) {
          const catId = parseInt(data.split('_')[2]);
          await db.deleteCategory(catId);
          bot.answerCallbackQuery(query.id, { text: 'Đã xóa danh mục!' });
          const categories = await db.getAllCategories();
          const keyboard = categories.map(c => [{ text: cleanLabel(`📂 ${c.name} (${c.product_count} SP)`), callback_data: `adm_cat_detail_${c.id}` }]);
          keyboard.push([{ text: cleanLabel('➕ Thêm danh mục mới'), callback_data: 'adm_add_cat' }]);
          return await sendOrEditText(bot, chatId, messageId, '✅ <b>Đã xóa danh mục!</b>\n\n📁 <b>QUẢN LÝ DANH MỤC:</b>', keyboard);
        }

        if (data === 'adm_back_categories') {
          const categories = await db.getAllCategories();
          const keyboard = categories.map(c => [{ text: cleanLabel(`📂 ${c.name} (${c.product_count} SP)`), callback_data: `adm_cat_detail_${c.id}` }]);
          keyboard.push([{ text: cleanLabel('➕ Thêm danh mục mới'), callback_data: 'adm_add_cat' }]);
          return await sendOrEditText(bot, chatId, messageId, '📁 <b>QUẢN LÝ DANH MỤC:</b>', keyboard);
        }

        if (data === 'adm_add_product') {
          const categories = await db.getAllCategories();
          const keyboard = [];

          if (categories.length > 0) {
            categories.forEach(c => {
              keyboard.push([{ text: cleanLabel(`📁 Đưa vào: ${c.name}`), callback_data: `adm_addprodto_${c.id}` }]);
            });
          }
          keyboard.push([{ text: cleanLabel('📦 Mục chung (Không mục)'), callback_data: 'adm_addprodto_0' }]);
          keyboard.push([{ text: cleanLabel('❌ Hủy'), callback_data: 'adm_back_list' }]);

          return await sendOrEditText(bot, chatId, messageId, '📁 <b>BƯỚC 1: Chọn danh mục lưu sản phẩm:</b>', keyboard);
        }

        if (data.startsWith('adm_addprodto_')) {
          const catId = parseInt(data.split('_')[2]);
          waitingEdit.set(userId, { field: 'new_product', categoryId: catId, messageId });
          return await sendOrEditText(bot, chatId, messageId, `➕ <b>BƯỚC 2: NHẬP SẢN PHẨM</b>\n─────────────────────────\nCú pháp: <code>Tên|Giá|Mô tả</code>\nVí dụ: <code>Acc Clone Lv5|25000|Clone sạch</code>`, [[{ text: cleanLabel('❌ Hủy'), callback_data: 'adm_back_list' }]]);
        }

        if (data.startsWith('adm_change_cat_')) {
          const productId = parseInt(data.split('_')[3]);
          const categories = await db.getAllCategories();
          const keyboard = [];

          categories.forEach(c => {
            keyboard.push([{ text: cleanLabel(`📁 Đổi sang: ${c.name}`), callback_data: `adm_apply_cat_${productId}_${c.id}` }]);
          });
          keyboard.push([{ text: cleanLabel('📦 Đổi sang Mục chung'), callback_data: `adm_apply_cat_${productId}_0` }]);
          keyboard.push([{ text: cleanLabel('◀️ Hủy'), callback_data: `adm_product_${productId}` }]);

          return await sendOrEditText(bot, chatId, messageId, '📁 <b>Chọn danh mục mới cho sản phẩm này:</b>', keyboard);
        }

        if (data.startsWith('adm_apply_cat_')) {
          const [, , , productId, catId] = data.split('_');
          if (db.updateProductCategory) {
            await db.updateProductCategory(parseInt(productId), parseInt(catId));
          }
          bot.answerCallbackQuery(query.id, { text: 'Cập nhật danh mục thành công!' });
          return await sendOrEditText(bot, chatId, messageId, `✅ Đã chuyển sản phẩm #${productId} sang danh mục mới!`, [[{ text: cleanLabel('◀️ Về thông tin SP'), callback_data: 'adm_product_' + productId }]]);
        }

        if (data.startsWith('adm_product_')) {
          const productId = parseInt(data.split('_')[2]);
          const product = await db.getProduct(productId);
          if (!product) return bot.answerCallbackQuery(query.id, { text: 'Sản phẩm không tồn tại!' });
          const stocks = await db.getStockByProduct(productId);
          const available = stocks.filter(s => !s.is_sold).length;
          const sold = stocks.length - available;

          let catName = 'Mục chung';
          if (product.category_id > 0) {
            const cat = await db.getCategory(product.category_id);
            if (cat) catName = cat.name;
          }

          const text = '📦 <b>' + product.name + '</b> (#' + product.id + ')\n' +
                       '📁 Danh mục: <b>' + catName + '</b>\n' +
                       '─────────────────────────\n' +
                       productPriceBlockAdmin(product) +
                       '📝 <b>Mô tả:</b> ' + (product.description || 'Chưa cập nhật') + '\n\n' +
                       '📊 <b>TỒN KHO:</b> 🟢 ' + available + ' còn │ 🔴 ' + sold + ' đã bán';

          return await sendOrEditText(bot, chatId, messageId, text, adminProductKeyboard(productId));
        }

        if (data.startsWith('adm_edit_tiers_')) {
          const productId = parseInt(data.split('_')[3]);
          const product = await db.getProduct(productId);
          waitingEdit.set(userId, { productId, field: 'tiers', messageId });

          let currentTiers = 'Chưa cài đặt';
          if (product.price_tiers && product.price_tiers.length > 0) {
            currentTiers = product.price_tiers.map(t => t.min + ':' + t.price).join(', ');
          }

          const text = '📊 <b>CÀI ĐẶT BẢNG GIÁ SỈ</b>\n' +
                       '─────────────────────────\n' +
                       '📦 Mặt hàng: <b>' + product.name + '</b>\n' +
                       '💰 Giá bán lẻ: <code>' + formatPrice(product.price) + '</code>\n' +
                       '📋 Đang áp dụng: <code>' + currentTiers + '</code>\n\n' +
                       '📝 Cú pháp:\n' +
                       '<code>SốLượng:Giá, SốLượng:Giá, ...</code>\n\n' +
                       '▸ Ví dụ: <code>1:50000, 10:45000, 20:40000</code>\n\n' +
                       '💡 <i>Nhập <b>xoa</b> để hủy bỏ giá sỉ.</i>';
          return await sendOrEditText(bot, chatId, messageId, text, [[{ text: cleanLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]]);
        }

        if (data.startsWith('adm_edit_name_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'name', messageId });
          return await sendOrEditText(bot, chatId, messageId, '✏️ Nhập tên mới cho sản phẩm #' + productId + ':', [[{ text: cleanLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]]);
        }

        if (data.startsWith('adm_edit_price_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'price', messageId });
          return await sendOrEditText(bot, chatId, messageId, '💵 Nhập giá mới (VNĐ) cho sản phẩm #' + productId + ':', [[{ text: cleanLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]]);
        }

        if (data.startsWith('adm_edit_desc_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'desc', messageId });
          return await sendOrEditText(bot, chatId, messageId, '📝 Nhập mô tả mới cho sản phẩm #' + productId + ':', [[{ text: cleanLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]]);
        }

        if (data.startsWith('adm_addstock_')) {
          const productId = parseInt(data.split('_')[2]);
          const product = await db.getProduct(productId);
          waitingStock.set(userId, productId);
          return await sendOrEditText(bot, chatId, messageId, '➕ <b>NẠP STOCK CHO: ' + product.name + '</b>\n\n<i>Gửi danh sách tài khoản (mỗi acc 1 dòng):</i>', [[{ text: cleanLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]]);
        }

        if (data.startsWith('adm_viewstock_')) {
          const productId = parseInt(data.split('_')[2]);
          const product = await db.getProduct(productId);
          const stocks = await db.getStockByProduct(productId);
          const available = stocks.filter(s => !s.is_sold);
          let text = '📦 <b>' + product.name + '</b>\n\n🎯 Khả dụng: <b>' + available.length + '</b> | ✖️ Đã bán: <b>' + (stocks.length - available.length) + '</b>\n─────────────────────────\n';
          const keyboard = [];
          if (available.length > 0) {
            text += '<i>Danh sách tài khoản (bấm để xóa):</i>\n';
            available.slice(0, 10).forEach((s, i) => {
              text += `${i + 1}. <code>${s.account_data}</code>\n`;
              keyboard.push([{ text: cleanLabel('🗑️ Xóa: ' + s.account_data.substring(0, 25) + '...'), callback_data: 'adm_delstock_' + productId + '_' + s.id }]);
            });
            if (available.length > 10) text += '... và <b>' + (available.length - 10) + '</b> tài khoản khác.\n';
            keyboard.push([{ text: cleanLabel('🗑️ Xóa TẤT CẢ tồn kho'), callback_data: 'adm_clearstock_' + productId }]);
          } else {
            text += '✖️ Hiện tại kho đang trống!';
          }
          keyboard.push([{ text: cleanLabel('➕ Nạp thêm stock'), callback_data: 'adm_addstock_' + productId }]);
          keyboard.push([{ text: cleanLabel('◀️ Quay lại'), callback_data: 'adm_product_' + productId }]);
          return await sendOrEditText(bot, chatId, messageId, text, keyboard);
        }

        if (data.startsWith('adm_delstock_')) {
          const parts = data.split('_');
          const productId = parseInt(parts[2]);
          const stockId = parseInt(parts[3]);
          await db.deleteStock(stockId);
          bot.answerCallbackQuery(query.id, { text: 'Đã xóa tài khoản!' });
          const product = await db.getProduct(productId);
          const stocks = await db.getStockByProduct(productId);
          const available = stocks.filter(s => !s.is_sold);
          let text = '📦 <b>' + product.name + '</b>\n\n🎯 Khả dụng: <b>' + available.length + '</b> | ✖️ Đã bán: <b>' + (stocks.length - available.length) + '</b>\n─────────────────────────\n';
          const keyboard = [];
          if (available.length > 0) {
            text += '<i>Danh sách tài khoản (bấm để xóa):</i>\n';
            available.slice(0, 10).forEach((s, i) => {
              text += `${i + 1}. <code>${s.account_data}</code>\n`;
              keyboard.push([{ text: cleanLabel('🗑️ Xóa: ' + s.account_data.substring(0, 25) + '...'), callback_data: 'adm_delstock_' + productId + '_' + s.id }]);
            });
            keyboard.push([{ text: cleanLabel('🗑️ Xóa TẤT CẢ tồn kho'), callback_data: 'adm_clearstock_' + productId }]);
          }
          keyboard.push([{ text: cleanLabel('➕ Nạp thêm stock'), callback_data: 'adm_addstock_' + productId }]);
          keyboard.push([{ text: cleanLabel('◀️ Quay lại'), callback_data: 'adm_product_' + productId }]);
          return await sendOrEditText(bot, chatId, messageId, text, keyboard);
        }

        if (data.startsWith('adm_clearstock_')) {
          const productId = parseInt(data.split('_')[2]);
          await db.clearStock(productId);
          bot.answerCallbackQuery(query.id, { text: 'Đã làm sạch kho!' });
          return await sendOrEditText(bot, chatId, messageId, `🎯 Đã xóa sạch toàn bộ acc của sản phẩm #${productId}.`, [[{ text: cleanLabel('◀️ Quay lại'), callback_data: 'adm_product_' + productId }]]);
        }

        if (data.startsWith('adm_delete_')) {
          const productId = parseInt(data.split('_')[2]);
          await db.deleteProduct(productId);
          bot.answerCallbackQuery(query.id, { text: 'Đã xóa sản phẩm!' });
          return await sendOrEditText(bot, chatId, messageId, `🗑️ Đã xóa hoàn toàn mặt hàng #${productId}.`, [[{ text: cleanLabel('◀️ Về kho hàng'), callback_data: 'adm_back_list' }]]);
        }

        if (data === 'adm_back_list') {
          const products = await db.getAllProducts();
          const keyboard = products.map(p => [{ text: cleanLabel(`📦 #${p.id} ${p.name} (Kho: ${p.stock_count})`), callback_data: 'adm_product_' + p.id }]);
          keyboard.push([{ text: cleanLabel('➕ Thêm sản phẩm mới'), callback_data: 'adm_add_product' }]);
          return await sendOrEditText(bot, chatId, messageId, '⚙️ <b>QUẢN TRỊ SẢN PHẨM:</b>', keyboard);
        }
      }

    } catch (e) {
      console.log('Callback error:', e.message);
    }
    bot.answerCallbackQuery(query.id).catch(() => {});
  });

  // ==================== BỘ NHẬN TIN NHẮN TỪ KHÁCH & ADMIN ====================
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/') || !isAdmin(msg.from.id)) return;

    const pid = waitingStock.get(msg.from.id);
    if (pid) {
      const accs = msg.text.split('\n').filter(a => a.trim());
      for (const acc of accs) {
        await db.addStock(pid, acc.trim());
      }
      waitingStock.delete(msg.from.id);
      const product = await db.getProduct(pid);

      bot.sendMessage(msg.chat.id, `✅ <b>Đã nhập thành công ${accs.length} tài khoản vào kho!</b>\n📢 Đang gửi thông báo hàng về tới khách hàng...`, { parse_mode: 'HTML' });

      const alertMsg = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  🔥 <b>THÔNG BÁO HÀNG VỀ (RESTOCK)</b> 🔥
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 📦 <b>Mặt hàng:</b> <b>${product.name}</b>
 ├ ➕ <b>Vừa nhập:</b> <code>+${accs.length} acc</code>
 ╰ 💰 <b>Giá bán:</b> <code>${formatPrice(product.price)}</code>
─────────────────────────
⚡ <i>Số lượng có hạn, nhanh tay vào mua ngay!</i>`;
      
      const users = await db.getAllUsers();
      for (const u of users) {
        bot.sendMessage(u.id, alertMsg, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: cleanLabel('🛒 Mua Ngay'), callback_data: 'back_main' }]] }
        }).catch(() => {});
      }
      return;
    }

    const editInfo = waitingEdit.get(msg.from.id);
    if (!editInfo) return;

    if (editInfo.field === 'broadcast') {
      waitingEdit.delete(msg.from.id);
      const users = await db.getAllUsers();
      let sent = 0, failed = 0;

      bot.sendMessage(msg.chat.id, '⏳ Đang gửi thông báo đến ' + users.length + ' khách hàng...');

      for (const user of users) {
        try {
          await bot.sendMessage(user.id, `📢 <b>THÔNG BÁO TỪ SHOP:</b>\n\n${msg.text}`, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: cleanLabel('🛒 Mở Cửa Hàng'), callback_data: 'back_main' }]]
            }
          });
          sent++;
        } catch (e) {
          failed++;
        }
      }

      const text = '✅ <b>ĐÃ HOÀN TẤT CHIẾN DỊCH THÔNG BÁO</b>\n' +
                   '─────────────────────────\n' +
                   '🎯 Gửi thành công: <b>' + sent + '</b>\n' +
                   '⚠️ Thất bại/Chặn: <b>' + failed + '</b>';
      return bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
    }

    if (editInfo.field === 'new_category') {
      const parts = msg.text.split('|').map(s => s.trim());
      const name = parts[0];
      const desc = parts[1] || '';
      if (!name) return bot.sendMessage(msg.chat.id, '⚠️ Tên danh mục không được để trống!');

      await db.addCategory(name, desc);
      waitingEdit.delete(msg.from.id);
      return bot.sendMessage(msg.chat.id, `✅ Đã tạo mới danh mục: <b>${name}</b> thành công!\nGõ /categories để kiểm tra.`, { parse_mode: 'HTML' });
    }

    if (editInfo.field === 'new_product') {
      const parts = msg.text.split('|').map(s => s.trim());
      const name = parts[0];
      const price = parseInt(parts[1], 10);
      const desc = parts.slice(2).join('|') || '';

      if (!name || isNaN(price)) return bot.sendMessage(msg.chat.id, '⚠️ Cú pháp: <code>Tên|Giá|Mô tả</code>', { parse_mode: 'HTML' });

      const res = await db.addProduct(name, price, desc, editInfo.categoryId || 0);
      waitingEdit.delete(msg.from.id);

      bot.sendMessage(msg.chat.id, `✅ Đã thêm mặt hàng <b>${name}</b> (#${res.lastInsertRowid})!\n📢 Đang gửi thông báo tới khách hàng...`, { parse_mode: 'HTML' });

      const newProductAlert = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  🎉 <b>MẶT HÀNG MỚI ĐÃ LÊN KỆ!</b> 🎉
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 🎁 <b>Mặt hàng:</b> <b>${name}</b>
 ├ 💵 <b>Đơn giá:</b> <code>${formatPrice(price)}</code>
 ╰ 📝 <b>Mô tả:</b> <i>${desc || 'Hàng chất lượng, bảo hành uy tín!'}</i>
─────────────────────────
👉 <i>Bấm vào nút bên dưới để đặt mua ngay!</i>`;
      
      const users = await db.getAllUsers();
      for (const u of users) {
        bot.sendMessage(u.id, newProductAlert, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: cleanLabel('🛒 Mua Ngay'), callback_data: 'back_main' }]] }
        }).catch(() => {});
      }
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
      if (isNaN(priceNum) || priceNum < 0) return bot.sendMessage(msg.chat.id, '✖️ Giá tiền không hợp lệ!');
      newPrice = priceNum;
    } else if (editInfo.field === 'desc') newDesc = msg.text.trim();
    else if (editInfo.field === 'tiers') {
      const input = msg.text.trim().toLowerCase();
      if (input === 'xoa' || input === 'xóa') {
        await db.updatePriceTiers(editInfo.productId, null);
        waitingEdit.delete(msg.from.id);
        return bot.sendMessage(msg.chat.id, '✅ Đã xóa toàn bộ bảng giá sỉ!\n\nGõ /products để quản lý.');
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
      return bot.sendMessage(msg.chat.id, '✅ Đã lưu cấu hình bảng giá sỉ!\n\nGõ /products để kiểm tra.');
    }

    await db.updateProduct(editInfo.productId, newName, newPrice, newDesc);
    waitingEdit.delete(msg.from.id);
    return bot.sendMessage(msg.chat.id, `✅ Đã lưu thay đổi cho sản phẩm #${editInfo.productId}!`);
  });

  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const editInfo = waitingEdit.get(msg.from.id);
    if (!editInfo) return;

    if (editInfo.field === 'custom_qty') {
      const qty = parseInt(msg.text.trim());
      const product = await db.getProduct(editInfo.productId);

      if (!product) {
        waitingEdit.delete(msg.from.id);
        return bot.sendMessage(msg.chat.id, '✖️ Mặt hàng không còn tồn tại!');
      }

      if (isNaN(qty) || qty < 1) {
        return bot.sendMessage(msg.chat.id, '✖️ Số lượng không hợp lệ! Vui lòng nhập số nguyên > 0.');
      }

      if (qty > product.stock_count) {
        return bot.sendMessage(msg.chat.id, '✖️ Kho không đủ hàng! Chỉ còn ' + product.stock_count + ' sản phẩm khả dụng.');
      }

      waitingEdit.delete(msg.from.id);

      const totalPrice = db.calculatePrice(product, qty);
      const unitPrice = db.getUnitPrice(product, qty);
      const userBalance = await db.getUserBalance(msg.from.id);
      const discountInfo = unitPrice < product.price ? '\n ├ 💎 <b>Ưu đãi:</b> <code>' + formatPrice(unitPrice) + '/sp</code>' : '';

      const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  🧾 <b>XÁC NHẬN ĐƠN MUA HÀNG</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 🎁 <b>Mặt hàng:</b> <b>${product.name}</b>
 ├ 🔢 <b>Số lượng:</b> <code>${qty} acc</code>${discountInfo}
 ├ 💰 <b>Tổng tiền:</b> <code>${formatPrice(totalPrice)}</code>
 ╰ 💳 <b>Số dư ví:</b> <code>${formatPrice(userBalance)}</code>
─────────────────────────
<i>Chọn hình thức thanh toán bên dưới:</i>`;

      const keyboard = [
        [{ text: cleanLabel('⚡ Mua bằng SỐ DƯ VÍ'), callback_data: `paywallet_${editInfo.productId}_${qty}` }],
        [{ text: cleanLabel('🏦 Quét mã QR NGÂN HÀNG'), callback_data: `paybank_${editInfo.productId}_${qty}` }],
        [{ text: cleanLabel('◀️ Thay đổi số lượng'), callback_data: `product_${editInfo.productId}` }]
      ];

      return bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
    }

    if (editInfo.field === 'custom_deposit') {
      const amount = parseInt(msg.text.trim(), 10);
      waitingEdit.delete(msg.from.id);
      if (isNaN(amount) || amount < 10000) {
        return bot.sendMessage(msg.chat.id, '⚠️ Số tiền nạp tối thiểu là 10.000đ.');
      }
      await createDepositQR(msg.chat.id, msg.from, amount, null);
    }
  });

  console.log('🤖 ' + config.SHOP_NAME + ' đang chạy với giao diện chuẩn gọn gàng!');
}

startBot().catch(console.error);
