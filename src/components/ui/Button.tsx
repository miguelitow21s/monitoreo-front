"use client"

import type { ButtonHTMLAttributes, ReactNode } from "react"

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger"
type ButtonSize = "sm" | "md" | "lg"

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  leftIcon?: ReactNode
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-slate-900 bg-slate-900 text-white hover:bg-slate-800",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  ghost: "border border-transparent bg-transparent text-slate-700 hover:bg-slate-100",
  danger:
    "border border-red-600 bg-red-600 text-white hover:bg-red-500",
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-sm",
}

export default function Button({
  children,
  variant = "primary",
  size = "md",
  fullWidth = false,
  leftIcon,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors duration-150 active:translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
        variantClasses[variant],
        sizeClasses[size],
        fullWidth ? "w-full" : "",
        className ?? "",
      ].join(" ")}
      {...props}
    >
      {leftIcon}
      {children}
    </button>
  )
}
