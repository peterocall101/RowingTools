// benchmarks.js - load and manage benchmark sets for GMT% calculations
// Benchmarks: WBT, Metropolitan A/B/C, Henley, Harvard, or custom per-squad

// Cache of benchmark data (loaded on demand)
const _benchmarkCache = {};

// Fetch the active benchmark for a group (and its times).
async function getActiveBenchmark(groupId) {
  const { data, error } = await sb
    .from('benchmarks')
    .select('*, benchmark_times(*)')
    .eq('id', activeGroup().active_benchmark_id)
    .single();

  if (error || !data) return null;

  const times = {};
  data.benchmark_times.forEach(t => { times[t.boat_class] = t.time_ms; });
  return { ...data, times };
}

// List all benchmarks for a group.
async function listBenchmarks(groupId) {
  const { data, error } = await sb
    .from('benchmarks')
    .select('id, name, source, created_at, deleted_at')
    .eq('group_id', groupId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  return error ? [] : data;
}

// Load preset benchmark times from the data files (WBT, Met, etc).
async function loadPresetBenchmark(source) {
  if (_benchmarkCache[source]) return _benchmarkCache[source];

  try {
    const res = await fetch('../data/benchmarks_v3.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch benchmark data from ../data/benchmarks_v3.json`);
    const data = await res.json();
    if (!data[source]) throw new Error(`Source "${source}" not found in benchmarks_v3.json. Available: ${Object.keys(data).join(', ')}`);
    _benchmarkCache[source] = data[source];
    return _benchmarkCache[source];
  } catch (e) {
    console.error(`Could not load preset benchmark ${source}:`, e);
    throw e;
  }
}

// Convert preset benchmark (object of {boat_class: {label, time}} or similar)
// to the jsonb format expected by create_benchmark (object of {boat_class: time_ms}).
async function convertPresetToTimes(source) {
  const preset = await loadPresetBenchmark(source);
  const times = {};

  if (!preset || typeof preset !== 'object') {
    console.error('Preset is not an object:', preset);
    throw new Error(`Could not load preset benchmark "${source}". Check that benchmarks_v3.json exists and is valid.`);
  }

  Object.entries(preset).forEach(([boatClass, entry]) => {
    if (entry && entry.time) {
      const ms = timeStringToMs(entry.time);
      if (!isNaN(ms)) times[boatClass] = ms;
    }
  });

  if (Object.keys(times).length === 0) {
    console.error('No valid times found in preset:', preset);
    throw new Error(`No benchmark times found for "${source}". Preset data may be malformed.`);
  }

  return times;
}

// Create a new benchmark in the group (from preset or custom).
async function createBenchmarkFromPreset(source, customName = null) {
  const name = customName || {
    wbt: 'Watts Boat Table',
    met_raw: 'Metropolitan (raw)',
    met_a_slowest: 'Metropolitan A (slowest)',
    met_b_slowest: 'Metropolitan B (slowest)',
    met_c_slowest: 'Metropolitan C (slowest)',
    hrr_raw: 'Harvard (raw)',
    hwr_raw: 'Henley (raw)',
  }[source] || 'Custom benchmark';

  const times = await convertPresetToTimes(source);

  const { data, error } = await sb.rpc('create_benchmark', {
    p_group_id: RT.activeGroupId,
    p_name: name,
    p_source: source,
    p_times: times,
  });

  if (error) throw error;
  return data;
}

// Set a benchmark as active for the group.
async function setActiveBenchmark(benchmarkId) {
  const { error } = await sb.rpc('set_active_benchmark', {
    p_group_id: RT.activeGroupId,
    p_benchmark_id: benchmarkId,
  });

  if (error) throw error;
  activeGroup().active_benchmark_id = benchmarkId;
}

// Calculate GMT% given a time and boat class using the active benchmark.
async function calculateGmt(timeMs, boatClass) {
  const benchmark = await getActiveBenchmark(RT.activeGroupId);
  if (!benchmark || !benchmark.times[boatClass]) return null;

  const refTime = benchmark.times[boatClass];
  return (timeMs / refTime) * 100;
}

// Helper: convert "m:ss.ss" format to milliseconds (returns integer)
function timeStringToMs(timeStr) {
  if (typeof timeStr !== 'string') return NaN;
  const [min, sec] = timeStr.split(':');
  const m = parseInt(min, 10);
  const s = parseFloat(sec);
  if (isNaN(m) || isNaN(s)) return NaN;
  return Math.round((m * 60 + s) * 1000);
}
