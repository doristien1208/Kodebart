# KodeBart 跨電腦交接：Windows Codex 接手入口

狀態快照：**2026-10-16 16:56（Asia/Taipei）**。這是持續更新的專案記憶，不是即時監控頁、完整聊天備份或新的 Action 任務契約。

Human 在公司使用 Mac、回家使用 Windows；下班後公司電腦不可連線。本案採 **GitHub 文件／Issue／PR 交接，不依賴遠端桌面**。本機對話、排程、工具、登入與遊戲存檔均未因本文件自動搬家。

## 1. 本次授權與現在的停止點

Human 最新要求：

> 幫我整理好交接文件並放到 GitHub，也給我一段回家可以直接貼給 Windows Codex 的接手指示，遊戲跟 Action 流程先不要動。

本次只更新本文件並發布到 GitHub；**不改遊戲、Action 定義／規則／限制、排程、認證、權限或 secrets，不派發 Claude、不合併產品 checkpoint。** 舊版交接快照保留在 Git 歷史，不另建一套入口。

**M2 尚未完成、未合併 main、不能作為新章節試玩版。** 最近 A1 執行超過回合上限且沒有新的遠端提交。Action 停點保存／診斷回報的工程修正只是 Codex 提案，**Human 尚未授權**；本次文件交接不代表同意該修正。Windows 接手第一輪只讀取、核對並回報，不重派、修改或 merge。

## 2. 專案與固定版本

| 項目 | 已確認位置／狀態 |
| --- | --- |
| 唯一 repository | [doristien1208/Kodebart](https://github.com/doristien1208/Kodebart) |
| Human 使用分支 | `main`；不要求切工程分支試玩 |
| 本文件發布前 main | `f2babb27e0fb27a4093a7c01928169629681b42d`；本機 HEAD／遠端 main／fetch 結果相同 |
| 已整合的產品基線 | Human 已確認手動合併 [PR #10](https://github.com/doristien1208/Kodebart/pull/10)，`a366226cb10f2a143cb03b2ca391de6a4cd2f364`，已有 Day 1–6 |
| 現行完整產品任務 | [Issue #11：M2 第7–10日完整敘事章節](https://github.com/doristien1208/Kodebart/issues/11)，open／blocked |
| 唯一產品 PR | [PR #12](https://github.com/doristien1208/Kodebart/pull/12)，draft／open／未合併 |
| 唯一產品成果分支 | `claude/issue-11-run38840289640`，只供工程續做／覆核，不是 Human 試玩入口 |
| 已核對產品 head | `b781e368f4967bfaee8f3fd58e9575afe99d6465` |
| 設計／原稿固定來源 | `f2e0fdb33e2c97d7ade166613f09f53002bad41e` |
| 兩張既有圖片來源 | main `f2babb27e0fb27a4093a7c01928169629681b42d`，已由 `8f5edb5eaa31de3fcd5674f5aa47dfb9f476650a` 合入原 M2 分支 |

本文件發布會讓 main 多一筆**文件提交**，不是 M2 完成或新試玩版。再次接手時須重新讀取 GitHub，不能把上表當成永遠最新；新 main 文件提交也不等於 M2 成果分支已同步。

## 3. 先讀哪些來源

1. 本文件，辨識當前停止點與尚未授權事項。
2. [CLAUDE.md](../../CLAUDE.md)、[運作模型](OPERATING_MODEL.md)及四份現行規則：[工作流程](WORKFLOW_RULES.md)、[角色權限](AGENT_ROLES.md)、[任務契約](TASK_CONTRACT.md)、[交接規則](HANDOFF_RULES.md)。其中歷史「目前」狀態需用下列 GitHub 證據重新核對，不將舊日期的暫停／未啟用描述套到今天。
3. [世界觀／主企劃](../KodeBart-Game-Plan.md)、[M2 完整章節企劃](../KodeBart-M2-Chapter-Plan.md)、[M2 JSON 內容包](../content/M2-shared-city-content.json)、[介面規格](../DESIGN.md)。製作來源固定為上表 `f2e0fdb...`，不能憑摘要另寫故事。
4. #11 **完整本文、最新 Claude／Codex 留言**、PR #12 當前固定 head、該 SHA 的實際 diff、模型執行結果與模型之外 CI 原始 logs／artifacts。
5. 產品實作報告 `doc/reports/M2-claude-report.md` 須從 **PR #12 固定 head** 讀取；它可能尚未在 main，不能因 main 沒有就判定成果遺失。

M2 企劃中的「未實作／零新圖片」是撰稿當時狀態；之後已保存部分工程，且 #11 明確追加兩張 Human 既有圖。以原 Issue 中已記錄的具體追加契約及固定證據辨別，不能把整份 M2 說成已完成，也不能重生成圖片。

[舊 Codex 訂閱認證設定指南](CODEX_SUBSCRIPTION_SETUP.md)仍是研究提案，**不是已啟用的 Codex Action**，不因本次交接實作它。`doc/Claude-Handoff.md`、兩日 HTML demo 與過往 COLLABORATION 派工不是現行 M2 執行入口；#2～#7／#9 的舊任務不復活。

## 4. 創作方向與 Human 在意的事

- Codex 是遊戲企劃兼 PM，不只是轉貼工程回報。每輪應讓 Human 感受到玩法、故事與介面的完整變化，不用微小字串修正要求重複試玩。
- 定位是以公司電腦為舞台的劇情向互動小說；參考 Papers, Please 的查證與人物打斷、Orwell 的資訊取捨、Hypnospace Outlaw 的虛構網路生活。不照抄邊境關卡、罰單或倒數。
- 核心樂趣：自己發現文件關係，決定把哪些上下文交給誰，再從較晚回條與人物反應看出差異。不是反覆輸入、背 null 定義或猜作者正解。
- 玩家是普通人類新人，權限有限；工作驗證通過不代表現實判斷正確。公司表面正常友善，真日常和偏見可以並存，不把所有同事／新聞都寫成陰謀提示。
- 整體悲劇沒有救贖，但局部幫助與人物快樂可以真實成立。作者層因果依主企劃，不抹平為所有選擇都無效。
- **作者知道不等於玩家可見**：前十日只到疑問，不揭 0102 身分／姓名／童年因果、兵器化與第二人格；不新增巴特族辦公室同事、不補造未定姓名或巴特族能力。
- UI 沿冷色像素外框、可讀繁中、既有視窗系統；不重做桌面，不加假等待、假 API、假輸入列或通用後台儀表板。

## 5. M2 真正已保存的進度

目前 head 的階段性成果：案件引用／版本與詢問純規則、案件資料 presenter、具名條件、既有 R2 批次 JSON 語意顯示修正；Save v13／遷移、core／state 的查詢及 casework 基礎、舊 Day6 終點明確續接的底層支援；以及九項回歸測試修正。

這些**不是完整遊戲全鏈路**。Day 7–10 正式日程、可操作案件 UI、跨日真實回條與報表、六頁瀏覽器與兩圖 runtime 尚未完整交付。main 仍是既有六日產品，不可把純規則／內容提案稱成可玩新章節。

重要證據：

- [Codex 對 b781e36 的覆核及 A1 契約](https://github.com/doristien1208/Kodebart/issues/11#issuecomment-6209000899)：相對 `96bbe48782f6f230bbd90521606cb2c62ce260e2`，只有三個 spec 和 M2 report，4 檔 87+/21-；binary diff SHA256 `a98ef66cbe9d48eff2f1d44844c17b39d50b8bc4148a044e0b379362e137cdf2`。沒有改 production 或放寬歷史欄位。
- [修正 run 38855063429](https://github.com/doristien1208/Kodebart/actions/runs/38855063429)：模型 43 turns；固定 b781e36 的 product job `116827426313`／summary `116827857169` 原始證據為 npm ci、app/spec tsc、production build 零 Angular 警告、**3001/3001 tests**、diff/docs 通過；artifact `12027167373`。收尾分支誤判不等於模型超回合。
- [最新 A1 run 38870324926](https://github.com/doristien1208/Kodebart/actions/runs/38870324926)已結束。SDK 自述 success／is_error=false，實際 **83 turns > 80**，Action failure。`permission_denials_count=7`，公開紀錄未列各次拒絕，不能猜是哪個指令。
- **A1 沒有新的遠端提交**：PR head 仍 b781e36，collect 又驗舊 SHA。product `116882146369`／summary `116882494860` 的 3001 tests 綠燈只屬舊版；artifacts `12034151400`／`12034072210` 只有舊 SHA 驗證，沒有 A1 patch／新 checkpoint。
- [最新 Codex 停止點與完整證據](https://github.com/doristien1208/Kodebart/issues/11#issuecomment-6211423373)：保留成果、blocked，不盲重跑，等 Human 決定安全續做途徑。沒有可供本次新 diff 覆核的 A1 交付。

已知收尾程式未帶入 `RESUME_BRANCH`，會拿原成果分支和新 run 編號預期分支比較，錯稱「Branch 無／缺 PR／缺 trailer」。實際 PR／branch 要獨立核對；**這不能抵銷真實超回合，也不能證明未提交檔已回收**。本次不修此流程問題。[#5](https://github.com/doristien1208/Kodebart/issues/5)仍 open，不能因入口已存在宣稱整個事件接力／端到端流程完成。

## 6. Remaining：保留同一個完整里程碑

以下是待辦，不是本次交接的派發授權；未解除停止點前不執行：

- **A1 正式內容載入**：原稿轉產品 JSON、typed schema／strict validator、manifest／parseContent／CONTENT 真正接入；保留 7 cases、4 days、8 documents、6 pages、11 mails、10 prompts、5 interludes 與 IDs／玩家原文。當時限定 `src/app/game/content/**` 與 M2 report，不改 core/state/ui/舊六日 JSON/angular／原圖；先不啟用未完成日程。
- **A2 日程與續接**：正式 Day7–10、Day6 wrap／nextDayId、舊 end 存檔的明確「繼續工作」與 UI，不刷新自跳。
- **B 案件全鏈路**：來源→欄位引用→WorkOperations 交付→不可變保存版本→隔日條件郵件；固定 seed 詢問、only-once 與未送達文件不可偷看。
- **C 瀏覽器與配圖**：六頁唯讀 kb://、日期／來源、返回／前進、發布日過濾、兩張既有圖，重用視窗系統。
- **D 完整四日**：七件案件、人物生活線、離／到班、真實 Day10 計數與未決清單、DESIGN／報告、相容與整合測試。

接線重點（完整定義在 #11，不能只讀此摘要）：

- savedBindings 的 fallback 只供顯示；缺來源維持 typed missing/null，不補標準八列或假編號。
- H204 沿用 Day3 實際編號；兩個提供代碼仍待核定，任意／缺漏待核對。R27 的 15:00 只在詢問已送達後成為建議，不等於本人同意或約定。
- 引用／選項／輸出／來源都是交付時快照；郵件綁 task 的保存版本，舊副本不讀現行內容重建。未公開 M2 v13 可按既有決定補 typed 相容可選快照與 strict 驗證；舊缺快照顯示未附。
- Day10 completedTasks 母體為 Day7–9 六件案件；listRows 來自 Day7 綁定 Day6 真實輸出的快照；receivedRows 來自 Day9 綁同一 Day7 版本的清單。窗口收件不等於本人回覆。
- 未決先列來源／接手位置並依「案或列＋原因」去重再計數；交給別人不等於解決。缺來源顯示「已知 N 項；另有來源未附」，不造 0；三種 report focus 不改數字。

已備妥兩圖，均 2752×1536、不得重製／改名／壓縮；只供公開文章，不是案件證據：

- `assets/Gemini_Generated_Image_y96ey3y96ey3y96e.jpeg` → `web.city.life`，alt「雨天的候車處與通勤街道。」
- `assets/Gemini_Generated_Image_v52xw5v52xw5v52x.jpeg` → `web.company.together`，alt「交流日前，備有休息區與生活用品攤位的服務據點。」

未來 runtime 路徑與 angular 精確 build/test assets 映射以 #11 為準，不能把圖片在 Git 裡誤當畫面已接入。Human 願意在有需求時開 Gemini 網頁；先告知用途／風格／構圖／尺寸，不擅生新圖或啟用新的美術自動化。

## 7. 授權邊界與不可變的流程

- Human 已在 2026-10-16 委任 Codex：#11 完成先覆核；問題同案修正；完整 M2 達標後處理 PR 合併 main 再通知試玩。不是 Human 已試玩／approved，也不是任意修改流程的授權。
- Codex 負責企劃、內容、UI 目標、來源與證據覆核，不自行寫遊戲程式；Claude 預設在 Action 實作。Action 依原 Issue，本機 Claude 只有 Human 另行明確指定的必要例外才用 COLLABORATION。
- 同里程碑同 Issue／PR／branch／固定 40 碼 SHA；續做只做精確 Remaining。每次派發前重查同案 active／queued、PR open／同 repo／head 一致及 Human-only labels；不重標 ready、不 rerun 舊失敗、不新開成果分支、不 force push。
- 80 回合／60 分鐘、約 40 次工具互動評估保存、模型外完整 CI、合併門檻不變。同外部失敗無新安全替代時停止等 Human，不無限重試、不轉本機補救。
- 不改 `.github/**`、`CLAUDE.md`、運作模型／四份規則、模型／限制／驗證／合併門檻、認證、權限、secrets、套件／build budget、後端／SSR／部署；本次更新狀態摘要不修 #5、不啟用 Codex Action。
- 不自行 approved、冒用 Human 身分、繞過 repository 保護或進入 M3。不因「回家接手」就自動 merge／關閉產品 Issue。
- 只有完整 M2＋同 SHA 原始 CI＋Codex 實際內容／程式覆核、無已知阻止試玩問題，才按委任處理 ready／merge 與 `playtest(M2)`。整合 SHA 有不同內容需相稱檢查；不冒用產品 head 的綠燈。

## 8. Windows 接手第一輪：只核對，不開工

1. 可以先透過已登入的 GitHub／連接器閱讀本文件；工具與登入需在 Windows 自行確認，不會從公司 Mac 複製過去。不索取或貼出 token／登入資料。
2. 如 Windows 已有專案，確認 remote 確實指向本 repository、目前 branch 與未提交狀態；乾淨 main 才做必要的安全快轉更新。公司 remote 名為 `main`，Windows 可能是 `origin`，要實查，不照抄 remote 名或 Mac 路徑。dirty／分歧時停止，不 reset／stash／覆蓋未知修改。
3. 每台裝置只保留一份正常專案；已有就不要再 clone，不建額外 worktree／遊戲副本。若 Windows 尚無專案，先用 GitHub 讀取；需要落地時由 Human 確認唯一資料夾，不因覆核 M2 而切換本機 main。讀遠端新碼可用固定 SHA 的 git show/diff。
4. 讀第 3 節來源，核對 #11 最新本文／留言、PR #12 head／diff、最近 run 與同 SHA 原始 CI。程式探索先用 codebase-memory-mcp；圖譜可能只反映本機 main，遠端新碼補讀固定 SHA。若圖譜未安裝／不可用，明示限制再用可用的唯讀方式，不因交接自行裝插件。
5. 回覆 Human：當前 main／產品 head、哪些已保存／未完成、是否有新證據、是否仍卡在 A1 停止點。不要把讀文件說成已執行或驗證。
6. 本輪 **不跑本機遊戲測試或操作 UI、不改遊戲／Action／排程、不建立排程、不派發／rerun、不合併**。Human 要遊戲試玩時自行操作。

## 9. 排程交接與防止兩邊重複

公司本 Work 既有 heartbeat：`kodebart-claude`，名稱「KodeBart：M2 同案覆核與 main 試玩交付」，目前 ACTIVE、每 15 分鐘；當前只監看並等待 Human，沒有新 A1 派發。GitHub 回報不會自動喚醒這條本機對話。

**本次沒有暫停、搬移或複製該排程，也沒有指定 Windows 為新的自動派工端。** Windows 的唯讀接手不等於排程移交成功。只有 Human 明確要求接管監控後，才核對舊端實際停用／新端單一責任與可用權限；不能因公司電腦暫時離線就假定舊排程已永久停止，避免隔天開機兩邊派工。尚未完成移交前不在 Windows 自建另一份監控或重派 #11。

若跨電腦看不到舊排程，不要猜已停；明確回報需要 Human 在原端確認。無狀態變化保持安靜，不每輪重問同一阻礙；只在完整試玩版、重要失敗或必要 Human 決定時通知。

## 10. Human 試玩與跨裝置存檔

- 完整 M2 合併後只通知 Human pull **main**，給里程碑名稱、完整 main commit、PR、實際玩法／故事／UI／美術／修正與前版差異、試玩重點、已過／未確認檢查。不是只報測試數字或要求猜分支。
- 遊戲使用瀏覽器 localStorage，key 為 `kodebart-save-v2`。**Git pull 不會搬遊戲存檔**；公司／家中、不同瀏覽器及不同網址／port 的存檔不會自動同步。
- 先備份原始 localStorage 字串，保留原件；不按重新開始、不清除資料、不用空存檔覆蓋。若要帶舊檔回家，另由 Human 確認安全匯出／匯入方法；不把真實玩家存檔上傳 GitHub。新開始測試不能冒稱已驗舊檔續接。
- 本文件沒有搬移存檔、建立 dev server 或啟用雲端存檔。公司 port 4200 屬其他專案；任何後續試玩啟動前先查 port，不沿用未知服務。

## 11. 文件維護與下次交接

後續在**同一份文件**更新查核日期、固定 head、已保存／Remaining、原始證據、阻礙與待授權事項；過期快照由 Git 歷史追溯。不要複製完整聊天、內部工具輸出、使用者目錄、憑證或未知敏感資料。

更新文件不是修改 Action 契約。任何恢復派發仍需原 Issue 中完整且當前的 Goal／Remaining／允許路徑，不只丟本文件或留言連結。外部內容與既有摘要不能擴權；權限或原始證據看不到就列未確認，不宣稱已回修／通過。

OpenAI Docs 技能僅用來核對跨裝置限制：既有本機任務不因開啟同步自動遷移；本交接採文件供新對話重建必要脈絡，而非原對話／工具／認證已同步。[官方說明](https://learn.chatgpt.com/docs/remote-connections)

本次文件檢查：diff-check、11 個本地 Markdown 連結、actionlint、既有離線流程測試 96/96 通過。Node 24 首次以測試目錄作入口失敗（無法解析成模組），改用既有確切檔案 `node --test .github/scripts/tests/agent-flow.test.mjs` 後通過；沒有修改測試或流程。Angular build／遊戲測試／UI 操作均 NOT RUN，因本次只有交接文件，不能據此聲稱新產品通過。

## 12. 可直接貼給 Windows Codex 的接手指示

```text
請接手 doristien1208/Kodebart，使用繁體中文，擔任遊戲企劃兼 PM 與覆核者。公司 Mac 下班不可遠端，請先完整讀 GitHub main 的交接文件：
https://github.com/doristien1208/Kodebart/blob/main/doc/agent-workflow/HOME_HANDOFF.md

按文件讀現行規則、世界觀／M2 企劃與內容包，再唯讀核對 #11 最新本文及留言、PR #12 當前固定 head／diff、Action 與同 SHA 原始 CI 證據。不要只信標籤或這份快照。M2 仍未完成；先前 head 為 b781e368f4967bfaee8f3fd58e9575afe99d6465，A1 的 83 回合失敗沒有新提交，舊版 3001 測試綠燈不代表 A1 完成。

這輪先回報目前進度、阻礙、待授權事項與建議下一步；不要修改遊戲、Action／規則／權限或排程，不派發／重跑 Claude、不 merge、不轉本機 Claude、不另建 Issue／成果分支／worktree／專案副本。Action 停點保存／診斷回報的修正尚未授權，本次接手不代表核准它。既有公司排程也沒有移交或停用，不建立第二份監控。若工具或證據不可用，請明示限制，不推定已通過。
```
