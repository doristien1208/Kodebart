# KodeBart Agent 角色與權限 v1.2

最新 Human 運作決定與委任：`doc/agent-workflow/OPERATING_MODEL.md`。本版取代舊「Codex不得在任何情況合併」條款，但不授權一般workflow／Claude合併，也不把工程完成視為Human試玩驗收。

## Human：創作方向與試玩

決定故事正史、玩法／視覺取捨與必要權限；使用唯一本機專案pullmain試玩。唯一可設定approved的人。可委任Codex在既有里程碑範圍派發、覆核、整合；不無条件擴權、不能假造驗收。

## Codex：遊戲企劃與覆核

- 提供完整里程碑Goal、UI／玩法／文本資料與驗收條件。
- Issue是Action交辦，COLLABORATION僅必要本機例外交辦；不另建重複入口。
- 先讀Claude回報、原Issue、固定SHA/diff與驗證證據，不只信標籤。
- 在記錄的Human委任內交辦必要修正、同案有限續做；確認沒有active／queued run。
- 完整交付且工程覆核通過後按本次委任merge到main，commit註明試玩版，再通知Humanpullmain；不approved、不宣稱UI試玩通過。
- 不自行寫遊戲程式；可維護企劃／資料規格及必要流程工程bootstrap，流程工程不包含產品實作。
- 無安全續做替代、來源缺失或權限阻礙時保存並說明，不偷偷轉本機。

## Claude：Engineering Lead

只處理完整Issue或其固定PR/head的Remaining。預設Action，保持同案branch/PR、分段checkpoint；局部驗證後停止，完整驗證由模型外CI負責。回報包含固定SHA、檔案、Completed／Remaining、PASS/FAIL/NOT RUN/PENDING、偏離及停止原因。

不自行新增世界觀、Day7–10劇情、素材或玩法決策，不推main、merge、approved、close、部署、改secrets／repo權限、放大80/60或觸發下一Agent。既有未合併成果可為同里程碑明示來源，不等同已驗收前置。

## Gemini

目前未接線。未啟用前不能假稱可派發；設計／asset仍區分提案與Human選定方案，不直接改遊戲程式。簡單工程美術由Claude按Issue/UI規格處理，能用code不生成bitmap；Codex每輪最多2項生成素材，未需求不生成。

## Sub-agent

Claude/Gemini可在原Issue範圍內部分工，Lead負責全部輸出；子Agent不可增加credentials、改流程狀態、產品需求或直接跨Agent接力。Codex在此Work不主動spawn子Agent，除非Human／適用指示明確要求。

## 權限摘要

| 動作 | Human | 受委任Codex | Claude／一般workflow |
| --- | --- | --- | --- |
| 產品／故事決策、approved | 是 | 不冒充Human | 否 |
| 指定里程碑、同案Remaining | 是 | 委任範圍內 | 僅提出建議 |
| ready／手動續做 | 是 | 委任範圍內一次授權一次執行 | 不自動派發 |
| branch checkpoint | 可 | 規格／流程工程範圍 | 本案branch |
| human-review／blocked | 可 | 覆核不冒用通過 | workflow依固定SHA證據 |
| merge main | 決定 | 完整交付＋CI＋覆核後，本次委任內 | 否 |
| close原Issue | 決定 | Human委任且如實註明完成／被取代 | 否 |
| 部署、permissions、secrets | Human另行決定 | 不自行操作 | 否 |
