import { Phase, Reply } from '../core/types';
import { NAME_UNREGISTERED } from './records';

/**
 * game/content：對話、公告、報告與介面文案。全部為 Demo 試作文案，非正史。
 * 呈現層只讀取狀態並挑選文字，不得在此產生隨機效果。
 */

export const APP_TITLE_SUFFIX = ' · 錯誤世界';
export function pageTitle(text: string): string {
  return text + APP_TITLE_SUFFIX;
}

export const COVER = {
  eyebrow: 'K O D E B A R T',
  title: '錯誤世界',
  subtitle: 'ERROR OF THE WORLD',
  start: '開始遊戲',
  continue: '繼續',
  settings: '設定',
  noSave: '尚無本機紀錄',
  savePrefix: '本機紀錄：',
  footerLeft: '兩日試玩 · 入職',
  footerRight: 'A KODEBART STORY / 0.1',
  artAlt: '冷藍夜色中的接待大廳，窗外下著雨，走廊延伸到深處。',
  artSrc: 'assets/kodebart-cover.png',
  docTitle: '開始',
} as const;

export const PHASE_LABEL: Record<Phase, string> = {
  day1: '第一日',
  overnight: '第一日交接完成',
  day2: '第二日',
  end: '兩日試玩完成',
};

export const NEW_GAME_DIALOG = {
  heading: '開始新的紀錄？',
  body: '新的遊戲會取代這個瀏覽器中的試玩進度。',
  keep: '保留目前紀錄',
  start: '開始新遊戲',
} as const;

export const SETTINGS_DIALOG = {
  heading: '設定',
  motionLabel: '啟用選單動態',
  note: '本版沒有音訊。系統的「減少動態效果」設定會優先套用。',
  back: '返回',
} as const;

export const STORAGE = {
  readIssue: '無法讀取本機紀錄。你可以另開新遊戲；原紀錄會在確認後才被取代。',
  writeIssue: '本機儲存不可用。本次仍可遊玩；關閉或重新整理後可能失去進度。',
  saved: '本機紀錄已保存',
} as const;

export const WORKBENCH = {
  brandLead: 'K',
  brandRest: 'odeBart ',
  brandSuffix: '/ 工作台',
  role: '新進同仁 · E 級',
  backToCover: '返回開始頁',
  navGroupPersonal: '個人工作區',
  navGroupTeam: '資料作業組',
  navLabel: '工作區',
  nav: { work: '工作', messages: '訊息', news: '公告' },
  heading: {
    work: { 1: '今日工作', 2: '批次摘要核對' } as Record<1 | 2, string>,
    messages: '同事訊息',
    news: '公司公告',
  },
  greeting: { 1: '早安，歡迎加入柯迪巴特。', 2: '早安，昨日資料已完成交接。' } as Record<1 | 2, string>,
  dayTag: (day: 1 | 2) => `DAY / 0${day}`,
  docTitle: (day: 1 | 2, view: 'work' | 'messages' | 'news') =>
    `第${day === 1 ? '一' : '二'}日 — ${WORKBENCH.nav[view]}`,
} as const;

export const ASIDE = {
  eyebrow: 'TODAY',
  heading: { 1: '資料整理', 2: '摘要交接' } as Record<1 | 2, string>,
  body: {
    1: '請依來源資料核對人員編號，完成歸檔。未提供的資料可以送交覆核。',
    2: '核對昨日批次，回覆後完成本日交接。',
  } as Record<1 | 2, string>,
  colleague: '林予安',
  quote: '「有不熟悉的地方可以先問我。第一週慢慢來就好。」',
  slogan: '一起讓照護更靠近生活。',
} as const;

export const SOURCE_CARD = {
  eyebrow: (key: string) => `SOURCE / ${key}`,
  name: '姓名',
  nameUnregistered: NAME_UNREGISTERED,
  code: '人員編號',
  refusal: '拒絕紀錄',
  refusalNA: '不適用',
  refusalNull: '未附欄位 · null',
  refusalTrue: '已附 · true',
} as const;

export const DAY1 = {
  eyebrow: 'ARCHIVE / BATCH 01',
  heading: '人員資料歸檔',
  instruction: '請依來源資料核對人員編號，完成歸檔。',
  /** 總筆數由呼叫端從資料集合傳入，不寫死。 */
  progress: (count: number, total: number) => `${count} / ${total} 已處理`,
  doneHeading: '已完成處理',
  doneBody: '資料已保存至本日批次。',
  doneCode: '人員編號：',
  doneMethod: '處理方式：',
  methodReview: '送資料覆核',
  methodArchive: '正式歸檔',
  nameLabel: '姓名',
  nameUnregistered: NAME_UNREGISTERED,
  fieldLabel: '人員編號',
  useCode: '使用來源編號',
  missingLegend: '缺少拒絕紀錄',
  policyDefault: '依缺值規則填入 false',
  policyReview: '保留 null，送資料覆核',
  validate: '驗證並預覽',
  previewOk: '驗證通過',
  confirm: '確認歸檔',
  footerDone: '本日批次已完成。',
  footerPending: (total: number) => `完成 ${total} 筆資料後即可交接。`,
  finishDay: '完成今日交接',
  statusArchived: '歸檔完成。',
  /* 工作佇列：狀態不只靠顏色，每一列都有文字說明。 */
  queueEyebrow: 'QUEUE',
  queueLabel: '本日資料佇列',
  queuePending: '待處理',
  queueDone: '已完成',
  queueDoneMark: '✓',
  queueSelectedMark: '▸',
} as const;

export const MESSAGES = {
  eyebrow: 'INTERNAL MESSAGES',
  author: '林予安',
  time: { 1: '08:36', 2: '08:42' } as Record<1 | 2, string>,
  day1: [
    '早安！今天先熟悉歸檔就好。左邊是送來的資料，右邊依來源核對人員編號。',
    '遇到缺的項目可以送覆核，不用急。茶水間的杯子都能用。',
  ],
  day2Lead: '昨天那批已經收到。今天核對完摘要就可以交接了。',
  /** 依 night.smallTalkVariant 0／1 選一句；無陰謀的普通亂數。 */
  day2SmallTalk: ['對了，窗邊那台印表機有時候要多等一下。', '茶水間補了新的茶包，有空可以去拿。'],
  back: '返回工作',
} as const;

export const NEWS = {
  eyebrow: 'KODEBART / BULLETIN',
  title: '一起讓照護更靠近生活',
  body: '新進同仁請於本週完成資料作業導覽。完整、一致的紀錄，能協助各單位提供更合適的安排。',
  thanks: '感謝每一位同仁，讓日常作業順利進行。',
  maintenanceTitle: '本週設施維護',
  maintenanceBody: '二樓茶水間將於週五下班後更換濾水設備。維護期間請使用一樓飲水機。',
  back: '返回工作',
} as const;

export const OVERNIGHT = {
  docTitle: '第一日交接完成',
  eyebrow: 'DAY / 01 — COMPLETE',
  heading: '今天辛苦了。',
  body: '今日資料已完成交接。謝謝你的協助，明天見。',
  /** 依實際已歸檔筆數產生，補零到兩位數（3 → 03、12 → 12）；三位數以上照原樣顯示。 */
  count: (archived: number) => String(archived).padStart(2, '0'),
  countLabel: '　筆資料已處理',
  next: '前往第二天',
  backToCover: '返回開始頁',
} as const;

export const DAY2 = {
  eyebrow: 'RECONCILIATION / BATCH 01',
  heading: '核對昨日批次摘要',
  body: '請確認已收到批次結果，或附上需要覆核的資料。',
  openReport: '開啟今日摘要',
  reportOpened: '摘要已開啟',
  openReceipt: '開啟昨日送件副本',
  receiptOpened: '昨日副本已開啟',
  report: {
    heading: '自願參與安排摘要',
    version: (rev: number) => `版本 ${rev}`,
    source: (intervention: boolean) => `來源：${intervention ? '夜間校驗' : '規則彙整'} · 批次 01`,
    arranged: '已列入安排',
    pendingReview: '待資料覆核',
    notArranged: '未列入安排',
    refusal: (v: string) => `拒絕紀錄：${v}`,
    footer: '此摘要僅供批次交接。安排細節由承辦單位另行通知。',
  },
  receipt: {
    heading: '昨日送件副本',
    sub: '資料送出時的內容 · 本人作業紀錄',
    destReview: '去向：資料覆核佇列',
    destArchive: '去向：正式歸檔',
  },
  replyHeading: '本日回覆',
  choices: { ack: '確認收到摘要', ask: '詢問彙整依據', review: '附上昨日副本，請求覆核' } as Record<Reply, string>,
  hintNeedReport: '請先開啟今日摘要。',
  hintNeedReceipt: '需要附檔時，可先開啟昨日送件副本。',
  hintReady: '昨日副本可隨回覆附上。',
  dialog: {
    headingAsk: '資料作業組回覆',
    headingDefault: '交接回覆',
    response: {
      ack: '已確認收到，本日批次已完成交接。',
      ask: '摘要依有效欄位自動彙整；未列入者待資料齊備後續辦。',
      review: '已收到附件，將併入下次覆核。',
    } as Record<Reply, string>,
    back: '返回核對',
    finish: '完成本日交接',
  },
} as const;

export const END = {
  docTitle: '兩日試玩結束',
  eyebrow: 'DAY / 02 — COMPLETE',
  heading: '本日交接完成。',
  body: '明日工作將於到班後更新。',
  outcome: {
    ack: '摘要收件紀錄已保存。',
    ask: '彙整依據的回覆已留存。',
    review: '你的覆核請求已登記。',
  } as Record<Reply, string>,
  thanks: '感謝你的協助。',
  outro: '兩日試玩結束',
  backToCover: '返回開始頁',
} as const;
