import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { NEWS } from '../../content/text';

/** 公司公告（對應原型 news()）。靜態文案，兩日相同。 */
@Component({
  selector: 'app-news',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="panel">
      <span class="eyebrow">{{ NEWS.eyebrow }}</span>
      <h3 class="text-[1.25rem]">{{ NEWS.title }}</h3>
      <p>{{ NEWS.body }}</p>
      <p class="text-muted">{{ NEWS.thanks }}</p>
      <hr />
      <h3>{{ NEWS.maintenanceTitle }}</h3>
      <p>{{ NEWS.maintenanceBody }}</p>
      <button type="button" (click)="back()">{{ NEWS.back }}</button>
    </article>
  `,
})
export class NewsComponent {
  private readonly router = inject(Router);

  protected readonly NEWS = NEWS;

  protected back(): void {
    this.router.navigateByUrl('/work');
  }
}
