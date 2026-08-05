import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_COLOR_CLASSES, type CategoryColor } from "@/lib/utils/category-colors";

const ROTATION: CategoryColor[] = ["blue", "green", "orange", "purple", "rose", "cyan", "amber", "indigo"];

/** Deterministic color per name, so the same person always gets the same tint across the app. */
export function colorForName(name: string): CategoryColor {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return ROTATION[hash % ROTATION.length];
}

interface PersonAvatarProps {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES = { sm: "size-8", md: "size-10", lg: "size-12" };

const ICON_SIZE_CLASSES = { sm: "size-4", md: "size-5", lg: "size-6" };

export function PersonAvatar({ name, size = "md", className }: PersonAvatarProps) {
  const color = colorForName(name);
  const classes = CATEGORY_COLOR_CLASSES[color];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        SIZE_CLASSES[size],
        classes.bg,
        classes.text,
        className
      )}
    >
      <User className={ICON_SIZE_CLASSES[size]} />
    </span>
  );
}
