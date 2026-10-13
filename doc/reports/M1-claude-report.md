# M1 實作回報（Claude → Codex 覆核）

- 分支：`claude/m1-workday`（遠端 `main`）
- 規格 head（起點）：`f3047443ef65e502ce9c119b0ef75487fcf910b1`
- **候選產品 SHA：`ac6cfe2ba5403b0168e6d31893e712e24d516ee8`**（下方驗證全部對這個 SHA 執行）
- 本回報另以一個只新增 `doc/reports/M1-claude-report.md` 的提交放在候選 SHA 之上；該提交不改任何產品檔。
- 工作目錄：`/private/tmp/kodebart-m1-20261008`。主目錄（#5 分支）沒有切換、重設或修改。
- 模型：Claude Code `claude-opus-5-5`、effort max。

## Completion Summary

COLLABORATION.md 的「桌面布局、B 判斷、C 真正下游、隔日回聲」四項都已接入正常遊戲流程，不是獨立示範頁。

### 1. UI：資料作業桌面

- 工作平台只留「工作」「公告」兩個分頁，移除通訊與郵件的重複導航。系統作業紀錄（terminal）維持工具列開啟的獨立視窗，畫面上沒有固定的第三欄。
- 工作視窗分三區：工作佇列、目前文件、底部處理列。
  - 佇列每項顯示種類、名稱、數量與狀態：待辦、進行中、已送件、待補、等待前一批交付。
  - 有資料依賴的工作會鎖住，並列出等待的工作名稱；沒有依賴的工作可以自選順序。
  - 切換工作時草稿留在原工作。已交付的工作不能切回。
- 目前文件顯示對象的來源資料與玩家採用值，並提供送件副本、來源與批次副本的開啟入口。原始 JSON、完整文件與預覽都在文件視窗開啟，不堆在正文。
- 文件視窗沿用 WindowManager／WindowShell，可以並排查閱：
  - 「並排查閱」按鈕有兩個入口。工作視窗的按鈕並排目前沒有關閉的文件視窗；附件表單的按鈕並排對象副本與全部候選附件。
  - 「還原視窗位置」回到預設位置。
  - 小螢幕沿用單窗模式。
- 批次視窗分 `input / rule / output` 三欄，附逐列差異：採用編號與來源不同時標示，輸出值被規則改寫時也標示。
  - 主操作不使用 true／false／null 字樣；技術 JSON 保留型別值，旁邊附領域意義對照（`true＝已拒絕` 等三列）。
- 系統作業紀錄只在真實事件寫入時出現新項目。新增附件、批次、報告三種指令，階段文字取自內容包 `log*`。
  - 提交流程沿用 `WorkOperationsService`：處理中擋重複提交；失敗時保留輸入並可重試；保存成功前不顯示成功。
- 處理列（`.work-bar`）在捲動區底部 sticky。工作視圖以 container query 決定並排或上下排。

### 2. 三種工作串起來（下游一律讀保存資料）

#### A｜歸檔

人員編號只驗非空白，照輸入原樣保存；既有規則不變。Day 3 黃品蓉案件的 ID 與決定沿用既有設定。決定後，Day 4 回條附上送件副本與兩份來源文件。

#### B｜附件關聯（新 kind `attachment`）

- 兩件工作：
  - `task.day4.m1-attachment`：0314，可以誤選 0521 的本人回覆。
  - `task.day5.m1-attachment`：紙本交接，電子回條不等於實物簽收。
- 送件只驗處理方式合法、引用時附件存在，不判斷適用性。
- 送件保存不可變版本快照，內容包括：附件文件副本、證明範圍、附件所屬對象、對象的採用與來源編號、去向。
- 下一工作日到班時核對一次：
  - 對象不符時退回，並寄出「附件關聯需修正」回條，附上該版本與所引用的附件。
  - 從回條附件開啟後，只有最新的退回版本出現修訂表單；舊版本與待核對版本都唯讀。
  - 仍然選錯會再退回，第二次以後的郵件 ID 加 `.r1`、`.r2`。天數照常前進，不會卡住。

#### C｜批次轉換（新 kind `transform`）

- 三批資料：
  - Day 4 小批次：0314、0521、0716。
  - Day 5 補充批次：1013、1108、1219。
  - Day 6 擴大整合：既有欄位映射改成讀保存資料的動態列。
- 每列的輸入：
  - 歸檔保存的採用編號、來源拒絕紀錄與採用來源。
  - 附件關聯最新送件版本的附件（0314 列），或內容附件（0521 列）。
- 值的來源，依序取用：
  1. 本人回覆附件。系統不判斷附件屬於誰，回條才指出問題。
  2. 來源已有的值。
  3. 缺漏時依策略處理：「套用部門預設」寫入 false 並交付；「保留缺漏」寫入 null 並標為待補。
- 兩種策略的待補量、回條與報告都不同。
- 輸出在交付當下存成快照，之後修訂附件不會改寫它。
- Day 6 欄位映射的資料列：
  - 人員編號欄代入歸檔保存的編號。例如 Save A 的 0314 列照原樣是 `0341`，不會自動改正。
  - 回覆欄代入最近一次批次輸出；沒有批次輸出時，用歸檔保存的值。
- Day 6 新增 `task.day6.m1-report`（kind `report`），依賴欄位映射：
  - 送件、已附本人回覆、窗口收件、待補四種數量分開計算。
  - 窗口收件不會計入本人回覆。附件對象不符的列標為「對象不符」。

#### 依賴關係（`dependsOn`）

- Day 1 補入批次依賴第 1 件；Day 2 歸檔依賴核對。這兩天保持原本順序。
- Day 4 批次依賴歸檔與附件關聯。Day 5 附件與批次只依賴歸檔，彼此之間不依賴。

### 3. 文本、聊天、收班

- 聊天依內容包 `dayOverlays`：
  - 機械台詞照 id 替換，既有 `unlock`、`unlockAfter`、prompt／choice／response ID 不變。
  - 新增訊息依時間插入。
- 新的解鎖條件：`caseOpened`、`taskOpened`、`taskPreviewed`，並沿用既有的 `archivedCount`。
- Day 3–6 每天至少 2 個可選回覆（Day 3：2、Day 4：4、Day 5：3、Day 6：3），都可以不回。Day 1–2 不變。
- 延後回條在進入新的一天時依保存資料寄出，郵件 ID 固定，不會重寄。
  - 一般回條（版本、窗口收件、批次結果）的送達時機有兩種變體，由 `rand(seed, mailId)` 擲一次，結果保存在 `MailRecord.deliverAfter`：
    - 到班即到。
    - 當日第一次交付後才送達。
  - 主線回條不會被隨機刪除；錯件也不會被暗骰改成正確。
- 收班流程：
  - 交付當日最後一件時，先打開「本日交接」。面板列出今天的交付清單，以及留待下一工作日的項目：退回的附件、保留缺漏的批次與報告、送覆核的歸檔、未結退件。
  - 按「完成本日交接」才交付並離開桌面。
  - 日結、次日收件與結束畫面接上內容包的離班與到班文字。次日收件列出已抵達的回條；聊天不用讀完也能開工。

### 4. 存檔與相容

- `SAVE_VERSION` 升為 12，localStorage key 仍是 `kodebart-save-v2`。
- v12 新增的資料：
  - `taskProgress` 新增 `attachment`、`transform`、`report` 三種進度。
  - `MailRecord.deliverAfter?: 'first-task'`。
  - 郵件附件新增 `archive-copy`、`case-source`、`attachment-link`、`batch-output`。
- 遷移 v11→v12：
  - 已經過的日子裡沒做完的新工作列為免補，不補跑。
  - 目前這一天的新工作照常排入。
  - 歷史、草稿、已讀、時間、seed 原樣保留。
- v2–v11 的遷移鏈沿用既有規則。v12 驗證「目前工作的依賴已結清」；早上只能停在第一件可開始的工作。v11 以前仍維持依序規則。

## Deliverables

- 提交（`f304744..ac6cfe2`，共 8 個，皆在 `claude/m1-workday`）：
  - `909974b` checkpoint 1：資料鏈與內容接線
  - `84cef59` checkpoint 2：工作台佇列、目前文件、處理列，附件／批次／報告元件，收班交接
  - `f287cb0`、`e85bb82` checkpoint 3／3b：依 M1 更新存檔、狀態、內容與日程測試
  - `924b588` checkpoint 4：工作台導覽縮減；郵件、退件等 UI 測試更新
  - `74bcf10` checkpoint 5：M1 整合測試
  - `0affc2d` checkpoint 6：「並排查閱」按鈕、共用 M1 helper、presenter 測試
  - `ac6cfe2` checkpoint 7：M1 元件、版面、交接測試
- 主要新檔：
  - `src/app/game/core/workday.ts`（純規則）
  - `src/app/game/content/data/workday/m1-workday.json`（內容包：郵件模板與結果、到班／離班文字、UI 字串）
  - `src/app/game/ui/{attachment,transform,report}/…`
  - `ui/shared/{work-document,batch-view}`、`ui/shared/presenters/work-document.ts`
  - `ui/workbench/{work-queue,handoff-panel}`、`ui/workbench/presenters/handoff.ts`、`ui/workbench/services/work-delivery.service.ts`
- 刪除 `ui/workbench/task-stepper`（被工作佇列取代；原本沒有 spec）。
- 新增 8 個 spec 檔：
  - `state/m1-workday.spec.ts`
  - `ui/shared/presenters/work-document.spec.ts`
  - `ui/mail/presenters/mail-view-workday.spec.ts`
  - `ui/attachment/attachment-work/…spec.ts`
  - `ui/transform/transform-work/…spec.ts`
  - `ui/report/report-work/…spec.ts`
  - `ui/shared/work-document/…spec.ts`
  - `ui/workbench/presenters/handoff.spec.ts`
- 共用測試輔助 `ui/testing/play.ts` 只新增 helper（`completeWorkdayTask`、`M1Choices`、`M1_SAVE_A／B`、`doM1Task`、`playM1Day／To／UntilKind`）；`completeTask` 只加了新 kind 的分支，既有分支行為不變。
- 沒有修改 `doc/**`（本回報除外）、`.github/**`、`.claude/**`、`angular.json`、`package*.json`。
- PR：本機沒有 `gh`，無法建立 PR。分支推送後可從此連結建立唯一的遊戲 PR → main：
  `https://github.com/doristien1208/Kodebart/compare/main...claude/m1-workday`。
  我沒有自行擴權，也沒有另開分支。

## Validation Results

固定 head：`ac6cfe2ba5403b0168e6d31893e712e24d516ee8`。開始與結束時 `git status --porcelain` 皆為 0 行。Node `v22.14.0`、npm `10.9.2`。`node_modules` 依未變更的 `package-lock.json` 安裝，本輪沒有重跑 `npm ci`。

- PASS `npx tsc -p tsconfig.app.json --noEmit`，exit 0，沒有輸出。
- PASS `npx tsc -p tsconfig.spec.json --noEmit`，exit 0，沒有輸出。
- PASS（有 1 個警告）`npx ng build`（production），exit 0。輸出末段：
  ```
                        | Initial total        | 549.74 kB |               137.25 kB
  Application bundle generation complete. [3.147 seconds]
  ▲ [WARNING] bundle initial exceeded maximum budget. Budget 500.00 kB was not met by 49.74 kB with a total of 549.74 kB.
  Output location: /private/tmp/kodebart-m1-20261008/dist/kodebart-web-game
  exit=0
  ```
- PASS `npx ng test --watch=false --browsers=ChromeHeadless`，exit 0。輸出末段：
  ```
  Chrome Headless 152.0.0.0 (Mac OS 10.15.7): Executed 2935 of 2935 SUCCESS (8.108 secs / 6.901 secs)
  TOTAL: 2935 SUCCESS
  ```
  測試數由起點 `f304744` 的 2831 增為 2935（+104），沒有刪除任何測試。測試輸出中 WARN／ERROR／LOG 行數為 0。
- PASS `git diff --check f3047443ef65e502ce9c119b0ef75487fcf910b1 HEAD`，exit 0，沒有輸出。
- NOT RUN 實際瀏覽器試玩與截圖。原因見下一節第 1 點。版面只在 ChromeHeadless 裡驗證：工作視圖在 375px 與 1366px 寬度沒有橫向溢出，`.work-bar` 為 sticky、`bottom: 0`。

### 對應 §5 交付門檻的測試

| 門檻 | 測試 |
| --- | --- |
| Day 1→6 正常走完，Day 3–6 混合工作與回聲 | `game-state.service.spec.ts` 全流程；`m1-workday.spec.ts` 兩份存檔各自玩到結束 |
| 錯編號＋錯附件＋預設策略可提交並傳下游；保留缺漏的另一份存檔在輸出、待補量、後日郵件上不同 | `m1-workday.spec.ts`「兩份存檔」：Save A 報告 8／1／0／0，Save B 報告 1／1／1／7；Day 5 郵件 A 是 `wrong-attachment`，B 是 `window-only`＋`awaiting`；Day 6 的 0314 列分別為 `0341`／`0314` |
| 舊副本唯讀、最新修訂可編輯 | `m1-workday.spec.ts`「附件修訂」；`work-document.component.spec.ts`；`work-document.spec.ts`；R12 退件既有測試 |
| 未修正持續退回 | `m1-workday.spec.ts`：仍選錯時 Day 6 寄出 `.r1`；R12 退件既有測試 |
| 未知 ID fallback | `work-document.spec.ts`、`mail-view-workday.spec.ts`：內容移除的文件、任務、版本、模板都顯示「找不到／讀取失敗」，不丟例外 |
| 防重交 | `m1-workday.spec.ts`「防重交」：附件送件、批次交付、報告交付連點，各自只寫 1 個事件 |
| 刷新續接 | `m1-workday.spec.ts`「刷新續接」：附件草稿、批次策略與預覽、已寄郵件與送達時機重新載入後相同，核對只做一次 |
| 遷移保留歷史、草稿、已讀、時間 | `m1-workday.spec.ts`「v11 舊存檔」：Day 5 工作中的 v11 存檔升到 v12 並玩到結束；`save-migrate.spec.ts`；`save-repository.spec.ts` |

## Deviations and Known Limits

1. **我沒有做實際畫面試玩。** 預覽工具讀的是主目錄（#5）的 `.claude/launch.json`。我曾因此誤啟動 #5 程式碼的 dev server（port 4300），當下立即停止，並確認主目錄沒有變更；worktree 的 launch.json 也已還原。之後改以 ChromeHeadless 測試驗證，1366×768、375px 與實際視窗操作請 Human 試玩。
2. **初始 bundle 預算警告**：549.74 kB 超過 500 kB 上限 49.74 kB（起點 `f304744` 為 478.64 kB）。增量來自新工作元件、規則與內容。我沒有調整 `angular.json` 的預算，請 Codex／Human 決定要放寬預算，或另做拆分（例如把內容驗證移出初始 chunk）。
3. **JSON 視窗顯示 true／false／null**：依 COLLABORATION §1「技術 JSON 的 false／null 有領域意義對照」，批次視窗的 JSON 保留型別值，並在旁邊附對照。這與 CLAUDE.md「畫面不得出現 true／false／null」的一般規則不同，屬於本輪交辦明確要求的例外。其他畫面與郵件仍由測試確認不出現這些字。
4. **Claude 自加、需要 Codex 覆核的字串**：
   - `m1-workday.json` 的 `ui` 有 26 個鍵是我為接線加上的（內容包原有 34 個）：
     - 狀態：`statusTodo` 待辦、`statusSent` 已送件、`statusPending` 待補
     - 計數與動作：`receiptCount` 窗口收件、`generateReport` 建立交接報告
     - 副本與回條：`snapshotLabel` 送件副本、`batchCopyLabel` 批次副本、`arrivedMail` 已抵達回條
     - `evidence.*`：本人回覆、窗口收件、待補紀錄、對象不符、未附回覆
     - `valueOrigin.*`：本人回覆附件、來源資料、部門預設、保留缺漏
     - `rowStatus.*`：交付、待補
     - `legendTemplate`：`{value}＝{meaning}`
     - `columns.*`：資料列、人員編號、拒絕紀錄、依據、附件、狀態
   - `ui.zh-Hant.json`：
     - 工作種類：附件、批次、報告；單位：件、列、列。
     - 作業紀錄指令：`attachment.link`、`batch.run`、`report.submit`。
     - 作業紀錄鍵：attachment、evidence、delivered、pending、replies、receipts。
   - M1 任務的 eyebrow 沿用既有格式自訂：`ATTACHMENT / LINK 04／05`、`BATCH / TRANSFORM 04／05`、`REPORT / HANDOFF 06`。
   - 任務標題、說明、選項與策略文字、訊息、郵件模板、到班與離班文字都照內容包原樣，沒有改動。
5. **內容驗證規則調整**：`dependsOn` 只限同一天、不能依賴自己、不能循環；不要求被依賴的工作排在前面。`interlude.beforeDay` 允許 null，讓 README 範例仍可驗證。
6. **既有測試期待值的變更都來自本輪指定的產品行為**，沒有用來掩蓋問題。主要有：
   - 存檔版本 11→12。
   - Day 4／5 多了附件與批次工作；Day 6 多了報告。
   - 收件匣多了 M1 回條。退件規格改用 `receiptMails()` 只核對退件回條；M1 回條另外測試。
   - Day 6 欄位映射的空白列由保存資料決定。
   - 機械台詞依內容包替換。
   - 工作台導覽只剩 2 項。
   - 最後一件改為先打開交接面板。
7. **Day 6 是最後一個工作日**：Day 6 送出的附件修訂沒有隔日核對，狀態停在「已送件」，不會自動判定正確。
8. **一般回條的送達時機每局不同**：Day 4–6 有些回條要等當日第一次交付後才出現在收件匣。相關測試已改成不依賴擲骰結果的斷言。

## M1.1 同案續做（Issue #9／PR #10，GitHub Action）

本節是最新狀態，取代本檔上方舊的 Remaining 與本機 worktree 試玩說明。上方 `ac6cfe2` 的 2935 tests 與 549.74 kB 是舊本機紀錄，不是本輪 head 的 CI 證據。

- Source：`claude/issue-9-m1@ef1aa7b794bb79f434dbf60dc8c3c2151da43d92`（Codex 以 M1 `4bb8f4b`／產品 `ac6cfe2` 整合 main `2c3d690` 建立）。
- Checkpoint：`63de921`（R1／R2／R4）→ `505ddc5`（R3）→ 最後一個 commit（R5＋本報告，`KodeBart-Delivery: complete`）。固定 head SHA 由 workflow 收尾回報填入。
- 既有 M1 成果全部保留，沒有刪功能、內容或測試；沒有改 `.github/`、`CLAUDE.md`、治理規則、`package*.json`、`angular.json`（預算仍 500 kB）、存檔格式或 save key。

### Completed

- **R1 附件當日不揭露**：新增共用列 presenter `batchRowView`／`batchAttachmentText`（`ui/shared/presenters/work-document.ts`），工作摘要、批次預覽、批次副本共用。附件欄只列附件名稱與它聲稱的證明範圍（例如「0521 回覆附件（本人回覆）」），不比對對象。只有這一列實際引用的送件版本已有正式核對、而且結果是退回時，才顯示「對象不符」；不拿附件最新版本重判舊批次。錯附件照常送件、傳到下游，隔日退回不變。
- **R2 來源／採用／輸出分開**：來源欄改用 `sourceRefusalStatus`：null 顯示「未提供」，不適用仍是「不適用」。採用欄改用新的 `adoptedRefusalStatus`（`record-status.ts`）：defaulted 顯示「未拒絕（依規則補登）」，review 顯示「未確認（送資料覆核）」，送件副本用同一套。輸出欄只描述本次轉換。摘要表新增「採用資料」欄。core 的 false/null 與快照 schema 都沒有改。
- **R3 busy 與交易上下文**：`WorkOperationsService` 每次提交記下開始時的日與工作。寫入前會在同一個同步段落再確認一次；換了日或目前工作，就以 rejected 安全拒絕，原草稿保留，也不會寫到別件工作。retry 只在原上下文執行。郵件／回條修訂（`attachment-revise`、`return-resubmit`、`return-window`）只綁日，工作與版本由核心版本鎖定，可以在另一件目前工作下送出或重試。工作佇列在 busy 時停用，`WorkView.onSelect`、`WorkDeliveryService.deliver`／`confirmHandoff` 也加了 guard。文件、通訊、郵件不鎖。
- **R4 changed**：改成比較輸出值與該列保存的 `adoptedRefusal`。批次 JSON 的 input 改列 `sourceRefusal` 與 `adoptedRefusal`，和表格用同一個基準。
- **R5 初始 chunk**：初始 bundle 中唯一引用遊戲狀態的是 `app.routes.ts` 的 `stageGuard`。我改成和既有 `openAppGuard` 相同的延後載入，讓 GameStateService、核心規則與內容包隨第一個畫面的 lazy chunk 載入。守衛判定不變；`stage.guard.ts` 只把回傳型別標成 `true | UrlTree`。沒有提高預算。

### 檔案

- 產品：`src/app/app.routes.ts`、`src/app/game/ui/guards/stage.guard.ts`、`src/app/game/state/work-operations.service.ts`、`src/app/game/ui/shared/presenters/{work-document,record-status}.ts`、`src/app/game/ui/transform/transform-work/transform-work.component.{ts,html}`、`src/app/game/ui/workbench/work-queue/work-queue.component.{ts,html}`、`src/app/game/ui/workbench/work-view/work-view.component.{ts,html}`、`src/app/game/ui/workbench/services/work-delivery.service.ts`
- 測試：`work-document.spec.ts`（R1 未核對／隔日核對／版本分離／修訂不覆寫舊輸出、R2 兩份存檔兩種策略與來源卡・副本一致、不適用、R4 各組合與 JSON 同基準）、`transform-work.component.spec.ts`（摘要與預覽同 presenter、當日不提示對象不符）、`work-operations.service.spec.ts`（強制切換兩側不誤寫、跨工作重試被拒／回原工作重試、郵件修訂）、`work-view.component.spec.ts`（暫停保存時佇列停用、handler 不切換、文件可開、只寫一次）
- 文件：本報告

### Validation（本輪 Agent 局部檢查）

- PASS `npx tsc -p tsconfig.app.json --noEmit`（exit 0）、`npx tsc -p tsconfig.spec.json --noEmit`（exit 0），R5 修改後重跑。
- NOT RUN `npx ng build`、`npx ng test --watch=false --browsers=ChromeHeadless`：Action allowlist 不允許（需要 approval），交給模型之外的獨立 CI 對同一 head 執行。新測試沒有在本輪實際跑過。
- NOT RUN `npm ci`：沒有改 lock，沿用 runner 的 node_modules，完整 `npm ci` 由 CI 執行。
- PENDING：獨立 CI 的 production build 零警告與完整測試。

### 已知限制與需要 Codex 覆核

1. R5 沒有在本輪實測 bundle 大小。依靜態分析，main 只剩 Angular、router、AppComponent／SettingsService 與路由表，應明顯低於 500 kB。若 CI 仍有 warning，請附精確 log 同案續做。
2. 採用欄 review 的「未確認（送資料覆核）」是用既有字串 `recordStatus.unconfirmed`＋`archive.methodReview` 組成的，沒有新增 JSON 鍵。M1 送件副本用同一套；R7 的 ArchivePreview 與 Day 2 副本仍是原本的「未確認」，請覆核文字。
3. Day 6 交接報告的「對象不符」仍由 core `buildReport` 依附件對象計算，沒有修改。Day 6 時，Day 4／5 批次引用的版本都已在到班時正式核對；報告快照 schema 不在 R1 範圍。
4. 批次 JSON input 的鍵 `refusal` 改名為 `sourceRefusal`，並新增 `adoptedRefusal`。只影響視窗顯示，存檔快照不變。

### Remaining

- 獨立 CI（npm ci、兩個 tsc、production build 零警告、完整 ChromeHeadless tests）對最後 head 的結果，以及 Codex 覆核。
- Human 試玩（見下方 checklist）。工程完成不等於試玩通過。

## Human Review Checklist

只在 Codex 依委任整合 main、標 `playtest(M1.1)` 並通知後進行。Human 在唯一本機專案 pull main 即可，不切 branch、不開 worktree 或第二份 clone。

1. 先備份原存檔：在原本試玩頁面的 DevTools Console 執行 `copy(JSON.stringify(localStorage.getItem('kodebart-save-v2')))`，把剪貼簿內容（外層帶引號的 JSON 字串）另存成文字檔。
2. 啟動：`npx ng serve --port 4340`（不要用 4200），用完請關掉。
3. 存檔在不同 origin（例如不同 port）時：到 `http://localhost:4340` 的 Console 執行 `localStorage.setItem('kodebart-save-v2', <貼上第 1 步的 JSON 字串>)`，再重新整理。貼上的是 JSON 字串字面值，不用另外加引號。
4. 載入後存檔遷移到 v12，不會寫回舊版格式。要回到舊版進度，只能用第 1 步的備份重新匯入。已過的日子不補新工作，目前這一天的新工作照常排入。
5. 重點操作：
   - Day 4：0314 選錯附件（0521 回覆）。當日摘要、批次預覽、批次副本只顯示附件本身，沒有「對象不符」。Day 5 收到退回回條後，Day 4 的批次副本才顯示；修訂附件後舊副本不變。
   - 批次摘要：來源缺漏顯示「未提供」；採用欄依 Day 3 歸檔選擇顯示「未拒絕（依規則補登）」或「未確認（送資料覆核）」。兩種策略都試，看輸出欄與待補量。
   - 提交處理中（動態開啟時約 0.6 秒）工作佇列暫停切換，文件、通訊、郵件仍可開；完成後恢復。
   - Day 5：看到窗口收件或待補回條，從退回郵件的附件修訂（目前工作是別件時也可以）。Day 6：查看前日批次副本、建立報告、交接後收班。
6. 視窗：使用「並排查閱」「還原視窗位置」、最小化與切換工作後，確認草稿保留；在 375px 單窗與 1366×768 下操作底部處理列。

## Follow-up Suggestions（僅供 Human 決定，不自動派發）

- 處理初始 bundle 預算：放寬上限，或拆分內容驗證、M1 工作元件。
- 試玩後若覺得文字或回條時機需要調整，請在同一分支回修。
