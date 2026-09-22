# KodeBart · 錯誤世界（ERROR OF THE WORLD）

單人 Web 劇情向 RPG 的 Angular 正式 Demo（兩日試作「入職」）。
世界觀、玩法規格與設計規範見 [`doc/`](doc/)；本 repo 是由 Codex 交接包（`kodebart-handoff`）移植而來的 Angular 19 CSR 實作。

> 本版為試作：新增人名、案件與流程均為 Demo 提案，不自動升格為正史。詳見 `doc/KodeBart-Game-Plan.md` §2。

## 文件（`doc/`）

| 檔案 | 內容 |
|---|---|
| `KodeBart-Game-Plan.md` | 主遊戲企劃、已確認設定、舊案與未定事項 |
| `KodeBart-Demo-Spec.md` | 兩天逐步玩法、文案、資料規則、結果矩陣與驗收條件 |
| `Claude-Handoff.md` | 開發範圍與整合指令 |
| `DESIGN.md` | 冷色像素風設計 token 與 UI 規範 |
| `Artwork-Brief.md` | 封面構圖、素材用途與生成提示詞 |
| `Verification.md` | 原型的驗證範圍與限制 |
| `README.md` | 原交接包說明 |
| `prototype/` | 原型來源（`prototype-source.html`）、驗證腳本與結果，供比對移植 |

封面素材：`public/assets/kodebart-cover.png`（不含文字；標題與選單由 DOM 呈現）。

## 技術

- Angular 19.2（standalone components、signals、lazy `loadComponent` 路由）
- Tailwind CSS v4（`@tailwindcss/postcss`；設計 token 定義在 `src/styles.css` 的 `@theme`）
- 瀏覽器 `localStorage` 存檔（versioned JSON）；無 SSR、登入、資料庫、真實 API

## 目錄結構

```
src/app/
├── app.routes.ts            畫面路由：/ → /work(/messages|/news) → /overnight → /end
└── game/
    ├── core/                純函式與型別：驗證、種子亂數、存檔 schema、狀態轉移（無 Angular 依賴）
    ├── content/             測試資料（三筆歸檔）與所有對話、公告、報告文案
    ├── state/               Angular signals adapter（GameStateService）、SaveRepository、phase → 路徑
    ├── platform/            瀏覽器邊界：seed 產生、設定（動態開關）
    └── ui/                  畫面元件：cover、workbench、day1、day2、messages、news、transition
```

規則層與呈現層分離：`ui/` 只讀 `GameStateService` 的 signals 並呼叫其方法；所有隨機判定（夜間介入、閒聊版本）在 `core/rules.ts` 以 seed＋固定 eventId 決定，寫入存檔後刷新不重算。

## 開發

```bash
npm install
npm start          # http://localhost:4200
npm test           # Karma + Jasmine（core/state 單元測試含四格結果矩陣）
npm run build      # 產出 dist/kodebart-web-game
```

## 邊界與限制

- 本機存檔只屬於當前瀏覽器；不是跨裝置雲端存檔。重新開始會以對話框確認覆蓋。
- 純前端原型的隱藏狀態可由開發者工具讀取，不代表正式後端安全邊界。
- 第一版不加 SSR、登入、資料庫、真實 API、生成式 AI 或微服務；Node.js／Cloud Run 僅保留未來接入邊界。
