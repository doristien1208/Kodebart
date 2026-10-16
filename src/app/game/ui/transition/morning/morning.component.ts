import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { MORNING_UI, WORKBENCH, WORKDAY_UI, arriveLines, morningDocTitle, morningPending, pageTitle, taskKindLabel } from '../../../content/text';
import { mailView } from '../../mail/presenters/mail-view';
import { SettingsService } from '../../../platform/settings.service';
import { GameStateService } from '../../../state/game-state.service';
import { routeForStage } from '../../../state/stage-route';

/** 次日收件清單的一列（畫面用）。 */
interface MorningRow {
  taskId: string;
  index: number;
  kind: string;
  heading: string;
  pending: string;
}

/**
 * 次日收件（Stage `morning`，路徑 /morning；R8 §2）。
 *
 * 是否在「早晨」完全由存檔的 stage 決定（stage guard 導正重載、返回與深連結），
 * 元件本地不保存任何流程狀態。顯示新工作日的一般問候（DayContent.workbench.greeting）、
 * 當日有序工作清單（種類、名稱、待處理數），按「開始今日工作」才進 /work。
 * 沒有假的等待：按鈕立即可用；動態開啟時只有短淡入與一次掃描線（CSS），
 * 遊戲設定關閉動態或系統 prefers-reduced-motion 時直接顯示。
 */
@Component({
  selector: 'app-morning',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './morning.component.css',
  templateUrl: './morning.component.html',
  host: { '[class.kb-motion]': 'animate()' },
})
export class MorningComponent {
  private readonly game = inject(GameStateService);
  protected readonly router = inject(Router);
  private readonly title = inject(Title);

  protected readonly ui = MORNING_UI;
  protected readonly animate = inject(SettingsService).animationsEnabled;

  protected readonly greeting = computed(() => this.game.dayContent()?.workbench.greeting ?? '');
  protected readonly workday = WORKDAY_UI;

  /** M1：到班短文（前一日的 interlude.arrive）。 */
  protected readonly arrive = computed<readonly string[]>(() => {
    const id = this.game.dayId();
    return id ? arriveLines(id) : [];
  });

  /**
   * M1：今天已抵達的回條（寄件者＋主旨）；不用讀完聊天才能開工。
   * 只列已送達的郵件（一般回條若是「第一次交付後」才到，早晨還不會出現）。
   */
  protected readonly arrived = computed(() => {
    const day = this.game.dayId();
    const save = this.game.save();
    return this.game
      .mailbox()
      .filter((m) => m.dayId === day)
      .map((m) => mailView(m, this.game.returns(), this.game.isMailRead(m.id), save))
      .filter((v) => !v.failed)
      .map((v) => ({ id: v.id, sender: v.sender, subject: v.subject }));
  });
  protected readonly dayTag = computed(() => WORKBENCH.dayTag(this.game.dayNumber()));

  protected readonly rows = computed<readonly MorningRow[]>(() =>
    this.game.dayTasks().map((t) => ({
      taskId: t.taskId,
      index: t.index,
      kind: taskKindLabel(t.kind),
      heading: t.heading,
      pending: morningPending(t.kind, t.total),
    })),
  );

  constructor() {
    this.title.setTitle(pageTitle(morningDocTitle(this.game.dayNumber())));
  }

  /** 開始今日工作：morning → work，依新 stage 導向。 */
  protected onStart(): void {
    this.game.startDay();
    const stage = this.game.stage();
    void this.router.navigateByUrl(stage ? routeForStage(stage) : '/');
  }
}
