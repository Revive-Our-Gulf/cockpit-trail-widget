const ROVMap = (() => {
  const canvas = document.getElementById("mapCanvas");
  const ctx = canvas.getContext("2d");
  const positionDisplay = document.getElementById("currentPos");
  const mapContainer = document.getElementById("mapContainer");

  const CONSTANTS = {
    MIN_DISTANCE: 0.5,
    MAX_TRAIL_POINTS: 300,
    EARTH_RADIUS: 111320,
    BASE_SCALE: 20,
    MIN_SCALE: 0.01,
    MAX_SCALE: 20,
    TARGET_REACHED_THRESHOLD: 1.0,
    ROV_SIZE: 20,
  };

  const STYLES = {
    COLORS: {
      ROV: "white",
      TRAIL: "rgba(160, 0, 0, 1)",
      ACTIVE_TARGET_ICON: "rgba(255, 225, 0, 1)",
      INACTIVE_TARGET_ICON: "white",
      TARGET_LINE: "white",
      DISTANCE_LINE_PRIMARY: "rgba(255, 225, 0, 1)",
      DISTANCE_LINE_SECONDARY: "#999999",
      // GRID: "rgba(68, 68, 68, 0.5)",
      GRID: "rgba(100, 100, 100, 1)",
      NORTH: "#FF4444",
    },
    LINES: {
      TRAIL: 3,
      TARGET: 5,
      TARGET_LINE: 3,
    },
  };

  const MAVLINK_VARS = {
    LAT: "GLOBAL_POSITION_INT/lat",
    LON: "GLOBAL_POSITION_INT/lon",
    HDG: "GLOBAL_POSITION_INT/hdg",
  };

  let state = {
    trail: [],
    firstPoint: null,
    currentHeading: 0,
    currentPosition: { lat: null, lon: null },
    targets: [],
    activeTargetIndex: -1,
    scale: 1,
    gridOrigin: { lat: null, lon: null },
    gridOffset: { x: 0, y: 0 },
    lastPosition: { lat: null, lon: null },
    viewMode: "rov-up",
    importedWaypoints: [],
    waypointDropdownVisible: false,
  };

  let uiState = {
    initialPinchDistance: 0,
    lastScale: 1,
    isDragging: false,
    lastMousePos: { x: 0, y: 0 },
    panOffset: { x: 0, y: 0 },
  };

  const helpers = {
    resizeCanvas() {
      canvas.width = mapContainer.clientWidth;
      canvas.height = mapContainer.clientHeight;
      render.requestDraw();
    },
    latLonToMeters(lat, lon, refLat, refLon) {
      const latMeters = (lat - refLat) * CONSTANTS.EARTH_RADIUS;
      const lonMeters =
        (lon - refLon) *
        CONSTANTS.EARTH_RADIUS *
        Math.cos((refLat * Math.PI) / 180);
      return { x: lonMeters, y: -latMeters };
    },
    metersToPixels(meters, scaleFactor = CONSTANTS.BASE_SCALE) {
      return meters * scaleFactor;
    },
    worldToScreen(meters) {
      return {
        x:
          canvas.width / 2 +
          (helpers.metersToPixels(meters.x) + uiState.panOffset.x) *
          state.scale,
        y:
          canvas.height / 2 +
          (helpers.metersToPixels(meters.y) + uiState.panOffset.y) *
          state.scale,
      };
    },
    toScreenCoordinates(point, applyScale = true) {
      if (!point || !point.x || !point.y) return null;

      return {
        x: canvas.width / 2 + point.x * (applyScale ? state.scale : 1),
        y: canvas.height / 2 + point.y * (applyScale ? state.scale : 1),
      };
    },
    getGridSpacing() {
      const candidateSteps = [
        1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
      ];
      const minPixelSpacing = 60;
      const effectiveScale = CONSTANTS.BASE_SCALE * state.scale;

      for (let step of candidateSteps) {
        if (step * effectiveScale >= minPixelSpacing) {
          return step;
        }
      }
      return candidateSteps[candidateSteps.length - 1];
    },
    drawMarker(ctx, x, y, size, color, lineWidth) {
      this.drawLine(ctx, x - size, y - size, x + size, y + size, {
        color,
        width: lineWidth,
      });
      this.drawLine(ctx, x + size, y - size, x - size, y + size, {
        color,
        width: lineWidth,
      });
    },

    drawLine(ctx, startX, startY, endX, endY, style = {}) {
      ctx.save();
      ctx.strokeStyle = style.color || STYLES.COLORS.TRAIL;
      ctx.lineWidth = style.width || STYLES.LINES.TRAIL;
      if (style.shadow) {
        ctx.shadowColor = style.shadowColor || "rgba(0, 0, 0, 0.5)";
        ctx.shadowBlur = style.shadowBlur || 10;
      }
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.restore();
    },
  };

  const geoUtils = {
    latLonToScreenPos(pos, applyScale = true) {
      const ref = state.currentPosition;

      const latMeters = (pos.lat - ref.lat) * CONSTANTS.EARTH_RADIUS;
      const lonMeters =
        (pos.lon - ref.lon) *
        CONSTANTS.EARTH_RADIUS *
        Math.cos((ref.lat * Math.PI) / 180);

      const x = lonMeters * CONSTANTS.BASE_SCALE;
      const y = -latMeters * CONSTANTS.BASE_SCALE;

      // Include pan offset here
      return {
        x:
          canvas.width / 2 +
          (x + uiState.panOffset.x) * (applyScale ? state.scale : 1),
        y:
          canvas.height / 2 +
          (y + uiState.panOffset.y) * (applyScale ? state.scale : 1),
      };
    },

    getDistance(pos1, pos2) {
      if (!pos1 || !pos2) return 0;

      const latDiff = (pos1.lat - pos2.lat) * CONSTANTS.EARTH_RADIUS;
      const lonDiff =
        (pos1.lon - pos2.lon) *
        CONSTANTS.EARTH_RADIUS *
        Math.cos(((pos1.lat + pos2.lat) / 2) * (Math.PI / 180));

      return Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
    },

    getBearing(from, to) {
      const dLon = (to.lon - from.lon) * (Math.PI / 180);
      const y = Math.sin(dLon) * Math.cos(to.lat * (Math.PI / 180));
      const x =
        Math.cos(from.lat * (Math.PI / 180)) *
        Math.sin(to.lat * (Math.PI / 180)) -
        Math.sin(from.lat * (Math.PI / 180)) *
        Math.cos(to.lat * (Math.PI / 180)) *
        Math.cos(dLon);
      const bearing = Math.atan2(y, x) * (180 / Math.PI);
      return (bearing + 360) % 360;
    },

    isTargetVisible(target, padding = 50) {
      const pos = this.latLonToScreenPos(target, false);
      if (!pos) return false;

      const scaledX = pos.x * state.scale;
      const scaledY = pos.y * state.scale;

      const diagonal = Math.sqrt(
        Math.pow(canvas.width / 2, 2) + Math.pow(canvas.height / 2, 2)
      );

      const distance = Math.sqrt(scaledX * scaledX + scaledY * scaledY);
      return distance < diagonal + padding;
    },
  };

  const targets = {
    createTargetEntry(index) {
      const inputGroup = document.createElement("div");
      inputGroup.className = "target-input-group";
      inputGroup.dataset.index = index;

      const targetName = state.targets[index].name || `Target ${index + 1}`;

      inputGroup.innerHTML = `
      <div class="target-entry" style="display: flex; align-items: center;">
        <div class="v-input v-input--horizontal v-input--center-affix v-input--density-compact v-theme--light v-text-field" style="flex-grow: 1;">
          <div class="v-input__control">
            <div class="v-field v-field--active v-field--center-affix v-field--variant-outlined v-theme--light">
              <div class="v-field__overlay"></div>
              <div class="v-field__field" data-no-activator>
                <label class="v-label v-field-label">${targetName}</label>
                <input type="text" class="v-field__input targetCoords">
              </div>
              <div class="v-field__outline">
                <div class="v-field__outline__start"></div>
                <div class="v-field__outline__notch">
                  <label class="v-label v-field-label v-field-label--floating">${targetName}</label>
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
          <i class="mdi-trash-can mdi v-icon notranslate v-theme--dark v-icon--size-default"></i>
        </button>
      </div>
      `;

      const targetInput = inputGroup.querySelector(".targetCoords");
      targetInput.value = `${state.targets[index].lat}, ${state.targets[index].lon}`;

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
          state.targets[index] = { lat, lon };
          targetInput.value = `${lat}, ${lon}`;
          render.requestDraw();
        }
      });

      document.getElementById("addedTargetsContainer").appendChild(inputGroup);
      targets.setupTargetEntryListeners(inputGroup, index);
    },

    createWaypointDropdown(waypoints, fileName) {
      // Get dropdown elements
      const waypointDropdown = document.getElementById("waypointDropdown");
      const waypointList = document.getElementById("waypointList");
      const waypointTitle = document.getElementById("waypointDropdownTitle");

      // Clear previous waypoints and update title
      waypointList.innerHTML = "";
      waypointTitle.textContent = `Imported Waypoints (${fileName})`;

      // Add waypoints to the list
      waypoints.forEach((waypoint, index) => {
        const item = document.createElement("div");
        item.className = "waypoint-item";
        item.style.display = "flex";
        item.style.justifyContent = "space-between";
        item.style.alignItems = "center";
        item.style.padding = "4px 0";
        item.style.borderBottom = "1px solid var(--v-border-color)";

        const name = waypoint.name || `Waypoint ${index + 1}`;

        item.innerHTML = `
      <div>${name} (${waypoint.lat.toFixed(6)}, ${waypoint.lon.toFixed(
          6
        )})</div>
      <button class="add-waypoint v-btn v-btn--icon v-theme--dark v-btn--density-compact v-btn--size-default v-btn--variant-text">
        <i class="mdi-plus mdi v-icon notranslate v-theme--dark v-icon--size-default"></i>
      </button>
    `;

        waypointList.appendChild(item);

        // Add click event to the add button
        const addBtn = item.querySelector(".add-waypoint");
        addBtn.addEventListener("click", () => {
          this.addSingleWaypointAsTarget(waypoint);
        });
      });

      // Show the dropdown
      waypointDropdown.style.display = "block";
    },

    addSingleWaypointAsTarget(waypoint) {
      if (!waypoint) return;

      const newIndex = state.targets.length;
      state.targets.push({
        lat: waypoint.lat,
        lon: waypoint.lon,
        name: waypoint.name || "",
      });

      targets.createTargetEntry(newIndex);
      state.activeTargetIndex = newIndex;
      render.requestDraw();
      helpers.resizeCanvas();
    },

    setupTargetEntryListeners(inputGroup, index) {
      const selectBtn = inputGroup.querySelector(".select-target");
      const removeBtn = inputGroup.querySelector(".remove-target");

      selectBtn.addEventListener("click", () => {
        state.activeTargetIndex = index;
        render.requestDraw();
      });

      removeBtn.addEventListener("click", () => {
        state.targets.splice(index, 1);
        targets.compactTargets();
        render.requestDraw();
        helpers.resizeCanvas();
      });
    },

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
        render.requestDraw();
        input.value = "";
      };

      addBtn.addEventListener("click", submitNewTarget);
      input.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submitNewTarget();
        }
      });
    },
  };

  const render = {
    animationFrameId: null,
    updatePending: false,
    fps: 24, // Target frame rate
    lastFrameTime: 0,

    startAnimationLoop() {
      const frameInterval = 1000 / this.fps;

      const animationLoop = (timestamp) => {
        const elapsed = timestamp - this.lastFrameTime;

        const shouldDraw = elapsed >= frameInterval || this.updatePending;
        if (shouldDraw) {
          this.lastFrameTime = timestamp - (elapsed % frameInterval);
          this.draw();
          this.updatePending = false;
        }
        this.animationFrameId = requestAnimationFrame(animationLoop);
      };

      this.animationFrameId = requestAnimationFrame(animationLoop);
    },

    stopAnimationLoop() {
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
    },

    requestDraw() {
      // this.updatePending = true;
    },

    applyViewRotation(drawingFunction) {
      ctx.save();

      ctx.translate(
        canvas.width / 2 + uiState.panOffset.x * state.scale,
        canvas.height / 2 + uiState.panOffset.y * state.scale
      );

      if (state.viewMode === "rov-up") {
        ctx.rotate(-state.currentHeading * (Math.PI / 180));
      }

      ctx.translate(
        -(canvas.width / 2 + uiState.panOffset.x * state.scale),
        -(canvas.height / 2 + uiState.panOffset.y * state.scale)
      );

      drawingFunction();
      ctx.restore();
    },

    draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.drawGrid();
      this.drawTrailPath();
      this.drawTargets();
      this.drawROV();
      this.drawScaleIndicator();
    },

    drawROV() {
      ctx.save();
      ctx.translate(
        canvas.width / 2 + uiState.panOffset.x * state.scale,
        canvas.height / 2 + uiState.panOffset.y * state.scale
      );

      // In north-up mode, we need to rotate the ROV icon to match its heading
      if (state.viewMode === "north-up") {
        ctx.rotate(state.currentHeading * (Math.PI / 180));
      }

      ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
      ctx.shadowBlur = 30;
      ctx.beginPath();
      ctx.moveTo(0, -CONSTANTS.ROV_SIZE);
      ctx.lineTo(CONSTANTS.ROV_SIZE, CONSTANTS.ROV_SIZE);
      ctx.lineTo(0, CONSTANTS.ROV_SIZE / 2);
      ctx.lineTo(-CONSTANTS.ROV_SIZE, CONSTANTS.ROV_SIZE);
      ctx.closePath();
      ctx.fillStyle = STYLES.COLORS.ROV;
      ctx.fill();

      // Save context again before drawing north indicator
      ctx.save();

      // If in north-up mode, counter-rotate to keep north indicator steady
      if (state.viewMode === "north-up") {
        ctx.rotate(-state.currentHeading * (Math.PI / 180));
      }

      // Now draw the north indicator (will be fixed in north-up mode)
      const northAngle = -state.currentHeading * (Math.PI / 180);
      const northLength = 55;
      const northX = Math.sin(northAngle) * northLength;
      const northY = -Math.cos(northAngle) * northLength;

      // In north-up mode, north always points up
      if (state.viewMode === "north-up") {
        helpers.drawLine(ctx, 0, 0, 0, -northLength, {
          color: STYLES.COLORS.NORTH,
          width: 3.5,
        });

        // Arrow for north indicator
        const arrowWidth = 12;
        ctx.beginPath();
        ctx.fillStyle = STYLES.COLORS.NORTH;
        ctx.moveTo(0, -northLength);
        ctx.lineTo(-arrowWidth / 2, -northLength + 10);
        ctx.lineTo(arrowWidth / 2, -northLength + 10);
        ctx.closePath();
        ctx.fill();

        // "N" label
        ctx.fillStyle = STYLES.COLORS.NORTH;
        ctx.font = "bold 16px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("N", 0, -northLength - 10);
      } else {
        // Original north indicator for ROV-up mode
        helpers.drawLine(ctx, 0, 0, northX, northY, {
          color: STYLES.COLORS.NORTH,
          width: 3.5,
        });

        // Arrow
        const arrowLength = 10;
        const arrowWidth = 12;
        ctx.beginPath();
        ctx.fillStyle = STYLES.COLORS.NORTH;
        ctx.moveTo(northX, northY);
        const baseX = northX - Math.sin(northAngle) * arrowLength;
        const baseY = northY + Math.cos(northAngle) * arrowLength;
        const perpAngle = northAngle + Math.PI / 2;
        const offsetX = (Math.sin(perpAngle) * arrowWidth) / 2;
        const offsetY = (-Math.cos(perpAngle) * arrowWidth) / 2;
        ctx.lineTo(baseX + offsetX, baseY + offsetY);
        ctx.lineTo(baseX - offsetX, baseY - offsetY);
        ctx.closePath();
        ctx.fill();

        // "N" label
        ctx.fillStyle = STYLES.COLORS.NORTH;
        ctx.font = "bold 16px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const labelDistance = northLength + 10;
        const labelX = Math.sin(northAngle) * labelDistance;
        const labelY = -Math.cos(northAngle) * labelDistance;
        ctx.fillText("N", labelX, labelY);
      }

      // Restore context after drawing north indicator
      ctx.restore();
      ctx.restore();
    },

    drawTrailPath() {
      if (
        !state.currentPosition.lat ||
        !state.currentPosition.lon ||
        state.trail.length < 2
      ) {
        return;
      }

      this.applyViewRotation(() => {
        ctx.save();
        try {
          // Set common style once
          ctx.strokeStyle = STYLES.COLORS.TRAIL;
          ctx.lineWidth = STYLES.LINES.TRAIL;
          ctx.beginPath();

          // Cache the first point
          const firstPoint = geoUtils.latLonToScreenPos(state.trail[0], true);
          if (!firstPoint) return;

          ctx.moveTo(firstPoint.x, firstPoint.y);

          // Draw all segments in one path
          for (let i = 1; i < state.trail.length; i++) {
            const currentPoint = geoUtils.latLonToScreenPos(
              state.trail[i],
              true
            );
            if (!currentPoint) continue;

            ctx.lineTo(currentPoint.x, currentPoint.y);
          }

          ctx.stroke();
        } finally {
          ctx.restore();
        }
      });
    },

    drawTargets() {
      if (
        !state.firstPoint ||
        !state.targets.length ||
        !state.currentPosition.lat ||
        !state.currentPosition.lon
      )
        return;

      this.applyViewRotation(() => {
        this._drawTargetConnections();
        this._drawActiveTargetLine();
        this._drawPreviousTargetLine();
        this._drawTargetMarkers();
      });
    },

    _drawLineWithTextGap(start, end, textPosition, style = {}) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const textDist = Math.sqrt(
        Math.pow(textPosition.x - start.x, 2) +
        Math.pow(textPosition.y - start.y, 2)
      );
      const totalDist = Math.sqrt(dx * dx + dy * dy);
      const dirX = dx / totalDist;
      const dirY = dy / totalDist;
      const gapSize = 25;
      const gapStart = {
        x: textPosition.x - gapSize * dirX,
        y: textPosition.y - gapSize * dirY,
      };
      const gapEnd = {
        x: textPosition.x + gapSize * dirX,
        y: textPosition.y + gapSize * dirY,
      };

      ctx.beginPath();
      if (style.dashed) {
        ctx.setLineDash(style.dashed);
      } else {
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = style.color || STYLES.COLORS.DISTANCE_LINE_PRIMARY;
      ctx.lineWidth = style.width || STYLES.LINES.TARGET_LINE;

      ctx.moveTo(start.x, start.y);
      ctx.lineTo(gapStart.x, gapStart.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(gapEnd.x, gapEnd.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      ctx.setLineDash([]);
    },

    _drawTargetConnections() {
      ctx.beginPath();
      ctx.strokeStyle = "#999999";
      ctx.lineWidth = STYLES.LINES.TARGET_LINE;

      state.targets.forEach((target, index) => {
        if (!target) return;
        const screenPos = geoUtils.latLonToScreenPos(target);

        if (index > 0 && state.targets[index - 1]) {
          const prevScreenPos = geoUtils.latLonToScreenPos(
            state.targets[index - 1]
          );

          helpers.drawLine(
            ctx,
            prevScreenPos.x,
            prevScreenPos.y,
            screenPos.x,
            screenPos.y,
            {
              color: STYLES.COLORS.TARGET_LINE,
              width: STYLES.LINES.TARGET_LINE,
            }
          );
        }
      });
    },

    _drawTargetLine(targetIndex, lineColor, textColor) {
      if (
        targetIndex === -1 ||
        !state.targets[targetIndex] ||
        !state.currentPosition.lat ||
        !state.currentPosition.lon
      )
        return;

      const target = state.targets[targetIndex];
      const scaledTarget = geoUtils.latLonToScreenPos(target);

      // Use the actual ROV position including pan offset
      const currentPixels = {
        x: canvas.width / 2 + uiState.panOffset.x * state.scale,
        y: canvas.height / 2 + uiState.panOffset.y * state.scale,
      };

      const { lineEndPoint, textPosition, angle } =
        this._calculateLineEndpoints(currentPixels, scaledTarget);

      ctx.beginPath();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = STYLES.LINES.TARGET_LINE;
      ctx.setLineDash([5, 5]);
      ctx.moveTo(currentPixels.x, currentPixels.y);
      ctx.lineTo(lineEndPoint.x, lineEndPoint.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const distanceMeters = geoUtils.getDistance(
        state.currentPosition,
        target
      );
      this._drawDistanceLabel(textPosition, distanceMeters, textColor, angle);
    },

    _drawActiveTargetLine() {
      this._drawTargetLine(
        state.activeTargetIndex,
        STYLES.COLORS.DISTANCE_LINE_PRIMARY,
        STYLES.COLORS.DISTANCE_LINE_PRIMARY
      );
    },

    _drawPreviousTargetLine() {
      if (state.activeTargetIndex === -1 || state.targets.length <= 1) return;

      const prevIndex =
        (state.activeTargetIndex - 1 + state.targets.length) %
        state.targets.length;

      if (prevIndex === state.activeTargetIndex) return;

      this._drawTargetLine(
        prevIndex,
        STYLES.COLORS.DISTANCE_LINE_SECONDARY,
        STYLES.COLORS.DISTANCE_LINE_SECONDARY
      );
    },

    _calculateLineEndpoints(start, end) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      const angle = Math.atan2(dy, dx);

      if (distance < 10) {
        return {
          lineEndPoint: end,
          textPosition: {
            x: (start.x + end.x) / 2 + 20,
            y: (start.y + end.y) / 2 - 10,
          },
          angle: angle,
        };
      }

      const dirX = dx / distance;
      const dirY = dy / distance;

      // Calculate perpendicular direction for text offset
      const perpX = -dirY;
      const perpY = dirX;
      const offsetDistance = 30; // Offset distance from line

      const diagonal =
        Math.sqrt(Math.pow(canvas.width, 2) + Math.pow(canvas.height, 2)) / 2;
      const isTargetVisible = distance < diagonal;

      let lineEndPoint;
      if (isTargetVisible) {
        lineEndPoint = { x: end.x, y: end.y };
      } else {
        const extendedDistance = diagonal * 1.5;
        lineEndPoint = {
          x: start.x + dirX * extendedDistance,
          y: start.y + dirY * extendedDistance,
        };
      }

      const textDistance = isTargetVisible
        ? distance / 2
        : Math.min(distance / 2, diagonal / 2);

      // Position text beside the line by adding perpendicular offset
      const textPosition = {
        x: start.x + dirX * textDistance + perpX * offsetDistance,
        y: start.y + dirY * textDistance + perpY * offsetDistance,
      };

      return { lineEndPoint, textPosition, angle };
    },

    _drawDistanceLabel(position, distanceMeters, textColour, angle) {
      const distanceText = distanceMeters.toFixed(1) + " m";
      ctx.save();
      ctx.translate(position.x, position.y);

      if (state.viewMode === "north-up") {
        ctx.rotate(0);
      } else {
        ctx.rotate(state.currentHeading * (Math.PI / 180));
      }

      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const textWidth = ctx.measureText(distanceText).width;
      ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
      ctx.fillRect(-textWidth / 2 - 4, -14, textWidth + 8, 28);
      ctx.fillStyle = textColour;
      ctx.fillText(distanceText, 0, 0);
      ctx.restore();
    },

    _drawTargetMarkers() {
      state.targets.forEach((target, index) => {
        if (!target) return;

        const screenPos = geoUtils.latLonToScreenPos(target);

        const size = 12;
        const color =
          index === state.activeTargetIndex
            ? STYLES.COLORS.ACTIVE_TARGET_ICON
            : STYLES.COLORS.INACTIVE_TARGET_ICON;

        helpers.drawMarker(
          ctx,
          screenPos.x,
          screenPos.y,
          size,
          color,
          STYLES.LINES.TARGET
        );
      });
    },

    drawGrid() {
      if (!state.currentPosition.lat || !state.currentPosition.lon) return;

      this.applyViewRotation(() => {
        const gridParams = this._calculateGridParameters();
        this._drawGridLines(ctx, gridParams);
      });
    },

    _calculateGridParameters() {
      const gridSpacing = helpers.getGridSpacing();
      const effectiveMultiplier = CONSTANTS.BASE_SCALE * state.scale;

      // Calculate grid boundaries with padding for rotation
      const diagonal = Math.sqrt(
        canvas.width * canvas.width + canvas.height * canvas.height
      );
      const extraPadding = diagonal / 2;

      return {
        gridSpacing,
        effectiveMultiplier,
        bounds: {
          left: -(canvas.width / 2 + extraPadding) / effectiveMultiplier,
          right: (canvas.width / 2 + extraPadding) / effectiveMultiplier,
          top: -(canvas.height / 2 + extraPadding) / effectiveMultiplier,
          bottom: (canvas.height / 2 + extraPadding) / effectiveMultiplier,
        },
        offset: {
          x: state.gridOffset.x % gridSpacing,
          y: state.gridOffset.y % gridSpacing,
        },
      };
    },

    _drawGridLines(ctx, params) {
      const { gridSpacing, bounds, offset } = params;

      ctx.beginPath();
      ctx.strokeStyle = STYLES.COLORS.GRID;
      ctx.lineWidth = 1;

      const startX =
        Math.floor(bounds.left / gridSpacing) * gridSpacing - offset.x;
      const endX =
        Math.ceil(bounds.right / gridSpacing) * gridSpacing - offset.x;

      for (let x = startX; x <= endX; x += gridSpacing) {
        const start = helpers.worldToScreen({ x, y: bounds.top });
        const end = helpers.worldToScreen({ x, y: bounds.bottom });
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
      }

      const startY =
        Math.floor(bounds.top / gridSpacing) * gridSpacing - offset.y;
      const endY =
        Math.ceil(bounds.bottom / gridSpacing) * gridSpacing - offset.y;

      for (let y = startY; y <= endY; y += gridSpacing) {
        const start = helpers.worldToScreen({ x: bounds.left, y });
        const end = helpers.worldToScreen({ x: bounds.right, y });
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
      }

      ctx.stroke();
    },

    drawScaleIndicator() {
      const gridSpacing = helpers.getGridSpacing();
      const formattedValue =
        gridSpacing >= 1000
          ? (gridSpacing / 1000).toFixed(1) + " km"
          : gridSpacing.toFixed(1) + " m";

      const padding = 20;
      const x = canvas.width - padding;
      const y = canvas.height - padding;

      ctx.save();
      ctx.font = "bold 20px Arial";

      ctx.fillStyle = STYLES.COLORS.GRID;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(formattedValue, x, y - 8);
      ctx.restore();
    },
  };

  const mavlink = {
    handleLatitude() {
      const lat =
        window.cockpit.getDataLakeVariableData(MAVLINK_VARS.LAT) / 1e7;
      if (lat === undefined) return;

      state.currentPosition.lat = lat;
      mavlink.updatePosition();
    },

    handleLongitude() {
      const lon =
        window.cockpit.getDataLakeVariableData(MAVLINK_VARS.LON) / 1e7;
      if (lon === undefined) return;

      state.currentPosition.lon = lon;
      mavlink.updatePosition();
    },

    handleHeading() {
      const heading =
        window.cockpit.getDataLakeVariableData(MAVLINK_VARS.HDG) / 100;
      if (heading === undefined) return;

      state.currentHeading = heading;
      render.requestDraw();
    },

    updatePosition() {
      if (!state.currentPosition.lat || !state.currentPosition.lon) return;

      const { lat, lon } = state.currentPosition;

      if (!state.gridOrigin.lat) {
        state.gridOrigin.lat = lat;
        state.gridOrigin.lon = lon;
      }

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

      state.lastPosition.lat = lat;
      state.lastPosition.lon = lon;

      if (!state.firstPoint) {
        state.firstPoint = { lat, lon };
      }

      if (
        state.trail.length === 0 ||
        geoUtils.getDistance(
          { lat, lon },
          state.trail[state.trail.length - 1]
        ) >= CONSTANTS.MIN_DISTANCE
      ) {
        state.trail.push({ lat, lon });
        if (state.trail.length > CONSTANTS.MAX_TRAIL_POINTS)
          state.trail.shift();
      }

      positionDisplay.innerText = `${lat.toFixed(7)}, ${lon.toFixed(7)}`;

      this.checkTargetProximity();

      render.requestDraw();
    },

    checkTargetProximity() {
      if (
        state.activeTargetIndex === -1 ||
        !state.targets.length ||
        !state.currentPosition.lat ||
        !state.currentPosition.lon
      ) {
        return;
      }

      const currentTarget = state.targets[state.activeTargetIndex];
      const distanceToTarget = geoUtils.getDistance(
        state.currentPosition,
        currentTarget
      );

      if (distanceToTarget <= CONSTANTS.TARGET_REACHED_THRESHOLD) {
        console.log(
          `Target ${state.activeTargetIndex + 1
          } reached! Distance: ${distanceToTarget.toFixed(2)}m`
        );

        state.activeTargetIndex =
          (state.activeTargetIndex + 1) % state.targets.length;
        console.log(`Moving to target ${state.activeTargetIndex + 1}`);

        render.requestDraw();
      }
    },

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

  const events = {
    recenterROV() {
      uiState.panOffset = { x: 0, y: 0 };
      render.requestDraw();
    },

    handleMouseDown(e) {
      uiState.isDragging = true;
      uiState.lastMousePos = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = "grabbing";
    },

    handleMouseMove(e) {
      if (!uiState.isDragging) return;

      const dx = e.clientX - uiState.lastMousePos.x;
      const dy = e.clientY - uiState.lastMousePos.y;

      // Use scale factor to make panning feel consistent across zoom levels
      uiState.panOffset.x += dx / state.scale;
      uiState.panOffset.y += dy / state.scale;

      uiState.lastMousePos = { x: e.clientX, y: e.clientY };
      render.requestDraw();
    },

    handleMouseUp() {
      uiState.isDragging = false;
      canvas.style.cursor = "grab";
    },

    handleWheel(e) {
      e.preventDefault();
      const zoomFactor = 1.1;

      if (e.deltaY < 0) {
        state.scale *= zoomFactor;
      } else {
        state.scale /= zoomFactor;
      }

      state.scale = Math.max(
        CONSTANTS.MIN_SCALE,
        Math.min(state.scale, CONSTANTS.MAX_SCALE)
      );
      render.requestDraw();
    },

    handleTouchStart(e) {
      if (e.touches.length === 2) {
        // Pinch gesture handling
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        uiState.initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
        uiState.lastScale = state.scale;
      } else if (e.touches.length === 1) {
        // Pan gesture handling
        uiState.isDragging = true;
        uiState.lastMousePos = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      }
    },

    handleTouchMove(e) {
      if (e.touches.length === 2) {
        // Pinch zoom handling
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

        render.requestDraw();
      } else if (e.touches.length === 1 && uiState.isDragging) {
        // Pan handling
        e.preventDefault();

        const dx = e.touches[0].clientX - uiState.lastMousePos.x;
        const dy = e.touches[0].clientY - uiState.lastMousePos.y;

        // Apply pan offset
        uiState.panOffset.x += dx / state.scale;
        uiState.panOffset.y += dy / state.scale;

        uiState.lastMousePos = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
        render.requestDraw();
      }
    },

    handleTouchEnd(e) {
      if (e.touches.length === 0) {
        uiState.isDragging = false;
      }
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
      window.addEventListener("resize", helpers.resizeCanvas);
      canvas.addEventListener("wheel", this.handleWheel);

      // Add mouse event listeners for panning
      canvas.addEventListener("mousedown", this.handleMouseDown);
      window.addEventListener("mousemove", this.handleMouseMove);
      window.addEventListener("mouseup", this.handleMouseUp);

      // Set initial cursor style
      canvas.style.cursor = "grab";

      // Update touch event listeners for both panning and zooming
      canvas.addEventListener("touchstart", this.handleTouchStart);
      canvas.addEventListener("touchmove", this.handleTouchMove);
      canvas.addEventListener("touchend", this.handleTouchEnd);

      const targetContainer = document.getElementById("targetContainer");
      const chevronIcon = document.getElementById("targetChevron");

      targetContainer.style.display = "none";
      chevronIcon.className =
        "mdi mdi-chevron-down v-icon notranslate v-theme--dark v-icon--size-default";

      document
        .getElementById("toggleTargetContainer")
        .addEventListener("click", this.handleToggleTargetContainer);

      // Clear trail button if it exists
      const clearTrailBtn = document.getElementById("clearTrail");
      if (clearTrailBtn) {
        clearTrailBtn.addEventListener("click", () => {
          state.trail = [];
          render.requestDraw();
        });
      }

      const clearTargetsBtn = document.getElementById("clearTargets");
      if (clearTargetsBtn) {
        clearTargetsBtn.addEventListener("click", () => {
          state.targets = [];
          state.activeTargetIndex = -1;
          document.getElementById("addedTargetsContainer").innerHTML = "";
          render.requestDraw();
        });
      }

      const viewModeBtn = document.getElementById("toggleViewMode");
      if (viewModeBtn) {
        viewModeBtn.addEventListener("click", () => {
          state.viewMode = state.viewMode === "rov-up" ? "north-up" : "rov-up";
          const icon = viewModeBtn.querySelector("i");
          if (icon) {
            icon.className =
              state.viewMode === "rov-up"
                ? "mdi mdi-compass v-icon notranslate v-theme--dark v-icon--size-default"
                : "mdi mdi-navigation v-icon notranslate v-theme--dark v-icon--size-default";
          }

          render.requestDraw();
        });
      }

      const recenterBtn = document.getElementById("recenterROV");
      if (recenterBtn) {
        recenterBtn.addEventListener("click", this.recenterROV);
      }

      const posDisplay = document.getElementById("currentPos");
      if (posDisplay) {
        posDisplay.style.cursor = "pointer";

        posDisplay.addEventListener("click", () => {
           
          const text = posDisplay.innerText;
          const textArea = document.createElement("textarea");
          textArea.value = text;
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          try {
            document.execCommand('copy');
          } catch (err) {
            console.error('Unable to copy to clipboard', err);
          }
          document.body.removeChild(textArea);
        });
      }
    },
  };

  const kmlImport = {
    parseFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
          const fileContent = e.target.result;
          try {
            resolve(this.parseKML(fileContent));
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

              coordPairs.forEach((pair, idx) => {
                const coords = pair.split(",");
                if (coords.length >= 2) {
                  const lon = parseFloat(coords[0]);
                  const lat = parseFloat(coords[1]);

                  if (!isNaN(lat) && !isNaN(lon)) {
                    waypoints.push({
                      lat,
                      lon,
                      name: name
                        ? `${name} (Point ${idx + 1})`
                        : `Point ${idx + 1}`,
                    });
                  }
                }
              });
            }
          }
        }
      }

      return waypoints;
    },

    populateWaypointDropdown(waypoints, fileName) {
      const kmlFileRow = document.getElementById("kmlFileRow");
      const kmlFileName = document.getElementById("kmlFileName");
      const waypointSelect = document.getElementById("waypointSelect");

      // Update file name display
      kmlFileName.querySelector("span").textContent = fileName;

      // Clear existing options except the default one
      waypointSelect.innerHTML =
        '<option value="" disabled selected>Select a waypoint</option>';

      // Add waypoints to the dropdown
      waypoints.forEach((waypoint, index) => {
        const option = document.createElement("option");
        option.value = index;
        const name = waypoint.name || `Waypoint ${index + 1}`;
        option.textContent = `${name} (${waypoint.lat.toFixed(
          6
        )}, ${waypoint.lon.toFixed(6)})`;
        waypointSelect.appendChild(option);
      });

      // Show the KML file row
      kmlFileRow.style.display = "block";
    },

    addSingleWaypointAsTarget(waypoint) {
      if (!waypoint) return;

      const newIndex = state.targets.length;
      state.targets.push({
        lat: waypoint.lat,
        lon: waypoint.lon,
        name: waypoint.name || "",
      });

      targets.createTargetEntry(newIndex);
      state.activeTargetIndex = newIndex;
      render.requestDraw();
    },

    setupKMLImport() {
      const importBtn = document.getElementById("importKml");
      const fileInput = document.getElementById("kmlFileInput");
      const closeKmlFileBtn = document.getElementById("closeKmlFile");
      const waypointSelect = document.getElementById("waypointSelect");

      // Set file input to accept only KML
      if (fileInput) {
        fileInput.accept = ".kml";
      }

      // Set up file import
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

            // Store waypoints
            state.importedWaypoints = waypoints;

            // Populate dropdown
            this.populateWaypointDropdown(waypoints, file.name);

            // Hide the newTargetInput when KML is imported
            document.getElementById("newTargetInput").style.visibility =
              "hidden";
            document.getElementById("newTargetInput").style.height = "0";
            document.getElementById("newTargetInput").style.overflow = "hidden";
            document.getElementById("newTargetInput").style.margin = "0";

            // Make sure target container is visible
            const targetContainer = document.getElementById("targetContainer");
            const chevronIcon = document.getElementById("targetChevron");

            // Only change if it's currently hidden
            if (targetContainer.style.display === "none") {
              targetContainer.style.display = "block";
              chevronIcon.className =
                "mdi mdi-chevron-up v-icon notranslate v-theme--dark v-icon--size-default";
              helpers.resizeCanvas();
            }
          } catch (error) {
            console.error(`Error importing file: ${error.message}`);
          }

          // Reset the file input
          fileInput.value = "";
        });
      }

      // Set up waypoint selection
      if (waypointSelect) {
        waypointSelect.addEventListener("change", () => {
          const selectedIndex = parseInt(waypointSelect.value);
          if (!isNaN(selectedIndex) && state.importedWaypoints[selectedIndex]) {
            this.addSingleWaypointAsTarget(
              state.importedWaypoints[selectedIndex]
            );
            // Reset selection to default option
            waypointSelect.selectedIndex = 0;
          }
        });
      }

      // Close KML file action
      if (closeKmlFileBtn) {
        closeKmlFileBtn.addEventListener("click", () => {
          document.getElementById("kmlFileRow").style.display = "none";
          state.importedWaypoints = [];

          document.getElementById("newTargetInput").style.visibility =
            "visible";
          document.getElementById("newTargetInput").style.height = "auto";
          document.getElementById("newTargetInput").style.overflow = "visible";
          document.getElementById("newTargetInput").style.margin = "";
        });
      }
    },
  };

  // Public methods
  return {
    init() {
      targets.setupNewTargetInput();
      events.setupEventListeners();
      mavlink.setupListeners();
      kmlImport.setupKMLImport();
      render.startAnimationLoop();
      helpers.resizeCanvas();
    },
  };
})();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => ROVMap.init());
} else {
  ROVMap.init();
}
