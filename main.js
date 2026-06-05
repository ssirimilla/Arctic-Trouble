/* ============================================================
   ARCTIC SEA ICE — main.js
   Coordinates are WGS84 lon/lat (converted from EPSG:3411).
   Each JSON is a FeatureCollection of Polygon fragments —
   we merge them all into one MultiPolygon for a clean render.
   ============================================================ */

(function () {
  "use strict";

  /* ── Projection Defs ─────────────────────────────────────── */
  const EPSG3413 = "+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";
  proj4.defs("EPSG:3413", EPSG3413);

  /* ── Step config ─────────────────────────────────────────── */
  const STEPS = [
    { year: "1980", file: "1980.json", radius: 32, extent: 7.8, loss:  0 },
    { year: "1990", file: "1990.json", radius: 30, extent: 6.2, loss: 15 },
    { year: "2000", file: "2000.json", radius: 28, extent: 5.9, loss: 20 },
    { year: "2007", file: "2007.json", radius: 26, extent: 4.3, loss: 40 },
    { year: "2012", file: "2012.json", radius: 18, extent: 3.4, loss: 56 },
    { year: "2019", file: "2019.json", radius: 20, extent: 4.1, loss: 47 },
    { year: "2025", file: "2025.json", radius: 21, extent: 4.2, loss: 46 },
  ];

  /* ── DOM refs ────────────────────────────────────────────── */
  const container = document.getElementById("map-container");
  const yearLabel = document.getElementById("year-label");
  const extentNum = document.getElementById("extent-number");
  const lossBar   = document.getElementById("loss-bar-fill");
  const lossPct   = document.getElementById("loss-pct");
  const steps     = document.querySelectorAll(".step");

  /* ── Globe size ──────────────────────────────────────────── */
  const W = container.clientWidth  || 600;
  const H = container.clientHeight || 600;
  const R = Math.min(W, H) / 2.2;
  const R_ZOOM = R * 2.4; // Zoom factor to emphasize Arctic ice

  /* ── SVG ─────────────────────────────────────────────────── */
  const svg = d3.select("#map-container")
    .append("svg")
    .attr("width",  W)
    .attr("height", H)
    .attr("viewBox", `0 0 ${W} ${H}`);

  /* ── Projection: orthographic, North Pole centred ────────── */
  const projection = d3.geoOrthographic()
    .scale(R_ZOOM)
    .translate([W / 2, H / 2])
    .rotate([0, -90])
    .clipAngle(90);

  const path = d3.geoPath().projection(projection);

  /* ── Ocean sphere ────────────────────────────────────────── */
  svg.append("circle")
    .attr("class", "globe-sphere")
    .attr("cx", W / 2).attr("cy", H / 2).attr("r", R_ZOOM);

  /* ── Graticule ───────────────────────────────────────────── */
  const graticule = d3.geoGraticule();
  svg.append("path").datum(graticule()).attr("class", "graticule").attr("d", path);
  svg.append("path")
    .datum(d3.geoCircle().center([0, 90]).radius(23.5)())
    .attr("class", "graticule-polar").attr("d", path);

  /* ── State ───────────────────────────────────────────────── */
  let icePath      = null;  // SVG <path> element
  let baselinePath = null;  // SVG <path> element for 1980 baseline
  let iceGeoJSON   = null;  // current GeoJSON driving the ice (for rotate loop)
  const geoCache   = {};

  /* ── Coordinate Converter ────────────────────────────────── */
  function convert3413toWGS84(geojson) {
    if (!geojson) return geojson;
    
    function transformCoords(coords) {
      if (typeof coords[0] === 'number') {
        try {
          return proj4('EPSG:3413', 'WGS84', coords);
        } catch (e) {
          return [0, 0];
        }
      }
      return coords.map(transformCoords);
    }

    if (geojson.type === "FeatureCollection") {
      geojson.features.forEach(f => {
        if (f.geometry && f.geometry.coordinates) {
          f.geometry.coordinates = transformCoords(f.geometry.coordinates);
        }
      });
    } else if (geojson.type === "Feature") {
      if (geojson.geometry && geojson.geometry.coordinates) {
        geojson.geometry.coordinates = transformCoords(geojson.geometry.coordinates);
      }
    } else if (geojson.type === "GeometryCollection") {
      geojson.geometries.forEach(g => {
        g.coordinates = transformCoords(g.coordinates);
      });
    } else if (geojson.coordinates) {
      geojson.coordinates = transformCoords(geojson.coordinates);
    }
    
    return geojson;
  }

  /* ── Helpers ─────────────────────────────────────────────── */
  function circleGeoJSON(radius) {
    return d3.geoCircle().center([0, 90]).radius(radius)();
  }

  /**
   * Flatten a FeatureCollection of Polygons into a single MultiPolygon.
   * This is crucial — drawing 78 separate paths causes the criss-cross
   * artefact because D3 connects outer rings across the projection boundary.
   */
  function featureCollectionToMultiPolygon(fc) {
    const allRings = [];
    (fc.features || []).forEach(feat => {
      const geom = feat && feat.geometry;
      if (!geom) return;
      if (geom.type === "Polygon") {
        allRings.push(...geom.coordinates);
      } else if (geom.type === "MultiPolygon") {
        geom.coordinates.forEach(poly => allRings.push(...poly));
      }
    });
    return {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: allRings.map(ring => [ring]) },
      properties: {}
    };
  }

  function transitionIce(geojson) {
    if (!icePath) return;
    
    // Instead of morphing the path (which causes tearing), we fade out, swap data, and fade in
    icePath.transition()
      .duration(400)
      .style("opacity", 0)
      .on("end", function() {
        iceGeoJSON = geojson;
        d3.select(this)
          .datum(geojson)
          .attr("d", path)
          .transition()
          .duration(600)
          .style("opacity", 1);
      });
  }

  function updateDisplay(step) {
    yearLabel.textContent = step.year;
    extentNum.textContent = step.extent.toFixed(1);
    lossBar.style.width   = step.loss + "%";
    lossPct.textContent   = step.loss + "%";
    yearLabel.style.color =
      step.year === "2012" ? "var(--danger)"
      : step.year === "2024" ? "var(--gold)"
      : "#fff";
  }

  function loadAndTransition(stepData) {
    updateDisplay(stepData);

    // Baseline path logic
    if (baselinePath && geoCache["1980.json"]) {
      if (stepData.year === "1980") {
        baselinePath.transition().duration(600).style("opacity", 0);
      } else {
        baselinePath.datum(geoCache["1980.json"])
          .attr("d", path)
          .transition().duration(600).style("opacity", 1);
      }
    }

    if (geoCache[stepData.file]) {
      transitionIce(geoCache[stepData.file]);
      return;
    }

    d3.json(stepData.file)
      .then(function (data) {
        // Convert from EPSG:3413 to WGS84 so it wraps correctly on the globe
        const projectedData = convert3413toWGS84(data);
        
        // Convert FeatureCollection → single MultiPolygon for clean rendering
        const merged = (projectedData.type === "FeatureCollection")
          ? featureCollectionToMultiPolygon(projectedData)
          : projectedData;

        // D3 spherical winding fix:
        // Because the original Cartesian polygons might have clockwise winding,
        // D3 might interpret them as spanning the entire globe.
        // We detect this by checking if the spherical area > 2 * PI (a hemisphere),
        // and if so, we reverse the coordinates of the rings.
        if (merged.geometry && merged.geometry.type === "MultiPolygon") {
          merged.geometry.coordinates.forEach(poly => {
            const dummy = { type: "Polygon", coordinates: poly };
            if (d3.geoArea(dummy) > 2 * Math.PI) {
              poly.forEach(ring => ring.reverse());
            }
          });
        }
          
        console.log("✅ Loaded and converted", stepData.file,
          "→", merged.geometry.coordinates.length, "polygons");
        geoCache[stepData.file] = merged;

        // Catch up the baseline display if we just loaded 1980 and we are on a different step
        if (baselinePath && stepData.year !== "1980" && geoCache["1980.json"]) {
           baselinePath.datum(geoCache["1980.json"]).attr("d", path).transition().duration(600).style("opacity", 1);
        }

        transitionIce(merged);
      })
      .catch(function (err) {
        console.warn("⚠️  Could not load", stepData.file, "— circle fallback.", err);
        const fb = circleGeoJSON(stepData.radius);
        geoCache[stepData.file] = fb;
        transitionIce(fb);
      });
  }

  /* ── Main ────────────────────────────────────────────────── */
  d3.json("https://unpkg.com/world-atlas@2/countries-110m.json")
    .then(function (world) {

      // Land (below ice)
      svg.append("path")
        .datum(topojson.feature(world, world.objects.countries))
        .attr("class", "land")
        .attr("d", path);

      // 1980 Baseline path (rendered below current ice so it forms an outline)
      baselinePath = svg.append("path")
        .attr("id", "baseline-path")
        .attr("class", "baseline")
        .style("opacity", 0);

      // Ice path — one element, updated every step
      const initialGeo = circleGeoJSON(STEPS[0].radius);
      iceGeoJSON = initialGeo;
      icePath = svg.append("path")
        .attr("id", "ice-path")
        .attr("class", "ice")
        .datum(initialGeo)
        .attr("d", path);

      updateDisplay(STEPS[0]);
      loadAndTransition(STEPS[0]);

      /* Intersection Observer */
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const year     = entry.target.getAttribute("data-year");
          const stepData = STEPS.find((s) => s.year === year);
          if (!stepData) return;
          steps.forEach((s) => s.classList.remove("is-active"));
          entry.target.classList.add("is-active");
          loadAndTransition(stepData);
        });
      }, { rootMargin: "-45% 0px -45% 0px", threshold: 0 });

      steps.forEach((step) => observer.observe(step));
    })
    .catch(err => console.error("World atlas load failed:", err));

  /* ── Temperature Map Initialization ───────────────────────── */
  function initTemperatureMap() {
    const container = document.getElementById("temp-map-container");
    if (!container) return;
    
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;
    const r = Math.min(w, h) / 2.2;

    const tempSvg = d3.select("#temp-map-container")
      .append("svg")
      .attr("width", w)
      .attr("height", h)
      .attr("viewBox", `0 0 ${w} ${h}`);

    const tempProj = d3.geoOrthographic()
      .scale(r * 2.0)
      .translate([w / 2, h / 2])
      .rotate([0, -90])
      .clipAngle(90);

    const tempPath = d3.geoPath().projection(tempProj);

    tempSvg.append("circle")
      .attr("class", "globe-sphere")
      .attr("cx", w / 2).attr("cy", h / 2).attr("r", r * 2.0);

    tempSvg.append("path")
      .datum(d3.geoGraticule()())
      .attr("class", "graticule-polar")
      .attr("d", tempPath);

    d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json")
      .then(world => {
        tempSvg.append("path")
          .datum(topojson.feature(world, world.objects.land))
          .attr("class", "land")
          .style("fill", "rgba(30, 41, 59, 0.4)")
          .attr("d", tempPath);
          
        loadTemperatureData(tempSvg, tempProj);
      });
  }

  function loadTemperatureData(svg, proj) {
    d3.json("arctic_temp_anomaly.json")
      .then(data => {
        if (!data || data.length === 0) return;
        
        // Color scale for extreme heating up to +16C (1980 vs 2100)
        const colorScale = d3.scaleSequential(d3.interpolateInferno).domain([0, 16]);
        
        // Convert to GeoJSON FeatureCollection
        const geoData = {
          type: "FeatureCollection",
          features: data.map(d => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [d.lon, d.lat] },
            properties: { delta: d.delta }
          }))
        };

        const pointPath = d3.geoPath().projection(proj).pointRadius(4);

        svg.selectAll(".temp-cell")
          .data(geoData.features)
          .enter()
          .append("path")
          .attr("class", "temp-cell")
          .attr("d", pointPath)
          .style("fill", d => colorScale(d.properties.delta))
          .style("opacity", 0.85);
          
        const legend = d3.select("#temp-map-container").append("div").attr("class", "temp-legend");
        legend.html(`
          <div style="font-weight: bold; margin-bottom: 8px;">Temperature Change (°C)</div>
          <div class="legend-gradient" style="background: linear-gradient(to right, ${colorScale(0)}, ${colorScale(8)}, ${colorScale(16)})"></div>
          <div class="legend-labels">
            <span>0°</span>
            <span>+8°</span>
            <span>+16°</span>
          </div>
        `);
      })
      .catch(err => console.log("Waiting for temperature data...", err));
  }
  
  initTemperatureMap();

})();
