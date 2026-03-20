"use client"

type CardVariant = "content" | "stat"

type CardProps = {
  title: string
  subtitle?: string
  value?: string
  trend?: string
  variant?: CardVariant
  children?: React.ReactNode
  className?: string
}

export default function Card({
  title,
  subtitle,
  value,
  trend,
  variant = "content",
  children,
  className,
}: CardProps) {
  return (
    <article
      className={[
        "rounded-xl border border-white/10 bg-slate-800 p-4 shadow-sm sm:p-5",
        className ?? "",
      ].join(" ")}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{title}</p>

      {variant === "stat" && (
        <>
          <p className="mt-2 text-2xl font-bold text-white sm:text-3xl">{value ?? "-"}</p>
          {trend && <p className="mt-2 text-xs text-slate-400">{trend}</p>}
        </>
      )}

      {variant === "content" && (
        <>
          {subtitle && <p className="mt-2 text-sm text-slate-400">{subtitle}</p>}
          {children}
        </>
      )}
    </article>
  )
}
