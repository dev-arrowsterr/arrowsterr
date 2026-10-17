import assert from "node:assert/strict";
import { test } from "node:test";
import { mayPublish, showMoveNotice, sitesOf } from "../src/lib/cmsTypes.ts";
import { alertTarget, DEFAULT_ALERT_POINTS } from "../src/lib/integrationTypes.ts";

const ws = "ws-1";

test("a brand's article publishes only to that brand's sites", () => {
  const draft = { workspace_id: ws, brand_id: "brand-a" };
  assert.equal(mayPublish({ workspace_id: ws, brand_id: "brand-a" }, draft), true);
  assert.equal(mayPublish({ workspace_id: ws, brand_id: "brand-b" }, draft), false);
  // A site with no brand yet, or a draft whose website has no brand, publishes nowhere.
  assert.equal(mayPublish({ workspace_id: ws, brand_id: null }, draft), false);
  assert.equal(mayPublish({ workspace_id: ws, brand_id: null }, { workspace_id: ws, brand_id: null }), false);
  // Same brand id, other workspace: refused.
  assert.equal(mayPublish({ workspace_id: "ws-2", brand_id: "brand-a" }, draft), false);
});

test("two brands in one workspace each see only their own sites", () => {
  const all = [
    { id: "wp-a", brand_id: "brand-a" },
    { id: "wp-b", brand_id: "brand-b" },
    { id: "ghost-a", brand_id: "brand-a" },
    { id: "loose", brand_id: null },
  ];
  assert.deepEqual(sitesOf(all, "brand-a").map((c) => c.id), ["wp-a", "ghost-a"]);
  assert.deepEqual(sitesOf(all, "brand-b").map((c) => c.id), ["wp-b"]);
  assert.deepEqual(sitesOf(all, "brand-c"), []);
});

test("the notice to move sites shows once, and only with several brands", () => {
  const moved = [{ backfilled: false }, { backfilled: false }];
  const left = [{ backfilled: true }, { backfilled: false }];
  assert.equal(showMoveNotice(1, left), false);
  assert.equal(showMoveNotice(2, left), true);
  assert.equal(showMoveNotice(2, moved), false); // dismissed or moved
  assert.equal(showMoveNotice(3, []), false);
});

test("alerts use the brand's channel and size, falling back to the workspace's", () => {
  const wsRow = { slack_webhook: "https://hooks.slack.com/services/WS", alert_points: 10 };
  assert.deepEqual(alertTarget(null, null), { slack: null, points: DEFAULT_ALERT_POINTS });
  assert.deepEqual(alertTarget(null, wsRow), { slack: wsRow.slack_webhook, points: 10 });
  assert.deepEqual(alertTarget({ slack_channel: null, alert_points: null }, wsRow), { slack: wsRow.slack_webhook, points: 10 });
  assert.deepEqual(alertTarget({ slack_channel: "https://hooks.slack.com/services/BRAND", alert_points: 3 }, wsRow), { slack: "https://hooks.slack.com/services/BRAND", points: 3 });
  assert.deepEqual(alertTarget({ slack_channel: "", alert_points: 15 }, { slack_webhook: null }), { slack: null, points: 15 });
});
