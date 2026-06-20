// `catch` clause variables are typed `unknown`, not `any` — narrow once here
// instead of typing every catch site `(e: any)` and writing `e?.message ?? e`
// by hand. Repeated identically at 7 call sites before this existed.
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
