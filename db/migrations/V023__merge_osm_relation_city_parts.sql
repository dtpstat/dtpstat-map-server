SET SEARCH_PATH = BUSLANES, PUBLIC;

-- OSM may describe one logical city/town with several relation objects.  The
-- application does not need a one-to-one mirror of those source objects; it
-- needs one usable polygon per logical place.  Keep the source columns as
-- provenance for existing transfer formats, but derive a stable logical name
-- from the tags used by the OSM import.
ALTER TABLE BUSLANES.CITY_BOUNDARIES
    ADD COLUMN IF NOT EXISTS FULL_NAME TEXT GENERATED ALWAYS AS (
        COALESCE(
            NULLIF(BTRIM(TAGS ->> 'addr:district'), ''),
            NULLIF(BTRIM(TAGS ->> 'name:ru'), ''),
            NULLIF(BTRIM(OSM_NAME), '')
        )
    ) STORED;

ALTER TABLE BUSLANES.CITY_BOUNDARIES
    ALTER COLUMN FULL_NAME SET NOT NULL;

CREATE INDEX IF NOT EXISTS CITY_BOUNDARIES_LOGICAL_NAME_IDX
    ON BUSLANES.CITY_BOUNDARIES (OSM_TYPE, PLACE_TYPE, FULL_NAME);

-- Merge relation fragments after a snapshot/transfer INSERT.  Ways are left
-- untouched intentionally: the observed fragmented-city case is represented by
-- relation objects, while ways can legitimately reuse the same name.
CREATE OR REPLACE FUNCTION BUSLANES.NORMALIZE_CITY_BOUNDARY_RELATIONS()
RETURNS VOID
LANGUAGE PLPGSQL
AS $FUNCTION$
DECLARE
    GROUP_ROW RECORD;
BEGIN
    FOR GROUP_ROW IN
        SELECT
            PLACE_TYPE,
            FULL_NAME,
            (ARRAY_AGG(ID ORDER BY (CITY_ID IS NOT NULL) DESC, ID))[1] AS KEEP_ID,
            (ARRAY_AGG(CITY_ID ORDER BY ID)
                FILTER (WHERE CITY_ID IS NOT NULL))[1] AS LINKED_CITY_ID,
            ST_MULTI(
                ST_COLLECTIONEXTRACT(
                    ST_UNARYUNION(ST_COLLECT(GEOM)),
                    3
                )
            ) AS MERGED_GEOM,
            MAX(OSM_TIMESTAMP) AS OSM_TIMESTAMP
        FROM BUSLANES.CITY_BOUNDARIES
        WHERE OSM_TYPE = 'relation'
        GROUP BY PLACE_TYPE, FULL_NAME
        HAVING COUNT(*) > 1
    LOOP
        IF ST_ISEMPTY(GROUP_ROW.MERGED_GEOM)
           OR NOT ST_ISVALID(GROUP_ROW.MERGED_GEOM)
           OR ST_AREA(GROUP_ROW.MERGED_GEOM::GEOGRAPHY) <= 0 THEN
            RAISE EXCEPTION
                'Merged OSM relation geometry is invalid for % / %',
                GROUP_ROW.PLACE_TYPE,
                GROUP_ROW.FULL_NAME;
        END IF;

        -- CITY_ID has a partial UNIQUE index.  Release a link from fragments
        -- that are about to disappear before assigning it to the kept row.
        UPDATE BUSLANES.CITY_BOUNDARIES
        SET CITY_ID = NULL
        WHERE OSM_TYPE = 'relation'
          AND PLACE_TYPE = GROUP_ROW.PLACE_TYPE
          AND FULL_NAME = GROUP_ROW.FULL_NAME
          AND ID <> GROUP_ROW.KEEP_ID
          AND CITY_ID IS NOT NULL;

        DELETE FROM BUSLANES.CITY_BOUNDARIES
        WHERE OSM_TYPE = 'relation'
          AND PLACE_TYPE = GROUP_ROW.PLACE_TYPE
          AND FULL_NAME = GROUP_ROW.FULL_NAME
          AND ID <> GROUP_ROW.KEEP_ID;

        UPDATE BUSLANES.CITY_BOUNDARIES
        SET CITY_ID = COALESCE(GROUP_ROW.LINKED_CITY_ID, CITY_ID),
            GEOM = GROUP_ROW.MERGED_GEOM,
            BOUNDS = ST_ENVELOPE(GROUP_ROW.MERGED_GEOM),
            OSM_TIMESTAMP = COALESCE(GROUP_ROW.OSM_TIMESTAMP, OSM_TIMESTAMP),
            UPDATED_AT = NOW()
        WHERE ID = GROUP_ROW.KEEP_ID;
    END LOOP;
END
$FUNCTION$;

CREATE OR REPLACE FUNCTION BUSLANES.NORMALIZE_CITY_BOUNDARY_RELATIONS_TRIGGER()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $FUNCTION$
BEGIN
    PERFORM BUSLANES.NORMALIZE_CITY_BOUNDARY_RELATIONS();
    RETURN NULL;
END
$FUNCTION$;

DROP TRIGGER IF EXISTS CITY_BOUNDARIES_NORMALIZE_RELATIONS
    ON BUSLANES.CITY_BOUNDARIES;
CREATE TRIGGER CITY_BOUNDARIES_NORMALIZE_RELATIONS
    AFTER INSERT ON BUSLANES.CITY_BOUNDARIES
    FOR EACH STATEMENT
    EXECUTE FUNCTION BUSLANES.NORMALIZE_CITY_BOUNDARY_RELATIONS_TRIGGER();

-- Once a logical OSM boundary becomes linked to a ranked city, treat the
-- derived logical name as that city's FULL_NAME.  NAME stays the short/display
-- name, so population imports can continue to address cities by their familiar
-- short names.
CREATE OR REPLACE FUNCTION BUSLANES.SYNC_CITY_FULL_NAME_FROM_BOUNDARY()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $FUNCTION$
BEGIN
    IF NEW.CITY_ID IS NOT NULL THEN
        UPDATE BUSLANES.CITIES
        SET FULL_NAME = NEW.FULL_NAME,
            UPDATED_AT = NOW()
        WHERE ID = NEW.CITY_ID
          AND FULL_NAME IS DISTINCT FROM NEW.FULL_NAME;
    END IF;
    RETURN NEW;
END
$FUNCTION$;

DROP TRIGGER IF EXISTS CITY_BOUNDARIES_SYNC_CITY_FULL_NAME
    ON BUSLANES.CITY_BOUNDARIES;
CREATE TRIGGER CITY_BOUNDARIES_SYNC_CITY_FULL_NAME
    AFTER INSERT OR UPDATE OF CITY_ID, TAGS, OSM_NAME
    ON BUSLANES.CITY_BOUNDARIES
    FOR EACH ROW
    EXECUTE FUNCTION BUSLANES.SYNC_CITY_FULL_NAME_FROM_BOUNDARY();

-- Normalize already imported snapshots as part of the migration, then backfill
-- FULL_NAME for any city that was already linked before this migration.
SELECT BUSLANES.NORMALIZE_CITY_BOUNDARY_RELATIONS();

UPDATE BUSLANES.CITIES AS CITY
SET FULL_NAME = BOUNDARY.FULL_NAME,
    UPDATED_AT = NOW()
FROM BUSLANES.CITY_BOUNDARIES AS BOUNDARY
WHERE BOUNDARY.CITY_ID = CITY.ID
  AND CITY.FULL_NAME IS DISTINCT FROM BOUNDARY.FULL_NAME;

COMMENT ON COLUMN BUSLANES.CITY_BOUNDARIES.FULL_NAME IS
    'Logical OSM place name: addr:district, then name:ru, then osm_name. Relation rows with equal place_type/full_name are merged into one MultiPolygon.';
