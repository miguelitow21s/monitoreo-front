"use client"

type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info"

type BadgeProps = {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}

const variantClasses: Record<BadgeVariant, string> = {
  neutral: "bg-slate-700/60 text-slate-100 border-white/10",
  success: "bg-emerald-500/20 text-emerald-200 border-emerald-400/30",
  warning: "bg-amber-500/20 text-amber-200 border-amber-400/30",
  danger: "bg-rose-500/20 text-rose-200 border-rose-400/30",
  info: "bg-sky-500/20 text-sky-200 border-sky-400/30",
}

export default function Badge({ children, variant = "neutral", className }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
        variantClasses[variant],
        className ?? "",
      ].join(" ")}
    >
      {children}
    </span>
  )
}
