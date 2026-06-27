// Jet Lag Game Region & Stations Renderer
// State Management
const state = {
    stations: [],
    gameRegion: null,
    enabledHidingRegions: new Set(),
    circles: [],
    thermometers: [],
    editMode: false,
    globalRegionsVisible: true,
    activeDatasets: new Set(['bus', 'metro']), // 'bus' and 'metro'
    currentTheme: 'light', // Light themed by default
    selectedStationId: null,
    hoveredStationId: null,
    searchQuery: '',
    profiles: [], // saved views
    activeProfileId: null, // selected view profile
    hasRestoredView: false // Tracks if viewport was restored from last-session state
};

// Map Styles URLs
const MAP_STYLES = {
    dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
};

// Initialize Map with Light theme as default
const map = new maplibregl.Map({
    container: 'map',
    style: MAP_STYLES.light,
    center: [-118.358, 34.05], // Fallback center (Los Angeles)
    zoom: 10,
    attributionControl: true
});

// Add Navigation Controls (Zoom In/Out/Compass)
map.addControl(new maplibregl.NavigationControl({
    showCompass: true,
    visualizePitch: true
}), 'top-right');

// Synchronization Flags
let isMapReady = false;
let dataLoaded = false;

// Circle editing state
let circleMarkers = new Map();
let nextCircleId = 1;
let addingCircleMode = false;

let thermometerMarkers = new Map(); // id → { p1, p2 }
let nextThermometerId = 1;
let addingThermometerMode = false;
let pendingThermometerPoint = null;
let pendingThermometerMarker = null;

// DOM Elements
const stationSearch = document.getElementById('station-search');
const clearSearchBtn = document.getElementById('clear-search');
const globalRegionsToggle = document.getElementById('global-regions-toggle');
const datasetBusToggle = document.getElementById('dataset-bus-toggle');
const datasetMetroToggle = document.getElementById('dataset-metro-toggle');
const btnFitBounds = document.getElementById('btn-fit-bounds');
const btnResetMap = document.getElementById('btn-reset-map');
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const statTotalStations = document.getElementById('stat-total-stations');
const statActiveRegions = document.getElementById('stat-active-regions');
const stationsListContainer = document.getElementById('stations-list-container');
const visibleStationsCount = document.getElementById('visible-stations-count');

// Profile DOM Elements
const btnCreateProfile = document.getElementById('btn-create-profile');
const profilesListContainer = document.getElementById('profiles-list-container');

// Active popup tracker
let activePopup = null;

// Initialize App
async function init() {
    try {
        // Load profiles
        loadProfiles();

        // Restore view settings from localStorage before loading map components
        restoreLastSessionState();

        // Load data in parallel
        const [regionData, stationsData, metroData] = await Promise.all([
            fetch('game-region.geojson').then(r => {
                if (!r.ok) throw new Error('Failed to load game-region.geojson');
                return r.json();
            }),
            fetch('stations.geojson').then(r => {
                if (!r.ok) throw new Error('Failed to load stations.geojson');
                return r.json();
            }),
            fetch('trains.geojson').then(r => {
                if (!r.ok) throw new Error('Failed to load trains.geojson');
                return r.json();
            })
        ]);

        state.gameRegion = regionData;
        
        // Setup original Game Stations Data
        const gameStations = stationsData.features.map((feature, idx) => {
            const id = idx + 1;
            return {
                ...feature,
                id: id,
                properties: {
                    ...feature.properties,
                    id: id,
                    Name: feature.properties.Name || `Station ${id}`,
                    dataset: 'bus'
                }
            };
        });

        // Setup imported LA Metro Stations Data
        const startId = gameStations.length + 1;
        const metroStations = metroData.features.map((feature, idx) => {
            const id = startId + idx;
            return {
                ...feature,
                id: id,
                properties: {
                    ...feature.properties,
                    id: id,
                    Name: feature.properties.STOP_NAME || `Metro Station ${id}`,
                    dataset: 'metro'
                }
            };
        });

        // Merge datasets
        state.stations = [...gameStations, ...metroStations];

        // All hiding zones on by default
        state.stations.forEach(s => state.enabledHidingRegions.add(s.id));

        // Build Combined GeoJSON for MapLibre
        state.stationsGeoJson = {
            type: 'FeatureCollection',
            features: state.stations
        };

        // Initialize Stats
        updateStats();

        // Initialize UI lists
        renderStationList();
        renderProfilesList();
        setupEventListeners();

        // Mark data as loaded and try setting up map layers
        dataLoaded = true;
        trySetupMap();

    } catch (error) {
        console.error('Error initializing application:', error);
        stationsListContainer.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-circle-exclamation" style="color: var(--accent-red)"></i>
                <span>Failed to load game data. Please verify the geojson files exist in the workspace.</span>
                <p style="font-size: 11px; margin-top: 5px; color: var(--text-muted);">${error.message}</p>
            </div>
        `;
    }
}

// Session Persistence Management
function saveCurrentViewState() {
    if (!isMapReady) return;
    try {
        const centerObj = map.getCenter();
        const stateToSave = {
            center: [centerObj.lng, centerObj.lat],
            zoom: map.getZoom(),
            globalRegionsVisible: state.globalRegionsVisible,
            activeDatasets: Array.from(state.activeDatasets),
            theme: state.currentTheme
        };
        localStorage.setItem('jet-lag-last-view', JSON.stringify(stateToSave));
    } catch (err) {
        console.error('Error saving current view state:', err);
    }
}

function restoreLastSessionState() {
    try {
        const saved = localStorage.getItem('jet-lag-last-view');
        if (saved) {
            const view = JSON.parse(saved);
            state.globalRegionsVisible = typeof view.globalRegionsVisible === 'boolean' ? view.globalRegionsVisible : true;

            const restoredDatasets = Array.isArray(view.activeDatasets)
                ? view.activeDatasets.filter(dataset => dataset === 'bus' || dataset === 'metro')
                : [];
            state.activeDatasets = restoredDatasets.length > 0
                ? new Set(restoredDatasets)
                : new Set(['bus', 'metro']);
            
            // Restore theme state if saved
            if (view.theme === 'dark' || view.theme === 'light') {
                state.currentTheme = view.theme;
                if (state.currentTheme === 'dark') {
                    document.body.classList.add('dark-theme');
                } else {
                    document.body.classList.remove('dark-theme');
                }
                map.setStyle(MAP_STYLES[state.currentTheme]);
            }
            
            // Set UI inputs checkboxes values
            globalRegionsToggle.checked = state.globalRegionsVisible;
            datasetBusToggle.checked = state.activeDatasets.has('bus');
            datasetMetroToggle.checked = state.activeDatasets.has('metro');
            
            // Pre-position map view coordinates
            map.jumpTo({
                center: view.center,
                zoom: view.zoom
            });
            
            state.hasRestoredView = true;
        }
    } catch (err) {
        console.error('Error restoring last session state:', err);
    }
}

// Profile Storage & Management
function loadProfiles() {
    try {
        const stored = localStorage.getItem('jet-lag-profiles');
        if (stored) state.profiles = JSON.parse(stored);
    } catch (err) {
        console.error('Error loading profiles:', err);
    }
    if (state.profiles.length === 0) {
        state.profiles = [{
            id: 'default',
            name: 'Default',
            center: [-118.287, 34.05],
            zoom: 10.2,
            globalRegionsVisible: true,
            activeDatasets: ['bus', 'metro'],
            circles: []
        }];
        saveProfiles();
    }
    // Always be in a profile — activate the first one on load
    state.activeProfileId = state.profiles[0].id;

    // Restore state from the active profile
    const active = state.profiles[0];
    state.circles = (active.circles || []).map(c => ({ ...c }));
    if (active.circles?.length > 0) {
        nextCircleId = Math.max(...active.circles.map(c => parseInt(c.id.replace('c', '')) || 0)) + 1;
    }
    state.thermometers = (active.thermometers || []).map(t => ({ ...t }));
    if (active.thermometers?.length > 0) {
        nextThermometerId = Math.max(...active.thermometers.map(t => parseInt(t.id.replace('th', '')) || 0)) + 1;
    }
}

function saveProfiles() {
    try {
        localStorage.setItem('jet-lag-profiles', JSON.stringify(state.profiles));
    } catch (err) {
        console.error('Error saving profiles:', err);
    }
}

function renderProfilesList() {
    if (!profilesListContainer) return;
    
    if (state.profiles.length === 0) {
        profilesListContainer.innerHTML = `
            <div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 12px 0;">
                No saved profiles. Click "+ Save View" to save your current view.
            </div>
        `;
        return;
    }
    
    profilesListContainer.innerHTML = '';
    
    state.profiles.forEach(profile => {
        const isActive = state.activeProfileId === profile.id;
        const item = document.createElement('div');
        item.className = `profile-item ${isActive ? 'active' : ''}`;
        item.dataset.id = profile.id;
        
        item.innerHTML = `
            <div class="profile-name-container">
                <span class="profile-name" title="${profile.name}">${profile.name}</span>
            </div>
            <div class="profile-actions" onclick="event.stopPropagation()">
                <button class="profile-action-btn rename" title="Rename Profile">
                    <i class="fa-solid fa-pencil"></i>
                </button>
                <button class="profile-action-btn delete" title="Delete Profile">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        `;
        
        // Click to apply profile
        item.addEventListener('click', () => {
            applyProfile(profile.id);
        });
        
        // Rename profile button
        const btnRename = item.querySelector('.rename');
        btnRename.addEventListener('click', (e) => {
            e.stopPropagation();
            startProfileRename(profile.id, item);
        });
        
        // Delete profile button
        const btnDelete = item.querySelector('.delete');
        btnDelete.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteProfile(profile.id);
        });
        
        profilesListContainer.appendChild(item);
    });
}

function startProfileRename(profileId, itemElement) {
    const profile = state.profiles.find(p => p.id === profileId);
    if (!profile) return;
    
    const nameContainer = itemElement.querySelector('.profile-name-container');
    const prevHTML = nameContainer.innerHTML;
    
    nameContainer.innerHTML = `<input type="text" class="profile-input" value="${profile.name}">`;
    const input = nameContainer.querySelector('.profile-input');
    input.focus();
    input.select();
    
    let finished = false;
    
    const finishRename = () => {
        if (finished) return;
        finished = true;
        
        const newName = input.value.trim() || profile.name;
        profile.name = newName;
        saveProfiles();
        renderProfilesList();
    };
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            finishRename();
        } else if (e.key === 'Escape') {
            finished = true;
            nameContainer.innerHTML = prevHTML;
            renderProfilesList();
        }
    });
    
    input.addEventListener('blur', finishRename);
}

function applyProfile(profileId) {
    const profile = state.profiles.find(p => p.id === profileId);
    if (!profile) return;
    
    state.activeProfileId = profileId;
    
    // Smooth fly to the coordinates
    map.flyTo({
        center: profile.center,
        zoom: profile.zoom,
        essential: true,
        duration: 1000
    });
    
    // Restore settings
    state.globalRegionsVisible = profile.globalRegionsVisible;
    state.activeDatasets = new Set(profile.activeDatasets);
    state.circles = (profile.circles || []).map(c => ({ ...c }));
    state.thermometers = (profile.thermometers || []).map(t => ({ ...t }));

    // Update inputs check state
    globalRegionsToggle.checked = state.globalRegionsVisible;
    datasetBusToggle.checked = state.activeDatasets.has('bus');
    datasetMetroToggle.checked = state.activeDatasets.has('metro');
    
    // Apply map layers visibilities
    if (isMapReady) {
        map.setLayoutProperty('hiding-regions-fill', 'visibility', state.globalRegionsVisible ? 'visible' : 'none');
        map.setLayoutProperty('hiding-regions-stroke', 'visibility', state.globalRegionsVisible ? 'visible' : 'none');
        map.setLayoutProperty('game-region-outside-fill', 'visibility', 'visible');
        map.setLayoutProperty('game-region-border', 'visibility', 'visible');
        
        // Force update hiding region sources and map layers
        map.getSource('hiding-regions').setData(generateHidingRegionsGeoJson());
        applyFiltersToMap();
        onCirclesChanged();
        onThermometersChanged();
    }

    renderStationList();
    updateStats();
    renderProfilesList();
    saveCurrentViewState(); // Save View state as active session setting
}

function createProfile() {
    const centerObj = map.getCenter();
    const center = [centerObj.lng, centerObj.lat];
    const zoom = map.getZoom();
    const id = Date.now().toString();
    
    const newProfile = {
        id: id,
        name: `Profile ${state.profiles.length + 1}`,
        center: center,
        zoom: zoom,
        globalRegionsVisible: state.globalRegionsVisible,
        activeDatasets: Array.from(state.activeDatasets),
        circles: state.circles.map(c => ({ ...c })),
        thermometers: state.thermometers.map(t => ({ ...t }))
    };

    state.profiles.push(newProfile);
    state.activeProfileId = id;
    
    saveProfiles();
    renderProfilesList();
}

function deleteProfile(profileId) {
    state.profiles = state.profiles.filter(p => p.id !== profileId);
    if (state.profiles.length === 0) {
        state.profiles = [{
            id: 'default',
            name: 'Default',
            center: [-118.287, 34.05],
            zoom: 10.2,
            globalRegionsVisible: true,
            activeDatasets: ['bus', 'metro'],
            circles: []
        }];
    }
    if (state.activeProfileId === profileId) {
        state.activeProfileId = state.profiles[0].id;
        applyProfile(state.activeProfileId);
    }
    saveProfiles();
    renderProfilesList();
}

function saveToActiveProfile() {
    const profile = state.profiles.find(p => p.id === state.activeProfileId);
    if (!profile || !isMapReady) return;
    const c = map.getCenter();
    profile.center = [c.lng, c.lat];
    profile.zoom = map.getZoom();
    profile.globalRegionsVisible = state.globalRegionsVisible;
    profile.activeDatasets = Array.from(state.activeDatasets);
    profile.circles = state.circles.map(c => ({ ...c }));
    profile.thermometers = state.thermometers.map(t => ({ ...t }));
    saveProfiles();
}

function handleManualUIChange() {
    saveToActiveProfile();
    saveCurrentViewState();
}

// Generate buffer circles using Turf.js
function generateHidingRegionsGeoJson() {
    const features = [];
    
    state.stations.forEach(station => {
        // Only generate buffer if the station's dataset is active AND its hiding region is enabled
        if (state.activeDatasets.has(station.properties.dataset) && state.enabledHidingRegions.has(station.id)) {
            const coords = station.geometry.coordinates.slice(0, 2);
            try {
                // Turf circle creates a perfect 0.25 mile radius polygon
                const circle = turf.circle(coords, 0.25, {
                    units: 'miles',
                    properties: {
                        stationId: station.id,
                        stationName: station.properties.Name,
                        dataset: station.properties.dataset
                    }
                });
                features.push(circle);
            } catch (err) {
                console.error(`Error generating buffer for station ${station.id}:`, err);
            }
        }
    });

    return {
        type: 'FeatureCollection',
        features: features
    };
}

// Build a world polygon with the active zone cut out.
// Passing null (contradiction) shades the entire map.
function buildOutsideMask(activeZoneGeoJson) {
    const world = turf.polygon([[[-180, -85.051129], [180, -85.051129], [180, 85.051129], [-180, 85.051129], [-180, -85.051129]]]);
    if (!activeZoneGeoJson) return world;
    let zone = activeZoneGeoJson;
    if (zone.type === 'FeatureCollection') zone = zone.features[0];
    else if (zone.type !== 'Feature') zone = turf.feature(zone);
    return turf.difference(world, zone) || world;
}

// ── Circle helpers ────────────────────────────────────────────────────────────

function normalizeToFeature(geoJson) {
    if (geoJson.type === 'Feature') return geoJson;
    if (geoJson.type === 'FeatureCollection') return geoJson.features[0];
    return turf.feature(geoJson);
}

// Returns the half-plane polygon on the "active" side of a thermometer clue.
// "hotter" → target is closer to point1 → keep point1's side of the bisector.
// "colder" → target is closer to point2 → keep point2's side.
function thermometerHalfPlane(t) {
    const [x1, y1] = t.point1;
    const [x2, y2] = t.point2;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-10) return null;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    // Unit perpendicular to P1→P2 (bisector direction)
    const nx = -dy / len, ny = dx / len;
    const ext = 500; // degrees – enough to cover the world
    const far = ext * 2;
    // "hotter" = latter point (point2) is closer to target → keep point2's side
    // "colder" = former point (point1) is closer to target → keep point1's side
    const toP2 = [dx / len, dy / len];
    const sideDir = t.type === 'hotter' ? toP2 : [-dx / len, -dy / len];
    const b1 = [mx + nx * ext, my + ny * ext];
    const b2 = [mx - nx * ext, my - ny * ext];
    return turf.polygon([[
        [b1[0] + sideDir[0] * far, b1[1] + sideDir[1] * far],
        [b2[0] + sideDir[0] * far, b2[1] + sideDir[1] * far],
        b2, b1,
        [b1[0] + sideDir[0] * far, b1[1] + sideDir[1] * far],
    ]]);
}

function computeActiveZone() {
    let zone = normalizeToFeature(state.gameRegion);
    for (const c of state.circles.filter(c => c.type === 'hit')) {
        const circ = turf.circle(c.center, c.radiusMiles, { units: 'miles', steps: 64 });
        const result = turf.intersect(zone, circ);
        if (!result) return null;
        zone = result;
    }
    for (const c of state.circles.filter(c => c.type === 'miss')) {
        const circ = turf.circle(c.center, c.radiusMiles, { units: 'miles', steps: 64 });
        const result = turf.difference(zone, circ);
        if (!result) return null;
        zone = result;
    }
    for (const t of state.thermometers) {
        const half = thermometerHalfPlane(t);
        if (!half) continue;
        const result = turf.intersect(zone, half);
        if (!result) return null;
        zone = result;
    }
    return zone;
}

function buildCirclesGeoJson() {
    return {
        type: 'FeatureCollection',
        features: state.circles.map(c => {
            const f = turf.circle(c.center, c.radiusMiles, { units: 'miles', steps: 64 });
            f.properties = { id: c.id, type: c.type };
            return f;
        })
    };
}

// ── Thermometer helpers ───────────────────────────────────────────────────────

function buildThermometersGeoJson() {
    const features = [];
    for (const t of state.thermometers) {
        const [x1, y1] = t.point1;
        const [x2, y2] = t.point2;
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);

        // Chord between the two points
        features.push({
            type: 'Feature',
            properties: { id: t.id, featureType: 'chord', thermoType: t.type },
            geometry: { type: 'LineString', coordinates: [t.point1, t.point2] }
        });

        // Perpendicular bisector (extended to cover map)
        if (len > 1e-10) {
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            const nx = -dy / len, ny = dx / len;
            const ext = 100;
            features.push({
                type: 'Feature',
                properties: { id: t.id, featureType: 'bisector', thermoType: t.type },
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [mx + nx * ext, my + ny * ext],
                        [mx - nx * ext, my - ny * ext]
                    ]
                }
            });
        }
    }
    return { type: 'FeatureCollection', features };
}

function onThermometersChanged() {
    if (!isMapReady) return;
    map.getSource('thermometers')?.setData(buildThermometersGeoJson());
    const activeZone = computeActiveZone();
    map.getSource('game-region-outside')?.setData(buildOutsideMask(activeZone));
    syncThermometerMarkers();
    updateStats();
    renderThermometersList();
    renderStationList();
    saveToActiveProfile();
}

function syncThermometerMarkers() {
    // Remove markers for deleted thermometers
    for (const [id, m] of thermometerMarkers) {
        if (!state.thermometers.find(t => t.id === id)) {
            m.p1.remove(); m.p2.remove();
            thermometerMarkers.delete(id);
        }
    }
    if (!state.editMode) {
        for (const [, m] of thermometerMarkers) { m.p1.remove(); m.p2.remove(); }
        thermometerMarkers.clear();
        return;
    }
    for (const t of state.thermometers) {
        if (thermometerMarkers.has(t.id)) {
            const m = thermometerMarkers.get(t.id);
            m.p1.setLngLat(t.point1);
            m.p2.setLngLat(t.point2);
        } else {
            const color = t.type === 'hotter' ? '#ef4444' : '#3b82f6';
            const p1El = document.createElement('div');
            p1El.className = 'thermo-marker thermo-p1';
            p1El.style.background = color;
            const p1Marker = new maplibregl.Marker({ element: p1El, draggable: true })
                .setLngLat(t.point1).addTo(map);

            const p2El = document.createElement('div');
            p2El.className = 'thermo-marker thermo-p2';
            p2El.style.background = color;
            const p2Marker = new maplibregl.Marker({ element: p2El, draggable: true })
                .setLngLat(t.point2).addTo(map);

            const id = t.id;
            const refresh = () => {
                map.getSource('thermometers')?.setData(buildThermometersGeoJson());
                const az = computeActiveZone();
                map.getSource('game-region-outside')?.setData(buildOutsideMask(az));
            };
            p1Marker.on('drag', () => {
                const th = state.thermometers.find(x => x.id === id);
                if (!th) return;
                const ll = p1Marker.getLngLat();
                th.point1 = [ll.lng, ll.lat];
                refresh();
            });
            p1Marker.on('dragend', () => { updateStats(); renderThermometersList(); saveToActiveProfile(); });

            p2Marker.on('drag', () => {
                const th = state.thermometers.find(x => x.id === id);
                if (!th) return;
                const ll = p2Marker.getLngLat();
                th.point2 = [ll.lng, ll.lat];
                refresh();
            });
            p2Marker.on('dragend', () => { updateStats(); renderThermometersList(); saveToActiveProfile(); });

            thermometerMarkers.set(id, { p1: p1Marker, p2: p2Marker });
        }
    }
}

function addThermometer(point1, point2) {
    const id = `th${nextThermometerId++}`;
    state.thermometers.push({ id, point1, point2, type: 'hotter' });
    onThermometersChanged();
}

function deleteThermometer(id) {
    state.thermometers = state.thermometers.filter(t => t.id !== id);
    onThermometersChanged();
}

function updateThermometer(id, changes) {
    const t = state.thermometers.find(t => t.id === id);
    if (!t) return;
    Object.assign(t, changes);
    onThermometersChanged();
}

function renderThermometersList() {
    const container = document.getElementById('thermometers-list-container');
    if (!container) return;
    if (state.thermometers.length === 0) {
        container.innerHTML = '<div class="empty-state-small" style="padding:8px 0;font-size:11px;color:var(--text-muted)">No thermometers. Click + Add then click two points.</div>';
        return;
    }
    container.innerHTML = '';
    state.thermometers.forEach((t, idx) => {
        const item = document.createElement('div');
        item.className = 'circle-item';
        item.dataset.id = t.id;
        item.innerHTML = `
            <div class="circle-item-header">
                <span class="circle-index">#${idx + 1}</span>
                <div class="circle-type-btns">
                    <button class="circle-type-btn hit ${t.type === 'hotter' ? 'active' : ''}" data-type="hotter" style="--active-bg:#ef4444">Hotter</button>
                    <button class="circle-type-btn miss ${t.type === 'colder' ? 'active' : ''}" data-type="colder" style="--active-bg:#3b82f6">Colder</button>
                </div>
                <button class="circle-delete-btn" title="Delete">×</button>
            </div>`;
        item.querySelectorAll('.circle-type-btn').forEach(btn =>
            btn.addEventListener('click', () => {
                updateThermometer(t.id, { type: btn.dataset.type });
                if (state.editMode) {
                    // recolor markers
                    const m = thermometerMarkers.get(t.id);
                    if (m) {
                        const color = btn.dataset.type === 'hotter' ? '#ef4444' : '#3b82f6';
                        m.p1.getElement().style.background = color;
                        m.p2.getElement().style.background = color;
                    }
                }
            })
        );
        item.querySelector('.circle-delete-btn').addEventListener('click', () => deleteThermometer(t.id));
        container.appendChild(item);
    });
}

function getRadiusHandlePos(circle) {
    return turf.destination(circle.center, circle.radiusMiles, 90, { units: 'miles' }).geometry.coordinates;
}

function radiusToDisplay(miles, unit) {
    if (unit === 'feet') return miles * 5280;
    if (unit === 'kilometers') return miles * 1.60934;
    return miles;
}

function radiusFromDisplay(val, unit) {
    if (unit === 'feet') return val / 5280;
    if (unit === 'kilometers') return val / 1.60934;
    return val;
}

function onCirclesChanged() {
    if (!isMapReady) return;
    const src = map.getSource('circles');
    if (src) src.setData(buildCirclesGeoJson());
    const activeZone = computeActiveZone();
    const maskSrc = map.getSource('game-region-outside');
    if (maskSrc) maskSrc.setData(buildOutsideMask(activeZone));
    syncCircleMarkers();
    updateStats();
    renderStationList();
    renderCirclesList();
    saveToActiveProfile();
}

function applyEditModeVisuals(active) {
    const dim = active ? 0.12 : null;
    const layers = [
        ['stations-circle',       'circle-opacity',        dim ?? 1],
        ['stations-circle',       'circle-stroke-opacity', dim ?? 1],
        ['stations-number',       'text-opacity',          dim ?? 1],
        ['hiding-regions-fill',   'fill-opacity',          active ? 0.04 : 0.15],
        ['hiding-regions-stroke', 'line-opacity',          dim ?? 0.4],
        ['game-region-border',    'line-opacity',          dim ?? 0.95],
    ];
    for (const [id, prop, val] of layers) {
        if (map.getLayer(id)) map.setPaintProperty(id, prop, val);
    }
}

function syncCircleMarkers() {
    // Remove markers for deleted circles
    for (const [id, markers] of circleMarkers) {
        if (!state.circles.find(c => c.id === id)) {
            markers.center.remove();
            markers.handle.remove();
            circleMarkers.delete(id);
        }
    }
    if (!state.editMode) {
        for (const [, markers] of circleMarkers) {
            markers.center.remove();
            markers.handle.remove();
        }
        circleMarkers.clear();
        return;
    }
    for (const c of state.circles) {
        if (circleMarkers.has(c.id)) {
            const m = circleMarkers.get(c.id);
            m.center.setLngLat(c.center);
            m.handle.setLngLat(getRadiusHandlePos(c));
        } else {
            const centerEl = document.createElement('div');
            centerEl.className = 'circle-center-marker';
            const centerMarker = new maplibregl.Marker({ element: centerEl, draggable: true })
                .setLngLat(c.center).addTo(map);

            const handleEl = document.createElement('div');
            handleEl.className = 'circle-handle-marker';
            const handleMarker = new maplibregl.Marker({ element: handleEl, draggable: true })
                .setLngLat(getRadiusHandlePos(c)).addTo(map);

            const id = c.id;
            centerMarker.on('drag', () => {
                const circle = state.circles.find(x => x.id === id);
                if (!circle) return;
                const ll = centerMarker.getLngLat();
                circle.center = [ll.lng, ll.lat];
                handleMarker.setLngLat(getRadiusHandlePos(circle));
                map.getSource('circles')?.setData(buildCirclesGeoJson());
                const az = computeActiveZone();
                map.getSource('game-region-outside')?.setData(buildOutsideMask(az));
            });
            centerMarker.on('dragend', () => { updateStats(); renderCirclesList(); });

            handleMarker.on('drag', () => {
                const circle = state.circles.find(x => x.id === id);
                if (!circle) return;
                const ll = handleMarker.getLngLat();
                circle.radiusMiles = Math.max(0.01, turf.distance(circle.center, [ll.lng, ll.lat], { units: 'miles' }));
                map.getSource('circles')?.setData(buildCirclesGeoJson());
                const az = computeActiveZone();
                map.getSource('game-region-outside')?.setData(buildOutsideMask(az));
            });
            handleMarker.on('dragend', () => {
                const circle = state.circles.find(x => x.id === id);
                if (circle) handleMarker.setLngLat(getRadiusHandlePos(circle));
                updateStats(); renderCirclesList();
            });

            circleMarkers.set(id, { center: centerMarker, handle: handleMarker });
        }
    }
}

function addCircleAtPoint(lngLat) {
    const id = `c${nextCircleId++}`;
    state.circles.push({ id, center: [lngLat.lng, lngLat.lat], radiusMiles: 10, displayUnit: 'miles', type: 'miss' });
    onCirclesChanged();
}

function updateCircle(id, changes) {
    const circle = state.circles.find(c => c.id === id);
    if (!circle) return;
    Object.assign(circle, changes);
    onCirclesChanged();
}

function deleteCircle(id) {
    if (circleMarkers.has(id)) {
        circleMarkers.get(id).center.remove();
        circleMarkers.get(id).handle.remove();
        circleMarkers.delete(id);
    }
    state.circles = state.circles.filter(c => c.id !== id);
    onCirclesChanged();
}

function renderCirclesList() {
    const container = document.getElementById('circles-list-container');
    if (!container) return;
    if (state.circles.length === 0) {
        container.innerHTML = '<div class="empty-state-small" style="padding:8px 0;font-size:11px;color:var(--text-muted)">No circles. Click + Add then click the map.</div>';
        return;
    }
    container.innerHTML = '';
    state.circles.forEach((c, idx) => {
        const item = document.createElement('div');
        item.className = 'circle-item';
        item.dataset.id = c.id;
        const dispVal = radiusToDisplay(c.radiusMiles, c.displayUnit);
        item.innerHTML = `
            <div class="circle-item-header">
                <span class="circle-index">#${idx + 1}</span>
                <div class="circle-type-btns">
                    <button class="circle-type-btn hit ${c.type === 'hit' ? 'active' : ''}" data-type="hit">Hit</button>
                    <button class="circle-type-btn miss ${c.type === 'miss' ? 'active' : ''}" data-type="miss">Miss</button>
                </div>
                <button class="circle-delete-btn" title="Delete">×</button>
            </div>
            <div class="circle-radius-row">
                <input type="number" class="circle-radius-input" value="${dispVal.toFixed(dispVal < 10 ? 3 : 1)}" min="0.001" step="any">
                <select class="circle-unit-select">
                    <option value="miles" ${c.displayUnit === 'miles' ? 'selected' : ''}>mi</option>
                    <option value="feet" ${c.displayUnit === 'feet' ? 'selected' : ''}>ft</option>
                    <option value="kilometers" ${c.displayUnit === 'kilometers' ? 'selected' : ''}>km</option>
                </select>
            </div>`;

        item.querySelectorAll('.circle-type-btn').forEach(btn =>
            btn.addEventListener('click', () => updateCircle(c.id, { type: btn.dataset.type }))
        );
        item.querySelector('.circle-delete-btn').addEventListener('click', () => deleteCircle(c.id));

        const radiusInput = item.querySelector('.circle-radius-input');
        const unitSelect = item.querySelector('.circle-unit-select');

        radiusInput.addEventListener('change', () => {
            const val = parseFloat(radiusInput.value);
            if (!isNaN(val) && val > 0)
                updateCircle(c.id, { radiusMiles: radiusFromDisplay(val, unitSelect.value), displayUnit: unitSelect.value });
        });
        unitSelect.addEventListener('change', () => {
            const cur = state.circles.find(x => x.id === c.id);
            if (cur) {
                updateCircle(c.id, { displayUnit: unitSelect.value });
                radiusInput.value = radiusToDisplay(cur.radiusMiles, unitSelect.value).toFixed(3);
            }
        });

        container.appendChild(item);
    });
}

// ─────────────────────────────────────────────────────────────────────────────

// Setup Sources and Layers on Map
function setupMapLayers() {
    isMapReady = true;

    // 1. Add sources
    if (!map.getSource('game-region')) {
        map.addSource('game-region', {
            type: 'geojson',
            data: state.gameRegion
        });
    }

    if (!map.getSource('hiding-regions')) {
        map.addSource('hiding-regions', {
            type: 'geojson',
            data: generateHidingRegionsGeoJson()
        });
    }

    if (!map.getSource('stations')) {
        map.addSource('stations', {
            type: 'geojson',
            data: state.stationsGeoJson,
            promoteId: 'id' // Promotes the 'id' field in properties to feature.id
        });
    }

    // 2. Add Game Region Layers
    if (!map.getSource('game-region-outside')) {
        map.addSource('game-region-outside', {
            type: 'geojson',
            data: buildOutsideMask(state.gameRegion)
        });
    }

    if (!map.getLayer('game-region-outside-fill')) {
        map.addLayer({
            id: 'game-region-outside-fill',
            type: 'fill',
            source: 'game-region-outside',
            paint: {
                'fill-color': state.currentTheme === 'dark' ? '#000000' : '#94a3b8',
                'fill-opacity': 0.35
            },
            layout: {
                'visibility': 'visible'
            }
        });
    }

    if (!map.getLayer('game-region-border')) {
        map.addLayer({
            id: 'game-region-border',
            type: 'line',
            source: 'game-region',
            paint: {
                'line-color': state.currentTheme === 'dark' ? '#f8fafc' : '#0f172a',
                'line-width': 4,
                'line-opacity': 0.95
            },
            layout: {
                'visibility': 'visible'
            }
        });
    }

    // 3. Add Hiding Region Layers (0.25 mile buffer)
    if (!map.getLayer('hiding-regions-fill')) {
        map.addLayer({
            id: 'hiding-regions-fill',
            type: 'fill',
            source: 'hiding-regions',
            paint: {
                'fill-color': '#ff7b00',
                'fill-opacity': 0.16
            },
            layout: {
                'visibility': state.globalRegionsVisible ? 'visible' : 'none'
            }
        });
    }

    if (!map.getLayer('hiding-regions-stroke')) {
        map.addLayer({
            id: 'hiding-regions-stroke',
            type: 'line',
            source: 'hiding-regions',
            paint: {
                'line-color': '#ff7b00',
                'line-width': 1.5,
                'line-opacity': 0.6,
                'line-dasharray': [2, 1]
            },
            layout: {
                'visibility': state.globalRegionsVisible ? 'visible' : 'none'
            }
        });
    }

    // 4. Add Station Layers - styled in light blue (glow & circles)
    if (!map.getLayer('stations-glow')) {
        map.addLayer({
            id: 'stations-glow',
            type: 'circle',
            source: 'stations',
            paint: {
                'circle-color': '#38bdf8', // Light blue glow
                'circle-radius': 18,
                'circle-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false], 0.35,
                    ['boolean', ['feature-state', 'selected'], false], 0.5,
                    0
                ],
                'circle-blur': 0.55
            }
        });
    }

    if (!map.getLayer('stations-circle')) {
        map.addLayer({
            id: 'stations-circle',
            type: 'circle',
            source: 'stations',
            paint: {
                'circle-color': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], '#000000', // Selected highlights as black
                    '#38bdf8' // Stations are all the same light blue color
                ],
                'circle-radius': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], 12,
                    ['boolean', ['feature-state', 'hover'], false], 11,
                    9.5
                ],
                'circle-stroke-width': 2.5,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-opacity': 1,
                'circle-opacity': 1
            }
        });
    }

    // Number Layer (renders ID text inside the circle)
    if (!map.getLayer('stations-number')) {
        map.addLayer({
            id: 'stations-number',
            type: 'symbol',
            source: 'stations',
            layout: {
                'text-field': ['to-string', ['get', 'id']],
                'text-size': 13.5,
                'text-font': ['Open Sans Bold', 'Noto Sans Regular'],
                'text-offset': [0, -1.55],
                'text-anchor': 'bottom',
                'text-allow-overlap': true,
                'text-ignore-placement': true
            },
            paint: {
                'text-color': state.currentTheme === 'dark' ? '#ffffff' : '#0f172a',
                'text-halo-color': state.currentTheme === 'dark' ? '#0f172a' : '#ffffff',
                'text-halo-width': 2,
                'text-halo-blur': 0.2
            }
        });
    }

    // Label Layer (renders Name text below the circle)
    if (!map.getLayer('stations-label')) {
        map.addLayer({
            id: 'stations-label',
            type: 'symbol',
            source: 'stations',
            layout: {
                'text-field': ['get', 'Name'],
                'text-size': 9.5,
                'text-font': ['Noto Sans Regular', 'Arial Unicode MS Regular'],
                'text-offset': [0, 1.5],
                'text-anchor': 'top',
                'text-max-width': 8,
                'text-padding': 2,
                'text-allow-overlap': false // Collision avoidance for clean labels
            },
            paint: {
                'text-color': state.currentTheme === 'dark' ? '#f3f4f6' : '#1f2937',
                'text-halo-color': state.currentTheme === 'dark' ? '#090a0f' : '#ffffff',
                'text-halo-width': 1.5
            }
        });
    }

    // Circle layers
    if (!map.getSource('circles')) {
        map.addSource('circles', { type: 'geojson', data: buildCirclesGeoJson() });
    }
    if (!map.getLayer('circles-stroke')) {
        map.addLayer({
            id: 'circles-stroke',
            type: 'line',
            source: 'circles',
            paint: {
                'line-color': '#94a3b8',
                'line-width': 1.5,
                'line-opacity': 0.5,
                'line-dasharray': [4, 3]
            }
        });
    }

    // Populate circles source from restored state
    if (state.circles.length > 0) {
        map.getSource('circles')?.setData(buildCirclesGeoJson());
    }
    renderCirclesList();

    // Thermometer layers
    if (!map.getSource('thermometers')) {
        map.addSource('thermometers', { type: 'geojson', data: buildThermometersGeoJson() });
    }
    if (!map.getLayer('thermometer-chords')) {
        map.addLayer({
            id: 'thermometer-chords',
            type: 'line',
            source: 'thermometers',
            filter: ['==', ['get', 'featureType'], 'chord'],
            paint: {
                'line-color': ['match', ['get', 'thermoType'], 'hotter', '#ef4444', '#3b82f6'],
                'line-width': 2,
                'line-opacity': 0.7
            }
        });
    }
    if (!map.getLayer('thermometer-bisectors')) {
        map.addLayer({
            id: 'thermometer-bisectors',
            type: 'line',
            source: 'thermometers',
            filter: ['==', ['get', 'featureType'], 'bisector'],
            paint: {
                'line-color': ['match', ['get', 'thermoType'], 'hotter', '#ef4444', '#3b82f6'],
                'line-width': 1.5,
                'line-opacity': 0.6,
                'line-dasharray': [6, 4]
            }
        });
    }

    // Populate thermometers + recompute mask from full restored state
    {
        const activeZone = computeActiveZone();
        map.getSource('game-region-outside')?.setData(buildOutsideMask(activeZone));
        if (state.thermometers.length > 0) {
            map.getSource('thermometers')?.setData(buildThermometersGeoJson());
        }
    }
    renderThermometersList();

    // Apply filters based on initial state
    applyFiltersToMap();

    // Force call list rendering to sync viewport boundaries
    renderStationList();

    // Fit map bounds to game region on start ONLY if not restoring from a previous session
    if (!state.hasRestoredView) {
        fitMapToBounds();
    } else {
        const bounds = map.getBounds();
        const hasVisibleStation = state.stations.some(station => {
            if (!state.activeDatasets.has(station.properties.dataset)) return false;
            const coords = station.geometry.coordinates;
            return bounds.contains(new maplibregl.LngLat(coords[0], coords[1]));
        });

        if (!hasVisibleStation) {
            fitMapToBounds();
        }
    }

    // Map Event Listeners
    setupMapEvents();
}

// Fit map to boundary coordinates
function fitMapToBounds() {
    if (!state.gameRegion) return;
    try {
        const bounds = turf.bbox(state.gameRegion);
        map.fitBounds(bounds, {
            padding: 40,
            duration: 1200
        });
    } catch (err) {
        console.error('Error fitting bounds:', err);
    }
}

// Map interactions
function setupMapEvents() {
    const interactiveLayers = ['stations-circle', 'stations-number'];
    
    interactiveLayers.forEach(layerId => {
        // Hover event for stations
        map.on('mousemove', layerId, (e) => {
            if (state.editMode) return;
            if (e.features.length > 0) {
                map.getCanvas().style.cursor = 'pointer';
                
                const featureId = e.features[0].id;
                if (state.hoveredStationId !== featureId) {
                    // Clear previous hover
                    if (state.hoveredStationId !== null) {
                        map.setFeatureState(
                            { source: 'stations', id: state.hoveredStationId },
                            { hover: false }
                        );
                        const prevEl = document.querySelector(`.station-item[data-id="${state.hoveredStationId}"]`);
                        if (prevEl) prevEl.classList.remove('hover');
                    }
                    
                    state.hoveredStationId = featureId;
                    map.setFeatureState(
                        { source: 'stations', id: featureId },
                        { hover: true }
                    );
                    
                    // Highlight item in sidebar list
                    const el = document.querySelector(`.station-item[data-id="${featureId}"]`);
                    if (el) {
                        el.classList.add('hover');
                    }
                }
            }
        });

        // Click event for stations
        map.on('click', layerId, (e) => {
            if (state.editMode || addingCircleMode) return;
            if (e.features.length > 0) {
                const stationFeature = e.features[0];
                selectStation(stationFeature.id, true); // True to center on map
            }
        });
    });

    // Handle mouseleave events
    map.on('mouseleave', 'stations-circle', handleMouseLeave);
    map.on('mouseleave', 'stations-number', handleMouseLeave);
}

function handleMouseLeave() {
    map.getCanvas().style.cursor = '';
    if (state.hoveredStationId !== null) {
        map.setFeatureState(
            { source: 'stations', id: state.hoveredStationId },
            { hover: false }
        );
        const prevEl = document.querySelector(`.station-item[data-id="${state.hoveredStationId}"]`);
        if (prevEl) prevEl.classList.remove('hover');
        state.hoveredStationId = null;
    }
}

// Select a station (updates states, popups, and sidebar list)
function selectStation(stationId, centerOnMap = false) {
    const station = state.stations.find(s => s.id === stationId);
    if (!station) return;

    // Remove active styles from previous selection
    if (state.selectedStationId !== null) {
        map.setFeatureState(
            { source: 'stations', id: state.selectedStationId },
            { selected: false }
        );
        const prevEl = document.querySelector(`.station-item[data-id="${state.selectedStationId}"]`);
        if (prevEl) prevEl.classList.remove('active');
    }

    state.selectedStationId = stationId;

    // Apply active feature state to new selection
    map.setFeatureState(
        { source: 'stations', id: stationId },
        { selected: true }
    );

    // Apply active class in list & scroll it into view (only if on screen)
    const el = document.querySelector(`.station-item[data-id="${stationId}"]`);
    if (el) {
        el.classList.add('active');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Zoom/Pan to station coordinates if requested
    const coords = station.geometry.coordinates;
    if (centerOnMap) {
        map.easeTo({
            center: coords.slice(0, 2),
            zoom: 13.5,
            duration: 800
        });
    }

    // Display Popup
    showStationPopup(station);
}

// Show glassmorphic popup on map
function showStationPopup(station) {
    if (activePopup) {
        activePopup.remove();
    }

    const coords = station.geometry.coordinates.slice(0, 2);
    const isHidingActive = state.enabledHidingRegions.has(station.id);

    // Setup popup HTML content
    const html = `
        <div class="popup-header">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span class="dataset-badge ${station.properties.dataset}">${station.properties.dataset}</span>
                <span class="popup-coords">${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}</span>
            </div>
            <div class="popup-title">${station.properties.Name}</div>
        </div>
        <div class="popup-body">
            <div class="popup-toggle-container">
                <span>Hiding Region</span>
                <label class="switch">
                    <input type="checkbox" id="popup-hiding-toggle" data-id="${station.id}" ${isHidingActive ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            </div>
        </div>
    `;

    activePopup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        offset: 12,
        anchor: 'bottom'
    })
    .setLngLat(coords)
    .setHTML(html)
    .addTo(map);

    // Handle popup closure
    activePopup.on('close', () => {
        activePopup = null;
    });

    // Toggle switch inside popup
    const popupToggle = document.getElementById('popup-hiding-toggle');
    if (popupToggle) {
        popupToggle.addEventListener('change', (e) => {
            const id = parseInt(e.target.dataset.id);
            toggleHidingRegion(id, e.target.checked);
        });
    }
}

// Toggle Hiding Region for a Specific Station
function toggleHidingRegion(stationId, enabled) {
    if (enabled) {
        state.enabledHidingRegions.add(stationId);
    } else {
        state.enabledHidingRegions.delete(stationId);
    }

    // Update Map source with new geometry buffers
    if (isMapReady && map.getSource('hiding-regions')) {
        map.getSource('hiding-regions').setData(generateHidingRegionsGeoJson());
    }

    // Update List Indicator
    const indicator = document.querySelector(`.station-item[data-id="${stationId}"] .hiding-indicator`);
    if (indicator) {
        if (enabled) {
            indicator.classList.add('enabled');
        } else {
            indicator.classList.remove('enabled');
        }
    }

    // Update List Switch checkbox state if list item contains toggle (handled dynamically)
    const listCheckbox = document.querySelector(`.station-item[data-id="${stationId}"] .list-toggle`);
    if (listCheckbox) {
        listCheckbox.checked = enabled;
    }

    // Update popup switch state if open
    const popupToggle = document.getElementById('popup-hiding-toggle');
    if (popupToggle && parseInt(popupToggle.dataset.id) === stationId) {
        popupToggle.checked = enabled;
    }

    updateStats();
    handleManualUIChange();
}

// Update Stats counters in UI
function updateStats() {
    const activeStations = state.stations.filter(s => state.activeDatasets.has(s.properties.dataset));
    statTotalStations.textContent = activeStations.length;

    let activeHidingCount;
    if (state.circles.length > 0 || state.thermometers.length > 0) {
        const activeZone = computeActiveZone();
        activeHidingCount = activeZone
            ? activeStations.filter(s => turf.booleanPointInPolygon(
                turf.point(s.geometry.coordinates.slice(0, 2)), activeZone)).length
            : 0;
    } else {
        activeHidingCount = activeStations.filter(s => state.enabledHidingRegions.has(s.id)).length;
    }
    statActiveRegions.textContent = activeHidingCount;
}

// Reusable filter application to Map layers
function applyFiltersToMap() {
    if (!isMapReady) return;

    const query = state.searchQuery.toLowerCase().trim();
    const filteredStations = state.stations.filter(station => {
        const matchesDataset = state.activeDatasets.has(station.properties.dataset);
        if (!matchesDataset) return false;
        
        const name = station.properties.Name.toLowerCase();
        return name.includes(query);
    });

    const filteredIds = filteredStations.map(s => s.id);

    // Apply datasets filter
    let datasetFilter;
    if (state.activeDatasets.has('bus') && state.activeDatasets.has('metro')) {
        datasetFilter = ['in', ['get', 'dataset'], ['literal', ['bus', 'metro']]];
    } else if (state.activeDatasets.has('bus')) {
        datasetFilter = ['==', ['get', 'dataset'], 'bus'];
    } else if (state.activeDatasets.has('metro')) {
        datasetFilter = ['==', ['get', 'dataset'], 'metro'];
    } else {
        datasetFilter = ['==', 1, 0]; // Always false, hides all
    }

    // Apply search filter
    let searchFilter;
    if (filteredIds.length === 0) {
        searchFilter = ['==', 1, 0]; // Always false
    } else {
        searchFilter = ['in', ['get', 'id'], ['literal', filteredIds]];
    }

    // Combined logical and filter
    const combinedFilter = ['all', datasetFilter, searchFilter];
    
    map.setFilter('stations-circle', combinedFilter);
    map.setFilter('stations-glow', combinedFilter);
}

// Render Stations List in Sidebar
function renderStationList() {
    const query = state.searchQuery.toLowerCase().trim();
    const bounds = isMapReady ? map.getBounds() : null;
    
    // Filter stations based on dataset, search query, AND viewport bounding box (on-screen only)
    const filteredStations = state.stations.filter(station => {
        // 1. Check active dataset
        const matchesDataset = state.activeDatasets.has(station.properties.dataset);
        if (!matchesDataset) return false;
        
        // 2. Check search text query
        const name = station.properties.Name.toLowerCase();
        const matchesQuery = name.includes(query);
        if (!matchesQuery) return false;

        // 3. Check map viewport containment (only if map is ready)
        if (bounds) {
            const coords = station.geometry.coordinates;
            const lngLat = new maplibregl.LngLat(coords[0], coords[1]);
            return bounds.contains(lngLat);
        }
        
        return true;
    });

    visibleStationsCount.textContent = filteredStations.length;

    // Apply Filter to Map
    applyFiltersToMap();

    if (filteredStations.length === 0) {
        stationsListContainer.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-magnifying-glass"></i>
                <span>No stations match on screen</span>
            </div>
        `;
        return;
    }

    stationsListContainer.innerHTML = '';

    filteredStations.forEach(station => {
        const id = station.id;
        const name = station.properties.Name;
        const coords = station.geometry.coordinates.slice(0, 2);
        const isHidingActive = state.enabledHidingRegions.has(id);
        const isActive = state.selectedStationId === id;
        const dataset = station.properties.dataset;

        const stationItem = document.createElement('div');
        stationItem.className = `station-item ${isActive ? 'active' : ''}`;
        stationItem.dataset.id = id;

        const datasetTag = `<span class="dataset-badge ${dataset}" style="margin-right: 6px;">${dataset}</span>`;

        const toggleHtml = (state.circles.length === 0 && state.thermometers.length === 0) ? `
                <label class="switch">
                    <input type="checkbox" class="list-toggle" data-id="${id}" ${isHidingActive ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>` : '';

        stationItem.innerHTML = `
            <div class="station-info">
                <span class="station-name">${name}</span>
                <span class="station-meta">
                    <span class="hiding-indicator ${isHidingActive ? 'enabled' : ''}"></span>
                    ${datasetTag}
                    <span>#${id}</span>
                    <span style="color: var(--text-muted)">•</span>
                    <span>${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}</span>
                </span>
            </div>
            <div class="station-actions" onclick="event.stopPropagation()">
                <button class="btn-locate" title="Locate station on Map">
                    <i class="fa-solid fa-crosshairs"></i>
                </button>
                ${toggleHtml}
            </div>
        `;

        // Selection Listener
        stationItem.addEventListener('click', () => {
            selectStation(id, true);
        });

        // Locate Button Listener
        const btnLocate = stationItem.querySelector('.btn-locate');
        btnLocate.addEventListener('click', (e) => {
            selectStation(id, true);
        });

        // Toggle Switch Listener (absent when circles are active)
        const toggleSwitch = stationItem.querySelector('.list-toggle');
        if (toggleSwitch) {
            toggleSwitch.addEventListener('change', (e) => {
                toggleHidingRegion(id, e.target.checked);
            });
        }

        stationsListContainer.appendChild(stationItem);
    });
}

// Setup Event Listeners for UI interaction
function setupEventListeners() {
    // Search station input
    stationSearch.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        if (state.searchQuery) {
            clearSearchBtn.style.display = 'flex';
        } else {
            clearSearchBtn.style.display = 'none';
        }
        renderStationList();
    });

    // Clear search
    clearSearchBtn.addEventListener('click', () => {
        stationSearch.value = '';
        state.searchQuery = '';
        clearSearchBtn.style.display = 'none';
        renderStationList();
        stationSearch.focus();
    });

    // Global Hiding Regions Toggle
    globalRegionsToggle.addEventListener('change', (e) => {
        state.globalRegionsVisible = e.target.checked;
        if (isMapReady) {
            const visibility = state.globalRegionsVisible ? 'visible' : 'none';
            map.setLayoutProperty('hiding-regions-fill', 'visibility', visibility);
            map.setLayoutProperty('hiding-regions-stroke', 'visibility', visibility);
        }
        handleManualUIChange();
    });



    // Dataset Game Toggle
    datasetBusToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            state.activeDatasets.add('bus');
        } else {
            state.activeDatasets.delete('bus');
        }
        renderStationList();
        
        // Also update hiding regions to reflect dataset changes
        if (isMapReady && map.getSource('hiding-regions')) {
            map.getSource('hiding-regions').setData(generateHidingRegionsGeoJson());
        }
        updateStats();
        handleManualUIChange();
    });

    // Dataset Metro Toggle
    datasetMetroToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            state.activeDatasets.add('metro');
        } else {
            state.activeDatasets.delete('metro');
        }
        renderStationList();
        
        // Also update hiding regions to reflect dataset changes
        if (isMapReady && map.getSource('hiding-regions')) {
            map.getSource('hiding-regions').setData(generateHidingRegionsGeoJson());
        }
        updateStats();
        handleManualUIChange();
    });

    // Save Profile View Button
    btnCreateProfile.addEventListener('click', () => {
        createProfile();
    });

    // Fit Boundary Button
    btnFitBounds.addEventListener('click', () => {
        fitMapToBounds();
        handleManualUIChange();
    });

    // Reset View Button
    btnResetMap.addEventListener('click', () => {
        // Clear selection, fit bounds, reset styling
        if (state.selectedStationId !== null) {
            map.setFeatureState(
                { source: 'stations', id: state.selectedStationId },
                { selected: false }
            );
            state.selectedStationId = null;
        }
        
        if (activePopup) {
            activePopup.remove();
            activePopup = null;
        }

        // Reset toggles & search
        stationSearch.value = '';
        state.searchQuery = '';
        clearSearchBtn.style.display = 'none';
        
        state.activeDatasets.add('bus');
        state.activeDatasets.add('metro');
        datasetBusToggle.checked = true;
        datasetMetroToggle.checked = true;

        renderStationList();

        // Clear last-session view from local storage
        localStorage.removeItem('jet-lag-last-view');
        state.hasRestoredView = false;

        // Fit Bounds
        fitMapToBounds();
        handleManualUIChange();
    });

    // Theme Switcher Button
    btnThemeToggle.addEventListener('click', () => {
        state.currentTheme = state.currentTheme === 'dark' ? 'light' : 'dark';
        
        // Toggle dark-theme class on body
        if (state.currentTheme === 'dark') {
            document.body.classList.add('dark-theme');
        } else {
            document.body.classList.remove('dark-theme');
        }
        
        // Reinitialize map style
        map.setStyle(MAP_STYLES[state.currentTheme]);
        saveCurrentViewState(); // Save theme toggle in state
    });

    // Circle Add/Edit buttons
    document.getElementById('btn-add-circle').addEventListener('click', () => {
        addingCircleMode = !addingCircleMode;
        document.getElementById('btn-add-circle').classList.toggle('active', addingCircleMode);
        map.getCanvas().style.cursor = addingCircleMode ? 'crosshair' : '';
    });

    // Thermometer Add button (two-click to place point1 then point2)
    document.getElementById('btn-add-thermometer').addEventListener('click', () => {
        addingThermometerMode = !addingThermometerMode;
        document.getElementById('btn-add-thermometer').classList.toggle('active', addingThermometerMode);
        if (!addingThermometerMode) {
            if (pendingThermometerMarker) { pendingThermometerMarker.remove(); pendingThermometerMarker = null; }
            pendingThermometerPoint = null;
            document.getElementById('btn-add-thermometer').textContent = '+ Add';
            map.getCanvas().style.cursor = '';
        } else {
            map.getCanvas().style.cursor = 'crosshair';
        }
    });

    const toggleEditMode = () => {
        state.editMode = !state.editMode;
        document.getElementById('btn-edit-circles').classList.toggle('active', state.editMode);
        document.getElementById('btn-edit-thermometers').classList.toggle('active', state.editMode);
        map.getCanvas().style.cursor = state.editMode ? 'default' : '';
        const hint = document.getElementById('circles-edit-hint');
        if (hint) hint.style.display = state.editMode ? 'block' : 'none';
        applyEditModeVisuals(state.editMode);
        syncCircleMarkers();
        syncThermometerMarkers();
    };
    document.getElementById('btn-edit-circles').addEventListener('click', toggleEditMode);
    document.getElementById('btn-edit-thermometers').addEventListener('click', toggleEditMode);

    // Close mobile sidebar when clicking on map
    map.on('click', (e) => {
        if (state.editMode) return;

        if (addingThermometerMode) {
            const pt = [e.lngLat.lng, e.lngLat.lat];
            if (!pendingThermometerPoint) {
                // First click: drop a placeholder marker
                pendingThermometerPoint = pt;
                const el = document.createElement('div');
                el.className = 'thermo-marker thermo-pending';
                pendingThermometerMarker = new maplibregl.Marker({ element: el })
                    .setLngLat(pt).addTo(map);
                document.getElementById('btn-add-thermometer').textContent = 'Click 2nd…';
            } else {
                // Second click: create thermometer
                addThermometer(pendingThermometerPoint, pt);
                pendingThermometerMarker.remove();
                pendingThermometerMarker = null;
                pendingThermometerPoint = null;
                addingThermometerMode = false;
                document.getElementById('btn-add-thermometer').classList.remove('active');
                document.getElementById('btn-add-thermometer').textContent = '+ Add';
                map.getCanvas().style.cursor = '';
            }
            return;
        }

        if (addingCircleMode) {
            addCircleAtPoint(e.lngLat);
            addingCircleMode = false;
            document.getElementById('btn-add-circle').classList.remove('active');
            map.getCanvas().style.cursor = '';
        }
    });

    // Save view state dynamically when map viewport changes
    map.on('moveend', () => {
        renderStationList(); // Dynamically filter list items to match screen viewport
        saveCurrentViewState();
        saveToActiveProfile();
    });
}

// Setup map load check and style load triggers
function trySetupMap() {
    if (dataLoaded && map.isStyleLoaded()) {
        setupMapLayers();
        return;
    }

    // Data can become ready before the style finishes loading.
    // Keep retrying briefly until both conditions are true so layers are not skipped.
    if (dataLoaded && !isMapReady) {
        setTimeout(trySetupMap, 50);
    }
}

// Global listener on map style loads (fires on initial load and theme switches)
map.on('style.load', () => {
    trySetupMap();
});

// Start execution
init();
