import { ContentMessage, ContentReplyPrompt } from '../../../content/schema';
import { ChatReply } from '../../../core/types';
import {
  TimelineEntry,
  TimelineInput,
  TimelineMessage,
  TimelineRequest,
  buildTimeline,
  initialOf,
  lastMessageOf,
  localClockTime,
  minutesOf,
} from './timeline';

/**
 * R7 §2.3／§7 timeline presenter：合成夾具（不是正式內容），只測排序、插入、日期分隔與合併。
 */

const PROMPT: ContentReplyPrompt = {
  id: 'prompt.fixture.ask',
  availableThrough: 'day.01',
  choices: [
    {
      id: 'yes',
      text: '好',
      responses: [
        { id: 'msg.fixture.reply.a', actorId: 'actor.a', time: '09:02', lines: ['收到'] },
        { id: 'msg.fixture.reply.b', actorId: 'actor.b', time: '09:03', lines: ['我也是', '第二行'] },
      ],
    },
  ],
};

function msg(id: string, actorId: string, time: string, visibleFrom: string, extra: Partial<ContentMessage> = {}): ContentMessage {
  return { id, channelId: 'channel.fixture', actorId, time, visibleFrom, unlock: [], lines: [id], ...extra };
}

const MESSAGES: readonly ContentMessage[] = [
  msg('msg.1', 'actor.a', '09:00', 'day.01'),
  msg('msg.2', 'actor.a', '09:01', 'day.01', { replyPrompt: PROMPT }),
  msg('msg.3', 'actor.b', '09:10', 'day.01'),
  msg('msg.4', 'actor.b', '09:12', 'day.02'),
];

const NAMES: Readonly<Record<string, string>> = { 'actor.a': '林予安', 'actor.b': '楊子謙' };
const LABELS: Readonly<Record<string, string>> = { 'day.01': '9 月 15 日', 'day.02': '9 月 16 日' };

function build(reply?: ChatReply, fresh?: ReadonlySet<string>): readonly TimelineEntry[] {
  return buildTimeline({
    messages: MESSAGES,
    replyOf: (id) => (id === PROMPT.id ? reply : undefined),
    actorName: (id) => NAMES[id] ?? '',
    dateLabel: (id) => LABELS[id] ?? '',
    you: '你',
    freshPromptIds: fresh,
  });
}

function ids(entries: readonly TimelineEntry[]): string[] {
  return entries.map((e) => e.id);
}

function rows(entries: readonly TimelineEntry[]): TimelineMessage[] {
  return entries.filter((e): e is TimelineMessage => e.kind === 'message');
}

const ANSWERED: ChatReply = {
  kind: 'answered',
  choiceId: 'yes',
  playerText: '好',
  responses: PROMPT.choices[0]?.responses.map((r) => ({ ...r, lines: [...r.lines] })) ?? [],
};

describe('buildTimeline', () => {
  it('未回答：只有內容訊息，依傳入順序；每一天的第一則前有日期分隔', () => {
    expect(ids(build())).toEqual(['date:day.01', 'msg.1', 'msg.2', 'msg.3', 'date:day.02', 'msg.4']);
    const dates = build().filter((e) => e.kind === 'date');
    expect(dates.map((d) => (d.kind === 'date' ? d.label : ''))).toEqual(['9 月 15 日', '9 月 16 日']);
  });

  it('skipped：與未回答相同，不出現「不回覆」或任何玩家列', () => {
    expect(ids(build({ kind: 'skipped' }))).toEqual(ids(build()));
    expect(rows(build({ kind: 'skipped' })).some((r) => r.player)).toBeFalse();
  });

  it('answered：玩家列與 responses 緊接在 anchor 之後、在之後的內容訊息之前', () => {
    expect(ids(build(ANSWERED))).toEqual([
      'date:day.01',
      'msg.1',
      'msg.2',
      `${PROMPT.id}:you`,
      'msg.fixture.reply.a',
      'msg.fixture.reply.b',
      'msg.3',
      'date:day.02',
      'msg.4',
    ]);
    const player = rows(build(ANSWERED)).find((r) => r.player);
    expect(player?.author).toBe('你');
    expect(player?.initial).toBe('你');
    expect(player?.lines.map((l) => l.text)).toEqual(['好']);
    expect(player?.time).toBe('09:01');
    expect(player?.promptId).toBe(PROMPT.id);
  });

  it('responses 用保存的快照（不是內容檔目前的文字），多行各自一段', () => {
    const snapshot: ChatReply = {
      ...ANSWERED,
      playerText: '舊的玩家文字',
      responses: [{ id: 'msg.fixture.reply.old', actorId: 'actor.b', time: '09:05', lines: ['舊回應', '第二段'] }],
    };
    const shown = rows(build(snapshot));
    expect(shown.find((r) => r.player)?.lines.map((l) => l.text)).toEqual(['舊的玩家文字']);
    const resp = shown.find((r) => r.id === 'msg.fixture.reply.old');
    expect(resp?.lines.map((l) => l.id)).toEqual(['msg.fixture.reply.old#0', 'msg.fixture.reply.old#1']);
    expect(shown.some((r) => r.id === 'msg.fixture.reply.a')).toBeFalse();
  });

  it('相同作者、同一天、五分鐘內才合併；玩家列、換人、換日與超過五分鐘都重新顯示作者', () => {
    const byId = new Map(rows(build(ANSWERED)).map((r) => [r.id, r]));
    expect(byId.get('msg.1')?.continued).toBeFalse();
    expect(byId.get('msg.2')?.continued).toBeTrue(); // 同作者 1 分鐘
    expect(byId.get(`${PROMPT.id}:you`)?.continued).toBeFalse(); // 換成玩家
    expect(byId.get('msg.fixture.reply.a')?.continued).toBeFalse(); // 玩家之後
    expect(byId.get('msg.fixture.reply.b')?.continued).toBeFalse(); // 換人
    expect(byId.get('msg.3')?.continued).toBeFalse(); // 同為 actor.b 但相隔 7 分鐘
    expect(byId.get('msg.4')?.continued).toBeFalse(); // 換日
  });

  it('剛好五分鐘仍合併，六分鐘不合併；時間倒退不合併', () => {
    const make = (a: string, b: string) =>
      rows(
        buildTimeline({
          messages: [msg('m.a', 'actor.a', a, 'day.01'), msg('m.b', 'actor.a', b, 'day.01')],
          replyOf: () => undefined,
          actorName: () => 'A',
          dateLabel: () => 'D',
          you: '你',
        }),
      )[1]?.continued;
    expect(make('09:00', '09:05')).toBeTrue();
    expect(make('09:00', '09:06')).toBeFalse();
    expect(make('09:05', '09:00')).toBeFalse();
  });

  it('fresh 只標在指定 prompt 產生的列上；內容訊息永遠不是 fresh', () => {
    const fresh = rows(build(ANSWERED, new Set([PROMPT.id]))).filter((r) => r.fresh).map((r) => r.id);
    expect(fresh).toEqual([`${PROMPT.id}:you`, 'msg.fixture.reply.a', 'msg.fixture.reply.b']);
    expect(rows(build(ANSWERED)).some((r) => r.fresh)).toBeFalse();
  });

  it('相同輸入得到相同 id 與順序（穩定）', () => {
    expect(ids(build(ANSWERED))).toEqual(ids(build(ANSWERED)));
  });

  it('沒有訊息時為空；lastMessageOf 取最後一則訊息列', () => {
    const empty = buildTimeline({ messages: [], replyOf: () => undefined, actorName: () => '', dateLabel: () => '', you: '你' });
    expect(empty).toEqual([]);
    expect(lastMessageOf(empty)).toBeNull();
    expect(lastMessageOf(build())?.id).toBe('msg.4');
  });
});

describe('timeline 小工具', () => {
  it('minutesOf 解析 HH:MM，格式不符為 NaN', () => {
    expect(minutesOf('08:36')).toBe(8 * 60 + 36);
    expect(minutesOf('9:05')).toBe(9 * 60 + 5);
    expect(minutesOf('abc')).toBeNaN();
  });

  it('initialOf 取第一個字元', () => {
    expect(initialOf('林予安')).toBe('林');
    expect(initialOf(' 你')).toBe('你');
    expect(initialOf('')).toBe('');
  });
});

describe('buildTimeline：依保存的送達時間（正在輸入）', () => {
  const T0 = new Date(2026, 8, 15, 10, 20).getTime();
  const answered: ChatReply = {
    kind: 'answered',
    choiceId: 'yes',
    playerText: '好',
    answeredAt: T0,
    dayId: 'day.01',
    responses: (PROMPT.choices[0]?.responses ?? []).map((r, i) => ({ ...r, lines: [...r.lines], deliverAt: T0 + 3000 * (i + 1) })),
  };
  const paced = (now: number): readonly TimelineEntry[] =>
    buildTimeline({
      messages: MESSAGES,
      replyOf: (id) => (id === PROMPT.id ? answered : undefined),
      actorName: (id) => NAMES[id] ?? '',
      dateLabel: (id) => LABELS[id] ?? '',
      you: '王小明',
      now,
    });

  it('送達時間未到的回應不出現，改在玩家列之後放「正在輸入」列（下一位回應者）', () => {
    const entries = paced(T0);
    expect(ids(entries)).toEqual([
      'date:day.01', 'msg.1', 'msg.2', `${PROMPT.id}:you`, `${PROMPT.id}:typing`, 'msg.3', 'date:day.02', 'msg.4',
    ]);
    const typing = entries.find((e) => e.kind === 'typing');
    expect(typing?.kind === 'typing' ? typing.author : '').toBe('林予安');
    expect(typing?.kind === 'typing' ? typing.sourceId : '').toBe(PROMPT.id);
  });

  it('第一則送達後，正在輸入的是第二位回應者；剛好到點即送達', () => {
    const entries = paced(T0 + 3000);
    expect(ids(entries)).toContain('msg.fixture.reply.a');
    expect(ids(entries)).not.toContain('msg.fixture.reply.b');
    const typing = entries.find((e) => e.kind === 'typing');
    expect(typing?.kind === 'typing' ? typing.author : '').toBe('楊子謙');
  });

  it('全部送達後沒有「正在輸入」列；一般 prompt 仍用內容時間；日期分隔不重複', () => {
    const all = paced(T0 + 6000);
    expect(ids(all)).toEqual(ids(build(answered)));
    expect(rows(all).find((r) => r.id === 'msg.fixture.reply.a')?.time).toBe('09:02');
    expect(rows(all).find((r) => r.player)?.time).toBe('09:01');
    expect(paced(T0).filter((e) => e.kind === 'date').length).toBe(2);
  });

  it('玩家列的署名是傳入的角色名', () => {
    const player = rows(paced(T0)).find((r) => r.player);
    expect(player?.author).toBe('王小明');
    expect(player?.initial).toBe('王');
  });

  it('沒有 deliverAt 的舊回應直接顯示（不論 now）', () => {
    const legacy: ChatReply = { ...ANSWERED };
    const entries = buildTimeline({
      messages: MESSAGES,
      replyOf: (id) => (id === PROMPT.id ? legacy : undefined),
      actorName: (id) => NAMES[id] ?? '',
      dateLabel: (id) => LABELS[id] ?? '',
      you: '員工',
      now: 0,
    });
    expect(ids(entries)).toContain('msg.fixture.reply.b');
    expect(entries.some((e) => e.kind === 'typing')).toBeFalse();
  });

  it('「正在輸入」列之後的內容訊息不與之前的列合併', () => {
    const after = paced(T0).find((e) => e.id === 'msg.3');
    expect(after?.kind === 'message' ? after.continued : true).toBeFalse();
  });
});

describe('buildTimeline：提問區塊（R12 §4）', () => {
  const REQUEST_ID = 'request.fixture';
  const HELP_PROMPT: ContentReplyPrompt = {
    id: 'prompt.help.fixture',
    availableThrough: 'day.03',
    choices: [
      {
        id: 'ask',
        text: '再問一下',
        responses: [{ id: 'msg.help.fixture.reply', actorId: 'actor.a', time: '09:02', lines: ['好'] }],
      },
    ],
  };
  // 說明訊息的模板時間與 visibleFrom 都是 Day 1，實際位置由提問日與送達時間決定
  const HELP_A = msg('msg.help.a', 'actor.a', '09:00', 'day.01');
  const HELP_B = msg('msg.help.b', 'actor.a', '09:01', 'day.01', { replyPrompt: HELP_PROMPT });
  const DAY3_LABELS: Readonly<Record<string, string>> = { ...LABELS, 'day.02': '9 月 16 日', 'day.03': '9 月 17 日' };
  const ORDER: Readonly<Record<string, number>> = { 'day.01': 1, 'day.02': 2, 'day.03': 3 };
  const ASKED = new Date(2026, 8, 17, 14, 7).getTime();
  const REQUEST: TimelineRequest = {
    id: REQUEST_ID,
    dayId: 'day.02',
    askedAt: ASKED,
    playerText: '這個欄位是什麼？',
    deliveries: [
      { messageId: 'msg.help.a', at: ASKED + 3000 },
      { messageId: 'msg.help.b', at: ASKED + 66_000 },
    ],
  };

  function withRequest(now: number, extra: Partial<TimelineInput> = {}): readonly TimelineEntry[] {
    return buildTimeline({
      messages: [...MESSAGES, HELP_A, HELP_B],
      replyOf: () => undefined,
      actorName: (id) => NAMES[id] ?? '',
      dateLabel: (id) => DAY3_LABELS[id] ?? '',
      you: '王小明',
      now,
      requestOfMessage: (id) => (id.startsWith('msg.help.') ? REQUEST_ID : undefined),
      requestOf: (id) => (id === REQUEST_ID ? REQUEST : undefined),
      dayOrder: (id) => ORDER[id] ?? Number.NaN,
      ...extra,
    });
  }

  it('尚未送出提問：說明訊息不出現，也沒有提問列', () => {
    const entries = withRequest(ASKED, { requestOf: () => undefined });
    expect(ids(entries).some((id) => id.includes('help') || id.startsWith(REQUEST_ID))).toBeFalse();
  });

  it('提問列（實際時間、玩家署名）→ 下一則「正在輸入」，之後什麼都不放；放在提問日段落的最後', () => {
    expect(ids(withRequest(ASKED))).toEqual([
      'date:day.01', 'msg.1', 'msg.2', 'msg.3', 'date:day.02', 'msg.4', `${REQUEST_ID}:you`, `${REQUEST_ID}:typing`,
    ]);
    const you = rows(withRequest(ASKED)).find((r) => r.id === `${REQUEST_ID}:you`);
    expect(you?.player).toBeTrue();
    expect(you?.author).toBe('王小明');
    expect(you?.time).toBe('14:07');
    expect(you?.dayId).toBe('day.02');
    expect(you?.lines.map((l) => l.text)).toEqual(['這個欄位是什麼？']);
  });

  it('說明逐則送達，時間是送達的實際時間（不是模板的 09:00）', () => {
    const one = withRequest(ASKED + 3000);
    expect(ids(one).slice(-3)).toEqual([`${REQUEST_ID}:you`, 'msg.help.a', `${REQUEST_ID}:typing`]);
    expect(rows(one).find((r) => r.id === 'msg.help.a')?.time).toBe('14:07');
    const both = withRequest(ASKED + 66_000);
    expect(ids(both).slice(-3)).toEqual([`${REQUEST_ID}:you`, 'msg.help.a', 'msg.help.b']);
    expect(rows(both).find((r) => r.id === 'msg.help.b')?.time).toBe('14:08');
    expect(both.some((e) => e.kind === 'typing')).toBeFalse();
  });

  it('提問日在最後一個有訊息的日之後：依日序補上該日的日期分隔', () => {
    const later: TimelineRequest = { ...REQUEST, dayId: 'day.03' };
    const entries = withRequest(ASKED + 66_000, { requestOf: () => later });
    expect(ids(entries).slice(-5)).toEqual(['msg.4', 'date:day.03', `${REQUEST_ID}:you`, 'msg.help.a', 'msg.help.b']);
    expect(entries.find((e) => e.id === 'date:day.03')?.kind === 'date').toBeTrue();
  });

  it('提問日較早：區塊插在該日段落最後、下一日之前', () => {
    const early: TimelineRequest = { ...REQUEST, dayId: 'day.01' };
    expect(ids(withRequest(ASKED + 66_000, { requestOf: () => early }))).toEqual([
      'date:day.01', 'msg.1', 'msg.2', 'msg.3', `${REQUEST_ID}:you`, 'msg.help.a', 'msg.help.b', 'date:day.02', 'msg.4',
    ]);
  });

  it('說明 prompt 的回答接在它的 anchor 之後，用回答與送達的實際時間；送達前顯示正在輸入', () => {
    const answeredAt = ASKED + 120_000;
    const reply: ChatReply = {
      kind: 'answered',
      choiceId: 'ask',
      playerText: '再問一下',
      answeredAt,
      dayId: 'day.02',
      responses: [{ id: 'msg.help.fixture.reply', actorId: 'actor.a', time: '09:02', lines: ['好'], deliverAt: answeredAt + 3000 }],
    };
    const replyOf = (id: string) => (id === HELP_PROMPT.id ? reply : undefined);
    const waiting = withRequest(answeredAt, { replyOf });
    expect(ids(waiting).slice(-3)).toEqual(['msg.help.b', `${HELP_PROMPT.id}:you`, `${HELP_PROMPT.id}:typing`]);
    expect(rows(waiting).find((r) => r.id === `${HELP_PROMPT.id}:you`)?.time).toBe(localClockTime(answeredAt));
    const done = withRequest(answeredAt + 3000, { replyOf });
    expect(ids(done).slice(-2)).toEqual([`${HELP_PROMPT.id}:you`, 'msg.help.fixture.reply']);
    expect(rows(done).find((r) => r.id === 'msg.help.fixture.reply')?.time).toBe(localClockTime(answeredAt + 3000));
  });

  it('localClockTime：本地時間兩位數 HH:MM', () => {
    expect(localClockTime(new Date(2026, 8, 15, 8, 5).getTime())).toBe('08:05');
    expect(localClockTime(new Date(2026, 8, 15, 23, 59).getTime())).toBe('23:59');
  });
});
