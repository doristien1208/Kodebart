# Claude 本機交辦：#7 舊存檔說明文案的顯示修正

本檔只保留本輪交辦，不追加歷史或完成報告。Human 於 2026-10-08 指定：Action 任務讀 Issue，本機任務讀本檔；本輪採本機續做。若舊規則要求不修改本檔，以這次 Human 明確指示為準。完成後停下，由 Codex 覆核、Human 操作驗收，不自行開始新玩法。

## 1. 固定來源與工作位置

- 專案：`/Users/doris.tien/Documents/03_Highly_Confidentail/kodebart_webGame`；不是 FlexibleDesignWeb。
- 原任務：[Issue #7](https://github.com/doristien1208/Kodebart/issues/7)。Remaining：[Codex 覆核留言](https://github.com/doristien1208/Kodebart/issues/7#issuecomment-6034439296)。
- 沿固定成果 `d30ceb18e483443e5ee84af19ed913a06014ea39`，來源分支 `claude/issue-7-20261007-0804`。不能從 main／#5 重做，也不能丟掉 #6 唯一歡迎詞／歷史附件姓名修正。
- 先核對 Git 狀態、head、其他 worktree／同任務執行狀態，保留 Human／其他 Claude 的未提交修改。不要切換或重設本 Work 的 #5 審查 checkout；使用合適的獨立 worktree，沒有才從固定來源建立本機續做分支。
- 遠端名 `main`，不是 `origin`。缺來源、來源不同或有重疊執行先回報，不自行重寫。獨立 worktree 若仍有舊交辦檔，讀上述專案的本檔絕對路徑，不整批合併 #5 來取得文件。

## 2. 只修這個問題

來源已完成新處理動作與 help JSON，但舊存檔的 `chatReplies` 仍保存舊文字。`src/app/game/ui/messages/presenters/timeline.ts` 的 `pushReply` 直接用 `reply.playerText`、`r.lines`，使已回答過的人仍看到「原表」及「未確認／未拒絕」等舊說明。新遊戲正確不代表舊存檔已修正。

僅對 `prompt.help.refusal`，在**顯示層**依穩定 ID 解析已核准現行 help 內容：

1. answered 且 choiceId 存在於該 help prompt：玩家列顯示該選項現行回覆文字。
2. 同一選項下，保存的 response ID 仍存在：只換該列 lines，其餘仍取保存快照。
3. 找不到 choice：整份回覆沿舊快照；找不到個別 response：該列沿舊快照，不刪列或替換成別列。
4. skipped、未回答、一般 prompt：原行為與歷史快照不變，不全域更新聊天歷史。

用小型純 presenter／resolver 或現有 presenter 最小擴充，在 messages 協調層取得現行內容。core/state 不依賴 JSON；不靠舊文字字串比對辨識對話。

## 3. 必須保留／不得修改

- 不寫回或遷移存檔，不改 save schema／版本、kind、choiceId、response IDs、actorId、time、answeredAt、dayId、deliverAt、排序、未讀 IDs、已讀狀態、seed、草稿、fresh 判斷。原始快照不可變。
- 未送達列依原 deliverAt 等待／顯示 typing，不提早送達、重送、重抽、重新開放回答或清除紅點。
- help JSON 已核准，直接引用，不自行寫台詞。保留「套用部門預設並歸檔」「保留缺漏並送覆核」；內部 false/null、origin、去向與後果不變。
- 不重做 #7 已完成修改；不改 onboarding、郵件、歸檔規則、day JSON、workflow 或規則文件。不重跑舊 Action、不提高 80 回合／60 分鐘、不改 repo 權限。
- `doc/KodeBart-Gameplay-Replan-Proposal.md` 是研究提案，**本輪不得實作**。不新增劇情、新聞、美術或其他功能。

## 4. 修改範圍與驗收

預期僅 `src/app/game/ui/messages/presenters/` 的解析與測試，以及 `src/app/game/ui/messages/messages/messages.component.ts` 必要接線及測試。先核對來源實際路徑；擴大範圍先說明必要性，不趁機重構。維持 Angular 元件與外部 HTML／CSS 結構。

Claude 補測試：

- 舊 ask-blank／ack 快照使用現行文字；真正 messages timeline／頻道預覽亦不繞過解析顯示旧文案。
- 已送達／等待 responses：送達時間、typing、ID、作者、順序與時間不變。
- skipped、未知 choice／response、一般 prompt 沿舊快照；未知 response 不消失。
- 深凍結輸入可解析，reply／responses／狀態不被修改，不觸發保存、重送或已讀重設。

完成程式與測試修改後固定候選 head，再於同一 head 執行 app／spec TypeScript 檢查、`npm run build`、既有 ChromeHeadless 測試與 `git diff --check`。從 package／既有設定確認實際指令；保存原始輸出末段與 exit code，不能只寫 PASS。提交後再改程式／測試，舊結果不能冒稱新 head 已驗證。

Codex 不跑操作測試；375px、通訊切換、舊存檔實際顯示由 Human 試玩。不占現有 4200、不重設 localStorage。舊 Action 失敗仍是歷史事實，本機驗證不等於獨立 CI 通過。

## 5. 完成或阻礙時回報 Codex

回報：`Source / Branch / Head / 修改檔案 / Completed / Remaining / 驗證指令、原始輸出末段與 exit code / 未確認項目 / 停止原因 / PR（若有）`。

可在原 Issue #7 留報告；無認證則交 Human 轉貼給本 Work。缺來源、規格偏離、驗證失敗、權限問題必須明說，不自行把未完成項判為不阻擋。不追加回報到本檔，不自行 approved、merge、關閉 Issue 或啟動新 Action。
