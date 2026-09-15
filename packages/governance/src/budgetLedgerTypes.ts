export interface LedgerRow {
  operation_id: string;
  intent_id: string;
  contract_version: string;
  fingerprint_version: string;
  request_fingerprint: string;
  fingerprint_components_json: string;
  state: string;
  reserved_microusd: number;
  settled_microusd: number;
  period_start: string;
  deadline_at: string;
  created_at: string;
  execution_started_at: string | null;
  terminal_at: string | null;
  terminal_result_json: string | null;
  terminal_result_digest: string | null;
  evidence_json: string | null;
}

export interface BudgetRow {
  period_start: string;
  spent_microusd: number;
  cap_microusd: number;
  stasis_active: number;
  trip_code: string | null;
  stasis_message: string | null;
}

export interface TenantBudgetRow {
  tenant_id: string;
  period_start: string;
  spent_microusd: number;
  cap_microusd: number;
  warn_threshold_pct: number;
  stasis_active: number;
  trip_code: string | null;
  trip_at: string | null;
  resumed_by: string | null;
  stasis_message: string | null;
  revision: number;
}
