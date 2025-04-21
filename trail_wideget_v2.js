// ROV Visualization Module
const ROVMap = (() => {
  // Canvas setup
  const canvas = document.getElementById("mapCanvas");
  const ctx = canvas.getContext("2d");
  const positionDisplay = document.getElementById("currentPos");
  const mapContainer = document.getElementById("mapContainer");

  // Constants
  const CONSTANTS = {
    MIN_DISTANCE: 0.5, // meters
    MAX_TRAIL_POINTS: 100,
    EARTH_RADIUS: 111320, // meters per degree at equator
    BASE_SCALE: 20, // Base scale for metersToPixels
    MIN_SCALE: 0.1,
    MAX_SCALE: 20, // MAXSCALE /
    TARGET_REACHED_THRESHOLD: 1.0, // meters
    ROV_SIZE: 20,
  };

  // Visual settings
  const STYLES = {
    COLORS: {
      ROV: "white",
      TRAIL: "red",
      TARGET: "magenta",
      TARGET_LINE: "magenta",
      DISTANCE_LINE_PRIMARY: "limegreen",
      DISTANCE_LINE_SECONDARY: "grey",
      GRID: "rgba(68, 68, 68, 0.5)",
      NORTH: "#FF4444",
    },
    LINES: {
      TRAIL: 4,
      TARGET: 5,
      TARGET_LINE: 4,
    },
  };

  // MAVLink variables
  const MAVLINK_VARS = {
    LAT: "GLOBAL_POSITION_INT/lat",
    LON: "GLOBAL_POSITION_INT/lon",
    HDG: "GLOBAL_POSITION_INT/hdg",
  };

  // State
  let state = {
    trail: [], // Store absolute lat/lon positions
    firstPoint: null,
    currentHeading: 0,
    currentPosition: { lat: null, lon: null },
    targets: [], // Array to store multiple targets
    activeTargetIndex: -1, // Currently selected target
    scale: 1,
    gridOrigin: { lat: null, lon: null },
    gridOffset: { x: 0, y: 0 },
    lastPosition: { lat: null, lon: null },
  };

  // UI state
  let uiState = {
    initialPinchDistance: 0,
    lastScale: 1,
  };

  // Helper Functions
  const helpers = {
    // Resize canvas to fit container
    resizeCanvas() {
      canvas.width = mapContainer.clientWidth;
      canvas.height = mapContainer.clientHeight;
      render.draw();
    },

    // Convert lat/lon to meters from reference point
    latLonToMeters(lat, lon, refLat, refLon) {
      const latMeters = (lat - refLat) * CONSTANTS.EARTH_RADIUS;
      const lonMeters =
        (lon - refLon) *
        CONSTANTS.EARTH_RADIUS *
        Math.cos((refLat * Math.PI) / 180);
      return { x: lonMeters, y: -latMeters };
    },

    // Convert meters to pixels with scale
    metersToPixels(meters, scaleFactor = CONSTANTS.BASE_SCALE) {
      return meters * scaleFactor;
    },

    // Convert world coordinates to screen coordinates
    worldToScreen(meters) {
      return {
        x: canvas.width / 2 + helpers.metersToPixels(meters.x) * state.scale,
        y: canvas.height / 2 + helpers.metersToPixels(meters.y) * state.scale,
      };
    },

    // Calculate distance between two lat/lon positions
    calculateLatLonDistance(pos1, pos2) {
      const meters = helpers.latLonToMeters(
        pos1.lat,
        pos1.lon,
        pos2.lat,
        pos2.lon
      );
      return Math.sqrt(meters.x * meters.x + meters.y * meters.y);
    },

    // Calculate grid spacing based on current zoom level
    getGridSpacing() {
      const candidateSteps = [
        1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
      ]; // in meters
      const minPixelSpacing = 60; // minimum spacing in pixels
      const effectiveScale = CONSTANTS.BASE_SCALE * state.scale;

      for (let step of candidateSteps) {
        if (step * effectiveScale >= minPixelSpacing) {
          return step;
        }
      }
      return candidateSteps[candidateSteps.length - 1];
    },

    // Set a cookie with name, value and expiration days
    setCookie(name, value, days) {
      const d = new Date();
      d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
      const expires = "expires=" + d.toUTCString();
      document.cookie =
        name + "=" + encodeURIComponent(value) + ";" + expires + ";path=/";
    },

    // Get cookie value by name
    getCookie(name) {
      const cname = name + "=";
      const decodedCookie = decodeURIComponent(document.cookie);
      const ca = decodedCookie.split(";");
      for (let c of ca) {
        while (c.charAt(0) === " ") {
          c = c.substring(1);
        }
        if (c.indexOf(cname) === 0) {
          return c.substring(cname.length, c.length);
        }
      }
      return "";
    },

    drawLine(ctx, startX, startY, endX, endY, style = {}) {
      // Save current context state
      ctx.save();

      // Apply styles
      ctx.strokeStyle = style.color || STYLES.COLORS.TRAIL;
      ctx.lineWidth = style.width || STYLES.LINES.TRAIL;

      // Apply shadow if specified
      if (style.shadow) {
        ctx.shadowColor = style.shadowColor || "rgba(0, 0, 0, 0.5)";
        ctx.shadowBlur = style.shadowBlur || 10;
      }

      // Draw the line
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      // Restore context to previous state
      ctx.restore();
    },
  };

  // Target Management Module
  const targets = {
    // Save targets to cookie
    saveTargets() {
      helpers.setCookie(
        "cockpit-trail-widget-targets",
        JSON.stringify(state.targets),
        365
      );
    },

    // Load targets from cookie
    loadTargets() {
      const cookieVal = helpers.getCookie("cockpit-trail-widget-targets");
      if (cookieVal) {
        try {
          state.targets = JSON.parse(cookieVal);
          // If there are any targets, automatically select the first target
          if (state.targets && state.targets.length > 0) {
            state.activeTargetIndex = 0;
            const container = document.getElementById("addedTargetsContainer");
            container.innerHTML = "";
            state.targets.forEach((target, index) => {
              targets.createTargetEntry(index);
            });
          }
        } catch (e) {
          console.error("Error parsing targets cookie", e);
        }
      }
    },

    createTargetEntry(index) {
      const inputGroup = document.createElement("div");
      inputGroup.className = "target-input-group";
      inputGroup.dataset.index = index;
      inputGroup.innerHTML = `
      <div class="target-entry" style="display: flex; align-items: center;">
        <div class="v-btn v-btn--icon v-theme--dark v-btn--density-compact v-btn--size-small v-btn--variant-text drag-handle mr-2">
          <i class="mdi-drag-vertical mdi v-icon notranslate v-theme--dark v-icon--size-default"></i>
        </div>
        <div class="v-input v-input--horizontal v-input--center-affix v-input--density-compact v-theme--light v-text-field" style="flex-grow: 1;">
          <div class="v-input__control">
            <div class="v-field v-field--active v-field--center-affix v-field--variant-outlined v-theme--light">
              <div class="v-field__overlay"></div>
              <div class="v-field__field" data-no-activator>
                <label class="v-label v-field-label">Target ${index + 1}</label>
                <input type="text" class="v-field__input targetCoords">
              </div>
              <div class="v-field__outline">
                <div class="v-field__outline__start"></div>
                <div class="v-field__outline__notch">
                  <label class="v-label v-field-label v-field-label--floating">Target ${
                    index + 1
                  }</label>
                </div>
                <div class="v-field__outline__end"></div>
              </div>
            </div>
          </div>
        </div>
        <button type="button" class="v-btn v-btn--icon v-theme--dark v-btn--density-compact v-btn--size-default v-btn--variant-text select-target mx-2">
          <i class="mdi-target mdi v-icon notranslate v-theme--dark v-icon--size-default"></i>
        </button>
        <button type="button" class="v-btn v-btn--icon v-theme--dark v-btn--density-compact v-btn--size-default v-btn--variant-text remove-target">
          <i class="mdi-close mdi v-icon notranslate v-theme--dark v-icon--size-default"></i>
        </button>
      </div>
    `;

      // Set initial target coordinates in the input field
      const targetInput = inputGroup.querySelector(".targetCoords");
      targetInput.value = `${state.targets[index].lat}, ${state.targets[index].lon}`;

      // Allow user to update target on Enter key press
      targetInput.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
          const value = targetInput.value;
          const coords = value.split(",");
          if (coords.length !== 2) {
            console.log("Invalid coordinate format. Use lat,lon");
            return;
          }
          const lat = parseFloat(coords[0].trim());
          const lon = parseFloat(coords[1].trim());
          if (isNaN(lat) || isNaN(lon)) {
            console.log("Invalid coordinates");
            return;
          }
          // Update the underlying targets array
          state.targets[index] = { lat, lon };
          targetInput.value = `${lat}, ${lon}`;
          render.draw();
          targets.saveTargets();
        }
      });

      document.getElementById("addedTargetsContainer").appendChild(inputGroup);
      targets.setupTargetEntryListeners(inputGroup, index);

      // Apply drag functionality to this element immediately after creation
      targets.setupDragForElement(inputGroup);
    },

    setupDragAndDrop() {
      // We'll use a mutation observer to detect when new target entries are added
      const targetContainer = document.getElementById("addedTargetsContainer");

      const observer = new MutationObserver((mutations) => {
        for (let mutation of mutations) {
          if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
            mutation.addedNodes.forEach((node) => {
              if (
                node.classList &&
                node.classList.contains("target-input-group")
              ) {
                this.setupDragForElement(node);
              }
            });
          }
        }
      });

      observer.observe(targetContainer, { childList: true });
    },

    // Set up drag for a specific target element
    setupDragForElement(element) {
      const dragHandle = element.querySelector(".drag-handle");
      if (!dragHandle) return;

      dragHandle.style.cursor = "grab";

      let draggedElement = null;
      let startY = 0;
      let startIndex = 0;

      // Use a named function for the event handler so we can remove it properly
      const handleMouseMove = (e) => {
        if (!draggedElement) return;

        const container = document.getElementById("addedTargetsContainer");
        const children = Array.from(container.children);

        // Calculate position
        const currentY = e.clientY;

        // Find the target element to swap with
        const targetElements = children.filter((el) => el !== draggedElement);
        let swapWith = null;

        targetElements.forEach((el) => {
          const box = el.getBoundingClientRect();
          const centerY = box.top + box.height / 2;

          if (currentY < centerY && currentY > box.top) {
            swapWith = el;
          } else if (currentY > centerY && currentY < box.bottom) {
            swapWith = el;
          }
        });

        // Perform the swap if needed
        if (swapWith) {
          const newIndex = parseInt(swapWith.dataset.index);

          // Update the targets array
          [state.targets[startIndex], state.targets[newIndex]] = [
            state.targets[newIndex],
            state.targets[startIndex],
          ];

          // Update the DOM by reinitializing targets
          targets.compactTargets();
          targets.saveTargets();

          // Update the current dragged element reference and start position
          draggedElement = document.querySelector(
            `.target-input-group[data-index="${newIndex}"]`
          );
          draggedElement.classList.add("target-dragging");
          startIndex = newIndex;
          startY = currentY;
        }
      };

      const handleMouseUp = () => {
        if (!draggedElement) return;

        draggedElement.classList.remove("target-dragging");
        draggedElement = null;
        document.body.style.cursor = "";

        // Remove listeners
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);

        render.draw();
      };

      // Clear any existing event listeners before adding new ones
      const newDragHandle = dragHandle.cloneNode(true);
      dragHandle.parentNode.replaceChild(newDragHandle, dragHandle);

      // Add mousedown event to the new drag handle
      newDragHandle.addEventListener("mousedown", (e) => {
        draggedElement = element;
        startY = e.clientY;
        startIndex = parseInt(element.dataset.index);

        document.body.style.cursor = "grabbing";

        // Add dragging class for styling
        element.classList.add("target-dragging");

        // Listen for mouse movements
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);

        e.preventDefault(); // Prevent text selection
      });
    },

    // Set up event listeners for target entries
    setupTargetEntryListeners(inputGroup, index) {
      const selectBtn = inputGroup.querySelector(".select-target");
      const removeBtn = inputGroup.querySelector(".remove-target");

      selectBtn.addEventListener("click", () => {
        state.activeTargetIndex = index;
        render.draw();
      });

      removeBtn.addEventListener("click", () => {
        state.targets.splice(index, 1);
        targets.compactTargets();
        render.draw();
        targets.saveTargets();
      });
    },

    // Clean up targets list and rebuild UI
    compactTargets() {
      state.targets = state.targets.filter((target) => target !== null);

      const container = document.getElementById("addedTargetsContainer");
      container.innerHTML = "";

      state.targets.forEach((target, index) => {
        targets.createTargetEntry(index);
        const targetSpan = container.querySelector(
          `.target-input-group[data-index="${index}"] .targetCoords`
        );
        if (targetSpan) {
          targetSpan.textContent = `${target.lat}, ${target.lon}`;
        }
      });

      if (state.activeTargetIndex !== -1) {
        state.activeTargetIndex = state.targets.findIndex(
          (target, i) => i === state.activeTargetIndex
        );
      }
    },

    // Set up the new target input field
    setupNewTargetInput() {
      const newTargetGroup = document.getElementById("newTargetInput");
      const input = newTargetGroup.querySelector(".newTargetCoords");
      const addBtn = newTargetGroup.querySelector(".add-new-target");

      const submitNewTarget = () => {
        const value = input.value;
        const coords = value.split(",");
        if (coords.length !== 2) {
          console.log("Invalid coordinate format. Use lat,lon");
          return;
        }
        const lat = parseFloat(coords[0].trim());
        const lon = parseFloat(coords[1].trim());
        if (isNaN(lat) || isNaN(lon)) {
          console.log("Invalid coordinates");
          return;
        }
        const newIndex = state.targets.length;
        state.targets.push({ lat, lon });
        targets.createTargetEntry(newIndex);
        state.activeTargetIndex = newIndex;
        render.draw();
        input.value = "";
        targets.saveTargets();
      };

      addBtn.addEventListener("click", submitNewTarget);
      input.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submitNewTarget();
        }
      });
    },

    addDragStyles() {
      const style = document.createElement("style");
      style.textContent = `
        .target-dragging {
          opacity: 0.8;
          background-color: rgba(0, 0, 0, 0.1);
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
          position: relative;
          z-index: 1000;
          transition: transform 0.1s;
        }
        .drag-handle {
          cursor: grab;
        }
        .drag-handle:active {
          cursor: grabbing;
        }
      `;
      document.head.appendChild(style);
    },
  };

  // Rendering Module
  const render = {
    // Main drawing function
    draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      this.drawGrid();
      this.drawTrailPath();
      this.drawTargets();
      this.drawROV();

      this.drawScaleIndicator();
    },

    // Draw the ROV icon
    drawROV() {
      // Always draw the ROV at the center of the canvas pointing up
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);

      ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
      ctx.shadowBlur = 30;

      // Draw arrow shape
      ctx.beginPath();
      ctx.moveTo(0, -CONSTANTS.ROV_SIZE);
      ctx.lineTo(CONSTANTS.ROV_SIZE, CONSTANTS.ROV_SIZE);
      ctx.lineTo(0, CONSTANTS.ROV_SIZE / 2);
      ctx.lineTo(-CONSTANTS.ROV_SIZE, CONSTANTS.ROV_SIZE);
      ctx.closePath();
      ctx.fillStyle = STYLES.COLORS.ROV;
      ctx.fill();

      // Draw direction line
      helpers.drawLine(ctx, 0, -10, 0, -60, {
        color: "grey",
        width: 3,
      });

      // Improved North indicator
      const northAngle = -state.currentHeading * (Math.PI / 180);
      const northLength = 55;

      // Draw North line with arrow
      const northX = Math.sin(northAngle) * northLength;
      const northY = -Math.cos(northAngle) * northLength;

      // Main north line
      helpers.drawLine(ctx, 0, 0, northX, northY, {
        color: STYLES.COLORS.NORTH,
        width: 3.5,
        shadow: true,
        shadowColor: "rgba(255, 0, 0, 0.4)",
        shadowBlur: 8,
      });

      // Add correctly oriented arrowhead to north line
      const arrowLength = 10;
      const arrowWidth = 12;

      // Calculate arrow points
      ctx.beginPath();
      ctx.fillStyle = STYLES.COLORS.NORTH;

      // Arrow tip is at the end of the north line
      ctx.moveTo(northX, northY);

      // Calculate the base points of the arrowhead
      // We need to go back along the line by arrowLength
      const baseX = northX - Math.sin(northAngle) * arrowLength;
      const baseY = northY + Math.cos(northAngle) * arrowLength;

      // Then offset perpendicular to the line by +/- arrowWidth/2
      const perpAngle = northAngle + Math.PI / 2;
      const offsetX = (Math.sin(perpAngle) * arrowWidth) / 2;
      const offsetY = (-Math.cos(perpAngle) * arrowWidth) / 2;

      // Draw the two base points of the arrow
      ctx.lineTo(baseX + offsetX, baseY + offsetY);
      ctx.lineTo(baseX - offsetX, baseY - offsetY);

      // Complete the triangle
      ctx.closePath();
      ctx.fill();

      // Add N letter at the end of the line (properly centered)
      ctx.fillStyle = STYLES.COLORS.NORTH;
      ctx.font = "bold 16px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Calculate position for the N label
      // We want it slightly beyond the arrowhead
      const labelDistance = northLength + 10; // 10px beyond arrow tip
      const labelX = Math.sin(northAngle) * labelDistance;
      const labelY = -Math.cos(northAngle) * labelDistance;

      ctx.fillText("N", labelX, labelY);

      ctx.restore();
    },

    // Draw the trail behind the ROV
    drawTrailPath() {
      if (
        !state.currentPosition.lat ||
        !state.currentPosition.lon ||
        state.trail.length < 2
      )
        return;

      ctx.save();
      // Apply the inverse rotation for the world
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(-state.currentHeading * (Math.PI / 180));
      ctx.translate(-canvas.width / 2, -canvas.height / 2);

      // Draw the trail as connected segments
      for (let i = 1; i < state.trail.length; i++) {
        const prevPoint = state.trail[i - 1];
        const currentPoint = state.trail[i];

        const prevPixels = helpers.metersToPixels(
          helpers.latLonToMeters(
            prevPoint.lat,
            prevPoint.lon,
            state.currentPosition.lat,
            state.currentPosition.lon
          )
        );

        const currentPixels = helpers.metersToPixels(
          helpers.latLonToMeters(
            currentPoint.lat,
            currentPoint.lon,
            state.currentPosition.lat,
            state.currentPosition.lon
          )
        );

        helpers.drawLine(
          ctx,
          canvas.width / 2 + prevPixels.x,
          canvas.height / 2 + prevPixels.y,
          canvas.width / 2 + currentPixels.x,
          canvas.height / 2 + currentPixels.y,
          {
            color: STYLES.COLORS.TRAIL,
            width: STYLES.LINES.TRAIL,
            shadow: true,
          }
        );
      }

      ctx.restore();
    },

    // Draw targets and their connections
    drawTargets() {
      if (
        !state.firstPoint ||
        !state.targets.length ||
        !state.currentPosition.lat ||
        !state.currentPosition.lon
      )
        return;

      this._drawTargetConnections();
      this._drawActiveTargetLine();
      this._drawPreviousTargetLine();
      this._drawTargetMarkers();
    },

    // Add this to the render object
    _drawLineWithTextGap(start, end, textPosition, style = {}) {
      // Calculate vector from start to end
      const dx = end.x - start.x;
      const dy = end.y - start.y;

      // Calculate distance to text position along the line
      const textDist = Math.sqrt(
        Math.pow(textPosition.x - start.x, 2) +
          Math.pow(textPosition.y - start.y, 2)
      );

      // Calculate total line length
      const totalDist = Math.sqrt(dx * dx + dy * dy);

      // Calculate normalized direction vector
      const dirX = dx / totalDist;
      const dirY = dy / totalDist;

      // Define gap size around text (adjust as needed)
      const gapSize = 25; // pixels on each side of text position

      // Calculate gap start and end positions
      const gapStart = {
        x: textPosition.x - gapSize * dirX,
        y: textPosition.y - gapSize * dirY,
      };

      const gapEnd = {
        x: textPosition.x + gapSize * dirX,
        y: textPosition.y + gapSize * dirY,
      };

      // Set up style for drawing
      ctx.beginPath();
      if (style.dashed) {
        ctx.setLineDash(style.dashed);
      } else {
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = style.color || STYLES.COLORS.DISTANCE_LINE_PRIMARY;
      ctx.lineWidth = style.width || STYLES.LINES.TARGET_LINE;

      // Draw first segment (start to gap)
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(gapStart.x, gapStart.y);
      ctx.stroke();

      // Draw second segment (gap to end)
      ctx.beginPath();
      ctx.moveTo(gapEnd.x, gapEnd.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      // Reset dash setting
      ctx.setLineDash([]);
    },

    // Draw lines connecting consecutive targets
    _drawTargetConnections() {
      ctx.beginPath();
      ctx.strokeStyle = "#999999";
      ctx.lineWidth = STYLES.LINES.TARGET_LINE;

      state.targets.forEach((target, index) => {
        if (!target) return;
        const targetMeters = helpers.latLonToMeters(
          target.lat,
          target.lon,
          state.firstPoint.lat,
          state.firstPoint.lon
        );
        const targetPixels = helpers.worldToScreen(targetMeters);

        if (index > 0 && state.targets[index - 1]) {
          const prevMeters = helpers.latLonToMeters(
            state.targets[index - 1].lat,
            state.targets[index - 1].lon,
            state.firstPoint.lat,
            state.firstPoint.lon
          );
          const prevPixels = helpers.worldToScreen(prevMeters);

          helpers.drawLine(
            ctx,
            prevPixels.x,
            prevPixels.y,
            targetPixels.x,
            targetPixels.y,
            {
              color: STYLES.COLORS.TARGET_LINE,
              width: STYLES.LINES.TARGET_LINE,
            }
          );
        }
      });
    },

    _drawActiveTargetLine() {
      if (
        state.activeTargetIndex === -1 ||
        !state.targets[state.activeTargetIndex]
      )
        return;

      const target = state.targets[state.activeTargetIndex];
      const targetMeters = helpers.latLonToMeters(
        target.lat,
        target.lon,
        state.firstPoint.lat,
        state.firstPoint.lon
      );
      const targetPixels = helpers.worldToScreen(targetMeters);

      const currentPixels = {
        x: canvas.width / 2,
        y: canvas.height / 2,
      };

      const { lineEndPoint, textPosition } = this._calculateLineEndpoints(
        currentPixels,
        targetPixels
      );

      // Draw line with gap for text
      this._drawLineWithTextGap(currentPixels, lineEndPoint, textPosition, {
        color: STYLES.COLORS.DISTANCE_LINE_PRIMARY,
        width: STYLES.LINES.TARGET_LINE,
        dashed: [5, 5],
      });

      // Display distance
      const distanceMeters = helpers.calculateLatLonDistance(
        state.currentPosition,
        target
      );
      this._drawDistanceLabel(
        textPosition,
        distanceMeters,
        STYLES.COLORS.DISTANCE_LINE_PRIMARY
      );
    },

    _drawPreviousTargetLine() {
      // Check if we have targets and a current position
      if (
        !state.targets.length ||
        !state.currentPosition.lat ||
        !state.currentPosition.lon ||
        state.activeTargetIndex === -1
      ) {
        return;
      }

      // Get index of previous target (wrap around to end of array if at first target)
      const prevIndex =
        (state.activeTargetIndex - 1 + state.targets.length) %
        state.targets.length;

      // Skip if there's only one target
      if (prevIndex === state.activeTargetIndex) return;

      const prevTarget = state.targets[prevIndex];
      const targetMeters = helpers.latLonToMeters(
        prevTarget.lat,
        prevTarget.lon,
        state.firstPoint.lat,
        state.firstPoint.lon
      );
      const targetPixels = helpers.worldToScreen(targetMeters);

      const currentPixels = {
        x: canvas.width / 2,
        y: canvas.height / 2,
      };

      const { lineEndPoint, textPosition } = this._calculateLineEndpoints(
        currentPixels,
        targetPixels
      );

      // Draw line with gap for text
      this._drawLineWithTextGap(currentPixels, lineEndPoint, textPosition, {
        color: STYLES.COLORS.DISTANCE_LINE_SECONDARY,
        width: STYLES.LINES.TARGET_LINE,
        dashed: [5, 5],
      });

      // Calculate and display distance
      const distanceMeters = helpers.calculateLatLonDistance(
        state.currentPosition,
        prevTarget
      );

      this._drawDistanceLabel(
        textPosition,
        distanceMeters,
        STYLES.COLORS.DISTANCE_LINE_SECONDARY
      );
    },

    // Calculate line endpoints for target lines
    _calculateLineEndpoints(start, end) {
      let lineEndPoint = { x: end.x, y: end.y };
      let textPosition = {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      };

      // Check if target is outside canvas
      const isTargetOffScreen =
        end.x < 0 || end.x > canvas.width || end.y < 0 || end.y > canvas.height;

      if (isTargetOffScreen) {
        // Calculate direction vector
        const dx = end.x - start.x;
        const dy = end.y - start.y;

        const intersections = [];

        // Check top edge (y = 0)
        if (dy < 0) {
          const t = -start.y / dy;
          const x = start.x + t * dx;
          if (x >= 0 && x <= canvas.width) {
            intersections.push({ x, y: 0, dist: t });
          }
        }

        // Check bottom edge (y = canvas.height)
        if (dy > 0) {
          const t = (canvas.height - start.y) / dy;
          const x = start.x + t * dx;
          if (x >= 0 && x <= canvas.width) {
            intersections.push({ x, y: canvas.height, dist: t });
          }
        }

        // Check left edge (x = 0)
        if (dx < 0) {
          const t = -start.x / dx;
          const y = start.y + t * dy;
          if (y >= 0 && y <= canvas.height) {
            intersections.push({ x: 0, y, dist: t });
          }
        }

        // Check right edge (x = canvas.width)
        if (dx > 0) {
          const t = (canvas.width - start.x) / dx;
          const y = start.y + t * dy;
          if (y >= 0 && y <= canvas.height) {
            intersections.push({ x: canvas.width, y, dist: t });
          }
        }

        // Find closest intersection
        if (intersections.length > 0) {
          intersections.sort((a, b) => a.dist - b.dist);
          lineEndPoint = { x: intersections[0].x, y: intersections[0].y };
          textPosition = {
            x: (start.x + lineEndPoint.x) / 2,
            y: (start.y + lineEndPoint.y) / 2,
          };
        }
      }

      return { lineEndPoint, textPosition };
    },

    // Draw distance label with background
    _drawDistanceLabel(position, distanceMeters, textColour) {
      const distanceText = distanceMeters.toFixed(0) + " m";

      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Draw text
      ctx.fillStyle = textColour;
      ctx.fillText(distanceText, position.x, position.y);
    },

    // Draw target X markers
    _drawTargetMarkers() {
      state.targets.forEach((target, index) => {
        if (!target) return;
        const targetMeters = helpers.latLonToMeters(
          target.lat,
          target.lon,
          state.firstPoint.lat,
          state.firstPoint.lon
        );
        const targetPixels = helpers.worldToScreen(targetMeters);

        // Only draw visible targets
        if (
          targetPixels.x >= -20 &&
          targetPixels.x <= canvas.width + 20 &&
          targetPixels.y >= -20 &&
          targetPixels.y <= canvas.height + 20
        ) {
          const size = 12;
          const color =
            index === state.activeTargetIndex
              ? STYLES.COLORS.TARGET
              : "#999999";
          helpers.drawLine(
            ctx,
            targetPixels.x - size,
            targetPixels.y - size,
            targetPixels.x + size,
            targetPixels.y + size,
            {
              color: color,
              width: STYLES.LINES.TARGET,
            }
          );
          helpers.drawLine(
            ctx,
            targetPixels.x + size,
            targetPixels.y - size,
            targetPixels.x - size,
            targetPixels.y + size,
            {
              color: color,
              width: STYLES.LINES.TARGET,
            }
          );
        }
      });
    },

    // Draw grid lines
    drawGrid() {
      if (!state.currentPosition.lat || !state.currentPosition.lon) return;

      ctx.save();
      // Apply the inverse rotation for the world
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(-state.currentHeading * (Math.PI / 180));
      ctx.translate(-canvas.width / 2, -canvas.height / 2);

      const gridSpacing = helpers.getGridSpacing();
      const effectiveMultiplier = CONSTANTS.BASE_SCALE * state.scale;

      // Calculate grid boundaries
      const leftMeters = -(canvas.width / 2) / effectiveMultiplier;
      const rightMeters = canvas.width / 2 / effectiveMultiplier;
      const topMeters = -(canvas.height / 2) / effectiveMultiplier;
      const bottomMeters = canvas.height / 2 / effectiveMultiplier;

      // Apply grid offset from ROV movement
      const offsetX = state.gridOffset.x % gridSpacing;
      const offsetY = state.gridOffset.y % gridSpacing;

      ctx.beginPath();
      ctx.strokeStyle = STYLES.COLORS.GRID;
      ctx.lineWidth = 1;

      // Draw vertical grid lines
      const startX =
        Math.floor(leftMeters / gridSpacing) * gridSpacing - offsetX;
      const endX = Math.ceil(rightMeters / gridSpacing) * gridSpacing - offsetX;
      for (let x = startX; x <= endX; x += gridSpacing) {
        const startPoint = helpers.worldToScreen({ x, y: topMeters });
        const endPoint = helpers.worldToScreen({ x, y: bottomMeters });
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(endPoint.x, endPoint.y);
      }

      // Draw horizontal grid lines
      const startY =
        Math.floor(topMeters / gridSpacing) * gridSpacing - offsetY;
      const endY =
        Math.ceil(bottomMeters / gridSpacing) * gridSpacing - offsetY;
      for (let y = startY; y <= endY; y += gridSpacing) {
        const startPoint = helpers.worldToScreen({ x: leftMeters, y });
        const endPoint = helpers.worldToScreen({ x: rightMeters, y });
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(endPoint.x, endPoint.y);
      }

      ctx.stroke();
      ctx.restore();
    },

    // Draw scale indicator
    drawScaleIndicator() {
      const gridSpacing = helpers.getGridSpacing();
      const formattedValue =
        gridSpacing >= 1000
          ? (gridSpacing / 1000).toFixed(1) + " km"
          : gridSpacing.toFixed(0) + " m";

      // Position in bottom left corner with padding
      const padding = 20;
      const x = padding;
      const y = canvas.height - padding;

      // Draw text
      ctx.save();
      ctx.font = "bold 20px Arial";

      // Use the same color as the grid
      ctx.fillStyle = "white";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(formattedValue, x, y - 8);
      ctx.restore();
    },
  };

  // MAVLink Data Handling Module
  const mavlink = {
    // Handle latitude updates
    handleLatitude() {
      const lat =
        window.cockpit.getDataLakeVariableData(MAVLINK_VARS.LAT) / 1e7;
      if (lat === undefined) return;

      state.currentPosition.lat = lat;
      mavlink.updatePosition();
    },

    // Handle longitude updates
    handleLongitude() {
      const lon =
        window.cockpit.getDataLakeVariableData(MAVLINK_VARS.LON) / 1e7;
      if (lon === undefined) return;

      state.currentPosition.lon = lon;
      mavlink.updatePosition();
    },

    // Handle heading updates
    handleHeading() {
      const heading =
        window.cockpit.getDataLakeVariableData(MAVLINK_VARS.HDG) / 100;
      if (heading === undefined) return;

      state.currentHeading = heading;
      render.draw();
    },

    // Update position and trail
    updatePosition() {
      if (!state.currentPosition.lat || !state.currentPosition.lon) return;

      const { lat, lon } = state.currentPosition;

      // Initialize grid origin if not set
      if (!state.gridOrigin.lat) {
        state.gridOrigin.lat = lat;
        state.gridOrigin.lon = lon;
      }

      // Update grid offset based on ROV movement
      if (state.lastPosition.lat !== null) {
        const movement = helpers.latLonToMeters(
          lat,
          lon,
          state.lastPosition.lat,
          state.lastPosition.lon
        );
        state.gridOffset.x += movement.x;
        state.gridOffset.y += movement.y;
      }

      // Update reference position
      state.lastPosition.lat = lat;
      state.lastPosition.lon = lon;

      // Initialize first point if needed
      if (!state.firstPoint) {
        state.firstPoint = { lat, lon };
      }

      // Add to trail if minimum distance is met
      if (
        state.trail.length === 0 ||
        helpers.calculateLatLonDistance(
          { lat, lon },
          state.trail[state.trail.length - 1]
        ) >= CONSTANTS.MIN_DISTANCE
      ) {
        state.trail.push({ lat, lon });
        if (state.trail.length > CONSTANTS.MAX_TRAIL_POINTS)
          state.trail.shift();
      }

      // Update position display
      positionDisplay.innerText = `ROV: ${lat.toFixed(7)}°, ${lon.toFixed(7)}°`;

      // Check if we've reached the current target
      this.checkTargetProximity();

      render.draw();
    },

    checkTargetProximity() {
      // Only check if we have an active target and position data
      if (
        state.activeTargetIndex === -1 ||
        !state.targets.length ||
        !state.currentPosition.lat ||
        !state.currentPosition.lon
      ) {
        return;
      }

      const currentTarget = state.targets[state.activeTargetIndex];
      const distanceToTarget = helpers.calculateLatLonDistance(
        state.currentPosition,
        currentTarget
      );

      // If within threshold distance, move to next target
      if (distanceToTarget <= CONSTANTS.TARGET_REACHED_THRESHOLD) {
        console.log(
          `Target ${
            state.activeTargetIndex + 1
          } reached! Distance: ${distanceToTarget.toFixed(2)}m`
        );

        // Go to next target, loop back to beginning if at end
        state.activeTargetIndex =
          (state.activeTargetIndex + 1) % state.targets.length;
        console.log(`Moving to target ${state.activeTargetIndex + 1}`);

        render.draw();
      }
    },

    // Set up mavlink listeners
    setupListeners() {
      window.cockpit.listenDataLakeVariable(
        MAVLINK_VARS.LAT,
        this.handleLatitude
      );
      window.cockpit.listenDataLakeVariable(
        MAVLINK_VARS.LON,
        this.handleLongitude
      );
      window.cockpit.listenDataLakeVariable(
        MAVLINK_VARS.HDG,
        this.handleHeading
      );
    },
  };

  // UI Event Handlers
  const events = {
    // Handle wheel events for zooming
    handleWheel(e) {
      e.preventDefault();
      const zoomFactor = 1.1;

      // Adjust scale
      if (e.deltaY < 0) {
        state.scale *= zoomFactor;
      } else {
        state.scale /= zoomFactor;
      }

      // Apply scale limits
      state.scale = Math.max(
        CONSTANTS.MIN_SCALE,
        Math.min(state.scale, CONSTANTS.MAX_SCALE)
      );
      render.draw();
    },

    // Handle touch start for pinch zooming
    handleTouchStart(e) {
      if (e.touches.length === 2) {
        // Calculate initial touch distance
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        uiState.initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
        uiState.lastScale = state.scale;
      }
    },

    // Handle touch move for pinch zooming
    handleTouchMove(e) {
      if (e.touches.length === 2) {
        e.preventDefault();

        // Calculate pinch distance
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const pinchDistance = Math.sqrt(dx * dx + dy * dy);

        // Calculate new scale
        const scaleFactor = pinchDistance / uiState.initialPinchDistance;
        state.scale = uiState.lastScale * scaleFactor;

        // Apply scale limits
        state.scale = Math.max(
          CONSTANTS.MIN_SCALE,
          Math.min(state.scale, CONSTANTS.MAX_SCALE)
        );

        render.draw();
      }
    },

    // Handle double click to reset grid
    handleDoubleClick() {
      state.gridOffset = { x: 0, y: 0 };
      if (state.currentPosition.lat) {
        state.gridOrigin.lat = state.currentPosition.lat;
        state.gridOrigin.lon = state.currentPosition.lon;
      }
      render.draw();
    },

    // Handle target container toggle
    handleToggleTargetContainer() {
      const targetContainer = document.getElementById("targetContainer");
      const chevronIcon = document.getElementById("targetChevron");

      if (targetContainer.style.display === "none") {
        targetContainer.style.display = "block";
        chevronIcon.className =
          "mdi mdi-chevron-up v-icon notranslate v-theme--dark v-icon--size-default";
      } else {
        targetContainer.style.display = "none";
        chevronIcon.className =
          "mdi mdi-chevron-down v-icon notranslate v-theme--dark v-icon--size-default";
      }

      helpers.resizeCanvas();
    },

    // Set up all event listeners
    setupEventListeners() {
      // Resize handling
      window.addEventListener("resize", helpers.resizeCanvas);

      // Zooming with mousewheel
      canvas.addEventListener("wheel", this.handleWheel);

      // Touch events for pinch zoom
      canvas.addEventListener("touchstart", this.handleTouchStart);
      canvas.addEventListener("touchmove", this.handleTouchMove);

      // Double click to reset grid
      canvas.addEventListener("dblclick", this.handleDoubleClick);

      const targetContainer = document.getElementById("targetContainer");
      const chevronIcon = document.getElementById("targetChevron");

      targetContainer.style.display = "none";
      chevronIcon.className = "mdi mdi-chevron-down v-icon notranslate v-theme--dark v-icon--size-default";

      document
        .getElementById("toggleTargetContainer")
        .addEventListener("click", this.handleToggleTargetContainer);

      // Clear trail button if it exists
      const clearTrailBtn = document.getElementById("clearTrail");
      if (clearTrailBtn) {
        clearTrailBtn.addEventListener("click", () => {
          state.trail = [];
          render.draw();
        });
      }
    },
  };

  const gpxImport = {
    // Parse GPX or KML file and extract waypoints
    parseFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
          const fileContent = e.target.result;
          const fileExtension = file.name.split(".").pop().toLowerCase();

          try {
            if (fileExtension === "gpx") {
              resolve(this.parseGPX(fileContent));
            } else if (fileExtension === "kml") {
              resolve(this.parseKML(fileContent));
            } else if (fileExtension === "kmz") {
              this.extractKMZ(fileContent)
                .then((kmlContent) => resolve(this.parseKML(kmlContent)))
                .catch(reject);
            } else {
              reject(new Error("Unsupported file format"));
            }
          } catch (error) {
            reject(error);
          }
        };

        reader.onerror = () => {
          reject(new Error("Error reading file"));
        };

        reader.readAsText(file);
      });
    },

    // Parse GPX content
    parseGPX(gpxText) {
      const parser = new DOMParser();
      const gpxDoc = parser.parseFromString(gpxText, "text/xml");

      // Check if parsing was successful
      if (gpxDoc.documentElement.nodeName === "parsererror") {
        throw new Error("Invalid GPX file");
      }

      const waypoints = [];

      // Extract waypoints (wpt elements)
      const wptNodes = gpxDoc.getElementsByTagName("wpt");
      for (let i = 0; i < wptNodes.length; i++) {
        const wpt = wptNodes[i];
        const lat = parseFloat(wpt.getAttribute("lat"));
        const lon = parseFloat(wpt.getAttribute("lon"));

        if (!isNaN(lat) && !isNaN(lon)) {
          let name = "";
          const nameNode = wpt.getElementsByTagName("name")[0];
          if (nameNode && nameNode.textContent) {
            name = nameNode.textContent;
          }

          waypoints.push({ lat, lon, name });
        }
      }

      // Extract track points (trkpt elements) if no waypoints found
      if (waypoints.length === 0) {
        const trkptNodes = gpxDoc.getElementsByTagName("trkpt");
        for (let i = 0; i < trkptNodes.length; i++) {
          const trkpt = trkptNodes[i];
          const lat = parseFloat(trkpt.getAttribute("lat"));
          const lon = parseFloat(trkpt.getAttribute("lon"));

          if (!isNaN(lat) && !isNaN(lon)) {
            waypoints.push({ lat, lon });
          }
        }
      }

      // Extract route points (rtept elements) if still no points found
      if (waypoints.length === 0) {
        const rteptNodes = gpxDoc.getElementsByTagName("rtept");
        for (let i = 0; i < rteptNodes.length; i++) {
          const rtept = rteptNodes[i];
          const lat = parseFloat(rtept.getAttribute("lat"));
          const lon = parseFloat(rtept.getAttribute("lon"));

          if (!isNaN(lat) && !isNaN(lon)) {
            waypoints.push({ lat, lon });
          }
        }
      }

      return waypoints;
    },

    // Parse KML content
    parseKML(kmlText) {
      const parser = new DOMParser();
      const kmlDoc = parser.parseFromString(kmlText, "text/xml");

      // Check if parsing was successful
      if (kmlDoc.documentElement.nodeName === "parsererror") {
        throw new Error("Invalid KML file");
      }

      const waypoints = [];

      // Extract Placemarks
      const placemarks = kmlDoc.getElementsByTagName("Placemark");
      for (let i = 0; i < placemarks.length; i++) {
        const placemark = placemarks[i];

        // Get name if available
        let name = "";
        const nameNode = placemark.getElementsByTagName("name")[0];
        if (nameNode && nameNode.textContent) {
          name = nameNode.textContent;
        }

        // Check for Point coordinates
        const points = placemark.getElementsByTagName("Point");
        if (points.length > 0) {
          const coordsNode = points[0].getElementsByTagName("coordinates")[0];
          if (coordsNode && coordsNode.textContent) {
            const coordStr = coordsNode.textContent.trim();
            const coords = coordStr.split(",");

            if (coords.length >= 2) {
              const lon = parseFloat(coords[0]);
              const lat = parseFloat(coords[1]);

              if (!isNaN(lat) && !isNaN(lon)) {
                waypoints.push({ lat, lon, name });
              }
            }
          }
          continue; // Skip to next placemark if we found a point
        }

        // Check for LineString or LinearRing coordinates
        const lineTypes = ["LineString", "LinearRing"];
        for (const lineType of lineTypes) {
          const lines = placemark.getElementsByTagName(lineType);
          if (lines.length > 0) {
            const coordsNode = lines[0].getElementsByTagName("coordinates")[0];
            if (coordsNode && coordsNode.textContent) {
              const coordsText = coordsNode.textContent.trim();
              const coordPairs = coordsText.split(/\s+/); // Split by whitespace

              coordPairs.forEach((pair) => {
                const coords = pair.split(",");
                if (coords.length >= 2) {
                  const lon = parseFloat(coords[0]);
                  const lat = parseFloat(coords[1]);

                  if (!isNaN(lat) && !isNaN(lon)) {
                    waypoints.push({ lat, lon });
                  }
                }
              });
            }
          }
        }
      }

      return waypoints;
    },

    // Placeholder for KMZ extraction (would need JSZip library for full implementation)
    extractKMZ(kmzContent) {
      return Promise.reject(
        new Error("KMZ files are not supported yet. Convert to KML first.")
      );
    },

    // Add waypoints as targets to the map
    addWaypointsAsTargets(waypoints) {
      if (!waypoints || waypoints.length === 0) return;

      state.targets = [];
      document.getElementById("addedTargetsContainer").innerHTML = "";

      // Add waypoints as targets
      waypoints.forEach((waypoint) => {
        const newIndex = state.targets.length;
        state.targets.push({ lat: waypoint.lat, lon: waypoint.lon });

        // Create UI entry for target
        targets.createTargetEntry(newIndex);
      });

      // Set the first imported waypoint as active
      state.activeTargetIndex = state.targets.length - waypoints.length;

      // Save targets and redraw
      targets.saveTargets();
      render.draw();
    },

    // Setup event listeners for file import
    setupGPXImport() {
      const importBtn = document.getElementById("importGpx");
      const fileInput = document.getElementById("gpxFileInput");

      if (fileInput) {
        // Update to accept KML files too
        fileInput.accept = ".gpx,.kml,.kmz";
      }

      if (importBtn && fileInput) {
        importBtn.addEventListener("click", () => {
          fileInput.click();
        });

        fileInput.addEventListener("change", async (event) => {
          if (event.target.files.length === 0) return;

          const file = event.target.files[0];
          try {
            const waypoints = await this.parseFile(file);
            console.log(
              `Imported ${waypoints.length} waypoints from ${file.name}`
            );

            if (waypoints.length === 0) {
              console.log("No waypoints found in the file");
              return;
            }

            // Add the waypoints as targets
            this.addWaypointsAsTargets(waypoints);
          } catch (error) {
            console.error(`Error importing file: ${error.message}`);
          }

          // Reset the file input so the same file can be selected again
          fileInput.value = "";
        });
      }
    },
  };

  // Public methods
  return {
    // Initialize the application
    init() {
      helpers.resizeCanvas();
      targets.setupNewTargetInput();
      targets.loadTargets();
      targets.setupDragAndDrop();
      targets.addDragStyles();
      events.setupEventListeners();
      mavlink.setupListeners();
      gpxImport.setupGPXImport();
      render.draw();
    },
  };
})();

ROVMap.init();
