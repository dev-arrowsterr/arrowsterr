import { test } from "node:test";
import assert from "node:assert/strict";
import { bulkList } from "../src/lib/research.ts";

test("bulkList: one per line or comma, trimmed, lowercased, no repeats or blanks", () => {
  assert.deepEqual(bulkList("CRM Software\n\n crm software \nhubspot alternatives, Pipedrive;salesforce\t zoho "), ["crm software", "hubspot alternatives", "pipedrive", "salesforce", "zoho"]);
  assert.deepEqual(bulkList(['"acme.com"', "Acme.com", "  "]), ["acme.com"]);
  assert.deepEqual(bulkList(""), []);
});
