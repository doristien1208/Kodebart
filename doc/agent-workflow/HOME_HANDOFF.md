# 回家接續：KodeBart 進度與 Codex Action 設定

狀態快照：2026-10-13 14:10（台北）。這不是即時監控頁；之後以原 Issue、PR、固定 head 與原始 CI 證據為準。

## 先讀這份，再讀設定指南

[Codex 訂閱認證完整設定流程](CODEX_SUBSCRIPTION_SETUP.md)包含前置條件、runner／憑證保存、事件覆核、同案回修、驗證與恢復方法。它是研究提案，**尚未啟用**。

此次 Human 只授權同步指南與本摘要；沒有改 private、登入、secrets、權限、遊戲程式，也沒有新派發或重新執行 Action。不公開整段本機聊天，不上傳任何憑證。

## 已確認的工作方式

- 開發預設在 GitHub Action，Claude 負責工程、Codex 負責完整里程碑企劃／內容／UI 目標與覆核。
- Issue 代表可明顯感受到變化的遊戲進度，同案必要修正沿用原 Issue／PR／branch，不拆一串小 Issue。
- Human 本機只保留原本那份專案，試玩只 pull main，不要求猜分支或再建 worktree。
- 完整交付、固定 SHA CI 與 Codex 覆核通過後，在既有 Human 委任範圍整合 main，commit 註明試玩版，再通知 Human。
- 合併不代表 Human 已認可玩法；approved 仍屬 Human。舊排程保持暫停，新的 Codex 事件接力尚未設定。

詳細現行規則：[運作模型](OPERATING_MODEL.md)、[工作流程](WORKFLOW_RULES.md)、[角色權限](AGENT_ROLES.md)。部分文件包含過往起點，部署與完成狀態必須核對下列 GitHub 證據。

## 遊戲與流程目前到哪裡

### main：流程 v1.2 已整合，但不是新的 M1.1 試玩版

- main 查核 SHA：`2c3d69085e4e890296ec10b557ae011b50d72407`。
- [PR #8](https://github.com/doristien1208/Kodebart/pull/8)已合併，提供固定 PR/head 手動續做與固定 SHA 驗證等流程。
- [Issue #5](https://github.com/doristien1208/Kodebart/issues/5)的完整端到端驗收仍需依實際執行問題覆核；不能因已合併就宣稱所有接線已通過。

本次文件同步會新增文件 commit；那不是遊戲試玩版，不改這個產品狀態。

### M1.1：第3–6日完整工作循環，成果保存、尚未合併

- 任務：[Issue #9](https://github.com/doristien1208/Kodebart/issues/9)。
- 成果：[draft PR #10](https://github.com/doristien1208/Kodebart/pull/10)，目前 open、未合併。
- 工作分支：`claude/issue-9-m1`；這是工程成果位置，不是目前交付 Human 的試玩分支。
- 本輪起點：`ef1aa7b794bb79f434dbf60dc8c3c2151da43d92`。
- 查核 PR head：`468abb0596a7396c45597699153d41851c1b0bbc`。
- [Action run 38344873002](https://github.com/doristien1208/Kodebart/actions/runs/38344873002)已結束，Claude 模型步驟 failure；不是仍在執行。

里程碑目標包含 Day3–6 混合歸檔／附件／批次工作、文件視窗、聊天與跨日回聲，以及五項必要回修：當日不自動揭示錯附件答案、來源／採用／輸出語意區分、busy／交易與重試保護、改寫高亮基準、初始 bundle 警告處理。不新增 Day7–10 或提前揭露 0102 因果。

本次直接查到的證據與限制：

- GitHub job metadata 顯示產品 CI 的 npm ci、app/spec 型別檢查、零警告 production build、測試都 success。
- [收尾留言](https://github.com/doristien1208/Kodebart/issues/9#issuecomment-6138216792)將同一固定 head 的檢查列為 PASS，但仍標 blocked。
- 該留言記錄 115 turns 超過 80，以及把既有 `claude/issue-9-m1` 誤當成首次入口預期分支來判定的衝突；這是待調查現象，尚未完成根因／修正覆核。
- 最新 head 的程式 diff、完成標記與完整原始 CI log 尚未在本次文件同步任務逐項覆核；不因 job 綠燈宣稱全部 R1–R5 已完成。
- PR #10 確實存在；收尾留言「沒有建立 PR／沒有回收分支」不等於成果不存在，後續需核對實作與原始 run 紀錄。
- 不直接重跑這個失敗 run，不提高回合限制，不轉本機重寫，也不先合併 checkpoint。

**下一個工程動作**是沿 Issue #9／PR #10／固定 head 覆核成果與收尾問題，必要修正在同案安排；不是新開產品階段。這份摘要沒有派發該動作。

## 回家後需要決定什麼

1. 是否將 repository 改 private。目前仍為 public，官方帳號認證 CI 方案不適用公開／開源 repository。
2. 是否採 GitHub-hosted runner＋可讀寫安全儲存（優先提案）；儲存服務、費用與權限仍待選。
3. 完成 CI 專用 ChatGPT 登入；憑證只走安全設定管道，不貼在聊天、Issue 或 PR。
4. 選 Codex 覆核模型與限制，以及 bot 同案回修／main 整合的授權邊界。
5. 選完成／重要失敗通知目的地；不能假設 GitHub 回報會自動喚醒這個本機 Work。

設定順序：認證短回覆測試 → 固定 PR 唯讀覆核 → Claude 完成事件接線 → 有限同案回修 → 符合 gate 的整合與通知。完整清單見設定指南；以上是待實作，不是已運作。

## 在家開新 session 的最短交接

請它先讀本摘要、設定指南與現行運作規則，再查原 Issue #9、最新 Claude 回報、PR #10 固定 head、diff 與原始 CI 證據。保留所有既有成果；只在明示授權後處理認證／權限或派發。不要因讀到文件就啟動排程、重跑 Action、改遊戲、merge checkpoint 或建立第二份本機專案。

Human 試玩時只使用 main；目前尚未宣布 M1.1 可試玩。新版本整合完成後通知應列明版號、main SHA、PR、更新重點、已驗與未確認項目，以及備份舊存檔的方法。
