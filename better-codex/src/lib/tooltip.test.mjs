// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of tooltip.ts).
// Each walk leaves a trigger and moves on; `closes` is the event whose handling closed the tooltip
// in Base UI's safePolygon (Claude 2.42304 vendor-frame nd, run on the same walk): its index,
// events.length when the 40ms pause timer did it, -1 when it stayed open. Events are
// [leave, x, y, target (0 elsewhere, 1 tooltip, 2 trigger), ms since the last one].
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { safePolygon } from "./tooltip.ts";

const CASES = [
  { side: "bottom", ref: [191.6,255.5,132,36], pop: [171.1,295.5,173.1,53.1], exit: [202,255], events: [[1,202,255,2,0],[0,224.9,267.3,0,2.4],[0,248.3,278.7,0,27.5]], closes: 0 }, // atLeave
  { side: "bottom", ref: [349.5,348.9,191.2,22.9], pop: [373.1,375.8,144,43], exit: [541.2,353.6], events: [[1,541.2,353.6,2,0],[0,550,361.9,0,9.3],[0,539.9,350.3,0,22.1]], closes: 1 }, // walk
  { side: "bottom", ref: [33.1,272.2,99.7,22.7], pop: [35.2,298.9,95.5,26.5], exit: [32.6,286], events: [[1,32.6,286,2,0],[0,50.4,290.4,0,10],[0,66.6,295.6,0,3.3],[0,84.4,301.3,1,27.1],[1,131.7,301.3,1,13.3],[0,125.9,307.3,1,2.9],[0,120.1,317.9,1,3.1]], closes: 4 }, // offTooltip
  { side: "top", ref: [552.4,224.4,111.3,30.8], pop: [504.6,160.9,207,59.5], exit: [659.2,223.9], events: [[1,659.2,223.9,2,0],[0,656.5,212.3,1,20.4],[0,652.6,202.3,1,20.9],[1,712.6,202.3,1,19.6],[0,690.1,189.6,1,13.9],[1,712.6,189.6,1,6.9],[0,676.8,180.1,1,14.6],[1,712.6,180.1,1,17.5],[0,639.4,170.8,1,17.9]], closes: 3 }, // offTooltip
  { side: "top", ref: [520.3,164.1,268.7,16.4], pop: [590.6,130.9,128.2,29.2], exit: [789.5,168.1], events: [[1,789.5,168.1,2,0],[0,763.3,163.1,0,8.3],[0,736,160,0,7.1],[0,710.7,154.7,1,17.6],[0,682.4,150.6,1,16.6],[0,653.5,142.7,1,12.8]], closes: 0 }, // atLeave
  { side: "top", ref: [487.7,119.8,211.3,32.2], pop: [552.2,56.3,82.4,59.5], exit: [487.2,132.9], events: [[1,487.2,132.9,2,0],[0,505.6,125,0,21.8],[0,523.3,116.8,0,5.7],[0,540.3,105.4,0,15.2],[0,557.8,95.8,1,10],[0,576.2,84.8,1,20.5]], closes: -1 }, // kept
  { side: "top", ref: [115.7,250.8,97.1,21.6], pop: [64.3,198.5,199.9,48.3], exit: [115.2,268.8], events: [[1,115.2,268.8,2,0],[0,144.7,264.1,0,18.5],[0,171,256.1,0,19.6],[0,200.4,250.6,0,6],[0,227.9,246,1,10],[0,255.1,236.2,1,17.6],[1,63.3,236.2,1,11.3]], closes: 6 }, // offTooltip
  { side: "bottom", ref: [480.7,483.4,73,19.3], pop: [461,506.7,112.4,55.3], exit: [480.2,490.4], events: [[1,480.2,490.4,2,0],[0,481.2,501.6,0,26.8],[0,479.1,515.1,1,25.1],[1,574.4,515.1,1,15.6]], closes: 3 }, // offTooltip
  { side: "top", ref: [306.9,240,80.1,35.4], pop: [233,207.4,228,28.6], exit: [326,275.9], events: [[1,326,275.9,2,0],[0,314.6,262.4,0,19.3],[0,302.3,252.3,0,29.7],[0,292.4,238.9,0,26.9],[0,281.3,228.4,1,5.8],[0,267.6,217.6,1,6.6],[1,462,217.6,1,8.7]], closes: 0 }, // atLeave
  { side: "top", ref: [51.3,484.4,42.2,22.6], pop: [-41.5,433.6,227.8,46.8], exit: [85.3,483.9], events: [[1,85.3,483.9,2,0],[0,98.6,476.5,1,6.4],[0,111.6,472.1,1,6.7]], closes: -1 }, // kept
  { side: "bottom", ref: [536.9,262.8,143.6,16.9], pop: [545.8,283.7,125.8,54.9], exit: [559.9,262.3], events: [[1,559.9,262.3,2,0],[0,566.8,270.5,0,25.3],[0,556.9,271.8,0,19.6],[0,546.3,277.6,0,14.4],[0,555.7,276.3,0,25.9],[0,560.7,276.5,0,10.7]], closes: 0 }, // atLeave
  { side: "bottom", ref: [438.2,211.4,299.2,39.3], pop: [487.8,254.7,200,56.4], exit: [437.7,228.8], events: [[1,437.7,228.8,2,0],[0,477.3,239.2,0,6],[0,515.7,246.6,0,27]], closes: 3 }, // timer
  { side: "bottom", ref: [104.4,274.9,291.9,34.4], pop: [168,313.3,164.8,59.8], exit: [343.2,309.8], events: [[1,343.2,309.8,2,0],[0,345.9,315.6,0,9.8],[0,334.2,321.2,0,17.9],[0,331.8,311.6,0,74.2],[0,341.2,309.8,0,3.2],[0,348.8,315,0,8.4]], closes: 1 }, // walk
  { side: "bottom", ref: [211.7,250.3,245.9,38.3], pop: [215.1,292.6,239.2,48.2], exit: [376.4,289.1], events: [[1,376.4,289.1,2,0],[0,380.1,289.7,0,18.1],[0,382.5,291.6,0,10.6],[0,385.9,294.2,1,57],[0,389.6,295.9,1,21.2],[0,389,301.8,1,28.2]], closes: -1 }, // kept
  { side: "top", ref: [108.3,403.3,22.5,28.1], pop: [73.5,368.7,92.1,30.6], exit: [123.7,402.8], events: [[1,123.7,402.8,2,0],[0,120.2,409.7,0,13.8],[0,115.3,403.9,0,15]], closes: 1 }, // walk
  { side: "top", ref: [338.4,485.9,44.2,19], pop: [289.9,429.2,141.3,52.7], exit: [383.1,499.3], events: [[1,383.1,499.3,2,0],[0,389.5,490.2,0,27],[0,396,483.5,0,13.8],[0,401.6,474.7,1,61.5],[1,432.2,474.7,1,18.7],[0,423.7,466.8,1,3.7],[1,288.9,466.8,1,17.2],[0,418.4,459.6,1,4.6],[1,288.9,459.6,1,11.4]], closes: 3 }, // walk
  { side: "top", ref: [376.4,251.6,243.2,32], pop: [430,198.5,136,49.1], exit: [375.9,269.4], events: [[1,375.9,269.4,2,0],[0,385.3,258.8,0,19.7],[0,396,250,0,16.6]], closes: 3 }, // timer
  { side: "top", ref: [406.7,464.7,182.2,19], pop: [425.2,421.2,145.2,39.5], exit: [406.2,477.9], events: [[1,406.2,477.9,2,0],[0,418.9,471.8,0,18.9],[0,431.8,466,0,24.5]], closes: 3 }, // timer
  { side: "bottom", ref: [413.5,391.3,200,20], pop: [431.7,415.3,163.6,50.7], exit: [614,409.4], events: [[1,614,409.4,2,0],[0,584,416.5,1,17.2],[0,553.1,422.5,1,6.9],[0,520.2,431.5,1,29.5],[0,491.6,438.3,1,19.9],[0,460.4,445.7,1,21.5]], closes: -1 }, // kept
  { side: "bottom", ref: [235.7,417.7,238.3,34.3], pop: [283.8,456,142.1,59.2], exit: [474.5,434.1], events: [[1,474.5,434.1,2,0],[0,454.7,448,0,19.9],[0,433.6,459.1,0,25.5]], closes: 3 }, // timer
];

const box = ([left, top, width, height]) => ({ getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }), contains(node) { return node === this; } });

test("safePolygon closes where Base UI does", () => {
  let now = 1000;
  mock.method(performance, "now", () => now);
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    for (const [i, c] of CASES.entries()) {
      const trigger = box(c.ref);
      const popup = box(c.pop);
      const elsewhere = box([0, 0, 0, 0]);
      const targets = [elsewhere, popup, trigger];
      let closed = -1;
      let step = 0;
      const check = safePolygon(c.exit[0], c.exit[1], c.side, () => {
        if (closed < 0) closed = step;
      });
      for (const [leave, x, y, target, dt] of c.events) {
        now += dt;
        mock.timers.tick(dt);
        check({ x, y, target: targets[target], related: leave ? elsewhere : undefined, leave: !!leave }, trigger, popup);
        if (closed >= 0) break;
        step++;
      }
      now += 100;
      mock.timers.tick(100);
      assert.equal(closed, c.closes, `case ${i}`);
    }
  } finally {
    mock.timers.reset();
    mock.restoreAll();
  }
});
