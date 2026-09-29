SET SEARCH_PATH = BUSLANES, PUBLIC;

-- GEOS overlay and topological predicates can disagree for fully covered
-- geometries on some PostGIS/GEOS combinations. V052 bypassed intersection
-- when a candidate fully covers the input. Apply the same principle when an
-- active descendant union fully covers a candidate match: the parent score is
-- exactly zero, so do not ask ST_Difference to derive that empty geometry.
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
            BOUNDARY.AREA_M2,
            CASE
                WHEN ST_COVERS(
                    BOUNDARY.GEOM,
                    INPUT_GEOM
                )
                THEN INPUT_GEOM
                ELSE ST_INTERSECTION(
                    INPUT_GEOM,
                    BOUNDARY.GEOM
                )
            END AS BASE_MATCH
        FROM BUSLANES.CITY_BOUNDARIES
            AS BOUNDARY
        WHERE BOUNDARY.IS_ACTIVE
          AND BOUNDARY.GEOM && INPUT_GEOM
          AND ST_INTERSECTS(
              BOUNDARY.GEOM,
              INPUT_GEOM
          )
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
        JOIN BUSLANES.CITY_BOUNDARIES
            AS CHILD
          ON CHILD.PARENT_ID =
             CANDIDATE.ID

        UNION ALL

        SELECT
            DESCENDANT.ROOT_ID,
            CHILD.ID,
            CHILD.GEOM,
            CHILD.IS_ACTIVE
        FROM DESCENDANTS
            AS DESCENDANT
        JOIN BUSLANES.CITY_BOUNDARIES
            AS CHILD
          ON CHILD.PARENT_ID =
             DESCENDANT.ID
    ),
    ACTIVE_DESCENDANT_UNIONS AS (
        SELECT
            ROOT_ID,
            ST_UNARYUNION(
                ST_COLLECT(GEOM)
            ) AS ACTIVE_DESCENDANTS
        FROM DESCENDANTS
        WHERE IS_ACTIVE
        GROUP BY ROOT_ID
    ),
    SCORED AS (
        SELECT
            CANDIDATE.ID
                AS BOUNDARY_ID,
            CANDIDATE.CITY_ID,
            CANDIDATE.AREA_M2,
            CASE
                WHEN GEOMETRYTYPE(
                    INPUT_GEOM
                ) = 'POINT'
                THEN
                    CASE
                        WHEN ST_COVERS(
                            CANDIDATE.GEOM,
                            INPUT_GEOM
                        )
                            THEN
                                1::DOUBLE PRECISION
                        ELSE
                            0::DOUBLE PRECISION
                    END
                WHEN GEOMETRYTYPE(
                    INPUT_GEOM
                ) IN (
                    'LINESTRING',
                    'MULTILINESTRING'
                )
                THEN
                    CASE
                        WHEN
                            DESCENDANT_UNION
                                .ACTIVE_DESCENDANTS
                                IS NOT NULL
                            AND ST_COVERS(
                                DESCENDANT_UNION
                                    .ACTIVE_DESCENDANTS,
                                CANDIDATE.BASE_MATCH
                            )
                        THEN
                            0::DOUBLE PRECISION
                        ELSE
                            ST_LENGTH(
                                ST_COLLECTIONEXTRACT(
                                    CASE
                                        WHEN
                                            DESCENDANT_UNION
                                                .ACTIVE_DESCENDANTS
                                                IS NULL
                                        THEN
                                            CANDIDATE.BASE_MATCH
                                        ELSE
                                            ST_DIFFERENCE(
                                                CANDIDATE.BASE_MATCH,
                                                DESCENDANT_UNION
                                                    .ACTIVE_DESCENDANTS
                                            )
                                    END,
                                    2
                                )::GEOGRAPHY
                            )
                    END
                WHEN GEOMETRYTYPE(
                    INPUT_GEOM
                ) IN (
                    'POLYGON',
                    'MULTIPOLYGON'
                )
                THEN
                    CASE
                        WHEN
                            DESCENDANT_UNION
                                .ACTIVE_DESCENDANTS
                                IS NOT NULL
                            AND ST_COVERS(
                                DESCENDANT_UNION
                                    .ACTIVE_DESCENDANTS,
                                CANDIDATE.BASE_MATCH
                            )
                        THEN
                            0::DOUBLE PRECISION
                        ELSE
                            ST_AREA(
                                ST_COLLECTIONEXTRACT(
                                    CASE
                                        WHEN
                                            DESCENDANT_UNION
                                                .ACTIVE_DESCENDANTS
                                                IS NULL
                                        THEN
                                            CANDIDATE.BASE_MATCH
                                        ELSE
                                            ST_DIFFERENCE(
                                                CANDIDATE.BASE_MATCH,
                                                DESCENDANT_UNION
                                                    .ACTIVE_DESCENDANTS
                                            )
                                    END,
                                    3
                                )::GEOGRAPHY
                            )
                    END
                ELSE
                    0::DOUBLE PRECISION
            END AS MATCHED_MEASURE
        FROM CANDIDATES AS CANDIDATE
        LEFT JOIN
            ACTIVE_DESCENDANT_UNIONS
                AS DESCENDANT_UNION
          ON DESCENDANT_UNION.ROOT_ID =
             CANDIDATE.ID
    )
    SELECT
        SCORED.BOUNDARY_ID,
        SCORED.CITY_ID
    FROM SCORED
    WHERE SCORED.MATCHED_MEASURE > 0
    ORDER BY
        CASE
            WHEN GEOMETRYTYPE(
                INPUT_GEOM
            ) = 'POINT'
                THEN
                    SCORED.AREA_M2
            ELSE
                NULL
        END ASC NULLS LAST,
        CASE
            WHEN GEOMETRYTYPE(
                INPUT_GEOM
            ) <> 'POINT'
                THEN
                    SCORED.MATCHED_MEASURE
            ELSE
                NULL
        END DESC NULLS LAST,
        SCORED.BOUNDARY_ID ASC
    LIMIT 1
$FUNCTION$;

SELECT
    BUSLANES.RELINK_ALL_CITY_GEOMETRIES();

SELECT
    BUSLANES.ASSERT_CITY_GEOMETRY_INVARIANTS();
