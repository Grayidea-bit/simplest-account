# CLAUDE.md — The Simplest Account 開發守則

## 專案一句話

極簡收支記帳 web app，部署於 Cloudflare Workers（零月費：Workers Free + D1 免費額度）。

## 鐵律

1. **模型分工鐵律**：每次進行實作時，須將任務分配給勝任的模型執行（Opus/Sonnet/Haiku）；若小模型無法勝任該任務，則不使用小模型，直接升級指派，不硬塞。安全敏感（auth、金鑰）與整合審查一律最高階模型。
2. 金額一律以整數 cents 存 `INTEGER`，不得使用浮點數存金額。
3. API 錯誤格式統一為 `{"error":{"code","message"}}`。
4. 秘密不入庫：`PASSCODE` 只放 `.dev.vars`（本地）或 `wrangler secret`（正式環境），不得寫入程式碼或提交進版本控制。
5. Schema 變更一律加新 migration 檔（`migrations/` 資料夾，帶序號命名），不得修改舊的 migration 檔。
6. TypeScript 全程 `strict` 模式，禁止使用 `any`。

## 結構說明

- `src/` — Worker 後端（Hono API）
- `web/` — 前端（vanilla TS + Vite）
- `migrations/` — D1 SQL migration 檔
- `dist/` — build 產物（已 gitignore）

## 常用指令

```bash
npm run dev      # 先 build 前端再啟動 wrangler dev
npm run build    # 型別檢查 + 打包
npx wrangler d1 migrations apply simplest-account --local
npx wrangler d1 migrations apply simplest-account --remote
npm run deploy
```
