# 原型參考檔

這裡是 Codex 交接包中的原型來源與驗證腳本，**僅供比對移植**，不是 Angular 專案的一部分。

- `prototype-source.html`：未內嵌背景的 vanilla JS 原型（Angular 移植的來源）。
- `build-prototype.cjs`：把 `assets/kodebart-cover.png` 內嵌成單檔 `KodeBart-UI-Demo.html`。
- `verify-core.cjs`：對 `KodeBart-UI-Demo.html` 做核心規則檢查。
- `Core-Test-Results.json`、`premium-audit.json`：原型當時的驗證輸出。

兩個 `.cjs` 腳本以自身所在目錄為根目錄尋找 `assets/` 與 `KodeBart-UI-Demo.html`，在此資料夾直接執行會找不到檔案。要重跑請把它們放回原交接包（`~/Downloads/kodebart-handoff/`）或自行調整路徑。內嵌後的 2.5 MB HTML 未收進 repo，可由 `build-prototype.cjs` 重新產生。

Angular 版的對應測試在 `src/app/game/core/*.spec.ts` 與 `src/app/game/state/*.spec.ts`（`ng test`）。
