// benchmarks.js - simplified: WBT as base + adjustments per benchmark

let _wbtCache = null;

// Load WBT (World Best Time) reference from static data
async function loadWBT() {
  if (_wbtCache) return _wbtCache;
  try {
    const res = await fetch('../data/benchmarks_v3.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const wbt = data.wbt || {};

    // Convert to {boat_class: time_ms}
    _wbtCache = {};
    Object.entries(wbt).forEach(([bc, entry]) => {
      if (entry.time) {
        const ms = timeStringToMs(entry.time);
        if (!isNaN(ms)) _wbtCache[bc] = ms;
      }
    });

    if (Object.keys(_wbtCache).length === 0) {
      throw new Error('No valid WBT times found in benchmarks_v3.json');
    }
    return _wbtCache;
  } catch (e) {
    console.error('Failed to load WBT:', e);
    throw e;
  }
}

// Get active benchmark (with adjustments applied)
async function getActiveBenchmark(groupId) {
  const activeId = activeGroup()?.active_benchmark_id;
  if (!activeId) return null;

  const { data, error } = await sb
    .from('benchmarks')
    .select('*, benchmark_adjustments(*)')
    .eq('id', activeId)
    .single();

  if (error || !data) return null;

  const wbt = await loadWBT();
  const adjustments = {};
  (data.benchmark_adjustments || []).forEach(a => {
    adjustments[a.boat_class] = a.offset_ms || 0;
  });

  return { ...data, wbt, adjustments };
}

// List all benchmarks for a group
async function listBenchmarks(groupId) {
  const { data, error } = await sb
    .from('benchmarks')
    .select('id, name, created_at, deleted_at')
    .eq('group_id', groupId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  return error ? [] : data;
}

// Create benchmark with adjustments
async function createBenchmark(name, adjustments = {}) {
  const { data, error } = await sb.rpc('create_benchmark', {
    p_group_id: RT.activeGroupId,
    p_name: name,
    p_adjustments: adjustments,
  });

  if (error) throw error;
  return data;
}

// Set benchmark as active
async function setActiveBenchmark(benchmarkId) {
  const { error } = await sb.rpc('set_active_benchmark', {
    p_group_id: RT.activeGroupId,
    p_benchmark_id: benchmarkId,
  });

  if (error) throw error;
  activeGroup().active_benchmark_id = benchmarkId;
}

// Reference 2000m time (ms) for a boat class under a loaded benchmark
// (WBT base + per-class offset). GMT% = benchRefTime / your_time * 100 -
// the single definition of the direction, shared by Results and Analytics.
function benchRefTime(bench, boatClass) {
  if (!bench || !boatClass || !bench.wbt?.[boatClass]) return null;
  return bench.wbt[boatClass] + (bench.adjustments?.[boatClass] || 0);
}

// Helper: convert "m:ss.ss" to milliseconds
function timeStringToMs(timeStr) {
  if (typeof timeStr !== 'string') return NaN;
  const [min, sec] = timeStr.split(':');
  const m = parseInt(min, 10);
  const s = parseFloat(sec);
  if (isNaN(m) || isNaN(s)) return NaN;
  return Math.round((m * 60 + s) * 1000);
}
