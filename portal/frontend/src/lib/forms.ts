import { ApiRequestError } from './browser-api';

/**
 * Forms are checked with the SAME zod schemas the API uses (`@dcc/contracts`), so a limit, a required
 * field or an enum can never differ between the screen and the server. Nothing here copies a rule.
 */
type Issue = { path: ReadonlyArray<PropertyKey>; message: string };
type Schema<T> = {
  safeParse(
    input: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<Issue> } };
};

/** Message per field name. A problem that belongs to no field is under `_form`. */
export type FieldErrors = Record<string, string>;

export function validate<T>(
  schema: Schema<T>,
  input: unknown,
): { ok: true; data: T } | { ok: false; errors: FieldErrors } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path.length ? String(issue.path[0]) : '_form';
    errors[field] ??= issue.message;
  }
  return { ok: false, errors };
}

/** The API's own field problems (a 400 with `issues`), in the same shape as `validate`. */
export function fieldErrorsFromApi(error: unknown): FieldErrors {
  if (!(error instanceof ApiRequestError)) return {};
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path ? issue.path.split('.')[0]! : '_form';
    errors[field] ??= issue.message;
  }
  return errors;
}

/** An empty form box means "not given": optional fields must be left out, not sent as ''. */
export function blankToUndefined<T extends Record<string, unknown>>(values: T): T {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    ]),
  ) as T;
}

/** The longest text a schema field accepts, read from the schema itself (for counters and `maxLength`). */
export function maxLengthOf(field: unknown): number | undefined {
  const max = (field as { maxLength?: number | null } | null)?.maxLength;
  return typeof max === 'number' ? max : undefined;
}
