import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ALL_DOCUMENTS, taskHeading } from '../../../content/bundle';
import { ARCHIVE_UI, CASE_REVIEW_UI, MAIL_UI, RECORD_STATUS, WORKDAY_UI, attachmentVersionLabel, legendText } from '../../../content/text';
import { Save, TransformRowSnapshot } from '../../../core/types';
import { DAY_DIRECTORY } from '../../../state/day-directory';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { M1_SAVE_A, M1_SAVE_B, instantOperations, playM1To, playM1UntilKind } from '../../testing/play';
import { sourceRefusalStatus } from './record-status';
import {
  CONTENT_LABELS,
  DocumentRef,
  WorkDocumentView,
  batchAttachmentText,
  batchRowView,
  documentTitle,
  refusalLegend,
  refusalText,
  workDocumentView,
} from './work-document';

/**
 * 文件視窗 presenter（M1 §1）：來源原件、送件副本、附件關聯版本、批次 input／rule／output。
 * 一律讀保存的資料；找不到（內容移除、舊存檔、尚未保存）回傳 missing，不改開最新版本；畫面文字不含內部 ID。
 */

const ATTACH_D4 = 'task.day4.m1-attachment';
const TRANSFORM_D4 = 'task.day4.m1-transform';
const DOC_0314_WINDOW = 'doc.day4.m1-0314-window';
const DOC_0521_REPLY = 'doc.day4.m1-0521-reply';
const INTERNAL = /task\.|record\.|doc\.|batch\.|day\.0|mail\.|case\.|\bseed\b/;

function newGame(): GameStateService {
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  instantOperations(TestBed.inject(WorkOperationsService));
  spyOn(TestBed.inject(Router), 'navigateByUrl').and.returnValue(Promise.resolve(true));
  const game = TestBed.inject(GameStateService);
  game.newGame();
  return game;
}

function saveOf(game: GameStateService): Save {
  const s = game.save();
  if (!s) throw new Error('沒有存檔');
  return s;
}

function view(game: GameStateService, ref: DocumentRef): WorkDocumentView {
  return workDocumentView(ref, saveOf(game), DAY_DIRECTORY, CONTENT_LABELS);
}

function headingOf(documentId: string): string {
  const doc = ALL_DOCUMENTS.find((d) => d.id === documentId);
  if (doc?.kind !== 'case-source') throw new Error(`沒有文件 ${documentId}`);
  return doc.text.heading;
}

/** 畫面上會出現的文字（標題、欄位、表格、JSON、對照）。 */
function visible(v: WorkDocumentView): string {
  switch (v.kind) {
    case 'source':
    case 'copy':
      return [v.heading, ...v.fields.flatMap((f) => [f.label, f.value])].join('\n');
    case 'link':
      return [
        v.heading,
        v.versionLabel,
        v.stateText,
        ...v.fields.flatMap((f) => [f.label, f.value]),
        v.document?.heading ?? '',
        ...(v.document?.fields ?? []).flatMap((f) => [f.label, f.value]),
      ].join('\n');
    case 'batch':
      return [
        v.heading,
        ...v.rows.flatMap((r) => [r.code, r.sourceCode, r.source, r.adopted, r.output, r.origin, r.attachment, r.status]),
        v.json.input,
        v.json.rule,
        v.json.output,
        ...v.legend,
        ...v.counts.flatMap((c) => [c.label, c.value]),
      ].join('\n');
    case 'missing':
      return v.heading;
  }
}

describe('work-document presenter（M1 文件視窗）', () => {
  afterEach(() => localStorage.clear());

  it('來源原件：內容文件的標題與欄位；找不到文件為 missing', () => {
    const game = newGame();
    const v = view(game, { kind: 'case-source', documentId: DOC_0314_WINDOW });
    expect(v.kind).toBe('source');
    expect(v.kind === 'source' ? v.heading : '').toBe(headingOf(DOC_0314_WINDOW));
    expect(v.kind === 'source' ? v.fields.length : 0).toBeGreaterThan(0);
    expect(visible(v)).not.toMatch(INTERNAL);
    expect(view(game, { kind: 'case-source', documentId: 'doc.removed' })).toEqual({ kind: 'missing', heading: MAIL_UI.missingAttachment });
  });

  it('送件副本：玩家採用的編號與來源分開列出；案件附上依據、去向與備註；沒有保存為 missing', () => {
    const game = newGame();
    playM1To(game, 'day.04', M1_SAVE_A);
    const copy = view(game, { kind: 'archive-copy', batchId: 'batch.day03.archive', recordKey: 'B314' });
    expect(copy.kind).toBe('copy');
    if (copy.kind !== 'copy') return;
    expect(copy.heading.startsWith(`${WORKDAY_UI.snapshotLabel}｜`)).toBeTrue();
    expect(copy.fields.slice(0, 2)).toEqual([
      { label: WORKDAY_UI.adopted, value: '0341' },
      { label: WORKDAY_UI.source, value: '0314' },
    ]);
    expect(visible(copy)).not.toMatch(INTERNAL);

    const kase = view(game, { kind: 'archive-copy', batchId: 'batch.day03.archive', recordKey: 'H204' });
    expect(kase.kind === 'copy' ? kase.fields.map((f) => f.label) : []).toEqual(
      jasmine.arrayContaining([CASE_REVIEW_UI.basisLabel, CASE_REVIEW_UI.destinationLabel, CASE_REVIEW_UI.noteLabel]),
    );
    expect(view(game, { kind: 'archive-copy', batchId: 'batch.day03.archive', recordKey: 'B999' }).kind).toBe('missing');
    expect(view(game, { kind: 'archive-copy', batchId: 'batch.removed', recordKey: 'B314' }).kind).toBe('missing');
  });

  it('附件關聯版本：退回的最新版本可修訂；修訂後舊版本為歷史、唯讀，新版本等待核對；不存在的版本為 missing', () => {
    const game = newGame();
    playM1To(game, 'day.05', M1_SAVE_A);
    const ref0: DocumentRef = { kind: 'attachment-link', taskId: ATTACH_D4, versionIndex: 0 };
    const v0 = view(game, ref0);
    expect(v0).toEqual(
      jasmine.objectContaining({ kind: 'link', heading: taskHeading(ATTACH_D4), versionLabel: attachmentVersionLabel(0), stateText: MAIL_UI.current, editable: true }),
    );
    if (v0.kind !== 'link') return;
    expect(v0.document?.heading).toBe(headingOf(DOC_0521_REPLY));
    expect(v0.fields).toContain({ label: WORKDAY_UI.adopted, value: '0341' });
    expect(v0.fields).toContain({ label: WORKDAY_UI.referencedEvidence, value: WORKDAY_UI.evidence.reply });
    expect(visible(v0)).not.toMatch(INTERNAL);
    expect(documentTitle(ref0, saveOf(game), DAY_DIRECTORY)).toBe(`${taskHeading(ATTACH_D4)}｜${attachmentVersionLabel(0)}`);

    expect(game.reviseAttachmentStrict(ATTACH_D4, 0, { choiceId: 'reference', documentId: DOC_0314_WINDOW })).toBe('ok');
    expect(view(game, ref0)).toEqual(jasmine.objectContaining({ stateText: MAIL_UI.historical, editable: false }));
    const v1 = view(game, { kind: 'attachment-link', taskId: ATTACH_D4, versionIndex: 1 });
    expect(v1).toEqual(jasmine.objectContaining({ versionLabel: attachmentVersionLabel(1), stateText: MAIL_UI.awaiting, editable: false }));
    expect(v1.kind === 'link' ? v1.document?.heading : '').toBe(headingOf(DOC_0314_WINDOW));

    expect(view(game, { kind: 'attachment-link', taskId: ATTACH_D4, versionIndex: 7 }).kind).toBe('missing');
    expect(view(game, { kind: 'attachment-link', taskId: 'task.removed', versionIndex: 0 }).kind).toBe('missing');
  });

  it('批次副本：逐列差異（採用編號與來源不同時標示）、input／rule／output JSON 與 true／false／null 的領域意義對照', () => {
    const game = newGame();
    playM1To(game, 'day.05', M1_SAVE_A);
    const ref: DocumentRef = { kind: 'batch-output', taskId: TRANSFORM_D4 };
    const v = view(game, ref);
    expect(v.kind).toBe('batch');
    if (v.kind !== 'batch') return;
    expect(v.preview).toBeFalse();
    const row = v.rows.find((r) => r.code === '0341');
    expect(row).toEqual(
      jasmine.objectContaining({ codeDiffers: true, sourceCode: '0314', output: RECORD_STATUS.notRefused, origin: WORKDAY_UI.valueOrigin.reply, pending: false }),
    );
    expect(row?.attachment).toBe(`${headingOf(DOC_0521_REPLY)}（${WORKDAY_UI.evidence.mismatch}）`);

    const input = JSON.parse(v.json.input) as { personnelCode: string; sourceCode: string }[];
    const rule = JSON.parse(v.json.rule) as { missingReply: string };
    const output = JSON.parse(v.json.output) as { personnelCode: string; refusal: boolean | null; status: string }[];
    expect(input.map((r) => r.personnelCode)).toContain('0341');
    expect(rule.missingReply).toBe(CONTENT_LABELS.policy(TRANSFORM_D4)?.departmentDefault ?? '');
    expect(rule.missingReply).not.toBe('');
    expect(output.find((r) => r.personnelCode === '0341')).toEqual({ row: '0314', personnelCode: '0341', refusal: false, status: WORKDAY_UI.rowStatus.delivered } as never);
    expect(v.legend).toEqual(refusalLegend());
    expect(v.legend).toEqual([
      legendText('true', RECORD_STATUS.refused),
      legendText('false', RECORD_STATUS.notRefused),
      legendText('null', RECORD_STATUS.unconfirmed),
    ]);
    expect(v.counts.map((c) => c.label)).toEqual([WORKDAY_UI.submissionCount, WORKDAY_UI.replyCount, WORKDAY_UI.pendingCount]);
    expect(visible(v)).not.toMatch(INTERNAL);
    expect(documentTitle(ref, saveOf(game), DAY_DIRECTORY)).toBe(`${taskHeading(TRANSFORM_D4)}｜${WORKDAY_UI.batchCopyLabel}`);
  });

  it('批次預覽：依目前設定即時建立；有缺漏未選策略時為 missing；交付後同一引用回到交付快照', () => {
    const game = newGame();
    playM1To(game, 'day.04', M1_SAVE_B);
    playM1UntilKind(game, 'transform', M1_SAVE_B);
    const ref: DocumentRef = { kind: 'batch-preview', taskId: TRANSFORM_D4 };
    expect(game.transformMissing(TRANSFORM_D4)).toBeGreaterThan(0);
    expect(view(game, ref).kind).toBe('missing');

    game.setTransformPolicy('review');
    const held = view(game, ref);
    expect(held).toEqual(jasmine.objectContaining({ kind: 'batch', preview: true }));
    expect(held.kind === 'batch' ? held.rows.filter((r) => r.pending).length : 0).toBeGreaterThan(0);
    expect(documentTitle(ref, saveOf(game), DAY_DIRECTORY)).toBe(`${taskHeading(TRANSFORM_D4)}｜${WORKDAY_UI.output}`);

    game.setTransformPolicy('departmentDefault');
    const filled = view(game, ref);
    expect(filled.kind === 'batch' ? filled.rows.filter((r) => r.pending).length : -1).toBe(0);
    expect(filled.kind === 'batch' ? filled.rows.some((r) => r.origin === WORKDAY_UI.valueOrigin.policy) : false).toBeTrue();

    expect(game.previewTransform()).toBeTrue();
    expect(game.submitTransformStrict()).toBe('ok');
    expect(view(game, ref)).toEqual(jasmine.objectContaining({ kind: 'batch', preview: false }));
  });

  it('其他引用：退件回條不由這裡呈現、非批次工作的批次引用、未交付的批次副本都是 missing', () => {
    const game = newGame();
    playM1To(game, 'day.04', M1_SAVE_B);
    expect(view(game, { kind: 'return-receipt', caseId: 'return.x', receiptId: 'return.x#0', versionIndex: 0 }).kind).toBe('missing');
    expect(view(game, { kind: 'batch-output', taskId: ATTACH_D4 }).kind).toBe('missing');
    expect(view(game, { kind: 'batch-output', taskId: TRANSFORM_D4 }).kind).toBe('missing');
  });

  it('拒絕紀錄的顯示文字：已拒絕／未拒絕／未確認', () => {
    expect([refusalText(true), refusalText(false), refusalText(null)]).toEqual([
      RECORD_STATUS.refused,
      RECORD_STATUS.notRefused,
      RECORD_STATUS.unconfirmed,
    ]);
  });
});

describe('批次列 presenter（R1 附件當日不揭露／R2 來源・採用・輸出分開／R4 changed）', () => {
  afterEach(() => localStorage.clear());

  const REVIEW_ADOPTED = `${RECORD_STATUS.unconfirmed}（${ARCHIVE_UI.methodReview}）`;
  const claimed0521 = (): string => `${headingOf(DOC_0521_REPLY)}（${WORKDAY_UI.evidence.reply}）`;
  const returned0521 = (): string => `${headingOf(DOC_0521_REPLY)}（${WORKDAY_UI.evidence.mismatch}）`;

  function toTransform(c: typeof M1_SAVE_A): GameStateService {
    const game = newGame();
    playM1To(game, 'day.04', c);
    playM1UntilKind(game, 'transform', c);
    return game;
  }

  function batch(game: GameStateService, ref: DocumentRef): Extract<WorkDocumentView, { kind: 'batch' }> {
    const v = view(game, ref);
    if (v.kind !== 'batch') throw new Error(`不是批次：${v.kind}`);
    return v;
  }

  function row0341(v: Extract<WorkDocumentView, { kind: 'batch' }>): string | undefined {
    return v.rows.find((r) => r.code === '0341')?.attachment;
  }

  it('R1 當日未核對：預覽與當日交付的批次副本只列附件名稱與證明範圍，沒有對象不符；錯附件照常送件、傳到下游', () => {
    const game = toTransform(M1_SAVE_A);
    game.setTransformPolicy('departmentDefault');
    expect(game.previewTransform()).toBeTrue();
    const preview = batch(game, { kind: 'batch-preview', taskId: TRANSFORM_D4 });
    expect(row0341(preview)).toBe(claimed0521());
    expect(visible(preview)).not.toContain(WORKDAY_UI.evidence.mismatch);

    expect(game.submitTransformStrict()).toBe('ok');
    const copy = batch(game, { kind: 'batch-output', taskId: TRANSFORM_D4 });
    expect(row0341(copy)).toBe(claimed0521());
    expect(visible(copy)).not.toContain(WORKDAY_UI.evidence.mismatch);
    expect(copy.rows.find((r) => r.code === '0341')?.origin).toBe(WORKDAY_UI.valueOrigin.reply);
  });

  it('R1 隔日正式核對才顯示退回；修訂不覆寫舊批次副本，新版本核對相符也不拿來重判舊批次', () => {
    const game = newGame();
    playM1To(game, 'day.05', M1_SAVE_A);
    const ref: DocumentRef = { kind: 'batch-output', taskId: TRANSFORM_D4 };
    expect(game.attachmentProgress(ATTACH_D4).checks).toEqual([jasmine.objectContaining({ versionIndex: 0, outcome: 'returned' })]);
    expect(row0341(batch(game, ref))).toBe(returned0521());

    expect(game.reviseAttachmentStrict(ATTACH_D4, 0, { choiceId: 'reference', documentId: DOC_0314_WINDOW })).toBe('ok');
    expect(row0341(batch(game, ref))).toBe(returned0521());

    playM1To(game, 'day.06', M1_SAVE_A);
    expect(game.attachmentProgress(ATTACH_D4).checks).toContain(jasmine.objectContaining({ versionIndex: 1, outcome: 'resolved' }));
    expect(row0341(batch(game, ref))).toBe(returned0521());
    expect(game.transformProgress(TRANSFORM_D4).submitted?.rows.find((r) => r.adoptedCode === '0341')?.attachment?.versionIndex).toBe(0);
  });

  it('R1 版本分離：引用已退回版本的列顯示核對結果；引用尚未核對的新版本、或內容附件的列只列附件本身', () => {
    const game = newGame();
    playM1To(game, 'day.05', M1_SAVE_A);
    expect(game.reviseAttachmentStrict(ATTACH_D4, 0, { choiceId: 'reference', documentId: DOC_0521_REPLY })).toBe('ok');
    const save = saveOf(game);
    const old = game.transformProgress(TRANSFORM_D4).submitted?.rows.find((r) => r.adoptedCode === '0341');
    if (!old?.attachment) throw new Error('沒有 0341 的附件列');
    expect(batchAttachmentText(old, save)).toBe(returned0521());
    expect(batchAttachmentText({ ...old, attachment: { ...old.attachment, versionIndex: 1 } }, save)).toBe(claimed0521());
    expect(batchAttachmentText({ ...old, attachment: { ...old.attachment, taskId: null, versionIndex: null } }, save)).toBe(claimed0521());
    expect(batchAttachmentText({ ...old, attachment: null, heldForReview: true }, save)).toBe(WORKDAY_UI.preserveMissing);
    expect(batchAttachmentText({ ...old, attachment: null }, save)).toBe(WORKDAY_UI.evidence.none);
  });

  for (const [name, c, origin, adopted] of [
    ['Save A（部門預設歸檔）', M1_SAVE_A, 'defaulted', RECORD_STATUS.defaultedNotRefused],
    ['Save B（保留缺漏送覆核）', M1_SAVE_B, 'review', REVIEW_ADOPTED],
  ] as const) {
    it(`R2 ${name}：來源缺漏＝未提供、採用欄依保存決定、輸出欄依本次策略；與來源卡、送件副本同一套字`, () => {
      const game = toTransform(c);
      for (const policy of ['departmentDefault', 'review'] as const) {
        game.setTransformPolicy(policy);
        const out = game.transformDisplay(TRANSFORM_D4);
        const v = batch(game, { kind: 'batch-preview', taskId: TRANSFORM_D4 });
        const missing = (out?.rows ?? []).filter((r) => r.sourceRefusal === null && r.adoptedOrigin !== null && r.adoptedOrigin !== 'source' && r.valueOrigin !== 'reply');
        if (c === M1_SAVE_B) expect(missing.length).toBeGreaterThan(0);
        for (const r of missing) {
          const shown = v.rows.find((x) => x.id === r.id);
          expect(r.adoptedOrigin).toBe(origin);
          expect(shown?.source).toBe(RECORD_STATUS.missing);
          expect(shown?.adopted).toBe(adopted);
          expect(shown?.output).toBe(policy === 'departmentDefault' ? RECORD_STATUS.notRefused : RECORD_STATUS.unconfirmed);
          const record = DAY_DIRECTORY.records(r.batchId).find((x) => x.key === r.recordKey);
          expect(record ? sourceRefusalStatus(record) : '').toBe(RECORD_STATUS.missing);
          const copy = view(game, { kind: 'archive-copy', batchId: r.batchId, recordKey: r.recordKey });
          expect(copy.kind === 'copy' ? copy.fields.find((f) => f.label === WORKDAY_UI.columns.value)?.value : '').toBe(adopted);
        }
        expect(v.rows.map((x) => x.source)).not.toContain(RECORD_STATUS.unconfirmed);
      }
    });
  }

  it('R2 來源拒絕紀錄：true／false 為已拒絕／未拒絕、null 為未提供、不適用保留不適用', () => {
    const game = toTransform(M1_SAVE_B);
    game.setTransformPolicy('review');
    const save = saveOf(game);
    const base = game.transformDisplay(TRANSFORM_D4)?.rows[0];
    if (!base) throw new Error('沒有批次列');
    const source = (o: Partial<TransformRowSnapshot>): string => batchRowView({ ...base, ...o }, save, DAY_DIRECTORY).source;
    expect(source({ sourceRefusal: true })).toBe(RECORD_STATUS.refused);
    expect(source({ sourceRefusal: false })).toBe(RECORD_STATUS.notRefused);
    expect(source({ sourceRefusal: null })).toBe(RECORD_STATUS.missing);
    const b = save.batches[base.batchId];
    if (!b) throw new Error('沒有批次');
    const entry = { archiveCode: '1', refusal: null, origin: 'source' as const, source: { name: null, code: '1', refusal: null, refusalApplies: false } };
    const notApplicable: Save = { ...save, batches: { ...save.batches, [base.batchId]: { ...b, archived: { ...b.archived, [base.recordKey]: entry } } } };
    expect(batchRowView({ ...base, sourceRefusal: null }, notApplicable, DAY_DIRECTORY).source).toBe(RECORD_STATUS.notApplicable);
  });

  it('R4 changed 比較輸出值與保存的採用值（不比來源）；表格與 JSON 同一個基準', () => {
    const game = toTransform(M1_SAVE_B);
    game.setTransformPolicy('review');
    const save = saveOf(game);
    const base = game.transformDisplay(TRANSFORM_D4)?.rows[0];
    if (!base) throw new Error('沒有批次列');
    const cases: [string, Partial<TransformRowSnapshot>, boolean][] = [
      ['來源 null／採用 false／輸出 false', { sourceRefusal: null, adoptedRefusal: false, adoptedOrigin: 'defaulted', value: false, valueOrigin: 'policy', status: 'delivered' }, false],
      ['來源 null／採用 false／輸出 null', { sourceRefusal: null, adoptedRefusal: false, adoptedOrigin: 'defaulted', value: null, valueOrigin: 'held', status: 'pending' }, true],
      ['來源 null／採用 null（送覆核）／輸出 null', { sourceRefusal: null, adoptedRefusal: null, adoptedOrigin: 'review', value: null, valueOrigin: 'held', status: 'pending' }, false],
      ['來源 null／採用 null（送覆核）／輸出 false', { sourceRefusal: null, adoptedRefusal: null, adoptedOrigin: 'review', value: false, valueOrigin: 'policy', status: 'delivered' }, true],
      ['採用 true／輸出 true', { sourceRefusal: true, adoptedRefusal: true, adoptedOrigin: 'source', value: true, valueOrigin: 'source', status: 'delivered' }, false],
      ['採用 true／輸出 false', { sourceRefusal: true, adoptedRefusal: true, adoptedOrigin: 'source', value: false, valueOrigin: 'reply', status: 'delivered' }, true],
      ['採用 false／輸出 true', { sourceRefusal: false, adoptedRefusal: false, adoptedOrigin: 'source', value: true, valueOrigin: 'reply', status: 'delivered' }, true],
      ['採用 false／輸出 false', { sourceRefusal: false, adoptedRefusal: false, adoptedOrigin: 'source', value: false, valueOrigin: 'source', status: 'delivered' }, false],
      ['無採用資料', { adoptedCode: null, adoptedRefusal: null, adoptedOrigin: null, value: null, valueOrigin: 'held', status: 'pending' }, false],
    ];
    for (const [label, o, changed] of cases) {
      const v = batchRowView({ ...base, ...o }, save, DAY_DIRECTORY);
      expect(v.changed).withContext(label).toBe(changed);
      expect(v.adopted === '').withContext(label).toBe(o.adoptedOrigin === null);
    }

    for (const policy of ['departmentDefault', 'review'] as const) {
      game.setTransformPolicy(policy);
      const v = batch(game, { kind: 'batch-preview', taskId: TRANSFORM_D4 });
      const input = JSON.parse(v.json.input) as { sourceRefusal: boolean | null; adoptedRefusal: boolean | null }[];
      const output = JSON.parse(v.json.output) as { refusal: boolean | null }[];
      expect(v.rows.map((r) => r.changed)).toEqual(input.map((r, i) => r.adoptedRefusal !== output[i]?.refusal));
      expect(input.every((r) => 'sourceRefusal' in r && 'adoptedRefusal' in r)).toBeTrue();
    }
  });
});
