import { Phase, Reply } from '../core/types';
import {
  CONTENT,
  actorName,
  bulletin,
  contentDocument,
  contentTask,
  dayContent,
} from './bundle';
import { format } from './format';
import { NAME_UNREGISTERED } from './records';
import { ContentDocument, ContentMessage, ContentTask, DayContent, VariantKey } from './schema';

/**
 * game/content/text：元件目前使用的文案 API。
 *
 * 值全部來自 data/ 的 JSON（見 content/README.md），這裡只負責挑選、組裝與代入樣板，
 * 不保留任何寫死的玩家可見字串。匯出的名稱、型別與呼叫方式維持不變，元件不需修改。
 * KB-R4-04 之後訊息改走頻道 API 時，本檔的 MESSAGES 轉接層可以移除。
 */

/** 舊版匯出對應的內容 ID；只有 ID，不含文本。 */
const LEGACY_IDS = {
  day1Task: 'task.day1.archive',
  day2Task: 'task.day2.reconcile',
  day2Report: 'doc.day2.summary',
  day2Receipt: 'doc.day2.receipt',
  newsWelcome: 'bulletin.welcome',
  newsMaintenance: 'bulletin.maintenance',
} as const;

/* ---------- 資料檔的文字區塊型別 ---------- */

interface Day1TaskText {
  eyebrow: string;
  heading: string;
  instruction: string;
  progressTemplate: string;
  doneHeading: string;
  doneBody: string;
  doneCode: string;
  doneMethod: string;
  methodReview: string;
  methodArchive: string;
  nameLabel: string;
  fieldLabel: string;
  useCode: string;
  missingLegend: string;
  policyDefault: string;
  policyReview: string;
  validate: string;
  previewOk: string;
  confirm: string;
  footerDone: string;
  footerPendingTemplate: string;
  finishDay: string;
  statusArchived: string;
  queueEyebrow: string;
  queueLabel: string;
  queuePending: string;
  queueDone: string;
  queueDoneMark: string;
  queueSelectedMark: string;
}

interface Day2TaskText {
  eyebrow: string;
  heading: string;
  body: string;
  openReport: string;
  reportOpened: string;
  openReceipt: string;
  receiptOpened: string;
  replyHeading: string;
  choices: Record<Reply, string>;
  hintNeedReport: string;
  hintNeedReceipt: string;
  hintReady: string;
  dialog: {
    headingAsk: string;
    headingDefault: string;
    response: Record<Reply, string>;
    back: string;
    finish: string;
  };
}

interface ReportDocText {
  heading: string;
  versionTemplate: string;
  sourceTemplate: string;
  sourceOrigin: { intervention: string; rules: string };
  arranged: string;
  pendingReview: string;
  notArranged: string;
  refusalTemplate: string;
  footer: string;
}

interface ReceiptDocText {
  heading: string;
  sub: string;
  destReview: string;
  destArchive: string;
}

interface OvernightText {
  docTitle: string;
  eyebrow: string;
  heading: string;
  body: string;
  countLabel: string;
  next: string;
  backToCover: string;
}

interface EndText {
  docTitle: string;
  eyebrow: string;
  heading: string;
  body: string;
  outcome: Record<Reply, string>;
  thanks: string;
  outro: string;
  backToCover: string;
}

function taskText<T>(task: ContentTask): T {
  return task.text as unknown as T;
}

function docText<T>(doc: ContentDocument): T {
  return doc.text as unknown as T;
}

const ui = CONTENT.ui;
const day1 = dayContent(1);
const day2 = dayContent(2);
const day1Task = taskText<Day1TaskText>(contentTask(LEGACY_IDS.day1Task));
const day2Task = taskText<Day2TaskText>(contentTask(LEGACY_IDS.day2Task));
const day2Report = docText<ReportDocText>(contentDocument(LEGACY_IDS.day2Report));
const day2Receipt = docText<ReceiptDocText>(contentDocument(LEGACY_IDS.day2Receipt));
const overnight = day1.transition.text as unknown as OvernightText;
const ending = day2.transition.text as unknown as EndText;
const welcome = bulletin(LEGACY_IDS.newsWelcome);
const maintenance = bulletin(LEGACY_IDS.newsMaintenance);

/*
 * ---------- 訊息轉接（單一對話；KB-R4-04 之後畫面已不使用） ----------
 * 訊息頁改為頻道驅動後，畫面一律走 bundle.ts 的 channelsOfKind／unlockedMessages，
 * 以下 MESSAGES.author／time／day1／day2Lead／day2SmallTalk 只剩 content/bundle.spec.ts
 * 在驗既有文案，故暫時保留；等該 spec 改寫後可整段移除。
 */

/** 沒有變體的訊息：目前依檔案順序直接顯示。 */
function baseLines(d: DayContent): string[] {
  return d.messages.filter((m) => m.variant === undefined).flatMap((m) => m.lines);
}

/** 同一 variant.key 的訊息依 value 排序；呼叫端用存檔的值取一則。 */
function variantLines(d: DayContent, key: VariantKey): string[] {
  const picked: { value: number; lines: readonly string[] }[] = [];
  for (const m of d.messages) {
    if (m.variant !== undefined && m.variant.key === key) picked.push({ value: m.variant.value, lines: m.lines });
  }
  picked.sort((a, b) => a.value - b.value);
  return picked.flatMap((p) => [...p.lines]);
}

function firstTime(messages: readonly ContentMessage[]): string {
  return messages[0]?.time ?? '';
}

/* ---------- 對外 API（名稱與型別不變） ---------- */

export const APP_TITLE_SUFFIX = ui.appTitleSuffix;
export function pageTitle(text: string): string {
  return text + APP_TITLE_SUFFIX;
}

export const COVER = ui.cover;

export const PHASE_LABEL: Record<Phase, string> = ui.phaseLabel;

export const NEW_GAME_DIALOG = ui.dialogs.newGame;

export const SETTINGS_DIALOG = ui.dialogs.settings;

export const STORAGE = ui.storage;

const WORKBENCH_NAV = ui.workbench.nav;

export const WORKBENCH = {
  brandLead: ui.workbench.brandLead,
  brandRest: ui.workbench.brandRest,
  brandSuffix: ui.workbench.brandSuffix,
  role: ui.workbench.role,
  backToCover: ui.workbench.backToCover,
  navGroupPersonal: ui.workbench.navGroupPersonal,
  navGroupTeam: ui.workbench.navGroupTeam,
  navLabel: ui.workbench.navLabel,
  nav: WORKBENCH_NAV,
  heading: {
    work: { 1: day1.workbench.workHeading, 2: day2.workbench.workHeading } as Record<1 | 2, string>,
    messages: ui.workbench.heading.messages,
    news: ui.workbench.heading.news,
  },
  greeting: { 1: day1.workbench.greeting, 2: day2.workbench.greeting } as Record<1 | 2, string>,
  dayTag: (day: 1 | 2) => format(ui.workbench.dayTagTemplate, { day }),
  docTitle: (day: 1 | 2, view: 'work' | 'messages' | 'news') =>
    format(ui.workbench.docTitleTemplate, { dayName: ui.workbench.dayName[day], view: WORKBENCH_NAV[view] }),
} as const;

export const ASIDE = {
  eyebrow: ui.aside.eyebrow,
  heading: { 1: day1.aside.heading, 2: day2.aside.heading } as Record<1 | 2, string>,
  body: { 1: day1.aside.body, 2: day2.aside.body } as Record<1 | 2, string>,
  colleague: actorName(ui.aside.colleagueActorId),
  quote: ui.aside.quote,
  slogan: ui.aside.slogan,
} as const;

export const SOURCE_CARD = {
  eyebrow: (key: string) => format(ui.sourceCard.eyebrowTemplate, { key }),
  name: ui.sourceCard.name,
  nameUnregistered: NAME_UNREGISTERED,
  code: ui.sourceCard.code,
  refusal: ui.sourceCard.refusal,
  refusalNA: ui.sourceCard.refusalNA,
  refusalNull: ui.sourceCard.refusalNull,
  refusalTrue: ui.sourceCard.refusalTrue,
} as const;

export const DAY1 = {
  eyebrow: day1Task.eyebrow,
  heading: day1Task.heading,
  instruction: day1Task.instruction,
  /** 總筆數由呼叫端從資料集合傳入，不寫死。 */
  progress: (count: number, total: number) => format(day1Task.progressTemplate, { count, total }),
  doneHeading: day1Task.doneHeading,
  doneBody: day1Task.doneBody,
  doneCode: day1Task.doneCode,
  doneMethod: day1Task.doneMethod,
  methodReview: day1Task.methodReview,
  methodArchive: day1Task.methodArchive,
  nameLabel: day1Task.nameLabel,
  nameUnregistered: NAME_UNREGISTERED,
  fieldLabel: day1Task.fieldLabel,
  useCode: day1Task.useCode,
  missingLegend: day1Task.missingLegend,
  policyDefault: day1Task.policyDefault,
  policyReview: day1Task.policyReview,
  validate: day1Task.validate,
  previewOk: day1Task.previewOk,
  confirm: day1Task.confirm,
  footerDone: day1Task.footerDone,
  footerPending: (total: number) => format(day1Task.footerPendingTemplate, { total }),
  finishDay: day1Task.finishDay,
  statusArchived: day1Task.statusArchived,
  /* 工作佇列：狀態不只靠顏色，每一列都有文字說明。 */
  queueEyebrow: day1Task.queueEyebrow,
  queueLabel: day1Task.queueLabel,
  queuePending: day1Task.queuePending,
  queueDone: day1Task.queueDone,
  queueDoneMark: day1Task.queueDoneMark,
  queueSelectedMark: day1Task.queueSelectedMark,
} as const;

export const MESSAGES = {
  eyebrow: ui.messages.eyebrow,
  /* 頻道列表與對話區（KB-R4-04）；分類標題與空狀態都來自資料檔。 */
  listLabel: ui.messages.listLabel,
  backToList: ui.messages.backToList,
  sectionTitle: ui.messages.sectionTitle,
  sectionEmpty: ui.messages.sectionEmpty,
  selectHeading: ui.messages.selectHeading,
  selectPrompt: ui.messages.selectPrompt,
  emptyChannel: ui.messages.emptyChannel,
  /** 未讀的螢幕閱讀器文字；紅點之外一定有文字說明，不只靠顏色。 */
  unread: (count: number) => format(ui.messages.unreadTemplate, { count }),
  unreadChannel: (channel: string, count: number) =>
    format(ui.messages.unreadChannelTemplate, { channel, count }),
  author: actorName(day1.messages[0]?.actorId ?? ui.aside.colleagueActorId),
  time: { 1: firstTime(day1.messages), 2: firstTime(day2.messages) } as Record<1 | 2, string>,
  day1: baseLines(day1) as readonly string[],
  day2Lead: baseLines(day2)[0] ?? '',
  /** 依 night.smallTalkVariant 0／1 選一句；無陰謀的普通亂數。 */
  day2SmallTalk: variantLines(day2, 'night.smallTalkVariant') as readonly string[],
  back: ui.messages.back,
} as const;

export const NEWS = {
  eyebrow: ui.news.eyebrow,
  title: welcome.title,
  body: welcome.body[0] ?? '',
  thanks: welcome.body[1] ?? '',
  maintenanceTitle: maintenance.title,
  maintenanceBody: maintenance.body[0] ?? '',
  back: ui.news.back,
} as const;

export const OVERNIGHT = {
  docTitle: overnight.docTitle,
  eyebrow: overnight.eyebrow,
  heading: overnight.heading,
  body: overnight.body,
  /** 依實際已歸檔筆數產生，補零到兩位數（3 → 03、12 → 12）；三位數以上照原樣顯示。 */
  count: (archived: number) => String(archived).padStart(2, '0'),
  countLabel: overnight.countLabel,
  next: overnight.next,
  backToCover: overnight.backToCover,
} as const;

export const DAY2 = {
  eyebrow: day2Task.eyebrow,
  heading: day2Task.heading,
  body: day2Task.body,
  openReport: day2Task.openReport,
  reportOpened: day2Task.reportOpened,
  openReceipt: day2Task.openReceipt,
  receiptOpened: day2Task.receiptOpened,
  report: {
    heading: day2Report.heading,
    version: (rev: number) => format(day2Report.versionTemplate, { revision: rev }),
    source: (intervention: boolean) =>
      format(day2Report.sourceTemplate, {
        origin: intervention ? day2Report.sourceOrigin.intervention : day2Report.sourceOrigin.rules,
      }),
    arranged: day2Report.arranged,
    pendingReview: day2Report.pendingReview,
    notArranged: day2Report.notArranged,
    refusal: (v: string) => format(day2Report.refusalTemplate, { value: v }),
    footer: day2Report.footer,
  },
  receipt: {
    heading: day2Receipt.heading,
    sub: day2Receipt.sub,
    destReview: day2Receipt.destReview,
    destArchive: day2Receipt.destArchive,
  },
  replyHeading: day2Task.replyHeading,
  choices: day2Task.choices,
  hintNeedReport: day2Task.hintNeedReport,
  hintNeedReceipt: day2Task.hintNeedReceipt,
  hintReady: day2Task.hintReady,
  dialog: {
    headingAsk: day2Task.dialog.headingAsk,
    headingDefault: day2Task.dialog.headingDefault,
    response: day2Task.dialog.response,
    back: day2Task.dialog.back,
    finish: day2Task.dialog.finish,
  },
} as const;

export const END = {
  docTitle: ending.docTitle,
  eyebrow: ending.eyebrow,
  heading: ending.heading,
  body: ending.body,
  outcome: ending.outcome,
  thanks: ending.thanks,
  outro: ending.outro,
  backToCover: ending.backToCover,
} as const;
