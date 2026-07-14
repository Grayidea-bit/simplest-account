# The Simplest Account

## 繁體中文

### 這是什麼

最簡單的收支記帳網頁應用：快速新增一筆收入/支出、月檢視、結餘、支出分佈甜甜圈圖，以及可編輯的兩層分類（大類 + 子類）。

支援**多幣別**（NT$/US$/¥/€/CN¥，預設新台幣）：金額輸入框內直接切換幣別，入帳當下鎖定匯率（歷史不隨匯率浮動），結餘與分佈一律以台幣計。匯率資料來自 [RTER.info](https://tw.rter.info)（CC BY-SA），Worker 端快取 1 小時。

### 技術棧

Cloudflare Workers + Hono（API） + D1（資料庫） + vanilla TypeScript / Vite（前端，無框架）。

### 本地開發

```bash
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply simplest-account --local
npm run dev
```

### 部署

```bash
wrangler login
npx wrangler d1 create simplest-account
# 將輸出的 database_id 貼到 wrangler.jsonc 的 d1_databases[0].database_id
npx wrangler d1 migrations apply simplest-account --remote
npx wrangler secret put PASSCODE
npm run deploy
```

### 費用

完全跑在 Cloudflare 免費額度上，每月 $0；使用免費的 `*.workers.dev` 子網域，無需自訂網域或付費方案。

---

## English

### What is this

The simplest possible income/expense tracker web app: quick add a transaction, monthly view, running balance, an expense-distribution donut chart, and editable two-level categories (category + subcategory).

**Multi-currency** support (NT$/US$/¥/€/CN¥, TWD default): switch currency right inside the amount input; the exchange rate is snapshotted at entry time (history never drifts), while balance and distribution are always in TWD. Rates from [RTER.info](https://tw.rter.info) (CC BY-SA), cached 1 hour in the Worker.

### Stack

Cloudflare Workers + Hono (API) + D1 (database) + vanilla TypeScript / Vite (frontend, no framework).

### Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply simplest-account --local
npm run dev
```

### Deploy

```bash
wrangler login
npx wrangler d1 create simplest-account
# Paste the returned database_id into d1_databases[0].database_id in wrangler.jsonc
npx wrangler d1 migrations apply simplest-account --remote
npx wrangler secret put PASSCODE
npm run deploy
```

### Cost

Runs entirely on the Cloudflare free tier — $0/month, using the free `*.workers.dev` subdomain (no custom domain or paid plan required).
