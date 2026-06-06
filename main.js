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
    const polygons = [];

    (fc.features || []).forEach(feat => {
      const geom = feat && feat.geometry;
      if (!geom) return;

      if (geom.type === "Polygon") {
        polygons.push(geom.coordinates);
      } else if (geom.type === "MultiPolygon") {
        polygons.push(...geom.coordinates);
      }
    });

    return {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: polygons
      },
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
  /* ── Temperature Choropleth Map ─────────────────────────── */
  function initTemperatureMap() {
    const container = document.getElementById("temp-map-container");
    if (!container) return;

    const w = container.clientWidth  || 900;
    const h = container.clientHeight || 720;

    // AzimuthalEquidistant: r = scale * θ_radians.
    // scale = ARCTIC_R / (π/2)  → full hemisphere (0–90°N) fills the circle.
    const ARCTIC_R = Math.min(w, h) * 0.46;

    const DEG_TO_SHOW = 32;

    const tempProj = d3.geoAzimuthalEquidistant()
      .scale(ARCTIC_R / (Math.PI / 2) * 2.75)   // full hemisphere fits in ARCTIC_R px
      .translate([w / 2, h / 2])
      .rotate([0, -90])                   // North Pole at centre
      .clipAngle(DEG_TO_SHOW);

    const tempPath = d3.geoPath().projection(tempProj);

    const tempSvg = d3.select("#temp-map-container")
      .append("svg")
      .attr("width",  w)
      .attr("height", h)
      .attr("viewBox", `0 0 ${w} ${h}`);

    // Ocean background circle
    tempSvg.append("circle")
      .attr("cx", w / 2).attr("cy", h / 2).attr("r", ARCTIC_R)
      .style("fill", "#071525")
      .style("filter", "drop-shadow(0 0 40px rgba(78,184,255,0.15))");

    // Clip path so nothing renders outside the circle
    const defs = tempSvg.append("defs");
    defs.append("clipPath").attr("id", "arctic-clip")
      .append("circle")
      .attr("cx", w / 2).attr("cy", h / 2).attr("r", ARCTIC_R);
    defs.append("clipPath").attr("id", "ice-mask-clip")
      .append("path")
      .attr("id", "ice-mask-path");

    const mapGroup = tempSvg.append("g").attr("clip-path", "url(#arctic-clip)");

    // Use countries-110m.json — has both 'land' and 'countries' objects
    d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json")
      .then(world => {
        // Layer order (SVG bottom → top):
        // 1) Choropleth cells — clipped to the circle boundary
        const cellGroup = mapGroup.append("g")
          .attr("id", "choropleth-cells")
          .attr("clip-path", "url(#ice-mask-clip)");

        // 2) Land — semi-transparent so choropleth cells show through
        mapGroup.append("path")
          .datum(topojson.feature(world, world.objects.land))
          .style("fill", "rgba(30,58,24,0.5)")
          .style("stroke", "rgba(255,255,255,0.5)")
          .style("stroke-width", "0.8px")
          .attr("d", tempPath);

        // 3) Country borders
        mapGroup.append("path")
          .datum(topojson.mesh(world, world.objects.countries, (a, b) => a !== b))
          .style("fill", "none")
          .style("stroke", "rgba(255,255,255,0.25)")
          .style("stroke-width", "0.4px")
          .attr("d", tempPath);

        // 4) Graticule
        const grat = d3.geoGraticule().step([30, 10]);
        mapGroup.append("path")
          .datum(grat())
          .attr("class", "graticule")
          .attr("d", tempPath);

        loadTemperatureData(cellGroup, tempProj, tempPath, w, h);
      })
      .catch(err => console.error("❌ World atlas failed:", err));
  }

  function loadTemperatureData(cellGroup, proj, pathGen, w, h) {
    d3.json("downsampled_arctic_data_1980_onwards.json")
      .then(data => {
        if (!data || data.length === 0) return;
        console.log("✅ Temperature data loaded:", data.length, "points");

        const colorScale = d3.scaleLinear()
          .domain([-20, -10, 0, 5, 10])
          .range(["#ffffff", "#c8e6ff", "#ffddaa", "#ff6b30", "#cc0000"])
          .clamp(true);

        const years = [...new Set(data.map(d => d.year))].sort((a, b) => a - b);
        const displayYears = years;
        let currentYear = displayYears[0];

        async function updateIceClip(year) {
          const maskYear = 1980;

          const ice = await d3.json(`${maskYear}.json`);
          const converted = convert3413toWGS84(ice);

          const merged = converted.type === "FeatureCollection"
            ? featureCollectionToMultiPolygon(converted)
            : converted;

          // 중요: D3가 polygon을 지구 반대쪽으로 해석하는 것 방지
          if (merged.geometry && merged.geometry.type === "MultiPolygon") {
            merged.geometry.coordinates.forEach(poly => {
              const dummy = { type: "Polygon", coordinates: poly };
              if (d3.geoArea(dummy) > 2 * Math.PI) {
                poly.forEach(ring => ring.reverse());
              }
            });
          }

          d3.select("#ice-mask-path")
            .datum(merged)
            .attr("d", pathGen);
        }

        // Project each lon/lat point to SVG pixel coords and draw circles.
        // Circles are rotation-agnostic so they look correct on any polar projection.
        async function drawYear(year) {
          await updateIceClip(year);

          const yearData = data.filter(d => d.year === year);

          const pA = proj([0, 75]);
          const pB = proj([5, 75]);
          const pC = proj([0, 75]);
          const pD = proj([0, 78.77]);

          const rW = pA && pB ? Math.hypot(pB[0]-pA[0], pB[1]-pA[1]) / 2 + 1 : 6;
          const rH = pC && pD ? Math.hypot(pD[0]-pC[0], pD[1]-pC[1]) / 2 + 1 : 6;
          const r = Math.max(rW, rH);

          const projected = yearData.map(d => {
            const lon = d.lon > 180 ? d.lon - 360 : d.lon;
            const xy = proj([lon, d.lat]);
            if (!xy) return null;
            return { xy, temp: d.temp_absolute };
          }).filter(Boolean);

          cellGroup.selectAll(".temp-cell")
            .data(projected)
            .join("rect")
            .attr("class", "temp-cell")
            .attr("x", d => d.xy[0] - r)
            .attr("y", d => d.xy[1] - r)
            .attr("width", r * 2)
            .attr("height", r * 2)
            .style("fill", d => colorScale(d.temp))
            .style("opacity", 0.72)
            .style("stroke", "none");
        }

        drawYear(currentYear);

        // const svgEl = d3.select("#temp-map-container svg");
        // svgEl.append("text")
        //   .attr("id", "temp-year-text")
        //   .attr("x", 44).attr("y", 66)
        //   .style("font-family", "var(--serif)")
        //   .style("font-size",   "3.2rem")
        //   .style("font-weight", "900")
        //   .style("fill", "#ffffff")
        //   .text(currentYear);

        const slider = document.getElementById("year-slider");
        const yearDisplay = document.getElementById("temp-year-display");
        if (slider) {
          slider.min   = 0;
          slider.max   = displayYears.length - 1;
          slider.step  = 1;
          slider.value = 0;
          slider.addEventListener("input", function () {
            currentYear = displayYears[+this.value];
            if (yearDisplay) yearDisplay.textContent = currentYear;
            // svgEl.select("#temp-year-text").text(currentYear);
            drawYear(currentYear);
          });
        }
        if (yearDisplay) yearDisplay.textContent = currentYear;

        const wrapper = d3.select("#temp-map-container");
        const legend  = wrapper.append("div").attr("class", "temp-legend");
        legend.html(`
          <div style="font-weight:bold;margin-bottom:6px;color:#fff;">
            Polar Bear Heat Comfort
          </div>
          <div class="stress-gradient"></div>
          <div class="stress-labels">
            <span>−20°C</span>
            <span>-10°C</span>
            <span>0°C</span>
            <span>5°C</span>
            <span>10°C</span>
          </div>
          <div class="stress-note">
            White = safe cold · Orange = stress · Red = danger
          </div>
        `);
      })
      .catch(err => console.error("❌ Could not load Arctic temperature data:", err));
  }

  initTemperatureMap();

})();
