import { Phase } from '../core/types';

/**
 * game/content/schema：內容資料檔（data/**.json）的型別與白名單。
 *
 * 這裡只放結構、允許值與 ID 規則，不放任何玩家可見文本；文本一律在 data/ 的 JSON。
 * 資料檔不得包含可執行 JavaScript、函式字串或運算式；需要代入數值的地方
 * 一律使用 `{placeholder}` 樣板，由 content/format.ts 以純字串取代處理。
 */

/* ---------- ID 命名空間 ---------- */

/** 每一種內容的 ID 前綴；validate-content.ts 依此檢查。 */
export const ID_PREFIX = {
  actor: 'actor.',
  channel: 'channel.',
  message: 'msg.',
  record: 'record.',
  document: 'doc.',
  day: 'day.',
  task: 'task.',
  bulletin: 'bulletin.',
  transition: 'transition.',
} as const;

/** ID 只允許小寫英數、`-` 與作為命名空間分隔的 `.`。 */
export const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/* ---------- 允許值白名單 ---------- */

/** 訊息頻道分類：部門大群、同事小圈圈、個人訊息（KB-R4-04）。 */
export const CHANNEL_KINDS = ['department', 'group', 'direct'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/** 每日任務種類；新增玩法時在這裡加，並由規則層決定如何執行。 */
export const TASK_KINDS = ['archive', 'reconcile'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** 文件種類（工作中可開啟的資料）。 */
export const DOCUMENT_KINDS = ['report', 'receipt'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * 訊息變體來源：同一時間點只會出現其中一則。
 * 目前只有夜間閒聊版本（無陰謀的普通亂數，由存檔的 night 決定）。
 */
export const VARIANT_KEYS = ['night.smallTalkVariant'] as const;
export type VariantKey = (typeof VARIANT_KEYS)[number];

/* ---------- 共用欄位 ---------- */

/** 給內容編輯看的備註；不會顯示給玩家。 */
export interface Annotated {
  note?: string;
}

/* ---------- data/actors.json ---------- */

export interface ContentActor extends Annotated {
  id: string;
  /** 畫面上顯示的稱呼。未命名角色不得在此被命名。 */
  displayName: string;
}

export interface ActorsFile extends Annotated {
  actors: ContentActor[];
}

/* ---------- data/channels.json ---------- */

export interface ContentChannel extends Annotated {
  id: string;
  kind: ChannelKind;
  /** 群組頻道的名稱；direct 不填，標題取自對方 actor 的 displayName。 */
  title?: string;
  /** 主角以外的參與者。direct 必須剛好一位。 */
  actorIds: string[];
}

export interface ChannelsFile extends Annotated {
  channels: ContentChannel[];
}

/* ---------- data/bulletins.json ---------- */

export interface ContentBulletin extends Annotated {
  id: string;
  title: string;
  /** 每個元素是一段；長篇正文才改放 content/documents/ 的 Markdown。 */
  body: string[];
}

export interface BulletinsFile extends Annotated {
  bulletins: ContentBulletin[];
}

/* ---------- data/days/day-NN.json ---------- */

/** 一筆來源紀錄。`key` 是存檔識別，`code` 一律為字串，0102 的前導零不得消失。 */
export interface ContentRecord extends Annotated {
  id: string;
  key: string;
  name: string | null;
  code: string;
  refusal: boolean | null;
  refusalApplies: boolean;
}

export interface ContentDocument extends Annotated {
  id: string;
  kind: DocumentKind;
  /** 這份文件引用到的紀錄；可跨日引用其他 day-NN.json 定義的紀錄。 */
  recordIds: string[];
  text: Record<string, unknown>;
}

export interface ContentTask extends Annotated {
  id: string;
  kind: TaskKind;
  recordIds: string[];
  documentIds: string[];
  text: Record<string, unknown>;
}

export interface MessageVariant {
  key: VariantKey;
  value: number;
}

export interface ContentMessage extends Annotated {
  id: string;
  channelId: string;
  actorId: string;
  /** 顯示用時間字串，例如 '08:36'。 */
  time: string;
  /** 解鎖條件 ID（全部成立才解鎖）；白名單見 content/conditions.ts。 */
  unlock: string[];
  /** 同一 variant.key 只會出現一則；由規則層依存檔挑選。 */
  variant?: MessageVariant;
  lines: string[];
}

export interface ContentTransition extends Annotated {
  id: string;
  text: Record<string, unknown>;
}

export interface DayContent extends Annotated {
  id: string;
  /** 第幾天；與 id 的編號一致。 */
  day: number;
  workbench: { greeting: string; workHeading: string };
  aside: { heading: string; body: string };
  records: ContentRecord[];
  documents: ContentDocument[];
  tasks: ContentTask[];
  messages: ContentMessage[];
  transition: ContentTransition;
}

/* ---------- data/ui.zh-Hant.json ---------- */

export interface UiCover {
  eyebrow: string;
  title: string;
  subtitle: string;
  start: string;
  continue: string;
  settings: string;
  noSave: string;
  savePrefix: string;
  footerLeft: string;
  footerRight: string;
  artAlt: string;
  artSrc: string;
  docTitle: string;
}

/**
 * 訊息頁（KB-R4-04）：頻道列表、對話區與未讀的可見字串。
 * 未讀文字是螢幕閱讀器用的說明，紅點本身不帶語意。
 */
export interface UiMessages {
  eyebrow: string;
  back: string;
  /** 頻道列表的無障礙名稱。 */
  listLabel: string;
  /** 窄螢幕從對話返回列表。 */
  backToList: string;
  /** 三種頻道分類的區段標題；鍵與 CHANNEL_KINDS 一致。 */
  sectionTitle: Record<ChannelKind, string>;
  /** 某一分類目前沒有頻道時的中性文字。 */
  sectionEmpty: string;
  selectHeading: string;
  selectPrompt: string;
  /** 頻道已開啟但目前沒有已解鎖訊息。 */
  emptyChannel: string;
  unreadTemplate: string;
  unreadChannelTemplate: string;
}

export interface UiDialog {
  heading: string;
  body?: string;
  keep?: string;
  start?: string;
  motionLabel?: string;
  note?: string;
  back?: string;
}

export interface UiContent extends Annotated {
  id: string;
  locale: string;
  appTitleSuffix: string;
  cover: UiCover;
  phaseLabel: Record<Phase, string>;
  dialogs: {
    newGame: { heading: string; body: string; keep: string; start: string };
    settings: { heading: string; motionLabel: string; note: string; back: string };
  };
  storage: { readIssue: string; writeIssue: string; saved: string };
  workbench: {
    brandLead: string;
    brandRest: string;
    brandSuffix: string;
    role: string;
    backToCover: string;
    navGroupPersonal: string;
    navGroupTeam: string;
    navLabel: string;
    nav: { work: string; messages: string; news: string };
    heading: { messages: string; news: string };
    dayTagTemplate: string;
    docTitleTemplate: string;
    dayName: Record<1 | 2, string>;
  };
  aside: { eyebrow: string; colleagueActorId: string; quote: string; slogan: string };
  sourceCard: {
    eyebrowTemplate: string;
    name: string;
    code: string;
    refusal: string;
    refusalNA: string;
    refusalNull: string;
    refusalTrue: string;
  };
  records: Annotated & { nameUnregistered: string };
  messages: UiMessages;
  news: { eyebrow: string; back: string };
}

/* ---------- 樣板欄位 ---------- */

/**
 * 每個樣板欄位允許出現的 placeholder。
 * 驗證時會檢查：不得出現白名單以外的 `{...}`，也不得缺少必要的 placeholder。
 */
export const TEMPLATE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  progressTemplate: ['count', 'total'],
  footerPendingTemplate: ['total'],
  dayTagTemplate: ['day'],
  docTitleTemplate: ['dayName', 'view'],
  eyebrowTemplate: ['key'],
  versionTemplate: ['revision'],
  sourceTemplate: ['origin'],
  refusalTemplate: ['value'],
  unreadTemplate: ['count'],
  unreadChannelTemplate: ['channel', 'count'],
};

/* ---------- 驗證輸入 ---------- */

/** 一個內容檔的原始內容；驗證錯誤訊息需要指出來源檔名。 */
export interface ContentSource {
  file: string;
  data: unknown;
}

/** validate-content.ts 的輸入：全部內容檔，未經型別斷言。 */
export interface ContentInput {
  ui: ContentSource;
  actors: ContentSource;
  channels: ContentSource;
  bulletins: ContentSource;
  days: ContentSource[];
}

/** 整包載入後的內容。 */
export interface ContentBundle {
  ui: UiContent;
  actors: readonly ContentActor[];
  channels: readonly ContentChannel[];
  bulletins: readonly ContentBulletin[];
  days: readonly DayContent[];
}
