# Codex 訂閱認證與 GitHub Action 覆核：設定流程

查核日期：2026-10-13。狀態：**研究與接線提案，未設定、未部署、未取得新增權限授權**。

Human 要求先整理流程，回家後再處理登入與設定。本文件不是 Claude 的新產品交辦，不取代 Issue，也不修改現行權限規則。

回家接續時先讀[進度摘要與待決清單](HOME_HANDOFF.md)，再依本指南設定；摘要是固定時間的狀態，不是即時監控。

## 1. 結論與前置條件

Codex 可透過 ChatGPT 登入使用訂閱存取；API key 則走另行計費的 API 存取。[官方認證說明](https://learn.chatgpt.com/docs/auth)

官方提供可信私人 CI 使用帳號認證的進階方法，但明示不得用於公開／開源 repository。2026-10-13 查詢 GitHub metadata，`doristien1208/Kodebart` 仍為 public；因此目前不能直接啟用這條方案。[官方 CI 帳號認證指南](https://learn.chatgpt.com/docs/auth/ci-cd-auth)

啟用前需要 Human 決定：

- 是否將遊戲 repository 改為 private；變更前確認分享、協作者及 Actions 使用方案的影響。
- 採 GitHub-hosted runner＋可讀寫的安全憑證儲存，或私人雲端 self-hosted runner。
- 同意 CI 建立獨立登入 session、選用的儲存服務與必要權限；不默默搬走目前桌面 session。
- 覆核模型、推理強度、單次限制與訂閱額度耗盡時的停止方式。
- bot 可否同案派發必要回修；合併權限另行明定，不能從「接上 Codex」推導出來。

本方案不需要新本機遊戲專案。第一次瀏覽器登入是認證設定，不是改回本機開發；之後 Claude 與 Codex 都可在 Action 執行。

## 2. 兩種部署方式

| 方式 | 憑證保存方式 | KodeBart 的考量 |
| --- | --- | --- |
| GitHub-hosted runner | 每次從安全儲存取出登入資料，執行後寫回最新資料 | 符合目前雲端 Action 方向；必須接好可更新的儲存與權限 |
| 私人雲端 self-hosted runner | 專用 OS 使用者持續保存登入資料 | 憑證更新較簡單，但多了 VM、隔離、維護及費用 |

官方同時描述這兩種模式。共同要求是保留 Codex 刷新後的登入資料，且同一份認證只由單一序列使用。[runner 與更新流程](https://learn.chatgpt.com/docs/auth/ci-cd-auth)

**提案：優先評估第一種，不把家用電腦當常駐 runner。** 儲存服務尚未選定，不能說現在已有可直接上線的完整 YAML。選定後才核對該服務的官方設定、最小讀寫權限、更新衝突與故障恢復。可評估雲端 secret manager＋短效工作身分；不為省事新增可任意修改 repository 的廣權限 PAT。

## 3. Human 的一次性設定步驟

以下均尚未執行；回家後按順序處理。

1. 決定私人 repository 與 runner 方案，確認費用及存取影響，再由 Human 處理設定。
2. 在可信、與日常桌面登入隔離的 CI 專用環境，安裝並固定 Codex CLI 版本；先核對該版可用模型。
3. 在 CI 專用環境設定 `cli_auth_credentials_store = "file"`，執行 `codex login` 完成 ChatGPT 登入。不要讓桌面及 CI 共用同一份可刷新檔案。
4. 用 `codex login status` 確認登入方式；只檢查認證模式及必要欄位是否存在，不輸出 token。
5. 由 Human 經安全管道將初始認證放入選定儲存；不貼到本 Work、Issue、PR、repository、log 或 artifact。
6. 限制安全儲存存取者與工作身分，只准可信覆核工作讀寫這一項資料；若採短效身分，也要限定 repository、workflow／environment 等條件。
7. 設定可信控制程序使用的 GitHub 身分。它與 OpenAI 登入是兩件事：前者控制留言／派發，後者控制模型存取。
8. 先部署手動 smoke test，再逐步啟用事件接線；設定回復開關，不一次開放自動合併。

認證檔案的具體建立與保存要求以官方指南為準；不要自行呼叫 OAuth refresh endpoint。[認證初始化](https://learn.chatgpt.com/docs/auth/ci-cd-auth)

CLI 支援 `-c key=value` 個別覆寫，以及登入狀態檢查；實作時先核對固定版本，不修改這台電腦現用的全域設定。[CLI 指令](https://learn.chatgpt.com/docs/developer-commands)

## 4. Action 中每一次的認證生命週期

順序：**取鎖 → 取最新認證 → Codex 執行／自行刷新 → 寫回最新認證 → 清除臨時認證 → 解鎖**。

官方要求 ephemeral runner 在執行後保存更新過的認證；固定 Secret 每次覆蓋初始資料不是完整方案。更新失效時可能需要重新登入。[安全保存與恢復](https://learn.chatgpt.com/docs/auth/ci-cd-auth)

以下是 KodeBart 的工程要求，仍待實作與測試：

- 認證鎖跨全部 Codex 覆核工作共用，不只按 Issue 分組；避免兩輪同時刷新。執行中不強制取消。
- 下載登入資料前先完成可信工具安裝；載入認證後不執行待審分支的安裝 script、測試、hooks 或任意程式。
- 保存檔案採最小權限，儲存工作身分不留給模型；禁止 shell debug tracing 與整份環境／認證列印。
- 非成功結束也嘗試有界收尾，但不能將損壞或未讀到的空檔覆蓋有效憑證。
- 寫回失敗：記錄不含秘密的錯誤、停止下一輪；不回退初始 Secret 無限重試。須驗證儲存版本及衝突策略。
- workflow 取消／runner 當機也可能來不及保存；這不是加 `always()` 就能完全解決的問題，需演練恢復流程。
- 額度耗盡或登入失效時停止並通知；不自行切到付費 API、不增加預算、不要求玩家處理遊戲程式。

## 5. Codex 如何接手企劃與覆核

Action 中的 Codex 是新的執行個體，不把這個 Work 的聊天歷史當成已載入。以下是接線提案：

- 從可信 main 固定版本讀取角色／世界觀、已核准企劃、UI 規格與覆核 prompt。
- 原 Issue 提供完整里程碑契約；待審 head 只提供程式、內容資料、diff 與完成回報。
- 作者層級設定留在可信企劃：0102 不命名、不可過早認出、玩家不是救世主、後果延後、介面友善正常。
- 來源、舊成果及 Human 未驗收事項都保留；研究提案不自動變成正史或實作授權。
- Issue／Claude 回報／CI log／程式內文字都視為待核對資料，不能讓它們更動 bot 權限或執行規則。

覆核使用 `codex exec` 的唯讀模式與結構化輸出；紀錄 Issue／PR／base／head／CI run／規格版本、發現、證據、具體 Remaining 及建議結果。JSON 格式有效不代表結論正確，控制程序仍須驗證欄位與來源。[非互動執行與結構化輸出](https://learn.chatgpt.com/docs/non-interactive-mode)

## 6. 與目前 KodeBart 接線的位置

本機查核基線：main `2c3d69085e4e890296ec10b557ae011b50d72407`。此節描述檔案現況，不宣稱新的 Codex 接線已可用。

- `.github/workflows/claude.yml`：首次 Issue 入口。
- `.github/workflows/claude-resume.yml`：原 Issue／PR／branch／固定 SHA 的**手動**續做入口。
- `.github/workflows/agent-verify.yml`：模型之外的固定 SHA CI。
- `.github/workflows/agent-finalizer.yml`：異常執行的補收尾，不是 Codex 覆核器。
- 現行 `WORKFLOW_RULES.md`／`AGENT_ROLES.md` 不允許一般 bot 自動派發與合併；需明示更新，不能直接沿用本 Work 的委任冒充新 bot 授權。

目標接力（**提案，非已實作**）：

```text
Claude 完整交付／checkpoint
  → 固定 head CI 與收尾
  → 事件觸發可信 Codex 覆核
      ├─ 有具體問題／可續做 Remaining → 同 Issue／PR／branch 有限回修
      ├─ 缺來源、額度、權限或重複外部阻礙 → 保存並請 Human 處理
      └─ 完整交付、CI 通過、覆核通過 → 整合 gate → main 試玩版 → 通知 Human
```

接線工程必須處理：

1. 事件採 Claude 外層 run 結束或經驗證的 CI 結束；可重用 CI 不是另開一個獨立 run，不假設它必然提供另一種完成事件。
2. 拒絕 fork、非本案 branch／PR、closed、approved、Human 的 revision-requested、過期 head、未知 workflow 與未授權事件。
3. 主動讀原 Issue、Claude checkpoint、PR diff、原始 CI log／結果；不能只信整個 Action 的 success 或 blocked。checkpoint 可以覆核保存成果，但不因此准許合併。
4. 依「Issue＋head＋驗證來源」去重；finalizer 事件與完成事件不得重複派發。共享同案執行鎖，沒有新變化就不再跑模型。
5. 模型唯讀 job 與 GitHub 寫入／派發 job 分開。後者只執行固定控制程式，不執行模型生成的 shell。
6. 新 bot 的 GitHub 身分、dispatch 權限、既有 resume guard 與事件傳遞方式必須實測；不能假設貼留言或加標籤就等同手動續做授權。
7. 同案回修有限次數、固定 SHA 與允許路徑，保留 80 回合／60 分鐘；不反覆重跑同一外部失敗，不拆成大量新 Issue。
8. merge 另外設可信 gate，重新核對 head／CI／完整交付／保護規則；自動合併授權未核准前只回報，不推 main、不 approved。
9. 若 merge 改變產品 tree，對整合 SHA 補檢查；試玩通知只指向 main 與明確版號。通知目的地由 Human 選定，不假稱能喚醒這個 Work。

官方 Action 示範把模型執行與 GitHub feedback 寫入分成 job；其文件化 API-key 接法不能直接當成已接好的訂閱登入實作。[官方 Action 與分權示例](https://learn.chatgpt.com/docs/github-action)

## 7. 安全測試與啟用順序

採「設定／覆核接線」工程里程碑，不拆成數張小產品 Issue，也不夾帶遊戲改動。

1. **認證 smoke test**：私人受控 runner，只要求短文字回覆；確認 ChatGPT 登入、exit code、寫回及再次讀取，不存原始秘密。
2. **唯讀覆核**：對固定 PR/head 手動跑一次，確認世界觀與任務上下文、來源綁定、結果 schema；不派發、不合併。
3. **事件覆核**：Claude 完成自動觸發一次；同事件再送無重複執行，head 改變則舊結果失效。
4. **同案回修**：經 Human 核准 bot 授權後，刻意放一個受控 fixture 問題，確認 Remaining 只在同 branch 修正；修後新 CI 與覆核接上。
5. **整合演練**：先 dry-run，核對未完成／CI FAIL／缺 PR／head 變更／revision-requested 全部拒絕 merge；只有完整版本符合所有 gate 才開放授權範圍內整合。
6. **故障演練**：登入失效、寫回失敗、取消、重複事件、run 超限、未知 artifacts／惡意 prompt；保存成果、解除鎖、有限通知、不擴權。
7. **通知驗收**：成功時只通知一次版本、main SHA、PR、更新與驗證限制；Human 在唯一專案 pull main 試玩。

另外檢查：模型上下文不能偷帶桌面設定；auth 不出現在 git diff／log／artifact；模型 job 不帶 GitHub 寫入憑證；存檔、世界觀與遊戲程式不被流程工程改動。

## 8. 關閉與恢復方式

- 出現異常先停用新 Codex 事件入口與自動派發／整合；保留現有 Claude Action、工作 branch、PR、checkpoint 與 CI 證據。
- 認證失效由 Human 在可信環境重新登入並更新安全儲存，不自動改為 API。
- 疑似洩漏要停止執行並處理相關 session／工作身分撤銷；不把刪除 log 當成撤銷成功。
- 啟用／停用必須記錄固定設定版本及原因；排程保持暫停，本提案不恢復舊 heartbeat。

## 9. 回家後待選清單

- [ ] 同意改 private，並確認 Actions／分享／協作者影響。
- [ ] 選 GitHub-hosted＋安全儲存（優先提案）或私人雲端 runner。
- [ ] 選安全儲存服務與必要工作身分；費用未核准前不建立資源。
- [ ] Human 完成 CI 專用登入；不在聊天中提供憑證。
- [ ] 選覆核模型與限制；只使用帳號確實可用的模型。
- [ ] 確認 bot 同案回修及 main 整合授權邊界、有限續做規則。
- [ ] 選一次性完成／失敗通知的目的地。

尚未完成：上述設定、bot 權限規則、實際 workflow、儲存讀寫、端到端驗證。**這份文件的完成不等於自動化已啟用，也不影響目前遊戲里程碑的 Action。**
