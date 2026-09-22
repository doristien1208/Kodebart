import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SettingsService } from './game/platform/settings.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class AppComponent {
  /** 提早建立以套用 body.no-motion 等全域設定。 */
  protected readonly settings = inject(SettingsService);
}
