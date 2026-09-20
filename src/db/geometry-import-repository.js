import { acquireDataImportLock } from './database-locks.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

export class GeometryImportSessionError extends Error {
  constructor(message, statusCode = 409) {
    super(message);
    this.name = 'GeometryImportSessionError';
    this.statusCode = statusCode;
  }
}

const UPSERT_CITIES_SQL = `
  WITH requested AS (
    SELECT DISTINCT stage.boundary_id
    FROM geometry_import_stage AS stage
    WHERE stage.session_id = $1
  ),
  canonical AS (
    SELECT
      boundary.id AS boundary_id,
      boundary.display_name AS city_name,
      boundary.display_type AS city_type,
      boundary.osm_type,
      boundary.osm_id,
      boundary.place_type,
      boundary.admin_level
    FROM requested
    JOIN city_boundaries AS boundary ON boundary.id = requested.boundary_id
    WHERE boundary.is_active
  )
  INSERT INTO cities (
    slug,
    name,
    full_name,
    display_type,
    lane_length_m,
    attributes
  )
  SELECT
    'osm-' || canonical.osm_type || '-' || canonical.osm_id,
    canonical.city_name,
    canonical.city_name,
    canonical.city_type,
    0,
    jsonb_build_object(
      '_osm',
      jsonb_build_object(
        'osmType', canonical.osm_type,
        'osmId', canonical.osm_id,
        'placeType', canonical.place_type,
        'adminLevel', canonical.admin_level
      )
    )
  FROM canonical
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    full_name = EXCLUDED.full_name,
    display_type = EXCLUDED.display_type,
    attributes = cities.attributes || EXCLUDED.attributes,
    updated_at = now()
`;

const LINK_CITIES_SQL = `
  UPDATE city_boundaries AS boundary
  SET city_id = city.id,
      updated_at = now()
  FROM cities AS city
  WHERE boundary.id IN (
      SELECT stage.boundary_id
      FROM geometry_import_stage AS stage
      WHERE stage.session_id = $1
    )
    AND city.slug = 'osm-' || boundary.osm_type || '-' || boundary.osm_id
    AND boundary.is_active
    AND boundary.city_id IS NULL
`;

const RESOLVE_STAGE_CITY_SQL = `
  UPDATE geometry_import_stage AS stage
  SET city_id = boundary.city_id
  FROM city_boundaries AS boundary
  WHERE stage.session_id = $1
    AND boundary.id = stage.boundary_id
    AND boundary.is_active
    AND boundary.city_id IS NOT NULL
`;

const INSERT_LINE_TYPES_SQL = `
  WITH requested AS (
    SELECT DISTINCT BTRIM(stage.line_type_name) AS name
    FROM geometry_import_stage AS stage
    WHERE stage.session_id = $1
  )
  INSERT INTO line_types (name, title)
  SELECT requested.name, requested.name
  FROM requested
  WHERE NOT EXISTS (
    SELECT 1
    FROM line_types AS existing
    WHERE LOWER(BTRIM(existing.name)) = LOWER(BTRIM(requested.name))
  )
  ON CONFLICT DO NOTHING
  RETURNING
    id::integer AS id,
    code::integer AS code,
    name,
    title,
    color,
    line_style AS style,
    width::double precision AS width
`;

const RESOLVE_STAGE_TYPE_SQL = `
  UPDATE geometry_import_stage AS stage
  SET line_type_id = line_type.id
  FROM line_types AS line_type
  WHERE stage.session_id = $1
    AND LOWER(BTRIM(line_type.name)) = LOWER(BTRIM(stage.line_type_name))
`;

const REBUILD_AUTO_MATCH_SQL = `
  UPDATE geometry_import_stage AS stage
  SET auto_existing_id = (
    SELECT existing.id
    FROM city_geometries AS existing
    WHERE stage.session_id = $1
      AND existing.boundary_id = stage.boundary_id
      AND GeometryType(existing.geom) IN ('LINESTRING', 'MULTILINESTRING')
      AND ST_Equals(existing.geom, stage.geom)
      AND existing.source_tags = stage.source_tags
    ORDER BY existing.was_edited DESC, existing.id
    LIMIT 1
  )
  WHERE stage.session_id = $1
`;

const INSERT_CONFLICTS_SQL = `
  INSERT INTO geometry_import_conflicts (
    session_id,
    incoming_id,
    existing_id,
    relation
  )
  SELECT
    stage.session_id,
    stage.id,
    existing.id,
    CASE
      WHEN ST_Equals(existing.geom, stage.geom)
        AND existing.source_tags IS DISTINCT FROM stage.source_tags
        THEN 'equals-different-tags'
      WHEN ST_Overlaps(existing.geom, stage.geom)
        THEN 'overlaps'
      ELSE 'within-same-tags'
    END
  FROM geometry_import_stage AS stage
  JOIN city_geometries AS existing
    ON existing.boundary_id = stage.boundary_id
   AND GeometryType(existing.geom) IN ('LINESTRING', 'MULTILINESTRING')
   AND existing.geom && stage.geom
  WHERE stage.session_id = $1
    AND (
      (
        ST_Equals(existing.geom, stage.geom)
        AND existing.source_tags IS DISTINCT FROM stage.source_tags
      )
      OR ST_Overlaps(existing.geom, stage.geom)
      OR (
        NOT ST_Equals(existing.geom, stage.geom)
        AND existing.source_tags = stage.source_tags
        AND (
          ST_Within(existing.geom, stage.geom)
          OR ST_Within(stage.geom, existing.geom)
        )
      )
    )
  ON CONFLICT (session_id, incoming_id, existing_id) DO UPDATE
  SET relation = EXCLUDED.relation
`;

const STAGE_ROWS_SQL = `
  WITH payload AS (
    SELECT *
    FROM jsonb_to_recordset($2::jsonb) AS row(
      seq integer,
      "boundaryId" bigint,
      "lineTypeName" text,
      lanes smallint,
      "displayName" text,
      properties jsonb,
      "sourceTags" jsonb,
      geometry jsonb
    )
  )
  INSERT INTO geometry_import_stage (
    session_id,
    seq,
    boundary_id,
    line_type_name,
    lanes,
    display_name,
    properties,
    source_tags,
    geom
  )
  SELECT
    $1,
    payload.seq,
    payload."boundaryId",
    BTRIM(payload."lineTypeName"),
    payload.lanes,
    NULLIF(BTRIM(payload."displayName"), ''),
    payload.properties,
    payload."sourceTags",
    ST_SetSRID(ST_GeomFromGeoJSON(payload.geometry::text), 4326)
  FROM payload
  RETURNING id
`;

const STAGE_INSERT_ONE_SQL = `
  INSERT INTO city_geometries (
    city_id,
    boundary_id,
    line_type_id,
    lanes,
    length_m,
    lane_length_m,
    properties,
    geom,
    display_name,
    source_tags,
    tags,
    is_visible,
    was_edited,
    updated_at
  )
  SELECT
    stage.city_id,
    stage.boundary_id,
    stage.line_type_id,
    stage.lanes,
    ST_Length(stage.geom::geography),
    ST_Length(stage.geom::geography) * stage.lanes,
    stage.properties,
    stage.geom,
    stage.display_name,
    stage.source_tags,
    '{}'::text[],
    TRUE,
    FALSE,
    NOW()
  FROM geometry_import_stage AS stage
  WHERE stage.id = $1
  RETURNING id::integer AS id
`;

const UPDATE_EXISTING_FROM_STAGE_SQL = `
  UPDATE city_geometries AS existing
  SET
    city_id = stage.city_id,
    boundary_id = stage.boundary_id,
    line_type_id = stage.line_type_id,
    lanes = stage.lanes,
    length_m = ST_Length(stage.geom::geography),
    lane_length_m = ST_Length(stage.geom::geography) * stage.lanes,
    properties = stage.properties,
    geom = stage.geom,
    display_name = CASE
      WHEN existing.was_edited THEN existing.display_name
      ELSE stage.display_name
    END,
    source_tags = stage.source_tags,
    updated_at = NOW()
  FROM geometry_import_stage AS stage
  WHERE existing.id = $1
    AND stage.id = $2
  RETURNING existing.id::integer AS id
`;

function asIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}


function decisionMap(decisions) {
  if (!Array.isArray(decisions)) {
    throw new GeometryImportSessionError('decisions must be an array', 400);
  }
  const result = new Map();
  for (const [index, raw] of decisions.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new GeometryImportSessionError(`decisions[${index}] must be an object`, 400);
    }
    const incomingId = Number(raw.incomingId);
    if (!Number.isSafeInteger(incomingId) || incomingId <= 0) {
      throw new GeometryImportSessionError(`decisions[${index}].incomingId is invalid`, 400);
    }
    if (!['keep-existing', 'add-new', 'replace'].includes(raw.action)) {
      throw new GeometryImportSessionError(`decisions[${index}].action is invalid`, 400);
    }
    const replaceExistingIds = raw.action === 'replace'
      ? [...new Set((raw.replaceExistingIds ?? []).map(Number))]
      : [];
    if (
      raw.action === 'replace' &&
      (
        replaceExistingIds.length < 1 ||
        replaceExistingIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
      )
    ) {
      throw new GeometryImportSessionError(
        `decisions[${index}].replaceExistingIds must contain existing geometry ids`,
        400,
      );
    }
    result.set(incomingId, {
      incomingId,
      action: raw.action,
      replaceExistingIds,
    });
  }
  return result;
}

async function rebuildRelations(client, sessionId) {
  await client.query(
    'DELETE FROM geometry_import_conflicts WHERE session_id = $1',
    [sessionId],
  );
  await client.query(REBUILD_AUTO_MATCH_SQL, [sessionId]);
  await client.query(INSERT_CONFLICTS_SQL, [sessionId]);
  const result = await client.query(
    'SELECT COUNT(*)::integer AS count FROM geometry_import_conflicts WHERE session_id = $1',
    [sessionId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function resolveReferences(client, sessionId) {
  await client.query(UPSERT_CITIES_SQL, [sessionId]);
  await client.query(LINK_CITIES_SQL, [sessionId]);
  await client.query(RESOLVE_STAGE_CITY_SQL, [sessionId]);
  const unresolvedCities = await client.query(
    'SELECT COUNT(*)::integer AS count FROM geometry_import_stage WHERE session_id = $1 AND city_id IS NULL',
    [sessionId],
  );
  if (Number(unresolvedCities.rows[0]?.count ?? 0) > 0) {
    throw new GeometryImportSessionError(
      'One or more staged geometries no longer resolve to an active city boundary',
    );
  }

  const createdLineTypes = (await client.query(
    INSERT_LINE_TYPES_SQL,
    [sessionId],
  )).rows;
  await client.query(RESOLVE_STAGE_TYPE_SQL, [sessionId]);
  const unresolvedTypes = await client.query(
    'SELECT COUNT(*)::integer AS count FROM geometry_import_stage WHERE session_id = $1 AND line_type_id IS NULL',
    [sessionId],
  );
  if (Number(unresolvedTypes.rows[0]?.count ?? 0) > 0) {
    throw new GeometryImportSessionError('One or more staged line types could not be resolved');
  }
  return createdLineTypes;
}

async function loadConflictSets(client, sessionId) {
  const rows = await client.query(`
    SELECT
      conflict.incoming_id::integer AS "incomingId",
      conflict.existing_id::integer AS "existingId"
    FROM geometry_import_conflicts AS conflict
    WHERE conflict.session_id = $1
    ORDER BY conflict.incoming_id, conflict.existing_id
  `, [sessionId]);
  const candidates = new Map();
  for (const row of rows.rows) {
    if (row.existingId === null) {
      throw new GeometryImportSessionError(
        'An existing geometry changed while the import was waiting; discard and run the import again',
      );
    }
    const set = candidates.get(Number(row.incomingId)) ?? new Set();
    set.add(Number(row.existingId));
    candidates.set(Number(row.incomingId), set);
  }
  return candidates;
}

async function loadConflictAutoMatches(client, sessionId) {
  const result = await client.query(`
    SELECT
      stage.id::integer AS "incomingId",
      stage.auto_existing_id::integer AS "existingId"
    FROM geometry_import_stage AS stage
    WHERE stage.session_id = $1
      AND stage.auto_existing_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM geometry_import_conflicts AS conflict
        WHERE conflict.session_id = stage.session_id
          AND conflict.incoming_id = stage.id
      )
  `, [sessionId]);
  return new Map(
    result.rows.map((row) => [Number(row.incomingId), Number(row.existingId)]),
  );
}

async function protectExisting(client, sessionId) {
  await client.query(`
    CREATE TEMP TABLE geometry_import_preserve_existing (
      id bigint PRIMARY KEY
    ) ON COMMIT DROP
  `);
  await client.query(`
    INSERT INTO geometry_import_preserve_existing (id)
    SELECT DISTINCT auto_existing_id
    FROM geometry_import_stage
    WHERE session_id = $1
      AND auto_existing_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `, [sessionId]);
  await client.query(`
    INSERT INTO geometry_import_preserve_existing (id)
    SELECT DISTINCT existing_id
    FROM geometry_import_conflicts
    WHERE session_id = $1
      AND existing_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `, [sessionId]);
}

async function applyStaged(client, sessionId, rawDecisions = []) {
  const sessionResult = await client.query(`
    SELECT id::integer AS id, status, metadata
    FROM geometry_import_sessions
    WHERE id = $1
    FOR UPDATE
  `, [sessionId]);
  const session = sessionResult.rows[0];
  if (!session || session.status !== 'pending') {
    throw new GeometryImportSessionError('Pending import session not found', 404);
  }

  const conflictSets = await loadConflictSets(client, sessionId);
  const conflictAutoMatches = await loadConflictAutoMatches(client, sessionId);
  const decisions = decisionMap(rawDecisions);
  for (const incomingId of conflictSets.keys()) {
    if (!decisions.has(incomingId)) {
      throw new GeometryImportSessionError(
        `Conflict for incoming geometry ${incomingId} has no administrator decision`,
        400,
      );
    }
  }
  for (const decision of decisions.values()) {
    const candidates = conflictSets.get(decision.incomingId);
    if (!candidates) {
      throw new GeometryImportSessionError(
        `Incoming geometry ${decision.incomingId} has no conflict requiring a decision`,
        400,
      );
    }
    const autoExistingId = conflictAutoMatches.get(decision.incomingId) ?? null;
    if (decision.action === 'add-new' && autoExistingId !== null) {
      throw new GeometryImportSessionError(
        `Incoming geometry ${decision.incomingId} already has exact existing match ${autoExistingId}; add-new would create a duplicate`,
        400,
      );
    }
    for (const existingId of decision.replaceExistingIds) {
      if (!candidates.has(existingId)) {
        throw new GeometryImportSessionError(
          `Geometry ${existingId} is not a conflict candidate for incoming ${decision.incomingId}`,
          400,
        );
      }
    }
  }

  const createdLineTypes = await resolveReferences(client, sessionId);
  await protectExisting(client, sessionId);

  const removed = await client.query(`
    DELETE FROM city_geometries AS geometry
    WHERE geometry.properties ->> 'source' = 'kml'
      AND NOT geometry.was_edited
      AND NOT EXISTS (
        SELECT 1
        FROM geometry_import_preserve_existing AS preserved
        WHERE preserved.id = geometry.id
      )
    RETURNING geometry.id
  `);

  const autoRows = await client.query(`
    SELECT stage.id::integer AS id,
           stage.auto_existing_id::integer AS "existingId"
    FROM geometry_import_stage AS stage
    WHERE stage.session_id = $1
      AND stage.auto_existing_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM geometry_import_conflicts AS conflict
        WHERE conflict.session_id = stage.session_id
          AND conflict.incoming_id = stage.id
      )
    ORDER BY stage.seq
  `, [sessionId]);
  for (const row of autoRows.rows) {
    await client.query(UPDATE_EXISTING_FROM_STAGE_SQL, [row.existingId, row.id]);
  }

  const newRows = await client.query(`
    SELECT stage.id::integer AS id
    FROM geometry_import_stage AS stage
    WHERE stage.session_id = $1
      AND stage.auto_existing_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM geometry_import_conflicts AS conflict
        WHERE conflict.session_id = stage.session_id
          AND conflict.incoming_id = stage.id
      )
    ORDER BY stage.seq
  `, [sessionId]);
  let inserted = 0;
  for (const row of newRows.rows) {
    await client.query(STAGE_INSERT_ONE_SQL, [row.id]);
    inserted += 1;
  }

  let keptConflicts = 0;
  let addedConflicts = 0;
  let replacedExisting = 0;
  let conflictAutoMatched = 0;
  for (const [incomingId] of conflictSets) {
    const decision = decisions.get(incomingId);
    const autoExistingId = conflictAutoMatches.get(incomingId) ?? null;

    if (autoExistingId !== null) {
      // The incoming object already has an exact, same-source-tags identity.
      // Refresh that canonical row once; conflict decisions only decide what
      // to do with the additional spatial candidates.
      await client.query(
        UPDATE_EXISTING_FROM_STAGE_SQL,
        [autoExistingId, incomingId],
      );
      conflictAutoMatched += 1;

      if (decision.action === 'keep-existing') {
        keptConflicts += 1;
        continue;
      }

      const deleted = await client.query(
        'DELETE FROM city_geometries WHERE id = ANY($1::bigint[]) RETURNING id',
        [decision.replaceExistingIds],
      );
      replacedExisting += deleted.rowCount;
      continue;
    }

    if (decision.action === 'keep-existing') {
      keptConflicts += 1;
      continue;
    }
    if (decision.action === 'add-new') {
      await client.query(STAGE_INSERT_ONE_SQL, [incomingId]);
      inserted += 1;
      addedConflicts += 1;
      continue;
    }

    const [primary, ...extra] = decision.replaceExistingIds;
    await client.query(UPDATE_EXISTING_FROM_STAGE_SQL, [primary, incomingId]);
    replacedExisting += 1;
    if (extra.length > 0) {
      const deleted = await client.query(
        'DELETE FROM city_geometries WHERE id = ANY($1::bigint[]) RETURNING id',
        [extra],
      );
      replacedExisting += deleted.rowCount;
    }
  }

  await client.query(RECALCULATE_CITY_STATISTICS_SQL);

  const metadata = session.metadata ?? {};
  const runResult = await client.query(`
    INSERT INTO geometry_update_runs (
      sources,
      checksum,
      downloaded_bytes,
      parsed_lines,
      imported_geometries,
      skipped_without_city,
      resolved_ambiguous,
      ignored_non_lines,
      city_buffer_m
    )
    VALUES (
      $1::jsonb, $2, $3, $4, $5, $6, $7, $8, $9
    )
    RETURNING id::integer AS id, created_at AS "createdAt"
  `, [
    JSON.stringify(metadata.sources ?? []),
    metadata.checksum ?? '',
    Number(metadata.downloadedBytes ?? 0),
    Number(metadata.parsedLines ?? 0),
    Number(metadata.importedGeometries ?? 0),
    Number(metadata.skippedWithoutCity ?? 0),
    Number(metadata.resolvedAmbiguous ?? 0),
    Number(metadata.ignoredNonLines ?? 0),
    Number(metadata.cityBufferMeters ?? 0),
  ]);

  await client.query(`
    UPDATE geometry_import_sessions
    SET status = 'applied',
        updated_at = NOW()
    WHERE id = $1
  `, [sessionId]);

  return {
    sessionId,
    status: 'applied',
    updateRunId: runResult.rows[0].id,
    completedAt: asIso(runResult.rows[0].createdAt),
    stagedGeometries: Number(metadata.importedGeometries ?? 0),
    insertedGeometries: inserted,
    automaticallyMatched: autoRows.rows.length + conflictAutoMatched,
    conflictAutoMatched,
    removedObsoleteSourceGeometries: removed.rowCount,
    keptConflictGeometries: keptConflicts,
    addedConflictGeometries: addedConflicts,
    replacedExistingGeometries: replacedExisting,
    createdLineTypes,
  };
}

/** @param {{ connect: Function, query: Function, databaseSchema?: string }} pool */
export function createGeometryImportRepository(pool) {
  return {
    async assertNoPending(client) {
      const result = await client.query(
        "SELECT id::integer AS id FROM geometry_import_sessions WHERE status = 'pending' LIMIT 1",
      );
      if (result.rows[0]) {
        throw new GeometryImportSessionError(
          `Import session ${result.rows[0].id} is waiting for conflict resolution`,
        );
      }
    },

    async stageKml(client, rows, metadata) {
      await this.assertNoPending(client);
      const sessionResult = await client.query(`
        INSERT INTO geometry_import_sessions (kind, status, metadata)
        VALUES ('kml', 'pending', $1::jsonb)
        RETURNING id::integer AS id, created_at AS "createdAt"
      `, [JSON.stringify(metadata)]);
      const session = sessionResult.rows[0];
      const payload = rows.map((row, seq) => ({
        seq,
        boundaryId: row.boundaryId,
        lineTypeName: row.businessTypeName ?? row.lineTypeName,
        lanes: row.multiple ?? row.lanes,
        displayName: row.properties?.placemarkName ?? null,
        properties: row.properties ?? {},
        sourceTags: row.sourceTags ?? {},
        geometry: row.geometry,
      }));
      const inserted = await client.query(
        STAGE_ROWS_SQL,
        [session.id, JSON.stringify(payload)],
      );
      if (inserted.rowCount !== payload.length) {
        throw new Error('Not every imported KML geometry was staged');
      }
      const conflictCount = await rebuildRelations(client, session.id);
      const conflictIncoming = await client.query(`
        SELECT COUNT(DISTINCT incoming_id)::integer AS count
        FROM geometry_import_conflicts
        WHERE session_id = $1
      `, [session.id]);
      return {
        id: session.id,
        kind: 'kml',
        status: 'pending',
        stagedGeometries: payload.length,
        conflictCount,
        conflictGeometries: Number(conflictIncoming.rows[0]?.count ?? 0),
        createdAt: asIso(session.createdAt),
      };
    },

    async applyInTransaction(client, sessionId, decisions = []) {
      return applyStaged(client, sessionId, decisions);
    },

    async apply(sessionId, decisions = [], operation = {}) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await acquireDataImportLock(client, pool);
        operation.onProgress?.({ phase: 'import-conflicts-apply', sessionId });
        const result = await applyStaged(client, sessionId, decisions);
        operation.onCommit?.();
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async discard(sessionId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await acquireDataImportLock(client, pool);
        const result = await client.query(`
          DELETE FROM geometry_import_sessions
          WHERE id = $1
            AND status = 'pending'
          RETURNING id::integer AS id
        `, [sessionId]);
        await client.query('COMMIT');
        return result.rows[0] ?? null;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async pending() {
      const sessionResult = await pool.query(`
        SELECT
          id::integer AS id,
          kind,
          status,
          metadata,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM geometry_import_sessions
        WHERE status = 'pending'
        ORDER BY id DESC
        LIMIT 1
      `);
      const session = sessionResult.rows[0];
      if (!session) return null;

      const rows = await pool.query(`
        SELECT
          stage.id::integer AS "incomingId",
          stage.seq,
          stage.boundary_id::integer AS "boundaryId",
          boundary.display_name AS "cityName",
          ST_AsGeoJSON(boundary.geom)::json AS "boundaryGeometry",
          stage.line_type_name AS "lineTypeName",
          stage.lanes,
          stage.display_name AS "displayName",
          stage.source_tags AS "sourceTags",
          ST_AsGeoJSON(stage.geom)::json AS geometry,
          stage.auto_existing_id::integer AS "autoExistingId",
          conflict.id::integer AS "conflictId",
          conflict.relation,
          existing.id::integer AS "existingId",
          existing.city_id::integer AS "existingCityId",
          existing.display_name AS "existingDisplayName",
          GeometryType(existing.geom) AS "existingGeometryType",
          existing.source_tags AS "existingSourceTags",
          existing.tags AS "existingTags",
          existing.was_edited AS "existingWasEdited",
          ST_AsGeoJSON(existing.geom)::json AS "existingGeometry"
        FROM geometry_import_stage AS stage
        JOIN city_boundaries AS boundary ON boundary.id = stage.boundary_id
        LEFT JOIN geometry_import_conflicts AS conflict
          ON conflict.session_id = stage.session_id
         AND conflict.incoming_id = stage.id
        LEFT JOIN city_geometries AS existing ON existing.id = conflict.existing_id
        WHERE stage.session_id = $1
        ORDER BY stage.seq, conflict.id
      `, [session.id]);

      const byIncoming = new Map();
      for (const row of rows.rows) {
        let incoming = byIncoming.get(row.incomingId);
        if (!incoming) {
          incoming = {
            incomingId: Number(row.incomingId),
            seq: Number(row.seq),
            boundaryId: Number(row.boundaryId),
            cityName: row.cityName,
            boundaryGeometry: row.boundaryGeometry,
            lineTypeName: row.lineTypeName,
            lanes: Number(row.lanes),
            displayName: row.displayName,
            sourceTags: row.sourceTags ?? {},
            geometry: row.geometry,
            autoExistingId: row.autoExistingId === null ? null : Number(row.autoExistingId),
            candidates: [],
          };
          byIncoming.set(row.incomingId, incoming);
        }
        if (row.conflictId !== null) {
          incoming.candidates.push({
            conflictId: Number(row.conflictId),
            relation: row.relation,
            existing: {
              id: Number(row.existingId),
              cityId: row.existingCityId === null ? null : Number(row.existingCityId),
              displayName: row.existingDisplayName,
              geometryType: row.existingGeometryType,
              sourceTags: row.existingSourceTags ?? {},
              tags: row.existingTags ?? [],
              wasEdited: Boolean(row.existingWasEdited),
              geometry: row.existingGeometry,
            },
          });
        }
      }
      const conflicts = [...byIncoming.values()].filter((item) => item.candidates.length > 0);
      return {
        id: Number(session.id),
        kind: session.kind,
        status: session.status,
        metadata: session.metadata ?? {},
        createdAt: asIso(session.createdAt),
        updatedAt: asIso(session.updatedAt),
        stagedGeometries: byIncoming.size,
        conflictGeometries: conflicts.length,
        conflictPairs: conflicts.reduce((sum, item) => sum + item.candidates.length, 0),
        conflicts,
      };
    },
  };
}
