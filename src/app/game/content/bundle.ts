import { ConditionContext, isUnlocked } from './conditions';
import actorsJson from './data/actors.json';
import bulletinsJson from './data/bulletins.json';
import channelsJson from './data/channels.json';
import day01Json from './data/days/day-01.json';
import day02Json from './data/days/day-02.json';
import uiJson from './data/ui.zh-Hant.json';
import {
  ActorsFile,
  BulletinsFile,
  ChannelsFile,
  ContentActor,
  ContentBulletin,
  ContentBundle,
  ContentChannel,
  ContentDocument,
  ContentInput,
  ContentMessage,
  ContentRecord,
  ContentTask,
  DayContent,
  UiContent,
} from './schema';

/**
 * game/content/bundle：把 data/ 的 JSON 載入成有型別的內容，並提供查詢。
 *
 * 這一層只做載入、索引與查詢，不含玩家可見文本。JSON 的推導型別過於精確
 * （例如 `refusal: null` 會被推成 `null`），因此一律以 `as unknown as T` 斷言成
 * schema.ts 的型別；實際欄位正確性由 validate-content.ts 在測試階段檢查。
 */

/** 檔名對照；驗證與錯誤訊息用。 */
export const CONTENT_FILES = {
  ui: 'data/ui.zh-Hant.json',
  actors: 'data/actors.json',
  channels: 'data/channels.json',
  bulletins: 'data/bulletins.json',
  days: ['data/days/day-01.json', 'data/days/day-02.json'],
} as const;

const ui = uiJson as unknown as UiContent;
const actorsFile = actorsJson as unknown as ActorsFile;
const channelsFile = channelsJson as unknown as ChannelsFile;
const bulletinsFile = bulletinsJson as unknown as BulletinsFile;
const dayFiles: readonly DayContent[] = [day01Json, day02Json] as unknown as DayContent[];

export const CONTENT: ContentBundle = {
  ui,
  actors: actorsFile.actors,
  channels: channelsFile.channels,
  bulletins: bulletinsFile.bulletins,
  days: dayFiles,
};

/** 未經斷言的原始內容；交給 validate-content.ts 檢查。 */
export const CONTENT_SOURCES: ContentInput = {
  ui: { file: CONTENT_FILES.ui, data: uiJson },
  actors: { file: CONTENT_FILES.actors, data: actorsJson },
  channels: { file: CONTENT_FILES.channels, data: channelsJson },
  bulletins: { file: CONTENT_FILES.bulletins, data: bulletinsJson },
  days: [day01Json, day02Json].map((data, i) => ({ file: CONTENT_FILES.days[i] ?? `data/days/#${i}`, data })),
};

/* ---------- 查詢 ---------- */

function required<T>(value: T | undefined, kind: string, id: string): T {
  if (value === undefined) throw new Error(`content: 找不到${kind} ${id}`);
  return value;
}

export function actor(id: string): ContentActor {
  return required(
    CONTENT.actors.find((a) => a.id === id),
    '人物',
    id,
  );
}

/** 顯示用稱呼；未命名角色不會在這裡被命名。 */
export function actorName(id: string): string {
  return actor(id).displayName;
}

export function channel(id: string): ContentChannel {
  return required(
    CONTENT.channels.find((c) => c.id === id),
    '頻道',
    id,
  );
}

/** 頻道標題：群組用自己的 title，個人訊息用對方的稱呼。 */
export function channelTitle(id: string): string {
  const c = channel(id);
  if (c.title !== undefined) return c.title;
  const other = c.actorIds[0];
  return other === undefined ? c.id : actorName(other);
}

/** KB-R4-04 用：依分類取得頻道，目前 department／group 為空。 */
export function channelsOfKind(kind: ContentChannel['kind']): readonly ContentChannel[] {
  return CONTENT.channels.filter((c) => c.kind === kind);
}

export function bulletin(id: string): ContentBulletin {
  return required(
    CONTENT.bulletins.find((b) => b.id === id),
    '公告',
    id,
  );
}

export function dayContent(dayNumber: number): DayContent {
  return required(
    CONTENT.days.find((d) => d.day === dayNumber),
    '每日內容',
    `day ${dayNumber}`,
  );
}

export function dayContentById(id: string): DayContent {
  return required(
    CONTENT.days.find((d) => d.id === id),
    '每日內容',
    id,
  );
}

/** 全部日別的來源紀錄；同一筆紀錄只定義一次，之後幾天以 ID 引用。 */
export const ALL_RECORDS: readonly ContentRecord[] = CONTENT.days.flatMap((d) => d.records);

export function contentRecord(id: string): ContentRecord {
  return required(
    ALL_RECORDS.find((r) => r.id === id),
    '紀錄',
    id,
  );
}

export const ALL_DOCUMENTS: readonly ContentDocument[] = CONTENT.days.flatMap((d) => d.documents);

export function contentDocument(id: string): ContentDocument {
  return required(
    ALL_DOCUMENTS.find((d) => d.id === id),
    '文件',
    id,
  );
}

export const ALL_TASKS: readonly ContentTask[] = CONTENT.days.flatMap((d) => d.tasks);

export function contentTask(id: string): ContentTask {
  return required(
    ALL_TASKS.find((t) => t.id === id),
    '任務',
    id,
  );
}

export const ALL_MESSAGES: readonly ContentMessage[] = CONTENT.days.flatMap((d) => d.messages);

export function contentMessage(id: string): ContentMessage {
  return required(
    ALL_MESSAGES.find((m) => m.id === id),
    '訊息',
    id,
  );
}

/** 某頻道的全部訊息（含尚未解鎖的）；順序為日別順序再依檔案順序。 */
export function messagesOfChannel(channelId: string): readonly ContentMessage[] {
  return ALL_MESSAGES.filter((m) => m.channelId === channelId);
}

/**
 * 目前狀態下已解鎖的訊息。
 * 只讀狀態、不擲骰；同一組 variant.key 只會留下符合目前存檔的那一則。
 */
export function unlockedMessages(channelId: string, ctx: ConditionContext): readonly ContentMessage[] {
  return messagesOfChannel(channelId).filter((m) => isUnlocked(m.unlock, ctx));
}
