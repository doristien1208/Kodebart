# KodeBart · 錯誤世界（ERROR OF THE WORLD）

以公司電腦為舞台的單人劇情遊戲：閱讀來源、處理工作、選擇交付的資訊，再從回條與人物關係理解後果。

main 已有 Day 1–6 的產品基線；#11／PR #12 的 M2 底層成果尚未完整合併。2026-10-21 起以**功能模組**安排里程碑，不以天數或整章作一張 Issue。下一個模組是案件檔案夾的查閱與版本比較，計畫不等於已實作。

## 文件

- [主企劃：世界觀、劇情流程、模組與本輪任務](doc/KodeBart-Game-Plan.md)
- [文件入口與歷史資料定位](doc/README.md)
- [介面與素材規格](doc/DESIGN.md)
- [執行／覆核／main 試玩流程](doc/agent-workflow/OPERATING_MODEL.md)
- [跨電腦接手狀態](doc/agent-workflow/HOME_HANDOFF.md)
- [驗證責任與證據](doc/Verification.md)

## 技術與責任邊界

Angular 19.2 standalone components、signals、lazy 路由；Tailwind CSS v4。純 core 規則、content JSON／嚴格驗證、state／保存 adapter、UI／presenter 分離。無後端、SSR、登入或真實公司 API，不為模擬電腦新增微服務。

`src/app/game/`：core（規則）、content（資料／文字）、state（狀態／提交）、ui（應用／共用視窗）、platform（瀏覽器邊界）。模組不是要求轉成 NgModule，也不是按 Day N 複製畫面。

## 本機檢查與試玩

Human 維持唯一專案、只更新 main；先確認沒有未提交修改，再快轉更新。Git pull 不會同步瀏覽器存檔。試玩前備份 localStorage 原始字串，key 為 `kodebart-save-v2`；不要為了試新版先清檔。

安裝依賴用 `npm ci`；開發伺服器可用 `npx ng serve --port 4340`，先確認該 port 沒有被占用。公司 port 4200 屬其他專案，勿使用或關閉未知服務。正式試玩通知另附固定 main commit 與更新內容；不要拿工程 checkpoint 當新試玩版。

完整產品驗證由既有 Action 的模型外 CI 執行；命令與責任見 CLAUDE.md／Verification。封面沿用 `public/assets/kodebart-cover.png`，不重畫；兩張 Gemini 圖的存在不代表 runtime 已接入。
