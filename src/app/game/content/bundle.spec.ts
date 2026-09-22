import { NightResult } from '../core/types';
import {
  ALL_MESSAGES,
  ALL_RECORDS,
  CONTENT,
  actorName,
  channelTitle,
  channelsOfKind,
  contentRecord,
  dayContent,
  messagesOfChannel,
  unlockedMessages,
} from './bundle';
import { ConditionContext, evaluateCondition, isUnlocked } from './conditions';
import { RECORDS, RECORD_B102, RECORD_B607, RECORD_H17, TOTAL_RECORDS } from './records';
import { ID_PREFIX } from './schema';
import { ASIDE, MESSAGES, NEWS } from './text';

/**
 * KB-R4-03：載入後的內容。
 * 檢查 ID 穩定性、前導零、條件解析，以及文案確實來自資料檔（不存在第二份真相）。
 */

const night = (smallTalkVariant: number): NightResult => ({
  intervention: false,
  smallTalkVariant,
  reportRevision: 1,
});

const ctx = (day: number, phase: ConditionContext['phase'], n: NightResult | null = null): ConditionContext => ({
  day,
  phase,
  night: n,
});

describe('內容 ID', () => {
  it('全部 ID 唯一', () => {
    const ids = [
      ...CONTENT.actors.map((a) => a.id),
      ...CONTENT.channels.map((c) => c.id),
      ...CONTENT.bulletins.map((b) => b.id),
      ...CONTENT.days.map((d) => d.id),
      ...CONTENT.days.map((d) => d.transition.id),
      ...CONTENT.days.flatMap((d) => d.records.map((r) => r.id)),
      ...CONTENT.days.flatMap((d) => d.documents.map((x) => x.id)),
      ...CONTENT.days.flatMap((d) => d.tasks.map((t) => t.id)),
      ...ALL_MESSAGES.map((m) => m.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每一種內容都有自己的命名空間', () => {
    for (const a of CONTENT.actors) expect(a.id.startsWith(ID_PREFIX.actor)).toBeTrue();
    for (const c of CONTENT.channels) expect(c.id.startsWith(ID_PREFIX.channel)).toBeTrue();
    for (const b of CONTENT.bulletins) expect(b.id.startsWith(ID_PREFIX.bulletin)).toBeTrue();
    for (const m of ALL_MESSAGES) expect(m.id.startsWith(ID_PREFIX.message)).toBeTrue();
    for (const r of ALL_RECORDS) expect(r.id.startsWith(ID_PREFIX.record)).toBeTrue();
    for (const d of CONTENT.days) {
      expect(d.id.startsWith(ID_PREFIX.day)).toBeTrue();
      expect(d.transition.id.startsWith(ID_PREFIX.transition)).toBeTrue();
      for (const t of d.tasks) expect(t.id.startsWith(ID_PREFIX.task)).toBeTrue();
      for (const x of d.documents) expect(x.id.startsWith(ID_PREFIX.document)).toBeTrue();
    }
  });
});

describe('紀錄載入', () => {
  it('存檔 key 不隨內容 ID 改變', () => {
    expect(RECORD_H17).toBe('H17');
    expect(RECORD_B102).toBe('B102');
    expect(RECORD_B607).toBe('B607');
  });

  it('人員編號一律是字串，前導零保留', () => {
    for (const r of ALL_RECORDS) expect(typeof r.code).toBe('string');
    expect(contentRecord('record.b102').code).toBe('0102');
    expect(contentRecord('record.b607').code).toBe('0607');
  });

  it('RECORDS 由資料檔決定，總數不是寫死的', () => {
    expect(TOTAL_RECORDS).toBe(RECORDS.length);
    expect(RECORDS.length).toBe(ALL_RECORDS.length);
    expect(RECORDS.map((r) => r.key)).toEqual(ALL_RECORDS.map((r) => r.key));
  });

  it('沒有姓名的來源仍然只是「未登記」，不會被補上名字', () => {
    expect(contentRecord('record.b102').name).toBeNull();
    expect(contentRecord('record.b607').name).toBeNull();
  });
});

describe('頻道結構（KB-R4-04 預留）', () => {
  it('三種分類都可查詢，本輪只有一個既有私訊', () => {
    expect(channelsOfKind('direct').length).toBe(1);
    expect(channelsOfKind('department').length).toBe(0);
    expect(channelsOfKind('group').length).toBe(0);
  });

  it('私訊標題取自對方的稱呼，不另外寫死', () => {
    const dm = channelsOfKind('direct')[0];
    expect(channelTitle(dm.id)).toBe(actorName(dm.actorIds[0]));
  });

  it('既有訊息全部屬於那個既有頻道，且都有作者與時間', () => {
    const dm = channelsOfKind('direct')[0];
    expect(messagesOfChannel(dm.id).length).toBe(ALL_MESSAGES.length);
    for (const m of ALL_MESSAGES) {
      expect(m.actorId).toBe('actor.lin-yuan');
      expect(m.time.length).toBeGreaterThan(0);
    }
  });
});

describe('解鎖條件', () => {
  it('依天數解析', () => {
    expect(evaluateCondition('cond.day.1', ctx(1, 'day1'))).toBeTrue();
    expect(evaluateCondition('cond.day.1', ctx(2, 'day2'))).toBeFalse();
    expect(evaluateCondition('cond.day.2', ctx(2, 'day2'))).toBeTrue();
  });

  it('依階段解析', () => {
    expect(evaluateCondition('cond.phase.day1', ctx(1, 'day1'))).toBeTrue();
    expect(evaluateCondition('cond.phase.overnight', ctx(1, 'day1'))).toBeFalse();
    expect(evaluateCondition('cond.phase.end', ctx(2, 'end'))).toBeTrue();
  });

  it('夜間閒聊版本依存檔決定，沒有 night 時不解鎖', () => {
    expect(evaluateCondition('cond.night.smalltalk.0', ctx(2, 'day2'))).toBeFalse();
    expect(evaluateCondition('cond.night.smalltalk.0', ctx(2, 'day2', night(0)))).toBeTrue();
    expect(evaluateCondition('cond.night.smalltalk.1', ctx(2, 'day2', night(0)))).toBeFalse();
  });

  it('未知條件一律 false，不會被當成成立', () => {
    expect(evaluateCondition('cond.made.up', ctx(1, 'day1'))).toBeFalse();
    expect(isUnlocked(['cond.day.1', 'cond.made.up'], ctx(1, 'day1'))).toBeFalse();
  });

  it('空條件代表無條件', () => {
    expect(isUnlocked([], ctx(1, 'day1'))).toBeTrue();
  });

  it('第一天只解鎖第一天的訊息', () => {
    const dm = channelsOfKind('direct')[0];
    const unlocked = unlockedMessages(dm.id, ctx(1, 'day1'));
    expect(unlocked.map((m) => m.id)).toEqual(dayContent(1).messages.map((m) => m.id));
  });

  it('第二天只出現符合存檔的那一則閒聊', () => {
    const dm = channelsOfKind('direct')[0];
    const v0 = unlockedMessages(dm.id, ctx(2, 'day2', night(0))).map((m) => m.id);
    const v1 = unlockedMessages(dm.id, ctx(2, 'day2', night(1))).map((m) => m.id);
    expect(v0.length).toBe(2);
    expect(v1.length).toBe(2);
    expect(v0).not.toEqual(v1);
    expect(v0[0]).toBe(v1[0]);
  });
});

describe('文案只有一份來源', () => {
  it('訊息文字直接來自每日資料檔', () => {
    expect(MESSAGES.day1).toEqual(dayContent(1).messages.flatMap((m) => m.lines));
    expect(MESSAGES.time[1]).toBe(dayContent(1).messages[0].time);
    expect(MESSAGES.time[2]).toBe(dayContent(2).messages[0].time);
  });

  it('閒聊版本的順序對應 variant.value', () => {
    const variants = dayContent(2).messages.filter((m) => m.variant !== undefined);
    expect(MESSAGES.day2SmallTalk.length).toBe(variants.length);
    expect(MESSAGES.day2SmallTalk[0]).toBe(variants[0].lines[0]);
  });

  it('同事稱呼來自 actors.json，不在介面檔另存一份', () => {
    expect(ASIDE.colleague).toBe(actorName(CONTENT.ui.aside.colleagueActorId));
    expect(MESSAGES.author).toBe(ASIDE.colleague);
  });

  it('公告文字來自 bulletins.json', () => {
    const welcome = CONTENT.bulletins[0];
    expect(NEWS.title).toBe(welcome.title);
    expect(NEWS.body).toBe(welcome.body[0]);
  });
});
