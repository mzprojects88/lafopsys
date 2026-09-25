/**
 * The colour names the old per-module palette used. Modules no longer have
 * colours (DESIGN.md: blue is the one accent, colour means status); this type
 * only keeps the deprecated `color` props compiling while pages move to `tone`.
 * Delete it once nothing passes `color` any more.
 */
export type CategoryColor = "blue" | "cyan" | "teal" | "green" | "amber" | "orange" | "purple" | "indigo" | "rose" | "red" | "slate";
