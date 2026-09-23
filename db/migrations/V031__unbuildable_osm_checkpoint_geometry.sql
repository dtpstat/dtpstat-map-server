SET SEARCH_PATH = BUSLANES, PUBLIC;

ALTER TABLE BUSLANES.OSM_CITY_UPDATE_CHECKPOINT_STAGE
    ALTER COLUMN GEOM DROP NOT NULL,
    ALTER COLUMN BOUNDS DROP NOT NULL,
    ADD COLUMN GEOMETRY_STATUS TEXT NOT NULL DEFAULT 'ready';

ALTER TABLE BUSLANES.OSM_CITY_UPDATE_CHECKPOINT_STAGE
    ADD CONSTRAINT OSM_CITY_UPDATE_CHECKPOINT_STAGE_GEOMETRY_STATUS_CHECK
        CHECK (GEOMETRY_STATUS IN ('ready', 'unbuildable')),
    ADD CONSTRAINT OSM_CITY_UPDATE_CHECKPOINT_STAGE_GEOMETRY_STATE_CHECK
        CHECK (
            (
                GEOMETRY_STATUS = 'ready'
                AND GEOM IS NOT NULL
                AND BOUNDS IS NOT NULL
            )
            OR
            (
                GEOMETRY_STATUS = 'unbuildable'
                AND GEOM IS NULL
                AND BOUNDS IS NULL
            )
        );

COMMENT ON COLUMN BUSLANES.OSM_CITY_UPDATE_CHECKPOINT_STAGE.GEOMETRY_STATUS IS
    'ready = a polygon was built and may be imported; unbuildable = the indexed OSM object was processed but its linework did not form a polygon. Unbuildable rows remain staged so resume does not download them forever.';
