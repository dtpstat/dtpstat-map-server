SET SEARCH_PATH = BUSLANES, PUBLIC;

-- Geometry editor requires every active application boundary to have the same
-- canonical CITIES link used by metrics and public-map queries. Older data may
-- predate the OSM boundary-management synchronizer, so repair it once when
-- this feature is installed.
SELECT BUSLANES.SYNC_ACTIVE_BOUNDARY_CITIES();
