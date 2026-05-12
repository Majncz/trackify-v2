import * as React from "react"

import { cn } from "@/lib/utils"
import { focusControl } from "@/lib/focus-style"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onWheel, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null)

    React.useEffect(() => {
      if (type !== "number") return
      const el = innerRef.current
      if (!el) return
      const blockWheelFromChangingValue = (e: WheelEvent) => {
        e.preventDefault()
      }
      el.addEventListener("wheel", blockWheelFromChangingValue, {
        passive: false,
      })
      return () =>
        el.removeEventListener("wheel", blockWheelFromChangingValue)
    }, [type])

    const mergedRef = React.useCallback(
      (node: HTMLInputElement | null) => {
        innerRef.current = node
        if (typeof ref === "function") {
          ref(node)
        } else if (ref) {
          ref.current = node
        }
      },
      [ref]
    )

    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base shadow-sm file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          focusControl,
          type === "number" && "no-input-spinner",
          className
        )}
        ref={mergedRef}
        onWheel={onWheel}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
