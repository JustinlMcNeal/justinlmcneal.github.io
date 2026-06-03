import { test, expect } from "@playwright/test";
import {
  resolvePushWorkflowFromSuggestedAsin,
  resolveSuggestedAsinForSubmit,
} from "../js/admin/amazon/pushDraftWorkflow.js";

test.describe("Amazon push suggested ASIN workflow", () => {
  test("blank suggested ASIN uses new catalog (Option B)", () => {
    const result = resolvePushWorkflowFromSuggestedAsin("");
    expect(result.suggestedAsin).toBe("");
    expect(result.offerOnExistingAsin).toBe(false);
    expect(result.requirements).toBe("LISTING");
    expect(result.pushWorkflow).toBe("new_catalog");
  });

  test("whitespace-only suggested ASIN is treated as blank", () => {
    const result = resolvePushWorkflowFromSuggestedAsin("   ");
    expect(result.suggestedAsin).toBe("");
    expect(result.pushWorkflow).toBe("new_catalog");
  });

  test("explicit ASIN uses offer-only repush", () => {
    const result = resolvePushWorkflowFromSuggestedAsin("B0GVC2K467");
    expect(result.suggestedAsin).toBe("B0GVC2K467");
    expect(result.offerOnExistingAsin).toBe(true);
    expect(result.requirements).toBe("LISTING_OFFER_ONLY");
    expect(result.pushWorkflow).toBe("offer_on_asin");
  });

  test("cleared form value must not resurrect stale ASIN", () => {
    const resolved = resolveSuggestedAsinForSubmit("");
    expect(resolved).toBe("");
    const workflow = resolvePushWorkflowFromSuggestedAsin(resolved);
    expect(workflow.pushWorkflow).toBe("new_catalog");
  });
});
