SET SEARCH_PATH = BUSLANES, PUBLIC;

-- PostGIS versions may represent an aggregate with no active descendant
-- geometries either as NULL or as an EMPTY geometry. Both mean that the
-- candidate territory has no active child area to subtract.
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
                                     OR ST_ISEMPTY(
                                         DESCENDANT_UNION.ACTIVE_DESCENDANTS
                                     )
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
                                     OR ST_ISEMPTY(
                                         DESCENDANT_UNION.ACTIVE_DESCENDANTS
                                     )
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

SELECT BUSLANES.RELINK_ALL_CITY_GEOMETRIES();
SELECT BUSLANES.ASSERT_CITY_GEOMETRY_INVARIANTS();
