// Central state store.
// Own-vessel data is kept in a flat map keyed by Signal K path. Other vessels
// (AIS targets) are kept per-context so we can list and range them.
// Both the live WebSocket client and the mock generator push updates here,
// so the rest of the app never needs to know where data came from.

class Store {
  constructor() {
    // Own vessel: path -> { value, timestamp, source }
    this.values = new Map();
    // Other vessels (AIS): context -> { paths: Map, lastUpdate }
    this.vessels = new Map();
    // Signal K context id of our own vessel (from the stream hello message).
    this.selfContext = null;

    // Set of callbacks invoked whenever any value changes.
    this.listeners = new Set();
    // Connection status: 'disconnected' | 'connecting' | 'connected' | 'demo' | 'error'
    this.connection = 'disconnected';
    this.connectionListeners = new Set();
  }

  // ---- Own vessel ----------------------------------------------------------
  set(path, value, meta = {}) {
    this.values.set(path, {
      value,
      timestamp: meta.timestamp || Date.now(),
      source: meta.source || null,
    });
    this._notify(path, value);
  }

  get(path) {
    const entry = this.values.get(path);
    return entry ? entry.value : null;
  }

  getEntry(path) {
    return this.values.get(path) || null;
  }

  // Age of a value in milliseconds (used to flag stale data).
  ageMs(path) {
    const entry = this.values.get(path);
    if (!entry) return Infinity;
    return Date.now() - entry.timestamp;
  }

  // ---- Other vessels (AIS) -------------------------------------------------
  setVesselValue(context, path, value, meta = {}) {
    let v = this.vessels.get(context);
    if (!v) {
      v = { paths: new Map(), lastUpdate: 0 };
      this.vessels.set(context, v);
    }
    // Flatten position into lat/lon like we do for own vessel.
    if (path === 'navigation.position' && value && typeof value === 'object') {
      v.paths.set('latitude', value.latitude);
      v.paths.set('longitude', value.longitude);
    } else {
      v.paths.set(path, value);
    }
    v.lastUpdate = meta.timestamp || Date.now();
    this._notify('vessels', context);
  }

  // Snapshot of all known AIS targets as plain objects.
  getVessels() {
    const out = [];
    for (const [context, v] of this.vessels) {
      out.push({
        context,
        lastUpdate: v.lastUpdate,
        name: v.paths.get('name'),
        mmsi: v.paths.get('mmsi'),
        latitude: v.paths.get('latitude'),
        longitude: v.paths.get('longitude'),
        sog: v.paths.get('navigation.speedOverGround'),
        cog: v.paths.get('navigation.courseOverGroundTrue'),
        shipType: v.paths.get('design.aisShipType'),
      });
    }
    return out;
  }

  // Drop AIS targets we haven't heard from in a while.
  pruneVessels(maxAgeMs = 300000) {
    const now = Date.now();
    let changed = false;
    for (const [context, v] of this.vessels) {
      if (now - v.lastUpdate > maxAgeMs) {
        this.vessels.delete(context);
        changed = true;
      }
    }
    if (changed) this._notify('vessels', null);
  }

  clearVessels() {
    this.vessels.clear();
    this._notify('vessels', null);
  }

  // ---- Listeners / connection ----------------------------------------------
  subscribe(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  _notify(path, value) {
    for (const cb of this.listeners) {
      try {
        cb(path, value);
      } catch (err) {
        console.error('State listener error', err);
      }
    }
  }

  setConnection(status) {
    this.connection = status;
    for (const cb of this.connectionListeners) {
      try {
        cb(status);
      } catch (err) {
        console.error('Connection listener error', err);
      }
    }
  }

  onConnectionChange(cb) {
    this.connectionListeners.add(cb);
    return () => this.connectionListeners.delete(cb);
  }

  // Clear all held values (e.g. when switching data sources).
  clear() {
    this.values.clear();
    this.vessels.clear();
    this._notify('*', null);
  }
}

// Single shared instance for the whole app.
export const store = new Store();
