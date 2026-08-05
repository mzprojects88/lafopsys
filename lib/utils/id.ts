/**
 * Fake-ID generator for demo record creation. Kept in its own module (rather
 * than inlined as `Date.now()` in a component) so the impure call sits
 * outside the component body — inlining it trips the React Compiler's
 * "components must be idempotent" lint rule even when the call only ever
 * happens inside an event handler.
 */
export function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
