const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const db = require('./database');
const sepay = require('./sepay');

// ==================== CẤU HÌNH BANNER ẢNH (DÙNG LINK TRỰC TIẾP .JPG/.PNG) ====================
// Bạn có thể thay link ảnh của bạn vào đây (up lên catbox.moe hoặc postimages.org)
const IMAGES = {
  START: 'https://files.catbox.moe/w8l66z.jpg',
  MAIN_MENU: 'https://files.catbox.moe/w8l66z.jpg',
  PROFILE: 'https://files.catbox.moe/w8l66z.jpg',
  DEPOSIT: 'https://files.catbox.moe/w8l66z.jpg',
  TOP: 'https://files.catbox.moe/w8l66z.jpg',
  REVENUE: 'https://files.catbox.moe/w8l66z.jpg',
  STATS: 'https://files.catbox.moe/w8l66z.jpg',
  RESTOCK: 'https://files.catbox.moe/w8l66z.jpg',
  NEW_PROD: 'https://files.catbox.moe/w8l66z.jpg'
};

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
    channel: '📢 Kênh Official:',
    admin_support: '👑 CSKH Hỗ Trợ:',
    acc_info: '💳 THÔNG TIN TÀI CHÍNH',
    total_deposit: '🏯 Tổng nạp tích lũy:',
    month_deposit: '💰 Nạp trong tháng:',
    balance: '🏦 Số dư khả dụng:',
    choose_category: '📂 <b>DANH MỤC MẶT HÀNG SẴN CÓ:</b>\n<i>(Chạm chọn danh mục phía dưới để xem chi tiết)</i>',
    btn_deposit: '💳 Nạp tiền ví',
    btn_top: '🏆 Bảng vàng Top',
    btn_profile: '👤 Hồ sơ của tôi',
    btn_history: '📜 Lịch sử mua hàng',
    btn_support: '💬 CSKH 24/7',
    btn_change_lang: '🌐 Ngôn ngữ',
    btn_back_cat: '◀️ Quay lại danh mục',
    btn_back_home: '◀️ Về Trang Chủ',
    stock_in: 'Còn',
    stock_out: 'Hết',
    buy_wallet: '⚡ Mua bằng SỐ DƯ VÍ',
    buy_bank: '🏦 Quét mã QR NGÂN HÀNG',
    insufficient_balance: 'Số dư ví không đủ! Vui lòng nạp thêm.',
    out_of_stock: 'Mặt hàng đã hết trong kho!',
    order_confirm: '🧾 XÁC NHẬN ĐƠN HÀNG'
  },
  en: {
    channel: '📢 Official Channel:',
    admin_support: '👑 Admin Support:',
    acc_info: '💳 FINANCIAL OVERVIEW',
    total_deposit: '🏯 Total Deposit:',
    month_deposit: '💰 Month Spend:',
    balance: '🏦 Wallet Balance:',
    choose_category: '📂 <b>AVAILABLE CATEGORIES:</b>\n<i>(Select a category below to browse items)</i>',
    btn_deposit: '💳 Deposit',
    btn_top: '🏆 Top Donors',
    btn_profile: '👤 My Profile',
    btn_history: '📜 Order History',
    btn_support: '💬 Support 24/7',
    btn_change_lang: '🌐 Language',
    btn_back_cat: '◀️ Back to Categories',
    btn_back_home: '◀️ Main Menu',
    stock_in: 'Stock',
    stock_out: 'Sold Out',
    buy_wallet: '⚡ Pay via WALLET BALANCE',
    buy_bank: '🏦 Pay via BANK QR CODE',
    insufficient_balance: 'Insufficient balance! Please top up your wallet.',
    out_of_stock: 'This product is currently out of stock!',
    order_confirm: '🧾 ORDER CONFIRMATION'
  }
};

// ==================== BỘ GỬI GIAO DIỆN TỰ ĐỘNG CHỐNG CRASH ====================
async function renderSafe(bot, chatId, messageId, photoUrl, text, keyboard) {
  try {
    if (photoUrl) {
      if (messageId) {
        try {
          return await bot.editMessageMedia({
            type: 'photo',
            media: photoUrl,
            caption: text,
            parse_mode: 'HTML'
          }, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard }
          });
        } catch (_) {
          try { await bot.deleteMessage(chatId, messageId); } catch (e) {}
        }
      }
      return await bot.sendPhoto(chatId, photoUrl, {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    }
  } catch (err) {
    console.log('Tải ảnh lỗi, chuyển sang text thuần:', err.message);
  }

  // Fallback sang tin nhắn text viền đẹp nếu tải ảnh thất bại
  if (messageId) {
    try {
      return await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (_) {}
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
      const sfx = pct > 0 ? '  (giảm ' + pct + '%)' : '';
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
        ? 'Mua từ ' + tier.min + ' đến ' + (next.min - 1) + ' SP'
        : 'Mua từ ' + tier.min + ' SP trở lên';
      const pct = base > 0 ? Math.round((1 - tier.price / base) * 100) : 0;
      const save = pct > 0 ? '\n   └ 🔥 Tiết kiệm ' + pct + '% (Gốc: ' + formatPrice(base) + ')' : '';
      return ' ▫️ <b>' + range + '</b>\n   ➔ Đơn giá: <code>' + formatPrice(tier.price) + '</code>' + save;
    })
    .join('\n\n');
}

function productPriceBlockUser(product) {
  if (!product.price_tiers?.length) {
    return '💵 <b>Đơn giá:</b> <code>' + formatPrice(product.price) + '</code> / 1 sản phẩm\n';
  }
  return (
    '🏷️ <b>BẢNG GIÁ ƯU ĐÃI SỈ:</b>\n' +
    '───────────────────────────\n' +
    formatTierBlockUser(product) +
    '\n───────────────────────────\n'
  );
}

function productPriceBlockAdmin(product) {
  let s = '💵 <b>Giá niêm yết:</b> <code>' + formatPrice(product.price) + '</code>\n';
  if (product.price_tiers?.length) s += '📊 <b>Bảng giá sỉ:</b>\n' + formatTierBullets(product);
  return s;
}

function adminProductKeyboard(productId) {
  return [
    [{ text: wideInlineLabel('✏️ Đổi tên'), callback_data: 'adm_edit_name_' + productId }, { text: wideInlineLabel('💵 Đổi giá'), callback_data: 'adm_edit_price_' + productId }],
    [{ text: wideInlineLabel('📁 Gán danh mục'), callback_data: 'adm_change_cat_' + productId }, { text: wideInlineLabel('📊 Cài giá sỉ'), callback_data: 'adm_edit_tiers_' + productId }],
    [{ text: wideInlineLabel('📝 Sửa mô tả'), callback_data: 'adm_edit_desc_' + productId }],
    [{ text: wideInlineLabel('📥 Thêm stock'), callback_data: 'adm_addstock_' + productId }, { text: wideInlineLabel('👁️ Xem kho tồn'), callback_data: 'adm_viewstock_' + productId }],
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

function notifyAllAdmins(bot, message) {
  config.ADMIN_IDS.forEach(id => {
    bot.sendMessage(id, message, { parse_mode: 'HTML' }).catch(() => {});
  });
}

async function deliverOrder(bot, orderId, chatId, userId, userFrom, product, accounts) {
  const accListRaw = accounts.join('\n');
  await db.updateOrder(orderId, null, 'completed', accListRaw);

  const txtContent = 
`╔══════════════════════════════════════════════════╗
             HÓA ĐƠN GIAO DỊCH TÀI KHOẢN           
╚══════════════════════════════════════════════════╝
 Mã đơn hàng: #${orderId}
 Mặt hàng:    ${product.name}
 Số lượng:    ${accounts.length}
 Người nhận:  ${getFullName(userFrom)} (${userId})
 Thời gian:   ${new Date().toLocaleString('vi-VN')}
────────────────────────────────────────────────────
 DANH SÁCH DỮ LIỆU ĐÃ GIAO:
${accounts.map((acc, i) => `[${i + 1}] ${acc}`).join('\n')}
────────────────────────────────────────────────────
 Cảm ơn bạn đã lựa chọn sử dụng dịch vụ của shop!
════════════════════════════════════════════════════`;

  const txtBuffer = Buffer.from(txtContent, 'utf-8');
  const filename = `Order_${orderId}.txt`;

  await bot.sendDocument(chatId, txtBuffer, {
    caption: 
`╔══════════════════════════════╗
  🎉 <b>GIAO HÀNG THÀNH CÔNG!</b>
╚══════════════════════════════╝
 ├ 📦 <b>Mã đơn hàng:</b> <code>#${orderId}</code>
 ├ 🎁 <b>Mặt hàng:</b> <b>${product.name}</b>
 ├ 🔢 <b>Số lượng:</b> <code>${accounts.length} acc</code>
 ╰ ⏰ <b>Trạng thái:</b> <code>Hoàn tất</code>
───────────────────────────
📁 <i>File .txt chứa tài khoản đã được gửi đính kèm ở trên!</i>`,
    parse_mode: 'HTML'
  }, { filename, contentType: 'text/plain' });

  let adminAccDetails = '';
  accounts.forEach((acc, i) => {
    const p = parseAccount(acc);
    adminAccDetails += `\n ├ 🔹 <b>Acc ${i + 1}:</b>\n │   👤 TK: <code>${p.user}</code>\n │   🔑 MK: <code>${p.pass || '(Không có)'}</code>`;
  });

  const adminMsg = 
`╔══════════════════════════════╗
  🔔 <b>ĐƠN HÀNG MỚI ĐÃ BÁN</b>
╚══════════════════════════════╝
 ├ 📦 <b>Mã đơn:</b> <code>#${orderId}</code>
 ├ 👤 <b>Khách hàng:</b> ${getFullName(userFrom)} (<code>${userId}</code>)
 ├ 🎁 <b>Sản phẩm:</b> ${product.name}
 ├ 🔢 <b>Số lượng:</b> ${accounts.length}
 ╰ 💰 <b>Tổng thu:</b> <code>${formatPrice(product.price * accounts.length)}</code>
───────────────────────────
📂 <b>DỮ LIỆU ĐÃ GIAO KHÁCH:</b>${adminAccDetails}`;

  config.ADMIN_IDS.forEach(id => {
    bot.sendMessage(id, adminMsg, { parse_mode: 'HTML' }).catch(() => {});
    bot.sendDocument(id, txtBuffer, { caption: `📁 Backup đơn #${orderId}` }, { filename, contentType: 'text/plain' }).catch(() => {});
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
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  ⚡ <b>${config.SHOP_NAME || 'STORE DỊCH VỤ TỰ ĐỘNG'}</b> ⚡
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
${t.channel} @cloneffgiare
${t.admin_support} @accffgiatot
───────────────────────────
<b>${t.acc_info}</b>
 ├ ${t.total_deposit} <code>${(totalDeposit || 0).toLocaleString('vi-VN')}đ</code>
 ├ ${t.month_deposit} <code>${(monthDeposit || 0).toLocaleString('vi-VN')}đ</code>
 ╰ ${t.balance}  <code>${(balance || 0).toLocaleString('vi-VN')}đ</code>
───────────────────────────
${t.choose_category}`;

  const categories = await db.getAllCategories();
  const keyboard = [];

  if (categories.length > 0) {
    categories.forEach(c => {
      keyboard.push([{
        text: wideInlineLabel(`📂 ${c.name} (${c.product_count} SP)`),
        callback_data: 'view_category_' + c.id
      }]);
    });
  } else {
    keyboard.push([{
      text: wideInlineLabel('⚠️ Đang bảo trì danh mục'),
      callback_data: 'none'
    }]);
  }

  keyboard.push([
    { text: wideInlineLabel(t.btn_deposit), callback_data: 'deposit_menu' },
    { text: wideInlineLabel(t.btn_top), callback_data: 'view_top_deposits' }
  ]);

  keyboard.push([
    { text: wideInlineLabel(t.btn_profile), callback_data: 'main_profile' },
    { text: wideInlineLabel(t.btn_history), callback_data: 'main_history' }
  ]);

  keyboard.push([
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
    { command: 'start', description: 'Khởi động & Ngôn ngữ' },
    { command: 'menu', description: 'Menu cửa hàng' }
  ]);

  config.ADMIN_IDS.forEach(adminId => {
    bot.setMyCommands([
      { command: 'categories', description: '📁 Quản lý danh mục' },
      { command: 'products', description: '⚙️ Quản lý sản phẩm' },
      { command: 'orders', description: '📦 Danh sách đơn hàng' },
      { command: 'revenue', description: '📈 Thống kê doanh thu' },
      { command: 'stats', description: '📊 Kiểm tra tồn kho' },
      { command: 'users', description: '👥 Quản lý thành viên' },
      { command: 'broadcast', description: '📣 Gửi thông báo toàn shop' },
      { command: 'setmoney', description: '💵 Sửa số dư ví user' }
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
        bot.sendMessage(order.chatId, `⏰ Đơn hàng <b>#${orderId}</b> đã bị hủy do hết hạn thanh toán.\n👉 Dùng /menu để đặt lại!`, { parse_mode: 'HTML' });
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
 ├ ➕ <b>Số tiền nạp:</b>  <code>+${formatPrice(dep.amount)}</code>
 ╰ 💳 <b>Số dư ví mới:</b> <code>${formatPrice(newBal)}</code>
───────────────────────────
👉 <i>Gõ /menu để vào mua hàng ngay!</i>`, { parse_mode: 'HTML' });

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

    const caption = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  👋 <b>XIN CHÀO ${getFullName(msg.from).toUpperCase()}!</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
Chào mừng bạn đã đến với <b>${config.SHOP_NAME || 'Cửa hàng tự động'}</b>!

🌐 Vui lòng chọn ngôn ngữ để bắt đầu:
<i>Please select your language:</i>`;

    await renderSafe(bot, msg.chat.id, null, IMAGES.START, caption, getLanguageKeyboard());
  });

  bot.onText(/\/menu/, async (msg) => {
    const userId = msg.from.id;
    await db.saveUser(userId, getFullName(msg.from), msg.from.username || '');
    const { text, keyboard } = await buildMainMenu(userId);

    await renderSafe(bot, msg.chat.id, null, IMAGES.MAIN_MENU, text, keyboard);
  });

  bot.onText(/\/revenue/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const stats = await db.getRevenue();
    const products = await db.getAllProducts();
    let totalStock = 0;
    products.forEach(p => totalStock += p.stock_count);

    const caption = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  📈 <b>BÁO CÁO DOANH THU HỆ THỐNG</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 💵 <b>Tổng doanh thu:</b> <code>${formatPrice(stats.total_revenue)}</code>
 ├ ✅ <b>Đơn hoàn tất:</b> <code>${stats.total_orders} đơn</code>
 ├ 📦 <b>Phân loại SP:</b>  <code>${products.length} loại</code>
 ╰ 🎯 <b>Tổng acc còn:</b>  <code>${totalStock} acc</code>
───────────────────────────
💡 <i>Dữ liệu được trích xuất trực tiếp từ SQLite.</i>`;

    await renderSafe(bot, msg.chat.id, null, IMAGES.REVENUE, caption, []);
  });

  bot.onText(/\/stats/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const products = await db.getAllProducts();
    let text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  📊 <b>TỒN KHO THỜI GIAN THỰC</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n`;
    let total = 0;
    products.forEach(p => {
      const status = p.stock_count > 0 ? '🟢' : '🔴';
      text += ` ${status} <b>${p.name}:</b> <code>${p.stock_count}</code> acc\n`;
      total += p.stock_count;
    });
    text += `───────────────────────────\n🎯 <b>Tổng acc sẵn sàng:</b> <code>${total}</code> acc`;

    await renderSafe(bot, msg.chat.id, null, IMAGES.STATS, text, []);
  });

  bot.onText(/\/categories/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const categories = await db.getAllCategories();
    const keyboard = categories.map(c => [{ text: wideInlineLabel(`📂 ${c.name} (${c.product_count} SP)`), callback_data: `adm_cat_detail_${c.id}` }]);
    keyboard.push([{ text: wideInlineLabel('➕ Thêm danh mục mới'), callback_data: 'adm_add_cat' }]);

    bot.sendMessage(msg.chat.id, `📁 <b>QUẢN LÝ DANH MỤC THƯ MỤC:</b>\nHiện có <b>${categories.length}</b> danh mục:`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  });

  bot.onText(/\/products/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const products = await db.getAllProducts();
    const keyboard = products.map(p => [{ text: wideInlineLabel(`📦 #${p.id} ${p.name} (Kho: ${p.stock_count})`), callback_data: 'adm_product_' + p.id }]);
    keyboard.push([{ text: wideInlineLabel('➕ Thêm sản phẩm mới'), callback_data: 'adm_add_product' }]);
    bot.sendMessage(msg.chat.id, `⚙️ <b>QUẢN TRỊ KHO SẢN PHẨM:</b>\n📊 Đang có: <b>${products.length}</b> mặt hàng.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
  });

  bot.onText(/\/orders/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const orders = await db.getRecentOrders(15);
    if (orders.length === 0) return bot.sendMessage(msg.chat.id, '📦 Hiện chưa có đơn hàng nào!');

    let text = `📦 <b>15 ĐƠN HÀNG GẦN ĐÂY:</b>\n───────────────────────────\n`;
    orders.forEach((o) => {
      const icon = o.status === 'completed' ? '✅' : o.status === 'pending' ? '⏳' : '❌';
      text += `${icon} <b>#${o.id}</b> | <code>${o.user_name}</code>\n ├ 🎁 ${o.product_name} x${o.quantity}\n ╰ 💵 <code>${formatPrice(o.total_price || 0)}</code>\n\n`;
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  bot.onText(/\/users/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const users = await db.getAllUsers();
    let text = `👥 <b>DANH SÁCH THÀNH VIÊN (${users.length} users):</b>\n───────────────────────────\n`;
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
    bot.sendMessage(chatId, '⏳ Đang xóa 50 tin nhắn gần nhất...').then(async (sentMsg) => {
      for (let i = msg.message_id; i > msg.message_id - 50; i--) {
        try {
          await bot.deleteMessage(chatId, i);
          deleted++;
        } catch (e) { }
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
                 '───────────────────────────\n' +
                 '👥 Sẽ gửi tới: <b>' + users.length + '</b> khách hàng\n\n' +
                 '✏️ Hãy nhắn nội dung thông báo vào đây:';
    bot.sendMessage(msg.chat.id, text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy bỏ'), callback_data: 'cancel_broadcast' }]] }
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
        await bot.sendMessage(user.id, `📢 <b>THÔNG BÁO TỪ HỆ THỐNG:</b>\n\n${content}`, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: wideInlineLabel('🛒 Mở Cửa Hàng Ngay'), callback_data: 'back_main' }]]
          }
        });
        sent++;
      } catch (e) {
        failed++;
      }
    }

    const text = '✅ <b>ĐÃ GỬI THÔNG BÁO HOÀN TẤT</b>\n' +
                 '───────────────────────────\n' +
                 '🎯 Gửi thành công: <b>' + sent + '</b>\n' +
                 '⚠️ Bị chặn/Thất bại: <b>' + failed + '</b>';
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
 ├ 💵 <b>Số tiền nạp:</b>  <code>${formatPrice(amount)}</code>
 ├ 🏦 <b>Ngân hàng:</b>   <b>${config.BANK_NAME}</b>
 ├ 💳 <b>Số tài khoản:</b> <code>${config.BANK_ACCOUNT}</code>
 ├ 👤 <b>Chủ tài khoản:</b> <b>${config.BANK_OWNER}</b>
 ╰ 📝 <b>Nội dung CK:</b>  <code>${content}</code>
───────────────────────────
⚠️ <b>LƯU Ý QUAN TRỌNG:</b>
 • Quét mã QR và giữ nguyên nội dung chuyển khoản.
 • Hệ thống tự động cộng tiền trong vòng 15 - 30 giây.`;

    if (oldMessageId) {
      try { await bot.deleteMessage(chatId, oldMessageId); } catch (_) {}
    }

    await bot.sendPhoto(chatId, getQRUrl(amount, content), {
      caption: caption,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('◀️ Quay lại Hồ Sơ'), callback_data: 'main_profile' }]] }
    });

    const adminMsg = 
`⚡ <b>GIAO DỊCH NẠP CHỜ QUÉT MÃ</b>
───────────────────────────
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
        return await renderSafe(bot, chatId, messageId, IMAGES.MAIN_MENU, text, keyboard);
      }

      if (data === 'main_shop' || data === 'back_main') {
        const { text, keyboard } = await buildMainMenu(userId);
        return await renderSafe(bot, chatId, messageId, IMAGES.MAIN_MENU, text, keyboard);
      }

      if (data === 'change_language') {
        const langText = `🌐 <b>LỰA CHỌN NGÔN NGỮ HIỂN THỊ</b>\n───────────────────────────\n<i>Vui lòng chọn ngôn ngữ bên dưới:</i>`;
        if (query.message.photo) {
          await bot.deleteMessage(chatId, messageId);
          return bot.sendMessage(chatId, langText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: getLanguageKeyboard() } });
        }
        return bot.editMessageText(langText, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: getLanguageKeyboard() } });
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
<i>Tri ân sự tin tưởng và ủng hộ của quý khách!</i>
───────────────────────────\n`;

        if (topList.length === 0) {
          text += `<i>Hiện tại chưa có dữ liệu nạp tiền.</i>`;
        } else {
          topList.forEach((u, idx) => {
            let medal = '▫️';
            if (idx === 0) medal = '🥇';
            else if (idx === 1) medal = '🥈';
            else if (idx === 2) medal = '🥉';

            const userTag = u.username ? `@${u.username}` : `<code>${u.name}</code>`;
            text += `${medal} <b>Top ${idx + 1}:</b> ${userTag}\n   ╰ 💰 <b>Tổng nạp:</b> <code>${formatPrice(u.total)}</code>\n\n`;
          });
        }

        text += `───────────────────────────\n💡 <i>Nạp tiền ngay để vinh danh trên bảng vàng!</i>`;

        const keyboard = [
          [{ text: wideInlineLabel('💳 Nạp tiền ngay'), callback_data: 'deposit_menu' }],
          [{ text: wideInlineLabel('◀️ Về Trang Chủ'), callback_data: 'back_main' }]
        ];

        return await renderSafe(bot, chatId, messageId, IMAGES.TOP, text, keyboard);
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
          return [{ text: wideInlineLabel(`💎 ${p.name} ▫️ ${getDisplayPrice(p)} [${stockBadge}]`), callback_data: 'product_' + p.id }];
        });
        keyboard.push([{ text: wideInlineLabel(t.btn_back_home), callback_data: 'back_main' }]);

        const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  📂 <b>DANH MỤC: ${(cat ? cat.name : 'SẢN PHẨM').toUpperCase()}</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
<i>${cat?.description || 'Chọn mặt hàng bên dưới để tiến hành mua:'}</i>`;

        return await renderSafe(bot, chatId, messageId, IMAGES.MAIN_MENU, text, keyboard);
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
          keyboard.push([{ text: wideInlineLabel('◀️ Quay lại danh mục'), callback_data: 'view_category_' + product.category_id }]);
        } else {
          keyboard.push([{ text: wideInlineLabel(t.btn_back_home), callback_data: 'main_shop' }]);
        }

        const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  🎁 <b>CHI TIẾT: ${product.name.toUpperCase()}</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n` +
          productPriceBlockUser(product) +
          '📊 <b>Tình trạng kho:</b> <code>' + stock + '</code> tài khoản\n' +
          (product.description ? '📝 <b>Mô tả:</b> <i>' + product.description + '</i>\n' : '') +
          '───────────────────────────\n' +
          '👇 <i>Chạm chọn nhanh số lượng muốn mua:</i>';

        return await renderSafe(bot, chatId, messageId, IMAGES.MAIN_MENU, text, keyboard);
      }

      if (data.startsWith('customqty_')) {
        const productId = parseInt(data.split('_')[1]);
        const product = await db.getProduct(productId);
        if (!product) return bot.answerCallbackQuery(query.id, { text: 'Sản phẩm không tồn tại!' });
        waitingEdit.set(userId, { field: 'custom_qty', productId, messageId });

        const text = '📝 <b>NHẬP SỐ LƯỢNG MUA TÙY Ý</b>\n' +
                     '───────────────────────────\n' +
                     '📦 Mặt hàng: <b>' + product.name + '</b>\n' +
                     productPriceBlockUser(product) +
                     '📊 Kho hiện có: <b>' + product.stock_count + '</b> sp\n\n' +
                     '✏️ <i>Nhập số lượng bạn muốn mua vào khung chat:</i>';

        if (query.message.photo) {
          await bot.deleteMessage(chatId, messageId);
          return bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy bỏ'), callback_data: 'product_' + productId }]] } });
        }
        return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy bỏ'), callback_data: 'product_' + productId }]] } });
      }

      if (data.startsWith('qty_')) {
        const [, productId, quantity] = data.split('_');
        const product = await db.getProduct(parseInt(productId));
        const qty = parseInt(quantity);
        if (product.stock_count < qty) return bot.answerCallbackQuery(query.id, { text: 'Kho không đủ số lượng yêu cầu!', show_alert: true });

        const totalPrice = db.calculatePrice(product, qty);
        const unitPrice = db.getUnitPrice(product, qty);
        const userBalance = await db.getUserBalance(userId);

        const discountInfo = unitPrice < product.price ? '\n ├ 💎 <b>Ưu đãi sỉ:</b> <code>' + formatPrice(unitPrice) + '/sp</code>' : '';
        const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  🧾 <b>XÁC NHẬN ĐƠN MUA HÀNG</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 🎁 <b>Mặt hàng:</b> <b>${product.name}</b>
 ├ 🔢 <b>Số lượng:</b> <code>${qty} acc</code>${discountInfo}
 ├ 💰 <b>Tổng thanh toán:</b> <code>${formatPrice(totalPrice)}</code>
 ╰ 💳 <b>Số dư ví hiện tại:</b> <code>${formatPrice(userBalance)}</code>
───────────────────────────
<i>Vui lòng chọn hình thức thanh toán bên dưới:</i>`;

        const keyboard = [
          [{ text: wideInlineLabel('⚡ Mua bằng SỐ DƯ VÍ'), callback_data: `paywallet_${productId}_${qty}` }],
          [{ text: wideInlineLabel('🏦 Quét mã QR NGÂN HÀNG'), callback_data: `paybank_${productId}_${qty}` }],
          [{ text: wideInlineLabel('◀️ Thay đổi số lượng'), callback_data: `product_${productId}` }]
        ];

        return await renderSafe(bot, chatId, messageId, IMAGES.MAIN_MENU, text, keyboard);
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
───────────────────────────
📲 <i>Quét mã QR bên trên để thanh toán tự động.</i>
⚡ <i>Hệ thống tự động phát file tài khoản ngay sau khi nhận tiền!</i>`;

        await bot.sendPhoto(chatId, getQRUrl(totalPrice, content), {
          caption,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: wideInlineLabel('🔄 Kiểm tra thanh toán ngay'), callback_data: 'check_' + orderId + '_' + productId + '_' + qty }],
              [{ text: wideInlineLabel('❌ Hủy đơn hàng này'), callback_data: 'cancel_' + orderId }]
            ]
          }
        });

        const adminOrderAlert = 
`⚡ <b>ĐƠN HÀNG MỚI ĐANG CHỜ QUÉT MÃ QR</b>
───────────────────────────
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
          return bot.answerCallbackQuery(query.id, { text: '⏳ Đang quét giao dịch ngân hàng, vui lòng đợi 5s...', show_alert: true });
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
          bot.answerCallbackQuery(query.id, { text: 'Hệ thống chưa nhận được tiền. Vui lòng thử lại sau 15 giây!', show_alert: true });
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
        return await renderSafe(bot, chatId, messageId, IMAGES.MAIN_MENU, text, keyboard);
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
 ├ 🆔 <b>ID người dùng:</b> <code>${userId}</code>
 ├ 🏷️ <b>Họ và tên:</b> <b>${getFullName(query.from)}</b>
 ╰ 📧 <b>Username:</b> ${query.from.username ? '@' + query.from.username : '<i>Không có</i>'}
───────────────────────────
💳 <b>TÀI CHÍNH & VÍ SHOP</b>
 ├ 🏦 <b>Số dư ví:</b>      <code>${formatPrice(balance)}</code>
 ├ 🏯 <b>Tổng tiền đã nạp:</b> <code>${formatPrice(totalDeposit)}</code>
 ╰ 💰 <b>Nạp trong tháng:</b>  <code>${formatPrice(monthDeposit)}</code>
───────────────────────────
📊 <b>HOẠT ĐỘNG GIAO DỊCH</b>
 ├ 🛍️ <b>Đơn hoàn tất:</b> <code>${completed.length} đơn</code>
 ╰ 💸 <b>Đã tiêu dùng:</b> <code>${formatPrice(totalSpent)}</code>`;

        const keyboard = [
          [{ text: wideInlineLabel('💳 Nạp tiền vào ví'), callback_data: 'deposit_menu' }],
          [{ text: wideInlineLabel('📜 Lịch sử mua hàng'), callback_data: 'main_history' }],
          [{ text: wideInlineLabel('◀️ Về Trang Chủ'), callback_data: 'back_main' }]
        ];

        return await renderSafe(bot, chatId, messageId, IMAGES.PROFILE, text, keyboard);
      }

      if (data === 'deposit_menu') {
        const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  💳 <b>NẠP TIỀN TỰ ĐỘNG VÀO VÍ</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
<i>Hệ thống quét biến động VietQR tự động 24/7.
Vui lòng lựa chọn các mức tiền gợi ý hoặc tự nhập:</i>`;

        const keyboard = [
          [{ text: wideInlineLabel('💵 20.000đ'), callback_data: 'dep_amt_20000' }, { text: wideInlineLabel('💵 50.000đ'), callback_data: 'dep_amt_50000' }],
          [{ text: wideInlineLabel('💵 100.000đ'), callback_data: 'dep_amt_100000' }, { text: wideInlineLabel('💵 200.000đ'), callback_data: 'dep_amt_200000' }],
          [{ text: wideInlineLabel('💵 500.000đ'), callback_data: 'dep_amt_500000' }, { text: wideInlineLabel('✏️ Nhập số khác'), callback_data: 'dep_custom' }],
          [{ text: wideInlineLabel('◀️ Về Trang Chủ'), callback_data: 'back_main' }]
        ];

        return await renderSafe(bot, chatId, messageId, IMAGES.DEPOSIT, text, keyboard);
      }

      if (data.startsWith('dep_amt_')) {
        const amount = parseInt(data.split('_')[2], 10);
        await createDepositQR(chatId, query.from, amount, messageId);
        return;
      }

      if (data === 'dep_custom') {
        waitingEdit.set(userId, { field: 'custom_deposit', messageId });
        const text = `✏️ <b>NHẬP SỐ TIỀN CẦN NẠP</b>\n───────────────────────────\n<i>Vui lòng nhập số tiền bạn muốn nạp (tối thiểu 10.000đ):</i>`;
        if (query.message.photo) {
          await bot.deleteMessage(chatId, messageId);
          return bot.sendMessage(chatId, text, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy bỏ'), callback_data: 'deposit_menu' }]] }
          });
        }
        return bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy bỏ'), callback_data: 'deposit_menu' }]] }
        });
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
            keyboard.push([{ text: wideInlineLabel(`📥 Nhận file đơn #${o.id} (${o.product_name})`), callback_data: `dl_order_${o.id}` }]);
          }
        });
        keyboard.push([{ text: wideInlineLabel('◀️ Về Trang Chủ'), callback_data: 'back_main' }]);

        return await renderSafe(bot, chatId, messageId, IMAGES.PROFILE, text, keyboard);
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
          const text = '📁 <b>TẠO DANH MỤC SẢN PHẨM MỚI</b>\n───────────────────────────\nNhập cú pháp: <code>Tên thư mục|Mô tả</code>\nVí dụ: <code>Acc Free Fire VIP|Kho nick VIP full skin</code>';
          if (query.message.photo) {
            await bot.deleteMessage(chatId, messageId);
            return bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy'), callback_data: 'adm_back_categories' }]] } });
          }
          return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy'), callback_data: 'adm_back_categories' }]] }
          });
        }

        if (data.startsWith('adm_cat_detail_')) {
          const catId = parseInt(data.split('_')[3]);
          const cat = await db.getCategory(catId);
          if (!cat) return bot.answerCallbackQuery(query.id, { text: 'Danh mục này không tồn tại!' });
          const prods = await db.getProductsByCategory(catId);

          let text = `📂 <b>DANH MỤC: ${cat.name.toUpperCase()}</b>\n📝 <b>Mô tả:</b> <i>${cat.description || 'Chưa cập nhật'}</i>\n📊 <b>Tổng sản phẩm:</b> <b>${prods.length}</b> mặt hàng\n\n`;
          if (prods.length > 0) {
            text += `<i>Danh sách mặt hàng đang mở bán:</i>\n`;
            prods.forEach((p, idx) => {
              text += `${idx + 1}. <b>${p.name}</b> (Kho: ${p.stock_count}) - ${formatPrice(p.price)}\n`;
            });
          } else {
            text += `<i>(Chưa có sản phẩm nào thuộc danh mục này)</i>`;
          }

          const keyboard = [
            [{ text: wideInlineLabel('➕ Chọn sản phẩm từ /products'), callback_data: `adm_pick_from_prods_${catId}` }],
            [{ text: wideInlineLabel('🗑️ Xóa danh mục này'), callback_data: `adm_delcat_${catId}` }],
            [{ text: wideInlineLabel('◀️ Quay lại danh sách'), callback_data: 'adm_back_categories' }]
          ];

          if (query.message.photo) {
            await bot.deleteMessage(chatId, messageId);
            return bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
          }
          return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
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
            const statusIcon = inThisCat ? '✅ [ĐANG CHỌN]' : '➕ [CHƯA VÀO]';
            keyboard.push([{
              text: wideInlineLabel(`${statusIcon} #${p.id} ${p.name}`),
              callback_data: `adm_toggle_prodcat_${catId}_${p.id}`
            }]);
          });

          keyboard.push([{ text: wideInlineLabel('◀️ Hoàn tất / Quay lại'), callback_data: `adm_cat_detail_${catId}` }]);

          const text = `📁 <b>PHÂN PHỐI SẢN PHẨM: ${cat.name.toUpperCase()}</b>\n` +
                       `<i>Chạm vào từng mục để thêm vào hoặc gỡ ra khỏi danh mục:</i>\n\n` +
                       `• ✅ = Đang nằm trong danh mục (chạm để gỡ)\n` +
                       `• ➕ = Chưa thuộc danh mục (chạm để gán)`;

          return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
          });
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
              text: newCatId === 0 ? `Đã gỡ #${prodId} ra mục chung!` : `Đã thêm #${prodId} vào danh mục!`
            });
          }

          const cat = await db.getCategory(catId);
          const allProds = await db.getAllProducts();
          const keyboard = [];
          allProds.forEach(p => {
            const inThisCat = p.category_id === catId;
            const statusIcon = inThisCat ? '✅ [ĐANG CHỌN]' : '➕ [CHƯA VÀO]';
            keyboard.push([{
              text: wideInlineLabel(`${statusIcon} #${p.id} ${p.name}`),
              callback_data: `adm_toggle_prodcat_${catId}_${p.id}`
            }]);
          });
          keyboard.push([{ text: wideInlineLabel('◀️ Hoàn tất / Quay lại'), callback_data: `adm_cat_detail_${catId}` }]);

          const text = `📁 <b>PHÂN PHỐI SẢN PHẨM: ${cat.name.toUpperCase()}</b>\n` +
                       `<i>Chạm vào từng mục để thêm vào hoặc gỡ ra khỏi danh mục:</i>\n\n` +
                       `• ✅ = Đang nằm trong danh mục (chạm để gỡ)\n` +
                       `• ➕ = Chưa thuộc danh mục (chạm để gán)`;

          return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
          });
        }

        if (data.startsWith('adm_delcat_')) {
          const catId = parseInt(data.split('_')[2]);
          await db.deleteCategory(catId);
          bot.answerCallbackQuery(query.id, { text: 'Đã xóa danh mục thành công!' });
          const categories = await db.getAllCategories();
          const keyboard = categories.map(c => [{ text: wideInlineLabel(`📂 ${c.name} (${c.product_count} SP)`), callback_data: `adm_cat_detail_${c.id}` }]);
          keyboard.push([{ text: wideInlineLabel('➕ Thêm danh mục mới'), callback_data: 'adm_add_cat' }]);
          return bot.editMessageText('✅ <b>Đã xóa danh mục thành công!</b>\n\n📁 <b>QUẢN LÝ DANH MỤC:</b>', { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
        }

        if (data === 'adm_back_categories') {
          const categories = await db.getAllCategories();
          const keyboard = categories.map(c => [{ text: wideInlineLabel(`📂 ${c.name} (${c.product_count} SP)`), callback_data: `adm_cat_detail_${c.id}` }]);
          keyboard.push([{ text: wideInlineLabel('➕ Thêm danh mục mới'), callback_data: 'adm_add_cat' }]);
          return bot.editMessageText('📁 <b>QUẢN LÝ DANH MỤC SẢN PHẨM:</b>', { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
        }

        if (data === 'adm_add_product') {
          const categories = await db.getAllCategories();
          const keyboard = [];

          if (categories.length > 0) {
            categories.forEach(c => {
              keyboard.push([{ text: wideInlineLabel(`📁 Đưa vào: ${c.name}`), callback_data: `adm_addprodto_${c.id}` }]);
            });
          }
          keyboard.push([{ text: wideInlineLabel('📦 Mục chung (Không phân loại)'), callback_data: 'adm_addprodto_0' }]);
          keyboard.push([{ text: wideInlineLabel('❌ Hủy'), callback_data: 'adm_back_list' }]);

          return bot.editMessageText('📁 <b>BƯỚC 1: Chọn danh mục lưu sản phẩm:</b>', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
          });
        }

        if (data.startsWith('adm_addprodto_')) {
          const catId = parseInt(data.split('_')[2]);
          waitingEdit.set(userId, { field: 'new_product', categoryId: catId, messageId });
          return bot.editMessageText(`➕ <b>BƯỚC 2: NHẬP THÔNG TIN MẶT HÀNG</b>\n───────────────────────────\nCú pháp: <code>Tên|Giá|Mô tả</code>\nVí dụ: <code>Acc Clone Lv5|25000|Clone sạch chưa qua liên kết</code>`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy'), callback_data: 'adm_back_list' }]] }
          });
        }

        if (data.startsWith('adm_change_cat_')) {
          const productId = parseInt(data.split('_')[3]);
          const categories = await db.getAllCategories();
          const keyboard = [];

          categories.forEach(c => {
            keyboard.push([{ text: wideInlineLabel(`📁 Chuyển sang: ${c.name}`), callback_data: `adm_apply_cat_${productId}_${c.id}` }]);
          });
          keyboard.push([{ text: wideInlineLabel('📦 Chuyển ra Mục chung'), callback_data: `adm_apply_cat_${productId}_0` }]);
          keyboard.push([{ text: wideInlineLabel('◀️ Hủy bỏ'), callback_data: `adm_product_${productId}` }]);

          return bot.editMessageText('📁 <b>Chọn danh mục mới cho sản phẩm này:</b>', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
          });
        }

        if (data.startsWith('adm_apply_cat_')) {
          const [, , , productId, catId] = data.split('_');
          if (db.updateProductCategory) {
            await db.updateProductCategory(parseInt(productId), parseInt(catId));
          }
          bot.answerCallbackQuery(query.id, { text: 'Cập nhật danh mục thành công!' });
          return bot.editMessageText(`✅ Đã điều chuyển sản phẩm #${productId} sang danh mục mới!`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('◀️ Về thông tin SP'), callback_data: 'adm_product_' + productId }]] }
          });
        }

        if (data.startsWith('adm_product_')) {
          const productId = parseInt(data.split('_')[2]);
          const product = await db.getProduct(productId);
          if (!product) return bot.answerCallbackQuery(query.id, { text: 'Sản phẩm không tồn tại!' });
          const stocks = await db.getStockByProduct(productId);
          const available = stocks.filter(s => !s.is_sold).length;
          const sold = stocks.length - available;

          let catName = 'Mục chung (Không phân loại)';
          if (product.category_id > 0) {
            const cat = await db.getCategory(product.category_id);
            if (cat) catName = cat.name;
          }

          const text = '📦 <b>' + product.name + '</b> (#' + product.id + ')\n' +
                       '📁 Danh mục: <b>' + catName + '</b>\n' +
                       '───────────────────────────\n' +
                       productPriceBlockAdmin(product) +
                       '📝 <b>Mô tả:</b> ' + (product.description || 'Chưa cập nhật') + '\n\n' +
                       '📊 <b>TỒN KHO:</b> 🟢 ' + available + ' khả dụng │ 🔴 ' + sold + ' đã bán';

          return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: adminProductKeyboard(productId) } });
        }

        if (data.startsWith('adm_edit_tiers_')) {
          const productId = parseInt(data.split('_')[3]);
          const product = await db.getProduct(productId);
          waitingEdit.set(userId, { productId, field: 'tiers', messageId });

          let currentTiers = 'Chưa cài đặt';
          if (product.price_tiers && product.price_tiers.length > 0) {
            currentTiers = product.price_tiers.map(t => t.min + ':' + t.price).join(', ');
          }

          const text = '📊 <b>CÀI ĐẶT BẬC THANG GIÁ SỈ</b>\n' +
                       '───────────────────────────\n' +
                       '📦 Mặt hàng: <b>' + product.name + '</b>\n' +
                       '💰 Giá bán lẻ: <code>' + formatPrice(product.price) + '</code>\n' +
                       '📋 Đang áp dụng: <code>' + currentTiers + '</code>\n\n' +
                       '📝 Cú pháp nhập:\n' +
                       '<code>SốLượng:Giá, SốLượng:Giá, ...</code>\n\n' +
                       '▸ Ví dụ: <code>1:50000, 10:45000, 20:40000</code>\n\n' +
                       '💡 <i>Nhập chữ <b>xoa</b> để xóa bỏ bảng giá sỉ.</i>';
          return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]] } });
        }

        if (data.startsWith('adm_edit_name_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'name', messageId });
          return bot.editMessageText('✏️ Nhập tên mới cho sản phẩm #' + productId + ':', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]] } });
        }

        if (data.startsWith('adm_edit_price_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'price', messageId });
          return bot.editMessageText('💵 Nhập giá niêm yết mới (VNĐ) cho sản phẩm #' + productId + ':', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]] } });
        }

        if (data.startsWith('adm_edit_desc_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'desc', messageId });
          return bot.editMessageText('📝 Nhập mô tả mới cho sản phẩm #' + productId + ':', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]] } });
        }

        if (data.startsWith('adm_addstock_')) {
          const productId = parseInt(data.split('_')[2]);
          const product = await db.getProduct(productId);
          waitingStock.set(userId, productId);
          return bot.editMessageText('➕ <b>NẠP STOCK CHO: ' + product.name + '</b>\n\n<i>Gửi danh sách tài khoản vào đây (mỗi tài khoản 1 dòng):</i>', { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]] } });
        }

        if (data.startsWith('adm_viewstock_')) {
          const productId = parseInt(data.split('_')[2]);
          const product = await db.getProduct(productId);
          const stocks = await db.getStockByProduct(productId);
          const available = stocks.filter(s => !s.is_sold);
          let text = '📦 <b>' + product.name + '</b>\n\n🎯 Khả dụng: <b>' + available.length + '</b> | ✖️ Đã xuất: <b>' + (stocks.length - available.length) + '</b>\n───────────────────────────\n';
          const keyboard = [];
          if (available.length > 0) {
            text += '<i>Danh sách tài khoản (chạm để xóa nhanh):</i>\n';
            available.slice(0, 10).forEach((s, i) => {
              text += `${i + 1}. <code>${s.account_data}</code>\n`;
              keyboard.push([{ text: wideInlineLabel('🗑️ Xóa: ' + s.account_data.substring(0, 25) + '...'), callback_data: 'adm_delstock_' + productId + '_' + s.id }]);
            });
            if (available.length > 10) text += '... và <b>' + (available.length - 10) + '</b> tài khoản khác.\n';
            keyboard.push([{ text: wideInlineLabel('🗑️ Xóa TẤT CẢ tồn kho'), callback_data: 'adm_clearstock_' + productId }]);
          } else {
            text += '✖️ Hiện tại kho đang trống!';
          }
          keyboard.push([{ text: wideInlineLabel('➕ Nạp thêm stock'), callback_data: 'adm_addstock_' + productId }]);
          keyboard.push([{ text: wideInlineLabel('◀️ Quay lại'), callback_data: 'adm_product_' + productId }]);
          return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
        }

        if (data.startsWith('adm_delstock_')) {
          const parts = data.split('_');
          const productId = parseInt(parts[2]);
          const stockId = parseInt(parts[3]);
          await db.deleteStock(stockId);
          bot.answerCallbackQuery(query.id, { text: 'Đã xóa tài khoản khỏi kho!' });
          const product = await db.getProduct(productId);
          const stocks = await db.getStockByProduct(productId);
          const available = stocks.filter(s => !s.is_sold);
          let text = '📦 <b>' + product.name + '</b>\n\n🎯 Khả dụng: <b>' + available.length + '</b> | ✖️ Đã xuất: <b>' + (stocks.length - available.length) + '</b>\n───────────────────────────\n';
          const keyboard = [];
          if (available.length > 0) {
            text += '<i>Danh sách tài khoản (chạm để xóa nhanh):</i>\n';
            available.slice(0, 10).forEach((s, i) => {
              text += `${i + 1}. <code>${s.account_data}</code>\n`;
              keyboard.push([{ text: wideInlineLabel('🗑️ Xóa: ' + s.account_data.substring(0, 25) + '...'), callback_data: 'adm_delstock_' + productId + '_' + s.id }]);
            });
            keyboard.push([{ text: wideInlineLabel('🗑️ Xóa TẤT CẢ tồn kho'), callback_data: 'adm_clearstock_' + productId }]);
          }
          keyboard.push([{ text: wideInlineLabel('➕ Nạp thêm stock'), callback_data: 'adm_addstock_' + productId }]);
          keyboard.push([{ text: wideInlineLabel('◀️ Quay lại'), callback_data: 'adm_product_' + productId }]);
          return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
        }

        if (data.startsWith('adm_clearstock_')) {
          const productId = parseInt(data.split('_')[2]);
          await db.clearStock(productId);
          bot.answerCallbackQuery(query.id, { text: 'Đã làm sạch kho!' });
          return bot.editMessageText(`🎯 Đã xóa sạch toàn bộ acc của sản phẩm #${productId}.`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('◀️ Quay lại'), callback_data: 'adm_product_' + productId }]] } });
        }

        if (data.startsWith('adm_delete_')) {
          const productId = parseInt(data.split('_')[2]);
          await db.deleteProduct(productId);
          bot.answerCallbackQuery(query.id, { text: 'Đã xóa sản phẩm vĩnh viễn!' });
          return bot.editMessageText(`🗑️ Đã xóa hoàn toàn mặt hàng #${productId}.`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('◀️ Về kho hàng'), callback_data: 'adm_back_list' }]] } });
        }

        if (data === 'adm_back_list') {
          const products = await db.getAllProducts();
          const keyboard = products.map(p => [{ text: wideInlineLabel(`📦 #${p.id} ${p.name} (Kho: ${p.stock_count})`), callback_data: 'adm_product_' + p.id }]);
          keyboard.push([{ text: wideInlineLabel('➕ Thêm sản phẩm mới'), callback_data: 'adm_add_product' }]);
          return bot.editMessageText('⚙️ <b>HỆ THỐNG QUẢN TRỊ SẢN PHẨM:</b>', { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
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
 ├ ➕ <b>Vừa nhập thêm:</b> <code>+${accs.length} acc</code>
 ╰ 💰 <b>Giá bán lẻ:</b> <code>${formatPrice(product.price)}</code>
───────────────────────────
⚡ <i>Số lượng có hạn, nhanh tay vào mua ngay kẻo hết!</i>`;
      
      const users = await db.getAllUsers();
      for (const u of users) {
        renderSafe(bot, u.id, null, IMAGES.RESTOCK, alertMsg, [[{ text: wideInlineLabel('🛒 Mua Ngay'), callback_data: 'back_main' }]]);
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
          await bot.sendMessage(user.id, `📢 <b>THÔNG BÁO TỪ HỆ THỐNG:</b>\n\n${msg.text}`, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: wideInlineLabel('🛒 Mở Cửa Hàng'), callback_data: 'back_main' }]]
            }
          });
          sent++;
        } catch (e) {
          failed++;
        }
      }

      const text = '✅ <b>ĐÃ HOÀN TẤT CHIẾN DỊCH THÔNG BÁO</b>\n' +
                   '───────────────────────────\n' +
                   '🎯 Gửi thành công: <b>' + sent + '</b>\n' +
                   '⚠️ Bị chặn/Thất bại: <b>' + failed + '</b>';
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

      if (!name || isNaN(price)) return bot.sendMessage(msg.chat.id, '⚠️ Vui lòng nhập đúng format: <code>Tên|Giá|Mô tả</code>', { parse_mode: 'HTML' });

      const res = await db.addProduct(name, price, desc, editInfo.categoryId || 0);
      waitingEdit.delete(msg.from.id);

      bot.sendMessage(msg.chat.id, `✅ Đã thêm mặt hàng <b>${name}</b> (#${res.lastInsertRowid})!\n📢 Đang gửi thông báo ra mắt tới khách hàng...`, { parse_mode: 'HTML' });

      const newProductAlert = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  🎉 <b>MẶT HÀNG MỚI ĐÃ LÊN KỆ!</b> 🎉
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 🎁 <b>Mặt hàng:</b> <b>${name}</b>
 ├ 💵 <b>Đơn giá:</b> <code>${formatPrice(price)}</code>
 ╰ 📝 <b>Mô tả:</b> <i>${desc || 'Hàng chất lượng, bảo hành uy tín!'}</i>
───────────────────────────
👉 <i>Bấm vào nút bên dưới để xem chi tiết và mua ngay!</i>`;
      
      const users = await db.getAllUsers();
      for (const u of users) {
        renderSafe(bot, u.id, null, IMAGES.NEW_PROD, newProductAlert, [[{ text: wideInlineLabel('🛒 Mua Ngay'), callback_data: 'back_main' }]]);
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
 ╰ 💳 <b>Ví của bạn:</b> <code>${formatPrice(userBalance)}</code>
───────────────────────────
<i>Vui lòng chọn hình thức thanh toán bên dưới:</i>`;

      const keyboard = [
        [{ text: wideInlineLabel('⚡ Mua bằng SỐ DƯ VÍ'), callback_data: `paywallet_${editInfo.productId}_${qty}` }],
        [{ text: wideInlineLabel('🏦 Quét mã QR NGÂN HÀNG'), callback_data: `paybank_${editInfo.productId}_${qty}` }],
        [{ text: wideInlineLabel('◀️ Thay đổi số lượng'), callback_data: `product_${editInfo.productId}` }]
      ];

      return bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
    }

    if (editInfo.field === 'custom_deposit') {
      const amount = parseInt(msg.text.trim(), 10);
      waitingEdit.delete(msg.from.id);
      if (isNaN(amount) || amount < 10000) {
        return bot.sendMessage(msg.chat.id, '⚠️ Số tiền nạp tối thiểu được hỗ trợ là 10.000đ.');
      }
      await createDepositQR(msg.chat.id, msg.from, amount, null);
    }
  });

  console.log('🤖 ' + config.SHOP_NAME + ' đang vận hành với giao diện thẩm mỹ cao!');
}

startBot().catch(console.error);
