const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const db = require('./database');
const sepay = require('./sepay');

const formatPrice = (price) => (price || 0).toLocaleString('vi-VN') + ' VND';
const isAdmin = (userId) => config.ADMIN_IDS.map(id => id.toString()).includes(userId.toString());
const getFullName = (user) => (user.first_name + (user.last_name ? ' ' + user.last_name : '')).trim();
const ORDER_TIMEOUT_MS = 20 * 60 * 1000;

/** Che bớt ID để bảo mật danh tính khách hàng: 123456789 -> 123****89 */
function maskUserId(id) {
  const s = String(id);
  if (s.length <= 5) return s;
  return s.substring(0, 3) + '****' + s.substring(s.length - 2);
}

/** Khoảng trắng + ZWJ (\u200D): Telegram không trim đuôi → nút một cột trông rộng hơn (pseudo full-width). Tối đa 64 ký tự/nút. */
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

function getDisplayPrice(product) {
  if (product.price_tiers?.length) {
    const minPrice = Math.min(...product.price_tiers.map((t) => t.price));
    if (minPrice < product.price) return 'từ ' + formatPrice(minPrice);
  }
  return formatPrice(product.price);
}

/** Bullet gọn — chủ yếu cho admin / tin nhắn tóm tắt. */
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

/** Bảng giá tier trình bày đầy đủ cho khách (màn hình chọn SL / mô tả SP). */
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
      const save =
        pct > 0
          ? '\n   └ 💚 Giảm ' + pct + '% so với giá niêm yết (' + formatPrice(base) + ')'
          : '';
      return '▸ ' + range + '\n   💵 Đơn giá: ' + formatPrice(tier.price) + ' / sản phẩm' + save;
    })
    .join('\n\n');
}

function productPriceBlockUser(product) {
  if (!product.price_tiers?.length) {
    return '💰 Đơn giá cố định: ' + formatPrice(product.price) + ' cho mỗi sản phẩm\n';
  }
  return (
    '💎 Ưu đãi theo số lượng — mua nhiều, đơn giá càng thấp\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n\n' +
    formatTierBlockUser(product) +
    '\n━━━━━━━━━━━━━━━━━━━━━\n' +
    '💡 Chọn số lượng bên dưới; tổng thanh toán sẽ khớp đúng bảng giá trên.\n\n'
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
    [{ text: wideInlineLabel('📊 Sửa bảng giá'), callback_data: 'adm_edit_tiers_' + productId }],
    [{ text: wideInlineLabel('📝 Sửa mô tả'), callback_data: 'adm_edit_desc_' + productId }],
    [{ text: wideInlineLabel('➕ Thêm stock'), callback_data: 'adm_addstock_' + productId }, { text: wideInlineLabel('👁️ Xem stock'), callback_data: 'adm_viewstock_' + productId }],
    [{ text: wideInlineLabel('🗑️ Xóa sản phẩm'), callback_data: 'adm_delete_' + productId }],
    [{ text: wideInlineLabel('◀️ Quay lại'), callback_data: 'adm_back_list' }]
  ];
}

const pendingOrders = new Map();
const pendingDeposits = new Map();
const processingOrders = new Set(); 

function generateCode(prefix = '') {
  const existingCodes = new Set([...pendingOrders.values()].map(o => o.content));
  let code;
  let attempts = 0;
  do {
    code = (prefix ? prefix : '') + Math.random().toString(36).substring(2, 8).toUpperCase();
    attempts++;
  } while (existingCodes.has(code) && attempts < 100);
  return code;
}

function getQRUrl(amount, content) {
  return `https://img.vietqr.io/image/${config.BANK_BIN}-${config.BANK_ACCOUNT}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(content)}`;
}

async function renderTopNapMessage() {
  const topList = await db.getTopDepositors(10);
  let text = '🏆 <b>BẢNG XẾP HẠNG TOP NẠP TIỀN</b> 🏆\n' +
             '━━━━━━━━━━━━━━━━━━━━━\n\n';

  if (!topList || topList.length === 0) {
    text += '⛄ <i>Chưa có dữ liệu nạp tiền nào!</i>';
  } else {
    topList.forEach((u, idx) => {
      let icon = '🔹';
      if (idx === 0) icon = '🥇 Top 1:';
      else if (idx === 1) icon = '🥈 Top 2:';
      else if (idx === 2) icon = '🥉 Top 3:';
      else icon = `<b>#${idx + 1}</b>:`;

      text += `${icon} <b>${u.firstName}</b> (<code>${maskUserId(u.userId)}</code>)\n` +
              `   💵 Tổng nạp: <b>${formatPrice(u.totalDeposited)}</b>\n\n`;
    });
    text += '💡 <i>Nạp tiền tự động qua ví để có tên trên bảng vàng nhé!</i>';
  }
  return text;
}

async function startBot() {
  await db.initDB();

  setInterval(async () => {
    await db.keepAlive();
  }, 5 * 60 * 1000);
  console.log('🔄 Database keep-alive: mỗi 5 phút');

  // Khôi phục orders pending từ DB
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
  console.log('📦 Loaded ' + savedOrders.length + ' pending orders từ DB');

  // Khôi phục deposits pending từ DB
  const savedDeposits = await db.getPendingDeposits();
  savedDeposits.forEach(d => {
    pendingDeposits.set(d.id, {
      userId: d.userId,
      amount: d.amount,
      content: d.content,
      createdAt: d.createdAt
    });
  });
  console.log('💳 Loaded ' + savedDeposits.length + ' pending deposits từ DB');

  const bot = new TelegramBot(config.BOT_TOKEN, {
    polling: { params: { timeout: 10 }, interval: 300 }
  });

  bot.setMyCommands([
    { command: 'start', description: 'Bắt đầu' },
    { command: 'menu', description: 'Mua hàng' },
    { command: 'topnap', description: '🏆 Bảng xếp hạng nạp' }
  ]);

  // Commands riêng cho ADMIN
  config.ADMIN_IDS.forEach(adminId => {
    bot.setMyCommands([
      { command: 'products', description: '⚙️ Quản lý sản phẩm' },
      { command: 'orders', description: '📦 Đơn hàng' },
      { command: 'revenue', description: '📈 Doanh thu' },
      { command: 'stats', description: '📊 Tồn kho' },
      { command: 'users', description: '👥 Users & Số dư' },
      { command: 'broadcast', description: '📣 Thông báo' },
      { command: 'setmoney', description: '💵 Set số dư user' },
      { command: 'topnap', description: '🏆 Bảng xếp hạng nạp' }
    ], { scope: { type: 'chat', chat_id: adminId } });
  });

  bot.on('polling_error', (err) => console.log('Polling error:', err.message));

  // Tự động quét SePay
  setInterval(async () => {
    if (pendingOrders.size === 0 && pendingDeposits.size === 0) return; 
    
    const now = Date.now();
    const transactions = await sepay.getTransactions();

    // 1. Quét kiểm tra đơn mua sản phẩm
    for (const [orderId, order] of pendingOrders) {
      if (processingOrders.has(orderId)) continue;
      if (now - order.createdAt > ORDER_TIMEOUT_MS) {
        pendingOrders.delete(orderId);
        await db.updateOrder(orderId, null, 'expired');
        bot.sendMessage(order.chatId, '✖️ Đơn #' + orderId + ' đã hết hạn do không thanh toán trong 20 phút.\n\n⚡ Mua lại? Gõ /menu');
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
          if (stock) { await db.markStockSold(stock.id, order.userId); accounts.push(stock.account_data); }
        }
        if (accounts.length > 0) {
          await db.updateOrder(orderId, null, 'completed');
          let accText = accounts.map((a, idx) => '  ' + (idx + 1) + '. ' + a).join('\n');
          const successMsg = '✅ THANH TOÁN THÀNH CÔNG!\n' +
                             '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                             '🎁 ' + product.name + ' x' + order.quantity + '\n\n' +
                             '🔑 TÀI KHOẢN:\n' +
                             accText + '\n\n' +
                             '⚠️ Đổi mật khẩu ngay!\n' +
                             '⛄ Cảm ơn bạn đã mua hàng!\n' +
                             '🛒 Mua thêm? Gõ /menu';
          bot.sendMessage(order.chatId, successMsg);
          config.ADMIN_IDS.forEach(id => bot.sendMessage(id, '🔔 Đơn #' + orderId + ' ĐÃ THANH TOÁN\n👤 User: ' + order.userId + '\n🎁 ' + product.name + ' x' + order.quantity + '\n💵 ' + formatPrice(order.totalPrice)));
        }
      }
      
      processingOrders.delete(orderId);
    }

    // 2. Quét kiểm tra đơn nạp tiền vào ví
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
        
        bot.sendMessage(dep.userId, `🎉 <b>NẠP TIỀN THÀNH CÔNG!</b>\n\n➕ Đã cộng: <b>${formatPrice(dep.amount)}</b>\n💳 Số dư ví hiện tại: <b>${formatPrice(newBal)}</b>\n\n🛒 Mua hàng ngay? Gõ /menu`, { parse_mode: 'HTML' });
        config.ADMIN_IDS.forEach(id => bot.sendMessage(id, `🔔 <b>NẠP TIỀN THÀNH CÔNG</b>\n👤 User: <code>${dep.userId}</code>\n💵 Số tiền: <b>${formatPrice(dep.amount)}</b>\n💰 Số dư mới: <b>${formatPrice(newBal)}</b>`, { parse_mode: 'HTML' }));
      }
    }
  }, 30000);

  const getAdminUsername = () => (config.ADMIN_USER_NAME || '').trim().replace('@', '');

  bot.onText(/\/start|\/menu/, async (msg) => {
    await db.saveUser(msg.from.id, getFullName(msg.from), msg.from.username || '');
    const products = await db.getAllProducts();
    const keyboard = products.map(p => [{ text: wideInlineLabel('🎁 ' + p.name + ' ┃ ' + getDisplayPrice(p) + ' ┃ 📦' + p.stock_count), callback_data: 'product_' + p.id }]);
    keyboard.push([{ text: wideInlineLabel('👤 Hồ sơ & Nạp ví'), callback_data: 'main_profile' }, { text: wideInlineLabel('🏆 Top Nạp'), callback_data: 'main_topnap' }]);
    keyboard.push([{ text: wideInlineLabel('📋 Lịch sử mua hàng'), callback_data: 'main_history' }]);
    const adminUser = getAdminUsername();
    if (adminUser) keyboard.push([{ text: wideInlineLabel('💬 Liên hệ Admin'), url: 'https://t.me/' + adminUser }]);
    const text = '⛄ ' + config.SHOP_NAME + '\n' +
                 '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                 '✨ Xin chào, ' + getFullName(msg.from) + '!\n\n' +
                 (products.length > 0 ? '🛒 Chọn sản phẩm để mua:' : '⛄ Chưa có sản phẩm nào!');
    bot.sendMessage(msg.chat.id, text, { reply_markup: { inline_keyboard: keyboard } });
  });

  // Lệnh xem Top Nạp nhanh
  bot.onText(/\/topnap/, async (msg) => {
    const text = await renderTopNapMessage();
    bot.sendMessage(msg.chat.id, text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('💳 Nạp tiền ngay'), callback_data: 'deposit_menu' }]] }
    });
  });

  bot.onText(/\/myid/, (msg) => {
    bot.sendMessage(msg.chat.id, '🔖 User ID: ' + msg.from.id);
  });

  bot.onText(/\/clear/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const chatId = msg.chat.id;
    let deleted = 0;

    bot.sendMessage(chatId, '⏳ Đang xóa tin nhắn...').then(async (sentMsg) => {
      for (let i = msg.message_id; i > msg.message_id - 50; i--) {
        try {
          await bot.deleteMessage(chatId, i);
          deleted++;
        } catch (e) { }
      }
      try { await bot.deleteMessage(chatId, sentMsg.message_id); } catch (e) { }
      bot.sendMessage(chatId, '🎯 Đã xóa ' + deleted + ' tin nhắn!').then(m => {
        setTimeout(() => { try { bot.deleteMessage(chatId, m.message_id); } catch (e) { } }, 3000);
      });
    });
  });

  // /setmoney
  bot.onText(/\/setmoney(?:\s+(\d+)\s+(\d+))?/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const targetUserId = match[1];
    const amount = parseInt(match[2], 10);

    if (!targetUserId || isNaN(amount)) {
      return bot.sendMessage(msg.chat.id, '⚠️ <b>Sai cú pháp!</b>\n👉 Dùng: <code>/setmoney &lt;ID_User&gt; &lt;Số_tiền&gt;</code>\nVí dụ: <code>/setmoney 123456789 50000</code>', { parse_mode: 'HTML' });
    }

    try {
      await db.setUserBalance(targetUserId, amount);
      await bot.sendMessage(msg.chat.id, `✅ Đã đặt số dư cho user <code>${targetUserId}</code> thành: <b>${formatPrice(amount)}</b>`, { parse_mode: 'HTML' });

      try {
        await bot.sendMessage(targetUserId, `🎉 Số dư ví của bạn vừa được cập nhật: <b>${formatPrice(amount)}</b>`, { parse_mode: 'HTML' });
      } catch (_) {}
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Lỗi: ${err.message}`);
    }
  });

  async function createDepositQR(chatId, userTgId, amount, oldMessageId) {
    const content = generateCode('NAP');
    const deposit = await db.createDeposit(userTgId, amount, content);
    pendingDeposits.set(deposit.id, { userId: userTgId, amount, content, createdAt: deposit.createdAt });

    const caption = '💳 NẠP TIỀN VÀO VÍ TỰ ĐỘNG\n' +
                    '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                    '💵 Số tiền: <b>' + formatPrice(amount) + '</b>\n\n' +
                    '🏦 THÔNG TIN CHUYỂN KHOẢN:\n' +
                    '• Ngân hàng: ' + config.BANK_NAME + '\n' +
                    '• STK: ' + config.BANK_ACCOUNT + '\n' +
                    '• Chủ TK: ' + config.BANK_OWNER + '\n' +
                    '• Nội dung: <code>' + content + '</code>\n\n' +
                    '📲 Quét QR hoặc chuyển đúng nội dung để hệ thống tự cộng tiền sau 15-30 giây.\n' +
                    '⚠️ Đơn nạp hết hạn sau 20 phút.';

    if (oldMessageId) {
      try { await bot.deleteMessage(chatId, oldMessageId); } catch (_) {}
    }

    await bot.sendPhoto(chatId, getQRUrl(amount, content), {
      caption: caption,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('◀️ Quay lại hồ sơ'), callback_data: 'main_profile' }]] }
    });
  }

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    try {
      if (data === 'main_shop' || data === 'back_main') {
        const products = await db.getAllProducts();
        const keyboard = products.map(p => [{ text: wideInlineLabel('🎁 ' + p.name + ' ┃ ' + getDisplayPrice(p) + ' ┃ 📦' + p.stock_count), callback_data: 'product_' + p.id }]);
        keyboard.push([{ text: wideInlineLabel('👤 Hồ sơ & Nạp ví'), callback_data: 'main_profile' }, { text: wideInlineLabel('🏆 Top Nạp'), callback_data: 'main_topnap' }]);
        keyboard.push([{ text: wideInlineLabel('📋 Lịch sử mua hàng'), callback_data: 'main_history' }]);
        const text = '🛒 CỬA HÀNG\n' +
                     '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                     (products.length > 0 ? '⛄ Chọn sản phẩm:' : '⛄ Chưa có sản phẩm nào!');
        if (query.message.photo) {
          await bot.deleteMessage(chatId, query.message.message_id);
          bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
        } else {
          bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: keyboard } });
        }
      }

      // Xử lý nút bấm xem Top Nạp
      if (data === 'main_topnap') {
        const text = await renderTopNapMessage();
        const keyboard = [
          [{ text: wideInlineLabel('💳 Nạp tiền ngay'), callback_data: 'deposit_menu' }],
          [{ text: wideInlineLabel('◀️ Quay lại'), callback_data: 'back_main' }]
        ];
        if (query.message.photo) {
          await bot.deleteMessage(chatId, query.message.message_id);
          bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
        } else {
          bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
        }
      }

      if (data === 'main_profile') {
        const orders = await db.getOrdersByUser(userId);
        const completed = orders.filter(o => o.status === 'completed');
        const totalSpent = completed.reduce((sum, o) => sum + (o.total_price || 0), 0);
        const balance = await db.getUserBalance(userId);

        const text = '👤 HỒ SƠ CỦA BẠN\n' +
                     '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                     '🆔 ID: ' + userId + '\n' +
                     '✨ Tên: ' + getFullName(query.from) + '\n' +
                     '📧 Username: ' + (query.from.username ? '@' + query.from.username : 'Chưa có') + '\n\n' +
                     '💳 SỐ DƯ VÍ: <b>' + formatPrice(balance) + '</b>\n\n' +
                     '📊 THỐNG KÊ\n' +
                     '🛍️ Đơn hoàn thành: ' + completed.length + '\n' +
                     '💰 Đã chi tiêu: ' + formatPrice(totalSpent);
        const keyboard = [
          [{ text: wideInlineLabel('💳 Nạp tiền vào ví'), callback_data: 'deposit_menu' }],
          [{ text: wideInlineLabel('🏆 Xem Top Nạp'), callback_data: 'main_topnap' }],
          [{ text: wideInlineLabel('◀️ Quay lại cửa hàng'), callback_data: 'back_main' }]
        ];
        if (query.message.photo) {
          await bot.deleteMessage(chatId, query.message.message_id);
          bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
        } else {
          bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
        }
      }

      if (data === 'deposit_menu') {
        const text = '💳 NẠP TIỀN VÀO VÍ\n' +
                     '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                     '💡 Chọn mức tiền muốn nạp hoặc nhập số tiền tùy chọn:';
        const keyboard = [
          [{ text: wideInlineLabel('20.000 đ'), callback_data: 'dep_amt_20000' }, { text: wideInlineLabel('50.000 đ'), callback_data: 'dep_amt_50000' }],
          [{ text: wideInlineLabel('100.000 đ'), callback_data: 'dep_amt_100000' }, { text: wideInlineLabel('200.000 đ'), callback_data: 'dep_amt_200000' }],
          [{ text: wideInlineLabel('500.000 đ'), callback_data: 'dep_amt_500000' }, { text: wideInlineLabel('✏️ Nhập số khác'), callback_data: 'dep_custom' }],
          [{ text: wideInlineLabel('◀️ Quay lại hồ sơ'), callback_data: 'main_profile' }]
        ];
        if (query.message.photo) {
          await bot.deleteMessage(chatId, query.message.message_id);
          bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
        } else {
          bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: keyboard } });
        }
      }

      if (data.startsWith('dep_amt_')) {
        const amount = parseInt(data.split('_')[2], 10);
        await createDepositQR(chatId, userId, amount, query.message.message_id);
        return;
      }

      if (data === 'dep_custom') {
        waitingEdit.set(userId, { field: 'custom_deposit', messageId: query.message.message_id });
        const text = '✏️ NHẬP SỐ TIỀN CẦN NẠP\n' +
                     '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                     'Nhập số tiền muốn nạp (tối thiểu 10.000 VND):\n' +
                     'Ví dụ: <code>150000</code>';
        bot.editMessageText(text, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy'), callback_data: 'deposit_menu' }]] }
        });
        return;
      }

      if (data === 'main_history') {
        const orders = await db.getOrderHistory(userId);
        if (orders.length === 0) return bot.answerCallbackQuery(query.id, { text: '❄️ Chưa có lịch sử!' });
        let text = '📋 LỊCH SỬ MUA HÀNG\n' +
                   '━━━━━━━━━━━━━━━━━━━━━\n\n';
        orders.slice(0, 10).forEach((o, idx) => {
          const statusIcon = o.status === 'completed' ? '✅' : o.status === 'pending' ? '⏳' : o.status === 'expired' ? '⌛' : '❌';
          const statusText = o.status === 'completed' ? 'Thành công' : o.status === 'pending' ? 'Chờ TT' : o.status === 'expired' ? 'Hết hạn' : 'Đã hủy';
          text += statusIcon + ' Đơn #' + o.id + ' • ' + statusText + '\n';
          text += '   🎁 ' + o.product_name + ' x' + (o.quantity || 1) + '\n';
          text += '   💵 ' + formatPrice(o.total_price || 0) + '\n';
          if (idx < orders.length - 1) text += '\n';
        });
        bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('◀️ Quay lại'), callback_data: 'back_main' }]] } });
      }

      if (data.startsWith('product_')) {
        const product = await db.getProduct(parseInt(data.split('_')[1]));
        if (!product) return bot.answerCallbackQuery(query.id, { text: '❄️ Không tồn tại!' });
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
        if (stock > 10) {
          const unitPrice = db.getUnitPrice(product, stock);
          const label = unitPrice < product.price ? '『MAX:' + stock + '』 ' + formatPrice(unitPrice) : '『MAX:' + stock + '』';
          qtyButtons.push({ text: wideInlineLabel(label), callback_data: 'qty_' + product.id + '_' + stock });
        }
        
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
        keyboard.push([{ text: wideInlineLabel('◀️ Quay lại'), callback_data: 'main_shop' }]);
        
        const text = '🎁 ' + product.name + '\n' +
                     '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                     productPriceBlockUser(product) +
                     '📊 Còn: ' + stock + ' sản phẩm\n' +
                     (product.description ? '📝 ' + product.description + '\n' : '') +
                     '\n⛄ Chọn số lượng:';
        bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: keyboard } });
      }
      
      if (data.startsWith('customqty_')) {
        const productId = parseInt(data.split('_')[1]);
        const product = await db.getProduct(productId);
        if (!product) return bot.answerCallbackQuery(query.id, { text: '❄️ Không tồn tại!' });
        waitingEdit.set(userId, { field: 'custom_qty', productId, messageId: query.message.message_id });
        
        const text = '📝 NHẬP SỐ LƯỢNG\n' +
                     '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                     '📦 ' + product.name + '\n' +
                     productPriceBlockUser(product) +
                     '📊 Còn: ' + product.stock_count + ' sp\n\n' +
                     '✏️ Nhập số lượng muốn mua:';
        bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy'), callback_data: 'product_' + productId }]] } });
      }

      if (data.startsWith('qty_')) {
        const [, productId, quantity] = data.split('_');
        const product = await db.getProduct(parseInt(productId));
        const qty = parseInt(quantity);
        if (product.stock_count < qty) return bot.answerCallbackQuery(query.id, { text: '✖️ Không đủ hàng!', show_alert: true });

        const totalPrice = db.calculatePrice(product, qty);
        const unitPrice = db.getUnitPrice(product, qty);
        const userBalance = await db.getUserBalance(userId);

        const discountInfo = unitPrice < product.price ? '\n💎 Giá ưu đãi: ' + formatPrice(unitPrice) + '/sp' : '';
        const text = '🛒 XÁC NHẬN MUA HÀNG\n' +
                     '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                     '🎁 Sản phẩm: <b>' + product.name + '</b> x' + qty + discountInfo + '\n' +
                     '💰 Tổng thanh toán: <b>' + formatPrice(totalPrice) + '</b>\n\n' +
                     '💳 Số dư ví của bạn: <b>' + formatPrice(userBalance) + '</b>\n\n' +
                     '👇 Chọn hình thức thanh toán bên dưới:';

        const keyboard = [
          [{ text: wideInlineLabel('💳 Thanh toán bằng VÍ TIỀN'), callback_data: `paywallet_${productId}_${qty}` }],
          [{ text: wideInlineLabel('🏦 Chuyển khoản qua NGÂN HÀNG (QR)'), callback_data: `paybank_${productId}_${qty}` }],
          [{ text: wideInlineLabel('◀️ Quay lại'), callback_data: `product_${productId}` }]
        ];

        return bot.editMessageText(text, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        });
      }

      if (data.startsWith('paywallet_')) {
        const [, productId, quantity] = data.split('_');
        const product = await db.getProduct(parseInt(productId));
        const qty = parseInt(quantity);
        const totalPrice = db.calculatePrice(product, qty);
        const userBalance = await db.getUserBalance(userId);

        if (userBalance < totalPrice) {
          const missing = totalPrice - userBalance;
          return bot.answerCallbackQuery(query.id, {
            text: `❌ Số dư không đủ! Bạn còn thiếu ${formatPrice(missing)}. Hãy nạp thêm tiền vào ví!`,
            show_alert: true
          });
        }

        if (product.stock_count < qty) {
          return bot.answerCallbackQuery(query.id, { text: '✖️ Rất tiếc, sản phẩm vừa hết hàng trong kho!', show_alert: true });
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
        await db.updateOrder(order.lastInsertRowid, null, 'completed');

        const remainingBal = await db.getUserBalance(userId);
        let accText = accounts.map((a, idx) => '  ' + (idx + 1) + '. ' + a).join('\n');

        await bot.deleteMessage(chatId, query.message.message_id);
        const successMsg = '✅ THANH TOÁN BẰNG VÍ THÀNH CÔNG!\n' +
                           '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                           '🎁 ' + product.name + ' x' + qty + '\n' +
                           '💳 Đã trừ ví: <b>' + formatPrice(totalPrice) + '</b>\n' +
                           '💰 Số dư ví còn lại: <b>' + formatPrice(remainingBal) + '</b>\n\n' +
                           '🔑 TÀI KHOẢN CỦA BẠN:\n' +
                           accText + '\n\n' +
                           '⚠️ Đổi mật khẩu ngay để bảo mật!\n' +
                           '🛒 Mua thêm? Gõ /menu';

        await bot.sendMessage(chatId, successMsg, { parse_mode: 'HTML' });
        config.ADMIN_IDS.forEach(id => bot.sendMessage(id, `🔔 Đơn #${order.lastInsertRowid} (THANH TOÁN BẰNG VÍ)\n👤 User: <code>${userId}</code>\n🎁 ${product.name} x${qty}\n💵 ${formatPrice(totalPrice)}`));
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
        const caption = '💳 THANH TOÁN ĐƠN #' + orderId + '\n' +
                        '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                        '🎁 ' + product.name + ' x' + qty + discountInfo + '\n' +
                        '💰 Cần chuyển: ' + formatPrice(totalPrice) + '\n\n' +
                        '🏦 THÔNG TIN CHUYỂN KHOẢN\n' +
                        '• NH: ' + config.BANK_NAME + '\n' +
                        '• STK: ' + config.BANK_ACCOUNT + '\n' +
                        '• Chủ TK: ' + config.BANK_OWNER + '\n' +
                        '• Nội dung: ' + content + '\n\n' +
                        '📲 Quét QR để chuyển khoản\n' +
                        '⏳ Tự động giao tài khoản khi nhận tiền';

        await bot.sendPhoto(chatId, getQRUrl(totalPrice, content), {
          caption: caption,
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
        if (!order) return bot.answerCallbackQuery(query.id, { text: '✖️ Đơn hàng không tồn tại hoặc đã xử lý!', show_alert: true });
        
        if (processingOrders.has(orderIdNum)) {
          return bot.answerCallbackQuery(query.id, { text: '⏳ Đang xử lý, vui lòng chờ...', show_alert: true });
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
            if (stock) { await db.markStockSold(stock.id, userId); accounts.push(stock.account_data); }
          }
          if (accounts.length > 0) {
            await db.updateOrder(orderIdNum, null, 'completed');
            let accText = accounts.map((a, idx) => '  ' + (idx + 1) + '. ' + a).join('\n');
            bot.answerCallbackQuery(query.id, { text: '✅ Thanh toán thành công!' });
            const successMsg = '✅ THANH TOÁN THÀNH CÔNG!\n' +
                               '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                               '🎁 ' + product.name + ' x' + qty + '\n\n' +
                               '🔑 TÀI KHOẢN:\n' +
                               accText + '\n\n' +
                               '⚠️ Đổi mật khẩu ngay!\n' +
                               '⛄ Cảm ơn bạn đã mua hàng!\n' +
                               '🛒 Mua thêm? Gõ /menu';
            await bot.sendMessage(chatId, successMsg);
            config.ADMIN_IDS.forEach(id => bot.sendMessage(id, '🔔 Đơn #' + orderId + ' ĐÃ THANH TOÁN\n👤 ' + getFullName(query.from) + ' (' + userId + ')\n🎁 ' + product.name + ' x' + qty + '\n💵 ' + formatPrice(order.totalPrice)));
          }
        } else {
          bot.answerCallbackQuery(query.id, { text: '❄️ Chưa nhận được thanh toán! Thử lại sau.', show_alert: true });
        }
        
        processingOrders.delete(orderIdNum);
        return;
      }

      if (data === 'cancel_broadcast') {
        waitingEdit.delete(userId);
        bot.editMessageText('❌ Đã hủy gửi thông báo.', { chat_id: chatId, message_id: query.message.message_id });
        return;
      }

      if (data.startsWith('cancel_') || data === 'back_menu') {
        if (data.startsWith('cancel_')) {
          const orderId = parseInt(data.split('_')[1]);
          if (pendingOrders.has(orderId)) {
            pendingOrders.delete(orderId);
            await db.updateOrder(orderId, null, 'cancelled');
          }
        }
        const products = await db.getAllProducts();
        const keyboard = products.map(p => [{ text: wideInlineLabel('🎁 ' + p.name + ' ┃ ' + getDisplayPrice(p) + ' ┃ 📦' + p.stock_count), callback_data: 'product_' + p.id }]);
        keyboard.push([{ text: wideInlineLabel('👤 Hồ sơ & Nạp ví'), callback_data: 'main_profile' }, { text: wideInlineLabel('🏆 Top Nạp'), callback_data: 'main_topnap' }]);
        keyboard.push([{ text: wideInlineLabel('📋 Lịch sử mua hàng'), callback_data: 'main_history' }]);
        const text = '🛒 CỬA HÀNG\n' +
                     '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                     (products.length > 0 ? '⛄ Chọn sản phẩm:' : '⛄ Chưa có sản phẩm nào!');
        if (query.message.photo) {
          await bot.deleteMessage(chatId, query.message.message_id);
          bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
        } else {
          bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: keyboard } });
        }
      }

      // ===== ADMIN CALLBACKS =====
      if (data.startsWith('adm_') && isAdmin(userId)) {

        if (data.startsWith('adm_product_')) {
          const productId = parseInt(data.split('_')[2]);
          const product = await db.getProduct(productId);
          if (!product) return bot.answerCallbackQuery(query.id, { text: '❄️ Không tồn tại!' });
          const stocks = await db.getStockByProduct(productId);
          const available = stocks.filter(s => !s.is_sold).length;
          const sold = stocks.length - available;

          const text = '📦 ' + product.name + ' (#' + product.id + ')\n' +
                       '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                       productPriceBlockAdmin(product) +
                       '📝 Mô tả: ' + (product.description || 'Chưa có') + '\n\n' +
                       '📊 KHO: ✅' + available + ' còn │ 🔴' + sold + ' đã bán';
          bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: adminProductKeyboard(productId) } });
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
                       '(Mua 1-9: 50k, 10-19: 45k, 20+: 40k)\n\n' +
                       '💡 Nhập "xoa" để xóa bảng giá';
          bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]] } });
        }

        if (data === 'adm_back_list') {
          const products = await db.getAllProducts();
          const keyboard = products.map(p => [{ text: wideInlineLabel('📦 #' + p.id + ' ' + p.name + ' ┃ 🎯' + p.stock_count), callback_data: 'adm_product_' + p.id }]);
          keyboard.push([{ text: wideInlineLabel('➕ Thêm sản phẩm mới'), callback_data: 'adm_add_product' }]);
          const text = '⚙️ QUẢN LÝ SẢN PHẨM\n' +
                       '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                       '📊 Tổng: ' + products.length + ' sản phẩm\n' +
                       '⛄ Chọn để sửa/xóa:';
          bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: keyboard } });
        }

        if (data === 'adm_add_product') {
          waitingEdit.set(userId, { field: 'new_product', messageId: query.message.message_id });
          const text = '➕ THÊM SẢN PHẨM MỚI\n' +
                       '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                       '📝 Nhập theo format:\n' +
                       'Tên|Giá|Mô tả\n\n' +
                       '▸ Ví dụ:\n' +
                       'Netflix 1 tháng|50000|Premium';
          bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy'), callback_data: 'adm_back_list' }]] } });
        }

        if (data.startsWith('adm_edit_name_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'name', messageId: query.message.message_id });
          bot.editMessageText('✏️ Nhập tên mới cho sản phẩm #' + productId + ':', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]] } });
        }

        if (data.startsWith('adm_edit_price_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'price', messageId: query.message.message_id });
          bot.editMessageText('💵 Nhập giá mới (số) cho sản phẩm #' + productId + ':', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]] } });
        }

        if (data.startsWith('adm_edit_desc_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'desc', messageId: query.message.message_id });
          bot.editMessageText('📝 Nhập mô tả mới cho sản phẩm #' + productId + ':', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]] } });
        }

        if (data.startsWith('adm_addstock_')) {
          const productId = parseInt(data.split('_')[2]);
          const product = await db.getProduct(productId);
          waitingStock.set(userId, productId);
          bot.editMessageText('➕ Thêm stock cho: ' + product.name + '\n\nGửi danh sách tài khoản (mỗi dòng 1 tk):', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]] } });
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
          bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: keyboard } });
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
          bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: keyboard } });
        }

        if (data.startsWith('adm_clearstock_')) {
          const productId = parseInt(data.split('_')[2]);
          const product = await db.getProduct(productId);
          const stocks = await db.getStockByProduct(productId);
          const available = stocks.filter(s => !s.is_sold).length;
          bot.editMessageText('⚠️ Xác nhận xóa TẤT CẢ stock?\n\n📦 ' + product.name + '\n🗑️ Sẽ xóa: ' + available + ' tài khoản\n\nHành động này không thể hoàn tác!',
            { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('🗑️ Xóa hết'), callback_data: 'adm_confirmclear_' + productId }, { text: wideInlineLabel('✖️ Hủy'), callback_data: 'adm_viewstock_' + productId }]] } });
        }

        if (data.startsWith('adm_confirmclear_')) {
          const productId = parseInt(data.split('_')[2]);
          await db.clearStock(productId);
          bot.answerCallbackQuery(query.id, { text: '🎯 Đã xóa tất cả stock!' });
          const product = await db.getProduct(productId);
          const stocks = await db.getStockByProduct(productId);
          const available = stocks.filter(s => !s.is_sold).length;
          const sold = stocks.length - available;
          const text = '📦 ' + product.name + '\n\n◉ ID: #' + product.id + '\n' + productPriceBlockAdmin(product) + '◉ Mô tả: ' + (product.description || 'Chưa có') + '\n\n📊 Kho hàng:\n◉ Còn: ' + available + '\n◉ Đã bán: ' + sold;
          bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: adminProductKeyboard(productId) } });
        }

        if (data.startsWith('adm_delete_')) {
          const productId = parseInt(data.split('_')[2]);
          const product = await db.getProduct(productId);
          bot.editMessageText('⚠️ Xác nhận xóa sản phẩm:\n\n📦 ' + product.name + '\n\nHành động này không thể hoàn tác!', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('🗑️ Xóa luôn'), callback_data: 'adm_confirm_delete_' + productId }, { text: wideInlineLabel('✖️ Hủy'), callback_data: 'adm_product_' + productId }]] } });
        }

        if (data.startsWith('adm_confirm_delete_')) {
          const productId = parseInt(data.split('_')[3]);
          await db.deleteProduct(productId);
          const products = await db.getAllProducts();
          const keyboard = products.map(p => [{ text: wideInlineLabel('#' + p.id + ' ' + p.name + ' | 📦 ' + p.stock_count), callback_data: 'adm_product_' + p.id }]);
          keyboard.push([{ text: wideInlineLabel('➕ Thêm sản phẩm mới'), callback_data: 'adm_add_product' }]);
          bot.editMessageText('🎯 Đã xóa sản phẩm #' + productId + '!\n\n⚙️ Quản lý sản phẩm:', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: keyboard } });
        }
      }

    } catch (e) { console.log('Callback error:', e.message); }
    bot.answerCallbackQuery(query.id);
  });

  const waitingStock = new Map();
  const waitingEdit = new Map();

  // ===== ADMIN: Quản lý sản phẩm bằng menu =====
  bot.onText(/\/products/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const products = await db.getAllProducts();
    const keyboard = products.map(p => [{ text: wideInlineLabel('📦 #' + p.id + ' ' + p.name + ' ┃ 🎯' + p.stock_count), callback_data: 'adm_product_' + p.id }]);
    keyboard.push([{ text: wideInlineLabel('➕ Thêm sản phẩm mới'), callback_data: 'adm_add_product' }]);
    const text = '⚙️ QUẢN LÝ SẢN PHẨM\n' +
                 '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                 '📊 Tổng: ' + products.length + ' sản phẩm\n' +
                 '⛄ Chọn để sửa/xóa:';
    bot.sendMessage(msg.chat.id, text, { reply_markup: { inline_keyboard: keyboard } });
  });

  bot.onText(/\/revenue/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const stats = await db.getRevenue();
    const products = await db.getAllProducts();
    let totalStock = 0;
    products.forEach(p => totalStock += p.stock_count);
    const text = '💰 DOANH THU\n' +
                 '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                 '💵 Tổng thu: ' + formatPrice(stats.total_revenue) + '\n' +
                 '✅ Đơn hoàn thành: ' + stats.total_orders + '\n\n' +
                 '📊 TỔNG QUAN\n' +
                 '📦 Sản phẩm: ' + products.length + '\n' +
                 '🎯 Tồn kho: ' + totalStock;
    bot.sendMessage(msg.chat.id, text);
  });

  bot.onText(/\/orders/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const orders = await db.getRecentOrders(20);
    if (orders.length === 0) {
      return bot.sendMessage(msg.chat.id, '📦 ĐƠN HÀNG\n━━━━━━━━━━━━━━━━━━━━━\n\n⛄ Chưa có đơn hàng nào!');
    }
    let text = '📦 ĐƠN HÀNG GẦN ĐÂY\n' +
               '━━━━━━━━━━━━━━━━━━━━━\n\n';
    orders.forEach((o, idx) => {
      const icon = o.status === 'completed' ? '✅' : o.status === 'pending' ? '⏳' : '❌';
      const time = o.created_at ? new Date(o.created_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'N/A';
      text += icon + ' #' + o.id + ' │ ' + o.user_name + '\n';
      text += '   🎁 ' + o.product_name + ' x' + o.quantity + '\n';
      text += '   💵 ' + formatPrice(o.total_price || 0) + ' │ 🕐 ' + time + '\n';
      if (idx < orders.length - 1) text += '\n';
    });
    bot.sendMessage(msg.chat.id, text);
  });

  bot.onText(/\/stats/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const products = await db.getAllProducts();
    let text = '📊 TỒN KHO\n' +
               '━━━━━━━━━━━━━━━━━━━━━\n\n';
    if (products.length === 0) {
      text += '⛄ Chưa có sản phẩm nào!';
    } else {
      let total = 0;
      products.forEach(p => {
        const status = p.stock_count > 0 ? '✅' : '🔴';
        text += status + ' ' + p.name + ': ' + p.stock_count + '\n';
        total += p.stock_count;
      });
      text += '\n📦 Tổng: ' + total;
    }
    bot.sendMessage(msg.chat.id, text);
  });

  bot.onText(/^\/broadcast$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const users = await db.getAllUsers();
    waitingEdit.set(msg.from.id, { field: 'broadcast' });
    const text = '📣 GỬI THÔNG BÁO\n' +
                 '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                 '👥 Sẽ gửi đến: ' + users.length + ' users\n\n' +
                 '✏️ Nhập nội dung thông báo:';
    bot.sendMessage(msg.chat.id, text, {
      reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy'), callback_data: 'cancel_broadcast' }]] }
    });
  });

  bot.onText(/\/broadcast (.+)/s, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const users = await db.getAllUsers();
    let sent = 0, failed = 0;
    for (const user of users) {
      try { await bot.sendMessage(user.id, '📣 Thông báo:\n\n' + match[1]); sent++; }
      catch (e) { failed++; }
    }
    const text = '✅ ĐÃ GỬI THÔNG BÁO\n' +
                 '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                 '✅ Thành công: ' + sent + '\n' +
                 '❌ Thất bại: ' + failed;
    bot.sendMessage(msg.chat.id, text);
  });

  bot.onText(/\/users/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const users = await db.getAllUsers();
    let text = '👥 DANH SÁCH USER & VÍ\n' +
               '━━━━━━━━━━━━━━━━━━━━━\n\n';
    if (users.length === 0) {
      text += '⛄ Chưa có user nào!';
    } else {
      text += '📊 Tổng: ' + users.length + ' users\n\n';
      users.slice(0, 50).forEach((u, i) => {
        text += (i + 1) + '. ' + u.first_name + ' │ <code>' + u.id + '</code> │ 💳 ' + formatPrice(u.balance) + '\n';
      });
    }
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  // Handler xử lý text
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
        return bot.sendMessage(msg.chat.id, '✖️ Số lượng không hợp lệ! Nhập số nguyên > 0', {
          reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy'), callback_data: 'product_' + editInfo.productId }]] }
        });
      }
      
      if (qty > product.stock_count) {
        return bot.sendMessage(msg.chat.id, '✖️ Không đủ hàng! Chỉ còn ' + product.stock_count + ' sản phẩm.', {
          reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy'), callback_data: 'product_' + editInfo.productId }]] }
        });
      }
      
      waitingEdit.delete(msg.from.id);
      
      const totalPrice = db.calculatePrice(product, qty);
      const unitPrice = db.getUnitPrice(product, qty);
      const userBalance = await db.getUserBalance(msg.from.id);

      const discountInfo = unitPrice < product.price ? '\n💎 Giá ưu đãi: ' + formatPrice(unitPrice) + '/sp' : '';
      const text = '🛒 XÁC NHẬN MUA HÀNG\n' +
                   '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                   '🎁 Sản phẩm: <b>' + product.name + '</b> x' + qty + discountInfo + '\n' +
                   '💰 Tổng thanh toán: <b>' + formatPrice(totalPrice) + '</b>\n\n' +
                   '💳 Số dư ví của bạn: <b>' + formatPrice(userBalance) + '</b>\n\n' +
                   '👇 Chọn hình thức thanh toán bên dưới:';

      const keyboard = [
        [{ text: wideInlineLabel('💳 Thanh toán bằng VÍ TIỀN'), callback_data: `paywallet_${editInfo.productId}_${qty}` }],
        [{ text: wideInlineLabel('🏦 Chuyển khoản qua NGÂN HÀNG (QR)'), callback_data: `paybank_${editInfo.productId}_${qty}` }],
        [{ text: wideInlineLabel('◀️ Quay lại'), callback_data: `product_${editInfo.productId}` }]
      ];

      return bot.sendMessage(msg.chat.id, text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    }

    if (editInfo.field === 'custom_deposit') {
      const amount = parseInt(msg.text.trim(), 10);
      waitingEdit.delete(msg.from.id);

      if (isNaN(amount) || amount < 10000) {
        return bot.sendMessage(msg.chat.id, '✖️ Số tiền không hợp lệ! Vui lòng nạp tối thiểu 10.000 VND.', {
          reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('◀️ Thử lại'), callback_data: 'deposit_menu' }]] }
        });
      }

      await createDepositQR(msg.chat.id, msg.from.id, amount, null);
      return;
    }
  });

  // Handler admin
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/') || !isAdmin(msg.from.id)) return;

    const pid = waitingStock.get(msg.from.id);
    if (pid) {
      const accs = msg.text.split('\n').filter(a => a.trim());
      for (const acc of accs) {
        await db.addStock(pid, acc.trim());
      }
      waitingStock.delete(msg.from.id);
      bot.sendMessage(msg.chat.id, '🎯 Đã thêm ' + accs.length + ' tài khoản!\n\nGõ /products để quản lý.');
      return;
    }

    const editInfo = waitingEdit.get(msg.from.id);
    if (editInfo) {
      if (editInfo.field === 'broadcast') {
        waitingEdit.delete(msg.from.id);
        const users = await db.getAllUsers();
        let sent = 0, failed = 0;
        
        bot.sendMessage(msg.chat.id, '⏳ Đang gửi thông báo đến ' + users.length + ' users...');
        
        for (const user of users) {
          try { await bot.sendMessage(user.id, '📣 Thông báo:\n\n' + msg.text); sent++; }
          catch (e) { failed++; }
        }
        
        const text = '✅ ĐÃ GỬI THÔNG BÁO\n' +
                     '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                     '✅ Thành công: ' + sent + '\n' +
                     '❌ Thất bại: ' + failed;
        bot.sendMessage(msg.chat.id, text);
        return;
      }
      
      if (editInfo.field === 'new_product') {
        const parts = msg.text.split('|').map(s => s.trim());
        const name = parts[0];
        const price = parseInt(parts[1]);
        const desc = parts.slice(2).join('|') || '';
        
        if (!name || isNaN(price) || price < 0) {
          return bot.sendMessage(msg.chat.id, '✖️ Sai format! Nhập lại:\nTên|Giá|Mô tả\n\nVí dụ: Netflix 1 tháng|50000|Tài khoản Premium', {
            reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy'), callback_data: 'adm_back_list' }]] }
          });
        }
        
        const result = await db.addProduct(name, price, desc);
        waitingEdit.delete(msg.from.id);
        
        const productId = result.lastInsertRowid;
        const text = '✅ ĐÃ THÊM SẢN PHẨM\n' +
                     '━━━━━━━━━━━━━━━━━━━━━\n\n' +
                     '📦 ' + name + ' (#' + productId + ')\n' +
                     '💰 Giá: ' + formatPrice(price) + '\n' +
                     '📝 Mô tả: ' + (desc || 'Chưa có') + '\n\n' +
                     '📊 KHO: ✅0 còn │ 🔴0 đã bán';
        bot.sendMessage(msg.chat.id, text, { reply_markup: { inline_keyboard: adminProductKeyboard(productId) } });
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

      if (editInfo.field === 'name') {
        newName = msg.text.trim();
      } else if (editInfo.field === 'price') {
        const priceNum = parseInt(msg.text.trim());
        if (isNaN(priceNum) || priceNum < 0) {
          return bot.sendMessage(msg.chat.id, '✖️ Giá không hợp lệ! Nhập số nguyên.', {
            reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy'), callback_data: 'adm_product_' + editInfo.productId }]] }
          });
        }
        newPrice = priceNum;
      } else if (editInfo.field === 'desc') {
        newDesc = msg.text.trim();
      } else if (editInfo.field === 'tiers') {
        const input = msg.text.trim().toLowerCase();
        
        if (input === 'xoa' || input === 'xóa') {
          await db.updatePriceTiers(editInfo.productId, null);
          waitingEdit.delete(msg.from.id);
          bot.sendMessage(msg.chat.id, '✅ Đã xóa bảng giá! Sẽ dùng giá gốc.\n\nGõ /products để quản lý.');
          return;
        }
        
        const tiers = [];
        const parts = msg.text.split(',').map(s => s.trim());
        for (const part of parts) {
          const [minStr, priceStr] = part.split(':').map(s => s.trim());
          const min = parseInt(minStr);
          const price = parseInt(priceStr);
          if (isNaN(min) || isNaN(price) || min < 1 || price < 0) {
            return bot.sendMessage(msg.chat.id, '✖️ Sai format! Ví dụ: 1:50000, 10:45000, 20:40000', {
              reply_markup: { inline_keyboard: [[{ text: wideInlineLabel('❌ Hủy'), callback_data: 'adm_product_' + editInfo.productId }]] }
            });
          }
          tiers.push({ min, price });
        }
        
        tiers.sort((a, b) => a.min - b.min);
        await db.updatePriceTiers(editInfo.productId, tiers);
        waitingEdit.delete(msg.from.id);
        
        const updatedProduct = await db.getProduct(editInfo.productId);
        const summary = updatedProduct.price_tiers?.length ? formatTierBullets(updatedProduct).trim() : '';
        bot.sendMessage(msg.chat.id, '✅ Đã cập nhật bảng giá!\n\n📦 ' + updatedProduct.name + '\n' + (summary ? summary + '\n\n' : '') + 'Gõ /products để quản lý.');
        return;
      }

      await db.updateProduct(editInfo.productId, newName, newPrice, newDesc);
      waitingEdit.delete(msg.from.id);

      const updatedProduct = await db.getProduct(editInfo.productId);
      const stocks = await db.getStockByProduct(editInfo.productId);
      const available = stocks.filter(s => !s.is_sold).length;
      const sold = stocks.length - available;

      const text = '🎯 Đã cập nhật!\n\n📦 ' + updatedProduct.name + '\n\n◉ ID: #' + updatedProduct.id + '\n' + productPriceBlockAdmin(updatedProduct) + '◉ Mô tả: ' + (updatedProduct.description || 'Chưa có') + '\n\n📊 Kho hàng:\n◉ Còn: ' + available + '\n◉ Đã bán: ' + sold;
      bot.sendMessage(msg.chat.id, text, { reply_markup: { inline_keyboard: adminProductKeyboard(editInfo.productId) } });
      return;
    }
  });

  console.log('🤖 ' + config.SHOP_NAME + ' đang chạy...');
}

startBot().catch(console.error);
