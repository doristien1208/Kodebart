# 內容格式說明

這是 `src/app/game/content/` 的資料格式說明。協作流程、任務與驗收一律看 `doc/COLLABORATION.md`，這裡不重複。

玩家看得到的文字全部在 `data/` 的 JSON；TypeScript 只放型別、白名單、載入轉換與規則。

```
data/ui.zh-Hant.json      通用介面字串（封面與進度樣板、工作台外殼、對話框、來源卡、紀錄狀態 recordStatus、
                          訊息頁、狀態提示、國字日名、archive／fieldMap 任務共用的介面字，
                          以及同日多工作 tasks、日結 handoff、次日收件 morning、系統作業紀錄 executionLog、
                          比對案件 caseReview、共用視窗殼 windowShell、提交執行階段 operation、浮動視窗 windows、
                          逐筆審查 recordReview、退件複審 returnedReview、文件問題與錯誤文件處理 documentIssues、
                          電腦桌面 desktop）
data/actors.json          人物
data/channels.json        訊息頻道
data/bulletins.json       公司公告
data/days/day-NN.json     每日：工作台標題、來源紀錄、文件、任務、訊息、當日結束轉場、下一日
data/mail/*.json          郵件包（R12）：寄件者、郵件模板、郵件應用介面字；目前只有退件回條 return-receipts.json
data/onboarding/*.json    入職前情包（R12）：黑底白字旁白、合約與簽名；目前是 first-arrival.json
data/help/*.json          詢問說明包（R12）：向同事詢問的提問與說明訊息；目前是 refusal-record.json
data/manifest.ts          每日檔與 R12 內容包的唯一清單；bundle.ts 只從這裡讀
documents/                長篇正文（Markdown）；目前沒有這種內容，公告等級的短文留在 JSON
```

TypeScript：`schema.ts`（型別、白名單與各種 `text` 區塊的必要欄位 shape）、`conditions.ts`（條件與動作 ID、`visibleFrom` 判斷）、`format.ts`（樣板代入）、`bundle.ts`（載入、驗證、日程查表與查詢）、`records.ts`／`text.ts`（給元件的 API）、`validate-content.ts`（驗證）。

**`text.ts` 不綁日別。** 它只提供跨日共用的介面字（`ARCHIVE_UI`、`FIELD_MAP_UI`、`RECORD_STATUS`、`MESSAGES`（含 `memberCount(n)`）、`TASKS_UI`（含 `stepLabel(index, total)`、`deliverLabel(isLast)`、`taskKindLabel`／`taskUnit`）、`HANDOFF_UI`（`totalTasks(n)`、`handoffItem(kind, n)`）、`MORNING_UI`（`morningPending(kind, n)`、`morningDocTitle(day)`）、`EXECUTION_LOG_UI`（含案件去向 `caseDestination`）、`CASE_REVIEW_UI`（`caseMarkedCount(n)`）、`WINDOW_SHELL_UI`、`OPERATION_UI`、`WINDOWS_UI`、`RECORD_REVIEW_UI`、`RETURNED_REVIEW_UI`、`DOCUMENT_ISSUES_UI`（`issueStatusLabel(status)`、`issueSubmissionLabel(n)`、`issueSourceTaskLabel(day, task)`、`issueReasonText(reason)`、`receiptLabel(kind, caseNumber)`、`caseNumber(auditId, key)`）、`DESKTOP_UI`（`desktopOpenApp(appName)`、`mailUnreadCount(n)`）、`MAIL_UI`（`mailSenderName(packId)`、`renderMailTemplate(text, params)`、`mailVersionLabel(versionIndex)`、`mailReasonText(reason)`）、`ONBOARDING_UI`（`onboardingLoggingIn(name)`）、`helpUi(requestId)`、`progressLabel()` 等）。R12 內容包的資料查詢在 `bundle.ts`：`MAIL_PACKS`／`mailPack(id)`、`ONBOARDING`／`onboardingContractIndex`／`LEGACY_PLAYER_NAME`、`HELP_PACKS`／`helpPackOf`／`helpRequestOf`／`helpMessages`／`helpRequestOfMessage`、`dayDateLabel(dayId)`（見下面「郵件、入職與詢問說明包」）。每日的標題、說明、任務文字、文件與轉場，由目前的 dayId／taskId 從 `bundle.ts` 取得（`dayContentById`、`tasksOfDay`、`contentTask`、`archiveTask`／`reconcileTask`／`fieldMapTask`／`returnReviewTask`、`documentsOfTask`、`recordsOfTask`、`reportDocument`／`receiptDocument`／`caseSourceDocument`、`caseReviewOf`／`caseReviewForRecord`／`ALL_CASE_REVIEWS`、`returnAuditOf`／`ALL_RETURN_AUDITS`／`caseNumberTemplateOf`、`wrapTransitionText`／`endTransitionText`）。工作清單上的標題一律用 `bundle.ts` 的 `taskHeading(taskId)`（return-review——內容定義的，或狀態層以 `issueTaskId(n)` 插入的虛擬任務——沒有日別標題，取 `ui.documentIssues.taskHeading`；eyebrow／說明用 `issueTaskText(taskId)`）。**目前工作一律以存檔的 taskId 查詢，不要讀 `tasks[0]`。** 不要在 `text.ts` 新增 `DAY3` 之類的每日物件。

**內容在載入時就會驗證。** `bundle.ts` 建立 `CONTENT` 時呼叫 `parseContent()`；資料檔有任何問題會直接 throw，錯誤訊息列出全部問題（來源檔、內容 ID、完整欄位路徑）。畫面不會拿到缺欄位的內容。

## ID 規則

每一種內容都有穩定、具命名空間的 ID，彼此以 ID 互相引用，不得用顯示文字、陣列索引或姓名當識別。

| 種類 | 前綴 | 例 |
|---|---|---|
| 人物 | `actor.` | `actor.lin-yuan` |
| 頻道 | `channel.` | `channel.dm.lin-yuan` |
| 訊息 | `msg.` | `msg.day1.welcome` |
| 紀錄 | `record.` | `record.b102` |
| 文件 | `doc.` | `doc.day2.summary` |
| 每日 | `day.` | `day.01`（至少兩位數字，前導零保留） |
| 任務 | `task.` | `task.day1.archive` |
| 批次 | `batch.` | `batch.day01.archive` |
| 公告 | `bulletin.` | `bulletin.welcome` |
| 轉場 | `transition.` | `transition.day1.overnight` |
| 資料列（field-map） | `row.` | `row.0102`（只需在同一任務內唯一） |
| 固定回覆 | `prompt.` | `prompt.day3.lunch-plan` |
| 固定回覆的回應 | `msg.` | `msg.day3.reply.join-wu`（與普通訊息共用 ID 空間） |
| 固定回覆的選項 | （無） | `join`（只需在同一 prompt 內唯一，不得含 `.`） |
| 比對案件 | `case.` | `case.day3.h204`（含所屬日識別） |
| 案件的決定／收件狀態變體 | （無） | `registry`、`received`（只需在同一案件內唯一，不得含 `.`） |
| 退件稽核 | （無） | `day1-code-audit`（全域唯一，不得含 `.`；不要求所屬日識別） |
| 郵件包 | `mail.` | `mail.return-receipts` |
| 郵件寄件者 | `sender.` | `sender.data-desk`（只在郵件包內；同一寄件者在各包名稱一致） |
| 入職前情包 | `onboarding.` | `onboarding.first-arrival` |
| 入職段落 | （無） | `offer`、`contract`（只需在同一入職包內唯一，不得含 `.`） |
| 詢問說明包 | `help.` | `help.refusal-record` |
| 詢問提問 | `request.` | `request.refusal-record`（全域唯一；存檔 helpRequests 的鍵） |
| 說明訊息／prompt／回應 | `msg.`／`prompt.` | `msg.help.refusal.meaning`、`prompt.help.refusal`（含 `help` 識別，取代每日檔的 `dayN`） |

ID 只能用小寫英數、`-` 與 `.`，且全域唯一（改過的 ID 等於換了一筆內容，不要重複使用舊 ID）。

`task.day<N>.return-review`（`schema.ts` 的 `issueTaskId(n)`）保留給第 N 天的錯誤文件處理：那一天內容沒有定義 return-review 任務時，狀態層以這個 ID 插入虛擬任務，所以其他 kind 的任務不得使用它。

**每日檔內的 task／transition／document／message／prompt／回應 ID 必須包含所屬日的識別片段 `dayN`**（`day.02` 的內容用 `task.day2.*`、`msg.day2.*`、`prompt.day2.*`），驗證會逐一檢查；複製一份檔案只改 `id`／`day` 而忘了改內容 ID 會被擋下。紀錄 ID 不含日別，因為紀錄可以被後續日引用。

紀錄另有 `key`（例如 `B102`）作為存檔識別。**`key` 改了會讓既有存檔失效，不要改。**

**編號一律是字串。** `"code": "0102"` 正確，`"code": 102` 會被驗證擋下——JSON 的數字會吃掉前導零。

## 每日檔的結構

```
id            "day.NN"；NN 與 day 數字一致（day.02 ↔ 2）
day           第幾天（整數）
nextDayId     日結後前往的下一日 ID；最後一日填 null
chatDateLabel 訊息頁的日期分隔文字，例如 "9 月 15 日"；必填且非空，不寫 DAY／第 N 天
workbench     { greeting, workHeading }
aside         { heading, body }
records       這一天第一次出現的來源紀錄（之後幾天用 ID 引用）
documents     工作中可開啟的文件，依 kind 分型（report／receipt／case-source）
tasks         至少一個可執行任務，依陣列順序執行；依 kind 分型（archive／reconcile／field-map／return-review）
messages      訊息；用 visibleFrom 決定從哪天起可見
transition    當日結束的轉場；形狀由 nextDayId 決定
```

`nextDayId` 非 null 時必須指向存在的日，且不得指向自己。`bundle.ts` 的 `dayPlan(dayId)` 會把 `nextDayId` 與有序的 `tasks`、批次一起交給狀態層，流程不再靠 phase 判斷第幾天。

## 新增訊息

在該天的 `data/days/day-NN.json` 的 `messages` 加一筆：

```json
{
  "id": "msg.day2.example",
  "channelId": "channel.dm.lin-yuan",
  "actorId": "actor.lin-yuan",
  "time": "09:15",
  "visibleFrom": "day.02",
  "unlock": [],
  "lines": ["範例：第一段。", "範例：第二段。"]
}
```

- `visibleFrom`：從哪一天起可見（day ID）。**一旦到了那一天，之後各日都留在頻道歷史**，不會跨日消失；Day 2 打開私訊時會同時看到 Day 1 的舊訊息。日期不寫在 `unlock`。
- `unlock`：其他條件（全部成立才解鎖）；沒有就填 `[]`。可用的 ID 見下面「條件」。
- `channelId`、`actorId` 必須指到已存在的頻道與人物。
- `time` 是 24 小時制 `HH:MM`。
- `lines` 每個元素是一段，不得為空。
- 同一時間點要在幾種結果中擇一顯示時，加 `variant` 並用對應的條件（下面這則放在 `day-03.json`；Day 2 的 `value` 0 與 1 已被既有閒聊用掉）：

```json
{
  "id": "msg.day3.example-variant",
  "channelId": "channel.dm.lin-yuan",
  "actorId": "actor.lin-yuan",
  "time": "09:16",
  "visibleFrom": "day.03",
  "unlock": ["cond.night.smalltalk.0"],
  "variant": { "key": "night.smallTalkVariant", "value": 0 },
  "lines": ["範例：只有版本 0 會看到這句。"]
}
```

同一天、同一頻道、同一 `key` 的 `value` 不可重複；`key` 的白名單在 `schema.ts` 的 `VARIANT_KEYS`。

訊息在頻道內的順序：先依 `visibleFrom` 的日序，再依檔案內順序。

### 固定回覆（replyPrompt）

訊息可以掛一個 `replyPrompt`：anchor 訊息解鎖後，玩家可從固定選項回覆一次，或選「不回覆」。選擇與回應快照由存檔保存（Save v6 的 `chatReplies`），之後可用 `cond.chat.*` 條件讀取。下面這則放在 `day-05.json`：

```json
{
  "id": "msg.day5.example-ask",
  "channelId": "channel.group.lunch-chat",
  "actorId": "actor.wu-wan-ting",
  "time": "12:30",
  "visibleFrom": "day.05",
  "unlock": [],
  "lines": ["範例：要不要一起去買飲料？"],
  "replyPrompt": {
    "id": "prompt.day5.example-drink",
    "availableThrough": "day.05",
    "choices": [
      {
        "id": "yes",
        "text": "範例：好啊。",
        "responses": [
          { "id": "msg.day5.reply.example-yes", "actorId": "actor.wu-wan-ting", "time": "12:31", "lines": ["範例：那我先下樓。"] }
        ]
      },
      {
        "id": "no",
        "text": "範例：我今天先不用。",
        "responses": [
          { "id": "msg.day5.reply.example-no", "actorId": "actor.yang-zi-qian", "time": "12:31", "lines": ["範例：我也不用。"] }
        ]
      }
    ]
  }
}
```

- `replyPrompt.id` 以 `prompt.` 開頭、含所屬日識別，且全域唯一；只允許 `id`、`availableThrough`、`choices` 三個欄位。
- `availableThrough`：最後可回答的日（存在的 day ID），**不得早於** anchor 的 `visibleFrom`；過了這天就不能再回答，未保存即視為自然未回覆。
- `choices` 非空；`id` 只需在同一 prompt 內唯一，只能用小寫英數與 `-`（**不得含 `.`**，條件以最後一個 `.` 切開）；`text` 是玩家送出的文字，不得為空。
- `responses` 非空，依序插入對話；每則只有 `id`、`actorId`、`time`、`lines`。`id` 用 `msg.` 前綴，與普通訊息共用全域唯一的 ID 空間。**頻道與可見日繼承 anchor 訊息**，不另存 `channelId`／`visibleFrom`（寫了會被擋下）。
- 回應者 `actorId` 必須存在，而且是 anchor 頻道的成員（`channels.json` 的 `actorIds`）；`time` 為 `HH:MM`；`lines` 不得為空。
- 「不回覆」不寫在資料檔；畫面固定提供，選了只保存 skipped。

## 條件

`unlock` 是條件 ID 的陣列，**全部成立**才解鎖；訊息另外還要通過 `visibleFrom`。可用的 ID 在 `conditions.ts` 的 `CONDITION_IDS`：

| 條件 | 意思 |
|---|---|
| `cond.always` | 無條件 |
| `cond.stage.work` | 目前在當日工作台 |
| `cond.stage.wrap` | 目前在日結轉場 |
| `cond.stage.end` | 目前在 Demo 結束畫面 |
| `cond.night.smalltalk.N` | 夜間閒聊版本 N（由存檔決定，重看不重抽） |
| `cond.review.any.<batchId>` | 指定批次至少一筆 `origin=review` |
| `cond.review.none.<batchId>` | 指定批次沒有任何 `origin=review` |
| `cond.chat.<prompt ID 去掉 prompt.>.<choiceId>` | 指定 prompt 已保存的回答是這個 choice（skipped、未回答都不成立） |
| `cond.case.<case ID 去掉 case.>.<decisionId>` | 指定比對案件已保存的決定是這個 decision（尚未決定、舊存檔沒有案件決定都不成立） |
| `cond.return.notified.<auditId>` | 指定稽核已保存退件，且目前日已到通知日（與退件是否已處理無關） |
| `cond.help.<request ID 去掉 request.>.requested` | 玩家已送出該提問（R12；只能用在該提問自己的說明訊息） |

**批次覆核條件**由存檔的 batches 推導（呼叫端提供 `ConditionContext.hasReview(batchId)`），不擲骰、也不另存分支；同一批次的 `any`／`none` 兩則訊息永遠恰好出現一則（Day 4 10:52 的兩則就是這樣互斥）。驗證要求：`<batchId>` 必須是某個 `archive` 任務的 `batchId`，且該批次所屬日**早於**訊息的 `visibleFrom`（當日批次結果尚未確定）。格式錯誤（例如少了 `batch.` 前綴）視為未知條件。

```json
{
  "id": "msg.day5.example-review",
  "channelId": "channel.group.lunch-chat",
  "actorId": "actor.wu-wan-ting",
  "time": "09:20",
  "visibleFrom": "day.05",
  "unlock": ["cond.review.any.batch.day04.archive"],
  "lines": ["範例：Day 4 批次至少一筆送覆核時才看到這句。"]
}
```

**聊天回覆條件**只讀存檔保存的選擇（呼叫端提供 `ConditionContext.chatChoice(promptId)`，skipped 或未回答回傳 `null`）。例如 `cond.chat.day3.lunch-plan.join` 對應 `prompt.day3.lunch-plan` 的 `join`；Day 4 吳婉庭的三則私訊就是依 Day 3 午餐回覆各自解鎖，skip／未回答都不出現。驗證要求：prompt 與 choice 都存在；anchor 訊息不得引用自己的 prompt（回答前不會解鎖）；prompt 的 anchor `visibleFrom` **不晚於**引用它的訊息的 `visibleFrom`（同一天可以，訊息會在當日回答後出現）。`conditions.ts` 的 `chatConditionId(promptId, choiceId)`／`parseChatCondition(id)` 負責組裝與解析。

```json
{
  "id": "msg.day5.example-chat",
  "channelId": "channel.dm.wu-wan-ting",
  "actorId": "actor.wu-wan-ting",
  "time": "09:30",
  "visibleFrom": "day.05",
  "unlock": ["cond.chat.day3.lunch-plan.brought-own"],
  "lines": ["範例：Day 3 回答「我自己帶了」時才看到這句。"]
}
```

**案件條件**只讀存檔保存的案件決定（呼叫端提供 `ConditionContext.caseDecision(caseId)`，由歸檔快照推導；尚未決定、或舊存檔已歸檔該筆但沒有案件決定，回傳 `null`）。例如 `cond.case.day3.h204.review` 對應案件 `case.day3.h204` 的決定 `review`；Day 4 林予安 09:21 的三則私訊就是依 Day 3 黃品蓉那筆的處理方式擇一出現，沒有決定時一則都不出現。它和其他條件一樣走 `isUnlocked()`，列表、未讀與對話串一致。驗證要求：案件與決定都存在，且案件所屬日**早於**訊息的 `visibleFrom`（當日決定尚未確定）。`conditions.ts` 的 `caseConditionId(caseId, decisionId)`／`parseCaseCondition(id)` 負責組裝與解析。下面這則放在 `day-05.json`：

```json
{
  "id": "msg.day5.example-case",
  "channelId": "channel.dm.lin-yuan",
  "actorId": "actor.lin-yuan",
  "time": "09:40",
  "visibleFrom": "day.05",
  "unlock": ["cond.case.day3.h204.review"],
  "lines": ["範例：Day 3 案件選了 review 時才看到這句。"]
}
```

**退件條件**只讀存檔保存的退件（呼叫端提供 `ConditionContext.returnNotified(auditId)`：該稽核已有退件、且目前日 ≥ 通知日才回傳 `true`）。它**不看退件目前是否仍待處理**，所以複審處理完之後，通知訊息仍留在頻道歷史；沒有退件（資料正確、保留待查、只確認收件、舊檔沒有審查處置）一律不成立。Day 3 林予安 09:32 的私訊 `msg.day3.return-code-audit` 就是 `cond.return.notified.day1-code-audit`。驗證要求：稽核存在（某個 reconcile 任務 `returnAudit.id`），且稽核的通知日**不晚於**訊息的 `visibleFrom`（同一天可以）。`conditions.ts` 的 `returnConditionId(auditId)`／`parseReturnCondition(id)` 負責組裝與解析。下面這則放在 `day-05.json`：

```json
{
  "id": "msg.day5.example-return",
  "channelId": "channel.dm.lin-yuan",
  "actorId": "actor.lin-yuan",
  "time": "09:50",
  "visibleFrom": "day.05",
  "unlock": ["cond.return.notified.day1-code-audit"],
  "lines": ["範例：Day 1 批次有退件時才看到這句。"]
}
```

### 工作進度解鎖（unlockAfter）

訊息可加可選的 `unlockAfter`：指定 archive 批次**已提交至少 N 筆**才解鎖（不模擬時鐘）。它與 `visibleFrom`、`unlock` 同時成立才解鎖，由呼叫端提供 `ConditionContext.archivedCount(batchId)`（依存檔 batches 推導，刷新後重算）。訊息列表、未讀、對話串與 replyPrompt 的 anchor 都走同一個 `isUnlocked()`，因此四者一致。Day 3 午餐群組的四則就是在 `batch.day03.archive` 提交 2 筆後一起出現。下面這則放在 `day-05.json`：

```json
{
  "id": "msg.day5.example-progress",
  "channelId": "channel.group.lunch-chat",
  "actorId": "actor.yang-zi-qian",
  "time": "11:20",
  "visibleFrom": "day.05",
  "unlock": [],
  "unlockAfter": { "archiveBatchId": "batch.day05.archive", "archivedCount": 3 },
  "lines": ["範例：本日批次提交 3 筆後才看到這句。"]
}
```

驗證要求：只允許 `archiveBatchId`、`archivedCount` 兩個欄位；`archiveBatchId` 必須是某個 `archive` 任務的 `batchId`；`archivedCount` 是 1 以上、**不超過該批筆數**的整數；批次所屬日**不晚於**訊息的 `visibleFrom`（同日可以）。

沒有 `cond.day.N`（日期用 `visibleFrom`），也沒有 `cond.phase.*`（已停用）。用到這兩類會被驗證擋下並提示改法。

**詢問條件**只讀存檔（呼叫端提供 `ConditionContext.helpRequested(requestId)`：存檔 `helpRequests` 有該提問才回傳 `true`）。成立只代表提問已送出，說明訊息逐則是否已送達由狀態層依保存的送達時間判斷。例如 `cond.help.refusal-record.requested` ↔ `request.refusal-record`。驗證要求：提問存在（某個 `data/help` 包的 `request.id`），且**只能出現在該提問自己的說明訊息**——每日訊息或別的說明包引用都會被擋下。`conditions.ts` 的 `helpConditionId(requestId)`／`parseHelpCondition(id)` 負責組裝與解析。

需要新條件時，在 `CONDITION_IDS` 加 ID（或像 `cond.review.*`／`cond.case.*`／`cond.return.notified.*` 一樣定義參數化前綴與解析函式）並在 `evaluateCondition()` 實作。動作同理，白名單是 `ACTION_IDS`。

**資料檔不得寫程式。** 不可以出現 `${…}`、箭頭函式、`function`、`eval` 或任何運算式；所有判斷都以 ID 交給 TypeScript。

## 任務與批次

每天**至少一個**可執行任務，依 `tasks` 陣列順序執行；當日全部完成才進日結。順序完全由 JSON 決定（例如 Day 1 為 `archive → archive`、Day 2 為 `reconcile → archive`），同一 kind 可以連續出現，一天也可以混合多種 kind。task ID 與 archive 的 `batchId` 都是全域唯一（同日第二批也要有自己的 `batchId`）。`kind` 決定每一項需要哪些欄位：

| kind | 專屬欄位 | 引用 | 畫面 |
|---|---|---|---|
| `archive` | `batchId`：這個任務建立的批次（`batch.` 前綴，全域唯一） | `recordIds` 非空 | 通用歸檔工作台（Day 1、3、4、5） |
| `reconcile` | `sourceBatchId`：要核對的那一批（必須是某個 archive 任務的 `batchId`）；`subjectRecordId`：聚焦的那筆紀錄（必須在 `recordIds` 內） | `documentIds` 非空 | Day 2 型核對與回覆 |
| `field-map` | `sourceFields`、`targetFields`、`rows`（見下） | 皆可為空 | Day 6 型欄位映射 |
| `return-review` | `auditId`（可省略）：某個 reconcile 任務 `returnAudit` 的 id | `recordIds`、`documentIds` **必須是空陣列** | 錯誤文件處理（每日最多一項；只有當天排入到期的文件問題案件時才進入佇列） |

`archive` 不可帶 `sourceBatchId`，`reconcile` 不可帶 `batchId`，`field-map` 與 `return-review` 兩者都不帶。`caseReview`（見下面「比對案件」）只能掛在 `archive`；`returnAudit`（見下面「退件稽核與複審」）只能掛在 `reconcile`；`auditId` 只給 `return-review`。

人員編號只驗型別（字串且不是空白），**不比對來源**：玩家輸入 `"102"`、`"0103"` 都照原樣保存，並一路流入後續核對與交付。R11 起沒有來源編號帶入：編號欄位由玩家自己輸入，`ui.archive.useCode`、`ui.caseReview.useDocumentTemplate` 已移除（殘留會被驗證擋下並提示）。介面字串不放「必須與來源一致」之類的提示，也沒有 `codeMismatch`。

`reconcile` 的 `sourceBatchId` 若是**同一天**某個 archive 任務的批次（同日 archive → reconcile），那個 archive 必須排在 reconcile **之前**，否則驗證會擋下；核對量依 reconcile 自己的 `recordIds` 計算，不是整個來源批次。跨日核對（例如 Day 2 核對 Day 1 批次）不受這條限制。

一天多項工作時，把第二項接在 `tasks` 後面即可，流程程式不需要改。例如範例 day-07 先歸檔、再做欄位映射（兩個物件分別是下面「新增一天」的 archive 任務與「field-map 任務」範例）：

```json
"tasks": [
  { "id": "task.day7.archive", "kind": "archive", "batchId": "batch.day07.archive", "...": "…" },
  { "id": "task.day7.field-map", "kind": "field-map", "...": "…" }
]
```

工作頁的步驟、狀態與交付按鈕（「第 1 / 2 項」、已完成／進行中／待處理、「交付此項工作」／「完成今日交接」）是共用字串，在 `ui.zh-Hant.json` 的 `tasks`；每日檔不放。

### text：每日只放日別文字，共同字串在 ui

`text` 的必要欄位由 `kind` 決定，登記在 `schema.ts`，而且是**嚴格 shape**：缺欄位、空字串、巢狀型別錯誤，以及 shape 以外的多餘欄位（`note` 除外）都會被擋下，錯誤指出完整路徑（例如 `tasks[0].text.dialog.response.ask`）。

| kind | 每日 `text`（每日檔） | 共同介面字（`ui.zh-Hant.json`） |
|---|---|---|
| `archive` | `ARCHIVE_TASK_TEXT_SHAPE`：`eyebrow`、`heading`、`instruction` | `archive`（`ARCHIVE_UI_SHAPE`）：欄位標籤、驗證、確認、佇列、進度樣板等 |
| `reconcile` | `RECONCILE_TASK_TEXT_SHAPE`（含 `choices.ack/ask/review` 與 `dialog.response.ack/ask/review`；對話框沒有自己的完成按鈕） | — |
| `field-map` | `FIELD_MAP_TASK_TEXT_SHAPE`：`eyebrow`、`heading`、`instruction`、`policyDefault`、`policyReview` | `fieldMap`（`FIELD_MAP_UI_SHAPE`）：選單、預覽、確認、完成、無法轉換（`convertError`）等 |
| `return-review` | `RETURN_REVIEW_TASK_TEXT_SHAPE`：只有 `eyebrow` | `documentIssues`（`DOCUMENT_ISSUES_UI_SHAPE`）：工作標題 `taskHeading`、說明 `taskInstruction`、虛擬任務的 `taskEyebrow`；`returnedReview`（`RETURNED_REVIEW_UI_SHAPE`）：原始來源／第一次送件／第二輪審查紀錄／退件原因、重新送審／送窗口待查 |
| （全部） | — | `tasks`（`TASKS_UI_SHAPE`）：步驟、狀態、`deliver`／`finishDay`、種類動詞與單位 |

新的 archive 日**不要**把 `progressTemplate`、`queueLabel` 等共同字串複製進每日檔；會被擋下並提示改放 `ui.archive`。`finishDay` 已從 `archive`／`fieldMap` 移到 `tasks`，reconcile 的 `dialog.finish` 已移除，殘留都會被指出。文件同理：`REPORT_DOCUMENT_TEXT_SHAPE`（含必填的 `versionNeutral`：同日核對、還沒有夜間結果時顯示的中性版本行，不代入任何判定）、`RECEIPT_DOCUMENT_TEXT_SHAPE`；`case-source` 文件的 text 見下面「比對案件」。畫面文字需要新欄位時，先在對應的 shape 加上，TypeScript 型別會跟著推導出來。

### field-map 任務

```json
{
  "id": "task.day7.field-map",
  "kind": "field-map",
  "recordIds": [],
  "documentIds": [],
  "sourceFields": [
    { "id": "old-code", "label": "範例：舊編號" },
    { "id": "old-flag", "label": "範例：舊旗標" }
  ],
  "targetFields": [
    { "id": "new-code", "label": "範例：新編號", "sourceId": "old-code", "convert": "text" },
    { "id": "new-flag", "label": "範例：新旗標", "sourceId": "old-flag", "convert": "boolean", "trueValue": "是", "falseValue": "否" }
  ],
  "rows": [
    { "id": "row.0701", "values": { "old-code": "0701", "old-flag": "是" } },
    { "id": "row.0702", "values": { "old-code": "0702", "old-flag": "" } }
  ],
  "text": {
    "eyebrow": "IMPORT / MAPPING 07",
    "heading": "範例：任務標題",
    "instruction": "範例：任務說明。",
    "policyDefault": "範例：轉為 false",
    "policyReview": "範例：保留 null"
  }
}
```

- `targetFields[].sourceId` 是**作者預設／參照配對，不是必答的正解**。驗證只要求它存在於 `sourceFields`、不同目標的預設不指向同一來源（一對一）；來源與目標的 `id` 各自不可重複。
- **玩家的配對（assignments）決定轉換結果**：預覽、提交、存檔驗證與輸出都依玩家實際選的來源轉換、重算空白筆數與政策適用範圍。「意義選錯」但型別合法的配對（例如兩個 text 欄位互換）可以提交，不會被改回 `sourceId`；規則層只擋不完整、重複、無法轉換（`ui.fieldMap.mappingError`／`convertError`）。
- `convert`：`text` 原樣帶入；`boolean` 必須有 `trueValue`／`falseValue`（不可相同）。作為 boolean 目標**預設來源**的欄位，值只能是這兩者或空字串（保證預設配對可以完成匯入）；玩家若把 boolean 目標配到其他欄位而出現無法轉換的值，由規則層明確阻擋，不會靜默當成 null。
- **空字串＝空值**，由玩家選的 blankPolicy 決定：`default_false` → `false`，`request_review` → `null`。兩者都合法，文案不標推薦。
- `rows` 至少一列；`id` 以 `row.` 開頭且在任務內唯一；`values` 的鍵**恰為**全部來源欄位 id（空值填 `""`，不能省略鍵），值一律是字串（`"0102"` 不可寫成數字）。

### 比對案件（caseReview）

archive 任務可以為其中一筆紀錄掛一個 `caseReview`：兩份 `case-source` 來源文件對同一欄位有差異，玩家選一種處理方式（依據、去向與註記由資料決定），沒有正確答案。人員編號由玩家填寫：決定的 `archiveCode` 只作初次預填，選處理方式不覆寫已編輯的編號，兩份來源各有「帶入{來源標題}」的明確按鈕。另有至少兩份「收件狀態」變體文件，依 seed＋case ID 選一次並保存，只影響佐證多寡。下面是範例 day-07 的文件與任務（替換「新增一天」範例的 `documents` 與 `tasks[0]`）：

```json
[
  { "id": "doc.day7.x01.form", "kind": "case-source", "recordIds": ["record.day7-x01"], "text": { "heading": "範例：原表", "fields": [{ "label": "範例：編號", "value": "0701" }] } },
  { "id": "doc.day7.x01.update", "kind": "case-source", "recordIds": ["record.day7-x01"], "text": { "heading": "範例：補件", "fields": [{ "label": "範例：編號", "value": "0710" }] } },
  { "id": "doc.day7.x01.status-a", "kind": "case-source", "recordIds": ["record.day7-x01"], "text": { "heading": "範例：收件狀態", "fields": [{ "label": "範例：狀態", "value": "範例：已收件" }] } },
  { "id": "doc.day7.x01.status-b", "kind": "case-source", "recordIds": ["record.day7-x01"], "text": { "heading": "範例：收件狀態", "fields": [{ "label": "範例：狀態", "value": "範例：待回傳" }] } }
]
```

```json
{
  "id": "task.day7.archive",
  "kind": "archive",
  "batchId": "batch.day07.archive",
  "recordIds": ["record.day7-x01"],
  "documentIds": ["doc.day7.x01.form", "doc.day7.x01.update", "doc.day7.x01.status-a", "doc.day7.x01.status-b"],
  "text": {
    "eyebrow": "ARCHIVE / BATCH 07",
    "heading": "範例：任務標題",
    "instruction": "範例：任務說明。"
  },
  "caseReview": {
    "id": "case.day7.x01",
    "recordId": "record.day7-x01",
    "sourceDocumentIds": ["doc.day7.x01.form", "doc.day7.x01.update"],
    "receiptVariants": [
      { "id": "a", "documentId": "doc.day7.x01.status-a" },
      { "id": "b", "documentId": "doc.day7.x01.status-b" }
    ],
    "decisions": [
      { "id": "form", "label": "範例：依原表", "archiveCode": "0701", "destination": "archive", "basisDocumentId": "doc.day7.x01.form", "note": "範例：採用原表。" },
      { "id": "update", "label": "範例：依補件", "archiveCode": "0710", "destination": "archive", "basisDocumentId": "doc.day7.x01.update", "note": "範例：採用補件。" },
      { "id": "hold", "label": "範例：送待查", "archiveCode": "0701", "destination": "review", "basisDocumentId": "doc.day7.x01.form", "note": "範例：待確認。" }
    ]
  }
}
```

- `case-source` 文件的 `text` 只有 `heading` 與非空的 `fields`（`note` 除外）；每個欄位只有非空的 `label`／`value` 字串，順序即畫面順序，`label` 在同一文件內唯一（差異標記以 label 保存）。**`value` 一律是字串**，`"0701"` 不可寫成數字。
- `caseReview.id` 用 `case.` 前綴、含所屬日識別、全域唯一；`recordId` 必須在任務的 `recordIds` 內，同一筆紀錄最多一個案件。
- `sourceDocumentIds` 剛好兩份；`receiptVariants` 至少兩個，`id` 在案件內唯一且不含 `.`，文件互不重複、也不得與來源重疊。來源與變體文件都必須是 `case-source`、列在同一任務的 `documentIds`，且文件的 `recordIds` 包含案件紀錄。反過來，`case-source` 文件只能掛在引用它的任務上。
- `decisions` 非空；`id` 在案件內唯一且不含 `.`（`cond.case.*` 以最後一個 `.` 切開）；`label`、`archiveCode`、`note` 為非空字串；`destination` 只能是 `archive`（正式歸檔）或 `review`（窗口待查，與拒絕紀錄的資料覆核佇列無關）；`basisDocumentId` 必須是兩份來源之一，而且 **`archiveCode`（預填編號）必須是依據文件的某個欄位值**。這只是作者預設的一致性檢查：玩家提交時可改成任何非空字串，保存與後續工作都用玩家實際提交的編號。
- 案件畫面的共用字（說明、標記差異、處理方式、依據、註記、去向、可編輯編號 `codeInputLabel` 等）在 `ui.zh-Hant.json` 的 `caseReview`；處理方式不寫入或改動編號，R11 起也沒有帶入按鈕；系統作業紀錄窗的歷史切換在 `windowShell`，浮動視窗的最小化／最大化／還原／關閉／視窗列／文件群組標籤在 `windows`（「重設視窗位置」在桌面主選單 `desktop.menu.resetLayout`）。每日檔只放文件內容與決定文字。
- `bundle.ts`：`caseReviewOf(caseId)`（未知回傳 `undefined`，舊存檔不因此失效）、`caseReviewForRecord(taskId, 內容 ID 或存檔 key)`、`caseSourceDocument(docId)`、`ALL_CASE_REVIEWS`（附 taskId、dayId 與紀錄的存檔 key）。

### 退件稽核與錯誤文件處理（returnAudit／return-review）

reconcile 任務可以掛一個 `returnAudit`：第二輪逐筆審查**明確放行**、而提交編號與該筆保存的原始來源不一致的紀錄，會在通知日建立文件問題案件（只一次，由存檔保存）。案件跨日持續存在：每次退件回條都把它排入**下一工作日**的「錯誤文件處理」；重新送出只是「已重送／待核對」，要等下游在下一工作日核對、發出收件回條才結案（仍不一致就再次退回）；送窗口待查是「待窗口回覆」，同樣未解決。當天沒有到期案件時，錯誤文件處理不進入佇列，不會出現空工作。這些流程與保存都在狀態層；內容只提供稽核設定、每日位置與介面字。

正式資料是 Day 2 核對 Day 1 原批次，`day-02.json` 的 `task.day2.reconcile` 帶這個 `returnAudit`：

```json
{ "id": "day1-code-audit", "notifyDayId": "day.03", "reviewTaskId": "task.day4.return-review", "caseNumberTemplate": "RT-{key}" }
```

Day 3 通知、Day 4 為下一工作日，所以 `day-04.json` 定義了當天的錯誤文件處理任務（排在原歸檔之後）：

```json
{
  "id": "task.day4.return-review",
  "kind": "return-review",
  "auditId": "day1-code-audit",
  "recordIds": [],
  "documentIds": [],
  "text": { "eyebrow": "RETURN / REVIEW 04" }
}
```

`reviewTaskId` 與 `auditId` 只是作者參照，不決定處理對象，兩者都可以省略。最小寫法（其他日沒有內容定義時，狀態層以 `issueTaskId(n)` 插入虛擬任務，標題與 eyebrow 用 `ui.documentIssues`）：

```json
{ "id": "day1-code-audit", "notifyDayId": "day.03", "caseNumberTemplate": "RT-{key}" }
```

```json
{
  "id": "task.day4.return-review",
  "kind": "return-review",
  "recordIds": [],
  "documentIds": [],
  "text": { "eyebrow": "RETURN / REVIEW 04" }
}
```

- `returnAudit` 只允許 `id`、`notifyDayId`、`reviewTaskId`、`caseNumberTemplate`。`id` 全域唯一、只用小寫英數與 `-`（不得含 `.`）；`notifyDayId` 必須是存在的日，且**晚於**這個核對任務所屬的日。
- `caseNumberTemplate` 必填：文件問題清單與回條上的案號，`{key}` 代入紀錄的存檔 key（`RT-{key}` → `RT-B102`），只能且必須用 `{key}`；不同稽核不得共用同一個樣板（同一筆紀錄會撞號）。`text.ts` 的 `caseNumber(auditId, key)` 代入；稽核已不在內容中（舊存檔）時退回 key。
- `reviewTaskId` 可省略；有填時必須指向存在的 `return-review` 任務，而且那個任務位於**通知日的下一工作日**（通知日那一天的 `nextDayId`）——案件就是在那一天排入；通知日是最後一日時沒有下一工作日，不得填。那個任務若帶 `auditId`，必須等於這個稽核的 `id`。
- `return-review` 每天最多一項，`recordIds`／`documentIds` 必須是空陣列（處理對象是存檔排入當日的文件問題案件）。`auditId` 可省略；有填時必須是存在的稽核，而且該稽核的 `reviewTaskId` 指回這個任務（每個稽核最多對應一項）。`text` 只有 `eyebrow`；標題與說明共用 `ui.documentIssues` 的 `taskHeading`（「錯誤文件處理」）與 `taskInstruction`，單一案件的欄位與按鈕共用 `ui.returnedReview`（逐字取自 `doc/content/R10-return-review.json`，不改寫；`codeMismatch` 也是退件原因文字）。
- 文件問題案件的共用字（R12 起「文件問題」頁與 `workbench.nav.issues` 已移除，入口改為郵件；頁首、篩選、清單欄位、空狀態、未讀／待處理件數、下次處理日、退回次數與回條發出日等只供該頁的字也一併移除）：狀態（待修正、已重送／待核對、待窗口回覆、已解決）、送窗口待查的版本狀態（`next.windowWaiting`）、第幾次送件（`submissionTemplate` 代入 `{number}`）、來源工作（`sourceTaskTemplate` 代入 `{dayName}`／`{task}`）、附件文件的區段（原件／歷次修改／第二輪審查紀錄）、版本核對結果、回條（`returnedTemplate`／`resolvedTemplate` 代入 `{caseNumber}`、送件編號標籤、結案說明）、郵件閱讀窗的返回清單（`close`），以及當日工作的「開啟最新郵件／已處理」（`task.openMail`／`task.handled`）都在 `ui.documentIssues`（`DOCUMENT_ISSUES_UI_SHAPE`，嚴格 shape）。
- 通知訊息用 `cond.return.notified.<auditId>`（見上面「條件」）。核對畫面的逐筆審查字串在 `ui.recordReview`（「核對後放行／保留待查」與各筆狀態）；「確認收到摘要」不是放行。
- 提交的執行階段（已接收、格式檢查中、格式檢查通過、資料處理中、保存中、已保存／保存失敗、重試）在 `ui.operation`；「格式檢查通過」只代表結構與型別合法，不代表內容正確。
- `bundle.ts`：`returnReviewTask(taskId)`、`returnAuditOf(auditId)`、`caseNumberTemplateOf(auditId)`（未知皆回傳 `undefined`，舊存檔不因此失效）、`ALL_RETURN_AUDITS`（附核對任務、日別與被核對的批次）、`taskHeading(taskId)`／`issueTaskText(taskId)`（內容定義與虛擬的錯誤文件處理任務皆可）；`dayPlan()` 的 reconcile 項目在有稽核時帶 `returnAudit`，return-review 項目只在內容有填時帶 `auditId`。`schema.ts`：`issueTaskId(n)`／`parseIssueTaskId(id)`、`ISSUE_STATUSES`、`ISSUE_RECEIPT_KINDS`、`ISSUE_REASONS`。

## 郵件、入職與詢問說明包（R12）

三種內容包各放在自己的目錄，由 `data/manifest.ts` 的 `MAIL_SOURCES`／`ONBOARDING_SOURCE`／`HELP_SOURCES` 列出（新增包：加檔＋在 manifest 加一行，`bundle.ts` 不用改）。內容逐字取自 `doc/content/R12-*.json`。共同規則：

- 頂層欄位是**嚴格白名單**（`note` 另外允許），`schemaVersion` 必須是 `1`。
- `integration` 可省略；有填時只能是「字串或非空字串陣列」的說明物件。它是給實作與內容編輯的接線說明，**不會顯示給玩家**。
- 字串一樣不得夾帶程式碼；除了下面列出的專用規則，非 `*Template` 欄位不得出現 `{…}`。

### 郵件包（data/mail/，`ContentMailPack`）

```
id            "mail." 前綴；退件回條包固定為 mail.return-receipts（core 的 RETURN_RECEIPT_MAIL_PACK），內容一定要有
schemaVersion 1
sender        { id: "sender." 前綴, name }；只有顯示名稱，不虛構 email 地址
templates     剛好 returned／resolved 兩個（模板 ID＝回條種類 ISSUE_RECEIPT_KINDS），各為 { subject, lines[], attachmentLabel }
ui            郵件應用介面字（MAIL_UI_SHAPE，嚴格 shape）
integration   接線說明（不顯示）
```

- **郵件 placeholder**：`subject`、`lines`、`attachmentLabel` 只可用 `{caseNumber}`、`{versionLabel}`、`{reason}`（`schema.ts` 的 `MAIL_TEMPLATE_PLACEHOLDERS`），不要求每個都出現（收件模板沒有 `{reason}`）；其他名稱或 `{ caseNumber }` 之類的寫法會被擋下。代入用 `text.ts` 的 `renderMailTemplate(text, params)`：純字串取代、缺值代入空字串、不解析 HTML。
- `ui.revisionTemplate` 必須含 `{revision}`（登記在 `TEMPLATE_FIELDS`）；`mailVersionLabel(null)` 是 `ui.initialVersion`（原始送件），`mailVersionLabel(n)` 代入 `revision = n + 1`（底層版本 index 不變）。`mailReasonText('code-mismatch')` 取 `ui.codeMismatch`，`null` 回傳空字串。
- 郵件紀錄（存檔 `mailbox`）以 `packId`＋`templateId` 引用；`bundle.ts` 的 `mailPack(id)` 對未知包回傳 `undefined`（舊存檔不因此整頁失效），`MAIL_UI` 固定取退件回條包的 `ui`，`mailSenderName(packId)` 取寄件者名稱，收到日期用 `dayDateLabel(dayId)`（與訊息頁 `chatDateLabel` 同一份）。

### 入職前情包（data/onboarding/，`ContentOnboarding`）

```
id            "onboarding." 前綴
schemaVersion 1
presentation  { background, foreground：#rrggbb；characterIntervalMs：正整數；
                advance："reveal-current-then-next"；reducedMotion："show-current-step" }
steps         依序呈現：{ id, kind: "line", text } 或
              { id, kind: "contract", heading, clauses[], footer, signature }
ui            { continue, reveal, signing, saveFailed, retry, loggingIn, legacyPlayerName }（嚴格 shape）
```

- 段落 `id` 在包內唯一、只用小寫英數與 `-`；**剛好一個 `contract`，且不是第一段或最後一段**（簽名前要有前情、簽名後要有歡迎段落）。存檔 `onboarding.step` 就是 `steps` 的 index；`bundle.ts` 的 `onboardingContractIndex` 是合約的 index。
- `signature` 只有 `label`、`placeholder`、`submit`、`required`、`tooLong` 與 `maxGraphemes`；`maxGraphemes` 必須等於 core 的 `PLAYER_NAME_MAX`（24，以使用者可見字元計）。
- `ui.loggingIn` 必須且只能用 `{playerName}`（`onboardingLoggingIn(name)` 代入）；`ui.legacyPlayerName` 是舊存檔沒有姓名時的顯示名（`bundle.ts` 的 `LEGACY_PLAYER_NAME`）。

### 詢問說明包（data/help/，`ContentHelpPack`）

```
id            "help." 前綴
schemaVersion 1
request       { id: "request." 前綴, channelId: 既有的 direct 頻道,
                unlockCondition: 自己的 cond.help.<id 去掉 request.>.requested, playerText, oncePerSave: true }
ui            { ask, revisit }（嚴格 shape；helpUi(requestId)）
messages      非空；ContentMessage／replyPrompt 格式
integration   接線說明（不顯示）
```

- 說明訊息與每日訊息走**同一套檢查**（ID、頻道與人物存在、`HH:MM`、`visibleFrom` 是存在的日、條件白名單、`replyPrompt` 的 ID／選項／回應者、`availableThrough` 是存在的日），另外要求：在提問頻道、作者是該頻道成員、`unlock` 包含提問條件、訊息／prompt／回應 ID 含 `help` 識別（取代每日檔的 `dayN`），欄位只允許 ContentMessage 的欄位。
- 說明訊息加入 `bundle.ts` 的 `ALL_MESSAGES`／`messagesOfChannel`／`contentMessage`，prompt 加入 `ALL_PROMPTS`／`promptOf`／`promptsOfChannel`，排在**同一 `visibleFrom` 的每日訊息之後**；因此既有的解鎖、未讀與固定回覆邏輯直接適用。`visibleFrom` 只決定從哪天起可以問；時間軸上的實際位置由狀態層保存的提問日與送達時間決定（`helpRequestOfMessage(messageId)` 可判斷一則訊息是否錨定在提問上）。
- 其他查詢：`helpRequestOf(requestId)`、`helpMessages(requestId)`（送達順序）、`helpPackOf(requestId)`；未知提問回傳 `undefined`／空陣列。

## 轉場

`transition.text` 的形狀由該日的 `nextDayId` 決定：

- 有下一日 → 日結轉場（`WRAP_TRANSITION_TEXT_SHAPE`：`docTitle`、`eyebrow`、`heading`、`body`、`backToCover`）。
- `nextDayId: null` → 結束轉場（`END_TRANSITION_TEXT_SHAPE`：`docTitle`、`eyebrow`、`heading`、`body`、`summary`、`thanks`、`outro`、`backToCover`）。結束轉場是 **task-neutral**：不依任何任務的結果分支；舊的 `outcome` 已移除，殘留會被擋下。

兩種形狀都是嚴格的：日結轉場多了 `summary`／`thanks`／`outro` 會被指出；舊的 `countLabel`／`next` 殘留在任一種轉場也會被指出。

日結頁「本日交接」逐項列出當日工作（業務動詞＋實際筆數／列數＋完成標記），總數標成「項工作」；這些共用字與「結束今日，查看明日收件」按鈕在 `ui.handoff`（`itemTemplate`：`{kind} {count} {unit}`、`totalTemplate`：`{count}`）。跨日後的次日收件在 `ui.morning`（問候沿用該日 `workbench.greeting`）；工作頁右欄的唯讀系統作業紀錄在 `ui.executionLog`（指令名與 JSON 鍵名也是資料；資料去向與空白處理沿用 `ui.archive`／`ui.fieldMap` 的字，由 `text.ts` 的 `EXECUTION_LOG_UI` 組合）。

封面「本機紀錄」的進度文字來自 `ui.progressLabel` 的 `workTemplate`／`wrapTemplate`／`morningTemplate`／`endTemplate`（`{dayName}` 取 `workbench.dayName`），由 `text.ts` 的 `progressLabel(dayNumber, stage, lastDayNumber)` 產生。

## 新增一天

四個步驟，缺一個都會被擋下（manifest 漏加則該日不存在，前一日的 `nextDayId` 會找不到日別）：

1. 新增 `data/days/day-07.json`（下面的範例；記得填 `chatDateLabel`）。
2. 在 `data/manifest.ts` 加一行 import，並在 `DAY_SOURCES` 依日序加 `{ file: 'data/days/day-07.json', data: day07 }`。`bundle.ts` 不需要改。
3. 把前一日（目前是 `day-06.json`）的 `nextDayId` 從 `null` 改成 `"day.07"`，並把它的 `transition.text` 從結束轉場換成日結轉場的形狀，例如：

   ```json
   {
     "docTitle": "範例：第六日交接完成",
     "eyebrow": "DAY / 06 — COMPLETE",
     "heading": "範例：本日匯入已完成。",
     "body": "範例：今日資料已完成交接。",
     "backToCover": "範例：返回開始頁"
   }
   ```

   忘了換會被擋下：`data/days/day-06.json [transition.day6.end] transition.text.summary：不在此區塊 shape 內的欄位：日結轉場沒有 summary…`（`thanks`／`outro` 同樣是多餘欄位）。
4. 在 `data/ui.zh-Hant.json` 的 `workbench.dayName` 加 `"7": "七"`。

範例 `day-07.json`（全部文字都是「範例」佔位，不是正式內容；`readme-examples.spec.ts` 會把同一份 JSON 餵進 `validateContent()` 確認通過）。archive 任務只需要三欄日別文字，共同介面字已在 `ui.archive`：

```json
{
  "id": "day.07",
  "day": 7,
  "nextDayId": null,
  "chatDateLabel": "範例：9 月 23 日",
  "workbench": { "greeting": "範例：第七日問候。", "workHeading": "範例：今日工作" },
  "aside": { "heading": "範例：側欄標題", "body": "範例：側欄說明。" },
  "records": [
    { "id": "record.day7-x01", "key": "X01", "name": null, "code": "0701", "refusal": null, "refusalApplies": true }
  ],
  "documents": [],
  "tasks": [
    {
      "id": "task.day7.archive",
      "kind": "archive",
      "batchId": "batch.day07.archive",
      "recordIds": ["record.day7-x01"],
      "documentIds": [],
      "text": {
        "eyebrow": "ARCHIVE / BATCH 07",
        "heading": "範例：任務標題",
        "instruction": "範例：任務說明。"
      }
    }
  ],
  "messages": [
    {
      "id": "msg.day7.example",
      "channelId": "channel.department.data-ops",
      "actorId": "actor.lin-yuan",
      "time": "09:15",
      "visibleFrom": "day.07",
      "unlock": [],
      "lines": ["範例：第七日訊息。"]
    }
  ],
  "transition": {
    "id": "transition.day7.end",
    "text": {
      "docTitle": "範例：結束",
      "eyebrow": "DAY / 07 — COMPLETE",
      "heading": "範例：結束標題",
      "body": "範例：結束內文。",
      "summary": "範例：摘要",
      "thanks": "範例：感謝",
      "outro": "範例：結語",
      "backToCover": "範例：返回開始頁"
    }
  }
}
```

要做欄位映射日，把 `tasks` 換成上面「field-map 任務」的範例即可（spec 也會驗）。

改 README 範例時同步改 `readme-examples.spec.ts` 裡的同一份 JSON。

## 新增頻道

在 `data/channels.json` 的 `channels` 加一筆。`kind` 只能是 `department`（部門大群）、`group`（同事小圈圈）或 `direct`（個人訊息）。

```json
{ "id": "channel.group.example", "kind": "group", "title": "範例：頻道名稱", "topic": "範例：頻道說明", "actorIds": ["actor.lin-yuan"] }
```

- `department` 與 `group` 必須有非空的 `title` 與 `topic`（topic 顯示在對話 header）。
- `direct` 不填 `title`、`topic`（header 顯示對方的 `displayName` 與狀態），且 `actorIds` 剛好一位。
- `actorIds` 是主角以外的參與者；固定回覆的回應者必須在 anchor 頻道的 `actorIds` 內。

新角色要先在 `data/actors.json` 建立；**未命名的角色不可以在資料檔裡被命名。**

## 引用

- 紀錄只在「第一次出現的那一天」定義，之後幾天用 `recordIds` 引用，不要複製一份。
- 文件用 `documentIds` 掛在任務上，文件自己用 `recordIds`（非空）指出引用了哪些紀錄。
- `reconcile` 任務的 `sourceBatchId` 指向某個 `archive` 任務的 `batchId`；`subjectRecordId` 指向它 `recordIds` 內的一筆。
- `cond.review.*` 條件指向某個 `archive` 任務的 `batchId`，且批次所屬日早於訊息的 `visibleFrom`。
- `cond.chat.*` 條件指向存在的 prompt 與 choice，prompt 的 anchor 不晚於訊息的 `visibleFrom`。
- `cond.case.*` 條件指向存在的案件與決定，案件所屬日早於訊息的 `visibleFrom`。
- `caseReview` 引用任務內的紀錄與 `case-source` 文件（見「比對案件」）。
- `returnAudit.notifyDayId` 指向晚於核對日的日；`returnAudit.reviewTaskId`（可省略）指向通知日下一工作日的 `return-review` 任務（該任務的 `auditId` 若有填須相同）；`return-review` 的 `auditId`（可省略）指回定義它、且 `reviewTaskId` 指回這項任務的稽核。
- `cond.return.notified.*` 條件指向存在的稽核，稽核的通知日不晚於訊息的 `visibleFrom`。
- `replyPrompt.availableThrough` 指向存在的 day ID，且不早於 anchor 的 `visibleFrom`。
- 詢問說明包的 `request.channelId` 指向既有的 direct 頻道；說明訊息在同一頻道；`cond.help.*` 指向存在的提問，且只用在該提問自己的說明訊息。
- 郵件紀錄的 `packId` 指向 `data/mail` 的郵件包（退件回條包 `mail.return-receipts` 一定存在）。
- 訊息的 `visibleFrom` 與每日的 `nextDayId` 指向存在的 day ID。
- 引用不存在的 ID 會被驗證擋下，並指出來源檔與內容 ID。

## 代入數值的樣板

欄位名以 `Template` 結尾，內容用 `{name}` 佔位，純字串取代，不做運算：

```json
"progressTemplate": "{count} / {total} 已處理"
```

每日檔也可能有樣板欄位（例如 `returnAudit.caseNumberTemplate` 只用 `{key}`）。R12 的 `ui.desktop.openAppTemplate`（`{app}`）、`mailUnreadTemplate`（`{count}`）與郵件包的 `ui.revisionTemplate`（`{revision}`）同樣登記在 `TEMPLATE_FIELDS`；郵件模板與入職 `ui.loggingIn` 不是 `*Template` 欄位，另有專用規則（見上面「郵件、入職與詢問說明包」）。每個樣板欄位允許哪些 placeholder，登記在 `schema.ts` 的 `TEMPLATE_FIELDS`；用了未登記的名稱或漏掉必要的 placeholder 都會被擋下。非樣板欄位不可以出現 `{}`。同名欄位需要不同 placeholder 時，以完整路徑登記（例如 `morning.docTitleTemplate` 只用 `{dayName}`，`workbench.docTitleTemplate` 仍需 `{dayName}` 與 `{view}`）。

## 驗證

```bash
npx ng test --watch=false --browsers=ChromeHeadless
```

`validate-content.spec.ts` 會對正式資料執行 `validateContent()`，並用「改壞一處」的反例確認每一種錯誤都被指出：重複 ID、不存在的引用、未知／已停用的條件 ID、缺少欄位、多餘欄位（每日檔帶入共同字串、結束轉場殘留 `outcome`）、錯誤巢狀型別、缺少回覆選項、錯誤 placeholder、day 數字與 ID 不一致、內容 ID 缺日識別、`nextDayId`／`visibleFrom` 指向不存在的日、task 缺 `batchId`／`sourceBatchId`／`subjectRecordId`、每日零個 task、同日或跨日重複的 task／batch ID、field-map 的欄位對應與資料列錯誤、`cond.review.*` 指向未知或不早於 visibleFrom 的批次、`replyPrompt` 的 ID／選項／回應錯誤（前綴、重複、空文字、`HH:MM`、回應者不是頻道成員、`availableThrough` 早於 visibleFrom）、`cond.chat.*` 指向未知 prompt／choice 或順序不對、`unlockAfter` 的批次不存在／筆數不是正整數或超過批次／批次晚於 visibleFrom、頻道 `topic` 缺漏或多填、`chatDateLabel` 缺漏或空白、報告文件缺 `versionNeutral`、同日 reconcile 排在它的來源 archive 之前、`case-source` 文件的 fields 空白／值寫成數字／label 重複／多餘鍵、`caseReview` 的文件不存在／不是 case-source／不在 documentIds／recordIds 不含案件紀錄、recordId 不在任務內或被兩個案件使用、決定／變體 ID 重複或含 `.`、依據不是來源、變體與來源重疊、去向不在白名單、預填 archiveCode 不是依據文件的值、`cond.case.*` 指向未知案件／決定或不早於 visibleFrom、ui 的 `caseReview`／`windowShell` 缺欄位、`returnAudit` 的通知日不晚於核對日／`caseNumberTemplate` 缺漏、placeholder 錯誤或與其他稽核重複／`reviewTaskId`（有填時）不存在、不是 return-review、不在通知日的下一工作日、通知日已是最後一日、auditId 不一致／稽核 ID 重複或含 `.`、return-review 的 `recordIds`／`documentIds` 非空、同日第二項 return-review、`auditId`（有填時）型別錯誤或引用未知稽核／稽核沒有指回／同一稽核有第二項複審、其他 kind 使用保留的 `task.day<N>.return-review`、`cond.return.notified.*` 指向未知稽核或訊息早於通知日、ui 的 `operation`／`windows`／`recordReview`／`returnedReview`／`fieldMap.convertError`／`workbench.nav.issues`／`documentIssues` 缺欄位、多餘欄位或 placeholder 錯誤、ui 殘留已移除的欄位（`fieldMap.valueTrue`、`archive.finishDay`、`archive.useCode`、`caseReview.useDocumentTemplate`、轉場的 `countLabel`／`next`、`dialog.finish` 等）、ui 的 `tasks`／`handoff`／`morning`／`executionLog` 缺欄位、夾帶程式碼；R12 的 ui `desktop` 缺欄位／多餘欄位／placeholder 錯誤、`workbench` 殘留 `navGroupPersonal`／`navGroupTeam`／`nav.issues`／`role`／`backToCover`／`heading.messages` 或缺 `nav.mail`／`team`／`identityLabel`、`messages.newBelow`、`documentIssues.task`，郵件包的模板 placeholder／缺少或多出模板／多餘欄位／`revisionTemplate` 缺 `{revision}`／schemaVersion／寄件者前綴與名稱不一致／integration 型別／缺少退件回條包，入職包的色碼／逐字間隔／推進方式／段落 ID／合約數量與位置／簽名上限與欄位／`loggingIn` placeholder，詢問說明包的提問頻道不是 direct／條件不是自己的／oncePerSave／說明訊息不在提問頻道、作者不是成員、unlock 缺提問條件、ID 缺 `help` 識別、replyPrompt 錯誤，以及 `cond.help.*` 指向未知提問或被每日訊息／別的提問引用。錯誤訊息格式：

```
data/days/day-02.json [task.day2.reconcile] tasks[0].text.dialog.response.ask：缺少必要欄位或型別錯誤：需要 string，得到 undefined
```

`bundle.spec.ts` 以頻道 API 逐字驗證訊息文案、跨日歷史、Day 4 互斥訊息、固定回覆（`promptOf`／`promptsOfChannel`）、Day 3 午餐回覆解鎖的私訊與午餐群組的工作進度解鎖、Day 3 比對案件（`caseReviewOf`／`caseReviewForRecord`／`caseSourceDocument`）與 Day 4 依案件決定互斥的林予安私訊、Day 3 退件通知（`returnNotified` 為真才解鎖，之後留在歷史）與 Day 4 錯誤文件處理任務（`returnReviewTask`／`returnAuditOf`／`caseNumberTemplateOf`，以及虛擬任務 `issueTaskId(n)` 的 `issueTaskText`），以及 Day 1／2 的有序多工作，並逐字驗 Day 3–6 的紀錄、欄位映射與轉場；`text.spec.ts` 驗畫面文案產生器（含 `taskHeading`、R10 的 operation／windows／recordReview／returnedReview，與 R11 的 `DOCUMENT_ISSUES_UI` 及其案號、狀態、送件次序、回條格式器），以及 Day 1 歸檔文字搬到 `ui.archive` 後逐字不變（R11 只移除 `useCode`）；R12 另驗郵件包／入職包／詢問說明包的載入與查詢（`mailPack`、`onboardingContractIndex`、`helpMessages`／`helpRequestOfMessage`、說明訊息只在提問後解鎖且排在同日每日訊息之後、`helpConditionId`／`parseHelpCondition`），以及 `DESKTOP_UI`、`WORKBENCH` 單組導航、`renderMailTemplate`／`mailVersionLabel`／`mailReasonText`、`onboardingLoggingIn`、`helpUi`。失敗代表文字被改到了。
