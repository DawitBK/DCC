'use client';

import { useId, type ReactNode } from 'react';

export type FieldControl = {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
};

/**
 * A label tied to its input, with the hint and the error announced with it.
 * `children` gets the ids to put on the control:
 *   <FormField label="Name" error={errors.name}>{(control) => <input className="field" {...control} />}</FormField>
 */
export function FormField({
  label,
  hint,
  error,
  required = false,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: (control: FieldControl) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ');
  return (
    <div className="field-group">
      <label className="label" htmlFor={id}>
        {label}
        {required && (
          <span className="required-mark" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {children({
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
      })}
      {hint && (
        <small className="hint" id={hintId}>
          {hint}
        </small>
      )}
      {error && (
        <small className="field-error" id={errorId} role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
