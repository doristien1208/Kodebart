# 驗證責任與證據索引

更新：2026-10-21。驗證一定綁定 SHA；下列歷史結果不是目前工作樹或下一模組的 PASS。

## 1. 實作、測試 Issue、CI、Human 的分工

- 實作 Issue：功能可編譯、必要局部檢查與既有回歸，回報真實 PASS／FAIL／NOT RUN；不跑一輪長測試後持續輪詢。
- 獨立測試 Issue：對指定實作 SHA 補齊單元／元件／串接情境，明確允許測試檔與報告。發現 production bug 回實作 Issue；不能把預期值改成錯誤行為。測試案本身同樣不得超過 80 回合／60 分鐘。
- 模型外 CI：每個產品 PR 仍按既有流程執行 npm ci、app/spec tsc、production build 零警告、完整非 watch ChromeHeadless、範圍與文件檢查。獨立測試 Issue 不停用實作 PR 的 CI。
- Codex：讀原始 diff／內容／狀態流與同 SHA log、exit、summary／artifact；job success 內仍可能有失敗。核對整合 SHA，不以舊 head 綠燈代替。
- Human：真實遊戲操作、故事／趣味、桌面與 375px、中文輸入、真實舊存檔體驗。Codex 本機不跑遊戲測試或 UI；無證據項目不寫已確認。

## 2. 模組共通檢查

正常、空資料、未知 ID、缺歷史快照、延遲送達、重複操作、取消／返回、保存失敗、刷新續接。檢查 key／schema／穩定 IDs、已讀、seed、時間、版本與玩家實際值是否保留；未改格式不得順便遷移。

元件確認鍵盤／focus、窄窗可達操作與文字 fallback；靜態或元件測試不等於實體瀏覽器排版已試玩。各模組補自己的輸入輸出與來源矩陣，見主企劃 §9 及對應測試 Issue。

只有整個模組所有 Issue 已覆核、整合版本的必跑檢查通過、正常遊戲可達且無已知阻止試玩問題，才發布試玩版。CI／Codex 覆核／Human approved 分開記。

## 3. 歷史證據（不可套到新版本）

| 固定對象 | 已知證據與限制 |
| --- | --- |
| 2026-09 原型 | 歷史核心／靜態結果在 prototype；不是 Angular 或實際瀏覽器通過 |
| 早期 Angular 移植 | 184／202 測試與當時 UI 紀錄含已淘汰的型別／編號規則；完整原文見下方歷史版本，不作現行驗收 |
| 已整合 M1 | PR #10／a366226cb10f2a143cb03b2ca391de6a4cd2f364；M1 報告保留歷史 Completed／Remaining，不因文件整理洗成全產品驗收 |
| M2 b781e368f4967bfaee8f3fd58e9575afe99d6465 | run38855063429：npm ci、兩 tsc、production build 零 Angular 警告、3001/3001 tests、diff/docs 通過；僅是未合併底層 checkpoint |
| A1 run38870324926 | Action failure；SDK 自述 success、83 turns、7 次拒絕細節未公開；沒有新遠端 commit，後續 3001 綠燈仍是舊 b781，不是 A1 完成 |

- [b781 覆核與證據](https://github.com/doristien1208/Kodebart/issues/11#issuecomment-6209000899)
- [A1 停止點與限制](https://github.com/doristien1208/Kodebart/issues/11#issuecomment-6211423373)
- [早期 Angular 原始驗收](https://github.com/doristien1208/Kodebart/blob/49aa1a506ad87bc5289a2299ba48c0898190147b/doc/Angular-Acceptance.md)
- [原型原始驗證說明](https://github.com/doristien1208/Kodebart/blob/49aa1a506ad87bc5289a2299ba48c0898190147b/doc/Verification.md)

Artifacts 有保存期限；讀不到時明記「歷史覆核紀錄／原始 artifact 現在未確認」，不能假造下載成功。這次文件收斂沒有重跑以上產品測試，也沒有改任何歷史 Action 結果。
