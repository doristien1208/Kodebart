# KodeBart 文件入口

正式產品是本專案 Angular 遊戲，不是舊 HTML 交接包。更新：2026-10-21。

## 現行權威來源

| 要找什麼 | 唯一入口 |
| --- | --- |
| 遊戲定位、正史、劇情結構、模組與下一里程碑 | [主企劃 v1.0](KodeBart-Game-Plan.md) |
| 介面、元件呈現、token 與素材用途 | [DESIGN](DESIGN.md) |
| 驗證責任、發布門檻、歷史證據 | [Verification](Verification.md) |
| 派工／分支／覆核政策 | [OPERATING_MODEL](agent-workflow/OPERATING_MODEL.md) |
| 跨電腦狀態與接手停止點 | [HOME_HANDOFF](agent-workflow/HOME_HANDOFF.md) |

Action 仍必讀 CLAUDE.md 及 agent-workflow 的四份規則，路徑不刪改；不另造自動化入口。每張 Issue 是當次完整執行契約，不以整份主企劃當無限範圍。

## 資料與證據，不是另一份主企劃

- `content/*.json`：作者提供的內容與穩定 ID；是否已上線須看固定版本，不因檔案存在就宣稱實作完成。
- `reports/`：指定 SHA／日期的歷史交付報告，不是即時狀態；M2 報告目前要從 PR #12 固定 head 讀。
- `prototype/`：歷史 HTML 原型與證據，不再拿來開發／試玩或重跑取代 Angular。
- [Codex Action 設定研究](agent-workflow/CODEX_SUBSCRIPTION_SETUP.md)：可選研究，尚非已啟用流程；產品實作者不必讀。

## 2026-10-21 文件收斂與回復

移除重複／失效的七份活躍文件：`KodeBart-Demo-Spec.md`、`Claude-Handoff.md`、`COLLABORATION.md`、`KodeBart-Gameplay-Replan-Proposal.md`、`KodeBart-M2-Chapter-Plan.md`、`Angular-Acceptance.md`、`Artwork-Brief.md`。

現行玩法／故事歸主企劃；UI／素材歸 DESIGN；歷史驗證定位歸 Verification。原內容、完整生成提示與舊交辦均可從 [整理前固定版本](https://github.com/doristien1208/Kodebart/tree/49aa1a506ad87bc5289a2299ba48c0898190147b/doc) 回復，不清除 Git 歷史、原圖、作者 JSON、報告或原型證據。

早期原碼註解／歷史報告中的上述檔名是歷史定位：請在該固定版本查閱，不把它當現行派工。這次不為改註解而改遊戲程式。後續只更新既有權威文件，避免新增「最終版／最新修訂版」平行企劃。
