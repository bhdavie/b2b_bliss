/**
 * Joins class name parts, dropping anything falsy.
 *
 * Deliberately tiny and dependency-free: there is no clsx or tailwind-merge in
 * this project and this step does not add one. It does NOT de-duplicate or
 * resolve Tailwind conflicts. That is intentional. Conflicts already resolve
 * the way they do today, by stylesheet order: the global classes live in
 * `@layer components` and caller utilities in `@layer utilities`, which Tailwind
 * emits afterwards, so an appended utility wins regardless of the order of
 * tokens in the class attribute.
 */
export function cn(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}
