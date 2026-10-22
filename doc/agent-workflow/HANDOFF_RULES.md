# KodeBart GitHub 接線與交接 v1.2

最新運作需求見 `doc/agent-workflow/OPERATING_MODEL.md`。Action優先，原Issue/PR/branch續做；不把80回合轉成第二份本機專案。

## 1. 真正存在的入口

| workflow | 觸發 | 功能 |
| --- | --- | --- |
| `.github/workflows/claude.yml` | Issue加claude-ready | 首次任務、固定runbranch、collect/verify/finalize |
| `.github/workflows/claude-resume.yml` | 預設分支手動dispatch | 固定原Issue/PR/head/Remaining、同branch續做 |
| `.github/workflows/agent-verify.yml` | workflow_call | 模型外固定SHA驗證 |
| `.github/workflows/agent-verify-only.yml` | 手動dispatch | 不跑模型、不改labels，只驗既有固定成果 |
| `.github/workflows/agent-finalizer.yml` | workflow_run completed | 初次/續做取消逾時的受限blocked補收尾 |

判定：`.github/scripts/agent-flow.mjs`；GitHub I/O：`.github/scripts/agent-flow-cli.mjs`；离線測試：`.github/scripts/tests/`。

本分支存在不等於啟用；只有合併預設分支才可dispatch新入口，還須真實端到端確認。未通過前不宣稱無人值守自動流程已完成。

## 2. 一次續做契約

- 原Issue完整任務、固定同repo open PR、當前branch/head、明確Remaining/允許路徑、Human或受委任Codex授權。
- PR本文独立一行Refs #原Issue編號；branch屬claude/issue-原編號-…。
- 拒絕無write、非預設workflow、fork、merged/closed、approved/revision-requested、active/queued、過期SHA及rerun。
- 共用原Issue concurrency，checkout再核對來源，不force push、不新開成果分支、不merge。
- 原 Issue 的 checkpoint 不是新的已驗收前置；新工作 Issue 依固定 main 與已覆核依賴開始，不能沿用其他 Issue 的分支冒過 guard。
- 回收 #11 舊成果須明列 b781e368f4967bfaee8f3fd58e9575afe99d6465 與必要差異，不重寫或整批混入新案；完整模組現在由多個實作／測試 Issue 組成。

## 3. 模型及驗證邊界

沿用anthropics/claude-code-action固定SHA8ce9314fa9a404564fa7e954cd84f25bcba2b829，Opus5.5/max/80/60不變。
續做使用官方explicit prompt agent模式、guard的CLAUDE_BRANCH與固定checkout。模型只收到既有必要認證，不加PAT／secrets，不上傳SDK原始輸出。

模型只局部檢查、分段push；collect固定head，唯讀CI檢查實際diff、保存指定檢查log/exit/SHA，finalize重讀head後才允許human-review。PR建立/ready失敗仍blocked正常收尾；無PR不可聲稱完成可合併。

取消／逾時補收尾只讀可信同repo已知workflow/event/run-name。續做由run-name的PR讀repo/base/branch/Issue關聯；guard未成功、finalize成功、無鎖或其他同案run時不介入。不執行artifact。

## 4. 完成與交接

Claude 回報本工作 Issue。Codex 逐案讀實際 diff／證據，回修仍同案；安全整合後才交下一依賴。整個模組含測試 Issue 完成才標試玩版；Human 只 pull main。CI、merge、approved 分開，詳見 OPERATING_MODEL。

跨創作階段仍需明確產品方向；Claude不自己叫Gemini或開下一Issue。現有#1/#2/#6/#7 R12已整合main；#3/#4被M1取代而結案，不把其舊台詞當正史或依賴。

## 5. 原流程工程驗收清單（歷史範圍，不是本輪派工）

1. 讀#5固定source→head diff；只含workflow/規則，不能回退main既有R12。
2. actionlint、離線fixtures、checkJs、diff-check、文件路徑均通過。
3. 合併預設分支才提供新入口；維持最小權限/認證，不自行調整repository保護。
4. verify-only受控驗證固定工程head，檢查log/artifact/exitcode/SHA、原Issue回報及不改labels。
5. 模型續做受控跑同PR/head，確認branch未新建、checkpoint保留、固定SHA CI及正常解除鎖。
6. 若workflow推送或PR權限拒絕，留精確錯誤與成果，請Human一次處理；不藏到pending、不宣稱啟用、不把後续產品都轉本機。
7. 真實檢查未跑列NOT RUN／未確認；未把全部端到端驗證通過前不結案#5。

現況與未解阻礙以 HOME_HANDOFF 的固定證據為準。上列 #5 清單不是本輪授權修 workflow。Gemini 無自動化入口；必要素材由 Human 開網頁版後依明確 brief 製作，不夾帶流程改動。
