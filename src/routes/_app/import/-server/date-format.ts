import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import { suggestDateFormat } from '#/server/import/map'

import type { DateFormatSuggestion } from '#/server/import/map'

/**
 * What the file's own date column says its layout is — asked from the mapping step.
 *
 * ## Why the question is asked over the wire
 *
 * `suggestDateFormat` lives in `src/server/import/map.ts` beside the parser it has to agree with,
 * and that module is server-only: it reaches `zod` and the repository error family. Re-deciding
 * DMY versus MDY in the browser would be a second implementation of the one rule this stage exists
 * to keep, and the two would drift the first time either changed. So the mapping step sends the
 * sampled cells of the column the person just pointed at, and the module that owns the answer
 * answers.
 *
 * ## The answer is never applied on its own
 *
 * `resolved` pre-fills a `Select`; `ambiguous` blocks the step until a person chooses between the
 * candidates; `unrecognised` says so beside the column. None of the three writes anything —
 * `mappingSchema` is what decides, and it has no default for `dateFormat`.
 *
 * The samples are the ten rows the upload already returned, so this adds no read of the file.
 */
export const suggestDateFormatSchema = z.strictObject({
  samples: z.array(z.string().max(200)).max(50),
})

export const suggestImportDateFormat = createServerFn({ method: 'POST' })
  .inputValidator(suggestDateFormatSchema)
  .handler(async ({ data }): Promise<DateFormatSuggestion> => {
    await requireOrg()
    return suggestDateFormat(data.samples)
  })
