"use client"

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
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full rounded bg-white shadow">
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={String(col.key)}
                className="bg-gray-100 px-4 py-2 text-left text-sm font-semibold"
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
                className="px-4 py-6 text-center text-sm text-gray-500"
              >
                No hay datos para mostrar
              </td>
            </tr>
          )}

          {data.map((row, idx) => (
            <tr key={idx} className="border-b last:border-0">
              {columns.map(col => (
                <td
                  key={String(col.key)}
                  className="px-4 py-2 text-sm"
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