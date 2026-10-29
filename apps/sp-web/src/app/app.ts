import { Component } from '@angular/core';
import { FullscreenToggleComponent } from './shared/fullscreen-toggle/fullscreen-toggle.component';
import { RouterOutlet } from '@angular/router';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Toast } from 'primeng/toast';
import { ImageObscurationToggleComponent } from './shared/image-obscuration-toggle/image-obscuration-toggle.component';
import { ThemeToggleComponent } from './shared/theme-toggle/theme-toggle.component';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    ThemeToggleComponent,
    FullscreenToggleComponent,
    ImageObscurationToggleComponent,
    Toast,
    ConfirmDialog,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
