# ربات بیت‌کوین ماینکرافت

## تست روی کامپیوتر
1. Node.js 18+ نصب کن
2. `npm install`
3. `cp .env.example .env` و پر کردنش (اسم اکانت، رمز، توکن تلگرام)
4. `DEBUG=1 node bot.js` — اولین بار با DEBUG اجرا کن تا مطمئن بشی ربات
   پیام قیمت و اسکوربورد (Money / BTC) رو درست می‌خونه.
5. وقتی درست بود DEBUG رو بردار.

## تلگرام
- با @BotFather ربات بساز → TG_TOKEN
- TG_CHAT لازم نیست. بعد از اجرای ربات، توی تلگرام به ربات خودت /start بده تا خودش چت رو پیدا کنه

## اجرای ۲۴ ساعته با GitHub Actions
1. یه ریپوی **عمومی** بساز (ریپوی خصوصی فقط ۲۰۰۰ دقیقه در ماه می‌ده) و این فایل‌ها رو push کن
   (`.env` رو push نکن، توی .gitignore هست)
2. Settings → Secrets and variables → Actions → Secrets:
   MC_HOST, MC_USER, MC_PASSWORD, TG_TOKEN, TG_CHAT (و اختیاری MC_PORT, MC_AUTH, MC_VERSION)
   Variables (اختیاری): REPORT_HOURS, AMOUNT, THRESH
3. تب Actions → mc-btc-bot → Run workflow
4. چون رمز و توکن داخل secrets هست، توی ریپوی عمومی دیده نمیشه.

## Cloudflare Worker (اختیاری، برای مطمئن‌تر شدن راه‌اندازی)
```
cd worker
# GH_REPO رو توی wrangler.toml عوض کن
npx wrangler secret put GH_TOKEN   # PAT با دسترسی Actions: write
npx wrangler deploy
```

## استراتژی
- میانگین متحرک چند قیمت آخر رو نگه می‌داره
- قیمت ≥ ۳٪ بالاتر از میانگین → AMOUNT بیت‌کوین می‌فروشه
- قیمت ≥ ۳٪ پایین‌تر → می‌خره (حداکثر به اندازه‌ی پولت)
- PROFIT_GUARD: بالاتر از قیمت آخرین فروش نمی‌خره و پایین‌تر از قیمت آخرین خرید نمی‌فروشه
- بین معاملات COOLDOWN_MIN دقیقه صبر می‌کنه و زمان ارسال دستور رندوم تأخیر داره
- ضمانت سود نیست؛ اگه قیمت یک‌طرفه بره ممکنه ضرر یا معامله‌ی کم بشه

## اگه کار نکرد
- `DEBUG=1` بزن و لاگ CHAT و SIDEBAR رو ببین
- اگه دستور خرید/فروش آرگومان دیگه‌ای می‌خواد، BUY_CMD و SELL_CMD رو عوض کن
- اگه ورود نمی‌شه، MC_VERSION و MC_AUTH رو چک کن
