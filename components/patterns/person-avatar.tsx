import { User } from "lucide-react";
import { cn } from "@/lib/utils";

interface PersonAvatarProps {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES = { sm: "size-8", md: "size-10", lg: "size-12" };
const ICON_SIZE_CLASSES = { sm: "size-4", md: "size-5", lg: "size-6" };

/** A person's round avatar in the accent wash, as in the header (DESIGN.md: blue is the one accent). */
export function PersonAvatar({ name, size = "md", className }: PersonAvatarProps) {
  return (
    <span
      aria-hidden
      title={name}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground", SIZE_CLASSES[size], className)}
    >
      <User className={ICON_SIZE_CLASSES[size]} strokeWidth={1.75} />
    </span>
  );
}
