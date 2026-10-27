import { newOperationKey } from '../../core/api/operation-key';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { Subscription } from 'rxjs';
import { Dialog } from 'primeng/dialog';
import { Message } from 'primeng/message';
import { MultiSelect } from 'primeng/multiselect';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Select } from 'primeng/select';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { DiscoverService } from '../../core/api/discover.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import {
  SceneRequestOptions,
  SubmitSceneRequestPayload,
  ResumeSceneRequestPayload,
} from '../../core/api/discover.types';

type StringSelectOption = {
  label: string;
  value: string;
  disabled?: boolean;
};

type NumberSelectOption = {
  label: string;
  value: number;
  disabled?: boolean;
};

@Component({
  selector: 'app-scene-request-modal',
  imports: [
    ReactiveFormsModule,
    Dialog,
    Message,
    ProgressSpinner,
    Select,
    ToggleSwitch,
    MultiSelect,
  ],
  templateUrl: './scene-request-modal.component.html',
  styleUrl: './scene-request-modal.component.scss',
})
export class SceneRequestModalComponent implements OnChanges, OnDestroy {
  private readonly discoverService = inject(DiscoverService);
  private readonly notifications = inject(AppNotificationsService);
  private loadedForSceneId: string | null = null;
  private loadedScope: string | null = null;
  private loadingSceneId: string | null = null;
  private optionsLoadSub: Subscription | null = null;

  @Input() open = false;
  @Input() sceneId: string | null = null;
  @Input() sceneTitle: string | null = null;
  @Input() sceneImageUrl: string | null = null;
  @Input() rerequest = false;
  @Input() settingsOnly = false;
  @Output() settingsSelected = new EventEmitter<SubmitSceneRequestPayload>();
  private submissionKey = '';
  private submissionBody = '';

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<string>();

  protected readonly requestOptionsLoading = signal(false);
  protected readonly requestOptionsError = signal<string | null>(null);
  protected readonly requestOptions = signal<SceneRequestOptions | null>(null);
  protected readonly requestSubmitLoading = signal(false);
  protected readonly requestSubmitError = signal<string | null>(null);

  protected readonly dialogBreakpoints = {
    '960px': '94vw',
    '640px': '98vw',
  };

  protected readonly rootFolderOptions = computed<StringSelectOption[]>(() => {
    const options = this.requestOptions();
    if (!options) {
      return [];
    }

    return options.rootFolders.map((folder) => ({
      label: folder.accessible ? folder.path : `${folder.path} (Unavailable)`,
      value: folder.path,
      disabled: !folder.accessible,
    }));
  });

  protected readonly qualityProfileOptions = computed<NumberSelectOption[]>(() => {
    const options = this.requestOptions();
    if (!options) {
      return [];
    }

    return options.qualityProfiles.map((profile) => ({
      label: profile.name,
      value: profile.id,
    }));
  });

  protected readonly tagOptions = computed<NumberSelectOption[]>(() => {
    const options = this.requestOptions();
    if (!options) {
      return [];
    }

    return options.tags.map((tag) => ({
      label: tag.label,
      value: tag.id,
    }));
  });

  protected readonly requestForm = new FormGroup({
    monitored: new FormControl(true, { nonNullable: true }),
    rootFolderPath: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    searchForMovie: new FormControl(true, { nonNullable: true }),
    qualityProfileId: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(1)],
    }),
    tags: new FormControl<number[]>([], { nonNullable: true }),
  });

  ngOnChanges(): void {
    if (!this.open) {
      this.loadedForSceneId = null;
      this.cancelOptionsLoad();
      this.requestOptionsLoading.set(false);
      this.requestSubmitLoading.set(false);
      return;
    }

    this.requestSubmitError.set(null);

    const nextSceneId = this.sceneId?.trim() ?? '';
    if (!nextSceneId) {
      this.requestOptionsError.set('Scene id is required to request this scene.');
      return;
    }

    if (
      this.loadedForSceneId === nextSceneId &&
      this.loadedScope === this.optionsScope() &&
      this.requestOptions()
    ) {
      return;
    }

    this.loadOptionsForScene(nextSceneId);
  }

  ngOnDestroy(): void {
    this.cancelOptionsLoad();
  }

  protected defaultSourceLabel(source: string | undefined): string {
    return (
      (
        {
          SAVED: 'Saved request preference',
          CONFIGURED: 'Configured default',
          ONLY_OPTION: 'Only available option',
          REQUIRED: 'Choose a value',
        } as Record<string, string>
      )[source ?? ''] ?? ''
    );
  }

  protected requiresCreationSettings(): boolean {
    return (
      !this.rerequest || this.settingsOnly || this.requestOptions()?.requiresSettings !== false
    );
  }

  protected closeModal(): void {
    if (this.requestSubmitLoading()) {
      return;
    }

    this.closed.emit();
  }

  protected onDialogVisibleChange(visible: boolean): void {
    if (visible || !this.open) {
      return;
    }

    this.closeModal();
  }

  protected submitRequest(): void {
    if (this.requestSubmitLoading()) {
      return;
    }

    const currentSceneId = this.sceneId?.trim() ?? '';
    if (!currentSceneId) {
      this.requestSubmitError.set('Scene id is required to submit a request.');
      return;
    }

    const needsSettings =
      !this.rerequest || this.settingsOnly || this.requestOptions()?.requiresSettings !== false;
    if (needsSettings && this.requestForm.invalid) {
      this.requestForm.markAllAsTouched();
      return;
    }

    const qualityProfileId = this.requestForm.controls.qualityProfileId.value;
    if (needsSettings && !qualityProfileId) {
      this.requestForm.controls.qualityProfileId.markAsTouched();
      return;
    }

    const settings: SubmitSceneRequestPayload = {
      monitored: this.requestForm.controls.monitored.value,
      rootFolderPath: this.requestForm.controls.rootFolderPath.value,
      searchForMovie: this.requestForm.controls.searchForMovie.value,
      qualityProfileId: qualityProfileId ?? 0,
      tags: this.requestForm.controls.tags.value,
    };
    if (this.settingsOnly) {
      this.settingsSelected.emit(settings);
      this.closed.emit();
      return;
    }
    const payload: ResumeSceneRequestPayload = needsSettings
      ? settings
      : { monitored: settings.monitored, searchForMovie: settings.searchForMovie, tags: [] };
    const body = JSON.stringify({ currentSceneId, settings: payload, rerequest: this.rerequest });
    if (body !== this.submissionBody) {
      this.submissionBody = body;
      this.submissionKey = newOperationKey();
    }
    this.requestSubmitLoading.set(true);
    this.requestSubmitError.set(null);

    this.discoverService
      .submitSceneRequest(
        currentSceneId,
        { ...payload, operationKey: this.submissionKey },
        this.rerequest,
      )
      .pipe(
        finalize(() => {
          this.requestSubmitLoading.set(false);
        }),
      )
      .subscribe({
        next: (response) => {
          this.submissionBody = '';
          const summary =
            response.message ??
            (response.alreadyExists
              ? 'Scene already present; no duplicate request sent'
              : 'Scene request submitted to Whisparr');
          if (
            ['NEEDS_IDENTIFICATION', 'UPSTREAM_BLOCKED', 'IMPORT_PENDING'].includes(
              response.outcome ?? '',
            )
          ) {
            this.notifications.info(
              summary,
              'Review the existing file or queue entry on Acquisition.',
            );
          } else this.notifications.success(summary, 'Track progress on Acquisition.');
          this.submitted.emit(currentSceneId);
          this.closed.emit();
        },
        error: (error) => {
          if (error.error?.actionState === 'FAILED' || (error.status && error.status !== 409))
            this.submissionBody = '';
          const messages = error.error?.message;
          const detail =
            typeof messages === 'string'
              ? messages
              : Array.isArray(messages)
                ? messages
                    .filter((message): message is string => typeof message === 'string')
                    .join(' ')
                : '';
          this.requestSubmitError.set(
            detail || 'The result could not be confirmed. Check request history before retrying.',
          );
        },
      });
  }

  private optionsScope(): 'single' | 'batch' | 'resume' {
    return this.settingsOnly ? 'batch' : this.rerequest ? 'resume' : 'single';
  }

  private loadOptionsForScene(sceneId: string): void {
    if (this.requestOptionsLoading() && this.loadingSceneId === sceneId) {
      return;
    }

    this.cancelOptionsLoad();
    this.loadingSceneId = sceneId;
    this.requestOptions.set(null);
    this.requestOptionsError.set(null);
    this.requestOptionsLoading.set(true);

    const subscription = this.discoverService
      .getSceneRequestOptions(sceneId, this.optionsScope())
      .pipe(
        finalize(() => {
          this.requestOptionsLoading.set(false);
          this.loadingSceneId = null;
          if (this.optionsLoadSub === subscription) {
            this.optionsLoadSub = null;
          }
        }),
      )
      .subscribe({
        next: (options) => {
          this.loadedForSceneId = sceneId;
          this.loadedScope = this.optionsScope();
          this.requestOptions.set(options);
          this.requestForm.patchValue({
            monitored: options.defaults.monitored,
            searchForMovie: options.defaults.searchForMovie,
            rootFolderPath: options.defaults.rootFolderPath ?? '',
            qualityProfileId: options.defaults.qualityProfileId ?? null,
            tags: options.defaults.tags ?? [],
          });
        },
        error: () => {
          this.requestOptionsError.set('Failed to load request options from the API.');
        },
      });

    this.optionsLoadSub = subscription;
  }

  private cancelOptionsLoad(): void {
    this.optionsLoadSub?.unsubscribe();
    this.optionsLoadSub = null;
    this.loadingSceneId = null;
  }
}
