---
version: alpha
name: KodeBart prototype
description: 冷藍像素夜間大廳與友善的公司工作介面
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
  body:
    fontFamily: '"PingFang TC", "Microsoft JhengHei", system-ui, sans-serif'
    fontSize: '1rem'
    lineHeight: '1.75'
  mono:
    fontFamily: '"SFMono-Regular", Consolas, monospace'
rounded:
  DEFAULT: '0px'
spacing:
  panel: '1.5rem'
  gap: '1rem'
components:
  button:
    rounded: '0px'
---

# KodeBart UI design reference

## Overview

試作設計，不代表完整正式設計系統。受眾為繁體中文玩家；桌機優先，手機可試玩。產品／遊戲混合：封面表現情境，工作台重視操作。記憶點是夜間接待廳右側的冷光走廊，左側清楚的遊戲標題與選單。工作台維持正常、友善的公司用語，不用故障特效預告陰謀。

這是新建的獨立參考稿，沒有可重用的既有元件或同專案畫面。token採runtime source ownership：HTML內`:root`為參考稿的唯一執行定義，此文件記錄相同值與用途。Angular移植由共享全域CSS接手，Tailwind僅引用變數，不各元件手抄色碼。

## Colors

frontmatter的background、surface、elevated、primary、text、muted、border、error分別對應`--background`、`--surface`、`--elevated`、`--primary`、`--text`、`--muted`、`--border`、`--error`。primary用於焦點與主要按鈕，error僅表示輸入格式錯誤，不代表道德立場。進度與驗證狀態同時使用文字。

## Typography

正文16px／1.75，次要中繼資訊14px。像素感由圖像、直角邊框與英文等寬字提供；不犧牲中文可讀性、不烘焙文字進封面。正文使用body stack，代碼用mono stack。封面中文標題可較大但不得擋住選單。

## Layout

開始頁滿版場景，左側菜單安全區约40%。工作台有頂列、左導覽、主要作業區與右側摘要；小於900px取消右欄，小於620px轉單欄與橫向導航。文件區自然捲動；不以全頁overflow:hidden壓縮表單。間距與字級以rem支援放大。

## Elevation & Depth

封面深度由插畫呈現。工作台以色階與邊框區分區塊，不用玻璃模糊、浮動統計卡或發光霓虹。對話框使用原生dialog的焦點隔離配合自訂樣式。

## Shapes

直角、1px框線；重點菜單2px。像素圖以pixelated顯示，不用CSS拼製大廳。不要以圓角膠囊、漸層大標題或儀表板KPI取代遊戲語彙。

## Components

共用button：主按鈕primary底深色字，次按鈕surface底text字；hover改亮，focus-visible清楚外框，disabled保留文字與邊框但減弱。最小高度44px。form及report用相同panel。

Canonical UI Map：Form由共用驗證函式与欄位訊息擁有；Scrollbar由全域CSS擁有；Status由頁面固定aria-live區擁有；Modal由native dialog擁有。無日期、搜尋、多選表格或下拉選單，無需新增這些元件。

歸檔處理使用原生radio配合可點label；輸入綁定錯誤說明與aria-invalid。提交為顯式按鈕，不以Enter全域快捷鍵送件，避免中文輸入法誤觸。返回工作區保存草稿。

全域scrollbar-color/width與WebKit fallback同時存在；forced-colors使用系統色。動態只有低強度菜單游標，可關閉且尊重prefers-reduced-motion。原型不附音訊。

重開存檔使用應用對話框，預設焦點在取消，Escape取消並恢復焦點。一般歸檔不多加確認對話框；預覽後明確提交即可。狀態區說明儲存失敗、不靜默吞錯。

## Do's and Don'ts

- 保留真實普通同事訊息；第一天讓玩家正常完成工作。
- 冷色像素是表現風格，不是每頁加「機密」「監控」「異常」字樣。
- 不在玩家可見UI放實作解說、seed、幕後判定或作者的道德提示。
- 不繪製0102的未定外觀；不靠血跡、牢籠、武器預告真相。
