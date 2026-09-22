# KodeBart 企劃與兩天 Demo 交接包

## 先試玩

下載或解壓縮後，用瀏覽器開啟 **KodeBart-UI-Demo.html**。封面已內嵌，不需要伺服器、套件安裝或網路。開始遊戲 → 歸檔三筆資料 → 完成今日交接 → 第二天比對摘要 → 提交回覆。

這是簡易HTML互動稿，不是正式Angular Demo。瀏覽器環境限制使本輪無法完成視覺及完整操作驗證；已完成語法與核心規則檢查，見Verification.md。

## 文件

- KodeBart-Game-Plan.md：主遊戲企劃、已確認設定、舊案與未定事項。
- KodeBart-Demo-Spec.md：兩天逐步玩法、文案、資料規則、結果矩陣與驗收。
- Claude-Handoff.md：交給Claude的開發範圍與整合指令。
- DESIGN.md：冷色像素風的開始頁與UI規範。
- Artwork-Brief.md：封面構圖、素材用途與生成提示詞。
- Verification.md／Core-Test-Results.json：實際驗證與限制。

## 原型來源

- prototype-source.html：未內嵌背景的編輯來源。
- assets/kodebart-cover.png：完整封面背景，不含標題與按鈕。
- build-prototype.cjs：執行 `node build-prototype.cjs` 產生單檔HTML。
- verify-core.cjs：執行 `node verify-core.cjs` 檢查核心規則，不啟動瀏覽器。

本機存檔只屬於當前瀏覽器環境；不是跨裝置雲端存檔。重新開始會提示覆蓋。純前端原型的隱藏狀態可由開發者工具讀取，不代表正式後端安全邊界。

本輪未存取使用者電腦專案、未建立本機Work、未修改舊Google原稿、未連接Claude、未部署GCP。將本包放到使用者已建立的KodeBart專案中，再由Claude按交接文件整合。
