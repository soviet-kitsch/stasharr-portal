import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import {
  IntegrationResponse,
  IntegrationType,
  UpdateIntegrationPayload,
  isCatalogProviderType,
} from '../../core/api/integrations.types';

export interface IntegrationActionState {
  running: boolean;
  success: string | null;
  error: string | null;
}

export type IntegrationForm = FormGroup<{
  name: FormControl<string>;
  baseUrl: FormControl<string>;
  browserUrl: FormControl<string>;
  defaultRootFolderPath: FormControl<string>;
  defaultQualityProfileId: FormControl<string>;
  apiKey: FormControl<string>;
  enabled: FormControl<boolean>;
}>;

export function createIntegrationForm(): IntegrationForm {
  return new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    baseUrl: new FormControl('', { nonNullable: true }),
    browserUrl: new FormControl('', { nonNullable: true, validators: [browserUrlValidator] }),
    defaultRootFolderPath: new FormControl('', {
      nonNullable: true,
      validators: [absoluteFolderValidator],
    }),
    defaultQualityProfileId: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^[1-9]\d*$/), Validators.max(2147483647)],
    }),
    apiKey: new FormControl('', { nonNullable: true }),
    enabled: new FormControl(true, { nonNullable: true }),
  });
}

export function createEmptyIntegrationsRecord(): Record<
  IntegrationType,
  IntegrationResponse | null
> {
  return {
    STASH: null,
    WHISPARR: null,
    STASHDB: null,
    FANSDB: null,
  };
}

export function mapIntegrationsByType(
  integrations: IntegrationResponse[],
): Record<IntegrationType, IntegrationResponse | null> {
  const byType = createEmptyIntegrationsRecord();

  for (const integration of integrations) {
    byType[integration.type] = integration;
  }

  return byType;
}

export function createActionState(): IntegrationActionState {
  return {
    running: false,
    success: null,
    error: null,
  };
}

export function createActionStateRecord(): Record<IntegrationType, IntegrationActionState> {
  return {
    STASH: createActionState(),
    WHISPARR: createActionState(),
    STASHDB: createActionState(),
    FANSDB: createActionState(),
  };
}

export function patchActionState(
  store: {
    update: (
      updater: (
        state: Record<IntegrationType, IntegrationActionState>,
      ) => Record<IntegrationType, IntegrationActionState>,
    ) => void;
  },
  type: IntegrationType,
  patch: Partial<IntegrationActionState>,
): void {
  store.update((current) => ({
    ...current,
    [type]: {
      ...current[type],
      ...patch,
    },
  }));
}

export function buildIntegrationPayload(
  type: IntegrationType,
  form: IntegrationForm,
): UpdateIntegrationPayload {
  const formValue = form.getRawValue();
  const payload: UpdateIntegrationPayload = {
    enabled: isCatalogProviderType(type) ? true : formValue.enabled,
    name: normalizeInput(formValue.name),
    baseUrl: normalizeInput(formValue.baseUrl),
  };

  if (formValue.browserUrl.trim() || form.controls.browserUrl.dirty) {
    payload.browserUrl = normalizeInput(formValue.browserUrl) ?? null;
  }
  if (type === 'WHISPARR') {
    if (formValue.defaultRootFolderPath.trim() || form.controls.defaultRootFolderPath.dirty) {
      payload.defaultRootFolderPath = normalizeInput(formValue.defaultRootFolderPath) ?? null;
    }
    if (formValue.defaultQualityProfileId.trim() || form.controls.defaultQualityProfileId.dirty) {
      payload.defaultQualityProfileId = normalizeInput(formValue.defaultQualityProfileId)
        ? Number(formValue.defaultQualityProfileId)
        : null;
    }
  }

  const apiKey = normalizeInput(formValue.apiKey);
  if (apiKey) {
    payload.apiKey = apiKey;
  }

  return payload;
}

function browserUrlValidator(control: { value: string }) {
  if (!control.value.trim()) return null;
  try {
    const parsed = new URL(control.value.trim());
    return ['http:', 'https:'].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
      ? null
      : { browserUrl: true };
  } catch {
    return { browserUrl: true };
  }
}

function absoluteFolderValidator(control: { value: string }) {
  const value = control.value.trim();
  if (!value) return null;
  return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(value) && !/[\u0000-\u001f\u007f]/.test(value)
    ? null
    : { absoluteFolder: true };
}

export function defaultEnabledValue(
  type: IntegrationType,
  integration: IntegrationResponse | null,
): boolean {
  if (integration) {
    return integration.enabled;
  }

  return isCatalogProviderType(type) ? false : true;
}

export function normalizeInput(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function formatOptionalDateTime(value: string | null): string | null {
  return value ? formatDateTime(value) : null;
}

export function describeMutationError(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }

    if (Array.isArray(message) && message.length > 0) {
      return message.join(' ');
    }
  }

  return fallback;
}
