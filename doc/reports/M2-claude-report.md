# M2 實作回報（Claude → Codex 覆核）

- Issue：#11「[M2] 第7–10日完整敘事章節：查證、送件包與同事生活」
- 分支：`claude/issue-11-run38840289640`（GitHub Action 首次入口；後續同案續做沿用此分支）
- 固定來源：`main@f2e0fdb33e2c97d7ade166613f09f53002bad41e`（產品基線 `a366226`＋五份 M2 企劃／內容文件）；已核對本分支起點即為此 SHA
- 本輪狀態：**checkpoint，不是完整交付**。最新 head 由 workflow 收尾回報填入；commit 無法包含自己的 SHA。
- 模型：Claude Code `claude-opus-5-5`、effort max。

## Completion Summary

本輪依 Issue 建議順序先做「一案全鏈路」所需的核心規則，並平行處理兩個可獨立驗證的子項。Day 7–10 尚未接入正常遊戲流程，Human 目前無法試玩 M2。

### 已完成

1. **casework 核心純規則**：`src/app/game/core/casework.ts`，不依賴 Angular、DOM、localStorage 或 content。
   - 引用快照保存 `documentId／version／fieldIndex／label／value`，可加入、移除，不隨原文件改寫。
   - 交付前的程序驗證只檢查四件事：合法引用（屬於本案、目前可開、版本與快照相符、欄位存在）、最少引用數、有效選項、必要來源。
     - 不以引用語意、選項「是否正確」或編號是否與來源相等擋送。
     - 舊批次未附時，「整批」與「先交可轉送列」都不能交付，避免造出空的成功清單；「請窗口補件」仍可交付。
   - 承辦查詢的送達時機以 `rand(seed, eventId)` 擲一次。
     - 已詢問過再呼叫，回傳原保存狀態，不重擲。
     - 早回：指定的另一件工作完成後送達。次日回：下一個工作日送達。
     - 查詢附件在回覆送達前不可開；到保底日起，不論有沒有詢問都可查。
   - 黃品蓉編號逐字比對文件代碼（不修剪、不改大小寫）。符合代碼為「待核定」，任意值或缺漏為 `pending-code`，不自動修正。
   - 條件回條只讀保存的選項與實際引用。`cites` 與 `not-cites` 互斥；引用同份文件的其他欄不算附上那一欄。
   - 通知範圍的列由保存的前日輸出解析。舊批次未附時列數為 `null`，顯示「未附」，不寫成 0。
   - 送件版本只附加，不覆寫：
     - 以 `expectedLatest` 鎖版本，重複送出或畫面過期回傳 `stale`，不覆寫任何副本。
     - 驗證失敗不建立版本，輸入保留給玩家重試。
2. **單元測試**：`src/app/game/core/casework.spec.ts`，27 項。

### 平行子項

- M1 遺留 R2（批次 JSON 依欄位解釋 null）與遊戲內瀏覽器各在獨立 worktree 實作。完成狀態見下方「平行子項狀態」，未合併的不算本輪成果。

## Deliverables

| 路徑 | 內容 |
| --- | --- |
| `src/app/game/core/casework.ts` | M2 案件與送件包純規則、型別與 enum 白名單 |
| `src/app/game/core/casework.spec.ts` | 27 項單元測試（引用、驗證、查詢早回／次日回、保底日、編號核定、條件回條、通知範圍、送件版本） |
| `src/app/game/core/index.ts` | 匯出 casework |
| `doc/reports/M2-claude-report.md` | 本回報 |

## Validation Results（本輪 Agent 局部檢查）

- PASS：`npx tsc -p tsconfig.app.json --noEmit`、`npx tsc -p tsconfig.spec.json --noEmit`（exit 0，對 casework checkpoint 執行）。
- PASS：`npx ng test --watch=false --browsers=ChromeHeadless --include src/app/game/core/casework.spec.ts`，結果 `TOTAL: 27 SUCCESS`。
- NOT RUN：本分支 head 的完整 `ng test` 與 `ng build`。本輪的核心檔是獨立新增；完整驗證交模型外 CI，對固定 head 執行，模型不輪詢。
- 未確認：Human 試玩、375px、真實舊存檔。Day 7–10 尚未接入，無法操作。

## 平行子項狀態

（由本輪收尾時更新，見文末「本輪收尾」。）

## Remaining（同案續做的接線計畫）

依 Issue 的建議順序列出。每一段都要能單獨 checkpoint，並對同一 head 跑兩個 tsc、production build 與完整非 watch 測試。

### A. 存檔 v13（`core/types.ts`、`save-schema.ts`、`save-migrate.ts`、`state/save-repository.ts`）

1. 存檔型別：
   - 把 `CaseworkProgress` 加入 `TaskProgress` 聯集。型別目前在 `core/casework.ts`，可移到 `types.ts`，避免循環。
   - 新增 `inquiries: Partial<Record<inquiryId, InquiryState>>`。
   - `MailAttachment` 新增 `{ kind: 'casework-submission'; taskId; versionIndex }`。
   - `MailRecord.deliverAfter` 新增早回形式 `{ afterTask: TaskId }`。
2. `isValidTaskProgress` 為 casework 加入嚴格驗證。目前未知 kind 只比對 kind，見 `save-schema.ts` L310–325。
   - 範圍：選項必須屬於本案、output 必須是 enum、引用欄位型別、版本序號連續、dayId 合法。
   - `isValidWorkdayAttachment`（L552）與 `isValidWorkdayMail`（L541–550）同步接受新附件與新郵件。
3. **舊六日終點存檔**：`save-schema.ts` L880 在 `stage==='end' && nextDayId!==null` 時拒絕。Day 6 一接 Day 7，所有停在六日結束的存檔都會讀不到。
   - 擬採做法：v12→v13 遷移保留 `end`，標記這是舊章節終點。結束畫面顯示內容包的「繼續工作」與「從已保存的交接接續下一個工作日，不重做前六日。」。
   - 按下才執行 core `continueChapter`，等同從 `wrap` 進入 `advanceDay`。
   - 刷新不自動跳日、不重跑前六日、不補選、不清存檔。
   - 另一做法是仿 v4→v5 把 `end` 改寫成 `wrap`，但沒有「繼續工作」的明確語意，所以不採用。
4. 遷移保留舊案、回覆、已讀、時間、seed、草稿與副本。`MigrationResult.from` 與 `LoadResult.migratedFrom` 補 13。
   - 補 v2–v12→v13 遷移測試，包含停在 Day 6 終點、按下繼續工作前後的狀態。

### B. 內容接線（`content/schema.ts`、`validate-content.ts`、`bundle.ts`、`text.ts`、`data/manifest.ts`）

1. 新增 `TASK_KINDS` 的 `casework`，以及 `CaseworkTask { caseId, text:{eyebrow,heading,instruction} }`。
   - 補 `caseDocs`（L2015–2020），否則 casework 引用的 case-source 文件會被 L2371–2380 擋下。
   - 補 task root 的 `onlyKeys` 嚴格檢查。
2. 新產品內容包，例如 `data/m2/shared-city.json`，採嚴格 pack header。內容包的 `integrationNotes` 是作者說明，不放進產品包。
   - 型別：`cases`、`savedBindings`、`inquiries`、`caseMail`、`caseOutcomeRules`、`generatedDocumentFields`、`conditions`、`interludes`。
   - 新 ID 前綴：`binding.`、`inquiry.`、`cond.`（具名條件）。
   - 驗證：enum 白名單、引用的 task／document／prompt／choice 都存在、`cites` 欄位在範圍內、`when` 只能三選一。
3. `caseDocuments` 拆進各日 `documents`：
   - day-07：`h204-registry`、`supplement`、`current`。
   - day-08：`r27-request`、`list`、`slot`。
   - day-09：`r27-delivery`、`scope-receipt`。
   - ID 原樣保留，跨日引用；`recordIds` 指向既有紀錄。
4. 新增 `day-07`～`day-10.json`，文本原樣複製；`manifest.ts` 登記。
5. Day 6：`nextDayId` 改為 `day.07`，transition 換成 `WrapTransitionText` 形狀（見「需要 Codex 覆核」1）。
6. 條件：
   - `chat-choice`／`not-chat-choice` 對應既有 `ctx.chatChoice`；未回答或 skipped 都算「沒選」。
   - `case-citation`／`not-case-citation` 由 `ConditionContext` 新增唯讀存取。
   - 只讀保存紀錄，不看目前聊天室或草稿。
7. 會因「六日為最後一天」而失效的測試，需依實際產品變更更新期待值（不是放寬）：
   - `bundle.spec.ts`：L179–206，其中 `day-0${n}` 檔名在 Day 10 會壞；另有 L268、L295–306、L341–349。
   - `validate-content.spec.ts`：L90、L249–268、L2346–2360。
   - `readme-examples.spec.ts`：`addExampleDay` 會造出與真實 day-07 重複的 ID。

### C. State 與提交（`state/day-directory.ts`、`game-state.service.ts`、`work-operations.service.ts`、`core/rules.ts`）

1. `toBasePlan` 建立 `CaseworkTaskPlan`。DayDirectory 增加 casework 計畫：文件、查詢、條件回條、綁定。
2. 補編譯器會強制的分支：
   - `isTaskDone`、`isRawTaskDone`、`batchIdOfTask`、`taskAmounts`、`planTask`、`operationCommand`。
3. 補不會報錯、要手動加的地方：
   - `workdayTaskDone`、`markTaskOpened`、`hasAwaiting`、`handoffView`、`FIRST_TASK_EVENT_KINDS`。
4. 綁定是白名單查詢，不把字串當路徑執行：
   - `archived-record` 讀 Day 3 黃品蓉的實際 `archiveCode`。
   - `case-decision` 讀 `basisDocumentId`。
   - `field-map-output` 讀 Day 6 rows。
   - `report-snapshot` 讀 Day 6 報告。
   - `casework-output` 讀指定工作的最新交付版本。
   - 缺漏都用內容包的 fallback 文字，不造標準資料。
5. 交付時保存結果快照：
   - 通知範圍：列、待補，以及舊批次是否附上。
   - 黃品蓉：編號、依據、`codeState`。
   - R-27：查覆送達時才附 15:00 依據，否則只寫申請備註。
6. 以下每封只產生一次，ID 固定，附件綁定不可變的送件版本：
   - `caseMail` 與查詢回覆郵件。
   - 早回在 `earlyAfterTask` 交付後送達。
7. `WorkOperationsService` 新增 `casework` 操作：
   - 沿用 busy、day/task 綁定與 retry。
   - 版本鎖用 `submitCaseworkVersion` 的 `expectedLatest`。
   - 不鎖整個桌面。
8. 生成文件欄位：
   - `saved-choice-label`、`source-version-and-scope` 從保存版本生成；版本號用 `generatedVersionOf`。
   - `source-requested` 時，窗口狀態改用「補件需求已收件」（內容包 integrationNotes 指定）。
9. Day 10 報表：
   - 先由保存資料計算不可變計數：工作項目完成數、清單列數、窗口收件列數、未決項目數。四者分母分開，不能相加。
   - 未附另列，不在缺資料時寫 0。
   - 選定的 focus 只改排列，不改數字。

### D. UI（`ui/workbench`、`ui/shared`、新 `ui/casework`）

1. 案件檔案夾畫面：
   - 顯示工作目的、接手窗口、來源與歷程、本次送件包、處理列。
   - 2–3 份來源可開成既有文件視窗並排。
   - 每個欄位有「引用這一欄」按鈕，可用鍵盤操作；送件包可「移除引用」。
   - 預覽分三段：來源、本次引用與處理、交付輸出。
2. 交付流程與副本：
   - terminal 事件只在真實的驗證、生成、保存、入列發生時寫入。
   - 已交付副本唯讀；只有最新修訂可再改。
3. 375px：
   - 來源與送件包分頁。
   - JSON 在內部橫捲，頁面不溢出。
4. 結束畫面的「繼續工作」（見 A3）。

### E. 其他

- `doc/DESIGN.md`：只補瀏覽器與案件視窗行為，不動 token。
- 整合測試：Day 1→10 正常完成，以及 Issue 驗收條件列出的分支、早回、晚回、刷新、retry 與舊存檔。

## 需要 Codex 覆核的偏離與缺漏（未自行補寫）

1. **Day 6 wrap 文案**：內容包要求把 Day 6 換成 `WrapTransitionText`，但沒有提供 Day 6 的 wrap 文字。目前的 `docTitle`「六日試玩結束」與 `outro` 是結束語意。
   - 擬做最小修改：id 改為 `transition.day6.wrap`，`docTitle` 沿用 Day 1–5 的格式改成「第六日交接完成」，保留 eyebrow／heading／body／backToCover，刪除 summary／thanks／outro。請確認。
2. **離班短文衝突**：`m1-workday.json` 已有 `afterDay: day.06`（`beforeDay: null`）的離班文字，與 M2 包 `day.06→day.07` 的文字不同。`interludeAfter` 會取第一筆。
   - 擬以 M2 包取代 M1 那一筆。請確認 M1 那段是否退役。
3. **Day 10 標籤**：`ui.workbench.dayTagTemplate` 是 `"DAY / 0{day}"`，第十日會顯示「DAY / 010」。
   - 擬把模板改成 `"DAY / {day}"`，由程式補兩位數，第 1–9 日顯示不變。這會改內容字串，請確認。
4. **內容包沒有、但嚴格 schema 必填的玩家可見字**：
   - `ui.workbench.dayName.7`～`10`。既有值是漢字數字「一」～「六」，配合 `docTitleTemplate`「第{dayName}日」；擬補「七／八／九／十」。
   - `ui.tasks.kind.casework`、`ui.tasks.unit.casework`、`ui.executionLog.command.casework`。
   - Day 10 計數的四個分母標籤。內容包只有「程序已完成／窗口已收件／未附本人回覆／待補」，沒有「清單列數」「未決項目數」的標籤文字。
   - 請 Codex 供字，或核准沿用既有格式。
5. **內容包格式差異**（技術接線，不改故事）：
   - 根 ID 是 `content.m2-shared-city`，沒有 `content.` 前綴；`integrationNotes`／`title` 不符合現行 pack header。
   - `sender` 是純字串，不是 `{id, name}`。
   - 擬在產品包內改為正式型別：ID 與文字不變，說明文字不印給玩家。

## Known Limits

- Day 7–10、案件 UI、存檔 v13 尚未接入；`core/casework.ts` 目前只有單元測試使用，沒有遊戲流程呼叫。
- 本輪沒有任何 UI 操作證據，不宣稱 UI 已驗收。

## Human Review Checklist

- 本輪是 checkpoint，不需要 Human 試玩。完整交付、CI 與 Codex 覆核後，依既有委任整合 main 再通知 pull main。

## Follow-up Suggestions（僅供 Human 決定，不自動派發）

- 無新增。#5 的獨立工程問題維持原案，不混入本案。

## 本輪收尾

（見下一段更新。）
