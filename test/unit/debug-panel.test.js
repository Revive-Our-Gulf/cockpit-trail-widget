import { describe, expect, it } from "vitest";

import { createDebugPanel } from "../../src/lib/debug-panel.js";

describe("createDebugPanel", () => {
  it("renders build, rov, map, and log info into the target element", () => {
    var element = { textContent: "" };
    var debug = createDebugPanel({
      element: element,
      buildInfo: {
        version: "1.2.3",
        sha: "abcdef123456",
      },
    });

    debug.setRovState({ lat: 1.2345678, lon: 2.3456789, heading: 123.45 });
    debug.setMapState({ lat: 3.4567891, lon: 4.5678912, zoom: 9 });
    debug.log("ready");

    expect(element.textContent).toBe(
      [
        "widget version: 1.2.3",
        "sha: abcdef123456",
        "rov lat, lon, hdg: 1.234568, 2.345679, 123.45",
        "map lat, lon, zoom: 3.456789, 4.567891, 9",
        "logs:",
        "- ready",
      ].join("\n")
    );
  });
});