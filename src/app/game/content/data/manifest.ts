import { ContentSource } from '../schema';
import day01 from './days/day-01.json';
import day02 from './days/day-02.json';
import day03 from './days/day-03.json';
import day04 from './days/day-04.json';
import day05 from './days/day-05.json';
import day06 from './days/day-06.json';
import refusalRecordHelp from './help/refusal-record.json';
import returnReceiptsMail from './mail/return-receipts.json';
import firstArrival from './onboarding/first-arrival.json';

/**
 * game/content/data/manifest：每日內容檔的唯一清單（R6-03）。
 *
 * 依日序列出；bundle.ts 只讀這裡，不再各自 import 每日檔。
 * 新增一天：在 days/ 加檔，並在下面加一行 import 與一筆 DAY_SOURCES（`file` 為錯誤訊息用的相對路徑）。
 * `data` 保持 unknown：型別收斂只在 validate-content.ts 的 parseContent() 驗證通過後進行。
 */
export const DAY_SOURCES: readonly ContentSource[] = [
  { file: 'data/days/day-01.json', data: day01 },
  { file: 'data/days/day-02.json', data: day02 },
  { file: 'data/days/day-03.json', data: day03 },
  { file: 'data/days/day-04.json', data: day04 },
  { file: 'data/days/day-05.json', data: day05 },
  { file: 'data/days/day-06.json', data: day06 },
];

/**
 * R12 內容包的唯一清單：郵件包（data/mail/）、入職前情包（data/onboarding/）、詢問說明包（data/help/）。
 * 新增一個郵件包或詢問說明包：在對應目錄加檔，並在這裡加一行 import 與一筆來源；bundle.ts 不需要改。
 * 退件回條包（mail.return-receipts）必須存在；`data` 同樣保持 unknown，驗證通過後才收斂型別。
 */
export const MAIL_SOURCES: readonly ContentSource[] = [{ file: 'data/mail/return-receipts.json', data: returnReceiptsMail }];

export const ONBOARDING_SOURCE: ContentSource = { file: 'data/onboarding/first-arrival.json', data: firstArrival };

export const HELP_SOURCES: readonly ContentSource[] = [{ file: 'data/help/refusal-record.json', data: refusalRecordHelp }];
