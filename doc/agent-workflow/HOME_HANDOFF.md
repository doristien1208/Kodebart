# KodeBart 跨電腦交接

狀態更新：2026-10-22；政策決策：2026-10-21。GitHub 文件、Issue、PR 是跨 Mac／Windows 的記憶；不依賴公司遠端桌面。本機聊天、工具登入與 localStorage 不會隨 git pull 同步。

## 1. 最新決策與停止點

Human 改定：**模組 milestone → 多件有界工作 Issue → 每件最多 80 回合 → 獨立測試 Issue → Codex 逐案覆核 → 模組完成後 main 試玩**。不再以 Day 7–10 整章作單張 Issue。主企劃 §9 定義下一個 FOLDER-1；案件送件包另為 PACKET-1。這次整理文件與待辦，不是新產品已完成。

舊 #11／draft PR #12 保留固定成果，不能整批合併或盲續 A1。Action 停點保存／回合口徑／finalize 診斷仍未完成，Human 尚未授權修改可執行 workflow、認證或限制。拆工作不等於已修復該阻礙；未安全排除前，新的工作只列 backlog，不加 ready、不 dispatch。

原 monitor `kodebart-claude` 已按 Human 要求在 **2026-10-19 刪除**。不恢復、不複製到 Windows。GitHub 留言不會自動喚醒本機對話，Codex Action 也未啟用。

[FOLDER-1 milestone](https://github.com/doristien1208/Kodebart/milestone/1) 已建立：#13 資料契約、#14 元件、#15 入口整合、#16 純函式測試、#17 整合測試。全部僅 backlog，無 ready／派發。詳細依賴與範圍見主企劃 §9 及各 Issue；派發前仍須補規格／依賴固定 SHA 並排除上述阻礙。

## 2. 固定版本與證據

| 對象 | 狀態／來源 |
| --- | --- |
| repository | doristien1208/Kodebart；每台電腦一份正常專案，Human 用 main |
| 本次整理前 main | 49aa1a506ad87bc5289a2299ba48c0898190147b |
| 已整合產品 | PR #10，a366226cb10f2a143cb03b2ca391de6a4cd2f364，已有六日；後續文件提交不是新試玩版 |
| 舊完整章節案 | [#11](https://github.com/doristien1208/Kodebart/issues/11)，本次讀取仍 open／blocked；新計畫不等於已自動改其狀態 |
| 舊成果 PR／branch | [draft PR #12](https://github.com/doristien1208/Kodebart/pull/12)；claude/issue-11-run38840289640 |
| 舊成果固定 head | b781e368f4967bfaee8f3fd58e9575afe99d6465 |
| 原作者設計 | f2e0fdb33e2c97d7ade166613f09f53002bad41e；原章節文件仍可在此 SHA 讀取 |
| 兩圖來源／整合 | main f2babb27e0fb27a4093a7c01928169629681b42d → 原成果分支 8f5edb5eaa31de3fcd5674f5aa47dfb9f476650a |

b781 包含引用／casework／詢問底層、Save v13／遷移、舊 Day6 end 續接的 core/state、九項 fixture 修正，不包含完整 UI／四日／六頁／兩圖 runtime。
[固定覆核](https://github.com/doristien1208/Kodebart/issues/11#issuecomment-6209000899)記錄 96bbe48782f6f230bbd90521606cb2c62ce260e2 → b781 的 4 檔 87+/21-、diff SHA256 a98ef66cbe9d48eff2f1d44844c17b39d50b8bc4148a044e0b379362e137cdf2；沒有放寬 production。

[run38855063429](https://github.com/doristien1208/Kodebart/actions/runs/38855063429)模型 43 turns；product116827426313／summary116827857169、artifact12027167373：固定 b781 的 npm ci、兩 tsc、零 Angular 警告 build、3001 tests、diff/docs 過。這是歷史覆核，不是本次重跑。

[A1 run38870324926](https://github.com/doristien1208/Kodebart/actions/runs/38870324926)failure，SDK success／is_error=false、83 turns、7 次拒絕但細節未公開；沒有新 commit。product116882146369／summary116882494860、artifact12034151400／12034072210只驗舊 b781，沒有新 patch。不能推測拒絕了 git push。
[停止點](https://github.com/doristien1208/Kodebart/issues/11#issuecomment-6211423373)保留以上差異。finalize 漏 RESUME_BRANCH 的分支誤判不能抵銷超回合，亦不能證明未提交成果已保存。舊 #5 不借本次重整復活。

## 3. 接手順序

1. 讀 [主企劃](../KodeBart-Game-Plan.md)、[文件入口](../README.md)、[DESIGN](../DESIGN.md)、[驗證責任](../Verification.md)。
2. 讀 [運作模型](OPERATING_MODEL.md)、CLAUDE.md 及四份現行規則；Action 注入路徑仍保留。舊「一里程碑一案」已由 2026-10-21 指示取代。
3. 重新核對 main、相關 Issue／PR、固定 diff、最新 Claude 報告與同 SHA 原始 CI；不要把本表當永遠最新。M2 report 從 PR #12 固定 head 讀，不因 main 沒檔案就當成果遺失。
4. 程式探索先 codebase-memory-mcp（本機 main 圖譜），遠端新碼以固定 git show/diff 補讀；不能依圖譜猜未索引分支。
5. 在 Windows 先查唯一專案位置、實際 remote 名、branch、dirty files。公司 remote 是 main，Windows 不一定；不照抄 Mac 路徑。dirty／分歧不 reset、覆蓋或擅自 stash。
6. 不切本機 main、不建 worktree、不跑本機遊戲測試／UI；讀檔覆核與 CI 證據分開。新派發須另查 active／queued／PR／head／標籤，不用舊 ready 重跑。

## 4. 未合併設計材料保留

原 M2 的 A1/A2/B/C/D 不再整包續派；依主企劃模組分配到後續工作，各新 Issue 明列固定來源與最小回收內容。原 JSON 的 ID／玩家文本不改，作者備註不得誤作玩家台詞。

後續 PACKET／STORY 必須保留：
- savedBindings 缺來源為 typed missing/null；顯示 fallback 不等於真資料，不補標準列。
- H204 用 Day3 實際編號與依據，R27 的 15:00 只有詢問已送達才可引用，仍不是已約定。
- 交付版本保存選項／輸出／引用／來源快照；缺舊快照顯示未附，不用當前內容重建。未公開 v13 相容可選快照與 strict 驗證的決定保留，是否取回須在該案核依賴。
- 原 Day10 completedTasks 母體為 Day7–9 六件案件；listRows 讀 Day7 綁 Day6 真實輸出快照；receivedRows 讀 Day9 綁同一 Day7 版本清單。窗口收件不當本人回覆。
- 未決按「案或列＋原因」去重；缺來源寫「已知 N 項；另有來源未附」，不造 0；report focus 不改數字。相關 Issue 派發須完整轉錄契約，不能只貼本摘要。
- 兩張 2752×1536 Gemini JPEG 固定用途見 DESIGN。未接 runtime，不重生成。需要新圖先告知 Human 用途／構圖／風格／尺寸，由 Human 開網頁。

## 5. 試玩與交接

模組試玩版只從 main，提供完整 SHA／PR、實際更新內容與前版差異、試玩重點、通過與未確認項目；不以單案測試數替代體驗說明。Git pull 不會同步 localStorage；key `kodebart-save-v2`，先備份原字串，不清檔、不把真實存檔上傳 GitHub。公司 4200 是其他專案。

本次文件整理不 approved、不合併產品 checkpoint、不改遊戲／Action 程式／secrets／權限，不重新啟動監控。[Codex 訂閱設定研究](CODEX_SUBSCRIPTION_SETUP.md)仍為可選研究，不是已啟用的 Codex Action。

## 6. 可貼給 Windows Codex

```text
請接手 doristien1208/Kodebart，使用繁體中文，擔任遊戲企劃／PM／覆核者。先讀 GitHub main 的 doc/agent-workflow/HOME_HANDOFF.md、doc/KodeBart-Game-Plan.md 與現行規則，再核對最新 Issue、固定 PR head、實際 diff 與 CI 原始證據。

最新政策是功能模組 milestone、每件有界工作一張 Issue、測試另案、每件最多 80 回合，Codex 逐案覆核。下一模組 FOLDER-1；原 M2 不再整章派一張。#11／PR12 的 b781e368f4967bfaee8f3fd58e9575afe99d6465 要保留，不當完整 M2。A1 沒有新提交；Action 診斷修正仍未授權，不盲重派，不轉本機補救。

公司舊 monitor 已在 2026-10-19 刪除，請勿重建。先回報當前進度與安全下一步，不改遊戲、workflow、權限／限制，不啟動 Claude 或 merge。每台電腦只保留一份專案，先保護未提交檔；Human 試玩只 pull main。若原始證據或權限不可用，如實說明。
```
