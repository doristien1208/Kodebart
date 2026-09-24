import { ConditionContext } from '../../../content/conditions';
import { ContentChannel, ContentMessage } from '../../../content/schema';
import { ChatReply, NightResult } from '../../../core/types';
import {
  ChannelMessages,
  channelOf,
  deriveChannelMessages,
  readableIdsOf,
  totalUnread,
  withUnread,
} from './unread';

/**
 * KB-R4-04 第 4、5、6 點與 KB-R5-01 第 1～3 點：未讀＝已解鎖 − 已讀，已解鎖是跨日累積的歷史。
 *
 * 這裡刻意用合成內容（不是正式資料檔）測推導本身：正式內容目前只有一個私訊頻道，
 * 無法涵蓋「開某個頻道不會把別的頻道標為已讀」與非時間順序解鎖。
 * 合成頻道只是測試夾具，不是遊戲內容，也不會出現在畫面上。
 */

const CHANNELS: readonly ContentChannel[] = [
  { id: 'channel.dept.fixture', kind: 'department', title: 'A', actorIds: [] },
  { id: 'channel.dm.fixture', kind: 'direct', actorIds: ['actor.fixture'] },
];

function msg(
  id: string,
  channelId: string,
  visibleFrom: string,
  unlock: string[] = [],
  variant?: ContentMessage['variant'],
): ContentMessage {
  return { id, channelId, actorId: 'actor.fixture', time: '09:00', visibleFrom, unlock, lines: [id], variant };
}

/**
 * 夾具訊息。注意順序：檔內把「第二天才可見」的 msg.late 放在最前面，
 * 由 messagesOf（模擬 bundle 的 messagesOfChannel）負責先依日序、再依檔內順序排好。
 */
const FIXTURE_MESSAGES: readonly ContentMessage[] = [
  msg('msg.late', 'channel.dept.fixture', 'day.02'),
  msg('msg.early', 'channel.dept.fixture', 'day.01'),
  msg('msg.dm', 'channel.dm.fixture', 'day.01'),
  msg('msg.dm.day2', 'channel.dm.fixture', 'day.02'),
  msg('msg.dm.variant0', 'channel.dm.fixture', 'day.02', ['cond.night.smalltalk.0'], {
    key: 'night.smallTalkVariant',
    value: 0,
  }),
  msg('msg.dm.variant1', 'channel.dm.fixture', 'day.02', ['cond.night.smalltalk.1'], {
    key: 'night.smallTalkVariant',
    value: 1,
  }),
];

/** 夾具的內容目錄：只認識兩天；其餘 day ID 解析成 NaN。 */
const FIXTURE_DAY_ORDER: Readonly<Record<string, number>> = { 'day.01': 1, 'day.02': 2 };
function dayOrder(dayId: string): number {
  return FIXTURE_DAY_ORDER[dayId] ?? Number.NaN;
}

function night(smallTalkVariant: 0 | 1): NightResult {
  return { intervention: false, smallTalkVariant, reportRevision: 1 };
}

/** 夾具的批次覆核推導：預設沒有任何批次送覆核。 */
const noReview = (): boolean => false;
/** 夾具的聊天回覆：沒有任何已回答的 prompt。 */
const noChat = (): string | null => null;
/** 夾具的批次進度：沒有任何已歸檔紀錄（R8 unlockAfter）。 */
const noArchived = (): number => 0;
/** 夾具的比對案件決定：沒有任何已提交的案件（R9）。 */
const noCase = (): string | null => null;
/** 夾具的退件通知：沒有任何已通知的退件（R10）。 */
const noReturn = (): boolean => false;
/** 夾具的向同事詢問：沒有任何已送出的提問（R12）。 */
const noHelp = (): boolean => false;

const CTX_FIRST: ConditionContext = {
  dayId: 'day.01',
  dayOrder,
  stage: 'work',
  night: null,
  hasReview: noReview,
  archivedCount: noArchived,
  caseDecision: noCase,
  returnNotified: noReturn,
  chatChoice: noChat,
  helpRequested: noHelp,
};
const CTX_SECOND: ConditionContext = { ...CTX_FIRST, dayId: 'day.02', night: night(0) };
const CTX_SECOND_VARIANT1: ConditionContext = { ...CTX_SECOND, night: night(1) };

/** 模擬 bundle.messagesOfChannel：先日序、再檔內順序（穩定排序）。 */
function messagesOf(channelId: string): readonly ContentMessage[] {
  return FIXTURE_MESSAGES.map((m, index) => ({ m, index }))
    .filter(({ m }) => m.channelId === channelId)
    .sort((a, b) => dayOrder(a.m.visibleFrom) - dayOrder(b.m.visibleFrom) || a.index - b.index)
    .map(({ m }) => m);
}

function channels(ctx: ConditionContext | null): readonly ChannelMessages[] {
  return deriveChannelMessages({ channels: CHANNELS, messagesOf, titleOf: (id) => id, ctx });
}

function unlockedIds(ctx: ConditionContext | null, channelId: string): readonly string[] {
  return channelOf(channels(ctx), channelId)?.unlocked.map((m) => m.id) ?? [];
}

function unreadIds(ctx: ConditionContext | null, read: readonly string[]): readonly string[] {
  return withUnread(channels(ctx), (id) => read.includes(id)).flatMap((c) => c.unreadIds);
}

describe('未讀推導', () => {
  it('沒有存檔時沒有任何已解鎖訊息，也沒有紅點', () => {
    expect(channels(null).every((c) => c.unlocked.length === 0)).toBeTrue();
    expect(totalUnread(withUnread(channels(null), () => false))).toBe(0);
  });

  it('彙總未讀＝已解鎖 − 已讀', () => {
    expect(unreadIds(CTX_FIRST, [])).toEqual(['msg.early', 'msg.dm']);
    expect(unreadIds(CTX_FIRST, ['msg.early'])).toEqual(['msg.dm']);
    expect(unreadIds(CTX_FIRST, ['msg.early', 'msg.dm'])).toEqual([]);
  });

  it('尚未到 visibleFrom 那一天的訊息不算未讀，也不預告', () => {
    const all = withUnread(channels(CTX_FIRST), () => false);
    const ids = all.flatMap((c) => c.unlocked.map((m) => m.id));
    expect(ids).not.toContain('msg.late');
    expect(ids).not.toContain('msg.dm.day2');
    expect(totalUnread(all)).toBe(2);
  });

  it('已讀但尚未解鎖的 ID 不會讓計數變成負值', () => {
    expect(totalUnread(withUnread(channels(CTX_FIRST), (id) => id === 'msg.late'))).toBe(2);
  });

  it('晚到、非時間順序解鎖的訊息仍會出現紅點', () => {
    const read = ['msg.early', 'msg.dm'];
    expect(unreadIds(CTX_FIRST, read)).toEqual([]);
    // 進到第二天後，內容檔中排在前面但 visibleFrom 較晚的訊息才解鎖
    expect(unreadIds(CTX_SECOND, read)).toContain('msg.late');
    expect(channelOf(withUnread(channels(CTX_SECOND), (id) => read.includes(id)), 'channel.dept.fixture')?.unreadIds).toEqual([
      'msg.late',
    ]);
  });

  it('每個頻道各自計算未讀', () => {
    const list = withUnread(channels(CTX_SECOND), (id) => id === 'msg.early');
    expect(channelOf(list, 'channel.dept.fixture')?.unreadIds).toEqual(['msg.late']);
    expect(channelOf(list, 'channel.dm.fixture')?.unreadIds).toEqual(['msg.dm', 'msg.dm.day2', 'msg.dm.variant0']);
    expect(channelOf(list, 'channel.unknown')).toBeNull();
    expect(channelOf(list, null)).toBeNull();
  });
});

describe('跨日歷史（KB-R5-01）', () => {
  it('Day 2 的已解鎖訊息包含 Day 1 的歷史，順序是先日序再內容順序', () => {
    expect(unlockedIds(CTX_SECOND, 'channel.dept.fixture')).toEqual(['msg.early', 'msg.late']);
    expect(unlockedIds(CTX_SECOND, 'channel.dm.fixture')).toEqual(['msg.dm', 'msg.dm.day2', 'msg.dm.variant0']);
  });

  it('Day 1 已讀的訊息在 Day 2 不會重新亮紅點；只有新解鎖的算未讀', () => {
    const readOnDay1 = readableIdsOf(channels(CTX_FIRST), 'channel.dm.fixture');
    expect(readOnDay1).toEqual(['msg.dm']);

    const day2 = withUnread(channels(CTX_SECOND), (id) => readOnDay1.includes(id));
    const dm = channelOf(day2, 'channel.dm.fixture');
    expect(dm?.unlocked.map((m) => m.id)).toContain('msg.dm');
    expect(dm?.unreadIds).toEqual(['msg.dm.day2', 'msg.dm.variant0']);
    expect(dm?.unreadIds).not.toContain('msg.dm');
  });

  it('夜間閒聊只顯示已保存的 variant，不同時出現兩個版本', () => {
    expect(unlockedIds(CTX_SECOND, 'channel.dm.fixture')).toContain('msg.dm.variant0');
    expect(unlockedIds(CTX_SECOND, 'channel.dm.fixture')).not.toContain('msg.dm.variant1');
    expect(unlockedIds(CTX_SECOND_VARIANT1, 'channel.dm.fixture')).toContain('msg.dm.variant1');
    expect(unlockedIds(CTX_SECOND_VARIANT1, 'channel.dm.fixture')).not.toContain('msg.dm.variant0');
  });

  it('夜間尚未判定時，兩個 variant 都不會出現', () => {
    const noNight: ConditionContext = { ...CTX_SECOND, night: null };
    expect(unlockedIds(noNight, 'channel.dm.fixture')).toEqual(['msg.dm', 'msg.dm.day2']);
  });

  it('內容目錄解析不出的 day ID 視為沒有任何已解鎖訊息', () => {
    const unknown: ConditionContext = { ...CTX_FIRST, dayId: 'day.99' };
    expect(channels(unknown).every((c) => c.unlocked.length === 0)).toBeTrue();
  });
});

describe('批次覆核條件（R6-03；Day 4 互斥訊息的推導）', () => {
  const BATCH = 'batch.day01.fixture';
  const REVIEW_MESSAGES: readonly ContentMessage[] = [
    msg('msg.review.any', 'channel.dept.fixture', 'day.02', [`cond.review.any.${BATCH}`]),
    msg('msg.review.none', 'channel.dept.fixture', 'day.02', [`cond.review.none.${BATCH}`]),
    msg('msg.review.after', 'channel.dept.fixture', 'day.02'),
  ];

  function unlockedWith(hasReview: (batchId: string) => boolean): readonly string[] {
    return (
      deriveChannelMessages({
        channels: CHANNELS,
        messagesOf: (id) => REVIEW_MESSAGES.filter((m) => m.channelId === id),
        titleOf: (id) => id,
        ctx: { ...CTX_SECOND, hasReview },
      })
        .find((c) => c.id === 'channel.dept.fixture')
        ?.unlocked.map((m) => m.id) ?? []
    );
  }

  it('批次有送覆核時只出現 any 那則，沒有時只出現 none 那則；順序固定', () => {
    expect(unlockedWith((b) => b === BATCH)).toEqual(['msg.review.any', 'msg.review.after']);
    expect(unlockedWith(() => false)).toEqual(['msg.review.none', 'msg.review.after']);
  });

  it('只看指定的批次：其他批次有送覆核不影響', () => {
    expect(unlockedWith((b) => b === 'batch.day02.other')).toEqual(['msg.review.none', 'msg.review.after']);
  });
});

describe('readableIdsOf（可被讀到的已送達訊息）', () => {
  it('只包含該頻道目前已解鎖的訊息（含前幾日歷史），不動其他頻道', () => {
    expect(readableIdsOf(channels(CTX_SECOND), 'channel.dept.fixture')).toEqual(['msg.early', 'msg.late']);
    expect(readableIdsOf(channels(CTX_SECOND), 'channel.dm.fixture')).toEqual(['msg.dm', 'msg.dm.day2', 'msg.dm.variant0']);
  });

  it('不包含尚未解鎖的訊息', () => {
    expect(readableIdsOf(channels(CTX_FIRST), 'channel.dept.fixture')).toEqual(['msg.early']);
  });

  it('沒有選取頻道或頻道不存在時為空', () => {
    expect(readableIdsOf(channels(CTX_FIRST), null)).toEqual([]);
    expect(readableIdsOf(channels(CTX_FIRST), 'channel.unknown')).toEqual([]);
  });

  it('開啟一個頻道後，另一個頻道的未讀不受影響', () => {
    const opened = readableIdsOf(channels(CTX_SECOND), 'channel.dept.fixture');
    const list = withUnread(channels(CTX_SECOND), (id) => opened.includes(id));
    expect(channelOf(list, 'channel.dept.fixture')?.unreadIds).toEqual([]);
    expect(channelOf(list, 'channel.dm.fixture')?.unreadIds).toEqual(['msg.dm', 'msg.dm.day2', 'msg.dm.variant0']);
    expect(totalUnread(list)).toBe(3);
  });
});

describe('已送達的他人訊息（R12 §2：回覆 responses 與提問說明）', () => {
  const PROMPT_ID = 'prompt.fixture.ask';
  const REQUEST = 'request.fixture';
  const DM = 'channel.dm.fixture';
  const T0 = 1_000_000;
  const DELIVERY_MESSAGES: readonly ContentMessage[] = [
    {
      ...msg('msg.anchor', DM, 'day.01'),
      replyPrompt: {
        id: PROMPT_ID,
        availableThrough: 'day.01',
        choices: [{ id: 'yes', text: '好', responses: [] }],
      },
    },
    msg('msg.help.a', DM, 'day.01', ['cond.help.fixture.requested']),
    msg('msg.help.b', DM, 'day.01', ['cond.help.fixture.requested']),
  ];
  const ANSWERED: ChatReply = {
    kind: 'answered',
    choiceId: 'yes',
    playerText: '好',
    answeredAt: T0,
    dayId: 'day.01',
    responses: [
      { id: 'msg.reply.a', actorId: 'actor.fixture', time: '09:01', lines: ['a'], deliverAt: T0 + 3000 },
      { id: 'msg.reply.b', actorId: 'actor.fixture', time: '09:02', lines: ['b'], deliverAt: T0 + 6000 },
    ],
  };
  const LEGACY: ChatReply = {
    kind: 'answered',
    choiceId: 'yes',
    playerText: '好',
    responses: [{ id: 'msg.reply.legacy', actorId: 'actor.fixture', time: '09:01', lines: ['舊'] }],
  };
  const HELP_AT: Readonly<Record<string, number>> = { 'msg.help.a': T0 + 3000, 'msg.help.b': T0 + 6500 };

  function delivered(opts: { now: number; reply?: ChatReply; requested?: boolean }): readonly string[] {
    const requested = opts.requested ?? false;
    return (
      deriveChannelMessages({
        channels: CHANNELS,
        messagesOf: (id) => DELIVERY_MESSAGES.filter((m) => m.channelId === id),
        titleOf: (id) => id,
        ctx: { ...CTX_FIRST, helpRequested: (id) => requested && id === REQUEST },
        replyOf: (id) => (id === PROMPT_ID ? opts.reply : undefined),
        requestOfMessage: (id) => (id.startsWith('msg.help.') ? REQUEST : undefined),
        helpDeliveryAt: (id) => (requested ? HELP_AT[id] : undefined),
        now: opts.now,
      }).find((c) => c.id === DM)?.deliveredIds ?? []
    );
  }

  it('回應在保存的 deliverAt 之前不算送達（不會先亮紅點），到點逐則加入', () => {
    expect(delivered({ now: T0, reply: ANSWERED })).toEqual(['msg.anchor']);
    expect(delivered({ now: T0 + 2999, reply: ANSWERED })).toEqual(['msg.anchor']);
    expect(delivered({ now: T0 + 3000, reply: ANSWERED })).toEqual(['msg.anchor', 'msg.reply.a']);
    expect(delivered({ now: T0 + 6000, reply: ANSWERED })).toEqual(['msg.anchor', 'msg.reply.a', 'msg.reply.b']);
  });

  it('玩家自己的列永遠不在已送達清單（不算未讀）', () => {
    const ids = delivered({ now: T0 + 10_000, reply: ANSWERED });
    expect(ids.some((id) => id.endsWith(':you'))).toBeFalse();
  });

  it('沒有 deliverAt 的舊回應視為已送達', () => {
    expect(delivered({ now: 0, reply: LEGACY })).toEqual(['msg.anchor', 'msg.reply.legacy']);
  });

  it('說明訊息：提問前不解鎖；提問後依保存的送達時間逐則送達', () => {
    expect(delivered({ now: T0 + 10_000 })).toEqual(['msg.anchor']);
    expect(delivered({ now: T0, requested: true })).toEqual(['msg.anchor']);
    expect(delivered({ now: T0 + 3000, requested: true })).toEqual(['msg.anchor', 'msg.help.a']);
    expect(delivered({ now: T0 + 6500, requested: true })).toEqual(['msg.anchor', 'msg.help.a', 'msg.help.b']);
  });

  it('未讀＝已送達 − 已讀；尚未送達的回應即使已在已讀清單也不影響計數', () => {
    const channels = deriveChannelMessages({
      channels: CHANNELS,
      messagesOf: (id) => DELIVERY_MESSAGES.filter((m) => m.channelId === id),
      titleOf: (id) => id,
      ctx: CTX_FIRST,
      replyOf: (id) => (id === PROMPT_ID ? ANSWERED : undefined),
      now: T0 + 3000,
    });
    const list = withUnread(channels, (id) => id === 'msg.anchor' || id === 'msg.reply.b');
    expect(channelOf(list, DM)?.unreadIds).toEqual(['msg.reply.a']);
    expect(totalUnread(list)).toBe(1);
  });
});
