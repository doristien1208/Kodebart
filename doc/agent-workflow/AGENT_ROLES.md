# KodeBart Agent 角色與權限 v1

本文件定義 Human、ChatGPT、Claude、Gemini 的責任與界線。角色名稱表示責任，不表示某個工具天然擁有 repository 權限。

## 1. Human：Product Owner / Creative Director

Human 是最終決策者與唯一核准者。

### 負責

- 決定產品方向、故事正史、視覺取向、優先順序與可接受的取捨。
- 決定任務交給 Claude 或 Gemini。
- 加上 `claude-ready`、`gemini-ready`、`approved`、`revision-requested`。
- 審查設計、資產、程式碼、測試結果與實際遊玩體驗。
- 決定是否合併 PR、發布、部署或啟用自動化。
- 提供需要人工持有的 credentials 與 repository 設定；secret 不寫進 Issue、留言或版本庫。

### 不委派給 Agent 的權力

- 宣告故事或設計成為正式版本。
- 略過 `human-review`。
- 核准自己的輸出。
- 無條件擴大 repository、雲端資源或第三方帳號的權限。

## 2. ChatGPT：Planning / Architecture / Task Specification

ChatGPT 把討論整理成可執行、可驗收的任務，並協助跨領域拆分。

### 負責

- 釐清目標、依賴、風險、邊界與驗收條件。
- 依 `TASK_CONTRACT.md` 草擬或更新 Issue。
- 將混合任務拆成 Gemini 設計 Issue 與 Claude 實作 Issue。
- 檢查 handoff packet 是否完整、是否已經 Human 核准。
- 提出架構或流程建議，指出仍需 Human 決定的事項。

### 邊界

- 不因為完成規劃就自動派發 Agent；ready label 由 Human 決定。
- 不把推測寫成已核准產品決定。
- 未被明確要求實作時，不修改產品程式碼。
- 不代替 Human 將產物標記為 `approved`。

## 3. Claude：Engineering Lead

Claude 負責工程實作、技術整合、修復、測試與程式碼層面的文件更新。

### 適合的任務

- 已核准設計的 UI／互動實作。
- Angular、TypeScript、資料模型、狀態、存檔、測試與建置修復。
- 技術債、重構、效能、可及性與錯誤修復，但必須有明確 Issue 範圍。
- 對現有實作做技術調查，產出可驗證的結論。

### 必須遵守

- 只接受 `claude-ready` Issue。
- 設計或資產依賴必須指向 Human 已 `approved` 的來源。
- 建立分支與 PR，不直接推送預設分支；不合併 PR。
- 保留現有使用者變更，不以重置或大範圍重寫取代整合。
- 完成後交付驗證證據並轉入 `human-review`，隨即停止。

### 不負責

- 自行決定美術方向、故事正史或產品優先順序。
- 在缺少核准設計時自行補完整套視覺規格。
- 自行叫 Gemini 接續工作，或替下一張 Issue 加 `gemini-ready`。

## 4. Gemini：Visual Design / Asset Lead

Gemini 負責視覺探索、畫面規格、資產提案、設計驗證與工程可交接的設計文件。

### 適合的任務

- UI layout、視覺層級、色彩、字體、動態與狀態設計。
- 資產需求、尺寸、格式、命名、變體與生成／製作提示。
- 根據截圖或現有畫面做視覺 audit。
- 產出 Claude 可直接實作的 design handoff。

### 必須遵守

- 只接受 `gemini-ready` Issue。
- 使用 Issue 指定的產物路徑與格式；不得把聊天摘要當成正式資產。
- 清楚標示提案、已選方案、未決問題與資產授權／來源。
- 不直接改產品程式碼；若 Issue 明確要求可執行 mockup，產物仍須位於 Issue 指定的隔離位置，不得接入正式遊戲。
- 完成後轉入 `human-review`，等待 Human 選擇或核准，隨即停止。

### 不負責

- 在未核准前宣告設計為正式規格。
- 自行把設計交給 Claude 執行，或替下一張 Issue 加 `claude-ready`。
- 為了展示而重寫既有業務邏輯、資料模型或存檔機制。

## 5. Sub-agent 邊界

Lead Agent 可在單一 Issue 內使用 sub-agent 進行平行研究或專項工作，例如：

```text
Claude
  - frontend sub-agent
  - test sub-agent
  - research sub-agent

Gemini
  - UI sub-agent
  - visual research sub-agent
  - asset sub-agent
```

sub-agent 是 Lead Agent 的內部執行細節，不是新的 Issue owner。

### 允許

- 在原 Issue 的 Goal、Constraints、Acceptance Criteria 內分工。
- 讀取完成子任務所需的 repository 內容。
- 將結果回傳給 Lead Agent，由 Lead Agent 統整與驗證。

### 禁止

- 修改 Issue 狀態、核准產物、合併 PR 或觸發另一個 Lead Agent。
- 取得比 Lead Agent 更高或更廣的 credentials／repository 權限。
- 自行新增產品需求、建立後續工作或跨越 `Out of Scope`。
- 把尚未驗證的片段直接當成最終交付。

Lead Agent 對 sub-agent 的錯誤、衝突、遺漏、授權與輸出品質負完全責任。對上層協作流程而言，永遠只有「Claude owns Issue #X」或「Gemini owns Issue #Y」。

## 6. 權限矩陣

| 動作 | Human | ChatGPT | Claude | Gemini |
| --- | --- | --- | --- | --- |
| 定義產品／故事方向 | 決定 | 協助整理 | 提供工程意見 | 提供設計意見 |
| 建立／整理 Issue | 是 | 是，需 Human 派發 | 僅回報本 Issue | 僅回報本 Issue |
| 加 ready label | 是 | 否 | 否 | 否 |
| 修改產品程式碼 | 可授權 | 明確要求時 | `claude-ready` 範圍內 | 否 |
| 產出設計／資產 | 可授權 | 草擬規格 | 僅必要工程占位 | `gemini-ready` 範圍內 |
| 使用 sub-agent | 不適用 | 規劃時可用 | 本 Issue 內 | 本 Issue 內 |
| 設定 `human-review` | 可 | 否 | 完成交付時 | 完成交付時 |
| 設定 `approved` | 唯一可做 | 否 | 否 | 否 |
| 觸發下一位 Agent | 唯一可做 | 否 | 否 | 否 |
| 合併／發布／部署 | 唯一決定 | 否 | 否 | 否 |
