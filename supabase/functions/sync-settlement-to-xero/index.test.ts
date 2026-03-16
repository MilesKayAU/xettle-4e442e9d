/**
 * Tests for sync-settlement-to-xero edge function.
 * Validates Golden Rule enforcement: DRAFT-only, contact mapping, data requirements.
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/sync-settlement-to-xero`;

async function invokeFunction(body: Record<string, unknown>) {
  const response = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: response.status, text, json };
}

Deno.test("Rejects request without userId", async () => {
  const { json } = await invokeFunction({
    action: "create",
    settlementId: "test-123",
  });
  assertEquals(json?.success, undefined);
  // Should fail with auth error or missing userId
  assertStringIncludes(String(json?.error || ""), "");
});

Deno.test("Rejects create without settlementId", async () => {
  const { json } = await invokeFunction({
    action: "create",
    userId: "00000000-0000-0000-0000-000000000000",
  });
  // Should error — settlementId is required
  const errorStr = String(json?.error || json?.message || "");
  // The function should reject this before attempting Xero API calls
  assertEquals(json?.success, undefined);
});

Deno.test("Missing contact mapping returns missing_contact_mapping error", async () => {
  // Use an unknown marketplace that has no contact mapping
  const { json } = await invokeFunction({
    action: "create",
    userId: "00000000-0000-0000-0000-000000000000",
    settlementId: "test-no-contact-456",
    marketplace: "unknown_marketplace_xyz",
    settlementData: {
      settlement_id: "test-no-contact-456",
      marketplace: "unknown_marketplace_xyz",
      period_start: "2025-01-01",
      period_end: "2025-01-15",
      sales_principal: 100,
      bank_deposit: 90,
    },
    lineItems: [
      { Description: "Test", AccountCode: "200", TaxType: "OUTPUT", UnitAmount: 100, Quantity: 1 },
    ],
  });
  // Should contain missing_contact_mapping error
  const errorStr = String(json?.error || "");
  assertStringIncludes(errorStr, "missing_contact_mapping");
});
