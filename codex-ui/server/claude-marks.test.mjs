// Run with `pnpm test`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readMarks } from "./claude-marks.mjs";

test("the working mark's sheets come out of the chunk's tables", () => {
  const dist = mkdtempSync(path.join(tmpdir(), "claude-marks-"));
  try {
    const v1 = path.join(dist, "assets", "v1");
    mkdirSync(v1, { recursive: true });
    writeFileSync(path.join(v1, "c0ffee000-X.js"), "var e={};export{e as SHEET_URLS};");
    assert.equal(readMarks(dist), null);
    writeFileSync(
      path.join(v1, "c8677db5f-CJKAHncR.js"),
      'var e={"blocked.in":{frames:16,speed:33.3333},"code.loop":{frames:75,speed:33.3333,seams:[18,37,56],rest:74},"default.in":{frames:16,speed:33.3333},' +
        'grow:{frames:10,speed:33.3333}},t=new URL("data:image/webp;base64,UklG",""+import.meta.url).href,$a=new URL("/assets/v1/c05229fc6-D3jyHLR7.webp",""+import.meta.url).href,' +
        'u=new URL("data:image/webp;base64,QUJD",""+import.meta.url).href,x=new URL("/assets/v1/evil.svg",""+import.meta.url).href,E=48,D={"sphere.in":"default.in"},' +
        'O={...e,"sphere.in":e[D["sphere.in"]]},k={"sphere.in":t,"default.in":t,"code.loop":$a,grow:u,"blocked.in":x};export{D as ALIASES,O as SHEETS,E as SHEET_FRAME,k as SHEET_URLS};',
    );
    const marks = readMarks(dist);
    assert.deepEqual(JSON.parse(marks.json), {
      frame: 48,
      sheets: {
        "sphere.in": { frames: 16, speed: 33.3333, url: "data:image/webp;base64,UklG" },
        "default.in": { frames: 16, speed: 33.3333, url: "data:image/webp;base64,UklG" },
        "code.loop": { frames: 75, speed: 33.3333, seams: [18, 37, 56], rest: 74, url: "/claude-marks/c05229fc6-D3jyHLR7.webp" },
        grow: { frames: 10, speed: 33.3333, url: "data:image/webp;base64,QUJD" },
      },
    });
    assert.deepEqual([...marks.files], ["c05229fc6-D3jyHLR7.webp"]);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
