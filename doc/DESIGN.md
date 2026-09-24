---
version: R12-target
name: KodeBart desktop
description: 冷色像素電腦桌面與正常、友善的公司應用程式
colors:
  background: '#0b1424'
  surface: '#14253a'
  elevated: '#20364d'
  primary: '#91d8df'
  text: '#e3edf5'
  muted: '#a6bbce'
  border: '#46617b'
  error: '#ffb8bc'
typography:
  body: '"Chocolate Classical Sans", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif'
  heading: '"Saira", "Chocolate Classical Sans", "PingFang TC", sans-serif'
  mono: '"SFMono-Regular", Consolas, "Chocolate Classical Sans", monospace'
rounded: '0px'
---

# KodeBart 介面規格

## 狀態與適用範圍

使用者已確認：封面與內部風格一致、有電腦桌面感、公司平台只是其中一個應用、可控視窗、通用郵件及黑底白字入職。本文具體配置為 Codex 本輪設計決定，交 Claude 實作後仍待試玩；不是目前畫面已符合的宣告。保留既有封面構圖與標題字體，不重新生成封面。

## 視覺方向

冷色像素工作電腦：直角外框、清楚像素圖示、硬邊陰影、精簡視窗標題列與桌面視窗列。公司內頁乾淨、普通、友善；不以紅色機密章、監控符號、掃描線、故障字或霓虹營造邪惡。像素風作用在框架與圖示，不把中文正文像素化。

桌面背景可用低對比 CSS 點陣，文件／聊天內文保持純色。沒有玻璃模糊、漂浮統計卡或裝飾 dashboard。所有入口均可操作，不做一整套假作業系統。

## 字體與密度

- 正文、聊天、表單：Chocolate Classical Sans 400，16px／1.65；日期／寄件資訊 14px／1.5，不用 12px 長文。
- 英文應用標題、視窗標題、導航：Saira 500／600，16–20px；中文回退 Chocolate Classical Sans 400。中文層級靠大小、位置與色彩，不合成粗體。不把所有按鈕放大成海報。
- JSON、命令與識別碼：現有系統等寬字 14px／1.6；保留縮排、捲動、選取。不以非等寬標題字取代程式碼。
- 入職：同一正文字體，18–22px，白字黑底；合約正文16px。保留引號與段落，不加 glitch。
- 不載入 Share Tech、Smooch Sans、Titillium Web、Orbitron，避免多套字形競爭。字型 display: swap；遠端失敗仍可操作，不等待字型才進遊戲。
- 官方參考：[Saira](https://fonts.google.com/specimen/Saira)、[Chocolate Classical Sans](https://fonts.google.com/specimen/Chocolate+Classical+Sans)。後者目前提供 regular 400，不指定不存在的粗體檔。

## Token 所有權

保留上述色碼，src/styles.css 共用 token 為實作唯一來源；元件與 Tailwind 引用，不各自複製色碼。本文件記錄目標用途，執行 token 更新後同步此處；不再以舊 HTML 原型的 :root 作準。

| 規則 | 用途 |
| --- | --- |
| background / surface / elevated | 桌面、應用內容、標題列與浮層 |
| primary / text / muted / border | 操作焦點、主文字、次文字、邊界 |
| error | 輸入／儲存錯誤，不是道德判斷 |
| 4、8、12、16、24px 間距 | 圖示、控制項、表單與區段；主要內距16px |
| 0 圓角、1px 內框、2px 視窗外框 | 統一桌面風格 |
| 4px 4px 0 硬陰影 | 區分前後視窗，不做大光暈 |
| 16／20px 圖示，至少44px點擊區 | 圖示精簡但可操作 |

狀態同時有文字，不只靠顏色。正文採 rem、允許縮放；全域 scrollbar 維持標準屬性與 WebKit fallback，forced-colors 尊重系統色。

## 桌面與資訊分工

- 桌面提供工作平台、通訊、郵件三個入口；底部視窗列常駐，只列真的開啟／最小化視窗。首次登入自動開工作平台，可最小化回桌面。
- 工作平台：左側單組功能導航、中央目前工作／佇列；右上顯示玩家姓名與「資料作業組」。不再雙 group、不留右側 TODAY 或固定 log 空欄。
- 通訊：對話列表、聊天時間線、固定回覆選項。窄視窗先列表再對話，保留返回入口。日期採實際遊戲日期，不用 Day N 當聊天室名。
- 郵件：信件列表與閱讀區；窄視窗依次呈現。主旨、寄件者、日期、正文、附件層級明確。案件待處理不等同信件未讀。
- 文件與 terminal：桌面層獨立視窗，前者呈現固定版本／新修訂，後者呈現實際遊戲作業紀錄；兩者不占正文欄寬。
- 桌面限定 viewport，捲動由各視窗內容區負責，標題列／視窗列不捲走。表格可橫向捲動，表單不得被表格高度裁掉。
- 小於700px／放大後放不下時採單視窗最大化、底部切換，不強迫拖動找按鈕。還原後限制於可見範圍，提供重設位置。

## 共用元件與狀態契約

| 介面 | 唯一責任與必要行為 |
| --- | --- |
| WindowShell + WindowManager | 同一套標題列、拖移、置前、最小化、最大化／還原、關閉與焦點；作用於桌面，不各頁另造 |
| 視窗 icon | 減號、方框／雙框、叉號；繁中 aria-label、tooltip、focus-visible；按鈕不觸發拖曳 |
| 主選單 | icon 入口＋有文字的選項；Escape 關閉並返回焦點；不加無功能設定 |
| 郵件附件 | caseId＋receiptId＋版本；舊附件唯讀，當前退件可建立新修訂；找不到附件不誤開最新 |
| 紅點 | 依實際送達／已讀 ID 計算，附 accessible 未讀說明，不靠路由進出推算 |
| 提示／對話框 | 一般狀態不打斷；覆蓋存檔用既有 modal、取消優先焦點；不每次送件都多加確認 |
| 表單 | 原生 input／radio＋label，錯誤文字及 aria-invalid；編號不驗來源相符 |
| 前情／合約 | 前情可補完當段；合約一次顯示、明確簽名；輸入組字不推進 |

關閉文件與切換應用保留草稿，再開啟仍檢查版本。郵件／通訊的載入中、空內容、讀取錯誤各有短文案與恢復方式，不白屏。提交中防重複，失敗保留輸入並可重試。

延用 log 作業節奏，不加假網路等待，也不讓每個元件都打字。前情尊重動態設定及 prefers-reduced-motion，不閃爍。新增圖像需求為零，用 SVG／CSS 完成圖示與邊框。

## 驗收邊界

Codex 本輪僅產出設計規格、內容 JSON 與原始碼覆核，未執行 build、測試或介面操作，不宣稱字型排版／響應式已驗證。Claude 實作自驗後由使用者試玩，特別檢查可讀性、視窗重疊、放大與小螢幕、中文輸入、刷新續接與紅點。無新音訊、未定角色外觀或提前暴露世界觀的裝飾。
