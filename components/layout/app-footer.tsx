import { Heart, HelpCircle } from "lucide-react";

export function AppFooter() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground md:px-6">
      <span className="flex items-center gap-1.5">
        <Heart className="size-3.5" />© 2024 Little Ark Foundation. All rights reserved.
      </span>
      <span className="flex items-center gap-4">
        <a href="#" className="flex items-center gap-1 hover:text-foreground">
          <HelpCircle className="size-3.5" />
          Help Center
        </a>
        <a href="#" className="hover:text-foreground">
          Privacy Policy
        </a>
      </span>
    </footer>
  );
}
