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
  it("adds a new point only when the real position moves more than 1 meter", () => {
    var leaflet = createLeafletStub();
    var trail = createRovTrail({
      leaflet: leaflet,
      maxDistanceMeters: 200,
      minSegmentDistanceMeters: 1,
    });

    trail.addTo({});
    trail.appendPoint({ lat: 29.5, lon: -95.3 });
    trail.appendPoint({ lat: 29.500004, lon: -95.3 });
    trail.appendPoint({ lat: 29.50002, lon: -95.3 });

    expect(trail.getPoints()).toEqual([
      [29.5, -95.3],
      [29.50002, -95.3],
    ]);
    expect(trail.layerGroup.layers).toHaveLength(1);
  });

  it("caps trail distance budget and fades older segments by distance", () => {
    var leaflet = createLeafletStub();
    var trail = createRovTrail({
      leaflet: leaflet,
      maxDistanceMeters: 50,
      minSegmentDistanceMeters: 1,
    });

    trail.addTo({});
    trail.appendPoint({ lat: 29.5, lon: -95.3 });
    trail.appendPoint({ lat: 29.50005, lon: -95.30005 });
    trail.appendPoint({ lat: 29.5001, lon: -95.3001 });
    trail.appendPoint({ lat: 29.50015, lon: -95.30015 });

    expect(trail.getPoints()).toEqual([
      [29.5, -95.3],
      [29.50005, -95.30005],
      [29.5001, -95.3001],
      [29.50015, -95.30015],
    ]);
    expect(trail.layerGroup.layers).toHaveLength(3);
    expect(trail.layerGroup.layers[0].options.color).toBe("#a00000");
    expect(trail.layerGroup.layers[0].options.opacity).toBeGreaterThan(
      trail.layerGroup.layers[1].options.opacity
    );
  });

  it("trims older points once the distance budget is exceeded", () => {
    var leaflet = createLeafletStub();
    var trail = createRovTrail({
      leaflet: leaflet,
      maxPoints: 10,
      maxDistanceMeters: 20,
      minSegmentDistanceMeters: 1,
    });

    trail.addTo({});
    trail.appendPoint({ lat: 29.5, lon: -95.3 });
    trail.appendPoint({ lat: 29.5001, lon: -95.3001 });
    trail.appendPoint({ lat: 29.5002, lon: -95.3002 });
    trail.appendPoint({ lat: 29.5003, lon: -95.3003 });

    expect(trail.getPoints()).toEqual([
      [29.5002, -95.3002],
      [29.5003, -95.3003],
    ]);
    expect(trail.layerGroup.layers).toHaveLength(1);
  });
});