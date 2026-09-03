import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { DASHBOARD_PERIODS } from '#/components/app/dashboard'
import { requireOrg } from '#/server/auth/guards'

import { dashboardFor } from './dashboard-data'

import type { DashboardData } from '#/components/app/dashboard'

/**
 * The dashboard's server function: the door, and nothing else.
 *
 * It re-establishes who is asking (`requireOrg`), validates what was asked for (`inputSchema`) and
 * hands both to {@link dashboardFor}, which is where every decision about the answer lives.
 *
 * **The split is not stylistic.** This module is reached from `index.tsx` and is therefore in the
 * client module graph; the Start plugin strips a `createServerFn` handler's *body* from the client
 * bundle and drops the imports that go with it. A plain exported function beside it would not be
 * stripped, and `dashboardFor` reaches `@tanstack/react-start/server` — an import the client
 * environment denies outright. So the composition sits in its own module, imported only from
 * inside the handler, which is also what makes it callable from a unit test.
 */

const inputSchema = z.strictObject({
  period: z.enum(DASHBOARD_PERIODS).default('thisMonth'),
})

export const loadDashboard = createServerFn({ method: 'GET' })
  .inputValidator(inputSchema)
  .handler(async ({ data }): Promise<DashboardData> =>
    dashboardFor(await requireOrg(), data.period),
  )
