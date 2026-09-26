SET SEARCH_PATH = BUSLANES, PUBLIC;

ALTER TABLE BUSLANES.ADMIN_USERS
    ADD COLUMN IF NOT EXISTS CAN_EDIT_GEOMETRIES BOOLEAN NOT NULL DEFAULT FALSE;

-- Geometry editing used to be reachable only through broad data-management
-- access. Preserve that access for existing administrators; future changes are
-- controlled by the dedicated geometry-editor role.
UPDATE BUSLANES.ADMIN_USERS
SET CAN_EDIT_GEOMETRIES = TRUE,
    UPDATED_AT = NOW()
WHERE CAN_MANAGE_DATA
   OR IS_SUPERUSER
   OR IS_BOOTSTRAP;

COMMENT ON COLUMN BUSLANES.ADMIN_USERS.CAN_EDIT_GEOMETRIES IS
    'Allows access to the dedicated geometry editor and its mutation API.';
