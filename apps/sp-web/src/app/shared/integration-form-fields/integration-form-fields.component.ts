import { Component, EventEmitter, Input, Output } from '@angular/core';
import { WhisparrDefaultOptions } from '../../core/api/integrations.types';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { ToggleSwitch } from 'primeng/toggleswitch';

@Component({
  selector: 'app-integration-form-fields',
  imports: [ReactiveFormsModule, InputText, Message, ToggleSwitch],
  templateUrl: './integration-form-fields.component.html',
  styleUrl: './integration-form-fields.component.scss',
})
export class IntegrationFormFieldsComponent {
  @Input({ required: true }) form!: FormGroup;
  @Input() hasStoredApiKey = false;
  @Input() enabledInputId = 'integration-enabled';
  @Input() showEnabledToggle = true;
  @Input() showRequestDefaults = false;
  @Input() defaultOptions: WhisparrDefaultOptions | null = null;
  @Input() loadingDefaultOptions = false;
  @Input() defaultOptionsError: string | null = null;
  @Output() loadDefaultOptions = new EventEmitter<void>();

  protected missingDefaultRoot(): string | null {
    const value = this.form.get('defaultRootFolderPath')?.value as string;
    return value &&
      this.defaultOptions &&
      !this.defaultOptions.rootFolders.some((folder) => folder.path === value)
      ? value
      : null;
  }

  protected missingDefaultProfile(): string | null {
    const value = this.form.get('defaultQualityProfileId')?.value as string;
    return value &&
      this.defaultOptions &&
      !this.defaultOptions.qualityProfiles.some((profile) => String(profile.id) === value)
      ? value
      : null;
  }
}
