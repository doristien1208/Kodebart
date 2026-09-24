import { ContentMessage } from '../../../content/schema';
import { ChatReply } from '../../../core/types';

/**
 * 訊息對話串的 timeline presenter（R7 §2.3／§7；R12 §2／§4）。
 *
 * 把「已解鎖的內容訊息」、存檔中的回覆快照與已送出的提問合成一條穩定的 timeline：
 * - 內容訊息依傳入順序（visibleFrom 日序，再依檔案順序；由 bundle 排好，這裡不重排）。
 * - 某則訊息帶 replyPrompt 且已回答時，緊接在它之後插入玩家那一列（作者＝玩家的聊天署名），
 *   再依序插入保存下來的 responses；之後的內容訊息照原順序接在後面。
 *   一般 prompt 沿用內容時間；responses 依保存的 deliverAt 送達，未送達的第一則改放一個「正在輸入」列。
 * - skipped 或尚未回答：什麼都不插入（畫面上不出現「不回覆」）。
 * - 錨定在提問上的說明訊息（R12 §4）不在原位置出現，改成一個提問區塊：
 *   玩家提問列（`<requestId>:you`，時間＝提問的實際時間）→ 已送達的說明（時間＝送達時間）→
 *   下一則未送達的「正在輸入」列，之後什麼都不放。區塊屬於實際提問的那一天（不是模板的 visibleFrom），
 *   放在該日段落的最後；該日沒有其他訊息時依日序補上日期分隔。
 *   說明 prompt 的回答接在它的 anchor 之後，時間用回答與送達的實際時間。
 * - 每一天的第一列前放一個日期分隔（每日 JSON 的 chatDateLabel），不使用 DAY／第 N 天。
 * - 相同作者、同一天、五分鐘內連續發言標為 continued（只合併顯示，不改順序）。
 *
 * 純函式：不依賴 Angular、存檔或正式內容檔；分支與排序都在這裡，不放進 template。
 */

/** 訊息中的一段；id 由列 id 加上段落序號組成，避免以文字或索引追蹤。 */
export interface TimelineLine {
  id: string;
  text: string;
}

export interface TimelineDate {
  kind: 'date';
  /** 穩定 id（`date:<dayId>`），模板的 track 依據。 */
  id: string;
  dayId: string;
  label: string;
}

export interface TimelineMessage {
  kind: 'message';
  /** 內容訊息＝message.id；回應快照＝response.id；玩家列＝`<promptId>:you` 或 `<requestId>:you`。 */
  id: string;
  dayId: string;
  author: string;
  /** 方形頭像的首字。 */
  initial: string;
  /** 玩家自己的列（固定回覆或提問）。 */
  player: boolean;
  time: string;
  lines: readonly TimelineLine[];
  /** 與上一列同作者、同一天且在五分鐘內：只顯示內文，不重複頭像、姓名與時間。 */
  continued: boolean;
  /** 本次開啟頻道後才回答而新出現的列（玩家列與 responses）；容器用來決定是否播放淡入。 */
  fresh: boolean;
  /** 由哪個 prompt 的回答產生；內容訊息、說明訊息與提問列為 null。 */
  promptId: string | null;
}

/** 對方回應出現前的「正在輸入」列（依保存的送達時間出現，本身不存檔）。 */
export interface TimelineTyping {
  kind: 'typing';
  /** `<promptId>:typing` 或 `<requestId>:typing`。 */
  id: string;
  dayId: string;
  /** 正在輸入的人（下一則回應／說明的作者）。 */
  author: string;
  initial: string;
  /** 等待中的 prompt ID 或提問 ID。 */
  sourceId: string;
}

export type TimelineEntry = TimelineDate | TimelineMessage | TimelineTyping;

/** 已送出的提問（存檔 helpRequests 加上內容的提問文字）。 */
export interface TimelineRequest {
  id: string;
  /** 實際提問的遊戲日。 */
  dayId: string;
  /** 提問的實際時間（epoch ms）。 */
  askedAt: number;
  playerText: string;
  /** 說明訊息逐則的預定送達時間（送達順序）。 */
  deliveries: readonly { messageId: string; at: number }[];
}

export interface TimelineInput {
  /** 已解鎖的內容訊息（含已提問的說明訊息），順序由呼叫端（bundle）決定。 */
  messages: readonly ContentMessage[];
  /** 存檔中某 prompt 的回覆；未回覆為 undefined。 */
  replyOf: (promptId: string) => ChatReply | undefined;
  actorName: (actorId: string) => string;
  dateLabel: (dayId: string) => string;
  /** 玩家列的作者名：玩家的聊天署名（簽名的角色名；舊存檔「員工」）。 */
  you: string;
  /** 這些 prompt 產生的列標為 fresh；預設沒有。 */
  freshPromptIds?: ReadonlySet<string>;
  /** 目前時間（epoch ms）：送達時間未到的回應／說明不出現。未提供＝全部已送達。 */
  now?: number;
  /** 說明訊息所屬的提問 ID；一般訊息回傳 undefined。未提供＝沒有說明訊息。 */
  requestOfMessage?: (messageId: string) => string | undefined;
  /** 已送出的提問；尚未送出回傳 undefined（它的說明訊息不出現）。 */
  requestOf?: (requestId: string) => TimelineRequest | undefined;
  /** 日序：決定提問區塊放在哪一天的段落。未提供時區塊接在最後。 */
  dayOrder?: (dayId: string) => number;
  /** epoch ms → 'HH:MM'；預設為本地時間（localClockTime）。 */
  clockTime?: (epochMs: number) => string;
}

/** 合併視窗：同作者五分鐘內。 */
export const MERGE_WINDOW_MINUTES = 5;

/** 玩家列在作者比對時用的鍵；不會與 actor ID 相撞（actor ID 一律 `actor.` 開頭）。 */
const PLAYER_KEY = '@player';

/** 'HH:MM' → 分鐘數；格式不符回傳 NaN（不合併）。 */
export function minutesOf(time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
}

/** 實際時間（epoch ms）的本地 'HH:MM'。 */
export function localClockTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 頭像首字：取第一個字元（以 code point 計，避免切斷代理對）；空字串回傳空字串。 */
export function initialOf(name: string): string {
  return Array.from(name.trim())[0] ?? '';
}

interface RawRow {
  kind: 'message' | 'typing';
  id: string;
  authorKey: string;
  author: string;
  player: boolean;
  time: string;
  dayId: string;
  lines: readonly string[];
  promptId: string | null;
  /** typing 列等待中的 prompt／提問 ID。 */
  sourceId: string;
}

/** 列的時間來源：一般 prompt 用內容時間；說明區塊用實際時間。 */
interface ReplyTiming {
  dayId: string;
  /** 玩家列時間。 */
  playerTime: (reply: Extract<ChatReply, { kind: 'answered' }>) => string;
  /** 回應列時間。 */
  responseTime: (response: Extract<ChatReply, { kind: 'answered' }>['responses'][number]) => string;
}

/**
 * anchor 的回答列（玩家列＋依送達時間的 responses）；回傳是否停在「正在輸入」。
 */
function pushReply(rows: RawRow[], input: TimelineInput, anchor: ContentMessage, timing: ReplyTiming): boolean {
  const promptId = anchor.replyPrompt?.id;
  if (promptId === undefined) return false;
  const reply = input.replyOf(promptId);
  if (reply?.kind !== 'answered') return false;
  const now = input.now ?? Number.POSITIVE_INFINITY;
  rows.push({
    kind: 'message',
    id: `${promptId}:you`,
    authorKey: PLAYER_KEY,
    author: input.you,
    player: true,
    time: timing.playerTime(reply),
    dayId: timing.dayId,
    lines: [reply.playerText],
    promptId,
    sourceId: promptId,
  });
  for (const r of reply.responses) {
    if (r.deliverAt !== undefined && r.deliverAt > now) {
      // 下一位回應者正在輸入；之後的回應先不出現。
      rows.push(typingRow(`${promptId}:typing`, r.actorId, input, timing.dayId, promptId, promptId));
      return true;
    }
    rows.push({
      kind: 'message',
      id: r.id,
      authorKey: r.actorId,
      author: input.actorName(r.actorId),
      player: false,
      time: timing.responseTime(r),
      dayId: timing.dayId,
      lines: r.lines,
      promptId,
      sourceId: promptId,
    });
  }
  return false;
}

function typingRow(
  id: string,
  actorId: string,
  input: TimelineInput,
  dayId: string,
  promptId: string | null,
  sourceId: string,
): RawRow {
  return {
    kind: 'typing',
    id,
    authorKey: actorId,
    author: input.actorName(actorId),
    player: false,
    time: '',
    dayId,
    lines: [],
    promptId,
    sourceId,
  };
}

function contentRow(m: ContentMessage, input: TimelineInput, dayId: string, time: string): RawRow {
  return {
    kind: 'message',
    id: m.id,
    authorKey: m.actorId,
    author: input.actorName(m.actorId),
    player: false,
    time,
    dayId,
    lines: m.lines,
    promptId: null,
    sourceId: m.id,
  };
}

/** 一個已送出提問的區塊：提問列 → 已送達的說明（含說明 prompt 的回答）→ 至多一個「正在輸入」。 */
function requestRows(request: TimelineRequest, messages: readonly ContentMessage[], input: TimelineInput): RawRow[] {
  const clock = input.clockTime ?? localClockTime;
  const now = input.now ?? Number.POSITIVE_INFINITY;
  const dayId = request.dayId;
  const rows: RawRow[] = [
    {
      kind: 'message',
      id: `${request.id}:you`,
      authorKey: PLAYER_KEY,
      author: input.you,
      player: true,
      time: clock(request.askedAt),
      dayId,
      lines: [request.playerText],
      promptId: null,
      sourceId: request.id,
    },
  ];
  // 依保存的送達順序；沒有排定送達時間的說明（內容日後新增）不出現
  const byId = new Map(messages.map((m) => [m.id, m] as const));
  for (const d of request.deliveries) {
    const m = byId.get(d.messageId);
    if (!m) continue;
    if (d.at > now) {
      rows.push(typingRow(`${request.id}:typing`, m.actorId, input, dayId, null, request.id));
      return rows;
    }
    rows.push(contentRow(m, input, dayId, clock(d.at)));
    const waiting = pushReply(rows, input, m, {
      dayId,
      playerTime: (reply) => clock(reply.answeredAt ?? d.at),
      responseTime: (r) => (r.deliverAt === undefined ? r.time : clock(r.deliverAt)),
    });
    if (waiting) return rows;
  }
  return rows;
}

function rawRows(input: TimelineInput): RawRow[] {
  const rows: RawRow[] = [];
  const anchored = new Map<string, ContentMessage[]>();
  for (const m of input.messages) {
    const requestId = input.requestOfMessage?.(m.id);
    if (requestId !== undefined) {
      anchored.set(requestId, [...(anchored.get(requestId) ?? []), m]);
      continue;
    }
    rows.push(contentRow(m, input, m.visibleFrom, m.time));
    // 一般 prompt：玩家列沿用 anchor 的內容時間，responses 沿用快照時間（送達前改放「正在輸入」）
    pushReply(rows, input, m, { dayId: m.visibleFrom, playerTime: () => m.time, responseTime: (r) => r.time });
  }

  const order = input.dayOrder;
  const blocks = [...anchored.entries()]
    .map(([requestId, messages]) => {
      const request = input.requestOf?.(requestId);
      return request ? { request, rows: requestRows(request, messages, input) } : null;
    })
    .filter((b): b is { request: TimelineRequest; rows: RawRow[] } => b !== null)
    .sort((a, b) => (order ? order(a.request.dayId) - order(b.request.dayId) : 0) || a.request.askedAt - b.request.askedAt);
  for (const block of blocks) {
    // 放在提問當日段落的最後：第一個「晚於提問日」的列之前（沒有就接在最後）
    const day = order?.(block.request.dayId) ?? Number.NaN;
    const at = order ? rows.findIndex((r) => order(r.dayId) > day) : -1;
    rows.splice(at < 0 ? rows.length : at, 0, ...block.rows);
  }
  return rows;
}

function continues(prev: RawRow | undefined, row: RawRow): boolean {
  if (prev === undefined || prev.dayId !== row.dayId || prev.authorKey !== row.authorKey) return false;
  const gap = minutesOf(row.time) - minutesOf(prev.time);
  return gap >= 0 && gap <= MERGE_WINDOW_MINUTES;
}

/** 合成 timeline；相同輸入永遠得到相同輸出（id 與順序穩定）。 */
export function buildTimeline(input: TimelineInput): readonly TimelineEntry[] {
  const fresh = input.freshPromptIds ?? new Set<string>();
  const out: TimelineEntry[] = [];
  let prev: RawRow | undefined;
  let lastDay: string | undefined;
  for (const row of rawRows(input)) {
    if (lastDay !== row.dayId) {
      lastDay = row.dayId;
      out.push({ kind: 'date', id: `date:${row.dayId}`, dayId: row.dayId, label: input.dateLabel(row.dayId) });
    }
    if (row.kind === 'typing') {
      out.push({
        kind: 'typing',
        id: row.id,
        dayId: row.dayId,
        author: row.author,
        initial: initialOf(row.author),
        sourceId: row.sourceId,
      });
      // 「正在輸入」之後的列不與它之前的列合併。
      prev = undefined;
      continue;
    }
    out.push({
      kind: 'message',
      id: row.id,
      dayId: row.dayId,
      author: row.author,
      initial: initialOf(row.author),
      player: row.player,
      time: row.time,
      lines: row.lines.map((text, j) => ({ id: `${row.id}#${j}`, text })),
      continued: continues(prev, row),
      fresh: row.promptId !== null && fresh.has(row.promptId),
      promptId: row.promptId,
    });
    prev = row;
  }
  return out;
}

/** 最後一則訊息列（頻道列表的摘要與時間）；沒有訊息時為 null。 */
export function lastMessageOf(entries: readonly TimelineEntry[]): TimelineMessage | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.kind === 'message') return e;
  }
  return null;
}
