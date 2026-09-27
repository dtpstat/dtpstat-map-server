SET SEARCH_PATH = BUSLANES, PUBLIC;

-- Geometry rows are independent domain objects. CITY_ID and BOUNDARY_ID are
-- optional, derived administrative links. They must never define lifecycle or
-- revision semantics for the geometry itself.

ALTER TABLE BUSLANES.CITY_GEOMETRIES
    ALTER COLUMN CITY_ID DROP NOT NULL;

DROP TRIGGER IF EXISTS CITY_GEOMETRIES_SYNC_CITY_FROM_BOUNDARY
    ON BUSLANES.CITY_GEOMETRIES;
DROP TRIGGER IF EXISTS CITY_BOUNDARIES_PROPAGATE_CITY_TO_GEOMETRIES
    ON BUSLANES.CITY_BOUNDARIES;
DROP TRIGGER IF EXISTS CITY_BOUNDARIES_RECONCILE_GEOMETRIES_UPDATE
    ON BUSLANES.CITY_BOUNDARIES;
DROP TRIGGER IF EXISTS CITY_BOUNDARIES_RECONCILE_GEOMETRIES_INSERT
    ON BUSLANES.CITY_BOUNDARIES;

DROP FUNCTION IF EXISTS BUSLANES.SYNC_GEOMETRY_CITY_FROM_BOUNDARY();
DROP FUNCTION IF EXISTS BUSLANES.PROPAGATE_BOUNDARY_CITY_TO_GEOMETRIES();
DROP FUNCTION IF EXISTS BUSLANES.RECONCILE_GEOMETRY_BOUNDARY_OWNERSHIP();

-- V040 used one UPDATE trigger for both editable content and administrative
-- link maintenance. Keep derived lengths in that trigger, but make UPDATED_AT
-- a revision of editable content only. CITY_ID/BOUNDARY_ID relinking must not
-- invalidate optimistic editor revisions.
CREATE OR REPLACE FUNCTION BUSLANES.NORMALIZE_CITY_GEOMETRY_DERIVED()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $FUNCTION$
BEGIN
    IF GEOMETRYTYPE(NEW.GEOM) IN ('LINESTRING', 'MULTILINESTRING') THEN
        NEW.LENGTH_M := ST_LENGTH(NEW.GEOM::GEOGRAPHY);
        NEW.LANE_LENGTH_M := NEW.LENGTH_M * NEW.LANES;
    ELSE
        NEW.LENGTH_M := NULL;
        NEW.LANE_LENGTH_M := NULL;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.GEOM IS DISTINCT FROM OLD.GEOM
           OR NEW.LINE_TYPE_ID IS DISTINCT FROM OLD.LINE_TYPE_ID
           OR NEW.LANES IS DISTINCT FROM OLD.LANES
           OR NEW.PROPERTIES IS DISTINCT FROM OLD.PROPERTIES
           OR NEW.DISPLAY_NAME IS DISTINCT FROM OLD.DISPLAY_NAME
           OR NEW.TOOLTIP IS DISTINCT FROM OLD.TOOLTIP
           OR NEW.TAGS IS DISTINCT FROM OLD.TAGS
           OR NEW.SOURCE_TAGS IS DISTINCT FROM OLD.SOURCE_TAGS
           OR NEW.IS_VISIBLE IS DISTINCT FROM OLD.IS_VISIBLE
           OR NEW.WAS_EDITED IS DISTINCT FROM OLD.WAS_EDITED THEN
            NEW.UPDATED_AT := NOW();
        ELSE
            NEW.UPDATED_AT := OLD.UPDATED_AT;
        END IF;
    END IF;

    RETURN NEW;
END
$FUNCTION$;

CREATE OR REPLACE FUNCTION BUSLANES.RESOLVE_GEOMETRY_ADMIN_LINKS(
    INPUT_GEOM PUBLIC.GEOMETRY
)
RETURNS TABLE (
    BOUNDARY_ID BIGINT,
    CITY_ID BIGINT
)
LANGUAGE SQL
STABLE
AS $FUNCTION$
    WITH RECURSIVE
    CANDIDATES AS (
        SELECT
            BOUNDARY.ID,
            BOUNDARY.CITY_ID,
            BOUNDARY.GEOM,
            BOUNDARY.AREA_M2
        FROM BUSLANES.CITY_BOUNDARIES AS BOUNDARY
        WHERE BOUNDARY.IS_ACTIVE
          AND BOUNDARY.GEOM && INPUT_GEOM
          AND ST_INTERSECTS(BOUNDARY.GEOM, INPUT_GEOM)
    ),
    DESCENDANTS (
        ROOT_ID,
        ID,
        GEOM,
        IS_ACTIVE
    ) AS (
        SELECT
            CANDIDATE.ID,
            CHILD.ID,
            CHILD.GEOM,
            CHILD.IS_ACTIVE
        FROM CANDIDATES AS CANDIDATE
        JOIN BUSLANES.CITY_BOUNDARIES AS CHILD
          ON CHILD.PARENT_ID = CANDIDATE.ID

        UNION ALL

        SELECT
            DESCENDANT.ROOT_ID,
            CHILD.ID,
            CHILD.GEOM,
            CHILD.IS_ACTIVE
        FROM DESCENDANTS AS DESCENDANT
        JOIN BUSLANES.CITY_BOUNDARIES AS CHILD
          ON CHILD.PARENT_ID = DESCENDANT.ID
    ),
    DESCENDANT_UNIONS AS (
        SELECT
            ROOT_ID,
            ST_UNARYUNION(
                ST_COLLECT(GEOM) FILTER (
                    WHERE IS_ACTIVE
                )
            ) AS ACTIVE_DESCENDANTS
        FROM DESCENDANTS
        GROUP BY ROOT_ID
    ),
    SCORED AS (
        SELECT
            CANDIDATE.ID AS BOUNDARY_ID,
            CANDIDATE.CITY_ID,
            CANDIDATE.AREA_M2,
            CASE
                WHEN GEOMETRYTYPE(INPUT_GEOM) = 'POINT' THEN
                    CASE
                        WHEN ST_COVERS(CANDIDATE.GEOM, INPUT_GEOM)
                            THEN 1::DOUBLE PRECISION
                        ELSE 0::DOUBLE PRECISION
                    END
                WHEN GEOMETRYTYPE(INPUT_GEOM) IN (
                    'LINESTRING',
                    'MULTILINESTRING'
                ) THEN
                    ST_LENGTH(
                        ST_COLLECTIONEXTRACT(
                            CASE
                                WHEN DESCENDANT_UNION.ACTIVE_DESCENDANTS IS NULL
                                    THEN ST_INTERSECTION(
                                        INPUT_GEOM,
                                        CANDIDATE.GEOM
                                    )
                                ELSE ST_DIFFERENCE(
                                    ST_INTERSECTION(
                                        INPUT_GEOM,
                                        CANDIDATE.GEOM
                                    ),
                                    DESCENDANT_UNION.ACTIVE_DESCENDANTS
                                )
                            END,
                            2
                        )::GEOGRAPHY
                    )
                WHEN GEOMETRYTYPE(INPUT_GEOM) IN (
                    'POLYGON',
                    'MULTIPOLYGON'
                ) THEN
                    ST_AREA(
                        ST_COLLECTIONEXTRACT(
                            CASE
                                WHEN DESCENDANT_UNION.ACTIVE_DESCENDANTS IS NULL
                                    THEN ST_INTERSECTION(
                                        INPUT_GEOM,
                                        CANDIDATE.GEOM
                                    )
                                ELSE ST_DIFFERENCE(
                                    ST_INTERSECTION(
                                        INPUT_GEOM,
                                        CANDIDATE.GEOM
                                    ),
                                    DESCENDANT_UNION.ACTIVE_DESCENDANTS
                                )
                            END,
                            3
                        )::GEOGRAPHY
                    )
                ELSE 0::DOUBLE PRECISION
            END AS MATCHED_MEASURE
        FROM CANDIDATES AS CANDIDATE
        LEFT JOIN DESCENDANT_UNIONS AS DESCENDANT_UNION
          ON DESCENDANT_UNION.ROOT_ID = CANDIDATE.ID
    )
    SELECT
        SCORED.BOUNDARY_ID,
        SCORED.CITY_ID
    FROM SCORED
    WHERE SCORED.MATCHED_MEASURE > 0
    ORDER BY
        CASE
            WHEN GEOMETRYTYPE(INPUT_GEOM) = 'POINT'
                THEN SCORED.AREA_M2
            ELSE NULL
        END ASC NULLS LAST,
        CASE
            WHEN GEOMETRYTYPE(INPUT_GEOM) <> 'POINT'
                THEN SCORED.MATCHED_MEASURE
            ELSE NULL
        END DESC NULLS LAST,
        SCORED.BOUNDARY_ID ASC
    LIMIT 1
$FUNCTION$;

CREATE OR REPLACE FUNCTION BUSLANES.RELINK_CITY_GEOMETRY(
    P_GEOMETRY_ID BIGINT
)
RETURNS VOID
LANGUAGE PLPGSQL
AS $FUNCTION$
DECLARE
    NEXT_BOUNDARY_ID BIGINT;
    NEXT_CITY_ID BIGINT;
BEGIN
    SELECT
        RESOLVED.BOUNDARY_ID,
        RESOLVED.CITY_ID
    INTO
        NEXT_BOUNDARY_ID,
        NEXT_CITY_ID
    FROM BUSLANES.CITY_GEOMETRIES AS GEOMETRY
    LEFT JOIN LATERAL
        BUSLANES.RESOLVE_GEOMETRY_ADMIN_LINKS(GEOMETRY.GEOM)
        AS RESOLVED
        ON TRUE
    WHERE GEOMETRY.ID = P_GEOMETRY_ID;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE BUSLANES.CITY_GEOMETRIES
    SET
        BOUNDARY_ID = NEXT_BOUNDARY_ID,
        CITY_ID = NEXT_CITY_ID
    WHERE ID = P_GEOMETRY_ID
      AND (
          BOUNDARY_ID IS DISTINCT FROM NEXT_BOUNDARY_ID
          OR CITY_ID IS DISTINCT FROM NEXT_CITY_ID
      );
END
$FUNCTION$;

CREATE OR REPLACE FUNCTION BUSLANES.RELINK_ALL_CITY_GEOMETRIES()
RETURNS INTEGER
LANGUAGE PLPGSQL
AS $FUNCTION$
DECLARE
    CHANGED_COUNT INTEGER;
BEGIN
    WITH RESOLVED AS (
        SELECT
            GEOMETRY.ID,
            LINK.BOUNDARY_ID,
            LINK.CITY_ID
        FROM BUSLANES.CITY_GEOMETRIES AS GEOMETRY
        LEFT JOIN LATERAL
            BUSLANES.RESOLVE_GEOMETRY_ADMIN_LINKS(GEOMETRY.GEOM)
            AS LINK
            ON TRUE
    )
    UPDATE BUSLANES.CITY_GEOMETRIES AS GEOMETRY
    SET
        BOUNDARY_ID = RESOLVED.BOUNDARY_ID,
        CITY_ID = RESOLVED.CITY_ID
    FROM RESOLVED
    WHERE GEOMETRY.ID = RESOLVED.ID
      AND (
          GEOMETRY.BOUNDARY_ID IS DISTINCT FROM RESOLVED.BOUNDARY_ID
          OR GEOMETRY.CITY_ID IS DISTINCT FROM RESOLVED.CITY_ID
      );

    GET DIAGNOSTICS CHANGED_COUNT = ROW_COUNT;
    RETURN CHANGED_COUNT;
END
$FUNCTION$;

CREATE OR REPLACE VIEW BUSLANES.EFFECTIVE_CITY_GEOMETRIES AS
SELECT GEOMETRY.*
FROM BUSLANES.CITY_GEOMETRIES AS GEOMETRY
JOIN BUSLANES.CITY_BOUNDARIES AS BOUNDARY
  ON BOUNDARY.ID = GEOMETRY.BOUNDARY_ID
 AND BOUNDARY.IS_ACTIVE
JOIN BUSLANES.CITIES AS CITY
  ON CITY.ID = GEOMETRY.CITY_ID
 AND BOUNDARY.CITY_ID = CITY.ID;

COMMENT ON VIEW BUSLANES.EFFECTIVE_CITY_GEOMETRIES IS
    'Canonical public/report geometry set. Administrative links are derived spatially; unlinked geometries remain fully editable but are not public/report members.';

CREATE OR REPLACE VIEW BUSLANES.GEOMETRY_MODEL_INTEGRITY AS
SELECT
    'active-boundary-without-city'::text AS issue,
    BOUNDARY.ID::bigint AS boundary_id,
    NULL::bigint AS geometry_id,
    BOUNDARY.CITY_ID::bigint AS city_id
FROM BUSLANES.CITY_BOUNDARIES AS BOUNDARY
WHERE BOUNDARY.IS_ACTIVE
  AND BOUNDARY.CITY_ID IS NULL

UNION ALL

SELECT
    'active-boundary-city-identity-mismatch'::text,
    BOUNDARY.ID::bigint,
    NULL::bigint,
    BOUNDARY.CITY_ID::bigint
FROM BUSLANES.CITY_BOUNDARIES AS BOUNDARY
JOIN BUSLANES.CITIES AS CITY
  ON CITY.ID = BOUNDARY.CITY_ID
WHERE BOUNDARY.IS_ACTIVE
  AND (
    LOWER(REGEXP_REPLACE(CITY.DISPLAY_TYPE, '[[:space:]]+', '', 'g'))
      <> LOWER(REGEXP_REPLACE(BOUNDARY.DISPLAY_TYPE, '[[:space:]]+', '', 'g'))
    OR LOWER(REGEXP_REPLACE(CITY.NAME, '[[:space:]]+', '', 'g'))
      <> LOWER(REGEXP_REPLACE(BOUNDARY.DISPLAY_NAME, '[[:space:]]+', '', 'g'))
  )

UNION ALL

SELECT
    'geometry-derived-link-mismatch'::text,
    GEOMETRY.BOUNDARY_ID::bigint,
    GEOMETRY.ID::bigint,
    GEOMETRY.CITY_ID::bigint
FROM BUSLANES.CITY_GEOMETRIES AS GEOMETRY
JOIN BUSLANES.CITY_BOUNDARIES AS BOUNDARY
  ON BOUNDARY.ID = GEOMETRY.BOUNDARY_ID
WHERE NOT BOUNDARY.IS_ACTIVE
   OR GEOMETRY.CITY_ID IS DISTINCT FROM BOUNDARY.CITY_ID

UNION ALL

SELECT
    'geometry-derived-line-value-mismatch'::text,
    GEOMETRY.BOUNDARY_ID::bigint,
    GEOMETRY.ID::bigint,
    GEOMETRY.CITY_ID::bigint
FROM BUSLANES.CITY_GEOMETRIES AS GEOMETRY
WHERE GEOMETRYTYPE(GEOMETRY.GEOM) IN ('LINESTRING', 'MULTILINESTRING')
  AND (
    ABS(GEOMETRY.LENGTH_M - ST_LENGTH(GEOMETRY.GEOM::GEOGRAPHY)) > 0.001
    OR ABS(
      GEOMETRY.LANE_LENGTH_M
      - ST_LENGTH(GEOMETRY.GEOM::GEOGRAPHY) * GEOMETRY.LANES
    ) > 0.001
  );

COMMENT ON VIEW BUSLANES.GEOMETRY_MODEL_INTEGRITY IS
    'Must remain empty. Administrative geometry links are optional derived state; only invalid active links and derived line values are reported.';

COMMENT ON COLUMN BUSLANES.CITY_GEOMETRIES.CITY_ID IS
    'Optional spatially-derived application-city link. NULL is a normal editable state and never controls geometry lifecycle.';
COMMENT ON COLUMN BUSLANES.CITY_GEOMETRIES.BOUNDARY_ID IS
    'Optional spatially-derived active OSM-boundary link. NULL is a normal editable state and never controls geometry lifecycle.';
COMMENT ON COLUMN BUSLANES.CITY_GEOMETRIES.UPDATED_AT IS
    'Revision of editable geometry content. Administrative link recalculation intentionally does not change this timestamp.';

SELECT BUSLANES.RELINK_ALL_CITY_GEOMETRIES();
SELECT BUSLANES.ASSERT_CITY_GEOMETRY_INVARIANTS();
