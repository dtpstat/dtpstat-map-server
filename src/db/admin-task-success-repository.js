/**
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }} pool
 */
export function createAdminTaskSuccessRepository(pool) {
  return {
    async list() {
      const result = await pool.query(`
        SELECT task_type AS "taskType",
               task_id::text AS "taskId",
               endpoint,
               completed_at AS "completedAt"
        FROM buslanes.admin_task_successes
        ORDER BY task_type
      `);
      return result.rows.map((row) => ({
        ...row,
        completedAt: new Date(row.completedAt).toISOString(),
      }));
    },

    /** @param {{ taskType: string, taskId: string, endpoint: string, completedAt: string }} update */
    async record(update) {
      const result = await pool.query(`
        INSERT INTO buslanes.admin_task_successes (
          task_type,
          task_id,
          endpoint,
          completed_at
        ) VALUES ($1, $2::uuid, $3, $4::timestamptz)
        ON CONFLICT (task_type) DO UPDATE
        SET task_id = EXCLUDED.task_id,
            endpoint = EXCLUDED.endpoint,
            completed_at = EXCLUDED.completed_at
        RETURNING task_type AS "taskType",
                  task_id::text AS "taskId",
                  endpoint,
                  completed_at AS "completedAt"
      `, [
        update.taskType,
        update.taskId,
        update.endpoint,
        update.completedAt,
      ]);
      return {
        ...result.rows[0],
        completedAt: new Date(result.rows[0].completedAt).toISOString(),
      };
    },
  };
}
