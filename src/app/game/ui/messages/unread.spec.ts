import { ConditionContext } from '../../content/conditions';
import { ContentChannel, ContentMessage } from '../../content/schema';
import {
  ChannelMessages,
  channelOf,
  deriveChannelMessages,
  readableIdsOf,
  totalUnread,
  withUnread,
} from './unread';

/**
 * KB-R4-04 第 4、5、6 點：未讀＝已解鎖 − 已讀。
 *
 * 這裡刻意用合成內容（不是正式資料檔）測推導本身：正式內容目前只有一個私訊頻道，
 * 無法涵蓋「開某個頻道不會把別的頻道標為已讀」與非時間順序解鎖。
 * 合成頻道只是測試夾具，不是遊戲內容，也不會出現在畫面上。
 */

const CHANNELS: readonly ContentChannel[] = [
  { id: 'channel.dept.fixture', kind: 'department', title: 'A', actorIds: [] },
  { id: 'channel.dm.fixture', kind: 'direct', actorIds: ['actor.fixture'] },
];

function msg(id: string, channelId: string, unlock: string[]): ContentMessage {
  return { id, channelId, actorId: 'actor.fixture', time: '09:00', unlock, lines: [id] };
}

/** 注意順序：較晚才解鎖的 msg.late 排在一開始就解鎖的 msg.early 前面。 */
const FIXTURE_MESSAGES: readonly ContentMessage[] = [
  msg('msg.late', 'channel.dept.fixture', ['cond.day.2']),
  msg('msg.early', 'channel.dept.fixture', ['cond.always']),
  msg('msg.dm', 'channel.dm.fixture', ['cond.always']),
];

const DAY1: ConditionContext = { day: 1, phase: 'day1', night: null };
const DAY2: ConditionContext = {
  day: 2,
  phase: 'day2',
  night: { intervention: false, smallTalkVariant: 0, reportRevision: 1 },
};

function channels(ctx: ConditionContext | null): readonly ChannelMessages[] {
  return deriveChannelMessages({
    channels: CHANNELS,
    messagesOf: (id) => FIXTURE_MESSAGES.filter((m) => m.channelId === id),
    titleOf: (id) => id,
    ctx,
  });
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
    expect(unreadIds(DAY1, [])).toEqual(['msg.early', 'msg.dm']);
    expect(unreadIds(DAY1, ['msg.early'])).toEqual(['msg.dm']);
    expect(unreadIds(DAY1, ['msg.early', 'msg.dm'])).toEqual([]);
  });

  it('尚未解鎖的訊息不算未讀，也不預告', () => {
    const all = withUnread(channels(DAY1), () => false);
    expect(all.flatMap((c) => c.unlocked.map((m) => m.id))).not.toContain('msg.late');
    expect(totalUnread(all)).toBe(2);
  });

  it('已讀但尚未解鎖的 ID 不會讓計數變成負值', () => {
    expect(totalUnread(withUnread(channels(DAY1), (id) => id === 'msg.late'))).toBe(2);
  });

  it('晚到、非時間順序解鎖的訊息仍會出現紅點', () => {
    const read = ['msg.early', 'msg.dm'];
    expect(unreadIds(DAY1, read)).toEqual([]);
    // 進到第二天後，內容檔中排在前面但條件較晚成立的訊息才解鎖
    expect(unreadIds(DAY2, read)).toEqual(['msg.late']);
    expect(totalUnread(withUnread(channels(DAY2), (id) => read.includes(id)))).toBe(1);
  });

  it('每個頻道各自計算未讀', () => {
    const list = withUnread(channels(DAY2), (id) => id === 'msg.early');
    expect(channelOf(list, 'channel.dept.fixture')?.unreadIds).toEqual(['msg.late']);
    expect(channelOf(list, 'channel.dm.fixture')?.unreadIds).toEqual(['msg.dm']);
    expect(channelOf(list, 'channel.unknown')).toBeNull();
    expect(channelOf(list, null)).toBeNull();
  });
});

describe('readableIdsOf（開啟頻道時要標為已讀的訊息）', () => {
  it('只包含該頻道目前已解鎖的訊息，不動其他頻道', () => {
    expect(readableIdsOf(channels(DAY2), 'channel.dept.fixture')).toEqual(['msg.late', 'msg.early']);
    expect(readableIdsOf(channels(DAY2), 'channel.dm.fixture')).toEqual(['msg.dm']);
  });

  it('不包含尚未解鎖的訊息', () => {
    expect(readableIdsOf(channels(DAY1), 'channel.dept.fixture')).toEqual(['msg.early']);
  });

  it('沒有選取頻道或頻道不存在時為空', () => {
    expect(readableIdsOf(channels(DAY1), null)).toEqual([]);
    expect(readableIdsOf(channels(DAY1), 'channel.unknown')).toEqual([]);
  });

  it('開啟一個頻道後，另一個頻道的未讀不受影響', () => {
    const opened = readableIdsOf(channels(DAY2), 'channel.dept.fixture');
    const list = withUnread(channels(DAY2), (id) => opened.includes(id));
    expect(channelOf(list, 'channel.dept.fixture')?.unreadIds).toEqual([]);
    expect(channelOf(list, 'channel.dm.fixture')?.unreadIds).toEqual(['msg.dm']);
    expect(totalUnread(list)).toBe(1);
  });
});
