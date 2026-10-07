# KodeBart Issue 任務契約 v1.1

GitHub Issue 是新協作流程的唯一任務契約。聊天、`doc/COLLABORATION.md`、Agent 留言或 PR 描述可以提供背景，但不能取代完整 Issue。一張 Issue 是一個可驗收單元；v1.1 階段 A 的 checkpoint 與交付規則（§6、§7）隨 Issue #5 送審，合併後生效。

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
Execution mode: implement | research | checkpoint-review
Validation profile: product | workflow | docs
Source Issue / Source head: #<number> / <固定 SHA>（同任務 checkpoint 整合時）
Resume PR / Resume head: #<number> / <固定 SHA>（僅 B 預留；目前無 resume 入口）
```

`Depends on` 必須包含狀態或固定版本。只寫「看最新版本」不足以作為跨 Agent handoff。

目前 Issue 派發使用 implement；verify-only 使用已啟用後的手動入口，不呼叫模型。research／checkpoint-review 是任務描述，不另開自動入口。B 未啟用前不得派發 `Execution mode: resume`；保留其契約作為待實作規格：原 Issue 決定範圍，既有 PR 保存成果，固定 head 與 Remaining 決定一次續做內容，不重做原任務或默默接受新的 head。

`Validation profile` 宣告預期的變更範圍，只能收窄允許路徑，不能略過檢查：

| profile | 允許的變更路徑 | 必跑檢查（由實際 diff 決定） |
| --- | --- | --- |
| `product` | 遊戲程式、設定與資源（非 `.github/`、非 `doc/`、非根目錄 Markdown） | npm ci、兩個 tsc、production build（零警告）、ng test |
| `workflow` | `.github/`、`CLAUDE.md`、`doc/agent-workflow/` | actionlint、離線流程判定測試；Angular 檢查列 NOTRUN（workflow-only） |
| `docs` | `doc/`、根目錄 Markdown | `git diff --check`、文件路徑引用一致性 |

實際 diff 碰到產品路徑時，產品檢查一律必跑；變更超出宣告 profile 時視為驗證失敗，交 Human 決定。

驗證尚在執行用 PENDING；沒有執行用 NOT RUN；強制中止或缺證據用「未確認」並說明。均不能猜成 PASS，不能引用舊 SHA 的綠燈，或反覆輪詢 CI 消耗模型回合。Human 負責遊戲操作測試與最終驗收。

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
- 指定來源不可取得，或需要偏離規格時，在原 Issue 回報「需要 Codex 覆核」：指定來源／SHA、錯誤原因、原要求、擬偏離內容、影響、Completed／Remaining 及等待誰決定。先停止受影響的規格修改，不自行重建治理文件。必須逐項列重大刪改，不能只寫「依 Issue 自行改寫」。

## 6. Checkpoint 格式

每完成可辨認的子項就 commit 並 push。commit 訊息在摘要後加上：

```text
Checkpoint:
- Issue: #<編號>
- Branch: <本輪分支>
- Completed: 已完成的子項
- Remaining: 尚未完成的子項
- PASS: 已通過的本地檢查
- FAIL: 失敗的本地檢查
- NOTRUN: 未執行的檢查與原因（例如 allowlist 不允許、由 CI 執行）
- Stop reason: 進行中 | max_turns | timeout | validation | environment/permission | unknown | 完成
- Next step: 下一步或需要 Human 決定的事

KodeBart-Issue: <編號>
KodeBart-Delivery: checkpoint
```

- 固定 SHA 由 workflow 收尾回報填入；commit 無法包含自己的 SHA。
- checkpoint 不是完成交付。只有全部完成且必要本地檢查通過時，最後一個 commit 才把 trailer 改為 `KodeBart-Delivery: complete`，之後不再推送。
- trailer 的 Issue 編號必須是本 Issue；不符、缺少或寫成其他值，一律視為缺少完成證據。
- workflow 只引用 Checkpoint 區塊作為 Agent 自述，不把它當成驗證結果。

commit trailer 與可閱讀的交接摘要並存，不能互相取代。原 Issue／PR 留下：Source Issue、branch／固定 head／PR、Completed、Remaining、PASS／FAIL／NOT RUN／PENDING／未確認、Stop reason、Next step、需要 Codex 覆核的偏離。讀不到剩餘工作時寫未確認，不捏造模型內部狀態。

## 7. 完成回報格式

Lead Agent 結束前，留言至少包含：

```md
## Completion Summary
- 完成了什麼；是完整交付還是 checkpoint

## Deliverables
- PR / commit / 固定 SHA / repository paths / artifact links

## Validation Results
- PASS: 已通過的檢查
- FAIL: 失敗的檢查
- NOT RUN: 未執行與原因（含交給模型步驟之外 CI 的項目）

## Deviations and Known Limits
- 與 Issue 不同之處、取捨、限制

## Human Review Checklist
- Human 需要實際確認的步驟

## Follow-up Suggestions
- 僅供 Human 決定；不得自動派發
```

`human-review` 由 workflow 設定：head commit 標 `complete`、模型正常結束、必跑檢查在同一 SHA 全部通過、收尾時 head 未變。其餘有提交的情況是 draft PR＋`blocked`；沒有提交是 `blocked`。workflow 的收尾留言另列原 Issue、branch、固定 SHA、Completed／Remaining、PASS／FAIL／NOTRUN、Stop reason 與 Next step。
