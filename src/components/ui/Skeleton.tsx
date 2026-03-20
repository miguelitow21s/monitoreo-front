"use client"

type SkeletonProps = {
  className?: string
}

export default function Skeleton({ className }: SkeletonProps) {
  return <div className={["animate-pulse rounded-xl bg-slate-700/60", className ?? ""].join(" ")} />
}
