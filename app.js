// Jet Lag Game Region & Stations Renderer
// State Management
const state = {
    stations: [],
    gameRegion: null,
    enabledHidingRegions: new Set(), // Starts empty (all hiding zones toggled off by default)
    globalRegionsVisible: true,
    gameRegionVisible: true,
    activeDatasets: new Set(['game', 'metro']), // 'game' and 'metro'
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

// DOM Elements
const stationSearch = document.getElementById('station-search');
const clearSearchBtn = document.getElementById('clear-search');
const globalRegionsToggle = document.getElementById('global-regions-toggle');
const gameRegionToggle = document.getElementById('game-region-toggle');
const datasetGameToggle = document.getElementById('dataset-game-toggle');
const datasetMetroToggle = document.getElementById('dataset-metro-toggle');
const btnFitBounds = document.getElementById('btn-fit-bounds');
const btnResetMap = document.getElementById('btn-reset-map');
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const statTotalStations = document.getElementById('stat-total-stations');
const statActiveRegions = document.getElementById('stat-active-regions');
const stationsListContainer = document.getElementById('stations-list-container');
const visibleStationsCount = document.getElementById('visible-stations-count');
const mobileSidebarToggle = document.getElementById('mobile-sidebar-toggle');
const sidebar = document.getElementById('sidebar');

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
            fetch('all-metro-stations.geojson').then(r => {
                if (!r.ok) throw new Error('Failed to load all-metro-stations.geojson');
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
                    dataset: 'game'
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
            gameRegionVisible: state.gameRegionVisible,
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
            state.gameRegionVisible = typeof view.gameRegionVisible === 'boolean' ? view.gameRegionVisible : true;

            const restoredDatasets = Array.isArray(view.activeDatasets)
                ? view.activeDatasets.filter(dataset => dataset === 'game' || dataset === 'metro')
                : [];
            state.activeDatasets = restoredDatasets.length > 0
                ? new Set(restoredDatasets)
                : new Set(['game', 'metro']);
            
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
            gameRegionToggle.checked = state.gameRegionVisible;
            datasetGameToggle.checked = state.activeDatasets.has('game');
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
        if (stored) {
            state.profiles = JSON.parse(stored);
        } else {
            // Setup default profile
            state.profiles = [
                {
                    id: 'default',
                    name: 'Initial View (Default)',
                    center: [-118.287, 34.05],
                    zoom: 10.2,
                    globalRegionsVisible: true,
                    gameRegionVisible: true,
                    activeDatasets: ['game', 'metro']
                }
            ];
            saveProfiles();
        }
    } catch (err) {
        console.error('Error loading profiles:', err);
        state.profiles = [];
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
    state.gameRegionVisible = profile.gameRegionVisible;
    state.activeDatasets = new Set(profile.activeDatasets);
    
    // Update inputs check state
    globalRegionsToggle.checked = state.globalRegionsVisible;
    gameRegionToggle.checked = state.gameRegionVisible;
    datasetGameToggle.checked = state.activeDatasets.has('game');
    datasetMetroToggle.checked = state.activeDatasets.has('metro');
    
    // Apply map layers visibilities
    if (isMapReady) {
        map.setLayoutProperty('hiding-regions-fill', 'visibility', state.globalRegionsVisible ? 'visible' : 'none');
        map.setLayoutProperty('hiding-regions-stroke', 'visibility', state.globalRegionsVisible ? 'visible' : 'none');
        map.setLayoutProperty('game-region-fill', 'visibility', state.gameRegionVisible ? 'visible' : 'none');
        map.setLayoutProperty('game-region-border', 'visibility', state.gameRegionVisible ? 'visible' : 'none');
        
        // Force update hiding region sources and map layers
        map.getSource('hiding-regions').setData(generateHidingRegionsGeoJson());
        applyFiltersToMap();
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
        name: `Saved View ${state.profiles.length + 1}`,
        center: center,
        zoom: zoom,
        globalRegionsVisible: state.globalRegionsVisible,
        gameRegionVisible: state.gameRegionVisible,
        activeDatasets: Array.from(state.activeDatasets)
    };
    
    state.profiles.push(newProfile);
    state.activeProfileId = id;
    
    saveProfiles();
    renderProfilesList();
}

function deleteProfile(profileId) {
    state.profiles = state.profiles.filter(p => p.id !== profileId);
    if (state.activeProfileId === profileId) {
        state.activeProfileId = null;
    }
    
    saveProfiles();
    renderProfilesList();
}

function handleManualUIChange() {
    if (state.activeProfileId !== null) {
        state.activeProfileId = null;
        renderProfilesList();
    }
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

    // 2. Add Game Region Layers - styled in light-translucent black & solid black border
    if (!map.getLayer('game-region-fill')) {
        map.addLayer({
            id: 'game-region-fill',
            type: 'fill',
            source: 'game-region',
            paint: {
                'fill-color': state.currentTheme === 'dark' ? '#f8fafc' : '#0f172a',
                'fill-opacity': 0.05
            },
            layout: {
                'visibility': state.gameRegionVisible ? 'visible' : 'none'
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
                'visibility': state.gameRegionVisible ? 'visible' : 'none'
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
                'circle-radius': 17, // Larger to glow around standard circle
                'circle-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false], 0.35,
                    ['boolean', ['feature-state', 'selected'], false], 0.5,
                    0
                ],
                'circle-blur': 0.4
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
                    ['boolean', ['feature-state', 'selected'], false], 11,
                    ['boolean', ['feature-state', 'hover'], false], 10.5,
                    8.5
                ],
                'circle-stroke-width': 1.5,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-opacity': 0.9
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
                'text-size': 8.5,
                'text-font': ['Noto Sans Regular', 'Arial Unicode MS Regular'],
                'text-allow-overlap': true,
                'text-ignore-placement': true
            },
            paint: {
                'text-color': '#ffffff'
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
    
    const activeHidingCount = activeStations.filter(s => state.enabledHidingRegions.has(s.id)).length;
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
    if (state.activeDatasets.has('game') && state.activeDatasets.has('metro')) {
        datasetFilter = ['in', ['get', 'dataset'], ['literal', ['game', 'metro']]];
    } else if (state.activeDatasets.has('game')) {
        datasetFilter = ['==', ['get', 'dataset'], 'game'];
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
                <label class="switch">
                    <input type="checkbox" class="list-toggle" data-id="${id}" ${isHidingActive ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
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

        // Toggle Switch Listener
        const toggleSwitch = stationItem.querySelector('.list-toggle');
        toggleSwitch.addEventListener('change', (e) => {
            toggleHidingRegion(id, e.target.checked);
        });

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

    // Game Boundary Toggle
    gameRegionToggle.addEventListener('change', (e) => {
        state.gameRegionVisible = e.target.checked;
        if (isMapReady) {
            const visibility = state.gameRegionVisible ? 'visible' : 'none';
            map.setLayoutProperty('game-region-fill', 'visibility', visibility);
            map.setLayoutProperty('game-region-border', 'visibility', visibility);
        }
        handleManualUIChange();
    });

    // Dataset Game Toggle
    datasetGameToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            state.activeDatasets.add('game');
        } else {
            state.activeDatasets.delete('game');
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
        
        state.activeDatasets.add('game');
        state.activeDatasets.add('metro');
        datasetGameToggle.checked = true;
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

    // Mobile Sidebar Drawer Toggle
    mobileSidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        const icon = mobileSidebarToggle.querySelector('i');
        if (sidebar.classList.contains('open')) {
            icon.className = 'fa-solid fa-xmark';
        } else {
            icon.className = 'fa-solid fa-bars';
        }
    });

    // Close mobile sidebar when clicking on map
    map.on('click', () => {
        if (window.innerWidth <= 900 && sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
            mobileSidebarToggle.querySelector('i').className = 'fa-solid fa-bars';
        }
    });

    // Clear active profile highlight when map view is changed by user interaction
    map.on('movestart', (e) => {
        if (e.originalEvent) {
            if (state.activeProfileId !== null) {
                state.activeProfileId = null;
                renderProfilesList();
            }
        }
    });

    // Save view state dynamically when map viewport changes
    map.on('moveend', () => {
        renderStationList(); // Dynamically filter list items to match screen viewport
        saveCurrentViewState();
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
