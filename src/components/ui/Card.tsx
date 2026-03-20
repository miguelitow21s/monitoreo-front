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
  const isStat = variant === "stat"

  return (
    <article
      className={[
        "card",
        isStat ? "stat-card" : "",
        className ?? "",
      ].join(" ")}
    >
      <div className="card-header">
        <div>
          <div className="card-title">{title}</div>
          {subtitle && <div className="card-subtitle">{subtitle}</div>}
        </div>
        {isStat && <div className="stat-value">{value ?? "-"}</div>}
      </div>

      {isStat ? (
        <>
          {trend && <div className="stat-label">{trend}</div>}
          {children}
        </>
      ) : (
        children
      )}
    </article>
  )
}
