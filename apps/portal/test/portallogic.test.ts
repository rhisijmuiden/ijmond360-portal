import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeNotices,
  appSchema,
  canSee,
  claimGroups,
  classify,
  eventItems,
  mailItems,
  nowNext,
  parseXmltv,
  safeOutlookLink,
  safeTeamsLink,
  sameIds,
  settingsSchema,
  xmltvTime,
} from "../server/portallogic.ts";

test("canSee: no groups = everyone, admins see all, unknown groups never match", () => {
  const groups = new Map([
    [1, "aaaaaaaa-0000-0000-0000-000000000001"],
    [2, "aaaaaaaa-0000-0000-0000-000000000002"],
  ]);
  const user = { isAdmin: false, groupObjectIds: ["AAAAAAAA-0000-0000-0000-000000000002"] };
  assert.equal(canSee([], groups, user), true);
  assert.equal(canSee([1], groups, user), false);
  assert.equal(canSee([1, 2], groups, user), true);
  assert.equal(canSee([3], groups, user), false);
  assert.equal(canSee([1], groups, { isAdmin: true, groupObjectIds: [] }), true);
});

test("claimGroups keeps GUIDs only, lower case, unique", () => {
  assert.deepEqual(claimGroups(["AAAAAAAA-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000001", "evil", 4]), ["aaaaaaaa-0000-0000-0000-000000000001"]);
  assert.deepEqual(claimGroups(undefined), []);
});

test("buttons only accept http(s) links", () => {
  const base = { tabId: 1, name: "X" };
  assert.equal(appSchema.safeParse({ ...base, url: "https://tv.ijmond360.loc" }).success, true);
  assert.equal(appSchema.safeParse({ ...base, url: "http://10.40.4.20:8080/" }).success, true);
  for (const url of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "tv.ijmond360.loc"]) assert.equal(appSchema.safeParse({ ...base, url }).success, false, url);
});

test("status light: anything below 500 is up", () => {
  assert.equal(classify({ status: 200 }), "up");
  assert.equal(classify({ status: 302 }), "up");
  assert.equal(classify({ status: 401 }), "up");
  assert.equal(classify({ status: 502 }), "down");
  assert.equal(classify({ error: "ECONNREFUSED" }), "down");
});

test("notices are shown between start and end", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  const rows = [
    { id: 1, startsAt: null, endsAt: null },
    { id: 2, startsAt: "2026-11-19T00:00:00Z", endsAt: null },
    { id: 3, startsAt: null, endsAt: "2026-11-18T11:00:00Z" },
    { id: 4, startsAt: "2026-11-18T10:00:00Z", endsAt: "2026-11-18T13:00:00Z" },
  ];
  assert.deepEqual(activeNotices(rows, now).map((n) => n.id), [1, 4]);
});

test("sameIds: a new order holds exactly the existing ids", () => {
  assert.equal(sameIds([1, 2, 3], [3, 1, 2]), true);
  assert.equal(sameIds([1, 2, 3], [1, 2]), false);
  assert.equal(sameIds([1, 2, 3], [1, 2, 2]), false);
  assert.equal(sameIds([1, 2], [1, 4]), false);
});

test("settings have sensible defaults", () => {
  const s = settingsSchema.parse({});
  assert.equal(s.m365.mail, true);
  assert.equal(s.tv.enabled, false);
  assert.equal(settingsSchema.safeParse({ tv: { xmltvUrl: "javascript:x" } }).success, false);
});

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="TV Station Manager">
  <channel id="tvsm.1"><display-name>IJmond 360</display-name></channel>
  <channel id="tvsm.2"><display-name>Radio &amp; Beeld</display-name></channel>
  <programme start="20261118200000 +0100" stop="20261118210000 +0100" channel="tvsm.1"><title lang="nl">Nieuws &amp; Weer</title><desc lang="nl">Het nieuws</desc></programme>
  <programme start="20261118210000 +0100" stop="20261118220000 +0100" channel="tvsm.1"><title lang="nl">Talkshow</title></programme>
  <programme start="20261118200000 +0100" stop="20261118230000 +0100" channel="tvsm.2"><title>Beeldkrant</title></programme>
</tv>`;

test("XMLTV: times with offset, entities, now and next per channel", () => {
  assert.equal(xmltvTime("20261118200000 +0100"), Date.parse("2026-11-18T19:00:00Z"));
  assert.equal(xmltvTime("20261118200000"), Date.parse("2026-11-18T20:00:00Z"));
  const g = parseXmltv(XML);
  assert.equal(g.channels[1]!.name, "Radio & Beeld");
  const at = Date.parse("2026-11-18T19:30:00Z");
  const r = nowNext(g, "", at);
  assert.equal(r.channel, "tvsm.1");
  assert.equal(r.now?.title, "Nieuws & Weer");
  assert.equal(r.now?.description, "Het nieuws");
  assert.equal(r.next?.title, "Talkshow");
  assert.equal(nowNext(g, "tvsm.2", at).now?.title, "Beeldkrant");
  assert.equal(nowNext(g, "tvsm.2", at).next, null);
  // Between programmes: nothing now, the next one is still shown.
  assert.equal(nowNext(g, "tvsm.1", Date.parse("2026-11-18T18:00:00Z")).now, null);
  assert.equal(nowNext(g, "tvsm.1", Date.parse("2026-11-18T18:00:00Z")).next?.title, "Nieuws & Weer");
});

test("Graph results: only Outlook and Teams links are passed on, times become UTC", () => {
  assert.equal(safeOutlookLink("https://outlook.office365.com/owa/?ItemID=1"), "https://outlook.office365.com/owa/?ItemID=1");
  assert.equal(safeOutlookLink("https://evil.example/owa"), null);
  assert.equal(safeOutlookLink("javascript:alert(1)"), null);
  assert.equal(safeTeamsLink("https://teams.microsoft.com/l/meetup-join/x"), "https://teams.microsoft.com/l/meetup-join/x");
  const mail = mailItems([{ id: "1", subject: "Hoi", from: { emailAddress: { name: "Piet", address: "p@x.nl" } }, isRead: false, receivedDateTime: "2026-11-18T10:00:00Z", webLink: "https://evil.example" }]);
  assert.deepEqual(mail[0], { id: "1", subject: "Hoi", from: "Piet", receivedAt: "2026-11-18T10:00:00Z", unread: true, preview: "", link: null });
  const ev = eventItems([
    { id: "a", subject: "Overleg", start: { dateTime: "2026-11-18T08:30:00.0000000" }, end: { dateTime: "2026-11-18T09:00:00.0000000" }, onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/x" } },
    { id: "b", subject: "Weg", isCancelled: true },
  ]);
  assert.equal(ev.length, 1);
  assert.equal(ev[0]!.start, "2026-11-18T08:30:00.000Z");
  assert.equal(ev[0]!.joinUrl, "https://teams.microsoft.com/l/x");
});
