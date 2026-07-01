"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-bg-base hover:bg-accent-soft font-medium shadow-[0_0_18px_-6px_rgba(34,211,238,0.6)]",
  secondary: "bg-bg-hover text-ink hover:bg-border border border-border",
  outline: "border border-border text-ink hover:bg-bg-hover",
  ghost: "text-ink-dim hover:bg-bg-hover hover:text-ink",
  danger:
    "bg-danger/90 text-white hover:bg-danger font-medium shadow-[0_0_18px_-6px_rgba(244,63,94,0.6)]",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-accent/50 focus:ring-offset-1 focus:ring-offset-bg-base",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
