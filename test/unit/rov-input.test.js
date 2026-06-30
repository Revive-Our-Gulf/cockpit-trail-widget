import { describe, expect, it, vi } from "vitest";
import { createRovInput, ROV_VARIABLES } from "../../src/lib/rov-input.js";

function createCockpitStub(initialData = {}) {
  const values = { ...initialData };
  const listeners = new Map();

  return {
    values,
    listeners,
    listenDataLakeVariable(key, callback) {
      listeners.set(key, callback);
    },
    getDataLakeVariableData(key) {
      return values[key];
    },
  };
}

describe("createRovInput", () => {
  it("reads and normalizes a snapshot from cockpit", () => {
    const cockpit = createCockpitStub({
      [ROV_VARIABLES.LAT]: 295001234,
      [ROV_VARIABLES.LON]: -953001234,
      [ROV_VARIABLES.HDG]: 12345,
    });

    const rovInput = createRovInput(cockpit);

    expect(rovInput.readSnapshot()).toEqual({
      lat: 29.5001234,
      lon: -95.3001234,
      heading: 123.45,
    });
  });

  it("reports unavailable when cockpit API is missing", () => {
    const rovInput = createRovInput({});

    expect(rovInput.isAvailable()).toBe(false);
    expect(rovInput.readSnapshot()).toEqual({
      lat: null,
      lon: null,
      heading: null,
    });
    expect(rovInput.subscribe({})).toBe(false);
  });

  it("subscribes listeners and emits normalized values", async () => {
    const cockpit = createCockpitStub({
      [ROV_VARIABLES.LAT]: 300000000,
      [ROV_VARIABLES.LON]: -940000000,
      [ROV_VARIABLES.HDG]: 9000,
    });
    const onUpdate = vi.fn();
    const rovInput = createRovInput(cockpit);

    expect(rovInput.subscribe({ onUpdate })).toBe(true);

    cockpit.listeners.get(ROV_VARIABLES.LAT)();
    cockpit.listeners.get(ROV_VARIABLES.LON)();
    await Promise.resolve();
    cockpit.listeners.get(ROV_VARIABLES.HDG)();
    await Promise.resolve();

    expect(onUpdate).toHaveBeenNthCalledWith(1, { lat: 30, lon: -94 });
    expect(onUpdate).toHaveBeenNthCalledWith(2, { heading: 90 });
  });

  it("coalesces same-turn updates into one diagonal position emission", async () => {
    const cockpit = createCockpitStub({
      [ROV_VARIABLES.LAT]: 300000000,
      [ROV_VARIABLES.LON]: -940000000,
      [ROV_VARIABLES.HDG]: 4500,
    });
    const onUpdate = vi.fn();
    const rovInput = createRovInput(cockpit);

    rovInput.subscribe({ onUpdate });

    cockpit.values[ROV_VARIABLES.LAT] = 300001000;
    cockpit.listeners.get(ROV_VARIABLES.LAT)();
    cockpit.values[ROV_VARIABLES.LON] = -940001000;
    cockpit.listeners.get(ROV_VARIABLES.LON)();
    cockpit.listeners.get(ROV_VARIABLES.HDG)();
    await Promise.resolve();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({
      lat: 30.0001,
      lon: -94.0001,
      heading: 45,
    });
  });
});