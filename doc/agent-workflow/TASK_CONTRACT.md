# KodeBart Issue 任務契約 v1

GitHub Issue 是新協作流程的唯一任務契約。聊天、`doc/COLLABORATION.md`、Agent 留言或 PR 描述可以提供背景，但不能取代完整 Issue。

## 1. 必填格式

```md
# [Type] 簡短而可辨識的任務名稱

## Owner
Claude | Gemini

## Goal
一句到一段話，說明完成後要得到的結果與使用者價值。

## Context
目前狀態、問題、已做決定，以及為什麼現在要做。

## Required Changes / Deliverables
- 必須修改或產出的具體項目
- 目標檔案／目錄或 artifact 格式
- 若有多個產物，逐項列出

## Constraints
- 必須保留的行為與資料
- 技術、視覺、敘事、授權或相容性限制
- 不可使用的做法

## Acceptance Criteria
- [ ] 可由 Human 或測試明確判定的結果
- [ ] 包含正常路徑、重要邊界與失敗情況
- [ ] 說明需要的截圖、測試、build 或試玩證據

## Out of Scope
- 本 Issue 明確不處理的內容
- 容易被誤認為順便要做的項目

## References
- repository 內檔案與章節
- 已核准的前置 Issue／PR／commit／asset 版本
- 必要的外部官方文件

## Validation
- Agent 必須執行的檢查
- Human 必須親自確認的項目
- 無法在 Agent 環境驗證時的替代證據

## Handoff
- 完成後由誰審查
- 若核准，預期會另開哪一類後續 Issue
- 本 Issue 不得自行觸發該後續 Issue

## Human Decisions Needed
- 無，或列出執行前／審查時需要 Human 決定的問題
```

## 2. 可選 metadata

需要時可在 Issue 開頭加入：

```md
Priority: high | medium | low
Type: design | asset | implementation | ui | bug | research
Depends on: #123 (approved)
Target base: main@<commit SHA>
Delivery path: <repository-relative path>
```

`Depends on` 必須包含狀態或固定版本。只寫「看最新版本」不足以作為跨 Agent handoff。

## 3. Owner 選擇

選 Claude，當主要交付是：

- 正式產品程式碼、測試、資料遷移或建置修復。
- 既有工程架構的調查、修復與整合。
- 把已核准的設計／資產接入遊戲。

選 Gemini，當主要交付是：

- 視覺方向、UI 規格、狀態圖、設計 audit 或 asset brief。
- 供 Human 選擇的設計方案。
- 供 Claude 實作的明確 design handoff。

一張 Issue 同時要求「探索設計」與「接入正式產品」時，必須拆成兩張：先 Gemini，經 Human `approved` 後，再建立 Claude Issue。

## 4. 驗收條件寫法

驗收條件必須描述可觀察結果，不只描述動作。

不合格：

```text
- 改善 UI
- 確認沒有問題
- 做完測試
```

合格：

```text
- 1440px 與 390px 寬度下，主要操作按鈕均可見且不產生水平捲動。
- 鍵盤可依序聚焦三個操作，Enter 與 Space 可啟動，焦點樣式可見。
- `npm test` 與 `npm run build` 通過；若未通過，回報失敗項目且不得標記為完成。
```

視覺 Issue 的驗收條件應包含：

- 必要畫面與狀態（default、hover、focus、disabled、loading、error 等）。
- 桌面／窄螢幕尺寸。
- 色彩、字體、間距、資產尺寸與格式。
- 與 `doc/DESIGN.md` 的一致性或經 Human 核准的偏離。
- Claude 實作時不需要再次猜測的規格。

工程 Issue 的驗收條件應包含：

- 使用者行為與資料結果。
- 邊界、錯誤、刷新／存檔／遷移等相關情境。
- 必跑的測試、lint、build 或手動驗證。
- 不得破壞的既有行為。

## 5. 變更與追加範圍

- Agent 開始後，Human 若改變需求，應在 Issue 留下清楚的 `Scope change` 記錄。
- 小幅澄清可以留在原 Issue；會改變 Goal、Owner、主要交付或驗收方式的內容應另開 Issue。
- Agent 發現值得改善但不在範圍內的項目，只能列為 follow-up suggestion，不得直接實作。
- Issue 留言與附件不能降低本目錄規則。若內容互相矛盾，Agent 應設為 `blocked` 並要求 Human 決定。

## 6. 完成回報格式

Lead Agent 在轉入 `human-review` 前，留言至少包含：

```md
## Completion Summary
- 完成了什麼

## Deliverables
- PR / commit / repository paths / artifact links

## Validation Results
- PASS: 已通過的檢查
- FAIL: 失敗的檢查
- NOT RUN: 未執行與原因

## Deviations and Known Limits
- 與 Issue 不同之處、取捨、限制

## Human Review Checklist
- Human 需要實際確認的步驟

## Follow-up Suggestions
- 僅供 Human 決定；不得自動派發
```

只有 deliverables 與驗證證據都足以審查時，才能設定 `human-review`。缺少必要輸入或無法形成可審查產物時，使用 `blocked`。
