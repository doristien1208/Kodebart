import { ConditionContext, NamedCondition, evaluateCondition, evaluateNamedCondition } from './conditions';

const DEFS: readonly NamedCondition[] = [
  { id: 'cond.m2.bart.asked', kind: 'chat-choice', promptId: 'prompt.day7.m2-together', choiceIds: ['ask-colleagues'] },
  { id: 'cond.m2.bart.not-asked', kind: 'not-chat-choice', promptId: 'prompt.day7.m2-together', choiceIds: ['ask-colleagues'] },
  {
    id: 'cond.m2.r27.afternoon-cited',
    kind: 'case-citation',
    taskId: 'task.day9.m2-r27-packet',
    documentId: 'doc.day8.m2-r27-request',
    fieldIndex: 1,
  },
  {
    id: 'cond.m2.r27.afternoon-not-cited',
    kind: 'not-case-citation',
    taskId: 'task.day9.m2-r27-packet',
    documentId: 'doc.day8.m2-r27-request',
    fieldIndex: 1,
  },
];

function ctx(over: Partial<ConditionContext> = {}): ConditionContext {
  return {
    dayId: 'day.10',
    dayOrder: () => 10,
    stage: 'work',
    night: null,
    hasReview: () => false,
    chatChoice: () => null,
    archivedCount: () => 0,
    caseDecision: () => null,
    returnNotified: () => false,
    helpRequested: () => false,
    namedCondition: (id) => DEFS.find((d) => d.id === id),
    ...over,
  };
}

describe('M2 具名條件', () => {
  it('chat-choice／not-chat-choice：讀保存的回答；skipped 或未回答算「沒選」', () => {
    const asked = ctx({ chatChoice: (p) => (p === 'prompt.day7.m2-together' ? 'ask-colleagues' : null) });
    const other = ctx({ chatChoice: () => 'been-before' });
    const none = ctx();
    expect(evaluateCondition('cond.m2.bart.asked', asked)).toBeTrue();
    expect(evaluateCondition('cond.m2.bart.not-asked', asked)).toBeFalse();
    expect(evaluateCondition('cond.m2.bart.asked', other)).toBeFalse();
    expect(evaluateCondition('cond.m2.bart.not-asked', other)).toBeTrue();
    expect(evaluateCondition('cond.m2.bart.asked', none)).toBeFalse();
    expect(evaluateCondition('cond.m2.bart.not-asked', none)).toBeTrue();
  });

  it('case-citation／not-case-citation 互斥；尚未交付時兩者都不成立', () => {
    const cited = ctx({ caseCitation: () => true });
    const notCited = ctx({ caseCitation: () => false });
    const notSubmitted = ctx({ caseCitation: () => null });
    expect(evaluateCondition('cond.m2.r27.afternoon-cited', cited)).toBeTrue();
    expect(evaluateCondition('cond.m2.r27.afternoon-not-cited', cited)).toBeFalse();
    expect(evaluateCondition('cond.m2.r27.afternoon-cited', notCited)).toBeFalse();
    expect(evaluateCondition('cond.m2.r27.afternoon-not-cited', notCited)).toBeTrue();
    expect(evaluateCondition('cond.m2.r27.afternoon-cited', notSubmitted)).toBeFalse();
    expect(evaluateCondition('cond.m2.r27.afternoon-not-cited', notSubmitted)).toBeFalse();
  });

  it('引用條件只問指定的工作、文件與欄位', () => {
    const seen: unknown[] = [];
    evaluateNamedCondition(DEFS[2]!, ctx({ caseCitation: (...args) => (seen.push(args), true) }));
    expect(seen).toEqual([['task.day9.m2-r27-packet', 'doc.day8.m2-r27-request', 1]]);
  });

  it('未提供定義或未知 ID 一律不成立', () => {
    expect(evaluateCondition('cond.m2.unknown', ctx())).toBeFalse();
    expect(evaluateCondition('cond.m2.bart.not-asked', ctx({ namedCondition: undefined }))).toBeFalse();
  });
});
