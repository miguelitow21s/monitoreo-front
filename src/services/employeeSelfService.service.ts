import { invokeEdge } from "@/services/edgeClient"

export interface EmployeeDashboardData {
	assigned_restaurants?: Array<{ id: number; name?: string | null }>
	scheduled_shifts?: Array<{
		id: number
		restaurant_id: number
		scheduled_start: string
		scheduled_end: string
		status?: string
	}>
	pending_tasks_preview?: Array<{ id: number; title?: string; status?: string }>
	pending_tasks_count?: number
	active_shift?: {
		id: string | number
		start_time?: string
		restaurant_id?: number | null
		required_evidence_types?: string[]
		uploaded_evidence_types?: string[]
	} | null
	required_evidence_types?: string[]
	uploaded_evidence_types?: string[]
}

export interface EmployeeHoursHistoryRow {
	date?: string
	shift_id?: string | number
	start_time?: string
	end_time?: string | null
	worked_minutes?: number
	hours_worked?: number
	worked_hours?: number
	restaurant_id?: number | null
}

export interface EmployeeHoursHistoryResult {
	items: EmployeeHoursHistoryRow[]
	totalHours: number
}

function normalizeHoursTotal(payload: unknown) {
	if (!payload || typeof payload !== "object") return 0
	const candidate = payload as {
		total_hours?: unknown
		totalHours?: unknown
		total_worked_hours?: unknown
		total_hours_worked?: unknown
	}
	const raw =
		candidate.total_hours ?? candidate.totalHours ?? candidate.total_worked_hours ?? candidate.total_hours_worked
	return typeof raw === "number" && Number.isFinite(raw) ? raw : 0
}

function normalizeHoursItems(payload: unknown) {
	if (!payload || typeof payload !== "object") return [] as EmployeeHoursHistoryRow[]
	const wrapped = payload as { items?: unknown; rows?: unknown; history?: unknown }
	const rows = Array.isArray(wrapped.items)
		? wrapped.items
		: Array.isArray(wrapped.rows)
			? wrapped.rows
			: Array.isArray(wrapped.history)
				? wrapped.history
				: []
	return rows as EmployeeHoursHistoryRow[]
}

export async function getEmployeeSelfDashboard() {
	const payload = await invokeEdge<unknown>("employee_self_service", {
		idempotencyKey: crypto.randomUUID(),
		body: {
			action: "my_dashboard",
		},
	})

	if (!payload || typeof payload !== "object") return {}
	const row = payload as Record<string, unknown>
	const assignedRestaurants = Array.isArray(row.assigned_restaurants)
		? (row.assigned_restaurants as Array<Record<string, unknown>>).map(item => {
			const restaurant = item.restaurant as Record<string, unknown> | undefined
			return {
				id:
					typeof item.restaurant_id === "number"
						? item.restaurant_id
						: typeof restaurant?.id === "number"
							? restaurant.id
							: 0,
				name:
					typeof restaurant?.name === "string"
						? restaurant.name
						: typeof item.restaurant_name === "string"
							? item.restaurant_name
							: null,
			}
		})
		: []

	return {
		active_shift: (row.active_shift as EmployeeDashboardData["active_shift"]) ?? null,
		assigned_restaurants: assignedRestaurants,
		scheduled_shifts: Array.isArray(row.scheduled_shifts)
			? (row.scheduled_shifts as EmployeeDashboardData["scheduled_shifts"])
			: [],
		pending_tasks_count:
			typeof row.pending_tasks_count === "number" ? row.pending_tasks_count : undefined,
		pending_tasks_preview: Array.isArray(row.pending_tasks_preview)
			? (row.pending_tasks_preview as EmployeeDashboardData["pending_tasks_preview"])
			: [],
		required_evidence_types: Array.isArray(row.required_evidence_types)
			? (row.required_evidence_types as string[])
			: undefined,
		uploaded_evidence_types: Array.isArray(row.uploaded_evidence_types)
			? (row.uploaded_evidence_types as string[])
			: undefined,
	} satisfies EmployeeDashboardData
}

export async function getEmployeeHoursHistory(payload: {
	from: string
	to: string
}) {
	const response = await invokeEdge<unknown>("employee_self_service", {
		idempotencyKey: crypto.randomUUID(),
		body: {
			action: "my_hours_history",
			period_start: payload.from.slice(0, 10),
			period_end: payload.to.slice(0, 10),
		},
	})

	return {
		items: normalizeHoursItems(response),
		totalHours: normalizeHoursTotal(response),
	} satisfies EmployeeHoursHistoryResult
}

export async function createEmployeeObservation(payload: {
	shiftId?: string | number | null
	observationType: "observation" | "alert"
	message: string
}) {
	return invokeEdge("employee_self_service", {
		idempotencyKey: crypto.randomUUID(),
		body: {
			action: "create_observation",
			shift_id: payload.shiftId ?? null,
			kind: payload.observationType,
			message: payload.message,
		},
	})
}
