// Types for floor-guard.mjs (plain ESM so the ladder runs it with bare node).

export interface Finding {
  file: string
  line?: number
  rule:
    'ts-suppression' | 'lint-suppression' | 'test-skipped' | 'test-file-deleted'
  text: string
}

export function auditDiff(diff: string): Finding[]
export function auditFile(file: string, content: string): Finding[]
