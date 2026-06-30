import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRovMap } from "../../src/lib/rov-map.js";

function createDocumentStub() {
  var elements = new Map();
  elements.set("leaflet-map", { dataset: {} });
  elements.set("center-rov", { onclick: null });

  return {
    elements: elements,
    getElementById(id) {
      return elements.get(id) || null;
    },
  };
}

function createLeafletStub() {
  var markerInner = { style: {} };
  var markerElement = {
    querySelector(selector) {
      if (selector === ".rov-marker__inner") {
        return markerInner;
      }

      return null;
    },
  };

  var map = {
    center: { lat: 0, lng: 0 },
    zoom: 12,
    handlers: {},
    setViewCalls: [],
    on(eventNames, handler) {
      eventNames.split(" ").forEach((eventName) => {
        if (!this.handlers[eventName]) {
          this.handlers[eventName] = [];
        }
        this.handlers[eventName].push(handler);
      });
      return this;
    },
    emit(eventName, payload) {
      (this.handlers[eventName] || []).forEach((handler) => handler(payload));
    },
    getCenter() {
      return this.center;
    },
    getZoom() {
      return this.zoom;
    },
    setView(latLng, zoom) {
      this.center = { lat: latLng[0], lng: latLng[1] };
      this.zoom = zoom;
      this.setViewCalls.push({ latLng: latLng, zoom: zoom });
      return this;
    },
    invalidateSize() {
      this.didInvalidateSize = true;
      return this;
    },
  };

  var leaflet = {
    createdMarkers: [],
    createdPolylines: [],
    layerGroups: [],
    divIcon(options) {
      return options;
    },
    map(id, options) {
      map.id = id;
      map.center = { lat: options.center[0], lng: options.center[1] };
      map.zoom = options.zoom;
      return map;
    },
    marker(latLng, options) {
      var marker = {
        latLng: latLng,
        options: options,
        addTo(targetMap) {
          this.map = targetMap;
          return this;
        },
        setLatLng(nextLatLng) {
          this.latLng = nextLatLng;
          return this;
        },
        getElement() {
          return markerElement;
        },
      };
      this.createdMarkers.push(marker);
      return marker;
    },
    polyline(latLngs, options) {
      var polyline = {
        latLngs: latLngs,
        options: options,
      };
      this.createdPolylines.push(polyline);
      return polyline;
    },
    layerGroup() {
      var group = {
        layers: [],
        addTo(targetMap) {
          this.map = targetMap;
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
      this.layerGroups.push(group);
      return group;
    },
  };

  return {
    leaflet: leaflet,
    map: map,
    markerInner: markerInner,
  };
}

describe("createRovMap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("follows the ROV, rotates the marker, and draws the trail", () => {
    var documentStub = createDocumentStub();
    var leafletStub = createLeafletStub();
    var rovMap = createRovMap({
      leaflet: leafletStub.leaflet,
      document: documentStub,
      mapId: "leaflet-map",
      centerButtonId: "center-rov",
      defaultCenter: [0, 0],
      defaultZoom: 12,
      trailMaxPoints: 4,
    });

    expect(rovMap.init()).toBe(true);

    rovMap.setRovState({ lat: 29.5, lon: -95.3, heading: 45 });
    rovMap.setRovState({ lat: 29.50002, lon: -95.30002, heading: 90 });

    expect(leafletStub.map.setViewCalls).toEqual([
      { latLng: [29.5, -95.3], zoom: 12 },
      { latLng: [29.50002, -95.30002], zoom: 12 },
    ]);
    expect(leafletStub.markerInner.style.transform).toBe("rotate(90deg)");
    expect(leafletStub.leaflet.layerGroups[0].layers).toHaveLength(1);
    expect(
      leafletStub.leaflet.layerGroups[0].layers[0].options.opacity
    ).toBeGreaterThan(0.99);

    vi.runAllTimers();
    expect(leafletStub.map.didInvalidateSize).toBe(true);
  });

  it("stops following after a drag and resumes on center button without changing zoom", () => {
    var documentStub = createDocumentStub();
    var leafletStub = createLeafletStub();
    var rovMap = createRovMap({
      leaflet: leafletStub.leaflet,
      document: documentStub,
      mapId: "leaflet-map",
      centerButtonId: "center-rov",
      defaultCenter: [0, 0],
      defaultZoom: 12,
    });

    rovMap.init();
    rovMap.setRovState({ lat: 29.5, lon: -95.3, heading: 10 });

    leafletStub.map.zoom = 17;
    leafletStub.map.emit("dragstart");
    rovMap.setRovState({ lat: 29.5001, lon: -95.3001 });

    expect(leafletStub.map.setViewCalls).toHaveLength(1);

    documentStub.elements.get("center-rov").onclick();

    expect(leafletStub.map.setViewCalls[1]).toEqual({
      latLng: [29.5001, -95.3001],
      zoom: 17,
    });

    rovMap.setRovState({ lat: 29.5002, lon: -95.3002 });

    expect(leafletStub.map.setViewCalls[2]).toEqual({
      latLng: [29.5002, -95.3002],
      zoom: 17,
    });
  });

  it("keeps following while zooming without dragging", () => {
    var documentStub = createDocumentStub();
    var leafletStub = createLeafletStub();
    var rovMap = createRovMap({
      leaflet: leafletStub.leaflet,
      document: documentStub,
      mapId: "leaflet-map",
      centerButtonId: "center-rov",
      defaultCenter: [0, 0],
      defaultZoom: 12,
    });

    rovMap.init();
    rovMap.setRovState({ lat: 29.5, lon: -95.3, heading: 10 });

    leafletStub.map.zoom = 15;
    leafletStub.map.emit("zoom");
    rovMap.setRovState({ lat: 29.5001, lon: -95.3001 });

    expect(leafletStub.map.setViewCalls[1]).toEqual({
      latLng: [29.5001, -95.3001],
      zoom: 15,
    });
  });
});