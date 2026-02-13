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
    "bg-slate-900 text-white hover:bg-slate-700 border border-slate-900 shadow-[0_6px_14px_rgba(15,23,42,0.2)] hover:shadow-[0_8px_18px_rgba(15,23,42,0.25)]",
  secondary: "bg-white text-slate-700 hover:bg-slate-100 border border-slate-300",
  ghost: "bg-transparent text-slate-700 hover:bg-slate-100 border border-transparent",
  danger:
    "bg-red-600 text-white hover:bg-red-500 border border-red-600 shadow-[0_6px_14px_rgba(220,38,38,0.2)]",
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
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-transform duration-150 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60",
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
