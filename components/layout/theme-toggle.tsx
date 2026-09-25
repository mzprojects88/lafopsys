"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard mounted-flag guard against theme SSR mismatch
  React.useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <Button variant="outline" size="icon-lg" disabled className="opacity-0" />;
  }

  return (
    <Button
      variant="outline"
      size="icon-lg"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {resolvedTheme === "dark" ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
    </Button>
  );
}
