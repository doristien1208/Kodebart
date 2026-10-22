# KodeBart 運作模型：模組里程碑、分項 Issue、Action 優先

更新：2026-10-21。Human 最新指示取代「一張 Issue 必須完成整個章節／里程碑」；其餘執行權限、80 回合／60 分鐘、原始驗證與合併保護不變。本文是派工與審查政策，不宣稱改好了 Action 程式。

## 1. 交付單位

- 一個 milestone 完善一個功能模組，定義玩家能力、UI、資料契約、關聯入口與排除項。日數只是故事節奏。
- 一件可獨立完成與覆核的工作是一張 Issue；分成實作、UI、必要串接、測試。不能把所有模組或整章塞進單案，也不為一個字串機械拆單。
- Codex 先定主企劃與依賴、提供完整內容，再派 Claude。各工作以 30–50 回合量級估算，留保存／回報餘量；不得把預估當實際保證。
- 每件目標在一次最多 80 回合／60 分鐘的執行內完成。現行程式按一次模型 run 限制，沒有 Issue 累計回合強制器。未完成先 checkpoint；Codex 重估範圍與原因，不無限 resume 洗掉工作量。
- 測試另有 Issue，寫明待驗版本與情境。實作案仍需可編譯、必要局部回歸及既有模型外 CI；不是寫完未驗程式就算通過。
- 同時只推一個產品模組；以序列依賴為預設，每張完成先由 Codex 覆核才交下一件。工程阻礙另列，不混入產品實作。

## 2. 分工與唯一專案

Codex 負責企劃、內容、UI 目標、Issue、原碼／證據覆核及 Human 委任內整合；不寫遊戲程式，不冒充 Human approved。Claude 在 Action 實作與回報，不推 main、merge、close 或自動啟動下一案。Human 決定創作方向、必要例外與操作試玩。

公司唯一本機專案維持 main：`/Users/doris.tien/Documents/03_Highly_Confidentail/kodebart_webGame`。Windows 也只維持一份正常專案；不新增 worktree／clone 供覆核或要求 Human 切成果分支。各 Issue 的遠端分支與 Action runner 不算第二份本機專案。

本機 Claude 只在 Human 另行指定的必要例外使用；回合不足不構成自動改本機的理由。不得清除／覆蓋 Human 或 Claude 的未提交檔。

## 3. Issue、分支與固定來源

每張 Issue 記錄 milestone、工作代碼、依賴及其覆核／整合 SHA、允許路徑、輸入輸出、完成條件、測試責任、回合預算與停止條件。初次入口仍是既有 claude-ready；同案修正仍走原 Issue／PR／branch／40 碼 head 的 resume，不重加 ready，不重跑舊失敗。

新 Issue 不可冒用舊 Issue 的分支或改 trailer 逃過 guard。預設前案完成且安全整合 main，再由新案從固定 main 開分支；若前案不能安全獨立合併，先調整依賴與交付邊界，不發明跨 Issue 共用分支入口。未合併舊成果只能在新案明示固定來源與最小回收範圍、經覆核後使用，不能當已驗收依賴。

派發前重查同案 active／queued、Issue／PR 狀態、Human-only 標籤、head 一致。保存格式與既有 guard 依 TASK_CONTRACT／WORKFLOW_RULES；本次不修改可執行流程或限制。

## 4. 每張覆核與模組發布

1. Claude 交固定 SHA、diff、Completed／Remaining、實際局部驗證與停止原因。
2. 模型外 CI 對該 SHA 跑既有必跑檢查，保存原始 log／exit。模型不輪詢 CI。
3. Codex 讀程式、資料與證據，不只信 success 標籤；失敗回原實作案修。測試 Issue 不偷偷改 production 或放寬斷言。
4. 完整 Issue 可在同 SHA CI 與覆核通過、無已知回歸且不暴露半成品時，由受委任 Codex 合併 main。這是工程整合，不自稱模組試玩版；main 既有遊戲須仍可用。測試案仍未完成時不得宣稱模組已通過。
5. 模組全部工作與測試案完成，再核整合 SHA、可達入口、舊檔與已知問題，標 `playtest(<模組代碼>)` 並通知一次。不同 SHA 不沿用舊綠燈；保護要求不降低。
6. Human 只 pull main。通知列玩法／故事／UI／美術／修正、與前版差異、試玩重點、版本／完整 SHA／PR、已過與未確認驗證、先備份 localStorage。merge 不等於 Human approved。

同案具體回修仍在原 Issue；若工作量已超出一個有界工作，Codex 明確拆後續工作與未完成狀態，不能把未完成案標 completed。不要以每個工程 commit 要求 Human 試玩。

## 5. 現況與阻礙

當前主企劃 §9 定義 FOLDER-1，後續為 PACKET-1、CHAT-1、BROWSER-1、STORY-1。#11／PR #12 的 b781e36 保留為舊 M2 成果來源；新拆單不是原四日全部完成，也不授權整批合併。

A1 的 83 turns、7 次未公開細節的拒絕、沒有新 commit，以及 finalize 分支判定問題，仍須另行診斷。80 的不同計數口徑不能憑摘要認定相同或忽略既有失敗；不能假稱拆單已修復執行器。未經另行授權，不改 workflow／認證／模型／限制／權限／secrets，不藉此復活 #5。

本機 monitor `kodebart-claude` 已按 Human 要求於 2026-10-19 刪除，不重新建立。GitHub 回報不會自動喚醒本機聊天；沒有已運行的 Codex Action 可宣稱接手。跨裝置狀態見 HOME_HANDOFF。
