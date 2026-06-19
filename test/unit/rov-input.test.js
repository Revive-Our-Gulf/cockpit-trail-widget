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

  it("subscribes listeners and emits normalized values", () => {
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
    cockpit.listeners.get(ROV_VARIABLES.HDG)();

    expect(onUpdate).toHaveBeenNthCalledWith(1, { lat: 30 });
    expect(onUpdate).toHaveBeenNthCalledWith(2, { lon: -94 });
    expect(onUpdate).toHaveBeenNthCalledWith(3, { heading: 90 });
  });
});