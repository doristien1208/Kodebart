import { chatDateLabel, dayOrder, helpMessages, helpRequestOf, helpRequestOfMessage, promptOf } from '../../../content/bundle';
import { ContentReplyPrompt } from '../../../content/schema';
import { ChatReply } from '../../../core/types';
import { CURRENT_TEXT_PROMPT_IDS, displayReply } from './reply-display';
import { TimelineMessage, buildTimeline } from './timeline';

/**
 * R12 #7：舊存檔的拒絕紀錄說明回覆在顯示層改用目前核准的內容文字（純函式）。
 * 舊快照的字句取自 #7 之前的 help JSON（doc/content/R12-refusal-help.json 初版）。
 */

const PROMPT = 'prompt.help.refusal';
const REQUEST = 'request.refusal-record';

function currentPrompt(): ContentReplyPrompt {
  const prompt = promptOf(PROMPT)?.prompt;
  if (!prompt) throw new Error(`內容缺少 ${PROMPT}`);
  return prompt;
}

function currentChoice(choiceId: string) {
  const choice = currentPrompt().choices.find((c) => c.id === choiceId);
  if (!choice) throw new Error(`內容缺少選項 ${choiceId}`);
  return choice;
}

/** 遞迴凍結（模擬不可變的存檔快照）。 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

type Answered = Extract<ChatReply, { kind: 'answered' }>;

const ASKED_AT = Date.UTC(2026, 8, 24, 6, 5);

/** #7 之前回答「ask-blank」保存的快照。 */
function oldAskBlank(deliverAt = ASKED_AT + 9000): Answered {
  return deepFreeze({
    kind: 'answered',
    choiceId: 'ask-blank',
    playerText: '可是沒寫拒絕，也不代表已經問過吧？',
    answeredAt: ASKED_AT + 7000,
    dayId: 'day.02',
    responses: [
      {
        id: 'msg.help.refusal.blank-response',
        actorId: 'actor.lin-yuan',
        time: '09:02',
        lines: ['對，單看空白看不出來。', '「未拒絕」是這邊歸檔時用的預設值，不是另外問到的答案。你想等資料補齊再處理，就選「未確認」。'],
        deliverAt,
      },
    ],
  });
}

/** #7 之前回答「ack」保存的快照。 */
function oldAck(): Answered {
  return deepFreeze({
    kind: 'answered',
    choiceId: 'ack',
    playerText: '懂了，我再看一下原表。',
    answeredAt: ASKED_AT + 7000,
    dayId: 'day.02',
    responses: [
      { id: 'msg.help.refusal.ack-response', actorId: 'actor.lin-yuan', time: '09:02', lines: ['嗯，有卡住再問我。'], deliverAt: ASKED_AT + 10000 },
    ],
  });
}

describe('displayReply（拒絕紀錄說明回覆的顯示文字，R12 #7）', () => {
  it('只處理 prompt.help.refusal', () => {
    expect([...CURRENT_TEXT_PROMPT_IDS]).toEqual([PROMPT]);
  });

  it('舊 ask-blank 快照：玩家列與回應改用目前文字，其餘欄位取自快照，輸入不變', () => {
    const saved = oldAskBlank();
    const before = JSON.stringify(saved);
    const shown = displayReply(PROMPT, saved, () => currentPrompt()) as Answered;
    const choice = currentChoice('ask-blank');

    expect(shown.playerText).toBe(choice.text);
    expect(shown.responses[0]?.lines).toEqual(choice.responses[0]?.lines ?? []);
    expect(shown.playerText).not.toContain('已經問過');
    expect(shown.responses[0]?.lines.join('')).not.toContain('未確認');
    // ID、作者、時間、送達時間、回答時間與遊戲日不變
    expect({ ...shown, playerText: '', responses: [] }).toEqual({ ...saved, playerText: '', responses: [] });
    expect(shown.responses.map(({ lines: _lines, ...rest }) => rest)).toEqual(saved.responses.map(({ lines: _lines, ...rest }) => rest));
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('舊 ack 快照：不再顯示「我再看一下原表」，回應 ID 與送達時間不變', () => {
    const saved = oldAck();
    const shown = displayReply(PROMPT, saved, () => currentPrompt()) as Answered;
    const choice = currentChoice('ack');
    expect(shown.playerText).toBe(choice.text);
    expect(shown.playerText).not.toContain('原表');
    expect(shown.responses.map((r) => [r.id, r.deliverAt, r.time, r.actorId])).toEqual(
      saved.responses.map((r) => [r.id, r.deliverAt, r.time, r.actorId]),
    );
    expect(shown.responses[0]?.lines).toEqual(choice.responses[0]?.lines ?? []);
  });

  it('找不到選項（內容已移除）：整份沿用快照，回傳同一個物件', () => {
    const saved = deepFreeze({ ...oldAskBlank(), choiceId: 'removed-choice' });
    expect(displayReply(PROMPT, saved, () => currentPrompt())).toBe(saved);
  });

  it('找不到個別回應：該列沿用快照、不消失也不換成別列；其他回應照常換成目前文字', () => {
    const base = oldAskBlank();
    const unknown = { id: 'msg.help.refusal.retired-response', actorId: 'actor.lin-yuan', time: '09:03', lines: ['舊的補充說明。'] };
    const saved = deepFreeze({ ...base, responses: [base.responses[0], unknown] }) as Answered;
    const shown = displayReply(PROMPT, saved, () => currentPrompt()) as Answered;
    expect(shown.responses.map((r) => r.id)).toEqual(['msg.help.refusal.blank-response', 'msg.help.refusal.retired-response']);
    expect(shown.responses[0]?.lines).toEqual(currentChoice('ask-blank').responses[0]?.lines ?? []);
    expect(shown.responses[1]).toBe(saved.responses[1]);
  });

  it('skipped、未回答與一般 prompt：原樣回傳，也不查詢目前內容', () => {
    const lookup = jasmine.createSpy('currentPrompt').and.callFake(() => currentPrompt());
    const skipped: ChatReply = deepFreeze({ kind: 'skipped' });
    expect(displayReply(PROMPT, skipped, lookup)).toBe(skipped);
    expect(displayReply(PROMPT, undefined, lookup)).toBeUndefined();
    const other = deepFreeze({ ...oldAck(), playerText: '一般 prompt 的歷史快照' });
    expect(displayReply('prompt.day2.check-in', other, lookup)).toBe(other);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('目前內容缺少這個 prompt：沿用快照', () => {
    const saved = oldAck();
    expect(displayReply(PROMPT, saved, () => undefined)).toBe(saved);
  });
});

describe('displayReply 接上 buildTimeline（R12 #7）', () => {
  const askedAt = ASKED_AT;
  const deliveries = helpMessages(REQUEST).map((m, i) => ({ messageId: m.id, at: askedAt + 3000 * (i + 1) }));
  const request = {
    id: REQUEST,
    dayId: 'day.02',
    askedAt,
    playerText: helpRequestOf(REQUEST)?.playerText ?? '',
    deliveries,
  };
  const clock = (ms: number) => `t${ms - askedAt}`;

  function timelineFor(saved: ChatReply, now: number) {
    return buildTimeline({
      messages: helpMessages(REQUEST),
      replyOf: (id) => displayReply(id, id === PROMPT ? saved : undefined, (pid) => promptOf(pid)?.prompt),
      actorName: () => '林予安',
      dateLabel: chatDateLabel,
      you: '林小安',
      now,
      requestOfMessage: helpRequestOfMessage,
      requestOf: (id) => (id === REQUEST ? request : undefined),
      dayOrder,
      clockTime: clock,
    });
  }

  it('已送達：列 ID、順序、時間與作者照快照，只有文字是目前內容', () => {
    const saved = oldAskBlank(askedAt + 9000);
    const entries = timelineFor(saved, askedAt + 60_000);
    const messages = entries.filter((e): e is TimelineMessage => e.kind === 'message');
    expect(messages.map((m) => m.id)).toEqual([
      `${REQUEST}:you`,
      'msg.help.refusal.meaning',
      'msg.help.refusal.paths',
      `${PROMPT}:you`,
      'msg.help.refusal.blank-response',
    ]);
    const you = messages.find((m) => m.id === `${PROMPT}:you`);
    const response = messages.find((m) => m.id === 'msg.help.refusal.blank-response');
    expect(you?.lines.map((l) => l.text)).toEqual([currentChoice('ask-blank').text]);
    expect(you?.time).toBe(clock(saved.answeredAt ?? 0));
    expect(you?.author).toBe('林小安');
    expect(response?.lines.map((l) => l.text)).toEqual(currentChoice('ask-blank').responses[0]?.lines ?? []);
    expect(response?.time).toBe(clock(askedAt + 9000));
    expect(response?.lines.map((l) => l.id)).toEqual(response?.lines.map((_, j) => `msg.help.refusal.blank-response#${j}`) ?? []);
  });

  it('尚未送達：仍顯示「正在輸入」，回應不提早出現；到了保存的送達時間才以目前文字出現', () => {
    const saved = oldAskBlank(askedAt + 9000);
    const waiting = timelineFor(saved, askedAt + 8000);
    expect(waiting.at(-1)).toEqual(jasmine.objectContaining({ kind: 'typing', id: `${PROMPT}:typing`, sourceId: PROMPT }));
    expect(waiting.some((e) => e.id === 'msg.help.refusal.blank-response')).toBeFalse();
    const delivered = timelineFor(saved, askedAt + 9000);
    expect(delivered.at(-1)?.id).toBe('msg.help.refusal.blank-response');
  });
});
