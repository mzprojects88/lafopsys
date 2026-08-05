import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step {
  label: string;
  timestamp?: string;
}

interface LifecycleStepperProps {
  steps: Step[];
  currentIndex: number;
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export function LifecycleStepper({
  steps,
  currentIndex,
  orientation = "horizontal",
  className,
}: LifecycleStepperProps) {
  const isVertical = orientation === "vertical";

  return (
    <div className={cn("flex", isVertical ? "flex-col gap-0" : "items-start", className)}>
      {steps.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const isLast = i === steps.length - 1;

        return (
          <div
            key={step.label}
            className={cn(
              "flex",
              isVertical ? "flex-row gap-3" : "flex-1 flex-col items-center gap-1.5"
            )}
          >
            <div className={cn("flex items-center", isVertical ? "flex-col" : "w-full flex-row")}>
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && !done && "border-primary text-primary",
                  !done && !active && "border-border text-muted-foreground"
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              {!isLast && (
                <span
                  className={cn(
                    isVertical ? "my-1 w-px flex-1 min-h-4" : "mx-1 h-px flex-1 mt-3",
                    done ? "bg-primary" : "bg-border"
                  )}
                />
              )}
            </div>
            <div className={cn("flex flex-col", isVertical && "pb-4", !isVertical && "items-center text-center")}>
              <span className={cn("text-xs font-medium", active && "text-foreground", !active && "text-muted-foreground")}>
                {step.label}
              </span>
              {step.timestamp && (
                <span className="text-[10px] text-muted-foreground">{step.timestamp}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
