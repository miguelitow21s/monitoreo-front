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
        "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm",
        className ?? "",
      ].join(" ")}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>

      {variant === "stat" && (
        <>
          <p className="mt-2 text-3xl font-bold text-slate-900">{value ?? "-"}</p>
          {trend && <p className="mt-2 text-xs text-emerald-600">{trend}</p>}
        </>
      )}

      {variant === "content" && (
        <>
          {subtitle && <p className="mt-2 text-sm text-slate-600">{subtitle}</p>}
          {children}
        </>
      )}
    </article>
  )
}
