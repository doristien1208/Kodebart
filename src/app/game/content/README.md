# 內容格式說明

這是 `src/app/game/content/` 的資料格式說明。協作流程、任務與驗收一律看 `doc/COLLABORATION.md`，這裡不重複。

玩家看得到的文字全部在 `data/` 的 JSON；TypeScript 只放型別、白名單、載入轉換與規則。

```
data/ui.zh-Hant.json      通用介面字串（封面、工作台外殼、對話框、來源卡、狀態提示）
data/actors.json          人物
data/channels.json        訊息頻道
data/bulletins.json       公司公告
data/days/day-NN.json     每日：工作台標題、來源紀錄、文件、任務、訊息、當日結束轉場
documents/                長篇正文（Markdown）；目前沒有這種內容，公告等級的短文留在 JSON
```

TypeScript：`schema.ts`（型別與白名單）、`conditions.ts`（條件與動作 ID）、`format.ts`（樣板代入）、`bundle.ts`（載入與查詢）、`records.ts`／`text.ts`（給元件的 API）、`validate-content.ts`（驗證）。

## ID 規則

每一種內容都有穩定、具命名空間的 ID，彼此以 ID 互相引用，不得用顯示文字、陣列索引或姓名當識別。

| 種類 | 前綴 | 例 |
|---|---|---|
| 人物 | `actor.` | `actor.lin-yuan` |
| 頻道 | `channel.` | `channel.dm.lin-yuan` |
| 訊息 | `msg.` | `msg.day1.welcome` |
| 紀錄 | `record.` | `record.b102` |
| 文件 | `doc.` | `doc.day2.summary` |
| 每日 | `day.` | `day.01` |
| 任務 | `task.` | `task.day1.archive` |
| 公告 | `bulletin.` | `bulletin.welcome` |
| 轉場 | `transition.` | `transition.day1.overnight` |

ID 只能用小寫英數、`-` 與 `.`，且全域唯一（改過的 ID 等於換了一筆內容，不要重複使用舊 ID）。

紀錄另有 `key`（例如 `B102`）作為存檔識別。**`key` 改了會讓既有存檔失效，不要改。**

**編號一律是字串。** `"code": "0102"` 正確，`"code": 102` 會被驗證擋下——JSON 的數字會吃掉前導零。

## 新增訊息

在該天的 `data/days/day-NN.json` 的 `messages` 加一筆：

```json
{
  "id": "msg.day3.example",
  "channelId": "channel.dm.lin-yuan",
  "actorId": "actor.lin-yuan",
  "time": "09:15",
  "unlock": ["cond.day.3"],
  "lines": ["第一段。", "第二段。"]
}
```

- `channelId`、`actorId` 必須指到已存在的頻道與人物。
- `lines` 每個元素是一段，不得為空。
- 同一時間點要在幾種結果中擇一顯示時，加 `variant`：

```json
"variant": { "key": "night.smallTalkVariant", "value": 0 }
```

同一頻道、同一 `key` 的 `value` 不可重複；`key` 的白名單在 `schema.ts` 的 `VARIANT_KEYS`。

## 新增頻道

在 `data/channels.json` 的 `channels` 加一筆。`kind` 只能是 `department`（部門大群）、`group`（同事小圈圈）或 `direct`（個人訊息）。

```json
{ "id": "channel.group.example", "kind": "group", "title": "頻道名稱", "actorIds": ["actor.lin-yuan"] }
```

- `direct` 不填 `title`（標題取自對方的 `displayName`），且 `actorIds` 剛好一位。
- `department` 與 `group` 必須有 `title`。
- `actorIds` 是主角以外的參與者。

新角色要先在 `data/actors.json` 建立；**未命名的角色不可以在資料檔裡被命名。**

## 新增每日任務

在 `data/days/day-NN.json` 的 `tasks` 加一筆：

```json
{
  "id": "task.day3.example",
  "kind": "archive",
  "recordIds": ["record.x01"],
  "documentIds": [],
  "text": { "heading": "…" }
}
```

`kind` 白名單在 `schema.ts` 的 `TASK_KINDS`；新增玩法時要同時在規則層實作，資料檔不描述行為。

`text` 的欄位由使用它的畫面決定；若要代入數值，欄位名以 `Template` 結尾（見下）。

新的一天：複製一份 `day-NN.json`，`id` 用 `day.NN`、`day` 用數字，並在 `bundle.ts` 的匯入清單加上該檔。

## 引用

- 紀錄只在「第一次出現的那一天」定義，之後幾天用 `recordIds` 引用，不要複製一份。
- 文件用 `documentIds` 掛在任務上，文件自己用 `recordIds` 指出引用了哪些紀錄。
- 引用不存在的 ID 會被驗證擋下，並指出來源檔與內容 ID。

> 上面的 `cond.day.3` 只是示意。條件 ID 是白名單制，`CONDITION_IDS` 目前只到 `cond.day.2`；用到還沒登錄的 ID 會被 `validateContent()` 擋下，要先依下一節加進白名單與 `evaluateCondition()`。

## 條件

`unlock` 是條件 ID 的陣列，**全部成立**才解鎖。可用的 ID 在 `conditions.ts` 的 `CONDITION_IDS`：

| 條件 | 意思 |
|---|---|
| `cond.always` | 無條件 |
| `cond.day.N` | 目前是第 N 天 |
| `cond.phase.X` | 目前在 `day1`／`overnight`／`day2`／`end` |
| `cond.night.smalltalk.N` | 夜間閒聊版本 N（由存檔決定，重看不重抽） |

需要新條件時，在 `CONDITION_IDS` 加 ID 並在 `evaluateCondition()` 實作。動作同理，白名單是 `ACTION_IDS`。

**資料檔不得寫程式。** 不可以出現 `${…}`、箭頭函式、`function`、`eval` 或任何運算式；所有判斷都以 ID 交給 TypeScript。

## 代入數值的樣板

欄位名以 `Template` 結尾，內容用 `{name}` 佔位，純字串取代，不做運算：

```json
"progressTemplate": "{count} / {total} 已處理"
```

每個樣板欄位允許哪些 placeholder，登記在 `schema.ts` 的 `TEMPLATE_FIELDS`。非樣板欄位不可以出現 `{}`。

## 驗證

```bash
npx ng test --watch=false --browsers=ChromeHeadless
```

`validate-content.spec.ts` 會對正式資料執行 `validateContent()`，檢查重複 ID、不存在的引用、未知條件／動作 ID、缺少欄位、錯誤型別、ID 命名與夾帶程式碼。錯誤訊息格式：

```
data/days/day-01.json [msg.day1.welcome] unlock[0]：未知的條件 ID cond.day.9（白名單見 content/conditions.ts）
```

改文案時 `text.spec.ts` 也會跟著跑：它驗的是既有文案，失敗代表文字被改到了。
