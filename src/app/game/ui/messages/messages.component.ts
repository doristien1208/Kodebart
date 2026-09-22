import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { actorName } from '../../content/bundle';
import { CHANNEL_KINDS, ChannelKind } from '../../content/schema';
import { MESSAGES } from '../../content/text';
import { ChannelListComponent, ChannelSection } from './channel-list.component';
import { MessageUnreadService } from './message-unread.service';
import { MessageThreadComponent, ThreadMessage } from './message-thread.component';

interface ThreadView {
  title: string;
  messages: readonly ThreadMessage[];
}

/**
 * 訊息頁（KB-R4-04）：左側頻道／私訊列表，右側選中的對話。
 *
 * 這一層只負責取狀態、組呈現資料與決定何時標記已讀；列表與對話各自是子元件。
 * 已讀時機：玩家選取某個頻道、該頻道已解鎖的訊息因此進入可讀狀態時才寫入，
 * 只進本頁、看其他頻道或重新整理都不會清空未讀。
 * 窄螢幕（<700px）一次只顯示列表或對話，桌機兩欄並列。
 */
@Component({
  selector: 'app-messages',
  imports: [ChannelListComponent, MessageThreadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .layout { display: grid; gap: 1rem; align-items: start; }
    @media (min-width: 700px) {
      .layout { grid-template-columns: minmax(0, 15rem) minmax(0, 1fr); }
    }
    /* 窄螢幕：選了對話就只顯示對話，回列表再只顯示列表 */
    @media (max-width: 699px) {
      .compact-hidden { display: none; }
    }
  `,
  template: `
    <div class="layout">
      <app-channel-list
        [class.compact-hidden]="selectedId() !== null"
        [sections]="sections()"
        [selectedId]="selectedId()"
        (select)="open($event)"
      />
      @if (thread(); as view) {
        <app-message-thread
          [class.compact-hidden]="selectedId() === null"
          [title]="view.title"
          [messages]="view.messages"
          (back)="closeThread()"
        />
      } @else {
        <article class="panel mb-0 compact-hidden min-w-0">
          <h3>{{ t.selectHeading }}</h3>
          <p class="text-muted m-0">{{ t.selectPrompt }}</p>
        </article>
      }
    </div>

    <button type="button" class="mt-4" (click)="back()">{{ t.back }}</button>
  `,
})
export class MessagesComponent {
  private readonly unread = inject(MessageUnreadService);
  private readonly router = inject(Router);

  protected readonly t = MESSAGES;

  /** 目前開啟的頻道；預設不選，只進本頁不會把任何訊息標為已讀。 */
  protected readonly selectedId = signal<string | null>(null);

  /** 三種分類固定都列出；沒有頻道的分類顯示中性空狀態，不虛構頻道。 */
  protected readonly sections = computed<readonly ChannelSection[]>(() => {
    const channels = this.unread.unread();
    return CHANNEL_KINDS.map((kind: ChannelKind) => ({
      kind,
      title: MESSAGES.sectionTitle[kind],
      items: channels
        .filter((c) => c.kind === kind)
        .map((c) => ({
          id: c.id,
          title: c.title,
          unread: c.unreadIds.length,
          unreadLabel: MESSAGES.unreadChannel(c.title, c.unreadIds.length),
        })),
    }));
  });

  protected readonly thread = computed<ThreadView | null>(() => {
    const channel = this.unread.channel(this.selectedId());
    if (channel === null) return null;
    return {
      title: channel.title,
      messages: channel.unlocked.map((m) => ({
        id: m.id,
        author: actorName(m.actorId),
        time: m.time,
        lines: m.lines.map((text, i) => ({ id: `${m.id}#${i}`, text })),
      })),
    };
  });

  constructor() {
    /*
     * 已讀寫入點：選取的頻道有變、或該頻道的解鎖內容有變時才跑。
     * 依賴的是解鎖狀態（channels()）而不是已讀狀態，因此寫入後不會自我觸發；
     * 晚到的訊息若在頻道開著時解鎖，也會在這裡補記為已讀。
     */
    effect(() => {
      const id = this.selectedId();
      this.unread.channels();
      if (id === null) return;
      untracked(() => this.unread.markChannelRead(id));
    });
  }

  protected open(channelId: string): void {
    this.selectedId.set(channelId);
  }

  /** 窄螢幕從對話返回列表；不影響已讀狀態。 */
  protected closeThread(): void {
    this.selectedId.set(null);
  }

  protected back(): void {
    this.router.navigateByUrl('/work');
  }
}
