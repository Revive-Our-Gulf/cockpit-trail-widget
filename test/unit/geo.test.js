import { describe, expect, it } from "vitest";
import {
  getBearing,
  getDistance,
  getTrianglePoints,
  offsetLatLon,
} from "../../src/lib/geo.js";

describe("geo utility functions", () => {
  it("calculates an approximately symmetric distance", () => {
    const a = { lat: 29.7604, lon: -95.3698 };
    const b = { lat: 29.7608, lon: -95.3691 };

    const d1 = getDistance(a, b);
    const d2 = getDistance(b, a);

    expect(d1).toBeGreaterThan(0);
    expect(Math.abs(d1 - d2)).toBeLessThan(1e-6);
  });

  it("returns a cardinal bearing close to east", () => {
    const from = { lat: 0, lon: 0 };
    const to = { lat: 0, lon: 1 };

    const bearing = getBearing(from, to);
    expect(bearing).toBeGreaterThan(89);
    expect(bearing).toBeLessThan(91);
  });

  it("offsets heading north by increasing latitude", () => {
    const start = { lat: 0, lon: 0 };
    const moved = offsetLatLon(start.lat, start.lon, 0, 10);

    expect(moved.lat).toBeGreaterThan(start.lat);
    expect(Math.abs(moved.lon - start.lon)).toBeLessThan(1e-8);
  });

  it("returns three points for a triangle icon", () => {
    const points = getTrianglePoints(10, 20, 45);

    expect(points).toHaveLength(3);
    expect(points[0].lat).not.toBeNaN();
    expect(points[0].lon).not.toBeNaN();
  });
});