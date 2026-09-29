const TelegramBot = require('node-telegram-bot-api');
const os = require('os');
const { createCanvas, loadImage } = require('canvas');
const config = require('./config');
const db = require('./database');
const sepay = require('./sepay');

const formatPrice = (price) => (price || 0).toLocaleString('vi-VN') + 'đ';
const isAdmin = (userId) => config.ADMIN_IDS.map(id => id.toString()).includes(String(userId));
const getFullName = (user) => (user.first_name + (user.last_name ? ' ' + user.last_name : '')).trim();
const ORDER_TIMEOUT_MS = 20 * 60 * 1000;
const BOT_START_TIME = Date.now();

const FEEDBACK_CHANNEL_ID = '@feedbackhvnt';

let SELECTED_CITY = 'Hanoi';
let lastGreetedDay = { morning: '', noon: '', afternoon: '', night: '' };

let IS_MAINTENANCE = false;
const BLACKLIST_MAP = new Map(); // key: userId, value: reason

function isBlacklisted(userId) {
  return BLACKLIST_MAP.has(String(userId));
}

function getBanReason(userId) {
  return BLACKLIST_MAP.get(String(userId)) || 'Vi phạm điều khoản dịch vụ';
}

function maskUid(uid) {
  const s = uid.toString();
  const keep = Math.ceil(s.length / 2);
  return s.substring(0, keep) + '*'.repeat(s.length - keep);
}

const MESSAGES = {
  vi: {
    channel: '<tg-emoji emoji-id="6118209143972040877">📢</tg-emoji> <b>Kênh tin tức:</b> @hvntinfo',
    admin_support: '<tg-emoji emoji-id="5395804191769763641">👑</tg-emoji> <b>Hỗ trợ 24/7:</b> @accffgiatot',
    acc_info: '<b>TÀI KHOẢN & SỐ DƯ</b>',
    total_deposit: '├ Tổng tích lũy:',
    month_deposit: '├ Nạp tháng này:',
    balance: '╰ Số dư ví khả dụng:',
    choose_category: '<tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> <b>KHO HÀNG TRỰC TUYẾN:</b>\n<i>(Chạm chọn danh mục để duyệt sản phẩm)</i>',
    btn_deposit: 'Nạp tiền',
    btn_top: 'Top Nạp',
    btn_profile: 'Hồ sơ',
    btn_history: 'Lịch sử',
    btn_support: 'Hỗ trợ Admin',
    btn_change_lang: 'Ngôn ngữ',
    btn_back_cat: 'Quay lại',
    btn_back_home: 'Trang chủ',
    stock_in: '🟢 Còn',
    stock_out: '🔴 Hết',
    buy_wallet: 'Mua bằng ví',
    buy_bank: 'Quét VietQR',
    insufficient_balance: 'Số dư ví không đủ! Vui lòng nạp thêm.',
    out_of_stock: 'Mặt hàng đã hết trong kho!',
    order_confirm: 'XÁC NHẬN ĐƠN HÀNG'
  },
  en: {
    channel: '<tg-emoji emoji-id="6118209143972040877">📢</tg-emoji> <b>Channel:</b> @hvntinfo',
    admin_support: '<tg-emoji emoji-id="5395804191769763641">👑</tg-emoji> <b>Support:</b> @accffgiatot',
    acc_info: '<b>ACCOUNT & BALANCE</b>',
    total_deposit: '├ Total deposit:',
    month_deposit: '├ Month deposit:',
    balance: '╰ Available balance:',
    choose_category: '<tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> <b>ONLINE STORE:</b>\n<i>(Select category to browse items)</i>',
    btn_deposit: 'Deposit',
    btn_top: 'Top Users',
    btn_profile: 'Profile',
    btn_history: 'History',
    btn_support: 'Support 24/7',
    btn_change_lang: 'Language',
    btn_back_cat: 'Back',
    btn_back_home: 'Home',
    stock_in: '🟢 Stock',
    stock_out: '🔴 Sold Out',
    buy_wallet: 'Pay via Wallet',
    buy_bank: 'Pay via QR',
    insufficient_balance: 'Insufficient balance! Please deposit.',
    out_of_stock: 'This product is out of stock!',
    order_confirm: 'CONFIRMATION'
  }
};

async function fetchRealWeather(city) {
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    const data = await res.json();
    const current = data.current_condition[0];
    return {
      location: city.toUpperCase(),
      temp: `${current.temp_C}°C (Cảm giác ${current.FeelsLikeC}°C)`,
      humidity: `${current.humidity}%`,
      condition: current.weatherDesc[0].value,
      wind: `${current.windspeedKmph} km/h`
    };
  } catch (e) {
    return {
      location: city.toUpperCase(),
      temp: '28°C - 32°C',
      humidity: '75%',
      condition: 'Trời quang mây tạnh',
      wind: '10 km/h'
    };
  }
}

function generateWelcomeCard(user) {
  const width = 850;
  const height = 480;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#0a0d1a');
  grad.addColorStop(0.5, '#1e1136');
  grad.addColorStop(1, '#060814');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.strokeRect(16, 16, width - 32, height - 32);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(26, 26, width - 52, height - 52);

  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${(config.SHOP_NAME || 'SYSTEM').toUpperCase()} • OFFICIAL STORE`, 45, 68);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('[ HỆ THỐNG GIAO DỊCH 24/7 ]', width - 45, 68);

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(45, 90);
  ctx.lineTo(width - 45, 90);
  ctx.stroke();

  ctx.fillStyle = 'rgba(30, 41, 59, 0.65)';
  ctx.fillRect(45, 115, width - 90, 150);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(45, 115, width - 90, 150);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '16px sans-serif';
  ctx.fillText('CHÀO MỪNG BẠN ĐÃ ĐẾN VỚI HỆ THỐNG', width / 2, 155);

  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 28px sans-serif';
  let uName = getFullName(user);
  if (uName.length > 25) uName = uName.substring(0, 24) + '...';
  ctx.fillText(uName.toUpperCase(), width / 2, 195);

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '15px sans-serif';
  ctx.fillText(`ID Khách Hàng: ${maskUid(user.id)} • Trạng thái: Trực Tuyến`, width / 2, 235);

  ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
  ctx.fillRect(45, 285, width - 90, 100);
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.strokeRect(45, 285, width - 90, 100);

  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('TỰ ĐỘNG GIAO TÀI KHOẢN • BẢO MẬT & UY TÍN', width / 2, 325);

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'italic 14px sans-serif';
  ctx.fillText('Nhấn nút Mở Cửa Hàng bên dưới để duyệt danh mục và chọn sản phẩm ưng ý.', width / 2, 355);

  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  ctx.fillText(`KẾT NỐI TỰ ĐỘNG • ${new Date().toLocaleDateString('vi-VN')} • CHÚC BẠN MUA SẮM VUI VẺ`, width / 2, 440);

  return canvas.toBuffer('image/png');
}

function generateMaintenanceCard() {
  const width = 850;
  const height = 480;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#1a0b0b');
  grad.addColorStop(0.5, '#2d1215');
  grad.addColorStop(1, '#0f0507');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 3;
  ctx.strokeRect(16, 16, width - 32, height - 32);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(26, 26, width - 52, height - 52);

  ctx.fillStyle = '#ef4444';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${(config.SHOP_NAME || 'SYSTEM').toUpperCase()} • SYSTEM UPGRADE`, 45, 68);

  ctx.fillStyle = '#fca5a5';
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('[ HỆ THỐNG TẠM NGHỈ ]', width - 45, 68);

  ctx.strokeStyle = '#3b181e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(45, 90);
  ctx.lineTo(width - 45, 90);
  ctx.stroke();

  ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
  ctx.fillRect(45, 115, width - 90, 140);
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(45, 115, width - 90, 140);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#f87171';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('HỆ THỐNG ĐANG BẢO TRÌ NÂNG CẤP', width / 2, 165);

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '16px sans-serif';
  ctx.fillText('Chúng tôi đang tiến hành tối ưu hóa cơ sở dữ liệu và nạp thêm kho hàng.', width / 2, 205);
  ctx.fillText('Mọi tính năng mua bán & thanh toán tạm thời ngừng phục vụ trong giây lát.', width / 2, 230);

  ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
  ctx.fillRect(45, 275, width - 90, 110);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.strokeRect(45, 275, width - 90, 110);

  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('CHÂN THÀNH CẢM ƠN QUÝ KHÁCH HÀNG', width / 2, 315);

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'italic 15px sans-serif';
  ctx.fillText('“Cảm ơn bạn đã luôn tin tưởng, đồng hành và kiên nhẫn chờ đợi shop hoàn thiện.”', width / 2, 350);

  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  ctx.fillText(`THỜI ĐIỂM BẢO TRÌ: ${new Date().toLocaleString('vi-VN')} • XIN LỖI VÌ SỰ BẤT TIỆN NÀY`, width / 2, 440);

  return canvas.toBuffer('image/png');
}

function generateWheelCard(user, wonAmount, spinsLeft) {
  const width = 850;
  const height = 500;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#0a0d1a');
  grad.addColorStop(0.5, '#1e1136');
  grad.addColorStop(1, '#060814');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#c084fc';
  ctx.lineWidth = 3;
  ctx.strokeRect(16, 16, width - 32, height - 32);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(26, 26, width - 52, height - 52);

  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${(config.SHOP_NAME || 'SYSTEM').toUpperCase()} LUCKY WHEEL`, 45, 68);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`LƯỢT CÒN LẠI: ${spinsLeft}`, width - 45, 68);

  ctx.strokeStyle = '#2e1065';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(45, 88);
  ctx.lineTo(width - 45, 88);
  ctx.stroke();

  const wheelX = 220;
  const wheelY = 280;
  const radius = 150;
  const prizes = ['1.000đ', '2.000đ', '3.000đ', '5.000đ', '8.000đ', '10.000đ'];
  const colors = ['#f43f5e', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899'];
  const arc = (Math.PI * 2) / prizes.length;

  for (let i = 0; i < prizes.length; i++) {
    const angle = i * arc;
    ctx.beginPath();
    ctx.fillStyle = colors[i];
    ctx.moveTo(wheelX, wheelY);
    ctx.arc(wheelX, wheelY, radius, angle, angle + arc);
    ctx.lineTo(wheelX, wheelY);
    ctx.fill();
    ctx.strokeStyle = '#1e1b4b';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px sans-serif';
    ctx.translate(wheelX, wheelY);
    ctx.rotate(angle + arc / 2);
    ctx.textAlign = 'right';
    ctx.fillText(prizes[i], radius - 15, 6);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(wheelX, wheelY, 26, 0, Math.PI * 2);
  ctx.fillStyle = '#f8fafc';
  ctx.fill();
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SPIN', wheelX, wheelY + 4);

  const rightX = 430;
  ctx.fillStyle = 'rgba(30, 41, 59, 0.7)';
  ctx.fillRect(rightX, 115, width - rightX - 45, 300);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(rightX, 115, width - rightX - 45, 300);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  const boxCenterX = rightX + (width - rightX - 45) / 2;
  ctx.fillText('CHÚC MỪNG KHÁCH HÀNG', boxCenterX, 155);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 18px sans-serif';
  let uName = getFullName(user);
  if (uName.length > 18) uName = uName.substring(0, 17) + '...';
  ctx.fillText(uName, boxCenterX, 185);

  ctx.fillStyle = '#facc15';
  ctx.font = '14px sans-serif';
  ctx.fillText('VỪA TRÚNG THƯỞNG SỐ TIỀN', boxCenterX, 230);

  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 36px monospace';
  ctx.fillText(`+${formatPrice(wonAmount)}`, boxCenterX, 280);

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '13px sans-serif';
  ctx.fillText('Tiền thưởng đã cộng thẳng vào ví!', boxCenterX, 325);

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'italic 12px sans-serif';
  ctx.fillText('Nạp tích lũy 150.000đ để nhận thêm lượt quay!', boxCenterX, 375);

  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  ctx.fillText(`QUAY LÚC: ${new Date().toLocaleTimeString('vi-VN')} • HỆ THỐNG XÁC THỰC TỰ ĐỘNG`, width / 2, 460);

  return canvas.toBuffer('image/png');
}

function generateInStockCard(products) {
  const width = 850;
  const displayLimit = Math.min(products.length, 10);
  const rowHeight = 48;
  const baseHeight = 240;
  const height = Math.max(500, baseHeight + displayLimit * rowHeight);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#090d16');
  grad.addColorStop(0.5, '#0f172a');
  grad.addColorStop(1, '#020617');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.strokeRect(16, 16, width - 32, height - 32);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(26, 26, width - 52, height - 52);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${(config.SHOP_NAME || 'SYSTEM').toUpperCase()} • SẴN HÀNG`, 45, 68);

  const totalInStock = products.reduce((sum, p) => sum + (p.stock_count || 0), 0);
  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`[ KHẢ DỤNG: ${totalInStock} ACC ]`, width - 45, 68);

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(45, 90);
  ctx.lineTo(width - 45, 90);
  ctx.stroke();

  ctx.fillStyle = 'rgba(16, 185, 129, 0.1)';
  ctx.fillRect(45, 105, width - 90, 48);
  ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(45, 105, width - 90, 48);

  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`HIỆN ĐANG CÓ ${products.length} MẶT HÀNG SẴN SÀNG GIAO TỰ ĐỘNG`, width / 2, 135);

  let startRowY = 175;

  if (products.length === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'italic 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Hiện tại kho đang tạm hết hàng, vui lòng quay lại sau!', width / 2, startRowY + 70);
  } else {
    for (let i = 0; i < displayLimit; i++) {
      const p = products[i];
      const rY = startRowY + i * rowHeight;

      ctx.fillStyle = i % 2 === 0 ? 'rgba(30, 41, 59, 0.45)' : 'rgba(15, 23, 42, 0.6)';
      ctx.fillRect(45, rY, width - 90, 40);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 15px sans-serif';
      let pName = p.name;
      if (pName.length > 25) pName = pName.substring(0, 24) + '...';
      ctx.fillText(`${i + 1}. ${pName}`, 60, rY + 25);

      ctx.fillStyle = '#facc15';
      ctx.font = 'bold 15px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(formatPrice(p.price), width / 2 + 30, rY + 25);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 15px monospace';
      ctx.fillText(`Còn: ${p.stock_count} acc`, width - 60, rY + 25);
    }
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  const remainCount = products.length - displayLimit;
  const extraText = remainCount > 0 ? `... và ${remainCount} sản phẩm khác • ` : '';
  ctx.fillText(`${extraText}HỆ THỐNG GIAO TÀI KHOẢN TỰ ĐỘNG 24/7 • ${new Date().toLocaleTimeString('vi-VN')}`, width / 2, height - 30);

  return canvas.toBuffer('image/png');
}

function generateGreetingCard(targetName, weatherInfo, session = 'morning') {
  const width = 850;
  const height = 480;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, width, height);
  let themeBorder = '#facc15';
  let sessionBadge = 'CHÀO BUỔI SÁNG';
  let mainTitle = `Chúc ${targetName} ngày mới tràn đầy năng lượng!`;
  let subQuote = '“Bắt đầu ngày mới với mục tiêu lớn và gặt hái thật nhiều thành công.”';

  if (session === 'morning') {
    grad.addColorStop(0, '#09152e');
    grad.addColorStop(0.5, '#172554');
    grad.addColorStop(1, '#1e1b4b');
    themeBorder = '#facc15';
    sessionBadge = 'CHÀO BUỔI SÁNG';
    mainTitle = `Chúc ${targetName} ngày mới tràn đầy năng lượng!`;
  } else if (session === 'noon') {
    grad.addColorStop(0, '#0c4a6e');
    grad.addColorStop(0.5, '#075985');
    grad.addColorStop(1, '#082f49');
    themeBorder = '#38bdf8';
    sessionBadge = 'CHÀO BUỔI TRƯA';
    mainTitle = `Chúc ${targetName} bữa trưa ngon miệng và nghỉ ngơi tốt!`;
  } else if (session === 'afternoon') {
    grad.addColorStop(0, '#431407');
    grad.addColorStop(0.5, '#7c2d12');
    grad.addColorStop(1, '#1c1917');
    themeBorder = '#fb923c';
    sessionBadge = 'CHÀO BUỔI CHIỀU';
    mainTitle = `Chúc ${targetName} tan làm/học vui vẻ, thảnh thơi!`;
  } else if (session === 'night') {
    grad.addColorStop(0, '#050510');
    grad.addColorStop(0.5, '#1e1035');
    grad.addColorStop(1, '#020617');
    themeBorder = '#c084fc';
    sessionBadge = 'CHÚC BUỔI TỐI';
    mainTitle = `Chúc ${targetName} buổi tối thư giãn và ngủ ngon!`;
  }

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = themeBorder;
  ctx.lineWidth = 3;
  ctx.strokeRect(16, 16, width - 32, height - 32);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(26, 26, width - 52, height - 52);

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`${new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}`, 45, 65);

  ctx.textAlign = 'right';
  ctx.fillStyle = themeBorder;
  ctx.fillText(sessionBadge, width - 45, 65);

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(45, 85);
  ctx.lineTo(width - 45, 85);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(mainTitle, width / 2, 145);

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'italic 16px sans-serif';
  ctx.fillText(subQuote, width / 2, 185);

  ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
  ctx.fillRect(45, 225, width - 90, 150);
  ctx.strokeStyle = themeBorder + '55';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(45, 225, width - 90, 150);

  ctx.textAlign = 'left';
  ctx.fillStyle = themeBorder;
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(`THỜI TIẾT TẠI: ${weatherInfo.location}`, 70, 265);

  ctx.fillStyle = '#f1f5f9';
  ctx.font = 'bold 24px monospace';
  ctx.fillText(`${weatherInfo.temp}`, 70, 310);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '15px sans-serif';
  ctx.fillText(`Độ ẩm: ${weatherInfo.humidity}  │  Gió: ${weatherInfo.wind}`, 70, 345);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(`Trạng thái: ${weatherInfo.condition}`, width - 70, 310);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  ctx.fillText(`TỰ ĐỘNG CẬP NHẬT THEO NGÀY • THÔNG BÁO TỪ ${config.SHOP_NAME || 'SYSTEM'}`, width / 2, 435);

  return canvas.toBuffer('image/png');
}

function generateBalanceAlertCard(userId, amount, oldBal, newBal, code) {
  const width = 750;
  const height = 520;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#0a0f1d');
  grad.addColorStop(0.5, '#0f172a');
  grad.addColorStop(1, '#020617');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 3;
  ctx.strokeRect(15, 15, width - 30, height - 30);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(25, 25, width - 50, height - 50);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${(config.SHOP_NAME || 'SYSTEM').toUpperCase()} WALLET`, 45, 65);

  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('BIẾN ĐỘNG SỐ DƯ (+)', width - 45, 65);

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(45, 85);
  ctx.lineTo(width - 45, 85);
  ctx.stroke();

  ctx.fillStyle = 'rgba(16, 185, 129, 0.08)';
  ctx.fillRect(45, 105, width - 90, 115);
  ctx.strokeStyle = 'rgba(16, 185, 129, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(45, 105, width - 90, 115);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SỐ TIỀN VỪA GHI CÓ VÀO VÍ', width / 2, 138);

  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 42px monospace';
  ctx.fillText(`+${formatPrice(amount)}`, width / 2, 188);

  ctx.textAlign = 'left';
  function drawRow(y, label, val, isBold = false, valColor = '#f8fafc') {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '15px sans-serif';
    ctx.fillText(label, 45, y);

    ctx.fillStyle = valColor;
    ctx.font = isBold ? 'bold 16px monospace' : '15px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(val, width - 45, y);
    ctx.textAlign = 'left';
  }

  drawRow(260, 'Mã nội dung nạp:', code, true, '#38bdf8');
  drawRow(300, 'Tài khoản thụ hưởng:', `UID: ${maskUid(userId)}`);
  drawRow(340, 'Thời gian thực hiện:', new Date().toLocaleString('vi-VN'));
  drawRow(380, 'Số dư ban đầu:', formatPrice(oldBal));

  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(45, 410);
  ctx.lineTo(width - 45, 410);
  ctx.stroke();
  ctx.setLineDash([]);

  drawRow(445, 'SỐ DƯ KHẢ DỤNG MỚI:', formatPrice(newBal), true, '#4ade80');

  ctx.fillStyle = '#64748b';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Tiền đã được đối soát tự động bởi cổng SePay & VietQR 24/7', width / 2, 485);

  return canvas.toBuffer('image/png');
}

async function generateLeaderboardPodium(topList, bot) {
  const width = 1000;
  const height = 1200;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#090d16');
  bgGrad.addColorStop(0.4, '#131b2e');
  bgGrad.addColorStop(1, '#05070f');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 4;
  ctx.strokeRect(16, 16, width - 32, height - 32);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(26, 26, width - 52, height - 52);

  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('BẢNG VINH DANH TOP ĐẠI GIA', width / 2, 75);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '16px monospace';
  ctx.fillText(`• ${(config.SHOP_NAME || 'STORE TỰ ĐỘNG').toUpperCase()} • CẬP NHẬT THEO THỜI GIAN THỰC •`, width / 2, 105);

  async function drawAvatar(x, y, radius, avatarUrl, fallbackChar, borderColor) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    let loaded = false;
    if (avatarUrl) {
      try {
        const img = await loadImage(avatarUrl);
        ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
        loaded = true;
      } catch (_) {}
    }

    if (!loaded) {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      ctx.fillStyle = '#64748b';
      ctx.font = `bold ${Math.round(radius)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(fallbackChar.toUpperCase(), x, y + radius / 3);
    }
    ctx.restore();

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  const topAvatars = [null, null, null];
  for (let i = 0; i < Math.min(3, topList.length); i++) {
    try {
      const photos = await bot.getUserProfilePhotos(topList[i].id, { limit: 1 });
      if (photos.total_count > 0) {
        topAvatars[i] = await bot.getFileLink(photos.photos[0][0].file_id);
      }
    } catch (_) {}
  }

  const podiumData = [
    { rank: 2, x: 230, baseY: 480, h: 180, w: 220, color: '#cbd5e1', medal: 'TOP 2', idx: 1 },
    { rank: 1, x: 500, baseY: 430, h: 230, w: 240, color: '#facc15', medal: 'TOP 1', idx: 0 },
    { rank: 3, x: 770, baseY: 520, h: 140, w: 220, color: '#fb923c', medal: 'TOP 3', idx: 2 }
  ];

  for (const pod of podiumData) {
    const user = topList[pod.idx];
    const podLeft = pod.x - pod.w / 2;
    const podTop = pod.baseY;

    ctx.fillStyle = 'rgba(30, 41, 59, 0.7)';
    ctx.fillRect(podLeft, podTop, pod.w, pod.h);
    ctx.strokeStyle = pod.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(podLeft, podTop, pod.w, pod.h);

    ctx.fillStyle = pod.color;
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(pod.medal, pod.x, podTop + 45);

    if (user) {
      const name = user.name || (user.username ? '@' + user.username : 'User');
      const avatarR = pod.rank === 1 ? 52 : 44;
      const avatarY = podTop - avatarR - 35;

      await drawAvatar(pod.x, avatarY, avatarR, topAvatars[pod.idx], name[0] || 'U', pod.color);

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 18px sans-serif';
      let displayName = name;
      if (displayName.length > 15) displayName = displayName.substring(0, 14) + '...';
      ctx.fillText(displayName, pod.x, podTop - 8);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px monospace';
      ctx.fillText(`ID: ${maskUid(user.id)}`, pod.x, podTop + 85);

      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(formatPrice(user.total), pod.x, podTop + 125);
    } else {
      ctx.fillStyle = '#64748b';
      ctx.font = '16px sans-serif';
      ctx.fillText('Đang trống', pod.x, podTop + 90);
    }
  }

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(50, 690);
  ctx.lineTo(width - 50, 690);
  ctx.stroke();

  let startListY = 730;
  const listHeight = 56;

  for (let i = 3; i < 10; i++) {
    const user = topList[i];
    const rowY = startListY + (i - 3) * (listHeight + 10);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
    ctx.fillRect(50, rowY, width - 100, listHeight);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.strokeRect(50, rowY, width - 100, listHeight);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`#${i + 1}`, 75, rowY + 35);

    if (user) {
      const name = user.name || (user.username ? '@' + user.username : 'User');
      let displayName = name;
      if (displayName.length > 20) displayName = displayName.substring(0, 19) + '...';

      ctx.fillStyle = '#f1f5f9';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(displayName, 140, rowY + 35);

      ctx.fillStyle = '#64748b';
      ctx.font = '14px monospace';
      ctx.fillText(`(UID: ${maskUid(user.id)})`, 450, rowY + 35);

      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(formatPrice(user.total), width - 80, rowY + 35);
    } else {
      ctx.fillStyle = '#475569';
      ctx.font = 'italic 15px sans-serif';
      ctx.fillText('Chưa có thành viên ghi danh', 140, rowY + 35);
    }
  }

  ctx.fillStyle = '#64748b';
  ctx.font = '13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`UID đã được ẩn danh để bảo mật thông tin • ${config.SHOP_NAME || 'STORE'}`, width / 2, height - 30);

  return canvas.toBuffer('image/png');
}

async function generateProfileCard(user, balance, totalDeposit, totalSpent, avatarUrl = null) {
  const width = 850;
  const height = 480;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(0.5, '#1e1b4b');
  grad.addColorStop(1, '#020617');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.strokeRect(15, 15, width - 30, height - 30);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(26, 26, width - 50, height - 50);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(`${(config.SHOP_NAME || 'SYSTEM').toUpperCase()} MEMBERSHIP`, 45, 68);

  let rankName = 'MEMBER';
  let rankColor = '#94a3b8';
  if (totalDeposit >= 2000000) { rankName = 'DIAMOND VIP'; rankColor = '#38bdf8'; }
  else if (totalDeposit >= 500000) { rankName = 'GOLD VIP'; rankColor = '#facc15'; }
  else if (totalDeposit >= 100000) { rankName = 'SILVER VIP'; rankColor = '#e2e8f0'; }

  ctx.fillStyle = rankColor;
  ctx.font = 'bold 18px monospace';
  ctx.fillText(`[ ${rankName} ]`, width - 210, 68);

  ctx.strokeStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(45, 90);
  ctx.lineTo(width - 45, 90);
  ctx.stroke();

  const avatarX = 55;
  const avatarY = 120;
  const avatarSize = 130;

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  let avatarLoaded = false;
  if (avatarUrl) {
    try {
      const img = await loadImage(avatarUrl);
      ctx.drawImage(img, avatarX, avatarY, avatarSize, avatarSize);
      avatarLoaded = true;
    } catch (_) {}
  }

  if (!avatarLoaded) {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 50px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText((user.first_name || 'U')[0].toUpperCase(), avatarX + avatarSize / 2, avatarY + avatarSize / 2 + 18);
    ctx.textAlign = 'left';
  }
  ctx.restore();

  ctx.strokeStyle = rankColor;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 2, 0, Math.PI * 2);
  ctx.stroke();

  const textX = 220;
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(getFullName(user), textX, 150);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '16px monospace';
  ctx.fillText(`ID: ${maskUid(user.id)} | ${user.username ? '@' + user.username : 'No Username'}`, textX, 185);

  function drawStat(x, y, w, title, val, color) {
    ctx.fillStyle = 'rgba(30, 41, 59, 0.7)';
    ctx.fillRect(x, y, w, 75);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, 75);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px sans-serif';
    ctx.fillText(title, x + 14, y + 26);

    ctx.fillStyle = color;
    ctx.font = 'bold 18px monospace';
    ctx.fillText(val, x + 14, y + 58);
  }

  drawStat(textX, 215, 185, 'SỐ DƯ VÍ', formatPrice(balance), '#4ade80');
  drawStat(textX + 200, 215, 185, 'TỔNG NẠP', formatPrice(totalDeposit), '#38bdf8');
  drawStat(textX + 400, 215, 185, 'ĐÃ TIÊU DÙNG', formatPrice(totalSpent), '#f43f5e');

  const barY = 370;
  ctx.fillStyle = '#ffffff';
  let curX = 55;
  const barPattern = [3, 1, 4, 2, 1, 3, 2, 4, 1, 2, 3, 1, 4, 2, 1, 3, 2, 1, 4, 3, 2, 1, 4, 2, 1, 3];
  for (let i = 0; i < barPattern.length; i++) {
    ctx.fillRect(curX, barY, barPattern[i] * 2, 45);
    curX += barPattern[i] * 2 + (i % 2 === 0 ? 3 : 5);
  }

  ctx.fillStyle = '#64748b';
  ctx.font = '13px monospace';
  ctx.fillText(`MEMBER ID: #${maskUid(user.id)} • VERIFIED BY BOT`, 55, 435);
  ctx.fillText(`Issued: ${new Date().toLocaleDateString('vi-VN')}`, width - 210, 435);

  return canvas.toBuffer('image/png');
}

function generateReceiptImage(orderId, user, product, qty, total, payMethod = 'WALLET') {
  const width = 650;
  const height = 750;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, width - 40, height - 40);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('HÓA ĐƠN THANH TOÁN', width / 2, 75);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px sans-serif';
  ctx.fillText(`${config.SHOP_NAME || 'STORE TỰ ĐỘNG'} • OFFICIAL RECEIPT`, width / 2, 102);

  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = '#475569';
  ctx.beginPath();
  ctx.moveTo(40, 125);
  ctx.lineTo(width - 40, 125);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.textAlign = 'left';
  function drawReceiptRow(y, label, val, isBold = false) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '15px sans-serif';
    ctx.fillText(label, 50, y);

    ctx.fillStyle = isBold ? '#38bdf8' : '#f8fafc';
    ctx.font = isBold ? 'bold 16px monospace' : '15px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(val, width - 50, y);
    ctx.textAlign = 'left';
  }

  drawReceiptRow(165, 'Mã đơn hàng:', `#${orderId}`, true);
  drawReceiptRow(205, 'Khách hàng:', getFullName(user));
  drawReceiptRow(245, 'Telegram UID:', maskUid(user.id));
  drawReceiptRow(285, 'Thời gian:', new Date().toLocaleString('vi-VN'));
  drawReceiptRow(325, 'Phương thức:', payMethod === 'WALLET' ? 'Số dư ví' : 'Chuyển khoản VietQR');

  ctx.fillStyle = 'rgba(30, 41, 59, 0.6)';
  ctx.fillRect(40, 360, width - 80, 130);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.strokeRect(40, 360, width - 80, 130);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(product.name, 60, 400);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '15px sans-serif';
  ctx.fillText(`Số lượng: x${qty} tài khoản`, 60, 435);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 22px monospace';
  ctx.fillText(formatPrice(total), width - 60, 435);
  ctx.textAlign = 'left';

  drawReceiptRow(535, 'TỔNG THANH TOÁN:', formatPrice(total), true);

  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = '#475569';
  ctx.beginPath();
  ctx.moveTo(40, 570);
  ctx.lineTo(width - 40, 570);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.save();
  ctx.translate(width / 2, 630);
  ctx.rotate(-8 * Math.PI / 180);
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 3;
  ctx.strokeRect(-130, -30, 260, 60);

  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ĐÃ THANH TOÁN', 0, 8);
  ctx.restore();

  ctx.fillStyle = '#64748b';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Hóa đơn điện tử có giá trị bảo hành tài khoản.', width / 2, 705);

  return canvas.toBuffer('image/png');
}

function generateFeedbackCard(user, productName, totalPrice, stars, comment = '') {
  const width = 850;
  const height = 480;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#0a0f1d');
  grad.addColorStop(0.5, '#171e38');
  grad.addColorStop(1, '#05070f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 3;
  ctx.strokeRect(16, 16, width - 32, height - 32);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(26, 26, width - 52, height - 52);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${(config.SHOP_NAME || 'SYSTEM').toUpperCase()} FEEDBACK`, 45, 68);

  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('[ ĐÁNH GIÁ KHÁCH HÀNG ]', width - 45, 68);

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(45, 90);
  ctx.lineTo(width - 45, 90);
  ctx.stroke();

  ctx.fillStyle = 'rgba(30, 41, 59, 0.65)';
  ctx.fillRect(45, 110, width - 90, 105);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(45, 110, width - 90, 105);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Khách hàng:', 65, 145);
  ctx.fillText('Mặt hàng đã mua:', 65, 175);
  ctx.fillText('Tổng thanh toán:', 65, 202);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(getFullName(user) + ` (UID: ${maskUid(user.id)})`, width - 65, 145);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(productName, width - 65, 175);

  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 17px monospace';
  ctx.fillText(formatPrice(totalPrice), width - 65, 202);

  const starStr = '⭐'.repeat(stars) + '☆'.repeat(5 - stars);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(starStr, width / 2, 275);

  ctx.fillStyle = '#cbd5e1';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(`Mức độ hài lòng: ${stars}/5 Sao`, width / 2, 305);

  ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
  ctx.fillRect(45, 330, width - 90, 85);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.strokeRect(45, 330, width - 90, 85);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'italic 16px sans-serif';
  const displayComment = comment ? `“${comment}”` : '“Khách hàng không để lại nhận xét thêm.”';
  ctx.fillText(displayComment.length > 70 ? displayComment.substring(0, 68) + '...' : displayComment, width / 2, 380);

  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  ctx.fillText(`XÁC THỰC BỞI HỆ THỐNG • ${new Date().toLocaleString('vi-VN')}`, width / 2, 450);

  return canvas.toBuffer('image/png');
}

function formatDuration(seconds) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

function generateUptimeImage() {
  const width = 800;
  const height = 460;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#0b0f19');
  bgGrad.addColorStop(1, '#111827');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, width - 20, height - 20);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('VPS SYSTEM MONITOR & UPTIME', 40, 60);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '16px sans-serif';
  ctx.fillText(`Server OS: ${os.type()} ${os.arch()} | Platform: ${os.platform()}`, 40, 90);

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, 110);
  ctx.lineTo(width - 40, 110);
  ctx.stroke();

  const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
  const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
  const usedMem = (totalMem - freeMem).toFixed(2);
  const memPct = Math.round((usedMem / totalMem) * 100);

  const vpsUptime = formatDuration(os.uptime());
  const botUptime = formatDuration((Date.now() - BOT_START_TIME) / 1000);

  function drawMetricBox(x, y, w, h, title, val, color) {
    ctx.fillStyle = 'rgba(30, 41, 59, 0.6)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px sans-serif';
    ctx.fillText(title, x + 16, y + 28);

    ctx.fillStyle = color;
    ctx.font = 'bold 20px monospace';
    ctx.fillText(val, x + 16, y + 64);
  }

  drawMetricBox(40, 135, 340, 90, 'VPS UPTIME', vpsUptime, '#4ade80');
  drawMetricBox(420, 135, 340, 90, 'BOT UPTIME', botUptime, '#38bdf8');
  drawMetricBox(40, 245, 340, 90, 'CPU CORES & LOAD', `${os.cpus().length} Cores | Node ${process.version}`, '#facc15');
  drawMetricBox(420, 245, 340, 90, 'RAM USAGE', `${usedMem}GB / ${totalMem}GB (${memPct}%)`, '#f43f5e');

  const barX = 40;
  const barY = 370;
  const barW = width - 80;
  const barH = 18;

  ctx.fillStyle = '#1e293b';
  ctx.fillRect(barX, barY, barW, barH);

  const fillW = Math.round((barW * memPct) / 100);
  const ramGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  ramGrad.addColorStop(0, '#38bdf8');
  ramGrad.addColorStop(0.7, '#facc15');
  ramGrad.addColorStop(1, '#f43f5e');
  ctx.fillStyle = ramGrad;
  ctx.fillRect(barX, barY, fillW, barH);

  ctx.fillStyle = '#64748b';
  ctx.font = '13px monospace';
  ctx.fillText(`• RAM: ${memPct}% Used • Real-time Canvas Generator • Status: Operational`, 40, 420);

  return canvas.toBuffer('image/png');
}

function generateRevenueCard(stats, products, totalStock, todayStats = { today_revenue: 0, today_orders: 0 }) {
  const width = 850;
  const height = 590;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#090d16');
  grad.addColorStop(0.5, '#0f172a');
  grad.addColorStop(1, '#020617');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 3;
  ctx.strokeRect(16, 16, width - 32, height - 32);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 1;
  ctx.strokeRect(26, 26, width - 52, height - 52);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${(config.SHOP_NAME || 'STORE').toUpperCase()} • FINANCIAL SYSTEM`, 45, 68);

  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('[ BÁO CÁO TÀI CHÍNH ]', width - 45, 68);

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(45, 90);
  ctx.lineTo(width - 45, 90);
  ctx.stroke();

  ctx.fillStyle = 'rgba(16, 185, 129, 0.08)';
  ctx.fillRect(45, 105, width - 90, 115);
  ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(45, 105, width - 90, 115);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TỔNG DOANH THU TOÀN HỆ THỐNG', width / 2, 138);

  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 44px monospace';
  ctx.fillText(formatPrice(stats.total_revenue || 0), width / 2, 190);

  const halfW = (width - 90 - 15) / 2;
  function drawMiniCard(x, y, w, h, title, val, color) {
    ctx.fillStyle = 'rgba(30, 41, 59, 0.65)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, x + 16, y + 28);

    ctx.fillStyle = color;
    ctx.font = 'bold 22px monospace';
    ctx.fillText(val, x + 16, y + 62);
  }

  drawMiniCard(45, 235, halfW, 80, 'DOANH THU HÔM NAY', formatPrice(todayStats.today_revenue), '#facc15');
  drawMiniCard(45 + halfW + 15, 235, halfW, 80, 'ĐƠN BÁN ĐƯỢC HÔM NAY', `${todayStats.today_orders} đơn hàng`, '#38bdf8');

  const totalOrders = stats.total_orders || 0;
  const aov = totalOrders > 0 ? Math.round((stats.total_revenue || 0) / totalOrders) : 0;
  const boxW = (width - 90 - 30) / 3;

  function drawMetricBox(x, y, w, title, val, color) {
    ctx.fillStyle = 'rgba(30, 41, 59, 0.65)';
    ctx.fillRect(x, y, w, 80);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, 80);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, x + 14, y + 28);

    ctx.fillStyle = color;
    ctx.font = 'bold 18px monospace';
    ctx.fillText(val, x + 14, y + 58);
  }

  drawMetricBox(45, 330, boxW, 'TỔNG ĐƠN TẤT CẢ', `${totalOrders} đơn`, '#38bdf8');
  drawMetricBox(45 + boxW + 15, 330, boxW, 'GIÁ TRỊ TB (AOV)', formatPrice(aov), '#facc15');
  drawMetricBox(45 + (boxW + 15) * 2, 330, boxW, 'TỒN KHO HIỆN TẠI', `${totalStock} acc`, '#4ade80');

  ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
  ctx.fillRect(45, 425, width - 90, 75);
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.strokeRect(45, 425, width - 90, 75);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px sans-serif';
  ctx.fillText('Số lượng mặt hàng trên kệ:', 65, 455);
  ctx.fillText('Thời điểm xuất dữ liệu:', 65, 485);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 15px monospace';
  ctx.fillText(`${products.length} sản phẩm`, width - 65, 455);
  ctx.fillText(new Date().toLocaleString('vi-VN'), width - 65, 485);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  ctx.fillText('CONFIDENTIAL • BÁO CÁO NỘI BỘ DÀNH CHO ADMIN • DỮ LIỆU TỰ ĐỘNG THỜI GIAN THỰC', width / 2, 545);

  return canvas.toBuffer('image/png');
}

function generateUsersCard(users, currentPage = 1, totalPages = 1) {
  const width = 900;
  const rowHeight = 46;
  const baseHeight = 220;
  const height = baseHeight + (users.length * rowHeight);

  const canvas = createCanvas(width, Math.max(height, 500));
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#090d16');
  grad.addColorStop(0.5, '#0f172a');
  grad.addColorStop(1, '#020617');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, Math.max(height, 500));

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.strokeRect(16, 16, width - 32, height - 32);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(26, 26, width - 52, height - 52);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('THÀNH VIÊN HỆ THỐNG', 45, 68);

  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`[ TRANG ${currentPage} / ${totalPages} ]`, width - 45, 68);

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(45, 90);
  ctx.lineTo(width - 45, 90);
  ctx.stroke();

  const tableHeadY = 110;
  ctx.fillStyle = 'rgba(30, 41, 59, 0.7)';
  ctx.fillRect(45, tableHeadY, width - 90, 36);

  ctx.font = 'bold 13px monospace';
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'left';
  ctx.fillText('STT', 60, tableHeadY + 23);
  ctx.fillText('TÊN THÀNH VIÊN', 120, tableHeadY + 23);
  ctx.fillText('TELEGRAM UID', 440, tableHeadY + 23);
  ctx.textAlign = 'right';
  ctx.fillText('SỐ DƯ KHẢ DỤNG', width - 65, tableHeadY + 23);

  let startRowY = tableHeadY + 45;

  if (users.length === 0) {
    ctx.fillStyle = '#64748b';
    ctx.font = 'italic 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Không có dữ liệu người dùng ở trang này!', width / 2, startRowY + 60);
  } else {
    users.forEach((u, idx) => {
      const rY = startRowY + idx * rowHeight;
      const globalIdx = (currentPage - 1) * 10 + idx + 1;

      ctx.fillStyle = idx % 2 === 0 ? 'rgba(30, 41, 59, 0.4)' : 'rgba(15, 23, 42, 0.6)';
      ctx.fillRect(45, rY, width - 90, 38);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(`#${globalIdx}`, 60, rY + 24);

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 14px sans-serif';
      let uName = u.first_name || u.name || 'Người dùng';
      if (uName.length > 24) uName = uName.substring(0, 23) + '...';
      ctx.fillText(uName, 120, rY + 24);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px monospace';
      ctx.fillText(String(u.id), 440, rY + 24);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 15px monospace';
      ctx.fillText(formatPrice(u.balance || 0), width - 65, rY + 24);
    });
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  ctx.fillText(`DANH SÁCH KHÁCH HÀNG TỰ ĐỘNG • XUẤT LÚC: ${new Date().toLocaleTimeString('vi-VN')}`, width / 2, Math.max(height, 500) - 30);

  return canvas.toBuffer('image/png');
}

function generateStatsCard(products, totalStock) {
  const width = 850;
  const displayLimit = Math.min(products.length, 10);
  const rowHeight = 44;
  const baseHeight = 310;
  const height = Math.max(500, baseHeight + displayLimit * rowHeight);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#090d16');
  grad.addColorStop(0.5, '#0f172a');
  grad.addColorStop(1, '#020617');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.strokeRect(16, 16, width - 32, height - 32);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(26, 26, width - 52, height - 52);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('INVENTORY CONTROL CENTER', 45, 68);

  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`TỔNG KHO: ${totalStock} ACC`, width - 45, 68);

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(45, 90);
  ctx.lineTo(width - 45, 90);
  ctx.stroke();

  let lowStockCount = 0;
  let emptyStockCount = 0;
  products.forEach(p => {
    if (p.stock_count === 0) emptyStockCount++;
    else if (p.stock_count <= 3) lowStockCount++;
  });

  const bannerBg = emptyStockCount > 0 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.1)';
  const bannerBorder = emptyStockCount > 0 ? '#ef4444' : '#10b981';
  ctx.fillStyle = bannerBg;
  ctx.fillRect(45, 105, width - 90, 50);
  ctx.strokeStyle = bannerBorder;
  ctx.strokeRect(45, 105, width - 90, 50);

  ctx.fillStyle = emptyStockCount > 0 ? '#f87171' : '#4ade80';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  const alertText = emptyStockCount > 0 
    ? `CẢNH BÁO: ${emptyStockCount} MẶT HÀNG HẾT KHO • ${lowStockCount} MẶT HÀNG SẮP HẾT`
    : `TÌNH TRẠNG KHO HÀNG ỔN ĐỊNH • CÒN KHẢ DỤNG ${totalStock} ACC`;
  ctx.fillText(alertText, width / 2, 136);

  let startY = 175;
  if (products.length === 0) {
    ctx.fillStyle = '#64748b';
    ctx.font = 'italic 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Chưa có sản phẩm nào trong cơ sở dữ liệu!', width / 2, 240);
  } else {
    for (let i = 0; i < displayLimit; i++) {
      const p = products[i];
      const rowY = startY + i * rowHeight;

      ctx.fillStyle = i % 2 === 0 ? 'rgba(30, 41, 59, 0.45)' : 'rgba(15, 23, 42, 0.55)';
      ctx.fillRect(45, rowY, width - 90, 36);

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'left';
      let pName = p.name;
      if (pName.length > 28) pName = pName.substring(0, 27) + '...';
      ctx.fillText(`${i + 1}. ${pName}`, 60, rowY + 23);

      let badgeTxt = 'CÒN HÀNG';
      let badgeCol = '#10b981';
      if (p.stock_count === 0) {
        badgeTxt = 'HẾT HÀNG';
        badgeCol = '#ef4444';
      } else if (p.stock_count <= 3) {
        badgeTxt = 'SẮP HẾT';
        badgeCol = '#facc15';
      }

      ctx.fillStyle = badgeCol;
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(badgeTxt, width / 2 + 60, rowY + 23);

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${p.stock_count} acc`, width - 60, rowY + 24);
    }
  }

  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  const remainCount = products.length - displayLimit;
  const extraText = remainCount > 0 ? `... và ${remainCount} sản phẩm khác • ` : '';
  ctx.fillText(`${extraText}Cập nhật lúc: ${new Date().toLocaleTimeString('vi-VN')} • Real-time Stock Monitor`, width / 2, height - 30);

  return canvas.toBuffer('image/png');
}

function generateOrdersLogCard(orders) {
  const width = 950;
  const displayLimit = Math.min(orders.length, 12);
  const rowHeight = 44;
  const baseHeight = 280;
  const height = Math.max(520, baseHeight + displayLimit * rowHeight);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#090d16');
  bgGrad.addColorStop(0.5, '#111827');
  bgGrad.addColorStop(1, '#05070f');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#a855f7';
  ctx.lineWidth = 3;
  ctx.strokeRect(16, 16, width - 32, height - 32);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(26, 26, width - 52, height - 52);

  ctx.fillStyle = '#c084fc';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('ORDER AUDIT & MONITORING LOG', 45, 68);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('[ REALTIME LEDGER ]', width - 45, 68);

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(45, 90);
  ctx.lineTo(width - 45, 90);
  ctx.stroke();

  let completedCount = 0;
  let pendingCount = 0;
  let otherCount = 0;
  orders.forEach(o => {
    if (o.status === 'completed') completedCount++;
    else if (o.status === 'pending') pendingCount++;
    else otherCount++;
  });

  const boxW = (width - 90 - 30) / 3;
  function drawMiniStat(x, y, w, title, val, color) {
    ctx.fillStyle = 'rgba(30, 41, 59, 0.6)';
    ctx.fillRect(x, y, w, 52);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, 52);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, x + 14, y + 22);

    ctx.fillStyle = color;
    ctx.font = 'bold 17px monospace';
    ctx.fillText(val, x + 14, y + 43);
  }

  drawMiniStat(45, 105, boxW, 'HOÀN TẤT', `${completedCount} đơn`, '#4ade80');
  drawMiniStat(45 + boxW + 15, 105, boxW, 'ĐANG CHỜ', `${pendingCount} đơn`, '#facc15');
  drawMiniStat(45 + (boxW + 15) * 2, 105, boxW, 'HỦY / HẾT HẠN', `${otherCount} đơn`, '#f87171');

  const tableHeadY = 185;
  ctx.fillStyle = 'rgba(51, 65, 85, 0.5)';
  ctx.fillRect(45, tableHeadY, width - 90, 32);

  ctx.font = 'bold 12px monospace';
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'left';
  ctx.fillText('MÃ ĐƠN', 60, tableHeadY + 21);
  ctx.fillText('KHÁCH HÀNG', 150, tableHeadY + 21);
  ctx.fillText('MẶT HÀNG & SỐ LƯỢNG', 360, tableHeadY + 21);
  ctx.fillText('TỔNG TIỀN', 660, tableHeadY + 21);
  ctx.textAlign = 'right';
  ctx.fillText('TRẠNG THÁI', width - 60, tableHeadY + 21);

  let startRowY = tableHeadY + 36;
  if (orders.length === 0) {
    ctx.fillStyle = '#64748b';
    ctx.font = 'italic 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Hiện chưa có đơn hàng nào được ghi nhận!', width / 2, startRowY + 50);
  } else {
    for (let i = 0; i < displayLimit; i++) {
      const o = orders[i];
      const rY = startRowY + i * rowHeight;

      ctx.fillStyle = i % 2 === 0 ? 'rgba(30, 41, 59, 0.4)' : 'rgba(15, 23, 42, 0.5)';
      ctx.fillRect(45, rY, width - 90, 38);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(`#${o.id}`, 60, rY + 24);

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 13px sans-serif';
      let cName = o.user_name || 'Khách';
      if (cName.length > 15) cName = cName.substring(0, 14) + '...';
      ctx.fillText(cName, 150, rY + 24);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '13px sans-serif';
      let pTitle = `${o.product_name} (x${o.quantity || 1})`;
      if (pTitle.length > 25) pTitle = pTitle.substring(0, 24) + '...';
      ctx.fillText(pTitle, 360, rY + 24);

      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(formatPrice(o.total_price || 0), 660, rY + 24);

      let statusLabel = 'HOÀN TẤT';
      let statusColor = '#4ade80';
      if (o.status === 'pending') {
        statusLabel = 'CHỜ DUYỆT';
        statusColor = '#facc15';
      } else if (o.status === 'cancelled' || o.status === 'expired') {
        statusLabel = 'ĐÃ HỦY';
        statusColor = '#f87171';
      }

      ctx.textAlign = 'right';
      ctx.fillStyle = statusColor;
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`[ ${statusLabel} ]`, width - 60, rY + 24);
    }
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  const remain = orders.length - displayLimit;
  const more = remain > 0 ? `và ${remain} đơn khác • ` : '';
  ctx.fillText(`AUDIT TRAIL LOG • ${more}Cập nhật lúc: ${new Date().toLocaleTimeString('vi-VN')}`, width / 2, height - 30);

  return canvas.toBuffer('image/png');
}

async function sendOrEditText(bot, chatId, messageId, text, keyboard) {
  try {
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
  } catch (err) {
    return null;
  }
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
        return ' ├ ' + tier.min + ' - ' + (next.min - 1) + ' SP ➔ <b>' + formatPrice(tier.price) + '</b>/SP' + sfx;
      }
      return ' ╰ Từ ' + tier.min + ' SP ➔ <b>' + formatPrice(tier.price) + '</b>/SP' + sfx;
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
    return '<tg-emoji emoji-id="6334849386031351338">💵</tg-emoji> <b>Đơn giá:</b> <code>' + formatPrice(product.price) + '</code> / 1 SP\n';
  }
  return (
    '<b>BẢNG GIÁ SỈ:</b>\n' +
    '─────────────────────────\n' +
    formatTierBlockUser(product) +
    '\n─────────────────────────\n'
  );
}

function productPriceBlockAdmin(product) {
  let s = '<tg-emoji emoji-id="6334849386031351338">💵</tg-emoji> <b>Giá gốc:</b> <code>' + formatPrice(product.price) + '</code>\n';
  if (product.price_tiers?.length) s += '<b>Bảng giá sỉ:</b>\n' + formatTierBullets(product);
  return s;
}

function adminProductKeyboard(productId) {
  return [
    [{ text: 'Đổi tên', callback_data: 'adm_edit_name_' + productId }, { text: 'Đổi giá', callback_data: 'adm_edit_price_' + productId, icon_custom_emoji_id: '6334849386031351338' }],
    [{ text: 'Danh mục', callback_data: 'adm_change_cat_' + productId, icon_custom_emoji_id: '5258389041006518073' }, { text: 'Giá sỉ', callback_data: 'adm_edit_tiers_' + productId }],
    [{ text: 'Sửa mô tả', callback_data: 'adm_edit_desc_' + productId }],
    [{ text: 'Nạp stock', callback_data: 'adm_addstock_' + productId }, { text: 'Xem tồn kho', callback_data: 'adm_viewstock_' + productId }],
    [{ text: 'Xóa sản phẩm', callback_data: 'adm_delete_' + productId }],
    [
      { text: 'Về danh sách', callback_data: 'adm_back_list', icon_custom_emoji_id: '5256247952564825322' },
      { text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }
    ]
  ];
}

async function buildAdminPanelMenu() {
  const products = await db.getAllProducts();
  const categories = await db.getAllCategories();
  const users = await db.getAllUsers();
  const totalStock = products.reduce((sum, p) => sum + (p.stock_count || 0), 0);

  const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  <tg-emoji emoji-id="5395804191769763641">👑</tg-emoji> <b>TRUNG TÂM QUẢN TRỊ VIÊN</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
<b>Bảo trì hệ thống:</b> <code>${IS_MAINTENANCE ? 'ĐANG BẬT [ON]' : 'HOẠT ĐỘNG [OFF]'}</code>
<b>Đã cấm (Band):</b> <code>${BLACKLIST_MAP.size} người dùng</code>
<b>Thời tiết khu vực:</b> <code>${SELECTED_CITY.toUpperCase()}</code>
─────────────────────────
<b>TỔNG QUAN TÀI NGUYÊN:</b>
 ├ Danh mục: <b>${categories.length}</b> mục
 ├ Sản phẩm: <b>${products.length}</b> loại
 ├ Tổng tồn kho: <b>${totalStock}</b> tài khoản
 ╰ Thành viên: <b>${users.length}</b> người
─────────────────────────
<i>Chạm vào từng tính năng bên dưới để điều khiển:</i>`;

  const keyboard = [
    [
      { text: 'Sản Phẩm', callback_data: 'adm_panel_products' },
      { text: 'Danh Mục', callback_data: 'adm_panel_categories', icon_custom_emoji_id: '5258389041006518073' }
    ],
    [
      { text: 'Tồn Kho (Canvas)', callback_data: 'adm_panel_stock' },
      { text: 'Doanh Thu (Canvas)', callback_data: 'adm_panel_revenue' }
    ],
    [
      { text: 'Đơn Hàng (Canvas)', callback_data: 'adm_panel_orders' },
      { text: 'Thành Viên (Canvas)', callback_data: 'adm_panel_users' }
    ],
    [
      { text: IS_MAINTENANCE ? 'Tắt Bảo Trì' : 'Bật Bảo Trì', callback_data: 'adm_panel_toggle_maint', icon_custom_emoji_id: '5980930633298350051' },
      { text: 'Uptime VPS', callback_data: 'adm_panel_uptime' }
    ],
    [
      { text: 'Broadcast Toàn Shop', callback_data: 'adm_panel_broadcast' },
      { text: 'Test Thiệp Chúc', callback_data: 'adm_panel_testchuc' }
    ],
    [
      { text: 'Đóng Panel', callback_data: 'close_view', icon_custom_emoji_id: '5256247952564825322' }
    ]
  ];

  return { text, keyboard };
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
const pendingFeedbacks = new Map();

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

function getLanguageKeyboard() {
  return [
    [
      { text: 'Tiếng Việt', callback_data: 'set_lang_vi', icon_custom_emoji_id: '6147621612590995760' },
      { text: 'English', callback_data: 'set_lang_en', icon_custom_emoji_id: '5434076031164103400' }
    ]
  ];
}

function buildProductSelectKeyboard(product, qty = 1) {
  const stock = product.stock_count;
  const currentQty = Math.min(Math.max(1, qty), stock > 0 ? stock : 1);

  return [
    [
      { text: '➖', callback_data: `adjqty_${product.id}_${currentQty - 1}` },
      { text: `${currentQty} key`, callback_data: 'none' },
      { text: 'Tăng', callback_data: `adjqty_${product.id}_${currentQty + 1}`, icon_custom_emoji_id: '5280612576185565531' }
    ],
    [
      { text: 'Nhập số lượng', callback_data: `customqty_${product.id}` }
    ],
    [
      { 
        text: `Tạo QR · ${currentQty} key`, 
        callback_data: `qty_${product.id}_${currentQty}`,
        icon_custom_emoji_id: '5980930633298350051'
      }
    ],
    [
      { 
        text: 'Quay lại', 
        callback_data: product.category_id > 0 ? `view_category_${product.category_id}` : 'open_store',
        icon_custom_emoji_id: '5256247952564825322'
      },
      { text: 'Đóng', callback_data: 'close_view' }
    ]
  ];
}

async function publishFeedback(bot, user, productName, totalPrice, stars, comment) {
  try {
    const cardBuffer = generateFeedbackCard(user, productName, totalPrice, stars, comment);
    
    const channelCaption = 
`<b>ĐƠN HÀNG VỪA ĐƯỢC ĐÁNH GIÁ MỚI</b>\n─────────────────────────\n` +
`👤 <b>Khách hàng:</b> ${getFullName(user)} (UID: <code>${maskUid(user.id)}</code>)\n` +
`🎁 <b>Mặt hàng:</b> <b>${productName}</b>\n` +
`💰 <b>Giá thanh toán:</b> <code>${formatPrice(totalPrice)}</code>\n` +
`⭐ <b>Đánh giá:</b> <b>${stars}/5 sao</b>\n` +
(comment ? `💬 <b>Lời nhận xét:</b> <i>“${comment}”</i>\n` : '') +
`─────────────────────────\n` +
`<i>Giao dịch tự động & xác thực 24/7 bởi ${config.SHOP_NAME || 'SYSTEM'}</i>`;

    bot.sendPhoto(FEEDBACK_CHANNEL_ID, cardBuffer, {
      caption: channelCaption,
      parse_mode: 'HTML'
    }).catch(() => {});

    const userCaption = 
`<b>CẢM ƠN BẠN ĐÃ GỬI ĐÁNH GIÁ</b>\n─────────────────────────\n` +
`Đánh giá của bạn đã được xuất bản tự động lên kênh feedback của hệ thống!\n` +
`Cảm ơn bạn đã luôn đồng hành và ủng hộ shop!`;

    await bot.sendPhoto(user.id, cardBuffer, {
      caption: userCaption,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: 'Mở Cửa Hàng Mua Tiếp', callback_data: 'open_store', icon_custom_emoji_id: '5312361253610475399' }]]
      }
    }).catch(() => {});

  } catch (err) {
    bot.sendMessage(user.id, `<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> <b>Cảm ơn bạn đã gửi đánh giá thành công!</b>`, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: 'Mở Cửa Hàng', callback_data: 'open_store', icon_custom_emoji_id: '5312361253610475399' }]]
      }
    }).catch(() => {});
  }
}

async function deliverOrder(bot, orderId, chatId, userId, userFrom, product, accounts, payMethod = 'WALLET') {
  const accListRaw = accounts.join('\n');
  await db.updateOrder(orderId, null, 'completed', accListRaw);

  const txtContent = 
`==================================================
              HÓA ĐƠN MUA HÀNG
==================================================
 Mã đơn hàng: #${orderId}
 Mặt hàng:    ${product.name}
 Số lượng:    ${accounts.length}
 Khách hàng:  ${getFullName(userFrom)} (${userId})
 Thời gian:   ${new Date().toLocaleString('vi-VN')}
==================================================

 DANH SÁCH TÀI KHOẢN:
${accounts.map((acc, i) => `[${i + 1}] ${acc}`).join('\n')}

==================================================
 Cảm ơn bạn đã tin tưởng ủng hộ shop!
 Lưu ý: Vui lòng đổi mật khẩu để bảo mật tài khoản!
==================================================`;

  const txtBuffer = Buffer.from(txtContent, 'utf-8');
  const filename = `Order_${orderId}.txt`;
  const totalPrice = product.price * accounts.length;

  try {
    const receiptBuffer = generateReceiptImage(orderId, userFrom, product, accounts.length, totalPrice, payMethod);
    await bot.sendPhoto(chatId, receiptBuffer, {
      caption: `🧾 <b>HÓA ĐƠN ĐIỆN TỬ ĐƠN HÀNG #${orderId}</b>\n<i>Đã ghi nhận giao dịch thành công trên hệ thống.</i>`,
      parse_mode: 'HTML'
    }).catch(() => {});
  } catch (e) {}

  await bot.sendDocument(chatId, txtBuffer, {
    caption: 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  🎉 <b>GIAO HÀNG THÀNH CÔNG!</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 📦 <b>Mã đơn:</b> <code>#${orderId}</code>
 ├ 🎁 <b>Mặt hàng:</b> <b>${product.name}</b>
 ├ 🔢 <b>Số lượng:</b> <code>${accounts.length} acc</code>
 ╰ ⏰ <b>Trạng thái:</b> <code>Đã hoàn tất</code>
─────────────────────────
<tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> <i>File tài khoản (.txt) đã được đính kèm bên trên!</i>`,
    parse_mode: 'HTML'
  }, { filename, contentType: 'text/plain' }).catch(() => {});

  const fbKeyboard = [
    [
      { text: '⭐ 1', callback_data: `fb_star_${orderId}_1` },
      { text: '⭐ 2', callback_data: `fb_star_${orderId}_2` },
      { text: '⭐ 3', callback_data: `fb_star_${orderId}_3` },
      { text: '⭐ 4', callback_data: `fb_star_${orderId}_4` },
      { text: '⭐ 5', callback_data: `fb_star_${orderId}_5` }
    ],
    [{ text: 'Bỏ qua đánh giá', callback_data: 'fb_skip' }]
  ];

  await bot.sendMessage(chatId, 
`🌟 <b>ĐÁNH GIÁ CHẤT LƯỢNG ĐƠN HÀNG #${orderId}</b>\n─────────────────────────\n` +
`Bạn cảm thấy dịch vụ của chúng tôi như thế nào?\n` +
`Vui lòng chạm chọn số sao bên dưới để nhận xét:`, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: fbKeyboard }
  }).catch(() => {});

  let adminAccDetails = '';
  accounts.forEach((acc, i) => {
    const p = parseAccount(acc);
    adminAccDetails += `\n ├ <b>Acc ${i + 1}:</b>\n │   TK: <code>${p.user}</code>\n │   MK: <code>${p.pass || '(Không có)'}</code>`;
  });

  const adminMsg = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  🔔 <b>ĐƠN HÀNG ĐÃ HOÀN TẤT</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 📦 <b>Mã đơn:</b> <code>#${orderId}</code>
 ├ 👤 <b>Khách hàng:</b> ${getFullName(userFrom)} (<code>${userId}</code>)
 ├ 🎁 <b>Sản phẩm:</b> ${product.name}
 ├ 🔢 <b>Số lượng:</b> ${accounts.length}
 ╰ 💰 <b>Tổng thu:</b> <code>${formatPrice(totalPrice)}</code>
─────────────────────────
<tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> <b>DỮ LIỆU ĐÃ GIAO:</b>${adminAccDetails}`;

  config.ADMIN_IDS.forEach(id => {
    bot.sendMessage(id, adminMsg, { parse_mode: 'HTML' }).catch(() => {});
    bot.sendDocument(id, txtBuffer, { caption: `<tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> Backup đơn #${orderId}` }, { filename, contentType: 'text/plain' }).catch(() => {});
  });
}

async function buildHomeMenu(userId) {
  let lang = (await db.getUserLang(userId)) || 'vi';
  const t = MESSAGES[lang] || MESSAGES.vi;

  const balance = await db.getUserBalance(userId);
  const { totalDeposit, monthDeposit } = await db.getUserDepositStats(userId);
  const spins = db.getUserSpins ? (await db.getUserSpins(userId)) : 0;

  const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  <tg-emoji emoji-id="6300766415355908268">✨</tg-emoji> <b>${(config.SHOP_NAME || 'STORE TỰ ĐỘNG').toUpperCase()}</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
${t.channel}
${t.admin_support}
─────────────────────────
<tg-emoji emoji-id="6138871037632191916">💳</tg-emoji> ${t.acc_info}
 ${t.total_deposit} <code>${(totalDeposit || 0).toLocaleString('vi-VN')}đ</code>
 ${t.month_deposit} <code>${(monthDeposit || 0).toLocaleString('vi-VN')}đ</code>
 ${t.balance} <code>${(balance || 0).toLocaleString('vi-VN')}đ</code>
 ╰ 🎰 Lượt quay may mắn: <code>${spins} lượt</code>
─────────────────────────
👇 <i>Nhấn <b>MỞ CỬA HÀNG</b> bên dưới để duyệt danh mục sản phẩm:</i>`;

  const keyboard = [
    [{ text: 'MỞ CỬA HÀNG (KHO SẢN PHẨM)', callback_data: 'open_store', icon_custom_emoji_id: '5312361253610475399' }],
    [
      { text: t.btn_deposit, callback_data: 'deposit_menu', icon_custom_emoji_id: '6334849386031351338' },
      { text: t.btn_top, callback_data: 'view_top_deposits', icon_custom_emoji_id: '6300766415355908268' }
    ],
    [
      { text: 'Hàng Sẵn Có', callback_data: 'view_instock', icon_custom_emoji_id: '6300766415355908268' },
      { text: `Vòng Quay (${spins})`, callback_data: 'play_wheel' }
    ],
    [
      { text: t.btn_profile, callback_data: 'main_profile', icon_custom_emoji_id: '6032693626394382504' },
      { text: t.btn_history, callback_data: 'main_history', icon_custom_emoji_id: '6147610325416941553' }
    ],
    [
      { text: t.btn_change_lang, callback_data: 'change_language', icon_custom_emoji_id: '5298584437338946835' },
      { text: t.btn_support, callback_data: 'show_support', icon_custom_emoji_id: '5395804191769763641' }
    ]
  ];

  return { text, keyboard };
}

async function buildStoreMenu(userId) {
  const categories = await db.getAllCategories();
  const keyboard = [];

  if (categories.length > 0) {
    categories.forEach(c => {
      const btn = {
        text: `${c.name.toUpperCase()}  [ ${c.product_count} SP ]  ▸`,
        callback_data: 'view_category_' + c.id
      };
      btn.icon_custom_emoji_id = c.custom_emoji_id || '5258389041006518073';
      keyboard.push([btn]);
    });
  } else {
    keyboard.push([{
      text: 'Đang cập nhật sản phẩm',
      callback_data: 'none'
    }]);
  }

  keyboard.push([{ text: 'Quay lại Trang chủ', callback_data: 'back_main', icon_custom_emoji_id: '5256247952564825322' }]);

  const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  <tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> <b>KHO HÀNG TRỰC TUYẾN</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
<i>Vui lòng chọn danh mục bạn muốn mua tài khoản:</i>`;

  return { text, keyboard };
}

async function startBot() {
  await db.initDB();

  try {
    const savedList = await db.getBlacklist();
    savedList.forEach(item => BLACKLIST_MAP.set(String(item.userId), item.reason));
  } catch (_) {}

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
    { command: 'menu', description: 'Mở trang chủ / menu shop' }
  ]);

  config.ADMIN_IDS.forEach(adminId => {
    bot.setMyCommands([
      { command: 'admin', description: 'Bảng điều khiển Admin Panel' },
      { command: 'baotri', description: 'Bật/Tắt chế độ bảo trì (on/off)' },
      { command: 'band', description: 'Cấm người dùng: /band <UID> <Lý do>' },
      { command: 'unband', description: 'Gỡ cấm: /unband <UID>' },
      { command: 'uptime', description: 'Kiểm tra Uptime VPS' },
      { command: 'categories', description: 'Quản lý danh mục' },
      { command: 'products', description: 'Quản trị sản phẩm' },
      { command: 'orders', description: 'Danh sách đơn hàng Canvas' },
      { command: 'revenue', description: 'Thống kê doanh thu Canvas' },
      { command: 'stats', description: 'Kiểm tra tồn kho Canvas' },
      { command: 'settinh', description: 'Cài đặt tỉnh/thành thời tiết' },
      { command: 'testchuc', description: 'Test thẻ chúc 4 buổi' },
      { command: 'users', description: 'Quản lý thành viên Canvas' },
      { command: 'broadcast', description: 'Thông báo shop' },
      { command: 'setmoney', description: 'Chỉnh sửa số dư' }
    ], { scope: { type: 'chat', chat_id: adminId } });
  });

  bot.on('polling_error', (err) => console.log('Polling error:', err.message));

  // ==================== LỆNH /band & /unband ====================
  bot.onText(/\/band(?:\s+(\d+))?(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const target = match[1]?.trim();
    const reason = match[2]?.trim();

    if (!target) {
      if (BLACKLIST_MAP.size === 0) {
        return bot.sendMessage(msg.chat.id, '<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> Hiện tại không có người dùng nào bị cấm!\n👉 Cú pháp: <code>/band &lt;UID&gt; &lt;Lý do&gt;</code>', { parse_mode: 'HTML' });
      }
      let listTxt = '🚫 <b>DANH SÁCH NGƯỜI DÙNG BỊ CẤM:</b>\n─────────────────────────\n';
      BLACKLIST_MAP.forEach((rs, uid) => {
        listTxt += `• <code>${uid}</code>: <i>${rs}</i>\n`;
      });
      listTxt += '\n👉 Dùng <code>/unband &lt;UID&gt;</code> để mở khóa.';
      return bot.sendMessage(msg.chat.id, listTxt, { parse_mode: 'HTML' });
    }

    if (!reason) {
      return bot.sendMessage(
        msg.chat.id, 
        '⚠️ <b>THIẾU LÝ DO CẤM!</b>\n👉 Cú pháp bắt buộc: <code>/band &lt;UID&gt; &lt;Lý do&gt;</code>\nVí dụ: <code>/band 123456789 Spam mã nạp tiền</code>', 
        { parse_mode: 'HTML' }
      );
    }

    BLACKLIST_MAP.set(target, reason);
    await db.addToBlacklist(target, reason);

    bot.sendMessage(
      target, 
      `🚫 <b>TÀI KHOẢN CỦA BẠN ĐÃ BỊ CẤM!</b>\n─────────────────────────\n` +
      `📝 <b>Lý do:</b> <i>${reason}</i>\n` +
      `⏰ <b>Thời gian:</b> <code>${new Date().toLocaleString('vi-VN')}</code>\n` +
      `─────────────────────────\n` +
      `Mọi tương tác với hệ thống đã bị vô hiệu hóa.`, 
      { parse_mode: 'HTML' }
    ).catch(() => {});

    return bot.sendMessage(
      msg.chat.id, 
      `<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> <b>ĐÃ CẤM NGƯỜI DÙNG:</b> <code>${target}</code>\n📝 <b>Lý do:</b> <i>${reason}</i>`, 
      { parse_mode: 'HTML' }
    );
  });

  bot.onText(/\/unband(?:\s+(\d+))?/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const target = match[1]?.trim();

    if (!target) {
      return bot.sendMessage(msg.chat.id, '⚠️ Cú pháp: <code>/unband &lt;UID&gt;</code>\nVí dụ: <code>/unband 123456789</code>', { parse_mode: 'HTML' });
    }

    if (!BLACKLIST_MAP.has(target)) {
      return bot.sendMessage(msg.chat.id, `ℹ️ Người dùng <code>${target}</code> hiện không nằm trong danh sách bị cấm!`, { parse_mode: 'HTML' });
    }

    BLACKLIST_MAP.delete(target);
    await db.removeFromBlacklist(target);

    bot.sendMessage(
      target, 
      `<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> <b>TÀI KHOẢN CỦA BẠN ĐÃ ĐƯỢC MỞ KHÓA!</b>\nBạn đã có thể tiếp tục sử dụng bot bình thường qua lệnh /menu.`, 
      { parse_mode: 'HTML' }
    ).catch(() => {});

    return bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> Đã <b>MỞ KHÓA THÀNH CÔNG</b> cho người dùng: <code>${target}</code>!`, { parse_mode: 'HTML' });
  });

  bot.onText(/\/admin/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const { text, keyboard } = await buildAdminPanelMenu();
    return await bot.sendMessage(msg.chat.id, text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
  });

  bot.onText(/\/baotri(?:\s+(on|off))?/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const action = match[1]?.toLowerCase();

    if (!action) {
      return bot.sendMessage(msg.chat.id, `<b>TRẠNG THÁI BẢO TRÌ:</b> <code>${IS_MAINTENANCE ? 'ĐANG BẬT [ON]' : 'ĐANG TẮT [OFF]'}</code>\n👉 Dùng cú pháp: <code>/baotri on</code> hoặc <code>/baotri off</code>`, { parse_mode: 'HTML' });
    }

    if (action === 'on') {
      IS_MAINTENANCE = true;
      try {
        const cardBuffer = generateMaintenanceCard();
        await bot.sendPhoto(msg.chat.id, cardBuffer, {
          caption: `🚨 <b>ĐÃ KÍCH HOẠT CHẾ ĐỘ BẢO TRÌ!</b>\n<i>Khách hàng thao tác sẽ nhận thẻ thông báo bảo trì kèm lời cảm ơn.</i>`,
          parse_mode: 'HTML'
        });
      } catch (e) {
        bot.sendMessage(msg.chat.id, '<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> Đã BẬT bảo trì hệ thống!');
      }
    } else {
      IS_MAINTENANCE = false;
      bot.sendMessage(msg.chat.id, '<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> <b>ĐÃ TẮT BẢO TRÌ!</b> Cửa hàng đã hoạt động trở lại bình thường.', { parse_mode: 'HTML' });
    }
  });

  setInterval(async () => {
    const vnTimeStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' });
    const vnDate = new Date(vnTimeStr);
    
    const h = vnDate.getHours();
    const m = vnDate.getMinutes();
    const today = vnDate.toDateString();

    let triggerSession = null;
    let captionText = '';

    if (h === 7 && m >= 0 && m <= 5 && lastGreetedDay.morning !== today) {
      lastGreetedDay.morning = today;
      triggerSession = 'morning';
      captionText = `<b>CHÀO NGÀY MỚI!</b>\n<i>Hệ thống cập nhật thời tiết tại ${SELECTED_CITY}. Chúc bạn một ngày thuận lợi!</i>`;
    } 
    else if (h === 11 && m >= 30 && m <= 35 && lastGreetedDay.noon !== today) {
      lastGreetedDay.noon = today;
      triggerSession = 'noon';
      captionText = `<b>CHÚC BUỔI TRƯA AN LÀNH!</b>\n<i>Nghỉ ngơi và có bữa trưa thật ngon miệng nhé!</i>`;
    } 
    else if (h === 17 && m >= 30 && m <= 35 && lastGreetedDay.afternoon !== today) {
      lastGreetedDay.afternoon = today;
      triggerSession = 'afternoon';
      captionText = `<b>CHÚC BUỔI CHIỀU THẢNH THƠI!</b>\n<i>Kết thúc một ngày làm việc/học tập, nghỉ ngơi vui vẻ nhé!</i>`;
    } 
    else if (h === 21 && m >= 30 && m <= 35 && lastGreetedDay.night !== today) {
      lastGreetedDay.night = today;
      triggerSession = 'night';
      captionText = `<b>CHÚC BUỔI TỐI THƯ THÁI!</b>\n<i>Thư giãn sau một ngày dài và có một giấc ngủ ngon!</i>`;
    }

    if (triggerSession) {
      const weather = await fetchRealWeather(SELECTED_CITY);
      const card = generateGreetingCard('quý khách', weather, triggerSession);
      const users = await db.getAllUsers();
      for (const u of users) {
        if (isBlacklisted(u.id)) continue;
        bot.sendPhoto(u.id, card, {
          caption: captionText,
          parse_mode: 'HTML'
        }).catch(() => {});
      }
    }
  }, 20000);

  setInterval(async () => {
    if (pendingOrders.size === 0 && pendingDeposits.size === 0) return;

    const now = Date.now();
    const transactions = await sepay.getTransactions();

    for (const [orderId, order] of pendingOrders) {
      if (processingOrders.has(orderId)) continue;
      if (now - order.createdAt > ORDER_TIMEOUT_MS) {
        pendingOrders.delete(orderId);
        await db.updateOrder(orderId, null, 'expired');
        bot.sendMessage(order.chatId, `Đơn hàng <b>#${orderId}</b> đã bị hủy do hết hạn thanh toán.\n👉 Hãy gõ /menu để mua lại!`, { parse_mode: 'HTML' }).catch(() => {});
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
          await deliverOrder(bot, orderId, order.chatId, order.userId, { first_name: 'Khách hàng', id: order.userId }, product, accounts, 'BANK_QR');
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

        const oldBal = await db.getUserBalance(dep.userId);
        await db.addMoney(dep.userId, dep.amount);
        const newBal = await db.getUserBalance(dep.userId);

        if (dep.amount >= 150000 && db.addSpins) {
          const earnedSpins = Math.floor(dep.amount / 150000);
          await db.addSpins(dep.userId, earnedSpins);
          bot.sendMessage(dep.userId, `🎁 <b>BẠN ĐƯỢC TẶNG: +${earnedSpins} LƯỢT QUAY MAY MẮN!</b>\n<i>(Nhờ nạp từ 150.000đ trở lên). Mở /menu để quay nhận đến 10.000đ!</i>`, { parse_mode: 'HTML' }).catch(() => {});
        }

        try {
          const alertCardBuffer = generateBalanceAlertCard(dep.userId, dep.amount, oldBal, newBal, dep.content);
          await bot.sendPhoto(dep.userId, alertCardBuffer, {
            caption: `<b>THÔNG BÁO BIẾN ĐỘNG SỐ DƯ</b>\n<i>Tài khoản ví của bạn vừa được nạp tiền thành công!</i>`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: 'Mở Cửa Hàng Mua Sắm', callback_data: 'open_store', icon_custom_emoji_id: '5312361253610475399' }]]
            }
          });
        } catch (e) {
          bot.sendMessage(dep.userId, `<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> <b>NẠP TIỀN THÀNH CÔNG!</b>\n+${formatPrice(dep.amount)} | Số dư mới: ${formatPrice(newBal)}`, { parse_mode: 'HTML' }).catch(() => {});
        }

        const adminDepositNotice = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  <tg-emoji emoji-id="6138871037632191916">💳</tg-emoji> <b>CÓ GIAO DỊCH NẠP MỚI</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 👤 <b>Thành viên:</b> <code>${dep.userId}</code>
 ├ <tg-emoji emoji-id="6334849386031351338">💵</tg-emoji> <b>Số tiền nạp:</b> <code>+${formatPrice(dep.amount)}</code>
 ├ 📝 <b>Mã nạp:</b> <code>${dep.content}</code>
 ╰ <tg-emoji emoji-id="6138871037632191916">💳</tg-emoji> <b>Số dư sau nạp:</b> <code>${formatPrice(newBal)}</code>`;
        notifyAllAdmins(bot, adminDepositNotice);
      }
    }
  }, 25000);

  bot.onText(/\/settinh(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const cityInput = match[1]?.trim();
    if (!cityInput) {
      return bot.sendMessage(msg.chat.id, `Tỉnh/Thành hiện tại: <b>${SELECTED_CITY}</b>\n👉 Đổi tỉnh bằng cú pháp: <code>/settinh Hanoi</code> hoặc <code>/settinh Saigon</code>, <code>/settinh Danang</code>`, { parse_mode: 'HTML' });
    }
    SELECTED_CITY = cityInput;
    const weather = await fetchRealWeather(SELECTED_CITY);
    bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> <b>Đã lưu tỉnh thành: ${SELECTED_CITY.toUpperCase()}</b>\nNhiệt độ: <b>${weather.temp}</b> | ${weather.condition}`, { parse_mode: 'HTML' });
  });

  bot.onText(/\/testchuc(?:\s+(sang|trua|chieu|toi))?/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const type = match[1]?.toLowerCase();
    
    const vnTimeStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' });
    const curHour = new Date(vnTimeStr).getHours();

    let session = 'morning';
    if (type === 'sang') session = 'morning';
    else if (type === 'trua') session = 'noon';
    else if (type === 'chieu') session = 'afternoon';
    else if (type === 'toi') session = 'night';
    else {
      if (curHour >= 5 && curHour < 11) session = 'morning';
      else if (curHour >= 11 && curHour < 14) session = 'noon';
      else if (curHour >= 14 && curHour < 19) session = 'afternoon';
      else session = 'night';
    }

    bot.sendMessage(msg.chat.id, `⏳ Đang render thiệp chúc [${session.toUpperCase()}]...`);
    const weather = await fetchRealWeather(SELECTED_CITY);

    try {
      const card = generateGreetingCard(getFullName(msg.from) || 'Bạn', weather, session);
      await bot.sendPhoto(msg.chat.id, card, {
        caption: `<b>TEST THÀNH CÔNG: [${session.toUpperCase()}]</b>\nTỉnh: <b>${SELECTED_CITY}</b>\nThời tiết: <b>${weather.temp}</b> (${weather.condition})`,
        parse_mode: 'HTML'
      });
    } catch (err) {
      bot.sendMessage(msg.chat.id, 'Lỗi khi render ảnh chúc!');
    }
  });

  bot.onText(/\/uptime/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    try {
      const imgBuffer = generateUptimeImage();
      await bot.sendPhoto(msg.chat.id, imgBuffer, {
        caption: `<b>THÔNG SỐ MÁY CHỦ VPS & BOT</b>\n<i>Được tạo thời gian thực lúc: ${new Date().toLocaleTimeString('vi-VN')}</i>`,
        parse_mode: 'HTML'
      });
    } catch (err) {
      bot.sendMessage(msg.chat.id, 'Không thể tạo ảnh Canvas! Hãy chạy `npm install canvas`.');
    }
  });

  // ==================== LỆNH /start ====================
  bot.onText(/\/start/, async (msg) => {
    if (isBlacklisted(msg.from.id)) {
      const reason = getBanReason(msg.from.id);
      return bot.sendMessage(
        msg.chat.id, 
        `🚫 <b>TÀI KHOẢN BỊ KHÓA TƯƠNG TÁC</b>\n─────────────────────────\n📝 <b>Lý do:</b> <i>${reason}</i>`, 
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }

    if (IS_MAINTENANCE && !isAdmin(msg.from.id)) {
      try {
        const card = generateMaintenanceCard();
        return await bot.sendPhoto(msg.chat.id, card, {
          caption: `<b>HỆ THỐNG ĐANG BẢO TRÌ NÂNG CẤP</b>\n<i>Xin lỗi vì sự bất tiện này, shop sẽ quay lại sớm!</i>`,
          parse_mode: 'HTML'
        });
      } catch (err) {
        return bot.sendMessage(msg.chat.id, '⚠️ Hệ thống đang bảo trì, vui lòng quay lại sau!').catch(() => {});
      }
    }

    const userId = msg.from.id;
    await db.saveUser(userId, getFullName(msg.from), msg.from.username || '');
    const { text, keyboard } = await buildHomeMenu(userId);

    try {
      const welcomeCard = generateWelcomeCard(msg.from);
      await bot.sendPhoto(msg.chat.id, welcomeCard, {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (e) {
      await sendOrEditText(bot, msg.chat.id, null, text, keyboard);
    }
  });

  // ==================== LỆNH /menu ====================
  bot.onText(/\/menu/, async (msg) => {
    if (isBlacklisted(msg.from.id)) {
      const reason = getBanReason(msg.from.id);
      return bot.sendMessage(
        msg.chat.id, 
        `🚫 <b>TÀI KHOẢN BỊ KHÓA TƯƠNG TÁC</b>\n─────────────────────────\n📝 <b>Lý do:</b> <i>${reason}</i>`, 
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }

    if (IS_MAINTENANCE && !isAdmin(msg.from.id)) {
      try {
        const card = generateMaintenanceCard();
        return await bot.sendPhoto(msg.chat.id, card, {
          caption: `<b>HỆ THỐNG ĐANG BẢO TRÌ NÂNG CẤP</b>\n<i>Cảm ơn quý khách đã kiên nhẫn đồng hành cùng shop!</i>`,
          parse_mode: 'HTML'
        });
      } catch (err) {
        return bot.sendMessage(msg.chat.id, '⚠️ Hệ thống đang bảo trì!').catch(() => {});
      }
    }

    const userId = msg.from.id;
    await db.saveUser(userId, getFullName(msg.from), msg.from.username || '');
    const { text, keyboard } = await buildHomeMenu(userId);

    await sendOrEditText(bot, msg.chat.id, null, text, keyboard);
  });

  bot.onText(/\/revenue/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    try {
      const stats = await db.getRevenue();
      const products = await db.getAllProducts();
      let totalStock = 0;
      products.forEach(p => totalStock += (p.stock_count || 0));

      const todayStats = db.getTodayRevenue ? await db.getTodayRevenue() : { today_revenue: 0, today_orders: 0 };

      const imgBuffer = generateRevenueCard(stats, products, totalStock, todayStats);
      await bot.sendPhoto(msg.chat.id, imgBuffer, {
        caption: `<b>BÁO CÁO DOANH THU & ĐƠN HÀNG HÔM NAY</b>\n<i>Dữ liệu trích xuất từ database lúc ${new Date().toLocaleTimeString('vi-VN')}.</i>`,
        parse_mode: 'HTML'
      });
    } catch (err) {
      bot.sendMessage(msg.chat.id, 'Không thể kết xuất thẻ doanh thu!');
    }
  });

  bot.onText(/\/stats/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    try {
      const products = await db.getAllProducts();
      let totalStock = 0;
      products.forEach(p => totalStock += (p.stock_count || 0));

      const imgBuffer = generateStatsCard(products, totalStock);
      await bot.sendPhoto(msg.chat.id, imgBuffer, {
        caption: `<b>BÁO CÁO TỒN KHO THỰC TẾ</b>\n<i>Trực quan hóa kho dữ liệu thời gian thực.</i>`,
        parse_mode: 'HTML'
      });
    } catch (err) {
      bot.sendMessage(msg.chat.id, 'Không thể kết xuất thẻ tồn kho!');
    }
  });

  bot.onText(/\/orders/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    try {
      const orders = await db.getRecentOrders(12);
      if (orders.length === 0) return bot.sendMessage(msg.chat.id, 'Hiện chưa có đơn hàng nào!');

      const imgBuffer = generateOrdersLogCard(orders);
      await bot.sendPhoto(msg.chat.id, imgBuffer, {
        caption: `<b>NHẬT KÝ ĐƠN HÀNG GẦN ĐÂY</b>\n<i>Hiển thị chi tiết khách hàng, tên sản phẩm & số lượng mua.</i>`,
        parse_mode: 'HTML'
      });
    } catch (err) {
      bot.sendMessage(msg.chat.id, 'Không thể tạo nhật ký đơn hàng Canvas!');
    }
  });

  bot.onText(/\/categories/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const categories = await db.getAllCategories();
    const keyboard = categories.map(c => [{ text: `${c.name} (${c.product_count} SP)`, callback_data: `adm_cat_detail_${c.id}`, icon_custom_emoji_id: '5258389041006518073' }]);
    keyboard.push([{ text: 'Thêm danh mục mới', callback_data: 'adm_add_cat' }]);
    keyboard.push([{ text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }]);

    bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> <b>QUẢN LÝ DANH MỤC:</b>\nHiện có <b>${categories.length}</b> danh mục:`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  });

  bot.onText(/\/products/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const products = await db.getAllProducts();
    const keyboard = products.map(p => [{ text: `#${p.id} ${p.name} (Kho: ${p.stock_count})`, callback_data: 'adm_product_' + p.id }]);
    keyboard.push([{ text: 'Thêm sản phẩm mới', callback_data: 'adm_add_product' }]);
    keyboard.push([{ text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }]);
    bot.sendMessage(msg.chat.id, `<b>QUẢN TRỊ SẢN PHẨM:</b>\nTổng cộng: <b>${products.length}</b> mặt hàng.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
  });

  bot.onText(/\/users/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    try {
      const users = await db.getAllUsers();
      const PAGE_SIZE = 10;
      const totalPages = Math.ceil(users.length / PAGE_SIZE) || 1;
      const page = 1;

      const pageUsers = users.slice(0, PAGE_SIZE);
      const imgBuffer = generateUsersCard(pageUsers, page, totalPages);
      
      const keyboard = [];
      if (totalPages > 1) {
        keyboard.push([{ text: `Trang sau (Trang 2/${totalPages})`, callback_data: `adm_users_page_2` }]);
      }
      keyboard.push([{ text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }]);

      await bot.sendPhoto(msg.chat.id, imgBuffer, {
        caption: `<b>QUẢN LÝ THÀNH VIÊN HỆ THỐNG</b>\nTổng cộng: <b>${users.length}</b> thành viên.`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (e) {
      bot.sendMessage(msg.chat.id, 'Lỗi khi render bảng thành viên Canvas!');
    }
  });

  bot.onText(/\/setmoney(?:\s+(\d+)\s+(\d+))?/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const targetUserId = match[1];
    const amount = parseInt(match[2], 10);
    if (!targetUserId || isNaN(amount)) {
      return bot.sendMessage(msg.chat.id, 'Cú pháp: <code>/setmoney &lt;User_ID&gt; &lt;Số_tiền&gt;</code>', { parse_mode: 'HTML' });
    }
    await db.setUserBalance(targetUserId, amount);
    bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> Đã chỉnh số dư <code>${targetUserId}</code> thành <b>${formatPrice(amount)}</b>`, { parse_mode: 'HTML' });
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
      bot.sendMessage(chatId, `Đã dọn dẹp ${deleted} tin nhắn!`);
    });
  });

  bot.onText(/^\/broadcast$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const users = await db.getAllUsers();
    waitingEdit.set(msg.from.id, { field: 'broadcast' });
    const text = '<b>GỬI TIN THÔNG BÁO TỚI KHÁCH HÀNG</b>\n' +
                 '─────────────────────────\n' +
                 'Sẽ gửi tới: <b>' + users.length + '</b> khách hàng\n\n' +
                 'Nhắn nội dung thông báo vào đây:';
    bot.sendMessage(msg.chat.id, text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Hủy bỏ', callback_data: 'cancel_broadcast' }]] }
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
      if (isBlacklisted(user.id)) continue;
      try {
        await bot.sendMessage(user.id, `<b>THÔNG BÁO TỪ SHOP:</b>\n\n${content}`, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: 'Mở Cửa Hàng', callback_data: 'open_store', icon_custom_emoji_id: '5312361253610475399' }]]
          }
        });
        sent++;
      } catch (e) {
        failed++;
      }
    }

    const text = '<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> <b>ĐÃ GỬI THÔNG BÁO HOÀN TẤT</b>\n' +
                 '─────────────────────────\n' +
                 'Gửi thành công: <b>' + sent + '</b>\n' +
                 'Thất bại/Chặn: <b>' + failed + '</b>';
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  async function createDepositQR(chatId, userFrom, amount, oldMessageId) {
    const userTgId = userFrom.id;
    const content = 'SEVQR ' + generateCode('NAP');
    const deposit = await db.createDeposit(userTgId, amount, content);
    pendingDeposits.set(deposit.id, { userId: userTgId, amount, content, createdAt: deposit.createdAt });

    const caption = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  <tg-emoji emoji-id="6138871037632191916">💳</tg-emoji> <b>YÊU CẦU NẠP TIỀN TỰ ĐỘNG</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ <tg-emoji emoji-id="6334849386031351338">💵</tg-emoji> <b>Số tiền:</b> <code>${formatPrice(amount)}</code>
 ├ 🏦 <b>Ngân hàng:</b> <b>${config.BANK_NAME}</b>
 ├ <tg-emoji emoji-id="6138871037632191916">💳</tg-emoji> <b>Số tài khoản:</b> <code>${config.BANK_ACCOUNT}</code>
 ├ 👤 <b>Chủ tài khoản:</b> <b>${config.BANK_OWNER}</b>
 ╰ 📝 <b>Nội dung CK:</b> <code>${content}</code>
─────────────────────────
<b>LƯU Ý:</b>
 • Quét mã QR và giữ nguyên nội dung chuyển khoản.
 • Nạp từ 150.000đ được tặng thêm 1 LƯỢT QUAY MAY MẮN!
 • Hệ thống tự động duyệt trong 15 - 30 giây.`;

    if (oldMessageId) {
      try { await bot.deleteMessage(chatId, oldMessageId); } catch (_) {}
    }

    await bot.sendPhoto(chatId, getQRUrl(amount, content), {
      caption: caption,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Quay lại Hồ sơ', callback_data: 'main_profile', icon_custom_emoji_id: '5256247952564825322' }]] }
    }).catch(() => {});

    const adminMsg = 
`<b>GIAO DỊCH NẠP CHỜ QUÉT MÃ</b>
─────────────────────────
 ├ 👤 <b>Khách hàng:</b> ${getFullName(userFrom)} (<code>${userTgId}</code>)
 ├ <tg-emoji emoji-id="6334849386031351338">💵</tg-emoji> <b>Số tiền:</b> <code>${formatPrice(amount)}</code>
 ╰ 📝 <b>Nội dung CK:</b> <code>${content}</code>`;
    notifyAllAdmins(bot, adminMsg);
  }

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    const messageId = query.message.message_id;

    if (isBlacklisted(userId)) {
      const reason = getBanReason(userId);
      return bot.answerCallbackQuery(query.id, { 
        text: `Tài khoản của bạn đã bị cấm!\nLý do: ${reason}`, 
        show_alert: true 
      });
    }

    if (IS_MAINTENANCE && !isAdmin(userId)) {
      try {
        const cardBuffer = generateMaintenanceCard();
        await bot.sendPhoto(chatId, cardBuffer, {
          caption: `<b>HỆ THỐNG ĐANG BẢO TRÌ NÂNG CẤP</b>\n<i>Cảm ơn quý khách đã tin tưởng và đồng hành cùng shop!</i>`,
          parse_mode: 'HTML'
        });
      } catch (err) {}
      return bot.answerCallbackQuery(query.id, { text: 'Hệ thống đang bảo trì!', show_alert: true });
    }

    try {
      if (data === 'none') {
        return bot.answerCallbackQuery(query.id);
      }

      if (data === 'cancel_broadcast') {
        waitingEdit.delete(userId);
        return bot.editMessageText('Đã hủy thao tác thông báo.', { chat_id: chatId, message_id: messageId });
      }

      if (data === 'close_view') {
        try {
          await bot.deleteMessage(chatId, messageId);
        } catch (_) {}
        return bot.answerCallbackQuery(query.id);
      }

      if (data === 'play_wheel') {
        const spins = db.getUserSpins ? (await db.getUserSpins(userId)) : 0;
        if (spins <= 0) {
          return bot.answerCallbackQuery(query.id, {
            text: 'Bạn chưa có lượt quay! Hãy nạp tích lũy từ 150.000đ để nhận 1 lượt quay nhé.',
            show_alert: true
          });
        }

        if (db.useSpin) await db.useSpin(userId);
        const prizePool = [1000, 2000, 3000, 5000, 8000, 10000];
        const wonAmount = prizePool[Math.floor(Math.random() * prizePool.length)];

        await db.addMoney(userId, wonAmount);
        const cardBuffer = generateWheelCard(query.from, wonAmount, spins - 1);

        try { await bot.deleteMessage(chatId, messageId); } catch (_) {}

        return await bot.sendPhoto(chatId, cardBuffer, {
          caption: `<b>CHÚC MỪNG BẠN ĐÃ TRÚNG: +${formatPrice(wonAmount)}!</b>\n<i>Tiền đã được chuyển vào số dư ví của bạn.</i>`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              ...(spins - 1 > 0 ? [[{ text: 'Quay tiếp', callback_data: 'play_wheel' }]] : []),
              [{ text: 'Mở Cửa Hàng', callback_data: 'open_store', icon_custom_emoji_id: '5312361253610475399' }],
              [{ text: 'Trang Chủ', callback_data: 'back_main', icon_custom_emoji_id: '5256247952564825322' }]
            ]
          }
        }).catch(() => {});
      }

      if (data === 'fb_skip') {
        try { await bot.deleteMessage(chatId, messageId); } catch (_) {}
        return bot.answerCallbackQuery(query.id, { text: 'Cảm ơn bạn đã ủng hộ shop!' });
      }

      if (data.startsWith('fb_star_')) {
        const [, , orderIdStr, starsStr] = data.split('_');
        const orderId = parseInt(orderIdStr);
        const stars = parseInt(starsStr);

        const order = await db.getOrderById ? await db.getOrderById(orderId) : null;
        const prod = order ? await db.getProduct(order.product_id) : null;

        const prodName = prod ? prod.name : 'Sản phẩm số';
        const totalPrice = order ? order.total_price : 0;

        pendingFeedbacks.set(userId, {
          orderId,
          productName: prodName,
          totalPrice,
          stars,
          messageId
        });
        waitingEdit.set(userId, { field: 'feedback_comment', orderId });

        const promptText = 
`<b>BẠN ĐÃ CHỌN: ${stars} SAO ⭐</b>\n─────────────────────────\n` +
`Hãy nhập <b>lời góp ý / nhận xét</b> của bạn về đơn hàng vào khung chat bên dưới.\n\n` +
`<i>(Nếu không muốn viết nhận xét, bấm nút "Gửi đánh giá ngay" bên dưới)</i>`;

        return await sendOrEditText(bot, chatId, messageId, promptText, [
          [{ text: 'Gửi đánh giá ngay (Không viết)', callback_data: `fb_submit_empty_${orderId}` }]
        ]);
      }

      if (data.startsWith('fb_submit_empty_')) {
        const fbData = pendingFeedbacks.get(userId);
        if (!fbData) return bot.answerCallbackQuery(query.id);

        waitingEdit.delete(userId);
        pendingFeedbacks.delete(userId);

        try { await bot.deleteMessage(chatId, messageId); } catch (_) {}
        await publishFeedback(bot, query.from, fbData.productName, fbData.totalPrice, fbData.stars, '');
        return bot.answerCallbackQuery(query.id, { text: 'Cảm ơn bạn đã gửi đánh giá!' });
      }

      if (data === 'set_lang_vi' || data === 'set_lang_en') {
        const selectedLang = data === 'set_lang_vi' ? 'vi' : 'en';
        await db.setUserLang(userId, selectedLang);
        const { text, keyboard } = await buildHomeMenu(userId);
        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
      }

      if (data === 'open_store') {
        const { text, keyboard } = await buildStoreMenu(userId);
        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
      }

      if (data === 'main_shop' || data === 'back_main') {
        const { text, keyboard } = await buildHomeMenu(userId);
        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
      }

      if (data === 'view_instock') {
        const allProducts = await db.getAllProducts();
        const availableProducts = allProducts.filter(p => (p.stock_count || 0) > 0);

        if (availableProducts.length === 0) {
          return bot.answerCallbackQuery(query.id, { 
            text: 'Hiện tại tất cả mặt hàng đều đang hết! Vui lòng quay lại sau.', 
            show_alert: true 
          });
        }

        try {
          const cardBuffer = generateInStockCard(availableProducts);
          try { await bot.deleteMessage(chatId, messageId); } catch (_) {}

          const keyboard = [];
          availableProducts.slice(0, 8).forEach(p => {
            keyboard.push([{
              text: `Mua: ${p.name} (${formatPrice(p.price)})`,
              callback_data: `product_${p.id}`,
              icon_custom_emoji_id: '5312361253610475399'
            }]);
          });

          keyboard.push([{ text: 'Quay lại Trang chủ', callback_data: 'back_main', icon_custom_emoji_id: '5256247952564825322' }]);

          return await bot.sendPhoto(chatId, cardBuffer, {
            caption: `<b>DANH SÁCH MẶT HÀNG ĐANG SẴN KHO</b>\n<i>Chọn nhanh sản phẩm bên dưới để tiến hành thanh toán & nhận acc tự động:</i>`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
          });
        } catch (err) {
          return bot.answerCallbackQuery(query.id, { text: 'Không thể xuất danh sách hàng lúc này!' });
        }
      }

      if (data === 'show_support') {
        const supportText = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  <tg-emoji emoji-id="5395804191769763641">👑</tg-emoji> <b>TRUNG TÂM HỖ TRỢ (SUPPORT)</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
Nếu bạn cần hỗ trợ về đơn hàng, nạp tiền hoặc bảo hành, vui lòng liên hệ trực tiếp với đội ngũ Admin bên dưới:

• <b>Admin 1:</b> @accffgiatot
• <b>Admin 2:</b> @foxxzy116
─────────────────────────
<i>Chọn một trong hai kênh bên dưới để nhắn tin:</i>`;

        const supportKeyboard = [
          [{ text: 'Liên hệ Admin 1 (@accffgiatot)', url: 'https://t.me/accffgiatot', icon_custom_emoji_id: '5395804191769763641' }],
          [{ text: 'Liên hệ Admin 2 (@foxxzy116)', url: 'https://t.me/foxxzy116', icon_custom_emoji_id: '5395804191769763641' }],
          [{ text: 'Quay lại Trang chủ', callback_data: 'back_main', icon_custom_emoji_id: '5256247952564825322' }]
        ];

        return await sendOrEditText(bot, chatId, messageId, supportText, supportKeyboard);
      }

      if (data === 'change_language') {
        const langText = `<tg-emoji emoji-id="5298584437338946835">🌐</tg-emoji> <b>LỰA CHỌNG NGÔN NGỮ HIỂN THỊ:</b>\n─────────────────────────\n<i>Vui lòng chọn ngôn ngữ bên dưới:</i>`;
        return await sendOrEditText(bot, chatId, messageId, langText, getLanguageKeyboard());
      }

      if (data === 'view_top_deposits') {
        let topList = [];
        if (db.getTopDeposits) {
          topList = await db.getTopDeposits(10);
        }

        try {
          const podiumBuffer = await generateLeaderboardPodium(topList, bot);
          try { await bot.deleteMessage(chatId, messageId); } catch (_) {}

          const keyboard = [
            [{ text: 'Nạp tiền ngay', callback_data: 'deposit_menu', icon_custom_emoji_id: '6334849386031351338' }],
            [{ text: 'Về Trang Chủ', callback_data: 'back_main', icon_custom_emoji_id: '5256247952564825322' }]
          ];

          return await bot.sendPhoto(chatId, podiumBuffer, {
            caption: `<tg-emoji emoji-id="6300766415355908268">🏆</tg-emoji> <b>BẢNG VINH DANH TOP ĐẠI GIA</b> <tg-emoji emoji-id="6300766415355908268">🏆</tg-emoji>\n<i>Nạp tiền ngay để leo lên bục vinh danh cao quý nhất!</i>`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
          });
        } catch (err) {}
      }

      if (data.startsWith('view_category_')) {
        const catId = parseInt(data.split('_')[2]);
        const cat = await db.getCategory(catId);
        const products = await db.getProductsByCategory(catId);
        let lang = (await db.getUserLang(userId)) || 'vi';
        const t = MESSAGES[lang] || MESSAGES.vi;

        if (products.length === 0) {
          return bot.answerCallbackQuery(query.id, { text: 'Danh mục này tạm thời chưa có hàng!', show_alert: true });
        }

        const keyboard = products.map(p => {
          const stockBadge = (p.stock_count > 0) ? `🟢 Còn ${p.stock_count}` : `🔴 Hết`;
          const prodBtn = {
            text: `${p.name} ▫️ ${getDisplayPrice(p)} [${stockBadge}]`,
            callback_data: 'product_' + p.id
          };
          const emojiId = p.custom_emoji_id || cat?.custom_emoji_id || '6300766415355908268';
          if (emojiId) {
            prodBtn.icon_custom_emoji_id = emojiId;
          }
          return [prodBtn];
        });
        keyboard.push([{ text: 'Về Cửa Hàng', callback_data: 'open_store', icon_custom_emoji_id: '5256247952564825322' }]);
        keyboard.push([{ text: t.btn_back_home, callback_data: 'back_main', icon_custom_emoji_id: '5256247952564825322' }]);

        const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  <tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> <b>DANH MỤC: ${(cat ? cat.name : 'SẢN PHẨM').toUpperCase()}</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
<i>${cat?.description || 'Chọn mặt hàng bên dưới để tiến hành mua:'}</i>`;

        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
      }

      if (data.startsWith('product_')) {
        const productId = parseInt(data.split('_')[1]);
        const product = await db.getProduct(productId);
        if (!product) return bot.answerCallbackQuery(query.id, { text: 'Sản phẩm không tồn tại!' });

        const stock = product.stock_count;
        if (stock <= 0) {
          return bot.answerCallbackQuery(query.id, { text: 'Sản phẩm này hiện đã hết hàng!', show_alert: true });
        }

        const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  🎁 <b>${product.name.toUpperCase()}</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n` +
          productPriceBlockUser(product) +
          '<b>Kho hàng:</b> <code>' + stock + '</code> tài khoản\n' +
          (product.description ? '<b>Mô tả:</b> <i>' + product.description + '</i>\n' : '') +
          '─────────────────────────\n' +
          '<i>Dùng nút [ ➖ ] [ Tăng ] để chỉnh số lượng hoặc bấm nhập số lượng:</i>';

        const keyboard = buildProductSelectKeyboard(product, 1);
        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
      }

      if (data.startsWith('adjqty_')) {
        const [, productId, targetQtyStr] = data.split('_');
        const product = await db.getProduct(parseInt(productId));
        if (!product) return bot.answerCallbackQuery(query.id, { text: 'Sản phẩm không tồn tại!' });

        let targetQty = parseInt(targetQtyStr);
        if (targetQty < 1) {
          return bot.answerCallbackQuery(query.id, { text: 'Số lượng tối thiểu là 1!' });
        }
        if (targetQty > product.stock_count) {
          return bot.answerCallbackQuery(query.id, { text: `Trong kho chỉ còn ${product.stock_count} sản phẩm!`, show_alert: true });
        }

        const keyboard = buildProductSelectKeyboard(product, targetQty);
        try {
          await bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, { chat_id: chatId, message_id: messageId });
        } catch (_) {}
        return bot.answerCallbackQuery(query.id);
      }

      if (data.startsWith('customqty_')) {
        const productId = parseInt(data.split('_')[1]);
        const product = await db.getProduct(productId);
        if (!product) return bot.answerCallbackQuery(query.id, { text: 'Sản phẩm không tồn tại!' });
        waitingEdit.set(userId, { field: 'custom_qty', productId, messageId });

        const text = '<b>NHẬP SỐ LƯỢNG MUA</b>\n' +
                     '─────────────────────────\n' +
                     'Mặt hàng: <b>' + product.name + '</b>\n' +
                     productPriceBlockUser(product) +
                     'Kho hiện có: <b>' + product.stock_count + '</b> sp\n\n' +
                     '<i>Nhập số lượng bạn muốn mua vào khung chat:</i>';

        return await sendOrEditText(bot, chatId, messageId, text, [[{ text: 'Hủy bỏ', callback_data: 'product_' + productId }]]);
      }

      if (data.startsWith('qty_')) {
        const [, productId, quantity] = data.split('_');
        const product = await db.getProduct(parseInt(productId));
        const qty = parseInt(quantity);
        if (product.stock_count < qty) return bot.answerCallbackQuery(query.id, { text: 'Kho không đủ số lượng yêu cầu!', show_alert: true });

        const totalPrice = db.calculatePrice(product, qty);
        const unitPrice = db.getUnitPrice(product, qty);
        const userBalance = await db.getUserBalance(userId);

        const discountInfo = unitPrice < product.price ? '\n ├ <b>Giá ưu đãi:</b> <code>' + formatPrice(unitPrice) + '/sp</code>' : '';
        const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  🧾 <b>XÁC NHẬN ĐƠN MUA HÀNG</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 🎁 <b>Mặt hàng:</b> <b>${product.name}</b>
 ├ 🔢 <b>Số lượng:</b> <code>${qty} acc</code>${discountInfo}
 ├ 💰 <b>Tổng tiền:</b> <code>${formatPrice(totalPrice)}</code>
 ╰ <tg-emoji emoji-id="6138871037632191916">💳</tg-emoji> <b>Số dư ví:</b> <code>${formatPrice(userBalance)}</code>
─────────────────────────
<i>Chọn hình thức thanh toán bên dưới:</i>`;

        const keyboard = [
          [{ text: 'Mua bằng SỐ DƯ VÍ', callback_data: `paywallet_${productId}_${qty}` }],
          [{ text: 'Quét mã QR NGÂN HÀNG', callback_data: `paybank_${productId}_${qty}` }],
          [{ text: 'Thay đổi số lượng', callback_data: `product_${productId}`, icon_custom_emoji_id: '5256247952564825322' }]
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
        try { await bot.deleteMessage(chatId, messageId); } catch (_) {}
        await deliverOrder(bot, order.lastInsertRowid, chatId, userId, query.from, product, accounts, 'WALLET');
        return;
      }

      if (data.startsWith('paybank_')) {
        const [, productId, quantity] = data.split('_');
        const product = await db.getProduct(parseInt(productId));
        const qty = parseInt(quantity);
        const totalPrice = db.calculatePrice(product, qty);
        const unitPrice = db.getUnitPrice(product, qty);

        const content = 'SEVQR ' + generateCode();
        const order = await db.createOrder(userId, parseInt(productId), chatId, content, qty, totalPrice);
        const orderId = order.lastInsertRowid;
        pendingOrders.set(orderId, { chatId, userId, productId: parseInt(productId), quantity: qty, totalPrice, content, createdAt: order.createdAt });

        try { await bot.deleteMessage(chatId, messageId); } catch (_) {}
        const discountInfo = unitPrice < product.price ? '\n ├ <b>Ưu đãi:</b> <code>' + formatPrice(unitPrice) + '/sp</code>' : '';
        const caption = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  <tg-emoji emoji-id="6138871037632191916">💳</tg-emoji> <b>THANH TOÁN ĐƠN HÀNG #${orderId}</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 🎁 <b>Mặt hàng:</b> <b>${product.name}</b> (x${qty})${discountInfo}
 ├ 💰 <b>Tổng tiền:</b> <code>${formatPrice(totalPrice)}</code>
 ├ 🏦 <b>Ngân hàng:</b> <b>${config.BANK_NAME}</b>
 ├ <tg-emoji emoji-id="6138871037632191916">💳</tg-emoji> <b>STK:</b> <code>${config.BANK_ACCOUNT}</code>
 ├ 👤 <b>Chủ TK:</b> <b>${config.BANK_OWNER}</b>
 ╰ 📝 <b>Nội dung CK:</b> <code>${content}</code>
─────────────────────────
📲 <i>Quét mã QR bên trên để thanh toán tự động.</i>
⚡ <i>Hệ thống tự động phát file tài khoản ngay sau khi nhận tiền!</i>`;

        await bot.sendPhoto(chatId, getQRUrl(totalPrice, content), {
          caption,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Kiểm tra thanh toán', callback_data: 'check_' + orderId + '_' + productId + '_' + qty }],
              [{ text: 'Hủy đơn này', callback_data: 'cancel_' + orderId }]
            ]
          }
        }).catch(() => {});

        const adminOrderAlert = 
`<b>ĐƠN HÀNG MỚI ĐANG CHỜ QUÉT MÃ QR</b>
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
          return bot.answerCallbackQuery(query.id, { text: 'Đang quét giao dịch ngân hàng, vui lòng đợi...', show_alert: true });
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
            await deliverOrder(bot, orderIdNum, chatId, userId, query.from, product, accounts, 'BANK_QR');
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
        const { text, keyboard } = await buildHomeMenu(userId);
        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
      }

      if (data === 'main_profile') {
        const orders = await db.getOrdersByUser(userId);
        const completed = orders.filter(o => o.status === 'completed');
        const totalSpent = completed.reduce((sum, o) => sum + (o.total_price || 0), 0);
        const balance = await db.getUserBalance(userId);
        const { totalDeposit } = await db.getUserDepositStats(userId);

        let avatarUrl = null;
        try {
          const userProfiles = await bot.getUserProfilePhotos(userId, { limit: 1 });
          if (userProfiles.total_count > 0) {
            const fileId = userProfiles.photos[0][0].file_id;
            avatarUrl = await bot.getFileLink(fileId);
          }
        } catch (_) {}

        try {
          const cardBuffer = await generateProfileCard(query.from, balance, totalDeposit, totalSpent, avatarUrl);
          try { await bot.deleteMessage(chatId, messageId); } catch (_) {}

          const keyboard = [
            [{ text: 'Nạp tiền vào ví', callback_data: 'deposit_menu', icon_custom_emoji_id: '6334849386031351338' }],
            [{ text: 'Lịch sử mua hàng', callback_data: 'main_history', icon_custom_emoji_id: '6147610325416941553' }],
            [{ text: 'Mở Cửa Hàng', callback_data: 'open_store', icon_custom_emoji_id: '5312361253610475399' }],
            [{ text: 'Về Trang Chủ', callback_data: 'back_main', icon_custom_emoji_id: '5256247952564825322' }]
          ];

          return await bot.sendPhoto(chatId, cardBuffer, {
            caption: `<tg-emoji emoji-id="6032693626394382504">👤</tg-emoji> <b>THẺ ĐỊNH DANH THÀNH VIÊN</b>\n<i>Hạng thẻ tự động thăng cấp theo tổng tiền nạp của bạn.</i>`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
          });
        } catch (e) {}
      }

      if (data === 'deposit_menu') {
        const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  <tg-emoji emoji-id="6138871037632191916">💳</tg-emoji> <b>NẠP TIỀN TỰ ĐỘNG VÀO VÍ</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
<i>Hệ thống quét biến động VietQR tự động 24/7.
Nạp từ 150.000đ được tặng thêm 1 lượt quay may mắn!</i>`;

        const keyboard = [
          [{ text: '20.000đ', callback_data: 'dep_amt_20000', icon_custom_emoji_id: '6334849386031351338' }, { text: '50.000đ', callback_data: 'dep_amt_50000', icon_custom_emoji_id: '6334849386031351338' }],
          [{ text: '100.000đ', callback_data: 'dep_amt_100000', icon_custom_emoji_id: '6334849386031351338' }, { text: '150.000đ (+1 Quay)', callback_data: 'dep_amt_150000', icon_custom_emoji_id: '6334849386031351338' }],
          [{ text: '200.000đ', callback_data: 'dep_amt_200000', icon_custom_emoji_id: '6334849386031351338' }, { text: '500.000đ', callback_data: 'dep_amt_500000', icon_custom_emoji_id: '6334849386031351338' }],
          [{ text: 'Nhập số khác', callback_data: 'dep_custom' }],
          [{ text: 'Về Trang Chủ', callback_data: 'back_main', icon_custom_emoji_id: '5256247952564825322' }]
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
        const text = `<b>NHẬP SỐ TIỀN CẦN NẠP</b>\n─────────────────────────\n<i>Vui lòng nhập số tiền bạn muốn nạp (tối thiểu 10.000đ):</i>`;
        return await sendOrEditText(bot, chatId, messageId, text, [[{ text: 'Hủy bỏ', callback_data: 'deposit_menu' }]]);
      }

      if (data === 'main_history') {
        const orders = await db.getOrderHistory(userId);
        if (orders.length === 0) return bot.answerCallbackQuery(query.id, { text: 'Bạn chưa có lịch sử mua hàng!', show_alert: true });

        let text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  <tg-emoji emoji-id="6147610325416941553">📜</tg-emoji> <b>LỊCH SỬ MUA HÀNG GẦN ĐÂY</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n`;
        const keyboard = [];
        orders.slice(0, 8).forEach((o) => {
          const statusIcon = o.status === 'completed' ? '<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji>' : o.status === 'pending' ? '⏳' : '❌';
          text += `${statusIcon} <b>#${o.id}</b> • <b>${o.product_name}</b> (x${o.quantity || 1}) - <code>${formatPrice(o.total_price)}</code>\n`;
          if (o.status === 'completed' && o.delivered_data) {
            keyboard.push([{ text: `Tải file đơn #${o.id} (${o.product_name})`, callback_data: `dl_order_${o.id}` }]);
          }
        });
        keyboard.push([{ text: 'Mở Cửa Hàng', callback_data: 'open_store', icon_custom_emoji_id: '5312361253610475399' }]);
        keyboard.push([{ text: 'Về Trang Chủ', callback_data: 'back_main', icon_custom_emoji_id: '5256247952564825322' }]);

        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
      }

      if (data.startsWith('dl_order_')) {
        const orderId = parseInt(data.split('_')[2]);
        const order = await db.getOrderById(orderId);
        if (order && order.delivered_data) {
          const txtBuffer = Buffer.from(order.delivered_data, 'utf-8');
          await bot.sendDocument(chatId, txtBuffer, { caption: `<tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> File đơn #${order.id}` }, { filename: `DonHang_${order.id}.txt`, contentType: 'text/plain' }).catch(() => {});
        }
        return bot.answerCallbackQuery(query.id);
      }

      if (isAdmin(userId)) {
        if (data === 'adm_panel_home') {
          const { text, keyboard } = await buildAdminPanelMenu();
          return await sendOrEditText(bot, chatId, messageId, text, keyboard);
        }

        if (data === 'adm_panel_toggle_maint') {
          IS_MAINTENANCE = !IS_MAINTENANCE;
          bot.answerCallbackQuery(query.id, { 
            text: IS_MAINTENANCE ? 'Đã BẬT bảo trì hệ thống!' : 'Đã TẮT bảo trì!', 
            show_alert: true 
          });
          const { text, keyboard } = await buildAdminPanelMenu();
          return await sendOrEditText(bot, chatId, messageId, text, keyboard);
        }

        if (data === 'adm_panel_products') {
          const products = await db.getAllProducts();
          const keyboard = products.map(p => [{ text: `#${p.id} ${p.name} (Kho: ${p.stock_count})`, callback_data: 'adm_product_' + p.id }]);
          keyboard.push([{ text: 'Thêm sản phẩm mới', callback_data: 'adm_add_product' }]);
          keyboard.push([{ text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }]);
          return await sendOrEditText(bot, chatId, messageId, `<b>QUẢN TRỊ SẢN PHẨM:</b>\nTổng cộng: <b>${products.length}</b> mặt hàng.`, keyboard);
        }

        if (data === 'adm_panel_categories') {
          const categories = await db.getAllCategories();
          const keyboard = categories.map(c => [{ text: `${c.name} (${c.product_count} SP)`, callback_data: `adm_cat_detail_${c.id}`, icon_custom_emoji_id: '5258389041006518073' }]);
          keyboard.push([{ text: 'Thêm danh mục mới', callback_data: 'adm_add_cat' }]);
          keyboard.push([{ text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }]);
          return await sendOrEditText(bot, chatId, messageId, `<tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> <b>QUẢN LÝ DANH MỤC:</b>\nHiện có <b>${categories.length}</b> danh mục:`, keyboard);
        }

        if (data === 'adm_panel_stock') {
          const products = await db.getAllProducts();
          let totalStock = 0;
          products.forEach(p => totalStock += (p.stock_count || 0));

          try {
            const imgBuffer = generateStatsCard(products, totalStock);
            try { await bot.deleteMessage(chatId, messageId); } catch (_) {}
            return await bot.sendPhoto(chatId, imgBuffer, {
              caption: `<b>BÁO CÁO TỒN KHO THỰC TẾ</b>\n<i>Trực quan hóa kho dữ liệu thời gian thực.</i>`,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [[{ text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }]]
              }
            });
          } catch (e) {
            return bot.answerCallbackQuery(query.id, { text: 'Lỗi render ảnh tồn kho!' });
          }
        }

        if (data === 'adm_panel_revenue') {
          const stats = await db.getRevenue();
          const products = await db.getAllProducts();
          let totalStock = 0;
          products.forEach(p => totalStock += (p.stock_count || 0));
          const todayStats = db.getTodayRevenue ? await db.getTodayRevenue() : { today_revenue: 0, today_orders: 0 };

          try {
            const imgBuffer = generateRevenueCard(stats, products, totalStock, todayStats);
            try { await bot.deleteMessage(chatId, messageId); } catch (_) {}
            return await bot.sendPhoto(chatId, imgBuffer, {
              caption: `<b>BÁO CÁO DOANH THU & ĐƠN HÀNG HÔM NAY</b>\n<i>Dữ liệu trích xuất từ database lúc ${new Date().toLocaleTimeString('vi-VN')}.</i>`,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [[{ text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }]]
              }
            });
          } catch (e) {
            return bot.answerCallbackQuery(query.id, { text: 'Lỗi render ảnh doanh thu!' });
          }
        }

        if (data === 'adm_panel_orders') {
          const orders = await db.getRecentOrders(12);
          if (orders.length === 0) return bot.answerCallbackQuery(query.id, { text: 'Hiện chưa có đơn hàng nào!', show_alert: true });

          try {
            const imgBuffer = generateOrdersLogCard(orders);
            try { await bot.deleteMessage(chatId, messageId); } catch (_) {}
            return await bot.sendPhoto(chatId, imgBuffer, {
              caption: `<b>NHẬT KÝ ĐƠN HÀNG GẦN ĐÂY</b>\n<i>Hiển thị chi tiết khách hàng, tên sản phẩm & số lượng mua.</i>`,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [[{ text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }]]
              }
            });
          } catch (e) {
            return bot.answerCallbackQuery(query.id, { text: 'Lỗi render ảnh đơn hàng!' });
          }
        }

        if (data === 'adm_panel_users') {
          const users = await db.getAllUsers();
          const PAGE_SIZE = 10;
          const totalPages = Math.ceil(users.length / PAGE_SIZE) || 1;
          const page = 1;
          const pageUsers = users.slice(0, PAGE_SIZE);

          try {
            const imgBuffer = generateUsersCard(pageUsers, page, totalPages);
            try { await bot.deleteMessage(chatId, messageId); } catch (_) {}

            const keyboard = [];
            if (totalPages > 1) {
              keyboard.push([{ text: `Trang sau (Trang 2/${totalPages})`, callback_data: `adm_users_page_2` }]);
            }
            keyboard.push([{ text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }]);

            return await bot.sendPhoto(chatId, imgBuffer, {
              caption: `<b>QUẢN LÝ THÀNH VIÊN HỆ THỐNG</b>\nTổng cộng: <b>${users.length}</b> thành viên.`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: keyboard }
            });
          } catch (e) {
            return bot.answerCallbackQuery(query.id, { text: 'Lỗi render bảng thành viên!' });
          }
        }

        if (data === 'adm_panel_uptime') {
          try {
            const imgBuffer = generateUptimeImage();
            try { await bot.deleteMessage(chatId, messageId); } catch (_) {}
            return await bot.sendPhoto(chatId, imgBuffer, {
              caption: `<b>THÔNG SỐ MÁY CHỦ VPS & BOT</b>\n<i>Được tạo thời gian thực lúc: ${new Date().toLocaleTimeString('vi-VN')}</i>`,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [[{ text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }]]
              }
            });
          } catch (e) {
            return bot.answerCallbackQuery(query.id, { text: 'Lỗi render ảnh Uptime!' });
          }
        }

        if (data === 'adm_panel_broadcast') {
          const users = await db.getAllUsers();
          waitingEdit.set(userId, { field: 'broadcast' });
          const text = '<b>GỬI TIN THÔNG BÁO TỚI KHÁCH HÀNG</b>\n' +
                       '─────────────────────────\n' +
                       'Sẽ gửi tới: <b>' + users.length + '</b> khách hàng\n\n' +
                       'Nhắn nội dung thông báo vào đây:';
          return await sendOrEditText(bot, chatId, messageId, text, [
            [{ text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }]
          ]);
        }

        if (data === 'adm_panel_testchuc') {
          const vnTimeStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' });
          const curHour = new Date(vnTimeStr).getHours();
          let session = 'morning';
          if (curHour >= 5 && curHour < 11) session = 'morning';
          else if (curHour >= 11 && curHour < 14) session = 'noon';
          else if (curHour >= 14 && curHour < 19) session = 'afternoon';
          else session = 'night';

          const weather = await fetchRealWeather(SELECTED_CITY);
          try {
            const card = generateGreetingCard(getFullName(query.from) || 'Bạn', weather, session);
            try { await bot.deleteMessage(chatId, messageId); } catch (_) {}
            return await bot.sendPhoto(chatId, card, {
              caption: `<b>TEST THIỆP CHÚC TỪ PANEL: [${session.toUpperCase()}]</b>\nTỉnh: <b>${SELECTED_CITY}</b>\nThời tiết: <b>${weather.temp}</b> (${weather.condition})`,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [[{ text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }]]
              }
            });
          } catch (e) {
            return bot.answerCallbackQuery(query.id, { text: 'Lỗi render thiệp chúc!' });
          }
        }

        if (data.startsWith('adm_users_page_')) {
          const targetPage = parseInt(data.split('_')[3]);
          const users = await db.getAllUsers();
          const PAGE_SIZE = 10;
          const totalPages = Math.ceil(users.length / PAGE_SIZE) || 1;

          if (targetPage < 1 || targetPage > totalPages) {
            return bot.answerCallbackQuery(query.id);
          }

          const startIdx = (targetPage - 1) * PAGE_SIZE;
          const pageUsers = users.slice(startIdx, startIdx + PAGE_SIZE);

          const imgBuffer = generateUsersCard(pageUsers, targetPage, totalPages);

          const navRow = [];
          if (targetPage > 1) {
            navRow.push({ text: 'Trang trước', callback_data: `adm_users_page_${targetPage - 1}`, icon_custom_emoji_id: '5256247952564825322' });
          }
          if (targetPage < totalPages) {
            navRow.push({ text: 'Trang sau', callback_data: `adm_users_page_${targetPage + 1}` });
          }

          const keyboard = [];
          if (navRow.length > 0) keyboard.push(navRow);
          keyboard.push([{ text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }]);

          try {
            await bot.deleteMessage(chatId, messageId);
          } catch (_) {}

          await bot.sendPhoto(chatId, imgBuffer, {
            caption: `<b>QUẢN LÝ THÀNH VIÊN HỆ THỐNG</b>\nTổng cộng: <b>${users.length}</b> thành viên (Trang ${targetPage}/${totalPages}).`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
          });

          return bot.answerCallbackQuery(query.id);
        }

        if (data === 'adm_add_cat') {
          waitingEdit.set(userId, { field: 'new_category', messageId });
          const text = '<tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> <b>TẠO DANH MỤC MỚI</b>\n─────────────────────────\nNhập cú pháp: <code>Tên|Mô tả</code>\nVí dụ: <code>Acc Free Fire VIP|Nick VIP full skin</code>';
          return await sendOrEditText(bot, chatId, messageId, text, [[{ text: 'Hủy', callback_data: 'adm_back_categories' }]]);
        }

        if (data.startsWith('adm_cat_detail_')) {
          const catId = parseInt(data.split('_')[3]);
          const cat = await db.getCategory(catId);
          if (!cat) return bot.answerCallbackQuery(query.id, { text: 'Danh mục này không tồn tại!' });
          const prods = await db.getProductsByCategory(catId);

          const emojiPreview = cat.custom_emoji_id 
            ? `<tg-emoji emoji-id="${cat.custom_emoji_id}">✨</tg-emoji> <code>${cat.custom_emoji_id}</code>` 
            : '<i>(Chưa cài - Đang dùng mặc định)</i>';

          let text = `<tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> <b>DANH MỤC: ${cat.name.toUpperCase()}</b>\n` +
                     `<b>Emoji động:</b> ${emojiPreview}\n` +
                     `<b>Mô tả:</b> <i>${cat.description || 'Chưa cập nhật'}</i>\n` +
                     `<b>Số lượng SP:</b> <b>${prods.length}</b> mặt hàng\n\n`;

          if (prods.length > 0) {
            text += `<i>Danh sách mặt hàng:</i>\n`;
            prods.forEach((p, idx) => {
              text += `${idx + 1}. <b>${p.name}</b> (Kho: ${p.stock_count}) - ${formatPrice(p.price)}\n`;
            });
          } else {
            text += `<i>(Chưa có sản phẩm nào)</i>`;
          }

          const keyboard = [
            [{ text: 'Đổi Emoji Động Tele', callback_data: `adm_setemoji_cat_${catId}` }],
            [{ text: 'Đồng bộ icon sang tất cả SP', callback_data: `adm_sync_emoji_cat_${catId}` }],
            [{ text: 'Chọn sản phẩm đưa vào', callback_data: `adm_pick_from_prods_${catId}` }],
            [{ text: 'Xóa danh mục này', callback_data: `adm_delcat_${catId}` }],
            [{ text: 'Quay lại danh sách', callback_data: 'adm_back_categories', icon_custom_emoji_id: '5256247952564825322' }],
            [{ text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }]
          ];

          return await sendOrEditText(bot, chatId, messageId, text, keyboard);
        }

        if (data.startsWith('adm_sync_emoji_cat_')) {
          const catId = parseInt(data.split('_')[4]);
          const cat = await db.getCategory(catId);
          if (!cat) return bot.answerCallbackQuery(query.id, { text: 'Danh mục không tồn tại!' });

          if (db.syncCategoryEmojiToProducts) {
            await db.syncCategoryEmojiToProducts(catId, cat.custom_emoji_id || null);
          }

          bot.answerCallbackQuery(query.id, { 
            text: 'Đã đồng bộ Emoji động sang tất cả sản phẩm của danh mục này!', 
            show_alert: true 
          });

          return;
        }

        if (data.startsWith('adm_setemoji_cat_')) {
          const catId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { field: 'cat_custom_emoji', catId, messageId });
          const promptText = `<b>CẬP NHẬT EMOJI ĐỘNG CHO DANH MỤC #${catId}</b>\n─────────────────────────\n` +
                             `👉 Hãy <b>thả 1 Emoji Động</b> vào chat này hoặc <b>dán ID Emoji</b> (dãy số):\n\n` +
                             `💡 <i>Nhập <b>xoa</b> để xóa emoji động về mặc định.</i>`;
          return await sendOrEditText(bot, chatId, messageId, promptText, [[{ text: 'Hủy', callback_data: `adm_cat_detail_${catId}` }]]);
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
            const statusIcon = inThisCat ? '[CHỌN]' : '[CHƯA]';
            keyboard.push([{
              text: `${statusIcon} #${p.id} ${p.name}`,
              callback_data: `adm_toggle_prodcat_${catId}_${p.id}`,
              ...(inThisCat ? { icon_custom_emoji_id: '5980930633298350051' } : {})
            }]);
          });

          keyboard.push([{ text: 'Hoàn tất / Quay lại', callback_data: `adm_cat_detail_${catId}`, icon_custom_emoji_id: '5256247952564825322' }]);

          const text = `<tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> <b>PHÂN PHỐI SẢN PHẨM: ${cat.name.toUpperCase()}</b>\n` +
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
            const statusIcon = inThisCat ? '[CHỌN]' : '[CHƯA]';
            keyboard.push([{
              text: `${statusIcon} #${p.id} ${p.name}`,
              callback_data: `adm_toggle_prodcat_${catId}_${p.id}`,
              ...(inThisCat ? { icon_custom_emoji_id: '5980930633298350051' } : {})
            }]);
          });
          keyboard.push([{ text: 'Hoàn tất / Quay lại', callback_data: `adm_cat_detail_${catId}`, icon_custom_emoji_id: '5256247952564825322' }]);

          const text = `<tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> <b>PHÂN PHỐI SẢN PHẨM: ${cat.name.toUpperCase()}</b>\n` +
                       `<i>Chạm vào từng mục để thêm vào hoặc gỡ ra khỏi danh mục:</i>`;

          return await sendOrEditText(bot, chatId, messageId, text, keyboard);
        }

        if (data.startsWith('adm_delcat_')) {
          const catId = parseInt(data.split('_')[2]);
          await db.deleteCategory(catId);
          bot.answerCallbackQuery(query.id, { text: 'Đã xóa danh mục!' });
          const categories = await db.getAllCategories();
          const keyboard = categories.map(c => [{ text: `${c.name} (${c.product_count} SP)`, callback_data: `adm_cat_detail_${c.id}`, icon_custom_emoji_id: '5258389041006518073' }]);
          keyboard.push([{ text: 'Thêm danh mục mới', callback_data: 'adm_add_cat' }]);
          keyboard.push([{ text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }]);
          return await sendOrEditText(bot, chatId, messageId, `<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> <b>Đã xóa danh mục!</b>\n\n<tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> <b>QUẢN LÝ DANH MỤC:</b>`, keyboard);
        }

        if (data === 'adm_back_categories') {
          const categories = await db.getAllCategories();
          const keyboard = categories.map(c => [{ text: `${c.name} (${c.product_count} SP)`, callback_data: `adm_cat_detail_${c.id}`, icon_custom_emoji_id: '5258389041006518073' }]);
          keyboard.push([{ text: 'Thêm danh mục mới', callback_data: 'adm_add_cat' }]);
          keyboard.push([{ text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }]);
          return await sendOrEditText(bot, chatId, messageId, '<tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> <b>QUẢN LÝ DANH MỤC:</b>', keyboard);
        }

        if (data === 'adm_add_product') {
          const categories = await db.getAllCategories();
          const keyboard = [];

          if (categories.length > 0) {
            categories.forEach(c => {
              keyboard.push([{ text: `Đưa vào: ${c.name}`, callback_data: `adm_addprodto_${c.id}`, icon_custom_emoji_id: '5258389041006518073' }]);
            });
          }
          keyboard.push([{ text: 'Mục chung (Không mục)', callback_data: 'adm_addprodto_0' }]);
          keyboard.push([{ text: 'Hủy', callback_data: 'adm_back_list' }]);

          return await sendOrEditText(bot, chatId, messageId, '<tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> <b>BƯỚC 1: Chọn danh mục lưu sản phẩm:</b>', keyboard);
        }

        if (data.startsWith('adm_addprodto_')) {
          const catId = parseInt(data.split('_')[2]);
          waitingEdit.set(userId, { field: 'new_product', categoryId: catId, messageId });
          return await sendOrEditText(bot, chatId, messageId, `<b>BƯỚC 2: NHẬP SẢN PHẨM</b>\n─────────────────────────\nCú pháp: <code>Tên|Giá|Mô tả</code>\nVí dụ: <code>Acc Clone Lv5|25000|Clone sạch</code>`, [[{ text: 'Hủy', callback_data: 'adm_back_list' }]]);
        }

        if (data.startsWith('adm_change_cat_')) {
          const productId = parseInt(data.split('_')[3]);
          const categories = await db.getAllCategories();
          const keyboard = [];

          categories.forEach(c => {
            keyboard.push([{ text: `Đổi sang: ${c.name}`, callback_data: `adm_apply_cat_${productId}_${c.id}`, icon_custom_emoji_id: '5258389041006518073' }]);
          });
          keyboard.push([{ text: 'Đổi sang Mục chung', callback_data: `adm_apply_cat_${productId}_0` }]);
          keyboard.push([{ text: 'Hủy', callback_data: `adm_product_${productId}`, icon_custom_emoji_id: '5256247952564825322' }]);

          return await sendOrEditText(bot, chatId, messageId, '<tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> <b>Chọn danh mục mới cho sản phẩm này:</b>', keyboard);
        }

        if (data.startsWith('adm_apply_cat_')) {
          const [, , , productId, catId] = data.split('_');
          if (db.updateProductCategory) {
            await db.updateProductCategory(parseInt(productId), parseInt(catId));
          }
          bot.answerCallbackQuery(query.id, { text: 'Cập nhật danh mục thành công!' });
          return await sendOrEditText(bot, chatId, messageId, `<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> Đã chuyển sản phẩm #${productId} sang danh mục mới!`, [[{ text: 'Về thông tin SP', callback_data: 'adm_product_' + productId, icon_custom_emoji_id: '5256247952564825322' }]]);
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

          const text = '<b>' + product.name + '</b> (#' + product.id + ')\n' +
                       '<tg-emoji emoji-id="5258389041006518073">📂</tg-emoji> Danh mục: <b>' + catName + '</b>\n' +
                       '─────────────────────────\n' +
                       productPriceBlockAdmin(product) +
                       '<b>Mô tả:</b> ' + (product.description || 'Chưa cập nhật') + '\n\n' +
                       '<b>TỒN KHO:</b> Còn ' + available + ' │ Đã bán ' + sold;

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

          const text = '<b>CÀI ĐẶT BẢNG GIÁ SỈ</b>\n' +
                       '─────────────────────────\n' +
                       'Mặt hàng: <b>' + product.name + '</b>\n' +
                       'Giá bán lẻ: <code>' + formatPrice(product.price) + '</code>\n' +
                       'Đang áp dụng: <code>' + currentTiers + '</code>\n\n' +
                       'Cú pháp:\n' +
                       '<code>SốLượng:Giá, SốLượng:Giá, ...</code>\n\n' +
                       'Ví dụ: <code>1:50000, 10:45000, 20:40000</code>\n\n' +
                       '💡 <i>Nhập <b>xoa</b> để hủy bỏ giá sỉ.</i>';
          return await sendOrEditText(bot, chatId, messageId, text, [[{ text: 'Hủy', callback_data: 'adm_product_' + productId }]]);
        }

        if (data.startsWith('adm_edit_name_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'name', messageId });
          return await sendOrEditText(bot, chatId, messageId, 'Nhập tên mới cho sản phẩm #' + productId + ':', [[{ text: 'Hủy', callback_data: 'adm_product_' + productId }]]);
        }

        if (data.startsWith('adm_edit_price_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'price', messageId });
          return await sendOrEditText(bot, chatId, messageId, '<tg-emoji emoji-id="6334849386031351338">💵</tg-emoji> Nhập giá mới (VNĐ) cho sản phẩm #' + productId + ':', [[{ text: 'Hủy', callback_data: 'adm_product_' + productId }]]);
        }

        if (data.startsWith('adm_edit_desc_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'desc', messageId });
          return await sendOrEditText(bot, chatId, messageId, 'Nhập mô tả mới cho sản phẩm #' + productId + ':', [[{ text: 'Hủy', callback_data: 'adm_product_' + productId }]]);
        }

        if (data.startsWith('adm_addstock_')) {
          const productId = parseInt(data.split('_')[2]);
          const product = await db.getProduct(productId);
          waitingStock.set(userId, productId);
          return await sendOrEditText(bot, chatId, messageId, '<b>NẠP STOCK CHO: ' + product.name + '</b>\n\n<i>Gửi danh sách tài khoản (mỗi acc 1 dòng):</i>', [[{ text: 'Hủy', callback_data: 'adm_product_' + productId }]]);
        }

        if (data.startsWith('adm_viewstock_')) {
          const productId = parseInt(data.split('_')[2]);
          const product = await db.getProduct(productId);
          const stocks = await db.getStockByProduct(productId);
          const available = stocks.filter(s => !s.is_sold);
          let text = '<b>' + product.name + '</b>\n\nKhả dụng: <b>' + available.length + '</b> | Đã bán: <b>' + (stocks.length - available.length) + '</b>\n─────────────────────────\n';
          const keyboard = [];
          if (available.length > 0) {
            text += '<i>Danh sách tài khoản (bấm để xóa):</i>\n';
            available.slice(0, 10).forEach((s, i) => {
              text += `${i + 1}. <code>${s.account_data}</code>\n`;
              keyboard.push([{ text: 'Xóa: ' + s.account_data.substring(0, 25) + '...', callback_data: 'adm_delstock_' + productId + '_' + s.id }]);
            });
            if (available.length > 10) text += '... và <b>' + (available.length - 10) + '</b> tài khoản khác.\n';
            keyboard.push([{ text: 'Xóa TẤT CẢ tồn kho', callback_data: 'adm_clearstock_' + productId }]);
          } else {
            text += 'Hiện tại kho đang trống!';
          }
          keyboard.push([{ text: 'Nạp thêm stock', callback_data: 'adm_addstock_' + productId }]);
          keyboard.push([{ text: 'Quay lại', callback_data: 'adm_product_' + productId, icon_custom_emoji_id: '5256247952564825322' }]);
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
          let text = '<b>' + product.name + '</b>\n\nKhả dụng: <b>' + available.length + '</b> | Đã bán: <b>' + (stocks.length - available.length) + '</b>\n─────────────────────────\n';
          const keyboard = [];
          if (available.length > 0) {
            text += '<i>Danh sách tài khoản (bấm để xóa):</i>\n';
            available.slice(0, 10).forEach((s, i) => {
              text += `${i + 1}. <code>${s.account_data}</code>\n`;
              keyboard.push([{ text: 'Xóa: ' + s.account_data.substring(0, 25) + '...', callback_data: 'adm_delstock_' + productId + '_' + s.id }]);
            });
            keyboard.push([{ text: 'Xóa TẤT CẢ tồn kho', callback_data: 'adm_clearstock_' + productId }]);
          }
          keyboard.push([{ text: 'Nạp thêm stock', callback_data: 'adm_addstock_' + productId }]);
          keyboard.push([{ text: 'Quay lại', callback_data: 'adm_product_' + productId, icon_custom_emoji_id: '5256247952564825322' }]);
          return await sendOrEditText(bot, chatId, messageId, text, keyboard);
        }

        if (data.startsWith('adm_clearstock_')) {
          const productId = parseInt(data.split('_')[2]);
          await db.clearStock(productId);
          bot.answerCallbackQuery(query.id, { text: 'Đã làm sạch kho!' });
          return await sendOrEditText(bot, chatId, messageId, `Đã xóa sạch toàn bộ acc của sản phẩm #${productId}.`, [[{ text: 'Quay lại', callback_data: 'adm_product_' + productId, icon_custom_emoji_id: '5256247952564825322' }]]);
        }

        if (data.startsWith('adm_delete_')) {
          const productId = parseInt(data.split('_')[2]);
          await db.deleteProduct(productId);
          bot.answerCallbackQuery(query.id, { text: 'Đã xóa sản phẩm!' });
          return await sendOrEditText(bot, chatId, messageId, `Đã xóa hoàn toàn mặt hàng #${productId}.`, [[{ text: 'Về kho hàng', callback_data: 'adm_back_list', icon_custom_emoji_id: '5256247952564825322' }]]);
        }

        if (data === 'adm_back_list') {
          const products = await db.getAllProducts();
          const keyboard = products.map(p => [{ text: `#${p.id} ${p.name} (Kho: ${p.stock_count})`, callback_data: 'adm_product_' + p.id }]);
          keyboard.push([{ text: 'Thêm sản phẩm mới', callback_data: 'adm_add_product' }]);
          keyboard.push([{ text: 'Panel Admin', callback_data: 'adm_panel_home', icon_custom_emoji_id: '5395804191769763641' }]);
          return await sendOrEditText(bot, chatId, messageId, '<b>QUẢN TRỊ SẢN PHẨM:</b>', keyboard);
        }
      }

    } catch (e) {
      console.log('Callback error:', e.message);
    }
    bot.answerCallbackQuery(query.id).catch(() => {});
  });

  // ==================== BẮT TIN NHẮN (GỘP XỬ LÝ) ====================
  bot.on('message', async (msg) => {
    if (isBlacklisted(msg.from.id)) {
      const reason = getBanReason(msg.from.id);
      return bot.sendMessage(
        msg.chat.id, 
        `🚫 <b>TÀI KHOẢN BỊ KHÓA TƯƠNG TÁC</b>\n─────────────────────────\n📝 <b>Lý do:</b> <i>${reason}</i>`, 
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }

    if (msg.text && msg.text.startsWith('/') && !waitingEdit.has(msg.from.id)) return;

    if (IS_MAINTENANCE && !isAdmin(msg.from.id)) {
      try {
        const card = generateMaintenanceCard();
        return await bot.sendPhoto(msg.chat.id, card, {
          caption: `<b>HỆ THỐNG ĐANG BẢO TRÌ NÂNG CẤP</b>\n<i>Cảm ơn quý khách đã kiên nhẫn đồng hành!</i>`,
          parse_mode: 'HTML'
        });
      } catch (err) {
        return bot.sendMessage(msg.chat.id, '⚠️ Hệ thống đang bảo trì, vui lòng quay lại sau!').catch(() => {});
      }
    }

    const editInfo = waitingEdit.get(msg.from.id);

    // 1. Xử lý feedback comment
    if (editInfo && editInfo.field === 'feedback_comment') {
      const comment = (msg.text || '').trim();
      const fbData = pendingFeedbacks.get(msg.from.id);

      waitingEdit.delete(msg.from.id);
      pendingFeedbacks.delete(msg.from.id);

      if (fbData) {
        if (fbData.messageId) {
          try { await bot.deleteMessage(msg.chat.id, fbData.messageId); } catch (_) {}
        }
        await publishFeedback(bot, msg.from, fbData.productName, fbData.totalPrice, fbData.stars, comment);
      }
      return;
    }

    // 2. Xử lý nhập số lượng mua tùy chỉnh
    if (editInfo && editInfo.field === 'custom_qty') {
      const qty = parseInt(msg.text?.trim() || '');
      const product = await db.getProduct(editInfo.productId);

      if (!product) {
        waitingEdit.delete(msg.from.id);
        return bot.sendMessage(msg.chat.id, 'Mặt hàng không còn tồn tại!').catch(() => {});
      }

      if (isNaN(qty) || qty < 1) {
        return bot.sendMessage(msg.chat.id, 'Số lượng không hợp lệ! Vui lòng nhập số nguyên > 0.').catch(() => {});
      }

      if (qty > product.stock_count) {
        return bot.sendMessage(msg.chat.id, 'Kho không đủ hàng! Chỉ còn ' + product.stock_count + ' sản phẩm khả dụng.').catch(() => {});
      }

      waitingEdit.delete(msg.from.id);

      const totalPrice = db.calculatePrice(product, qty);
      const unitPrice = db.getUnitPrice(product, qty);
      const userBalance = await db.getUserBalance(msg.from.id);
      const discountInfo = unitPrice < product.price ? '\n ├ <b>Ưu đãi:</b> <code>' + formatPrice(unitPrice) + '/sp</code>' : '';

      const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  🧾 <b>XÁC NHẬN ĐƠN MUA HÀNG</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 🎁 <b>Mặt hàng:</b> <b>${product.name}</b>
 ├ 🔢 <b>Số lượng:</b> <code>${qty} acc</code>${discountInfo}
 ├ 💰 <b>Tổng tiền:</b> <code>${formatPrice(totalPrice)}</code>
 ╰ <tg-emoji emoji-id="6138871037632191916">💳</tg-emoji> <b>Số dư ví:</b> <code>${formatPrice(userBalance)}</code>
─────────────────────────
<i>Chọn hình thức thanh toán bên dưới:</i>`;

      const keyboard = [
        [{ text: 'Mua bằng SỐ DƯ VÍ', callback_data: `paywallet_${editInfo.productId}_${qty}` }],
        [{ text: 'Quét mã QR NGÂN HÀNG', callback_data: `paybank_${editInfo.productId}_${qty}` }],
        [{ text: 'Thay đổi số lượng', callback_data: `product_${editInfo.productId}`, icon_custom_emoji_id: '5256247952564825322' }]
      ];

      return bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }).catch(() => {});
    }

    // 3. Xử lý nạp tiền số lượng tùy chỉnh
    if (editInfo && editInfo.field === 'custom_deposit') {
      const amount = parseInt(msg.text?.trim() || '', 10);
      waitingEdit.delete(msg.from.id);
      if (isNaN(amount) || amount < 10000) {
        return bot.sendMessage(msg.chat.id, 'Số tiền nạp tối thiểu là 10.000đ.').catch(() => {});
      }
      return await createDepositQR(msg.chat.id, msg.from, amount, null);
    }

    // 4. Xử lý quyền Admin
    if (!isAdmin(msg.from.id)) return;

    const pid = waitingStock.get(msg.from.id);
    if (pid && msg.text) {
      const accs = msg.text.split('\n').filter(a => a.trim());
      for (const acc of accs) {
        await db.addStock(pid, acc.trim());
      }
      waitingStock.delete(msg.from.id);
      const product = await db.getProduct(pid);

      bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> <b>Đã nhập thành công ${accs.length} tài khoản vào kho!</b>\nĐang gửi thông báo hàng về tới khách hàng...`, { parse_mode: 'HTML' }).catch(() => {});

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
        if (isBlacklisted(u.id)) continue;
        bot.sendMessage(u.id, alertMsg, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: 'Mua Ngay', callback_data: 'open_store', icon_custom_emoji_id: '5312361253610475399' }]] }
        }).catch(() => {});
      }
      return;
    }

    if (!editInfo) return;

    if (editInfo.field === 'cat_custom_emoji') {
      let customEmojiId = null;

      if (msg.entities) {
        const emojiEntity = msg.entities.find(e => e.type === 'custom_emoji');
        if (emojiEntity && emojiEntity.custom_emoji_id) {
          customEmojiId = emojiEntity.custom_emoji_id;
        }
      }

      const textVal = (msg.text || '').trim();
      if (!customEmojiId && /^\d+$/.test(textVal)) {
        customEmojiId = textVal;
      }

      if (textVal.toLowerCase() === 'xoa' || textVal.toLowerCase() === 'xóa') {
        customEmojiId = null;
      } else if (!customEmojiId) {
        return bot.sendMessage(
          msg.chat.id, 
          'Không nhận diện được Emoji động!\n\n👉 Vui lòng gửi <b>1 Emoji động</b> từ bàn phím Telegram hoặc dán <b>dãy số ID</b> (nhập <code>xoa</code> để xóa về mặc định):', 
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }

      if (db.updateCategoryEmoji) {
        await db.updateCategoryEmoji(editInfo.catId, customEmojiId);
      }
      waitingEdit.delete(msg.from.id);

      const preview = customEmojiId 
        ? `<tg-emoji emoji-id="${customEmojiId}">✨</tg-emoji> (ID: <code>${customEmojiId}</code>)` 
        : 'Mặc định';

      return bot.sendMessage(
        msg.chat.id, 
        `<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> Đã cập nhật emoji động cho danh mục #${editInfo.catId}!\n\n• Icon: ${preview}\n\n👉 Gõ /categories và chọn mục này nếu muốn nhấn <b>Đồng bộ icon sang tất cả SP</b>.`, 
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }

    if (!msg.text) return;

    if (editInfo.field === 'broadcast') {
      waitingEdit.delete(msg.from.id);
      const users = await db.getAllUsers();
      let sent = 0, failed = 0;

      bot.sendMessage(msg.chat.id, '⏳ Đang gửi thông báo đến ' + users.length + ' khách hàng...').catch(() => {});

      for (const user of users) {
        if (isBlacklisted(user.id)) continue;
        try {
          await bot.sendMessage(user.id, `<b>THÔNG BÁO TỪ SHOP:</b>\n\n${msg.text}`, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: 'Mở Cửa Hàng', callback_data: 'open_store', icon_custom_emoji_id: '5312361253610475399' }]]
            }
          });
          sent++;
        } catch (e) {
          failed++;
        }
      }

      const text = '<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> <b>ĐÃ HOÀN TẤT CHIẾN DỊCH THÔNG BÁO</b>\n' +
                   '─────────────────────────\n' +
                   'Gửi thành công: <b>' + sent + '</b>\n' +
                   'Thất bại/Chặn: <b>' + failed + '</b>';
      return bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' }).catch(() => {});
    }

    if (editInfo.field === 'new_category') {
      const parts = msg.text.split('|').map(s => s.trim());
      const name = parts[0];
      const desc = parts[1] || '';
      if (!name) return bot.sendMessage(msg.chat.id, 'Tên danh mục không được để trống!').catch(() => {});

      await db.addCategory(name, desc);
      waitingEdit.delete(msg.from.id);
      return bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> Đã tạo mới danh mục: <b>${name}</b> thành công!\nGõ /categories để kiểm tra và đặt emoji động.`, { parse_mode: 'HTML' }).catch(() => {});
    }

    if (editInfo.field === 'new_product') {
      const parts = msg.text.split('|').map(s => s.trim());
      const name = parts[0];
      const price = parseInt(parts[1], 10);
      const desc = parts.slice(2).join('|') || '';

      if (!name || isNaN(price)) return bot.sendMessage(msg.chat.id, 'Cú pháp: <code>Tên|Giá|Mô tả</code>', { parse_mode: 'HTML' }).catch(() => {});

      const res = await db.addProduct(name, price, desc, editInfo.categoryId || 0);
      waitingEdit.delete(msg.from.id);

      bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> Đã thêm mặt hàng <b>${name}</b> (#${res.lastInsertRowid})!\nĐang gửi thông báo tới khách hàng...`, { parse_mode: 'HTML' }).catch(() => {});

      const newProductAlert = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  🎉 <b>MẶT HÀNG MỚI ĐÃ LÊN KỆ!</b> 🎉
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 ├ 🎁 <b>Mặt hàng:</b> <b>${name}</b>
 ├ <tg-emoji emoji-id="6334849386031351338">💵</tg-emoji> <b>Đơn giá:</b> <code>${formatPrice(price)}</code>
 ╰ 📝 <b>Mô tả:</b> <i>${desc || 'Hàng chất lượng, bảo hành uy tín!'}</i>
─────────────────────────
👉 <i>Bấm vào nút bên dưới để đặt mua ngay!</i>`;
      
      const users = await db.getAllUsers();
      for (const u of users) {
        if (isBlacklisted(u.id)) continue;
        bot.sendMessage(u.id, newProductAlert, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: 'Mua Ngay', callback_data: 'open_store', icon_custom_emoji_id: '5312361253610475399' }]] }
        }).catch(() => {});
      }
      return;
    }

    const product = await db.getProduct(editInfo.productId);
    if (!product) {
      waitingEdit.delete(msg.from.id);
      return bot.sendMessage(msg.chat.id, 'Sản phẩm không tồn tại!').catch(() => {});
    }

    let newName = product.name;
    let newPrice = product.price;
    let newDesc = product.description;

    if (editInfo.field === 'name') newName = msg.text.trim();
    else if (editInfo.field === 'price') {
      const priceNum = parseInt(msg.text.trim());
      if (isNaN(priceNum) || priceNum < 0) return bot.sendMessage(msg.chat.id, 'Giá tiền không hợp lệ!').catch(() => {});
      newPrice = priceNum;
    } else if (editInfo.field === 'desc') newDesc = msg.text.trim();
    else if (editInfo.field === 'tiers') {
      const input = msg.text.trim().toLowerCase();
      if (input === 'xoa' || input === 'xóa') {
        await db.updatePriceTiers(editInfo.productId, null);
        waitingEdit.delete(msg.from.id);
        return bot.sendMessage(msg.chat.id, '<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> Đã xóa toàn bộ bảng giá sỉ!\n\nGõ /products để quản lý.').catch(() => {});
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
      return bot.sendMessage(msg.chat.id, '<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> Đã lưu cấu hình bảng giá sỉ!\n\nGõ /products để kiểm tra.').catch(() => {});
    }

    await db.updateProduct(editInfo.productId, newName, newPrice, newDesc);
    waitingEdit.delete(msg.from.id);
    return bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="5980930633298350051">✅</tg-emoji> Đã lưu thay đổi cho sản phẩm #${editInfo.productId}!`).catch(() => {});
  });

  console.log(config.SHOP_NAME + ' đang hoạt động ổn định!');
}

startBot().catch(console.error);
