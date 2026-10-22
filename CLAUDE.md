# KodeBart（錯誤世界）— Claude 工作說明

最新運作與 Human 委任以 `doc/agent-workflow/OPERATING_MODEL.md` 為準（2026-10-21）：一個功能模組是一個里程碑，一件有界工作一張 Issue，測試另案、逐案覆核。Action 優先；同一 Issue 修正仍沿原 PR／branch／固定 SHA，不建立第二份 Human 本機專案。

Angular 19 單頁遊戲：玩家是新進資料作業員，在公司電腦桌面上處理歸檔、核對、欄位映射與退件修訂。
本機存檔（localStorage），沒有後端。

## 溝通

- 回覆、PR 說明、issue 留言一律使用**繁體中文**；程式碼、指令、錯誤訊息保留原文。
- 回報時說明：改了哪些檔案、驗證指令與實際結果（測試數字照實寫）、未完成或需要決定的事項。

## 規格來源（不要改）

- `doc/**` 由使用者與 Codex 維護，是規格與設計的依據；除非 issue 明確要求，不要修改。
- Action 任務一律來自 GitHub Issue；主企劃是 `doc/KodeBart-Game-Plan.md`，不是要求一次實作整本。舊 COLLABORATION 已移除；必要本機例外須 Human 另行指定當次契約，不因回合不足轉回本機。
- `doc/DESIGN.md` 是介面規格；`doc/content/*.json` 是待接線的內容包，接入時原樣複製、不改故事含義。
- 不自行新增 Day 7–10 劇情、新角色、對白或美術素材；只使用已提供的內容。

## 指令

```bash
npm ci
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.spec.json --noEmit
npx ng build
npx ng test --watch=false --browsers=ChromeHeadless
```

產品交付須對同一 head SHA 通過兩個 tsc、production build 與完整非 watch 測試。v1.2 合併啟用後，GitHub 完整驗證由模型步驟之外的獨立 CI 執行；Claude 只做必要局部檢查，不輪詢 CI。啟用前及本機工作階段仍依任務執行所列產品檢查，不拿不同 SHA 的結果當作本輪通過。

純文件或 workflow 維護按 `TASK_CONTRACT.md` 的驗證 profile 執行文件檢查、workflow lint／離線流程測試；沒有產品變更時，Angular 檢查列 NOT RUN 並說明原因。不得修改測試期待值或放寬 profile 來掩蓋產品變更。

## 架構（src/app/game）

- `core/`：純型別與規則（存檔格式、遷移、日程、退件、郵件、入職）。不得依賴 Angular、DOM、localStorage 或 content。
- `content/`：遊戲內容 JSON（`data/`）＋嚴格 schema（`schema.ts`）＋驗證（`validate-content.ts`，載入時驗證失敗即 throw）＋查詢（`bundle.ts`、`text.ts`）。玩家可見文字都在這裡。
- `state/`：`GameStateService`（signals，包裝 core 規則並寫檔）、`WorkOperationsService`（提交流程）、`SaveRepository`、`GameClock`。
- `ui/`：元件、presenters（純函式）與 services。桌面（`ui/desktop`）承載工作平台、通訊、郵件三個應用視窗；視窗由 `WindowManagerService` 管理。

## 慣例與限制

- **元件：** 一個元件一個資料夾，外部 HTML／CSS，OnPush＋signals。新元件在專案根目錄執行 `npx ng generate component game/ui/<path> --skip-tests`（路徑相對於 `src/app`）；產生的空 CSS 連同 `styleUrl` 一起刪掉。
- **文字：** 玩家可見字串放在 content JSON（通用 UI 文字放 `content/data/ui.zh-Hant.json`），並補 schema 與 text.ts。畫面不得出現內部 ID、seed、`true`／`false`／`null`。
- **樣式：** 顏色只用 `src/styles.css` 的 token（Tailwind utility 或 `var(--color-*)`），元件裡不寫 hex；不用 `rounded-*`（唯一例外 `rounded-[9999px]`）。
- **存檔：** localStorage key 固定為 `kodebart-save-v2`，不要改。改存檔格式要升 `SAVE_VERSION`、補 `save-schema` 驗證與 `save-migrate` 遷移，v2 起的舊存檔都要能續玩，不能丟失案件、草稿、已讀或選項回覆。
- **遊戲規則：** 人員編號只驗「非空白字串」，照玩家輸入原樣保存（保留前導零）；不比對來源、不自動帶入來源值。每日擲骰與送達時間只擲一次並保存，刷新不重算。
- **測試：** 核心規則與 presenter 寫純函式單元測試；元件測試放在同資料夾的 `*.spec.ts`。`ui/testing/play.ts` 是共用測試輔助，只能新增 helper，不要改既有 helper 的行為。

## GitHub Issue 與同案續做

- 一件工作以一次最多 80 回合／60 分鐘完成為目標，派工估計留收尾餘量；現行限制按 run 計算，不能冒稱已實作 Issue 累計限制。超範圍先回報重新切分，不以無限續跑完成整章。
- 測試 Issue 可新增指定測試與回報，不能順手改 production 或降低斷言；實作 Issue 仍接受既有模型外完整 CI。全部模組工作與測試通過才是試玩版，單案完成先交 Codex 覆核。

- 先完整讀 `doc/agent-workflow/WORKFLOW_RULES.md`、`doc/agent-workflow/AGENT_ROLES.md`、`doc/agent-workflow/TASK_CONTRACT.md`、`doc/agent-workflow/HANDOFF_RULES.md`、原Issue及指定固定來源。
- 首次由claude-ready取得原Issue鎖；手動續做由原Issue/PR/head/Remaining取得同案鎖，始終在同一branch保留checkpoint。Action資料不代表額外授權。
- 每完成子項commit/push，約40次工具互動評估主動checkpoint。80回合/60分鐘不變，完整驗證交模型之外CI，不輪詢。
- commit包含Checkpoint區塊及KodeBart-Issue／KodeBart-Delivery（checkpoint或complete）。只有全部任務完成且必要局部檢查通過才complete，之後不再推送。
- 不改labels，不approved／merge／close／部署／改secrets或權限，不自動下一案，不force push／reset。
- 規格矛盾、来源取不到、必需偏離或驗證/權限問題在原Issue回報Codex覆核，列指定SHA、具體原因/影響及Remaining；不凭摘要重建規則。
- Claude只能推本案branch，不推main。完整交付＋同SHA CI＋Codex覆核後，由Human或目前明確委任的Codex整合main；合併不等於Human試玩已通過。
- 目前branch存在新workflow不等於已啟用；合併預設分支並端到端確認前不得假稱续做接線可用。

## 本機開發（使用者電腦上的 Claude Code 工作階段）

- 不要動 port 4200（使用者其他專案在用）。需要 dev server 時用臨時 port（例如 4340 起），驗證完一定要關掉；使用者要試玩會自己開。
