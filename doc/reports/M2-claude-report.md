# M2 實作回報（Claude → Codex 覆核）

- Issue：#11「[M2] 第7–10日完整敘事章節：查證、送件包與同事生活」
- PR：#12（draft）；分支：`claude/issue-11-run38840289640`（同案續做沿用，未新開分支）
- 設計／內容來源：`main@f2e0fdb33e2c97d7ade166613f09f53002bad41e` 的 `doc/KodeBart-M2-Chapter-Plan.md`、`doc/content/M2-shared-city-content.json`、`doc/KodeBart-Game-Plan.md`（只讀，未修改）
  - 內容包 SHA256 已核對：`4d5be092c3e3165aac008c45848bfeaec3bb62d86c8dc0e742059b6100e723dd`
  - 兩張 Human 原圖已核對，未刪改、未接線：
    - `assets/Gemini_Generated_Image_y96ey3y96ey3y96e.jpeg`：`e9e06276…2bd`
    - `assets/Gemini_Generated_Image_v52xw5v52xw5v52x.jpeg`：`0e432c3d…5d6`
- 狀態：**checkpoint，不是完整交付**。本輪最新 head 由 workflow 收尾回報填入；commit 無法包含自己的 SHA。
- 模型：Claude Code `claude-opus-5-5`、effort max。

## 執行紀錄

| 輪次 | 起點 | 內容 | 停止原因 |
| --- | --- | --- | --- |
| 第 1 輪（首次入口） | `f2e0fdb` | casework 純規則、案件檔案夾 presenter、具名條件、R2 | 回報 104 turns＞80，執行判定失敗；成果保留，不改寫失敗 |
| 第 2 輪（同案續做） | `8f5edb5`（＝`404775d`＋Human 兩張原圖） | 本節「本輪完成」 | 主動 checkpoint（約 40 次工具互動評估點） |

## 本輪完成（第 2 輪）

依 Codex 續做契約的順序 1，先完成「Save v13／舊終點明確續接」與 casework 工作種類在 core／state 的必要接線。內容 schema 與 M2 產品 JSON 尚未接入，**Day 7–10 仍不可玩**。

1. **存檔 v13**（`core/types.ts`、`save-schema.ts`、`save-migrate.ts`、`state/save-repository.ts`）
   - `SAVE_VERSION` 12→13，localStorage key 仍是 `kodebart-save-v2`。
   - 新增 `inquiries`：以查詢 ID 為鍵，保存送出日與首次決定的送達時機。
   - `TaskProgress` 納入 `CaseworkProgress`；`MailAttachment` 新增 `casework-submission`（taskId＋versionIndex）。
   - 嚴格驗證：
     - 查詢只能是已知 ID、在可詢問日送出、時機屬於該查詢的變體，不接受多餘欄位。
     - 案件進度：選項屬於本案、版本序號連續、輸出欄位恰為白名單 enum、引用指向本案文件、同一欄不重複、交付日為已知日。
     - 只驗結構與白名單，不比對引用語意或文件目前內容。
   - 遷移：`migrateV12ToV13` 只補 `inquiries: {}`。v2–v11 沿既有鏈到 v12 再到 v13；案件、回覆、已讀、時間、seed、草稿、副本原樣保留。
2. **舊章節終點的明確續接**
   - `core/day-map.ts` 新增 `LEGACY_CHAPTER_END_DAY = 'day.06'`，與既有 `LEGACY_DAY_01／02` 同類的遷移常數。
   - 驗證：只有停在第六日 `end`、且當日工作已結清的存檔，在第六日有下一天時仍合法。其他「有下一日卻 end」照舊拒絕，既有拒絕測試不需改。
   - `rules.continueChapter`：只在 `end` 且有下一天時生效，等同本日交接後的 `advanceDay`。
     - 到期案件、回條、到班各只一次。
     - 不重跑前面的日子、不補選、不清存檔；讀檔與刷新不會自動跳日。
   - `GameStateService.continueChapter()` 與 `canContinueChapter` 已加入；結束畫面的「繼續工作」按鈕尚未接（見 Remaining A）。
3. **casework 工作種類的必要分支**
   - `core/day-plan.ts`：`CaseworkTaskPlan { kind:'casework', casework: CaseworkPlan }`，`DayDirectory.inquiries`。
   - `rules.isTaskDone`、`workday.workdayTaskDone／markTaskOpened／caseworkProgressOf`、`GameStateService.taskAmounts`、`batchIdOfTask`。
   - 文件視窗 ID 與 `workDocumentView`：送件副本只列該版本實際引用的段落快照，不以目前文件重建。
4. **Codex 指定的字串**：`ui.tasks.kind.casework`「案件交接」、`ui.tasks.unit.casework`「件」、`ui.executionLog.command.casework`「casework.submit」，並在 `TASK_KINDS`／schema 登記。
5. **測試**
   - 新增 `core/save-v13.spec.ts`（9 項）：
     - 新存檔、案件進度合法／15 種不合法、查詢合法／6 種不合法。
     - 第六日 end 續接、非第六日 end 拒絕、未結清 end 拒絕、最後一日 end 不動。
     - v12→v13 遷移（含 JSON 往返與停在 end）。
   - 既有測試只改「現行版本號」相關期待值（刻意行為改變，見下表）。

### 刻意改變的既有測試期待值（不是放寬）

| 檔案 | 改動 |
| --- | --- |
| `core/rules.spec.ts` | `createSave` 多 `inquiries: {}`；`SAVE_VERSION` 13；現行版本 13 |
| `core/save-migrate.spec.ts` | 現行 fixture 改 v13（多 `inquiries`）；`from` 13；舊版本清單含 12；新增 v12 輸入一例；測試輔助的遷移鏈多接 `migrateV12ToV13` |
| `core/save-schema.spec.ts` | `makeSave` 改 v13；現行版本 13 |
| `state/save-repository.spec.ts`、`state/game-state.service.spec.ts` | 現行版本／`migratedFrom` 12→13；遷移結果的共同欄位多 `inquiries: {}`；`finishTask` 加 casework 分支（六日情境不會走到，走到即拋錯） |
| `state/m1-workday.spec.ts` | 現行版本 13 |
| `content/text.spec.ts` | `tasks.kind／unit` 多 casework |

## Validation Results（Agent 局部檢查，不是獨立 CI）

- **PASS**（本輪最終工作樹）：
  - `npx tsc -p tsconfig.app.json --noEmit`
  - `npx tsc -p tsconfig.spec.json --noEmit`
  - `git diff --check`
- **FAIL**：無。
- **NOT RUN**：
  - `npx ng test --watch=false --browsers=ChromeHeadless`：本輪 allowlist 需核准，依規則不重試、不換管道，交模型外 CI。**因此新測試與上表期待值的執行結果未確認。**
  - `npx ng build`：同上，allowlist 需核准，交 CI。
  - `npm ci`：未執行（runner 已有依賴；交 CI）。
  - Human 試玩、375px、真實舊存檔：Day 7–10 尚未接入，無法操作。
- 第 1 輪的 PASS（`e677a36`：2992 tests、build 無警告）不適用於本輪 head。

## Remaining（同案續做；不擴大原 Issue）

### A. 內容 schema／M2 正式 JSON／舊終點 UI（本輪未完成部分）

1. `content/schema.ts`、`validate-content.ts`、`bundle.ts`、`text.ts`、`data/manifest.ts`：
   - `CaseworkTask { caseId, text:{eyebrow,heading,instruction} }` 加入 `ContentTask`，task root `onlyKeys` 嚴格檢查；`caseDocs` 接受 casework 引用的 case-source 文件。
   - M2 產品包（例如 `data/m2/shared-city.json`）的正式型別與 strict validator：
     - 項目：`cases`、`savedBindings`、`inquiries`、`caseMail`、`caseOutcomeRules`、`generatedDocumentFields`、`conditions`、`webPages`（含可選 `illustration`，只接受兩張站內路徑）、`interludes`、`ui.casework`（merge `reportCounts`）、`ui.browser`。
     - 白名單 enum、引用存在性；`sender` 做技術映射。
     - `integrationNotes`／`title` 不進產品包。
2. `caseDocuments` 拆進 day-07／08／09 的 `documents`（ID 原樣）；新增 `day-07`～`day-10.json`（文本原樣），manifest 登記。
3. Day 6：`nextDayId` 改 `day.07`；transition 換成 Codex 指定的 `transition.day6.wrap` 文字，刪 End-only 欄位。
   - 只把原 Day6→null 的 interlude 換成 M2 的 Day6→7；`dayTagTemplate` 改 `"DAY / {day}"`，presenter 補兩位數（測 1／9／10）；`dayName` 補 7–10。
   - 會因「六日為最後一天」失效的測試，依產品變更更新期待值（清單見第 1 輪計畫：`bundle.spec`、`validate-content.spec`、`readme-examples.spec`）。
4. 結束畫面與封面：`canContinueChapter` 時顯示內容包的 `continueChapter`／`continueChapterHint`，按下呼叫 `continueChapter()`；最後一日 end 維持原樣。
5. `state/day-directory.ts`：`toBasePlan` 建 `CaseworkTaskPlan`、`DayDirectory.inquiries`。

### B. 首案全鏈路（來源→欄位引用→WorkOperations 交付→不可變版本→隔日條件郵件）

- `WorkOperationsService` 新增 casework 操作：沿用 busy／day/task 綁定／retry，以 `expectedLatest` 鎖版本。
- 綁定白名單查詢：`archived-record`、`case-decision`、`field-map-output`、`report-snapshot`、`casework-output`。缺漏只用 fallback 顯示，不造假來源。
- 版本加入結果快照：通知範圍列／待補、編號與 `codeState`、15:00 依據是否已送達。以 v13 的可選欄位加入嚴格驗證，不需再升版。
- `caseMail`＋查詢回覆：固定 ID、only-once，附件綁不可變送件版本；早回在 `earlyAfterTask` 交付後送達。
  - 需要 `MailRecord` 新的送達時機，以 v13 可選欄位加入。
- 案件檔案夾 UI：沿用既有 presenter，提供鍵盤可用的「引用這一欄」與移除引用、三段預覽與 terminal 事件；375px 用分頁。

### C. 六頁 kb:// 瀏覽器＋兩張配圖

- `angular.json` 的 build／test assets 只加兩筆精確映射。
- 新桌面 app 重用 WindowManager／WindowShell，配圖只用於 `web.city.life` 與 `web.company.together`。
- 補 schema 拒絕未知路徑的測試，以及元件 src／alt／尺寸測試。

### D. 完整 7–10 日與回歸

- 人物生活線與條件訊息、離／到班、Day 10 報表（Codex 最終計數定義）。
- Day 1→10 整合測試，以及 Issue 驗收條件所列的早回、晚回、刷新、retry、舊存檔分支。
- `doc/DESIGN.md` 補瀏覽器與案件視窗行為。

## 需要 Codex 覆核

1. **舊章節終點限定第六日**：以 core 遷移常數 `LEGACY_CHAPTER_END_DAY = 'day.06'` 判定，與既有 `LEGACY_DAY_01／02` 同類。
   - 不這樣限定時，既有測試會失敗：v4／v5／v6／v10／v11 等「有下一日卻 end」的不一致存檔會被當成可續接。
   - 請確認可接受。
2. **送件副本的文件視窗**：目前只列實際引用的段落快照。選項文字與輸出欄位要等 M2 內容包接入後補上，現在沒有任何流程會產生這種附件。
3. **v13 之後的可選欄位**：B 段的結果快照與早回送達時機，擬以 v13 可選欄位加入嚴格驗證，不再升版。
   - 理由：目前沒有任何 v13 存檔含案件進度，正式內容尚無 casework 工作。
   - 若 Codex 要求每次格式擴充都升版，請指示。

## Known Limits

- Day 7–10、案件 UI、瀏覽器尚未接入。`CaseworkTaskPlan`、查詢驗證與 `continueChapter` 目前只由測試與合成日程使用；正式內容仍是六日、Day 6 為最後一天。
- 本輪沒有任何執行中的測試或 build 證據（allowlist），也沒有 UI 操作證據；不宣稱測試通過或 UI 已驗收。
- 第 1 輪記錄的 R2 範圍外觀察（批次「不適用」在 `checkTransform` 視為缺漏）維持原狀：正式內容不可達，不順帶改後果。

## Human Review Checklist

- 本輪是 checkpoint，不需要 Human 試玩。完整交付、同 SHA CI 與 Codex 覆核後，依既有委任整合 main，再通知 Human 只 pull main。

## Follow-up Suggestions（僅供 Human 決定，不自動派發）

- 無新增。#5 的獨立工程問題維持原案，不混入本案。

## 本輪收尾

- Stop reason：主動 checkpoint，停在約 40 次工具互動的評估點。沒有超時；`ng test`／`ng build` 因 allowlist 為 NOT RUN。
- Next step：同 Issue／PR／分支，從本輪 head 續做 Remaining A→B→C→D；完整產品檢查交模型外 CI。
