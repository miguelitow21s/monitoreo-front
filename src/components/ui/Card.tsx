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
        "rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5",
        className ?? "",
      ].join(" ")}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{title}</p>

      {variant === "stat" && (
        <>
          <p className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">{value ?? "-"}</p>
          {trend && <p className="mt-2 text-xs text-slate-500">{trend}</p>}
        </>
      )}

      {variant === "content" && (
        <>
          {subtitle && <p className="mt-2 text-sm text-slate-500">{subtitle}</p>}
          {children}
        </>
      )}
    </article>
  )
}
