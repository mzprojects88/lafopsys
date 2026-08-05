import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { categoryClasses, type CategoryColor } from "@/lib/utils/category-colors";

interface IconCircleProps {
  icon: LucideIcon;
  color?: CategoryColor;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES = {
  sm: "size-8",
  md: "size-10",
  lg: "size-12",
};

const ICON_SIZE_CLASSES = {
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
};

export function IconCircle({ icon: Icon, color = "blue", size = "md", className }: IconCircleProps) {
  const classes = categoryClasses(color);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-2xl",
        SIZE_CLASSES[size],
        classes.bg,
        className
      )}
    >
      <Icon className={cn(ICON_SIZE_CLASSES[size], classes.text)} />
    </span>
  );
}
