# M2 實作回報（Claude → Codex 覆核）

- Issue：#11「[M2] 第7–10日完整敘事章節：查證、送件包與同事生活」
- 分支：`claude/issue-11-run38840289640`（GitHub Action 首次入口；後續同案續做沿用此分支）
- 固定來源：`main@f2e0fdb33e2c97d7ade166613f09f53002bad41e`（產品基線 `a366226`＋五份 M2 企劃／內容文件）；已核對本分支起點即為此 SHA
- 本輪狀態：**checkpoint，不是完整交付**。最新 head 由 workflow 收尾回報填入；commit 無法包含自己的 SHA。
- 模型：Claude Code `claude-opus-5-5`、effort max。

## Completion Summary

本輪依 Issue 建議的順序，先做「一案全鏈路」所需的核心規則，再處理可獨立驗證的 R2。Day 7–10 尚未接入正常遊戲流程，Human 目前無法試玩 M2。

### 已完成（都已推送到本分支）

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
2. **案件檔案夾 presenter**：`src/app/game/ui/casework/presenters/case-folder.ts`。
   - 本案文件依內容順序列出，只列目前可開的；未送達的查詢附件不出現。
   - 欄位標示已引用；送件包依加入順序列出快照。
   - 引用的文件版本或內容已不同時，保留快照並標示需重新引用。
   - 預覽 JSON 分三段：來源、本次引用與處理、交付輸出。輸出只含引用的欄位，不印文件 ID，也不按選項補上未引用的段落。
3. **M2 具名條件評估**：`src/app/game/content/conditions.ts`。
   - 支援 `chat-choice`、`not-chat-choice`、`case-citation`、`not-case-citation`。
   - `not-chat-choice` 包含 skipped 與未回答。
   - 引用條件在工作尚未交付時，兩者都不成立。
   - `isConditionId` 沒有放寬；存在性檢查等內容包登記具名條件時一併處理。
4. **R2（M1 #9 遺留）**：批次 JSON 對照依欄位解釋 null，不適用另列。
   - 對照依序為 `true＝已拒絕`、`false＝未拒絕`，再接 M2 內容包 `ui.batchFieldMeaning` 的四句原文。
   - 字放在 `m1-workday.json` 的 `ui.batchFieldMeaning`，`WORKDAY_UI_SHAPE` 有嚴格登記。
   - 輸入 JSON 每列加上保存的 `adoptedOrigin`；來源不適用拒絕紀錄的列另外標 `refusalApplies: false`。
   - 既有鍵、值與 null 不改，存檔、ID 與遊戲後果都不變。
   - 新增 BatchView 實際顯示測試、presenter 測試，以及 schema 缺欄、多欄的測試。
5. **本回報**：包含 Remaining 的接線計畫，以及需要 Codex 覆核的事項。

### 未合併的平行子項

本輪另在兩個本機 worktree 平行實作下列子項，但本輪時限內沒有完成驗證，**沒有合併、也沒有保存在本分支**，所以不算本輪成果，仍列在 Remaining：

- 遊戲內瀏覽器
- 存檔 v13＋舊章節終點的明確續接

## Deliverables

| 路徑 | 內容 |
| --- | --- |
| `src/app/game/core/casework.ts`、`casework.spec.ts` | M2 案件與送件包純規則、型別、enum 白名單；27 項單元測試 |
| `src/app/game/core/index.ts` | 匯出 casework |
| `src/app/game/ui/casework/presenters/case-folder.ts`、`case-folder.spec.ts` | 案件檔案夾 presenter；5 項測試 |
| `src/app/game/content/conditions.ts`、`conditions.spec.ts` | M2 具名條件評估；4 項測試 |
| `src/app/game/ui/shared/presenters/work-document.ts`（＋spec） | R2：`batchFieldLegend()`；批次 JSON 加 `adoptedOrigin`／`refusalApplies: false` |
| `src/app/game/ui/shared/batch-view/batch-view.component.ts`（＋新 spec） | R2：註解；BatchView 實際顯示測試 |
| `src/app/game/content/schema.ts`、`data/workday/m1-workday.json`、`validate-content.spec.ts` | R2：`ui.batchFieldMeaning` 文字與嚴格 schema |
| `src/app/game/ui/shared/work-document/work-document.component.spec.ts` | R2：對照列數期待值 3→6（行為刻意改變） |
| `doc/reports/M2-claude-report.md` | 本回報 |

## Validation Results（本輪 Agent 局部檢查，不是獨立 CI）

- **PASS**，對 `e677a36` 的產品內容執行；其後的 commit 只改本回報：
  - `npx tsc -p tsconfig.app.json --noEmit`、`npx tsc -p tsconfig.spec.json --noEmit`
  - 完整 `npx ng test --watch=false --browsers=ChromeHeadless`：`TOTAL: 2992 SUCCESS`
  - `npx ng build`：沒有 warning、error 或 budget 訊息
  - `git diff --check`
- **FAIL**：無。
- **NOT RUN**：
  - 獨立 CI：交模型外 CI，對固定 head 執行，模型不輪詢。
  - Human 試玩、375px、真實舊存檔：Day 7–10 尚未接入，無法操作。
- **R2 更新的既有期待值**（行為刻意改變，不是放寬）：
  - `work-document.spec.ts` 的 legend
  - `work-document.component.spec.ts` 的對照列數：3→6

## Remaining（同案續做的接線計畫）

依 Issue 的建議順序列出。每一段都要能單獨 checkpoint，並對同一 head 跑兩個 tsc、production build 與完整非 watch 測試。

### A. 存檔 v13（`core/types.ts`、`save-schema.ts`、`save-migrate.ts`、`state/save-repository.ts`）

1. 存檔型別：
   - 把 `CaseworkProgress` 加入 `TaskProgress` 聯集。型別目前在 `core/casework.ts`，可用 `import type` 或移到 `types.ts`，避免循環。
   - 新增 `inquiries: Partial<Record<inquiryId, InquiryState>>`。
   - `MailAttachment` 新增 `{ kind: 'casework-submission'; taskId; versionIndex }`。
   - `MailRecord.deliverAfter` 新增早回形式（指定工作交付後）。
2. `isValidTaskProgress` 為 casework 加入嚴格驗證。目前未知 kind 只比對 kind，見 `save-schema.ts` L310–325。
   - 範圍：選項必須屬於本案、output 必須等於計畫中的 enum、引用欄位型別正確、版本序號連續、dayId 合法。
   - `isValidWorkdayAttachment`（L552）與 `isValidWorkdayMail`（L541–550）同步接受新附件與新郵件。
3. **舊六日終點存檔**：`save-schema.ts` L880 在 `stage==='end' && nextDayId!==null` 時拒絕。Day 6 一接 Day 7，所有停在六日結束的存檔都會讀不到。
   - 擬採做法：v12→v13 遷移保留 `end`。只有當日工作全部 settled 時，才允許非最後一天停在 `end`。
   - 結束畫面顯示內容包的「繼續工作」，以及提示「從已保存的交接接續下一個工作日，不重做前六日。」。
   - 按下才執行 core `continueChapter`，等同從 `wrap` 進入 `advanceDay`。
   - 刷新不自動跳日、不重跑前六日、不補選、不清存檔。
   - 封面進度文字與 End 元件目前假設 `end` 只在最後一天，要一併處理。
4. 遷移保留舊案、回覆、已讀、時間、seed、草稿與副本。`MigrationResult.from` 與 `LoadResult.migratedFrom` 補上新版本。
   - 補 v2–v12→v13 遷移測試，包含停在 Day 6 終點、按下繼續工作前後的狀態。

### B. 內容接線（`content/schema.ts`、`validate-content.ts`、`bundle.ts`、`text.ts`、`data/manifest.ts`）

1. 新增 `TASK_KINDS` 的 `casework`，以及 `CaseworkTask { caseId, text:{eyebrow,heading,instruction} }`。
   - 補 `caseDocs`（L2015–2020），否則 casework 引用的 case-source 文件會被 L2371–2380 擋下。
   - 補 task root 的 `onlyKeys` 嚴格檢查。
2. 新產品內容包，例如 `data/m2/shared-city.json`，採嚴格 pack header。內容包的 `integrationNotes` 是作者說明，不放進產品包。
   - 型別：`cases`、`savedBindings`、`inquiries`、`caseMail`、`caseOutcomeRules`、`generatedDocumentFields`、`conditions`、`interludes`，以及 `ui.casework`。
   - 新 ID 前綴：`binding.`、`inquiry.`、`cond.m2.`。
   - 驗證：enum 白名單、引用的 task／document／prompt／choice 都存在、`cites` 欄位在範圍內、`when` 只能三選一。
3. `caseDocuments` 拆進各日 `documents`：
   - day-07：`h204-registry`、`supplement`、`current`。
   - day-08：`r27-request`、`list`、`slot`。
   - day-09：`r27-delivery`、`scope-receipt`。
   - ID 原樣保留，跨日引用；`recordIds` 指向既有紀錄。
4. 新增 `day-07`～`day-10.json`，文本原樣複製；`manifest.ts` 登記。
5. Day 6：`nextDayId` 改為 `day.07`，transition 換成 `WrapTransitionText` 形狀（見「需要 Codex 覆核」1）。
6. 具名條件接上 `ConditionContext.namedCondition`／`caseCitation`。
   - `caseCitation` 讀指定工作最新交付版本的引用，不看草稿。
   - `validate-content` 檢查條件存在，以及引用的 prompt／choice／task／document 都合法。
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
   - 通知範圍：列與待補，以及舊批次是否附上。待補擬讀第六日報告快照逐列的 `status`。
   - 黃品蓉：編號、依據與 `codeState`。
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
   - 先由保存資料計算不可變計數，四個分母分開，不能相加；定義見「需要 Codex 覆核」5。
   - 未附另列，不在缺資料時寫 0。
   - 選定的 focus 只改排列，不改數字。

### D. UI（`ui/workbench`、`ui/shared`、`ui/casework`）

1. 案件檔案夾元件，使用已完成的 `case-folder` presenter：
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
4. 遊戲內瀏覽器（第四個桌面 app）：
   - 範圍：內容包六頁、唯讀 kb:// 位址、返回／前進、已發布頁索引。
   - 未發布目標的連結不顯示；重用 WindowManager／WindowShell／app icon。
   - 要改的地方：`DesktopAppId`／`DESKTOP_APPS`／`APP_WINDOW_IDS`、`desktopLayout`、`AppIconName`、`ui.desktop.apps`、`ui.workbench.nav`，以及可選的 `app.routes.ts` 深連結。
5. 結束畫面的「繼續工作」（見 A3）。

### E. 其他

- `doc/DESIGN.md`：只補瀏覽器與案件視窗行為，不動 token。功能存在後再寫，避免假稱第四個應用已存在。
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
5. **Day 10 四個分母的定義**：內容包只說四者「不能相加或互相冒稱」，沒有定義各自怎麼算。擬採下列定義，請確認或改定。
   - 工作項目完成數＝第 7–9 日案件工作中已交付的件數，分母是本章工作數。
   - 清單列數＝第七日實際交給窗口的列數，分母是第六日輸出的列數。
   - 窗口收件列數：有兩種讀法，需 Codex 決定。
     - 讀法一：沿 M1 報告的 `receiptCount`，算附件是窗口收件、不是本人回覆的列。
     - 讀法二：第九日回條所示，窗口實際收到清單的列數。
   - 未決項目數＝下列各項的合計：
     - 待補列；
     - `pending-code`；
     - 人工核對或交回承辦；
     - R-27 未確認時段；
     - 送件包沒附下午備註。
   - 第七日的待補列，擬讀第六日報告快照逐列的 `status`。舊存檔缺第六日輸出時，走「未附」，不重算。
6. **內容包格式差異**（技術接線，不改故事）：
   - 根 ID 是 `content.m2-shared-city`，沒有 `content.` 前綴；`integrationNotes`／`title` 不符合現行 pack header。
   - `sender` 是純字串，不是 `{id, name}`。
   - 擬在產品包內改為正式型別：ID 與文字不變，說明文字不印給玩家。

## Known Limits

- Day 7–10、案件 UI、存檔 v13、瀏覽器尚未接入。`core/casework.ts`、`ui/casework/presenters/case-folder.ts` 與具名條件評估目前只有單元測試使用，沒有遊戲流程呼叫。
- R2 範圍內未改的觀察：如果批次中出現「不適用拒絕紀錄」的資料，`checkTransform` 會把它當成缺漏，輸出欄顯示「未確認」或「未拒絕」，而不是「不適用」。
  - 現行正式內容的批次列都適用拒絕紀錄，所以遊戲中不會發生。
  - 修改它會改變遊戲後果，超出 R2 只修對照文字的範圍，所以沒有動；需要時請 Codex 另行指示。
- 本輪沒有任何 UI 操作證據，不宣稱 UI 已驗收。

## Human Review Checklist

- 本輪是 checkpoint，不需要 Human 試玩。完整交付、CI 與 Codex 覆核後，依既有委任整合 main 再通知 pull main。

## Follow-up Suggestions（僅供 Human 決定，不自動派發）

- 無新增。#5 的獨立工程問題維持原案，不混入本案。

## 本輪收尾

- Stop reason：接近 80 回合上限，主動停止並保存。本輪沒有超時，也沒有驗證失敗。
- Next step：
  - 先由 Codex 回覆「需要 Codex 覆核」1–6。
  - 之後在同一 Issue／PR／分支，從本輪固定 head 續做 Remaining A→B→C→D→E。
