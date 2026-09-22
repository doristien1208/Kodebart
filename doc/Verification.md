# 驗證範圍與結果

本檔區分實際執行與未執行的檢查；不把靜態檢查當作瀏覽器驗證。

## 已執行

- `node verify-core.cjs`：完整內嵌JavaScript語法解析、來源函式的型別驗證、false/null × 有/無介入四格矩陣、1000個seed的可重現性與範圍、狀態JSON往返、內嵌封面與無外部網址檢查。結果見Core-Test-Results.json。
- UI skill strict static audit：0 errors、0 warnings、0 violations。這只代表靜態稽核，不能證明畫面或完整互動正常。
- DESIGN.md官方lint：0 errors；未被元件直接引用的文件色彩token有警告，實際CSS使用相同命名變數。邊框與文字語意在正文說明。

## 環境限制

Cloud Browser安全政策拒絕file協定，無法開啟此本機HTML。沒有改用其他入口繞過限制。首次獨立瀏覽器測試因缺少執行檔未開始，後續也未再執行。

未宣稱已驗證：實際瀏覽器兩日操作、localStorage不可用／損毀的實際體驗、鍵盤焦點、中文輸入法、手機390px排版、200%縮放、Safari／Firefox、讀屏、p5動畫、真人10–15分鐘節奏、使用者現有Angular專案、GCP部署。

Claude移植後應依Demo-Spec驗收條件跑完整流程。使用者可先下載KodeBart-UI-Demo.html，在自己的瀏覽器開啟；此檔包含封面，不需網路或安裝套件。
