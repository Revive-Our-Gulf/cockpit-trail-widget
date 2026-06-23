import { describe, expect, it } from "vitest";

import { createRovTrail } from "../../src/lib/rov-trail.js";

function createLeafletStub() {
  return {
    createdPolylines: [],
    polyline(latLngs, options) {
      var polyline = { latLngs: latLngs, options: options };
      this.createdPolylines.push(polyline);
      return polyline;
    },
    layerGroup() {
      return {
        layers: [],
        addTo() {
          return this;
        },
        addLayer(layer) {
          this.layers.push(layer);
          return this;
        },
        clearLayers() {
          this.layers = [];
          return this;
        },
      };
    },
  };
}

describe("createRovTrail", () => {
  it("caps trail length and fades older segments", () => {
    var leaflet = createLeafletStub();
    var trail = createRovTrail({
      leaflet: leaflet,
      maxPoints: 4,
      minSegmentDistanceMeters: 0,
    });

    trail.addTo({});
    trail.appendPoint({ lat: 29.5, lon: -95.3 });
    trail.appendPoint({ lat: 29.50001, lon: -95.30001 });
    trail.appendPoint({ lat: 29.50002, lon: -95.30002 });
    trail.appendPoint({ lat: 29.50003, lon: -95.30003 });
    trail.appendPoint({ lat: 29.50004, lon: -95.30004 });

    expect(trail.getPoints()).toEqual([
      [29.50001, -95.30001],
      [29.50002, -95.30002],
      [29.50003, -95.30003],
      [29.50004, -95.30004],
    ]);
    expect(trail.layerGroup.layers).toHaveLength(3);
    expect(trail.layerGroup.layers[0].options.opacity).toBeLessThan(
      trail.layerGroup.layers[1].options.opacity
    );
    expect(trail.layerGroup.layers[1].options.opacity).toBeLessThan(
      trail.layerGroup.layers[2].options.opacity
    );
  });
});