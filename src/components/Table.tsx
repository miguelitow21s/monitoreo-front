"use client"

import { useI18n } from "@/hooks/useI18n"

type Column<T> = {
  key: keyof T
  label: string
}

interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
}

export default function Table<T extends Record<string, unknown>>({
  columns,
  data,
}: TableProps<T>) {
  const { t } = useI18n()

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80">
            {columns.map(col => (
              <th
                key={String(col.key)}
                className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {data.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-sm text-slate-500"
              >
                {t("No hay datos para mostrar", "No data to display")}
              </td>
            </tr>
          )}

          {data.map((row, idx) => (
            <tr key={idx} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
              {columns.map(col => (
                <td
                  key={String(col.key)}
                  className="px-4 py-2.5 text-sm text-slate-700"
                >
                  {String(row[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
