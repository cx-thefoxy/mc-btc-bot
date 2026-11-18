try { require('dotenv').config() } catch {}
const mineflayer = require('mineflayer')
const fs = require('fs')

const E = process.env
const num = (k, d) => (E[k] !== undefined && E[k] !== '' ? parseFloat(E[k]) : d)
const CFG = {
  host: E.MC_HOST, port: num('MC_PORT', 25565), user: E.MC_USER,
  auth: E.MC_AUTH || 'offline', pass: E.MC_PASSWORD || '', version: E.MC_VERSION || false,
  tgToken: E.TG_TOKEN, tgChat: E.TG_CHAT, reportMs: num('REPORT_HOURS', 2) * 3600e3,
  amount: num('AMOUNT', 0.2), thresh: num('THRESH', 0.03), window: num('WINDOW', 20),
  minSamples: num('MIN_SAMPLES', 8), cooldown: num('COOLDOWN_MIN', 10) * 60e3,
  minProfit: num('MIN_PROFIT', 0.005), guard: E.PROFIT_GUARD !== '0',
  buyCmd: E.BUY_CMD || '/btc buy', sellCmd: E.SELL_CMD || '/btc sell',
  antiAfk: E.ANTI_AFK !== '0', debug: E.DEBUG === '1', runMs: num('RUN_MINUTES', 0) * 60e3
}
if (!CFG.host || !CFG.user) { console.error('MC_HOST و MC_USER لازمه'); process.exit(1) }

// ---------- state ----------
const STATE_FILE = 'state.json'
let S = { prices: [], lastBuy: null, lastSell: null, lastTrade: 0, startNet: null }
try { S = { ...S, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } } catch {}
const save = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(S)) } catch {} }

// ---------- utils ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const rand = (a, b) => a + Math.random() * (b - a)
const log = (...a) => console.log(new Date().toISOString(), ...a)

function parseNum(s) {
  if (!s) return NaN
  const m = String(s).replace(/,/g, '').match(/([\d.]+)\s*([kKmMbB]?)/)
  if (!m) return NaN
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] || 1
  return parseFloat(m[1]) * mult
}
const fmt = (n) => n == null || isNaN(n) ? '؟' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(2) + 'k' : (+n).toFixed(3).replace(/\.?0+$/, '')

async function tg(text) {
  log('TG:', text.replace(/\n/g, ' | '))
  if (!CFG.tgToken || !CFG.tgChat) return
  try {
    await fetch(`https://api.telegram.org/bot${CFG.tgToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CFG.tgChat, text })
    })
  } catch (e) { log('tg error', e.message) }
}

// ---------- game stats ----------
let bot = null, ready = false, shuttingDown = false, busy = false
let stats = { money: NaN, bank: NaN, btc: NaN, price: NaN, pct: NaN }

function sidebarText() {
  const lines = []
  try {
    const sb = bot.scoreboard && bot.scoreboard.sidebar
    if (!sb) return ''
    for (const it of sb.items || []) {
      let t = ''
      try { t = (it.displayName && it.displayName.toString()) || '' } catch {}
      if (!t || t === it.name) {
        t = it.name || ''
        for (const team of Object.values(bot.teams || {})) {
          if ((team.members || []).includes(it.name)) {
            const p = team.prefix ? team.prefix.toString() : ''
            const s = team.suffix ? team.suffix.toString() : ''
            t = p + it.name + s
          }
        }
      }
      lines.push(t.replace(/§./g, ''))
    }
  } catch {}
  return lines.join('\n')
}

function readStats() {
  const t = sidebarText()
  if (CFG.debug && t) log('SIDEBAR:\n' + t)
  const g = (re) => { const m = t.match(re); return m ? parseNum(m[1]) : NaN }
  const money = g(/Money\s*:?\s*\$?\s*([\d.,]+\s*[kKmMbB]?)/i)
  const bank = g(/Bank\s*:?\s*\$?\s*([\d.,]+\s*[kKmMbB]?)/i)
  const btc = g(/BTC\s*:?\s*([\d.,]+)/i)
  if (!isNaN(money)) stats.money = money
  if (!isNaN(bank)) stats.bank = bank
  if (!isNaN(btc)) stats.btc = btc
}

const net = () => (stats.money || 0) + (stats.bank || 0) + (stats.btc || 0) * (stats.price || 0)
const statusText = () =>
  `💰 پول: ${fmt(stats.money)} | بانک: ${fmt(stats.bank)}\n` +
  `₿ بیت‌کوین: ${fmt(stats.btc)} | قیمت: ${isNaN(stats.price) ? '؟' : '$' + Math.round(stats.price).toLocaleString('en-US')}\n` +
  `📊 ارزش کل: ${fmt(net())}` +
  (S.startNet ? ` (${(((net() - S.startNet) / S.startNet) * 100).toFixed(2)}٪ نسبت به شروع)` : '')

// ---------- strategy ----------
async function say(cmd) { await sleep(rand(800, 3500)); if (bot) bot.chat(cmd) }

async function onPrice(price, pct) {
  stats.price = price; stats.pct = pct
  S.prices.push(price)
  if (S.prices.length > CFG.window) S.prices.shift()
  save()
  if (!ready || busy) return
  if (S.prices.length < CFG.minSamples) return
  if (Date.now() - S.lastTrade < CFG.cooldown) return
  readStats()

  const avg = S.prices.reduce((a, b) => a + b, 0) / S.prices.length
  const diff = (price - avg) / avg
  log(`price=${price} avg=${avg.toFixed(0)} diff=${(diff * 100).toFixed(2)}% btc=${stats.btc} money=${stats.money}`)

  if (diff >= CFG.thresh) {
    if (isNaN(stats.btc) || stats.btc < CFG.amount) return
    if (CFG.guard && S.lastBuy && price < S.lastBuy * (1 + CFG.minProfit)) return
    await trade('sell', CFG.amount, price)
  } else if (diff <= -CFG.thresh) {
    if (isNaN(stats.money)) return
    const amt = Math.min(CFG.amount, Math.floor((stats.money / price) * 1000) / 1000)
    if (amt < 0.001) return
    if (CFG.guard && S.lastSell && price > S.lastSell * (1 - CFG.minProfit)) return
    await trade('buy', amt, price)
  }
}

async function trade(side, amt, price) {
  busy = true
  try {
    await say(`${side === 'buy' ? CFG.buyCmd : CFG.sellCmd} ${amt}`)
    S.lastTrade = Date.now()
    if (side === 'buy') S.lastBuy = price; else S.lastSell = price
    save()
    await sleep(6000)
    readStats()
    await tg(`${side === 'buy' ? '📉 خرید' : '📈 فروش'} ${amt} BTC در $${Math.round(price).toLocaleString('en-US')}\n${statusText()}`)
  } finally { busy = false }
}

// ---------- bot ----------
let lastAuthTry = 0
function start() {
  ready = false
  bot = mineflayer.createBot({
    host: CFG.host, port: CFG.port, username: CFG.user, auth: CFG.auth, version: CFG.version
  })

  bot.once('spawn', () => { log('spawned'); setTimeout(() => { ready = true; readStats(); if (!S.startNet && net() > 0) { S.startNet = net(); save() } }, 8000) })

  bot.on('messagestr', (msg) => {
    if (CFG.debug) log('CHAT:', msg)

    if (CFG.pass && Date.now() - lastAuthTry > 8000) {
      if (/\/login|login\s|وارد شو/i.test(msg) && !/success|موفق|logged in/i.test(msg)) {
        lastAuthTry = Date.now(); setTimeout(() => bot.chat(`/login ${CFG.pass}`), rand(1000, 2500))
      } else if (/\/register|register\s/i.test(msg) && !/success|موفق/i.test(msg)) {
        lastAuthTry = Date.now(); setTimeout(() => bot.chat(`/register ${CFG.pass} ${CFG.pass}`), rand(1000, 2500))
      }
    }

    const m = msg.match(/Bitcoin\s*[»>:]+\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:\(\s*([+-]?[\d.]+)\s*%\s*\))?/i)
    if (m) onPrice(parseFloat(m[1].replace(/,/g, '')), m[2] ? parseFloat(m[2]) : NaN)
  })

  bot.on('kicked', (r) => log('kicked:', typeof r === 'string' ? r : JSON.stringify(r)))
  bot.on('error', (e) => log('error:', e.message))
  bot.on('end', () => {
    ready = false
    if (shuttingDown) return
    const wait = rand(15, 40) * 1000
    log(`disconnected, retry in ${Math.round(wait / 1000)}s`)
    setTimeout(start, wait)
  })
}

// ---------- timers ----------
setInterval(() => { if (ready) readStats() }, 20e3)
setInterval(() => { if (ready) tg(statusText()) }, CFG.reportMs)
if (CFG.antiAfk) {
  setInterval(() => {
    if (!ready || busy) return
    try { bot.look(bot.entity.yaw + rand(-0.6, 0.6), rand(-0.3, 0.3), false) } catch {}
  }, 60e3)
}

async function shutdown(reason) {
  if (shuttingDown) return
  shuttingDown = true
  readStats(); save()
  await tg(`⏹ ${reason}\n${statusText()}`)
  try { bot && bot.quit() } catch {}
  setTimeout(() => process.exit(0), 1500)
}
if (CFG.runMs) setTimeout(() => shutdown('پایان این دوره (دوره‌ی بعدی خودکار شروع می‌شه)'), CFG.runMs)
process.on('SIGINT', () => shutdown('ربات متوقف شد'))
process.on('SIGTERM', () => shutdown('ربات متوقف شد'))

tg(`🤖 ربات روشن شد (${CFG.user}@${CFG.host})`)
start()
