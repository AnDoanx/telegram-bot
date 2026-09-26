const TelegramBot = require('node-telegram-bot-api');
const os = require('os');
const { createCanvas, loadImage } = require('canvas');
const config = require('./config');
const db = require('./database');
const sepay = require('./sepay');

const formatPrice = (price) => (price || 0).toLocaleString('vi-VN') + 'đ';
const isAdmin = (userId) => config.ADMIN_IDS.map(id => id.toString()).includes(userId.toString());
const getFullName = (user) => (user.first_name + (user.last_name ? ' ' + user.last_name : '')).trim();
const ORDER_TIMEOUT_MS = 20 * 60 * 1000;
const BOT_START_TIME = Date.now();

// Cấu hình tỉnh mặc định (admin có thể đổi bằng /settinh)
let SELECTED_CITY = 'Hanoi';
let lastGreetedDay = { morning: '', noon: '' };

function maskUid(uid) {
  const s = uid.toString();
  const keep = Math.ceil(s.length / 2);
  return s.substring(0, keep) + '*'.repeat(s.length - keep);
}

// ==================== LẤY THỜI TIẾT THỰC TẾ (FREE API) ====================
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
      condition: 'Trời quang mây tạnh ☀️',
      wind: '10 km/h'
    };
  }
}

// ==================== CANVAS: THẺ CHÚC BUỔI SÁNG / TRƯA ====================
function generateGreetingCard(targetName, weatherInfo, isMorning = true) {
  const width = 850;
  const height = 480;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, width, height);
  if (isMorning) {
    grad.addColorStop(0, '#09152e');
    grad.addColorStop(0.5, '#172554');
    grad.addColorStop(1, '#1e1b4b');
  } else {
    grad.addColorStop(0, '#0c4a6e');
    grad.addColorStop(0.5, '#075985');
    grad.addColorStop(1, '#082f49');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = isMorning ? '#facc15' : '#38bdf8';
  ctx.lineWidth = 3;
  ctx.strokeRect(16, 16, width - 32, height - 32);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(26, 26, width - 52, height - 52);

  // Header
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`📅 ${new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}`, 45, 65);

  ctx.textAlign = 'right';
  ctx.fillStyle = isMorning ? '#facc15' : '#38bdf8';
  ctx.fillText(isMorning ? '🌅 CHÀO BUỔI SÁNG (MORNING)' : '☀️ CHÀO BUỔI TRƯA (NOON)', width - 45, 65);

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(45, 85);
  ctx.lineTo(width - 45, 85);
  ctx.stroke();

  // Khối thông điệp chính
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 28px sans-serif';
  const mainMsg = isMorning
    ? `Chúc ${targetName} một ngày mới rực rỡ và tràn đầy may mắn!`
    : `Chúc ${targetName} buổi trưa ngon miệng và nghỉ ngơi thật tốt!`;
  ctx.fillText(mainMsg, width / 2, 145);

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'italic 16px sans-serif';
  const subMsg = isMorning
    ? '“Mỗi buổi sáng mang đến cơ hội mới để bạn chạm tay vào thành công.”'
    : '“Tạm gác lại công việc, nạp lại năng lượng cho buổi chiều bùng nổ nhé.”';
  ctx.fillText(subMsg, width / 2, 185);

  // Khối thời tiết (Weather Box)
  ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
  ctx.fillRect(45, 225, width - 90, 150);
  ctx.strokeStyle = isMorning ? 'rgba(250, 204, 21, 0.35)' : 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(45, 225, width - 90, 150);

  ctx.textAlign = 'left';
  ctx.fillStyle = isMorning ? '#facc15' : '#38bdf8';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(`🌤️ THỜI TIẾT TẠI: ${weatherInfo.location}`, 70, 265);

  ctx.fillStyle = '#f1f5f9';
  ctx.font = 'bold 24px monospace';
  ctx.fillText(`${weatherInfo.temp}`, 70, 310);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '15px sans-serif';
  ctx.fillText(`💧 Độ ẩm: ${weatherInfo.humidity}  │  💨 Gió: ${weatherInfo.wind}`, 70, 345);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(`Trạng thái: ${weatherInfo.condition}`, width - 70, 310);

  // Footer
  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  ctx.fillText(`TỰ ĐỘNG CẬP NHẬT THEO NGÀY • THÔNG BÁO TỪ ${config.SHOP_NAME || 'SYSTEM'}`, width / 2, 435);

  return canvas.toBuffer('image/png');
}

// ==================== CÁC HÀM CANVAS KHÁC ====================
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
  ctx.fillText(`⚡ ${(config.SHOP_NAME || 'SYSTEM').toUpperCase()} WALLET`, 45, 65);

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
  bgGrad.addColorStop(1, '#05070c');
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
  ctx.fillText('🏆 BẢNG VINH DANH TOP ĐẠI GIA 🏆', width / 2, 75);

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
    { rank: 2, x: 230, baseY: 480, h: 180, w: 220, color: '#cbd5e1', medal: '🥈 TOP 2', idx: 1 },
    { rank: 1, x: 500, baseY: 430, h: 230, w: 240, color: '#facc15', medal: '👑 TOP 1', idx: 0 },
    { rank: 3, x: 770, baseY: 520, h: 140, w: 220, color: '#fb923c', medal: '🥉 TOP 3', idx: 2 }
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
  ctx.strokeRect(25, 25, width - 50, height - 50);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(`⚡ ${(config.SHOP_NAME || 'SYSTEM').toUpperCase()} MEMBERSHIP`, 45, 68);

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

  drawStat(textX, 215, 185, '🏦 SỐ DƯ VÍ', formatPrice(balance), '#4ade80');
  drawStat(textX + 200, 215, 185, '🏯 TỔNG NẠP', formatPrice(totalDeposit), '#38bdf8');
  drawStat(textX + 400, 215, 185, '💸 ĐÃ TIÊU DÙNG', formatPrice(totalSpent), '#f43f5e');

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
  ctx.fillText('✓ ĐÃ THANH TOÁN', 0, 8);
  ctx.restore();

  ctx.fillStyle = '#64748b';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Hóa đơn điện tử có giá trị bảo hành tài khoản.', width / 2, 705);

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
  ctx.fillText('⚡ VPS SYSTEM MONITOR & UPTIME', 40, 60);

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

  drawMetricBox(40, 135, 340, 90, '🖥️ VPS UPTIME', vpsUptime, '#4ade80');
  drawMetricBox(420, 135, 340, 90, '🤖 BOT UPTIME', botUptime, '#38bdf8');
  drawMetricBox(40, 245, 340, 90, '📊 CPU CORES & LOAD', `${os.cpus().length} Cores | Node ${process.version}`, '#facc15');
  drawMetricBox(420, 245, 340, 90, '💾 RAM USAGE', `${usedMem}GB / ${totalMem}GB (${memPct}%)`, '#f43f5e');

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

function generateRevenueCard(stats, products, totalStock) {
  const width = 850;
  const height = 540;
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
  ctx.fillText(`⚡ ${(config.SHOP_NAME || 'STORE').toUpperCase()} • FINANCIAL SYSTEM`, 45, 68);

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
  ctx.fillRect(45, 110, width - 90, 125);
  ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(45, 110, width - 90, 125);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TỔNG DOANH THU THỰC NHẬN TOÀN HỆ THỐNG', width / 2, 145);

  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 46px monospace';
  ctx.fillText(formatPrice(stats.total_revenue || 0), width / 2, 200);

  const totalOrders = stats.total_orders || 0;
  const aov = totalOrders > 0 ? Math.round((stats.total_revenue || 0) / totalOrders) : 0;
  const boxW = (width - 90 - 30) / 3;

  function drawMetricBox(x, y, w, title, val, color) {
    ctx.fillStyle = 'rgba(30, 41, 59, 0.65)';
    ctx.fillRect(x, y, w, 90);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, 90);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, x + 16, y + 32);

    ctx.fillStyle = color;
    ctx.font = 'bold 20px monospace';
    ctx.fillText(val, x + 16, y + 68);
  }

  drawMetricBox(45, 255, boxW, '📦 ĐƠN THÀNH CÔNG', `${totalOrders} đơn`, '#38bdf8');
  drawMetricBox(45 + boxW + 15, 255, boxW, '📊 GIÁ TRỊ TB (AOV)', formatPrice(aov), '#facc15');
  drawMetricBox(45 + (boxW + 15) * 2, 255, boxW, '🎯 TỒN KHO HIỆN TẠI', `${totalStock} acc`, '#4ade80');

  ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
  ctx.fillRect(45, 365, width - 90, 80);
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.strokeRect(45, 365, width - 90, 80);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px sans-serif';
  ctx.fillText('Số lượng mặt hàng trên kệ:', 65, 398);
  ctx.fillText('Thời điểm xuất dữ liệu:', 65, 428);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 15px monospace';
  ctx.fillText(`${products.length} sản phẩm`, width - 65, 398);
  ctx.fillText(new Date().toLocaleString('vi-VN'), width - 65, 428);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  ctx.fillText('CONFIDENTIAL • BÁO CÁO NỘI BỘ DÀNH CHO ADMIN • DỮ LIỆU TỰ ĐỘNG THỜI GIAN THỰC', width / 2, 495);

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
  ctx.fillText(`📦 INVENTORY CONTROL CENTER`, 45, 68);

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
    ? `⚠️ CẢNH BÁO: ${emptyStockCount} MẶT HÀNG HẾT KHO • ${lowStockCount} MẶT HÀNG SẮP HẾT`
    : `✅ TÌNH TRẠNG KHO HÀNG ỔN ĐỊNH • CÒN KHẢ DỤNG ${totalStock} ACC`;
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

      let badgeTxt = '🟢 CÒN HÀNG';
      let badgeCol = '#10b981';
      if (p.stock_count === 0) {
        badgeTxt = '🔴 HẾT HÀNG';
        badgeCol = '#ef4444';
      } else if (p.stock_count <= 3) {
        badgeTxt = '🟡 SẮP HẾT';
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
  ctx.textAlign = 'center';
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
  ctx.fillText(`📦 ORDER AUDIT & MONITORING LOG`, 45, 68);

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

  drawMiniStat(45, 105, boxW, '✅ HOÀN TẤT', `${completedCount} đơn`, '#4ade80');
  drawMiniStat(45 + boxW + 15, 105, boxW, '⏳ ĐANG CHỜ', `${pendingCount} đơn`, '#facc15');
  drawMiniStat(45 + (boxW + 15) * 2, 105, boxW, '❌ HỦY / HẾT HẠN', `${otherCount} đơn`, '#f87171');

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
    [{ text: '✏️ Đổi tên', callback_data: 'adm_edit_name_' + productId }, { text: '💵 Đổi giá', callback_data: 'adm_edit_price_' + productId }],
    [{ text: '📁 Danh mục', callback_data: 'adm_change_cat_' + productId }, { text: '📊 Giá sỉ', callback_data: 'adm_edit_tiers_' + productId }],
    [{ text: '📝 Sửa mô tả', callback_data: 'adm_edit_desc_' + productId }],
    [{ text: '📥 Nạp stock', callback_data: 'adm_addstock_' + productId }, { text: '👁️ Xem tồn kho', callback_data: 'adm_viewstock_' + productId }],
    [{ text: '🗑️ Xóa sản phẩm', callback_data: 'adm_delete_' + productId }],
    [{ text: '◀️ Về danh sách', callback_data: 'adm_back_list' }]
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
    });
  } catch (e) {
    console.log('Lỗi render hóa đơn Canvas:', e.message);
  }

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
 ╰ 💰 <b>Tổng thu:</b> <code>${formatPrice(totalPrice)}</code>
─────────────────────────
📂 <b>DỮ LIỆU ĐÃ GIAO:</b>${adminAccDetails}`;

  config.ADMIN_IDS.forEach(id => {
    bot.sendMessage(id, adminMsg, { parse_mode: 'HTML' }).catch(() => {});
    bot.sendDocument(id, txtBuffer, { caption: `📁 Backup đơn #${orderId}` }, { filename, contentType: 'text/plain' }).catch(() => {});
  });
}

function getLanguageKeyboard() {
  return [
    [
      { text: '🇻🇳 Tiếng Việt', callback_data: 'set_lang_vi' },
      { text: '🇬🇧 English', callback_data: 'set_lang_en' }
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
  ⚡ <b>${(config.SHOP_NAME || 'STORE TỰ ĐỘNG').toUpperCase()}</b> ⚡
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
        text: `📁  ${c.name.toUpperCase()}  [ ${c.product_count} SP ]  ▸`,
        callback_data: 'view_category_' + c.id
      }]);
    });
  } else {
    keyboard.push([{
      text: '▫️ Đang cập nhật sản phẩm ▫️',
      callback_data: 'none'
    }]);
  }

  keyboard.push([
    { text: t.btn_deposit, callback_data: 'deposit_menu' },
    { text: t.btn_top, callback_data: 'view_top_deposits' }
  ]);

  keyboard.push([
    { text: t.btn_profile, callback_data: 'main_profile' },
    { text: t.btn_history, callback_data: 'main_history' }
  ]);

  const bottomRow = [{ text: t.btn_change_lang, callback_data: 'change_language' }];
  const adminUser = (config.ADMIN_USER_NAME || '').trim().replace('@', '');
  if (adminUser) {
    bottomRow.push({ text: t.btn_support, url: 'https://t.me/' + adminUser });
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
      { command: 'uptime', description: '⚡ Kiểm tra Uptime VPS Canvas' },
      { command: 'categories', description: '📁 Quản lý danh mục' },
      { command: 'products', description: '⚙️ Quản trị sản phẩm' },
      { command: 'orders', description: '📦 Danh sách đơn hàng Canvas' },
      { command: 'revenue', description: '📈 Thống kê doanh thu Canvas' },
      { command: 'stats', description: '📊 Kiểm tra tồn kho Canvas' },
      { command: 'settinh', description: '🌤️ Cài đặt tỉnh/thành thời tiết' },
      { command: 'users', description: '👥 Quản lý thành viên' },
      { command: 'broadcast', description: '📣 Thông báo shop' },
      { command: 'setmoney', description: '💵 Chỉnh sửa số dư' }
    ], { scope: { type: 'chat', chat_id: adminId } });
  });

  bot.on('polling_error', (err) => console.log('Polling error:', err.message));

  // ==================== TỰ ĐỘNG CHÚC BUỔI SÁNG & TRƯA THEO NGÀY ====================
  setInterval(async () => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const todayStr = now.toDateString();

    // 07:00 sáng tự động gửi lời chúc
    if (currentHour === 7 && currentMinute === 0 && lastGreetedDay.morning !== todayStr) {
      lastGreetedDay.morning = todayStr;
      const weather = await fetchRealWeather(SELECTED_CITY);
      const card = generateGreetingCard('quý khách', weather, true);

      const users = await db.getAllUsers();
      for (const u of users) {
        bot.sendPhoto(u.id, card, {
          caption: `🌅 <b>CHÀO NGÀY MỚI RỰC RỠ!</b>\n<i>Hệ thống tự động cập nhật thời tiết tại ${SELECTED_CITY}. Chúc bạn một ngày may mắn!</i>`,
          parse_mode: 'HTML'
        }).catch(() => {});
      }
    }

    // 11:30 trưa tự động gửi lời chúc
    if (currentHour === 11 && currentMinute === 30 && lastGreetedDay.noon !== todayStr) {
      lastGreetedDay.noon = todayStr;
      const weather = await fetchRealWeather(SELECTED_CITY);
      const card = generateGreetingCard('quý khách', weather, false);

      const users = await db.getAllUsers();
      for (const u of users) {
        bot.sendPhoto(u.id, card, {
          caption: `☀️ <b>CHÚC BUỔI TRƯA AN LÀNH!</b>\n<i>Nghỉ ngơi và có bữa trưa ngon miệng nhé!</i>`,
          parse_mode: 'HTML'
        }).catch(() => {});
      }
    }
  }, 30000);

  // ==================== QUÉT ĐƠN & GỬI THẺ BIẾN ĐỘNG SỐ DƯ ====================
  setInterval(async () => {
    if (pendingOrders.size === 0 && pendingDeposits.size === 0) return;

    const now = Date.now();
    const transactions = await sepay.getTransactions();

    for (const [orderId, order] of pendingOrders) {
      if (processingOrders.has(orderId)) continue;
      if (now - order.createdAt > ORDER_TIMEOUT_MS) {
        pendingOrders.delete(orderId);
        await db.updateOrder(orderId, null, 'expired');
        bot.sendMessage(order.chatId, `⏰ Đơn hàng <b>#${orderId}</b> đã bị hủy do hết hạn thanh toán.\n👉 Hãy gõ /menu để mua lại!`, { parse_mode: 'HTML' });
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

        try {
          const alertCardBuffer = generateBalanceAlertCard(dep.userId, dep.amount, oldBal, newBal, dep.content);
          await bot.sendPhoto(dep.userId, alertCardBuffer, {
            caption: `🔔 <b>THÔNG BÁO BIẾN ĐỘNG SỐ DƯ</b>\n<i>Tài khoản ví của bạn vừa được nạp tiền thành công!</i>`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: '🛒 Mở Cửa Hàng Mua Sắm', callback_data: 'back_main' }]]
            }
          });
        } catch (e) {
          console.log('Lỗi render Thẻ BDSD Canvas:', e.message);
          bot.sendMessage(dep.userId, `🎉 <b>NẠP TIỀN THÀNH CÔNG!</b>\n+${formatPrice(dep.amount)} | Số dư mới: ${formatPrice(newBal)}`, { parse_mode: 'HTML' });
        }

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

  // Lệnh chọn tỉnh thành
  bot.onText(/\/settinh(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const cityInput = match[1]?.trim();
    if (!cityInput) {
      return bot.sendMessage(msg.chat.id, `🌤️ Tỉnh/Thành hiện tại: <b>${SELECTED_CITY}</b>\n👉 Đổi tỉnh bằng cú pháp: <code>/settinh Hanoi</code> hoặc <code>/settinh Saigon</code>, <code>/settinh Danang</code>`, { parse_mode: 'HTML' });
    }
    SELECTED_CITY = cityInput;
    const weather = await fetchRealWeather(SELECTED_CITY);
    bot.sendMessage(msg.chat.id, `✅ <b>Đã lưu tỉnh thành: ${SELECTED_CITY.toUpperCase()}</b>\n🌡️ Test thời tiết: <b>${weather.temp}</b> | ${weather.condition}`, { parse_mode: 'HTML' });
  });

  bot.onText(/\/uptime/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    try {
      const imgBuffer = generateUptimeImage();
      await bot.sendPhoto(msg.chat.id, imgBuffer, {
        caption: `⚡ <b>THÔNG SỐ MÁY CHỦ VPS & BOT</b>\n<i>Được tạo thời gian thực lúc: ${new Date().toLocaleTimeString('vi-VN')}</i>`,
        parse_mode: 'HTML'
      });
    } catch (err) {
      console.log('Lỗi vẽ canvas uptime:', err.message);
      bot.sendMessage(msg.chat.id, '❌ Không thể tạo ảnh Canvas! Hãy chạy `npm install canvas`.');
    }
  });

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
    try {
      const stats = await db.getRevenue();
      const products = await db.getAllProducts();
      let totalStock = 0;
      products.forEach(p => totalStock += (p.stock_count || 0));

      const imgBuffer = generateRevenueCard(stats, products, totalStock);
      await bot.sendPhoto(msg.chat.id, imgBuffer, {
        caption: `📈 <b>BÁO CÁO DOANH THU HỆ THỐNG</b>\n<i>Dữ liệu trích xuất từ database lúc ${new Date().toLocaleTimeString('vi-VN')}.</i>`,
        parse_mode: 'HTML'
      });
    } catch (err) {
      console.log('Lỗi vẽ canvas revenue:', err.message);
      bot.sendMessage(msg.chat.id, '❌ Không thể kết xuất thẻ doanh thu!');
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
        caption: `📊 <b>BÁO CÁO TỒN KHO THỰC TẾ</b>\n<i>Trực quan hóa kho dữ liệu thời gian thực.</i>`,
        parse_mode: 'HTML'
      });
    } catch (err) {
      console.log('Lỗi vẽ canvas stats:', err.message);
      bot.sendMessage(msg.chat.id, '❌ Không thể kết xuất thẻ tồn kho!');
    }
  });

  bot.onText(/\/orders/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    try {
      const orders = await db.getRecentOrders(12);
      if (orders.length === 0) return bot.sendMessage(msg.chat.id, '📦 Hiện chưa có đơn hàng nào!');

      const imgBuffer = generateOrdersLogCard(orders);
      await bot.sendPhoto(msg.chat.id, imgBuffer, {
        caption: `📦 <b>NHẬT KÝ ĐƠN HÀNG GẦN ĐÂY</b>\n<i>Hiển thị chi tiết khách hàng, tên sản phẩm & số lượng mua.</i>`,
        parse_mode: 'HTML'
      });
    } catch (err) {
      console.log('Lỗi vẽ canvas orders:', err.message);
      bot.sendMessage(msg.chat.id, '❌ Không thể tạo nhật ký đơn hàng Canvas!');
    }
  });

  bot.onText(/\/categories/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const categories = await db.getAllCategories();
    const keyboard = categories.map(c => [{ text: `📂 ${c.name} (${c.product_count} SP)`, callback_data: `adm_cat_detail_${c.id}` }]);
    keyboard.push([{ text: '➕ Thêm danh mục mới', callback_data: 'adm_add_cat' }]);

    bot.sendMessage(msg.chat.id, `📁 <b>QUẢN LÝ DANH MỤC:</b>\nHiện có <b>${categories.length}</b> danh mục:`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  });

  bot.onText(/\/products/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const products = await db.getAllProducts();
    const keyboard = products.map(p => [{ text: `📦 #${p.id} ${p.name} (Kho: ${p.stock_count})`, callback_data: 'adm_product_' + p.id }]);
    keyboard.push([{ text: '➕ Thêm sản phẩm mới', callback_data: 'adm_add_product' }]);
    bot.sendMessage(msg.chat.id, `⚙️ <b>QUẢN TRỊ SẢN PHẨM:</b>\n📊 Tổng cộng: <b>${products.length}</b> mặt hàng.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
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
      reply_markup: { inline_keyboard: [[{ text: '❌ Hủy bỏ', callback_data: 'cancel_broadcast' }]] }
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
            inline_keyboard: [[{ text: '🛒 Mở Cửa Hàng', callback_data: 'back_main' }]]
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
      reply_markup: { inline_keyboard: [[{ text: '◀️ Quay lại Hồ sơ', callback_data: 'main_profile' }]] }
    });

    const adminMsg = 
`⚡ <b>GIAO DỊCH NẠP CHỜ QUÉT MÃ</b>
─────────────────────────
 ├ 👤 <b>Khách hàng:</b> ${getFullName(userFrom)} (<code>${userTgId}</code>)
 ├ 💵 <b>Số tiền:</b> <code>${formatPrice(amount)}</code>
 ╰ 📝 <b>Nội dung CK:</b> <code>${content}</code>`;
    notifyAllAdmins(bot, adminMsg);
  }

  // ==================== CALLBACK QUERY ====================
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

        try {
          const podiumBuffer = await generateLeaderboardPodium(topList, bot);
          try { await bot.deleteMessage(chatId, messageId); } catch (_) {}

          const keyboard = [
            [{ text: '💳 Nạp tiền ngay', callback_data: 'deposit_menu' }],
            [{ text: '◀️ Về Trang Chủ', callback_data: 'back_main' }]
          ];

          return await bot.sendPhoto(chatId, podiumBuffer, {
            caption: `🏆 <b>BẢNG VINH DANH TOP ĐẠI GIA</b>\n<i>Nạp tiền ngay để leo lên bục vinh danh cao quý nhất!</i>`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
          });
        } catch (err) {
          console.log('Lỗi render Podium Canvas:', err.message);
        }
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
          return [{ text: `💎 ${p.name} ▫️ ${getDisplayPrice(p)} [${stockBadge}]`, callback_data: 'product_' + p.id }];
        });
        keyboard.push([{ text: t.btn_back_home, callback_data: 'back_main' }]);

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
            qtyButtons.push({ text: label, callback_data: 'qty_' + product.id + '_' + n });
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
          keyboard.push([{ text: '📝 Nhập số lượng khác', callback_data: 'customqty_' + product.id }]);
        }

        if (product.category_id > 0) {
          keyboard.push([{ text: '◀️ Quay lại danh mục', callback_data: 'view_category_' + product.category_id }]);
        } else {
          keyboard.push([{ text: t.btn_back_home, callback_data: 'main_shop' }]);
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

        return await sendOrEditText(bot, chatId, messageId, text, [[{ text: '❌ Hủy bỏ', callback_data: 'product_' + productId }]]);
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
          [{ text: '⚡ Mua bằng SỐ DƯ VÍ', callback_data: `paywallet_${productId}_${qty}` }],
          [{ text: '🏦 Quét mã QR NGÂN HÀNG', callback_data: `paybank_${productId}_${qty}` }],
          [{ text: '◀️ Thay đổi số lượng', callback_data: `product_${productId}` }]
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

        const content = generateCode();
        const order = await db.createOrder(userId, parseInt(productId), chatId, content, qty, totalPrice);
        const orderId = order.lastInsertRowid;
        pendingOrders.set(orderId, { chatId, userId, productId: parseInt(productId), quantity: qty, totalPrice, content, createdAt: order.createdAt });

        try { await bot.deleteMessage(chatId, messageId); } catch (_) {}
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
⚡ <i>Hệ thống tự động phát file tài khoản ngay sau khi nhận tiền!</i>`;

        await bot.sendPhoto(chatId, getQRUrl(totalPrice, content), {
          caption,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Kiểm tra thanh toán', callback_data: 'check_' + orderId + '_' + productId + '_' + qty }],
              [{ text: '❌ Hủy đơn này', callback_data: 'cancel_' + orderId }]
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
        const { text, keyboard } = await buildMainMenu(userId);
        return await sendOrEditText(bot, chatId, messageId, text, keyboard);
      }

      // THẺ CĂN CƯỚC VIP
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
            [{ text: '💳 Nạp tiền vào ví', callback_data: 'deposit_menu' }],
            [{ text: '📜 Lịch sử mua hàng', callback_data: 'main_history' }],
            [{ text: '◀️ Về Trang Chủ', callback_data: 'back_main' }]
          ];

          return await bot.sendPhoto(chatId, cardBuffer, {
            caption: `👤 <b>THẺ ĐỊNH DANH THÀNH VIÊN</b>\n<i>Hạng thẻ tự động thăng cấp theo tổng tiền nạp của bạn.</i>`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
          });
        } catch (e) {
          console.log('Lỗi render Thẻ Căn Cước Canvas:', e.message);
        }
      }

      if (data === 'deposit_menu') {
        const text = 
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
  💳 <b>NẠP TIỀN TỰ ĐỘNG VÀO VÍ</b>
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
<i>Hệ thống quét biến động VietQR tự động 24/7.
Chọn mức nạp gợi ý hoặc tự nhập:</i>`;

        const keyboard = [
          [{ text: '💵 20.000đ', callback_data: 'dep_amt_20000' }, { text: '💵 50.000đ', callback_data: 'dep_amt_50000' }],
          [{ text: '💵 100.000đ', callback_data: 'dep_amt_100000' }, { text: '💵 200.000đ', callback_data: 'dep_amt_200000' }],
          [{ text: '💵 500.000đ', callback_data: 'dep_amt_500000' }, { text: '✏️ Nhập số khác', callback_data: 'dep_custom' }],
          [{ text: '◀️ Về Trang Chủ', callback_data: 'back_main' }]
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
        return await sendOrEditText(bot, chatId, messageId, text, [[{ text: '❌ Hủy bỏ', callback_data: 'deposit_menu' }]]);
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
            keyboard.push([{ text: `📥 Tải file đơn #${o.id} (${o.product_name})`, callback_data: `dl_order_${o.id}` }]);
          }
        });
        keyboard.push([{ text: '◀️ Về Trang Chủ', callback_data: 'back_main' }]);

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
          return await sendOrEditText(bot, chatId, messageId, text, [[{ text: '❌ Hủy', callback_data: 'adm_back_categories' }]]);
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
            [{ text: '➕ Chọn sản phẩm đưa vào', callback_data: `adm_pick_from_prods_${catId}` }],
            [{ text: '🗑️ Xóa danh mục này', callback_data: `adm_delcat_${catId}` }],
            [{ text: '◀️ Quay lại danh sách', callback_data: 'adm_back_categories' }]
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
              text: `${statusIcon} #${p.id} ${p.name}`,
              callback_data: `adm_toggle_prodcat_${catId}_${p.id}`
            }]);
          });

          keyboard.push([{ text: '◀️ Hoàn tất / Quay lại', callback_data: `adm_cat_detail_${catId}` }]);

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
              text: `${statusIcon} #${p.id} ${p.name}`,
              callback_data: `adm_toggle_prodcat_${catId}_${p.id}`
            }]);
          });
          keyboard.push([{ text: '◀️ Hoàn tất / Quay lại', callback_data: `adm_cat_detail_${catId}` }]);

          const text = `📁 <b>PHÂN PHỐI SẢN PHẨM: ${cat.name.toUpperCase()}</b>\n` +
                       `<i>Chạm vào từng mục để thêm vào hoặc gỡ ra khỏi danh mục:</i>`;

          return await sendOrEditText(bot, chatId, messageId, text, keyboard);
        }

        if (data.startsWith('adm_delcat_')) {
          const catId = parseInt(data.split('_')[2]);
          await db.deleteCategory(catId);
          bot.answerCallbackQuery(query.id, { text: 'Đã xóa danh mục!' });
          const categories = await db.getAllCategories();
          const keyboard = categories.map(c => [{ text: `📂 ${c.name} (${c.product_count} SP)`, callback_data: `adm_cat_detail_${c.id}` }]);
          keyboard.push([{ text: '➕ Thêm danh mục mới', callback_data: 'adm_add_cat' }]);
          return await sendOrEditText(bot, chatId, messageId, '✅ <b>Đã xóa danh mục!</b>\n\n📁 <b>QUẢN LÝ DANH MỤC:</b>', keyboard);
        }

        if (data === 'adm_back_categories') {
          const categories = await db.getAllCategories();
          const keyboard = categories.map(c => [{ text: `📂 ${c.name} (${c.product_count} SP)`, callback_data: `adm_cat_detail_${c.id}` }]);
          keyboard.push([{ text: '➕ Thêm danh mục mới', callback_data: 'adm_add_cat' }]);
          return await sendOrEditText(bot, chatId, messageId, '📁 <b>QUẢN LÝ DANH MỤC:</b>', keyboard);
        }

        if (data === 'adm_add_product') {
          const categories = await db.getAllCategories();
          const keyboard = [];

          if (categories.length > 0) {
            categories.forEach(c => {
              keyboard.push([{ text: `📁 Đưa vào: ${c.name}`, callback_data: `adm_addprodto_${c.id}` }]);
            });
          }
          keyboard.push([{ text: '📦 Mục chung (Không mục)', callback_data: 'adm_addprodto_0' }]);
          keyboard.push([{ text: '❌ Hủy', callback_data: 'adm_back_list' }]);

          return await sendOrEditText(bot, chatId, messageId, '📁 <b>BƯỚC 1: Chọn danh mục lưu sản phẩm:</b>', keyboard);
        }

        if (data.startsWith('adm_addprodto_')) {
          const catId = parseInt(data.split('_')[2]);
          waitingEdit.set(userId, { field: 'new_product', categoryId: catId, messageId });
          return await sendOrEditText(bot, chatId, messageId, `➕ <b>BƯỚC 2: NHẬP SẢN PHẨM</b>\n─────────────────────────\nCú pháp: <code>Tên|Giá|Mô tả</code>\nVí dụ: <code>Acc Clone Lv5|25000|Clone sạch</code>`, [[{ text: '❌ Hủy', callback_data: 'adm_back_list' }]]);
        }

        if (data.startsWith('adm_change_cat_')) {
          const productId = parseInt(data.split('_')[3]);
          const categories = await db.getAllCategories();
          const keyboard = [];

          categories.forEach(c => {
            keyboard.push([{ text: `📁 Đổi sang: ${c.name}`, callback_data: `adm_apply_cat_${productId}_${c.id}` }]);
          });
          keyboard.push([{ text: '📦 Đổi sang Mục chung', callback_data: `adm_apply_cat_${productId}_0` }]);
          keyboard.push([{ text: '◀️ Hủy', callback_data: `adm_product_${productId}` }]);

          return await sendOrEditText(bot, chatId, messageId, '📁 <b>Chọn danh mục mới cho sản phẩm này:</b>', keyboard);
        }

        if (data.startsWith('adm_apply_cat_')) {
          const [, , , productId, catId] = data.split('_');
          if (db.updateProductCategory) {
            await db.updateProductCategory(parseInt(productId), parseInt(catId));
          }
          bot.answerCallbackQuery(query.id, { text: 'Cập nhật danh mục thành công!' });
          return await sendOrEditText(bot, chatId, messageId, `✅ Đã chuyển sản phẩm #${productId} sang danh mục mới!`, [[{ text: '◀️ Về thông tin SP', callback_data: 'adm_product_' + productId }]]);
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
          return await sendOrEditText(bot, chatId, messageId, text, [[{ text: '✖️ Hủy', callback_data: 'adm_product_' + productId }]]);
        }

        if (data.startsWith('adm_edit_name_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'name', messageId });
          return await sendOrEditText(bot, chatId, messageId, '✏️ Nhập tên mới cho sản phẩm #' + productId + ':', [[{ text: '✖️ Hủy', callback_data: 'adm_product_' + productId }]]);
        }

        if (data.startsWith('adm_edit_price_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'price', messageId });
          return await sendOrEditText(bot, chatId, messageId, '💵 Nhập giá mới (VNĐ) cho sản phẩm #' + productId + ':', [[{ text: '✖️ Hủy', callback_data: 'adm_product_' + productId }]]);
        }

        if (data.startsWith('adm_edit_desc_')) {
          const productId = parseInt(data.split('_')[3]);
          waitingEdit.set(userId, { productId, field: 'desc', messageId });
          return await sendOrEditText(bot, chatId, messageId, '📝 Nhập mô tả mới cho sản phẩm #' + productId + ':', [[{ text: '✖️ Hủy', callback_data: 'adm_product_' + productId }]]);
        }

        if (data.startsWith('adm_addstock_')) {
          const productId = parseInt(data.split('_')[2]);
          const product = await db.getProduct(productId);
          waitingStock.set(userId, productId);
          return await sendOrEditText(bot, chatId, messageId, '➕ <b>NẠP STOCK CHO: ' + product.name + '</b>\n\n<i>Gửi danh sách tài khoản (mỗi acc 1 dòng):</i>', [[{ text: '✖️ Hủy', callback_data: 'adm_product_' + productId }]]);
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
              keyboard.push([{ text: '🗑️ Xóa: ' + s.account_data.substring(0, 25) + '...', callback_data: 'adm_delstock_' + productId + '_' + s.id }]);
            });
            if (available.length > 10) text += '... và <b>' + (available.length - 10) + '</b> tài khoản khác.\n';
            keyboard.push([{ text: '🗑️ Xóa TẤT CẢ tồn kho', callback_data: 'adm_clearstock_' + productId }]);
          } else {
            text += '✖️ Hiện tại kho đang trống!';
          }
          keyboard.push([{ text: '➕ Nạp thêm stock', callback_data: 'adm_addstock_' + productId }]);
          keyboard.push([{ text: '◀️ Quay lại', callback_data: 'adm_product_' + productId }]);
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
              keyboard.push([{ text: '🗑️ Xóa: ' + s.account_data.substring(0, 25) + '...', callback_data: 'adm_delstock_' + productId + '_' + s.id }]);
            });
            keyboard.push([{ text: '🗑️ Xóa TẤT CẢ tồn kho', callback_data: 'adm_clearstock_' + productId }]);
          }
          keyboard.push([{ text: '➕ Nạp thêm stock', callback_data: 'adm_addstock_' + productId }]);
          keyboard.push([{ text: '◀️ Quay lại', callback_data: 'adm_product_' + productId }]);
          return await sendOrEditText(bot, chatId, messageId, text, keyboard);
        }

        if (data.startsWith('adm_clearstock_')) {
          const productId = parseInt(data.split('_')[2]);
          await db.clearStock(productId);
          bot.answerCallbackQuery(query.id, { text: 'Đã làm sạch kho!' });
          return await sendOrEditText(bot, chatId, messageId, `🎯 Đã xóa sạch toàn bộ acc của sản phẩm #${productId}.`, [[{ text: '◀️ Quay lại', callback_data: 'adm_product_' + productId }]]);
        }

        if (data.startsWith('adm_delete_')) {
          const productId = parseInt(data.split('_')[2]);
          await db.deleteProduct(productId);
          bot.answerCallbackQuery(query.id, { text: 'Đã xóa sản phẩm!' });
          return await sendOrEditText(bot, chatId, messageId, `🗑️ Đã xóa hoàn toàn mặt hàng #${productId}.`, [[{ text: '◀️ Về kho hàng', callback_data: 'adm_back_list' }]]);
        }

        if (data === 'adm_back_list') {
          const products = await db.getAllProducts();
          const keyboard = products.map(p => [{ text: `📦 #${p.id} ${p.name} (Kho: ${p.stock_count})`, callback_data: 'adm_product_' + p.id }]);
          keyboard.push([{ text: '➕ Thêm sản phẩm mới', callback_data: 'adm_add_product' }]);
          return await sendOrEditText(bot, chatId, messageId, '⚙️ <b>QUẢN TRỊ SẢN PHẨM:</b>', keyboard);
        }
      }

    } catch (e) {
      console.log('Callback error:', e.message);
    }
    bot.answerCallbackQuery(query.id).catch(() => {});
  });

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
          reply_markup: { inline_keyboard: [[{ text: '🛒 Mua Ngay', callback_data: 'back_main' }]] }
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
              inline_keyboard: [[{ text: '🛒 Mở Cửa Hàng', callback_data: 'back_main' }]]
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
          reply_markup: { inline_keyboard: [[{ text: '🛒 Mua Ngay', callback_data: 'back_main' }]] }
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
        [{ text: '⚡ Mua bằng SỐ DƯ VÍ', callback_data: `paywallet_${editInfo.productId}_${qty}` }],
        [{ text: '🏦 Quét mã QR NGÂN HÀNG', callback_data: `paybank_${editInfo.productId}_${qty}` }],
        [{ text: '◀️ Thay đổi số lượng', callback_data: `product_${editInfo.productId}` }]
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

  console.log('🤖 ' + config.SHOP_NAME + ' đang chạy với bộ Canvas toàn diện kèm tự động chúc sáng/trưa!');
}

startBot().catch(console.error);
