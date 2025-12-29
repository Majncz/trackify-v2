import { HTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

type CardProps = HTMLAttributes<HTMLDivElement>;

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "bg-white rounded-lg border border-gray-200 shadow-sm",
          className
        )}
        {...props}
      />
    );
  }
);
Card.displayName = "Card";

const CardHeader = forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("px-4 py-3 border-b border-gray-200", className)}
        {...props}
      />
    );
  }
);
CardHeader.displayName = "CardHeader";

const CardContent = forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => {
    return <div ref={ref} className={cn("p-4", className)} {...props} />;
  }
);
CardContent.displayName = "CardContent";

export { Card, CardHeader, CardContent };
