# KodeBart 執行與試玩流程：Action 優先、單一本機專案

Human 確認日期：2026-10-13。
本文件記錄 Human 在 KodeBart Work 的最新決定；優先於舊的本機 M1 交辦及「必須等 Human 試玩才可合併」安排。**這是已確認的運作需求，不代表下列自動化入口已實作或部署。**

## 1. 唯一專案與分工

- Repository：doristien1208/Kodebart。
- Human 的唯一本機專案：`/Users/doris.tien/Documents/03_Highly_Confidentail/kodebart_webGame`。維持 `main` 供 pull、檢查與試玩。
- 不再建立給 Human 的 clone、worktree、暫存遊戲 checkout，或要求 Human 切換工作分支試玩。GitHub 遠端的里程碑工作分支、PR與Action runner checkout不是第二個本機專案。
- Codex：企劃、故事與內容資料、UI目標、Issue／驗收契約、源碼與驗證證據覆核、在 Human 本次委任內的合併整合與試玩通知。
- Claude：預設在 GitHub Actions 實作、局部驗證、checkpoint、完成回報。不直接推 main、不自行 merge／approved／關閉Issue或下一階段。
- Human：創作方向、例外權限／登入操作、pull main、本機檢查與遊戲操作試玩。工程覆核通過不等於 Human 已認可玩法或故事體驗。
- 本機 Claude 只用於真正無法在 Action 完成的必要例外，先說明阻礙、已保存的成果、為何Action無安全替代與本機限定範圍。不能只因回合不足、工作量大或續做入口未接好就轉本機。

## 2. 一張 Issue 是一個完整里程碑

- Issue 按「這次能完成多少完整遊戲進度」切分，並把玩法、故事、UI和驗收目標一起寫清楚。
- 不把每個字串／元件／小Bug拆成一張新產品Issue。既有里程碑的必要覆核修正在原Issue內續做。
- 同時只開發一個遊戲里程碑；必要的流程工程Issue可另外存在，但不夾帶遊戲改動。
- 同一里程碑沿用一個工作分支與PR。內部有多個commit/checkpoint不等於多個Issue或多份本機專案。
- 未合併checkpoint不是下一里程碑已驗收的前置成果。

## 3. 中斷點必須能續做，不是只存檔

Action 未達完整交付時，保存並回報：
`Issue / branch / 固定head SHA / Completed / Remaining / 驗證PASS FAIL NOTRUN PENDING / Stop reason / Next step`。

- 每完成可辨認的子項就commit/push；在約40次工具互動評估保存與主動停止，留收尾餘量。保留既有80回合／60分鐘，不放大上限。
- 中斷後在**同一Issue／同一PR／同一分支**，從核對過的checkpoint SHA只做Remaining。不是重新把舊Issue加ready、從main重新開分支，更不是另開本機專案。
- 續做入口須真正實作：可信的授權者、原Issue、既有同repo工作分支／PR、固定head、Remaining及可修改路徑；拒絕過期SHA、fork、已關閉／已完成案、active run或無權限者。
- 同Issue只能一個active run，共用執行鎖；不取消正在保存的run、不force push、不把當前head默默替換成另一版本。
- 任務內正常中斷／尚有Remaining，和來源／權限／驗證阻礙分開回報。沒有新資訊的同一外部失敗不無限重跑；真正缺Human權限時一次說清楚，不反覆轉交本機。
- 完整build/test由模型之外CI對固定SHA執行，保存原始輸出與exit code；模型不輪詢CI耗回合。
- workflow自動化未經實作、驗證、合併前，不宣稱同分支續做已可用。

## 4. 完成、合併與試玩版號

目標生命週期：
`里程碑Issue → Action開發 → checkpoint/同案續做 → 完整交付 → 固定SHA CI + Codex源碼/資料覆核 → 合併main並標示試玩版 → 通知Human pull main試玩 → 收集回饋`。

- 合併條件：完整Issue交付；驗證證據綁定產品head，無必跑檢查FAIL/PENDING或未說明警告；Codex核對實際diff、資料／敘事／scope，無已知阻止交付的問題。不能因模型自評成功就合併。
- Codex按本次Human委任判斷並整合，Claude與一般workflow不自行merge。遵守repository既有保護，不能繞過保護或自改權限。
- checkpoint、未完成版本或仍有已知問題的成果不能為了方便pull就先合併。
- 流程初次接線的必要 bootstrap 例外：workflow-only 實作已完整、固定head独立PR檢查與Codex覆核通過、無已知執行阻礙時，可先部署預設分支提供手動入口，才能取得真實Action證據。這不是遊戲checkpoint或試玩版；原流程Issue保持開啟，端到端未確認不可結案或宣稱整案完成。只允許 .github/、CLAUDE.md、doc/agent-workflow/，不得藉此合併任何M1產品成果。Codex於本次委任內採此有界啟用步驟，不擴權、不改secrets或repository保護。
- 每個遊戲Issue完成後合併main；合併commit摘要帶清楚試玩版號，例如 `playtest(M1.1): 第3–6日工作循環`。通知寫版本、Issue／PR、固定main SHA、更新重點、驗證限制與保留存檔的方法。
- 驗證產品head不等於驗證merge SHA；若main整合有其他變更，對整合SHA再做相稱驗證，通知中分清楚。
- 本機永遠pull main，不讓Human猜分支。玩法是否有趣、操作／375px／真實舊存檔等仍由Human確認，不把merge等同Human試玩已通過。
- 試玩回饋若是同里程碑回修，仍留同案追蹤，不再拆一連串小Issue。下個完整產品里程碑以整合後main為基線。

## 5. 目前工程缺口與待辦（不是已啟用功能）

本次整理起點：遠端main為c44260cb8432aaa22b4d6911ac255aa3e41fc4a2，只有舊v1 Issue入口。#5已整合此main以保留R12；本分支補齊PR失敗blocked、revision guard、固定PR/head續做與原始驗證log。尚待獨立PR檢查、合併及受控端到端確認，不能宣稱已部署。

#5依本次決定整理成「可中斷並同案續做的Action工程里程碑」。驗收項目：
1. 完成既有固定SHA CI、失敗／取消／超時收尾、原始驗證證據保存；PR建立/ready失敗正常收尾但blocked，補全綠缺PR測試。
2. revision-requested的授權與guard一致，不默默當成允許重新執行。
3. 補同Issue／同分支／固定head續做入口，含來源branch checkout與可信授權；不得新分支重寫checkpoint。
4. 同案覆核、有限續做與收尾紀錄；未實作的Codex喚醒／排程不能假裝已接通。舊Work排程仍暫停，不恢復舊#7提示。
5. actionlint、離線fixtures與受控真實端到端驗證；只有實作合併並確認接線才宣告生效。
6. 五份規則、Action prompt、guard、CI及收尾必須一致。80/60、secret／最小權限邊界保留。
7. 如App／token無workflow寫入或PR建立權限，保留精確patch與失敗證據，請Human一次處理必要權限／提交；不藏到pending假裝啟用，不改secrets、不自增PAT，不因此把所有產品任務改本機。

M1：
- 保留claude/m1-workday@4bb8f4bfb4adfbd64de1b4ca0f3cc30c2b1b70f7，產品ac6cfe2ba5403b0168e6d31893e712e24d516ee8；未合併。
- 四項覆核回修仍需完成；詳細證據見doc/reports/M1-codex-review.md，R1–R4要求須放進完整M1的Action Issue，而不是再次派本機。既有本機COLLABORATION回修指派已由Human這次決定撤回。
- 新入口需能接手固定既有M1成果，不能把未合併成果丟掉，不能從main重寫。
- M1目前不是新可試玩版，不因這次流程決定就merge。

## 6. 本機收斂的安全要求

- 原主目錄於整理前仍在#5；未提交企劃、內容包、回修交辦與Codex覆核已精確備份至Git stash 283e62628304348f25634dc7dd19e2e48218b4f3，不丟棄或混入workflow交付。整理後切回main供pull；備份不等於已派發Action。
- 舊#7工作目錄的0962c3e已包含在main，乾淨。Human於2026-10-13確認Claude沒有進行修改、編輯器只是開著，並要求先清除多出目錄；Codex已用git worktree remove移除kodebart_webGame-issue7-local-fix，退出碼0且目錄不存在。原專案、未提交文件、分支claude/issue-7-local-fix及0962c3e均保留；一併移除的.angular／dist／node_modules為可重建快取，不是新增產品成果。
- 原M1暫存目錄已不存在，保留其branch與commit；清理失效登記不等於刪成果。覆核checkout只有Codex文件變更，先保留再清理。
- 已觀察到本機Claude process與主目錄關聯，但不據此宣稱正在改檔。整理前由Human停止該本機任務，Codex不自行kill未知session或切換它正在使用的checkout。
- 源碼、歷史commit、未提交修改與需要的忽略檔先確認可回收；依賴／build cache可重建。整理後明說移除哪些目錄、如何恢復。
