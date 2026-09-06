SET SEARCH_PATH = BUSLANES, PUBLIC;

-- Index audit notes:
-- - CITIES: PK + UNIQUE(source_index/slug/name) and the historical ranking
--   index cover identity/import lookups. No attribute-only filter warrants a
--   new index for the current small city dimension.
-- - CITY_POPULATIONS, PROJECT_SETTINGS, REPORT_CONFIG,
--   ADMIN_TASK_SUCCESSES and CITY_REPORT_VALUES have PK/UNIQUE access paths
--   matching all runtime equality joins/lookups; CITY_REPORT_VALUES also has
--   its rank index from V014.
-- - CITY_BOUNDARIES has the OSM object UNIQUE index, partial UNIQUE(city_id)
--   and both GEOM/BOUNDS GiST indexes.
-- - LINE_TYPES has PK, UNIQUE(code) and the case-insensitive NAME expression
--   index from V013.
-- - GEOMETRY_UPDATE_RUNS / OSM_CITY_UPDATE_RUNS are append-only audit tables;
--   the runtime does not filter/order them, so timestamp indexes would only
--   add write amplification.
-- - CITY_GEOMETRIES is the hot relation. Runtime commonly enters it by CITY_ID
--   and then joins/groups by LINE_TYPE_ID. Replace the old CITY_ID-only index
--   with a composite whose left prefix still serves CITY_ID-only requests.

CREATE INDEX IF NOT EXISTS CITY_GEOMETRIES_CITY_LINE_TYPE_IDX
    ON BUSLANES.CITY_GEOMETRIES (CITY_ID, LINE_TYPE_ID);

DROP INDEX IF EXISTS BUSLANES.CITY_GEOMETRIES_CITY_ID_IDX;

COMMENT ON INDEX BUSLANES.CITY_GEOMETRIES_CITY_LINE_TYPE_IDX IS
    'Covers per-city geometry reads/report aggregation and line-type joins; CITY_ID is the left prefix.';
