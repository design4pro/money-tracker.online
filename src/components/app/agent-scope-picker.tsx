import { Checkbox, CheckboxGroup } from '#/components/ui'
import { AGENT_SCOPES, scopeMessageKey } from '#/lib/agent-scopes'
import { useTranslate } from '#/lib/i18n'

import type { AgentScope } from '#/lib/agent-scopes'
import type { ReactNode } from 'react'

export interface AgentScopePickerProps {
  value: ReadonlyArray<string>
  onChange: (value: Array<string>) => void
  label: string
  description?: ReactNode
  errorMessage?: string
  isRequired?: boolean
}

/** Keep the closed set, in catalogue order. */
export function selectedAgentScopes(
  values: ReadonlyArray<string>,
): Array<AgentScope> {
  return AGENT_SCOPES.filter((scope) => values.includes(scope))
}

/**
 * The eighteen `resource:verb` checkboxes.
 *
 * Consent, mint, and the grant editor share this group. It does not fetch.
 */
export function AgentScopePicker({
  value,
  onChange,
  label,
  description,
  errorMessage,
  isRequired = false,
}: AgentScopePickerProps) {
  const t = useTranslate()
  return (
    <CheckboxGroup
      isRequired={isRequired}
      label={label}
      description={description}
      errorMessage={errorMessage}
      value={[...value]}
      onChange={onChange}
    >
      {AGENT_SCOPES.map((scope) => (
        <Checkbox key={scope} value={scope}>
          {t(scopeMessageKey(scope))}
        </Checkbox>
      ))}
    </CheckboxGroup>
  )
}
